const express = require('express');
const cors = require('cors');
const path = require('path');
const { google } = require('googleapis');
const mongoose = require('mongoose');
require('dotenv').config();

const BrandingData = require('./models/BrandingData');

// Connect to MongoDB
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/zypp-branding';
mongoose.connect(mongoUri)
    .then(() => console.log('Connected to MongoDB successfully.'))
    .catch(err => console.error('MongoDB connection error:', err));

const fs = require('fs');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3002; // Using 3002 to avoid conflict with existing Python process on 3001

app.use(cors());
app.use(express.json());

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, '../frontend/public/uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use('/uploads', express.static(uploadsDir));
app.use(express.static(path.join(__dirname, '../frontend/public')));

// Set up disk storage for multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// Local upload endpoint
app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    const imageUrl = `/uploads/${req.file.filename}`;
    res.json({ success: true, url: imageUrl });
});



// MongoDB schema and model for storing images directly as binary buffers
const ImageSchema = new mongoose.Schema({
    data: Buffer,
    contentType: String
});
const ImageModel = mongoose.models.Image || mongoose.model('Image', ImageSchema);

// Upload directly to MongoDB
app.post('/api/upload/mongodb', upload.single('image'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    
    try {
        const fs = require('fs');
        const filePath = req.file.path;
        
        const img = new ImageModel({
            data: fs.readFileSync(filePath),
            contentType: req.file.mimetype
        });
        await img.save();
        
        // Clean up local file after saving to DB
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        
        // Return public URL that streams this image from MongoDB
        const host = req.get('host');
        const protocol = (host.includes('localhost') || host.includes('127.0.0.1')) ? 'http' : 'https';
        const imageUrl = `${protocol}://${host}/api/images/${img._id}`;
        
        res.json({ success: true, url: imageUrl });
    } catch (e) {
        console.error("MongoDB image upload failed:", e.message);
        res.status(500).json({ error: e.message });
    }
});

// Serve image from MongoDB
app.get('/api/images/:id', async (req, res) => {
    try {
        const img = await ImageModel.findById(req.params.id);
        if (!img) {
            return res.status(404).send('Image not found');
        }
        res.set('Content-Type', img.contentType);
        res.send(img.data);
    } catch (e) {
        console.error("Failed to serve image from MongoDB:", e.message);
        res.status(500).send('Server error');
    }
});

// Configure standard Google APIs Auth Client
let cachedAuthClient = null;
async function getAuth() {
    if (cachedAuthClient) return cachedAuthClient;
    try {
        let authConfig = {
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        };

        // Support for Vercel Environment Variable (JSON String)
        if (process.env.GOOGLE_SERVICE_ACCOUNT) {
            try {
                authConfig.credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
            } catch (e) {
                console.error("Failed to parse GOOGLE_SERVICE_ACCOUNT env var:", e);
            }
        } else {
            // Fallback to local file
            authConfig.keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, '../service-account.json');
        }

        const auth = new google.auth.GoogleAuth(authConfig);
        cachedAuthClient = await auth.getClient();
        console.log("Google Auth Client initialized and cached.");
        return cachedAuthClient;
    } catch (e) {
        console.error("Failed to initialize Google Auth:", e);
        return null;
    }
}

// Check configuration status
app.get('/api/config', async (req, res) => {
    // Attempt load
    const auth = await getAuth();
    if (auth) {
        res.json({ configured: true, message: "Connected to backend using Service Account." });
    } else {
        res.json({ configured: false, message: "Service Account not configured. Please add service-account.json." });
    }
});

// Serve frontend config
app.get('/api/config/client', (req, res) => {
    res.json({
        spreadsheetId: process.env.SPREADSHEET_ID || '1fsTazqEiGvN9RSnD3d7F38COFyu_Bw2vEJyyH5fakI8'
    });
});

