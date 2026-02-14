
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

// Construct 'require' and '__dirname' for ES Module environment
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fs = require('fs');

// Check for dependencies
let express, cors, bodyParser, multer;
try {
    express = require('express');
    cors = require('cors');
    bodyParser = require('body-parser');
    multer = require('multer');
} catch (e) {
    console.error('\n\x1b[31m%s\x1b[0m', '--------------------------------------------------');
    console.error('\x1b[31m%s\x1b[0m', 'ERROR: Missing backend dependencies.');
    console.error('\x1b[33m%s\x1b[0m', 'Please run the following commands to fix:');
    console.error('\n    cd backend');
    console.error('    npm install');
    console.error('\n\x1b[31m%s\x1b[0m', '--------------------------------------------------\n');
    process.exit(1);
}

const app = express();
const PORT = 3001; 
const HOST = '0.0.0.0'; // Allow external access across the network

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

// Paths relative to backend/ directory
const DATA_DIR = path.join(__dirname, 'server-data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

// Ensure data dirs exist
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Static serve for uploads
app.use('/uploads', express.static(UPLOADS_DIR));

// Serve Angular App Static Files
// User requested to serve from project root (C:\xampp\htdocs\lexus\new angular lexus)
const PROJECT_ROOT = path.join(__dirname, '../');

console.log('Serving app from root:', PROJECT_ROOT);
app.use(express.static(PROJECT_ROOT));

// Database Files
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
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
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
    // Return relative path. 
    const fileUrl = `/uploads/${req.file.filename}`;
    
    res.json({ id: req.file.filename, url: fileUrl });
});

// Fallback for SPA routing
app.get('*', (req, res) => {
    let indexHtml = path.join(PROJECT_ROOT, 'index.html');
    
    if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
    } else {
        res.status(404).send('index.html not found in project root.');
    }
});

app.listen(PORT, HOST, () => {
    console.log(`--------------------------------------------------`);
    console.log(`Lexus Experience Server (Backend)`);
    console.log(`Running at http://${HOST}:${PORT}`);
    console.log(`API Endpoint: http://${HOST}:${PORT}/api`);
    console.log(`Serving App from: ${PROJECT_ROOT}`);
    console.log(`--------------------------------------------------`);
});
