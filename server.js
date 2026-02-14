
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3001; 

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

// Static serve for uploads
const UPLOADS_DIR = path.join(__dirname, 'server-data', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
app.use('/uploads', express.static(UPLOADS_DIR));

// Database Files
const DATA_DIR = path.join(__dirname, 'server-data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const CARS_FILE = path.join(DATA_DIR, 'cars.json');

// --- Helpers ---
function readJSON(file, defaultData) {
    if (!fs.existsSync(file)) return defaultData;
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        return defaultData;
    }
}

function writeJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// --- Routes ---

// 1. Settings
app.get('/api/settings', (req, res) => {
    const data = readJSON(SETTINGS_FILE, {});
    res.json(data);
});

app.post('/api/settings', (req, res) => {
    writeJSON(SETTINGS_FILE, req.body);
    res.json({ success: true });
});

// 2. Cars
app.get('/api/cars', (req, res) => {
    const data = readJSON(CARS_FILE, []);
    res.json(data);
});

// Update specific car or add if new
app.put('/api/cars/:id', (req, res) => {
    const carId = req.params.id;
    let cars = readJSON(CARS_FILE, []);
    const index = cars.findIndex(c => c.id === carId);
    
    if (index >= 0) {
        cars[index] = req.body;
    } else {
        cars.push(req.body);
    }
    
    writeJSON(CARS_FILE, cars);
    res.json({ success: true });
});

// 3. Uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + ext);
    }
});
const upload = multer({ storage: storage });

app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    // Return relative path. The frontend proxy will handle the rest.
    // e.g., "/uploads/my-image.jpg"
    const fileUrl = `/uploads/${req.file.filename}`;
    
    res.json({ id: req.file.filename, url: fileUrl });
});

app.listen(PORT, () => {
    console.log(`--------------------------------------------------`);
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`API Endpoint: http://localhost:${PORT}/api`);
    console.log(`File Storage: ${DATA_DIR}`);
    console.log(`--------------------------------------------------`);
});