// Read Google Sheets
app.get('/api/sheets/read', async (req, res) => {
    const { spreadsheetId, range } = req.query;
    if (!spreadsheetId || !range) return res.status(400).json({ error: "Missing spreadsheetId or range" });

    try {
        const auth = await getAuth();
        if (!auth) throw new Error("Google authentication failed");
        
        const sheets = google.sheets({ version: 'v4', auth });
        try {
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range,
            });
            res.json({ values: response.data.values || [] });
        } catch (getError) {
            if (getError.message && getError.message.includes('Unable to parse range')) {
                const tabName = range.split('!')[0].replace(/'/g, ''); // Strip quotes if any
                await sheets.spreadsheets.batchUpdate({
                    spreadsheetId,
                    requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] }
                });
                
                if (tabName === 'Branding Data') {
                    await sheets.spreadsheets.values.append({
                        spreadsheetId,
                        range: `${tabName}!A1`,
                        valueInputOption: 'USER_ENTERED',
                        requestBody: { values: [['Date', 'Rider Name', 'Rider ID', 'Vehicle Reg', 'Back Photo', 'Rear Photo', 'Opposite Photo', 'Front Photo']] }
                    });
                }
                
                const retryResponse = await sheets.spreadsheets.values.get({ spreadsheetId, range });
                return res.json({ values: retryResponse.data.values || [] });
            }
            throw getError;
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// Append to Google Sheets
app.post('/api/sheets/append', async (req, res) => {
    const { spreadsheetId, range, values } = req.body;
    if (!spreadsheetId || !range || !values) return res.status(400).json({ error: "Missing required fields" });

    try {
        // Also save to MongoDB if it's branding data
        const tabName = range.split('!')[0].replace(/'/g, '');
        if (tabName === 'Branding Data' && values.length >= 8) {
            try {
                // Mapping sheets structure: ['John Doe', 'ZYPP-123', 'DL-1C-1234', 'photo1', 'photo2', 'photo3', 'photo4', '26/05/2026']
                // Wait, in test_append_branding.js, the order is:
                // values: ['John Doe', 'ZYPP-123', 'DL-1C-1234', 'photo1', 'photo2', 'photo3', 'photo4', '26/05/2026']
                // Wait, let's map them safely based on position or values count
                const brandingEntry = new BrandingData({
                    riderName: values[0],
                    riderId: values[1],
                    vehicleReg: values[2],
                    backPhoto: values[3],
                    rearPhoto: values[4],
                    oppositePhoto: values[5],
                    frontPhoto: values[6],
                    date: values[7] || new Date().toLocaleDateString('en-GB')
                });
                await brandingEntry.save();
                console.log('Saved branding data to MongoDB.');
            } catch (dbErr) {
                console.error('Failed to save to MongoDB:', dbErr);
            }
        }

        const auth = await getAuth();
        let sheetsSaved = false;
        let sheetsErrorMsg = null;
        if (auth) {
            const sheets = google.sheets({ version: 'v4', auth });
            try {
                await sheets.spreadsheets.values.append({
                    spreadsheetId,
                    range,
                    valueInputOption: 'USER_ENTERED',
                    insertDataOption: 'INSERT_ROWS',
                    requestBody: { values: [values] }
                });
                sheetsSaved = true;
            } catch (appendError) {
                if (appendError.message && appendError.message.includes('Unable to parse range')) {
                    try {
                        await sheets.spreadsheets.batchUpdate({
                            spreadsheetId,
                            requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] }
                        });
                        
                        if (tabName === 'Branding Data') {
                            await sheets.spreadsheets.values.append({
                                spreadsheetId,
                                range: `${tabName}!A1`,
                                valueInputOption: 'USER_ENTERED',
                                requestBody: { values: [['Date', 'Rider Name', 'Rider ID', 'Vehicle Reg', 'Back Photo', 'Rear Photo', 'Opposite Photo', 'Front Photo']] }
                            });
                        }
                        
                        await sheets.spreadsheets.values.append({
                            spreadsheetId,
                            range,
                            valueInputOption: 'USER_ENTERED',
                            insertDataOption: 'INSERT_ROWS',
                            requestBody: { values: [values] }
                        });
                        sheetsSaved = true;
                    } catch (retryErr) {
                        sheetsErrorMsg = retryErr.message;
                    }
                } else {
                    sheetsErrorMsg = appendError.message;
                }
            }
        } else {
            sheetsErrorMsg = "Google authentication failed";
        }

        // Respond with success if either was saved (MongoDB is reliable local store)
        res.json({ 
            success: true, 
            mongodb: true, 
            googleSheets: sheetsSaved,
            sheetsError: sheetsErrorMsg
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// Update Google Sheets cell
app.post('/api/sheets/update', async (req, res) => {
    const { spreadsheetId, range, value } = req.body;
    if (!spreadsheetId || !range || value === undefined) return res.status(400).json({ error: "Missing required fields" });

    try {
        const auth = await getAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[value]] }
        });
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// Proxy endpoint for heatmap data to bypass CORS
app.get('/api/tracker/riders_map', async (req, res) => {
    const { city, start_date, end_date } = req.query;
    if (!city) return res.status(400).json({ error: "Missing city query parameter" });

    // Fallback to fetch module if global fetch is not defined in node environment
    const fetch = require('node-fetch');
    const url = `https://data.bcykal.com/tracker/riders_map?city=${encodeURIComponent(city)}&start_date=${start_date || ''}&end_date=${end_date || ''}`;

    try {
        const apiRes = await fetch(url);
        if (!apiRes.ok) {
            const errText = await apiRes.text();
            throw new Error(`External API returned ${apiRes.status}: ${errText}`);
        }
        const data = await apiRes.json();
        res.json(data);
    } catch (err) {
        console.error("Heatmap proxy error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
}

module.exports = app;
// Deployment trigger: Wed Apr 22 13:17:33 IST 2026
// Deployment heartbeat: Wed Apr 22 13:37:28 IST 2026
