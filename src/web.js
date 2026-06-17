const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const chalk = require('chalk');
const {
  initClient,
  run,
  loadContacts,
  generateReport,
  getClient,
  isSending,
  cancelSend,
  clearProgress,
} = require('./index');
const config = require('../config');

// ─────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname),
});
const upload = multer({ storage });

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────
// API routes
// ─────────────────────────────────────────────

// Upload Excel file
app.post('/api/upload-excel', upload.single('excel'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  res.json({ filePath: req.file.path, filename: req.file.originalname });
});

// Upload attachment (image/PDF)
app.post('/api/upload-attachment', upload.single('attachment'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  res.json({ filePath: req.file.path, filename: req.file.originalname });
});

// Get contacts preview from uploaded Excel
app.post('/api/preview-contacts', upload.single('excel'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  try {
    const contacts = loadContacts(req.file.path);
    res.json({ contacts: contacts.slice(0, 20), total: contacts.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Download report
app.get('/api/download-report', (req, res) => {
  const reportPath = req.query.path;
  if (!reportPath || !fs.existsSync(reportPath)) {
    return res.status(404).json({ error: 'Report not found' });
  }
  res.download(reportPath);
});

// Download sample Excel
app.get('/api/sample-excel', (req, res) => {
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Phone Number', 'Name', 'Country Code'],
    ['9876543210', 'John Doe', '91'],
    ['9876543211', 'Jane Smith', '91'],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Contacts');
  const tmpPath = path.join(uploadsDir, 'sample-contacts.xlsx');
  XLSX.writeFile(wb, tmpPath);
  res.download(tmpPath);
});

// ─────────────────────────────────────────────
// Socket.IO
// ─────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(chalk.green(`Web client connected: ${socket.id}`));

  socket.emit('status', { type: 'info', message: 'Connected to server.' });

  // ─── Start WhatsApp client ───
  socket.on('start-client', async () => {
    try {
      const existing = getClient();
      if (existing && existing.info) {
        socket.emit('status', { type: 'info', message: 'WhatsApp client already connected.' });
        socket.emit('client-ready', { pushname: existing.info.pushname || 'WhatsApp User' });
        return;
      }

      socket.emit('status', { type: 'info', message: 'Initializing WhatsApp client...' });

      await initClient(
        // QR callback
        (qr) => {
          socket.emit('qr', { qr });
          socket.emit('status', { type: 'qr', message: 'Scan QR code with WhatsApp.' });
        },
        // Ready callback
        (client, disconnectReason) => {
          if (disconnectReason) {
            socket.emit('status', { type: 'error', message: `Disconnected: ${disconnectReason}` });
            socket.emit('client-disconnected');
            return;
          }
          socket.emit('status', { type: 'info', message: 'WhatsApp client ready!' });
          socket.emit('client-ready', { pushname: client.info.pushname || 'WhatsApp User' });
        }
      );
    } catch (err) {
      socket.emit('status', { type: 'error', message: `Failed to init client: ${err.message}` });
    }
  });

  // ─── Start sending ───
  socket.on('start-send', async (data) => {
    if (isSending()) {
      socket.emit('status', { type: 'error', message: 'Already sending messages.' });
      return;
    }

    // Build config overrides from web form
    const overrides = {};
    if (data.messageTemplate) overrides.messageTemplate = data.messageTemplate;
    if (data.attachmentPath) overrides.attachmentPath = data.attachmentPath;
    if (data.excelFilePath) overrides.excelFilePath = data.excelFilePath;
    if (data.dailyLimit) overrides.dailyLimit = parseInt(data.dailyLimit, 10);
    if (data.delayMin) overrides.delayMin = parseInt(data.delayMin, 10);
    if (data.delayMax) overrides.delayMax = parseInt(data.delayMax, 10);

    try {
      await run(overrides, (status) => {
        socket.emit('status', status);
      });
    } catch (err) {
      socket.emit('status', { type: 'error', message: err.message });
    }
  });

  // ─── Cancel sending ───
  socket.on('cancel-send', () => {
    cancelSend();
    socket.emit('status', { type: 'info', message: 'Cancelling...' });
  });

  // ─── Check status ───
  socket.on('check-status', () => {
    socket.emit('status', {
      type: 'info',
      message: isSending() ? 'Sending in progress...' : 'Idle.',
      sending: isSending(),
    });
  });

  socket.on('disconnect', () => {
    console.log(chalk.yellow(`Web client disconnected: ${socket.id}`));
  });
});

// ─────────────────────────────────────────────
// Web UI HTML
// ─────────────────────────────────────────────
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// ─────────────────────────────────────────────
// Start server
// ─────────────────────────────────────────────
const PORT = config.webPort || 3000;
server.listen(PORT, () => {
  console.log(chalk.bold.cyan(`\n🌐 Web UI: http://localhost:${PORT}`));
  console.log(chalk.cyan('Open this URL in your browser to use the web interface.\n'));
});
