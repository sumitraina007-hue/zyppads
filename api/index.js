const express = require('express');
const cors = require('cors');
const path = require('path');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3002; // Using 3002 to avoid conflict with existing Python process on 3001

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Configure standard Google APIs Auth Client
async function getAuth() {
    try {
        let authConfig = {
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        };

        // Support for Vercel Environment Variable (JSON String)
        if (process.env.GOOGLE_SERVICE_ACCOUNT) {
            try {
                authConfig.credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
                console.log("Using credentials from GOOGLE_SERVICE_ACCOUNT env var.");
            } catch (e) {
                console.error("Failed to parse GOOGLE_SERVICE_ACCOUNT env var:", e);
            }
        } else {
            // Fallback to local file
            authConfig.keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, '../service-account.json');
        }

        const auth = new google.auth.GoogleAuth(authConfig);
        return await auth.getClient();
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
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range,
        });
        
        res.json({ values: response.data.values || [] });
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
        const auth = await getAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            requestBody: { values: [values] }
        });
        res.json({ success: true });
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

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
}

module.exports = app;
