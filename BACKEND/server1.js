// warden-server.js
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// MySQL connection
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'hms'
});

db.connect((err) => {
  if (err) {
    console.error('Error connecting to MySQL:', err);
    return;
  }
  console.log('Connected to MySQL');
});

// Create warden_register table if it doesn't exist
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

// Register API
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

const PORT = process.env.PORT || 8081;
app.listen(PORT, () => {
  console.log(`Warden server running on port ${PORT}`);
});
