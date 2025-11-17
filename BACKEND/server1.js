// warden-server.js (deployed on Render)
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const app = express();

app.use(cors({
  origin: 'https://hostel-management-system-2-2x8y.onrender.com'
}));
app.use(express.json());

const db = mysql.createConnection({
  host: process.env.DB_HOST || "gateway01.ap-southeast-1.prod.aws.tidbcloud.com",
  user: process.env.DB_USER || "3TQjs6TX5oYMWB1.root",
  password: process.env.DB_PASSWORD || "kZ8u1pLv4HQLMmDS",
  database: process.env.DB_NAME || "hms",
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 4000,
  ssl: { rejectUnauthorized: false }
});

db.connect((err) => {
  if (err) {
    console.error("❌ Database connection failed:", err && (err.stack || err.message || err));
  } else {
    console.log("✅ Connected to MySQL successfully!");
  }
});

const createTableQuery = `
  CREATE TABLE IF NOT EXISTS warden_register (
    id INT AUTO_INCREMENT PRIMARY KEY,
    fullname VARCHAR(255),
    username VARCHAR(100) UNIQUE,
    email VARCHAR(255),
    contact VARCHAR(20),
    password VARCHAR(255),
    status VARCHAR(20) DEFAULT 'pending'
  )
`;

db.query(createTableQuery, (err) => {
  if (err) console.error('Table creation failed:', err);
  else console.log('warden_register table ready');
});

// Register Warden
app.post('/warden/register', (req, res) => {
  const { fullname, username, email, contact, password } = req.body;

  const checkQuery = 'SELECT * FROM warden_register WHERE username = ?';
  db.query(checkQuery, [username], (err, results) => {
    if (err) return res.status(500).json({ message: 'Error checking existing user.' });
    if (results.length > 0) return res.status(400).json({ message: 'Username already exists.' });

    const insertQuery = 'INSERT INTO warden_register (fullname, username, email, contact, password) VALUES (?, ?, ?, ?, ?)';
    db.query(insertQuery, [fullname, username, email, contact, password], (err) => {
      if (err) return res.status(500).json({ message: 'Error registering warden.' });
      res.status(201).json({ message: 'Warden registered successfully.' });
    });
  });
});

// List all wardens
app.get('/warden/list', (req, res) => {
  db.query('SELECT * FROM warden_register', (err, results) => {
    if (err) return res.status(500).json({ message: 'Error fetching wardens.' });
    res.json(results);
  });
});

// Approve Warden
app.post('/warden/approve', (req, res) => {
  const { id } = req.body;
  db.query('UPDATE warden_register SET status = "approved" WHERE id = ?', [id], (err) => {
    if (err) return res.status(500).json({ message: 'Approval failed.' });
    res.json({ message: 'Warden approved.' });
  });
});

// Reject Warden
app.post('/warden/reject', (req, res) => {
  const { id } = req.body;
  db.query('UPDATE warden_register SET status = "rejected" WHERE id = ?', [id], (err) => {
    if (err) return res.status(500).json({ message: 'Rejection failed.' });
    res.json({ message: 'Warden rejected.' });
  });
});

// Delete Warden
app.delete('/warden/delete/:id', (req, res) => {
  const id = req.params.id;
  db.query('DELETE FROM warden_register WHERE id = ?', [id], (err) => {
    if (err) return res.status(500).json({ message: 'Deletion failed.' });
    res.json({ message: 'Warden deleted successfully.' });
  });
});

// Login
app.post('/warden/login', (req, res) => {
  const { username, password } = req.body;
  const query = 'SELECT * FROM warden_register WHERE username = ? AND password = ?';
  db.query(query, [username, password], (err, results) => {
    if (err) return res.status(500).json({ message: 'Login error.' });
    if (results.length === 0) return res.status(401).json({ message: 'Invalid credentials.' });
    if (results[0].status !== 'approved') return res.status(403).json({ message: 'Not approved by admin.' });
    res.json({ message: 'Login successful.', user: results[0] });
  });
});

const PORT = process.env.PORT || 8081;
app.listen(PORT, () => {
  console.log(`Warden server running on port ${PORT}`);
});
