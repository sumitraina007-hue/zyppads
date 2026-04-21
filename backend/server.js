const express = require('express');
const cors = require('cors');
const path = require('path');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3002; // Using 3002 to avoid conflict with existing Python process on 3001

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend/public')));

// Configure standard Google APIs Auth Client
async function getAuth() {
    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, '../service-account.json'),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
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

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
