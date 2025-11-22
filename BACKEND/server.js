

// server.js
console.log('=== STARTUP DEBUG ===');
console.log('NODE_VERSION', process.version);
console.log('CWD', process.cwd());
console.log('ENV PORT:', !!process.env.PORT, ' BREVO:', !!process.env.BREVO_API_KEY, ' DB_HOST:', !!process.env.DB_HOST);
console.log('Memory (rss heapTotal heapUsed):', process.memoryUsage && JSON.stringify(process.memoryUsage()));

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err && (err.stack || err));
});
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason && (reason.stack || reason));
});
process.on('SIGTERM', () => {
  console.error('SIGTERM received — platform requested shutdown');
});
///// === end debug bootstrap ====

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mysql = require("mysql2");
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
dotenv.config();

//
// Fetch compatibility: use global.fetch on Node 18+, otherwise try node-fetch
//
let fetchFn;
if (typeof global.fetch === 'function') {
  fetchFn = global.fetch;
} else {
  try {
    // node-fetch v3 is ESM; require('node-fetch') in CommonJS returns a function when installed as v2 or using this interop.
    fetchFn = require('node-fetch');
  } catch (e) {
    console.warn('node-fetch not found and global.fetch not available. If Node <18, install node-fetch: npm i node-fetch');
    fetchFn = null;
  }
}

const app = express();

// ---------- BREVO CONFIG ----------
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || process.env.SENDER_EMAIL || 'no-reply@yourdomain.com';

if (!BREVO_API_KEY) {
  console.warn('⚠️ BREVO_API_KEY is not set. Set BREVO_API_KEY in environment variables.');
}
if (!FROM_EMAIL) {
  console.warn('⚠️ FROM_EMAIL is not set. Set FROM_EMAIL in environment variables.');
}

// ---------- CORS ----------
const allowedOrigins = [
  "https://hostel-management-system-1-3c10.onrender.com",
  "https://hostel-management-system-2-2x8y.onrender.com",
  // add more allowed origins if needed
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn("❌ Blocked CORS for origin:", origin);
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  credentials: true,
};

app.use(cors(corsOptions));
app.use(bodyParser.json());

// ---------- DATABASE CONFIG ----------
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

// Serve static frontend files if available
const FRONTEND_DIR = path.join(__dirname, 'FRONTEND');
if (fs.existsSync(FRONTEND_DIR)) {
  app.use(express.static(FRONTEND_DIR));
  console.log('✅ Serving static frontend from', FRONTEND_DIR);
}

// ------------------------------------------------------------------
// Brevo send function
// ------------------------------------------------------------------
async function sendOTPEmailBrevo(email, otp) {
  if (!BREVO_API_KEY) {
    console.error('❌ BREVO_API_KEY missing from env');
    return { success: false, message: 'BREVO_API_KEY not configured' };
  }
  if (!fetchFn) {
    console.error('❌ No fetch available (install node-fetch or run on Node 18+)');
    return { success: false, message: 'fetch not available on this runtime' };
  }

  const payload = {
    sender: { name: "Hostel Management", email: FROM_EMAIL },
    to: [{ email }],
    subject: "Hostel Management OTP Verification",
    htmlContent: `
       <div style="font-family: Arial, sans-serif; line-height:1.4;">
         <p>Your verification OTP is:</p>
         <h2 style="letter-spacing:4px;">${otp}</h2>
         <p style="color:#666; font-size:0.9rem;">This OTP will expire in 5 minutes.</p>
       </div>
     `
  };

  try {
    const res = await fetchFn('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': BREVO_API_KEY
      },
      body: JSON.stringify(payload)
    });

    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }

    if (!res.ok) {
      console.error('❌ Brevo send failed:', res.status, data);
      return { success: false, status: res.status, info: data };
    }

    console.log(`✅ OTP email queued via Brevo (status ${res.status}) for ${email}`, data);
    return { success: true, status: res.status, info: data };
  } catch (err) {
    console.error('❌ sendOTPEmailBrevo error:', err && (err.stack || err.message || err));
    return { success: false, message: err && (err.message || String(err)) };
  }
}

// ------------------------------------------------------------------
// Database initialization (kept as in your file)
// ------------------------------------------------------------------

// Ensure complaints table exists
const createComplaintsTable = `
   CREATE TABLE IF NOT EXISTS complaints (
       id INT AUTO_INCREMENT PRIMARY KEY,
       subject VARCHAR(255) NOT NULL,
       description TEXT NOT NULL,
       category VARCHAR(100) NOT NULL,
       location VARCHAR(255) NOT NULL,
       username VARCHAR(100) NOT NULL,
       status VARCHAR(50) DEFAULT 'New',
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       INDEX idx_status (status),
       INDEX idx_username (username)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;
db.query(createComplaintsTable, (cErr) => {
  if (cErr) console.error('Could not ensure complaints table exists:', cErr);
  else console.log('✅ Complaints table is ready');
});

// Ensure payment_status table exists
const createPaymentTable = `
   CREATE TABLE IF NOT EXISTS payment_status (
       username VARCHAR(100) PRIMARY KEY,
       status VARCHAR(20) DEFAULT 'Pending',
       updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;
db.query(createPaymentTable, (pErr) => {
  if (pErr) console.error('Could not ensure payment_status table exists:', pErr);
  else console.log('✅ Payment status table is ready');
});

// Ensure notifications table exists
const createNotificationsTable = `
   CREATE TABLE IF NOT EXISTS notifications (
       id INT AUTO_INCREMENT PRIMARY KEY,
       username VARCHAR(100),
       subject VARCHAR(255),
       message TEXT,
       desired_room VARCHAR(50),
       is_read TINYINT(1) DEFAULT 0,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;
db.query(createNotificationsTable, (nErr) => { if (nErr) console.error('createNotificationsTable error', nErr); else console.log('✅ Notifications table ready'); });

// Ensure registered_at column exists in register table (best-effort)
const alterRegisterTable = `
   ALTER TABLE register 
   ADD COLUMN registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
`;
db.query(alterRegisterTable, (aErr) => {
  if (aErr && aErr.code !== 'ER_DUP_FIELDNAME' && aErr.code !== 'ER_DUP_FIELDNAME' && aErr.errno !== 1060) {
    // ignore duplicate column errors, warn only for other errors
    console.warn('Could not ensure registered_at column exists in register table:', aErr && (aErr.message || aErr));
  } else {
    console.log('✅ Register table structure checked/updated for registered_at (or already present).');
  }
});

// Ensure visitor_logs table exists
const createVisitorLogsTable = `
   CREATE TABLE IF NOT EXISTS visitor_logs (
       id INT AUTO_INCREMENT PRIMARY KEY,
       username VARCHAR(100) NOT NULL,
       login_time DATETIME DEFAULT CURRENT_TIMESTAMP,
       ip_address VARCHAR(45),
       status VARCHAR(20) DEFAULT 'Success',
       INDEX idx_username_time (username, login_time)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;
db.query(createVisitorLogsTable, (vErr) => {
  if (vErr) console.error('Could not ensure visitor_logs table exists:', vErr);
  else console.log('✅ Visitor logs table is ready');
});

const createWardenTable = `
  CREATE TABLE IF NOT EXISTS warden (
    id INT AUTO_INCREMENT PRIMARY KEY,
    fullname VARCHAR(100),
    username VARCHAR(100) UNIQUE,
    email VARCHAR(150) UNIQUE,
    contact VARCHAR(15),
    password VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

db.query(createWardenTable, (err) => {
  if (err) console.error("❌ Warden table create error", err);
  else console.log("✅ Warden table ready");
});

// ===========================
// JOB APPLICATIONS TABLE
// ===========================
const createJobApplicationsTable = `
CREATE TABLE IF NOT EXISTS job_applications (
    application_id INT AUTO_INCREMENT PRIMARY KEY,
    warden_username VARCHAR(50) NOT NULL,
    fullname VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL,
    contact VARCHAR(15) NOT NULL,
    job_role VARCHAR(50) NOT NULL,
    shift VARCHAR(20) NOT NULL,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

db.query(createJobApplicationsTable, (err) => {
  if (err) console.error("❌ JOB_APPLICATIONS create error", err);
  else console.log("✅ JOB_APPLICATIONS table ready");
});


// Ensure payment_requests table exists
const createPaymentRequestsTable = `
   CREATE TABLE IF NOT EXISTS payment_requests (
       id INT AUTO_INCREMENT PRIMARY KEY,
       username VARCHAR(100) NOT NULL,
       amount DECIMAL(10,2) NOT NULL,
       card_last4 VARCHAR(4),
       status VARCHAR(20) DEFAULT 'Pending',
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       INDEX idx_username (username),
       INDEX idx_status (status)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;
db.query(createPaymentRequestsTable, (prErr) => {
  if (prErr) console.error('Could not ensure payment_requests table exists:', prErr);
  else console.log('✅ payment_requests table ready');
});

// ------------------------------------------------------------------
// PAYMENT STATUS & REQUESTS endpoints (kept as-is)
// ------------------------------------------------------------------

// PAYMENT STATUS
app.post('/payment-status', (req, res) => {
  const { username, status } = req.body;
  if (!username || !status) return res.status(400).json({ error: 'Missing username or status' });
  db.query('REPLACE INTO payment_status (username, status) VALUES (?, ?)', [username, status], (err) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json({ message: 'Payment status updated' });
  });
});

app.get('/payment-status/:username', (req, res) => {
  const { username } = req.params;
  db.query('SELECT status FROM payment_status WHERE username = ?', [username], (err, results) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (results.length === 0) return res.json({ status: 'Pending' });
    res.json({ status: results[0].status });
  });
});

// Payment requests
app.post('/payment-request', (req, res) => {
  const { username, amount, card_last4 } = req.body;
  if (!username || !amount) return res.status(400).json({ message: 'username and amount required' });

  db.query('SELECT status FROM payment_status WHERE username = ?', [username], (psErr, psResults) => {
    if (psErr) {
      console.error('Error checking payment_status before creating request:', psErr);
      return res.status(500).json({ message: 'DB error' });
    }

    if (psResults && psResults.length > 0 && psResults[0].status === 'Paid') {
      return res.status(400).json({ message: 'Payment already completed for this user' });
    }

    const sql = 'INSERT INTO payment_requests (username, amount, card_last4) VALUES (?, ?, ?)';
    db.query(sql, [username, amount, card_last4 || null], (err, result) => {
      if (err) {
        console.error('Error creating payment request:', err);
        return res.status(500).json({ message: 'DB error' });
      }
      return res.status(201).json({ id: result.insertId, message: 'Payment request submitted' });
    });
  });
});

app.get('/payment-requests', (req, res) => {
  const status = req.query.status; // optional
  let sql = 'SELECT id, username, amount, card_last4, status, created_at FROM payment_requests';
  const params = [];
  if (status) {
    sql += ' WHERE status = ?';
    params.push(status);
  }
  sql += ' ORDER BY created_at DESC';

  db.query(sql, params, (err, results) => {
    if (err) {
      console.error('Error fetching payment requests:', err);
      return res.status(500).json({ message: 'DB error' });
    }
    res.json(results || []);
  });
});

app.patch('/payment-requests/:id/approve', (req, res) => {
  const id = req.params.id;
  db.query('SELECT username FROM payment_requests WHERE id = ?', [id], (err, results) => {
    if (err) return res.status(500).json({ message: 'DB error' });
    if (results.length === 0) return res.status(404).json({ message: 'Request not found' });
    const username = results[0].username;

    db.query('UPDATE payment_requests SET status = ? WHERE id = ?', ['Approved', id], (uErr) => {
      if (uErr) return res.status(500).json({ message: 'DB error' });
      db.query('REPLACE INTO payment_status (username, status) VALUES (?, ?)', [username, 'Paid'], (pErr) => {
        if (pErr) console.error('Error updating payment_status after approval:', pErr);
        return res.json({ message: 'Payment request approved and user marked Paid' });
      });
    });
  });
});

app.patch('/payment-requests/:id/reject', (req, res) => {
  const id = req.params.id;
  db.query('SELECT username FROM payment_requests WHERE id = ?', [id], (err, results) => {
    if (err) return res.status(500).json({ message: 'DB error' });
    if (results.length === 0) return res.status(404).json({ message: 'Request not found' });
    const username = results[0].username;

    db.query('UPDATE payment_requests SET status = ? WHERE id = ?', ['Rejected', id], (uErr) => {
      if (uErr) return res.status(500).json({ message: 'DB error' });
      db.query('REPLACE INTO payment_status (username, status) VALUES (?, ?)', [username, 'Pending'], (pErr) => {
        if (pErr) console.error('Error updating payment_status after rejection:', pErr);
        return res.json({ message: 'Payment request rejected' });
      });
    });
  });
});

// rooms gender status (kept)
app.get("/all-rooms-gender-status", (req, res) => {
  const sql = `
       SELECT rm.room_no, r.gender
       FROM rooms rm
       JOIN register r ON r.username = rm.username
       WHERE rm.username IS NOT NULL
       ORDER BY rm.room_no, rm.bed_no
   `;

  db.query(sql, (err, results) => {
    if (err) {
      console.error('❌ /all-rooms-gender-status DB error:', err);
      return res.status(500).json({ message: 'DB error', error: err.message });
    }

    const genderMap = results.reduce((acc, row) => {
      if (row && row.room_no && row.gender && !acc[row.room_no]) {
        acc[row.room_no] = row.gender;
      }
      return acc;
    }, {});

    res.json(genderMap);
  });
});

// ============================
// WARDEN REGISTRATION
// ============================
app.post("/warden/register", (req, res) => {
  const { fullname, username, email, contact, password } = req.body;

  if (!fullname || !username || !email || !contact || !password) {
    return res.status(400).json({ message: "All fields are required" });
  }

  // username duplicate check
  const checkSql = "SELECT 1 FROM warden WHERE username = ? OR email = ?";
  db.query(checkSql, [username, email], (err, rows) => {
    if (err) return res.status(500).json({ message: "DB error" });

    if (rows.length > 0) {
      return res.status(409).json({ message: "Username or Email already exists" });
    }

    const insertSql = `
      INSERT INTO warden (fullname, username, email, contact, password, created_at)
      VALUES (?, ?, ?, ?, ?, NOW())
    `;

    db.query(insertSql, [fullname, username, email, contact, password], (err2) => {
      if (err2) return res.status(500).json({ message: "DB Insert error" });

      return res.json({ message: "Warden account created successfully" });
    });
  });
});



// ------------------------------------------------------------------
// AUTHENTICATION & REGISTRATION ENDPOINTS
// ------------------------------------------------------------------

// SEND OTP (updated to use Brevo)
// Note: This logic mirrors your previous flow (username uniqueness checks) but uses Brevo transmitter.
app.post("/send-otp", async (req, res) => {
  const { email, username } = req.body;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    return res.status(400).json({ message: "❌ Please enter a valid email address format." });
  }

  // internal helper to process OTP generation + DB store + sending
  async function processOTP() {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 5 * 60000); // 5 min

    const insertUpdateOtpSql = `
           INSERT INTO register (email, otp, otp_expires_at)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE otp = VALUES(otp), otp_expires_at = VALUES(otp_expires_at)
       `;

    await new Promise((resolve, reject) => {
      db.query(insertUpdateOtpSql, [email, otp, otpExpires], (err) => {
        if (err) {
          console.error("❌ DB Error during OTP storage:", err);
          return reject("Database error during OTP storage. Try a different email.");
        }
        resolve();
      });
    });

    // send via Brevo
    const sendResult = await sendOTPEmailBrevo(email, otp);
    if (!sendResult.success) {
      console.error('❌ Brevo sendResult:', sendResult);
      return { ok: false, message: sendResult.message || sendResult.info || 'Failed to send OTP' };
    }

    return { ok: true, message: 'OTP sent' };
  }

  // If username present => registration flow (check uniqueness)
  if (username && username.trim() !== '') {
    const checkUsernameSql = "SELECT 1 FROM register WHERE username = ?";
    db.query(checkUsernameSql, [username], (err, usernameResults) => {
      if (err) {
        console.error("❌ DB Error during username uniqueness check:", err);
        return res.status(500).json({ message: "Database error. Please try again." });
      }
      if (usernameResults.length > 0) {
        return res.status(409).json({ message: "❌ This username is already taken. Please choose another." });
      }

      const checkRegisteredSql = "SELECT username FROM register WHERE email = ? AND username IS NOT NULL";
      db.query(checkRegisteredSql, [email], async (err2, results) => {
        if (err2) {
          console.error("❌ DB Error during registered user check:", err2);
          return res.status(500).json({ message: "Database error. Please try again." });
        }
        if (results.length > 0) {
          return res.status(409).json({ message: "❌ This email is already registered. Please login instead." });
        }

        // process OTP
        try {
          const out = await processOTP();
          if (!out.ok) return res.status(500).json({ message: out.message });
          return res.status(200).json({ message: "OTP sent successfully" });
        } catch (e) {
          console.error('❌ processOTP error', e);
          return res.status(500).json({ message: e || 'Server error' });
        }
      });
    });
    return;
  }

  // Otherwise: login / existing user OTP flow (ensure not already registered)
  const checkRegisteredSql = "SELECT username FROM register WHERE email = ? AND username IS NOT NULL";
  db.query(checkRegisteredSql, [email], async (err, results) => {
    if (err) {
      console.error("❌ DB Error during registered user check:", err);
      return res.status(500).json({ message: "Database error. Please try again." });
    }
    if (results.length > 0) {
      return res.status(409).json({ message: "❌ This email is already registered. Please login instead." });
    }

    // process OTP
    try {
      const out = await processOTP();
      if (!out.ok) return res.status(500).json({ message: out.message });
      return res.status(200).json({ message: "OTP sent successfully" });
    } catch (e) {
      console.error('❌ processOTP error', e);
      return res.status(500).json({ message: e || 'Server error' });
    }
  });
});

// Register endpoint (verifies OTP and finalizes registration)
app.post("/register", (req, res) => {
  const { username, password, gender, email, contact, otp } = req.body;

  if (!email || !password || !otp) return res.status(400).json({ message: "email, password and otp required" });

  const verifySql = "SELECT * FROM register WHERE email = ? AND otp = ? AND otp_expires_at > NOW()";
  db.query(verifySql, [email, otp], (err, results) => {
    if (err) {
      console.error("❌ DB Error during OTP verification:", err);
      return res.status(500).json({ message: "Database error" });
    }
    if (results.length === 0) {
      const checkUserSql = "SELECT 1 FROM register WHERE email = ?";
      db.query(checkUserSql, [email], (err2, userCheck) => {
        if (userCheck && userCheck.length > 0) {
          return res.status(401).json({ message: "❌ Invalid or Expired OTP. Please resend." });
        } else {
          return res.status(400).json({ message: "❌ Invalid OTP/Email combination." });
        }
      });
      return;
    }

    // check username uniqueness across other accounts
    const checkUsernameSql = "SELECT 1 FROM register WHERE username = ? AND email != ?";
    db.query(checkUsernameSql, [username, email], (err3, userCheck) => {
      if (err3) {
        console.error("❌ DB Error during final username check:", err3);
        return res.status(500).json({ message: "Database error during username validation." });
      }
      if (userCheck.length > 0) {
        return res.status(409).json({ message: "❌ This Username is already taken. Please choose another." });
      }

      const finalRegisterSql = `
               UPDATE register 
               SET username = ?, password = ?, gender = ?, contact = ?, 
               otp = NULL, otp_expires_at = NULL, registered_at = CURRENT_TIMESTAMP 
               WHERE email = ?`;
      db.query(finalRegisterSql, [username, password, gender, contact, email], (err4) => {
        if (err4) {
          console.error("❌ Database Update Error:", err4);
          if (err4.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: "❌ Username or Email already taken. Please review your details." });
          }
          return res.status(500).json({ message: "Database error during final registration." });
        }
        res.status(200).json({ message: "✅ User registered successfully & Email Verified!" });
      });
    });
  });
});

// ------------------ FORGOT PASSWORD FLOW ------------------

// Helper: find user by identifier (email or username)
function findUserByIdentifier(identifier, cb) {
  // detect email by basic regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (emailRegex.test(identifier)) {
    db.query('SELECT * FROM register WHERE email = ?', [identifier], cb);
  } else {
    db.query('SELECT * FROM register WHERE username = ?', [identifier], cb);
  }
}

// POST /forgot-send-otp
app.post('/forgot-send-otp', async (req, res) => {
  const { identifier } = req.body;
  if (!identifier) return res.status(400).json({ message: "identifier required" });

  findUserByIdentifier(identifier, async (err, results) => {
    if (err) {
      console.error('DB error in forgot-send-otp', err);
      return res.status(500).json({ message: 'Database error' });
    }
    if (!results || results.length === 0) {
      return res.status(404).json({ message: '❌ No account found with that email/username.' });
    }

    const user = results[0];
    const email = user.email;
    if (!email) {
      return res.status(400).json({ message: '❌ This account has no email associated.' });
    }

    // generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Store OTP and expiry in DB (safe-upsert)
    const sql = `
     UPDATE register
     SET otp = ?, otp_expires_at = ?
     WHERE email = ? OR username = ?
   `;
    db.query(sql, [otp, otpExpires, email, user.username], async (uErr) => {
      if (uErr) {
        console.error('DB error storing OTP (forgot):', uErr);
        return res.status(500).json({ message: 'Database error' });
      }

      // send OTP via Brevo helper
      const out = await sendOTPEmailBrevo(email, otp);
      if (!out.success) {
        console.error('Brevo send failed (forgot):', out);
        return res.status(500).json({ message: 'Failed to send OTP email' });
      }

      return res.json({ message: 'OTP sent to registered email.' });
    });
  });
});

// POST /forgot-verify-otp
app.post('/forgot-verify-otp', (req, res) => {
  const { identifier, otp } = req.body;
  if (!identifier || !otp) return res.status(400).json({ message: 'identifier and otp required' });

  // find matching record where otp matches and not expired
  const sql = `
   SELECT * FROM register
   WHERE (email = ? OR username = ?)
     AND otp = ?
     AND otp_expires_at > NOW()
   LIMIT 1
 `;
  db.query(sql, [identifier, identifier, otp], (err, results) => {
    if (err) {
      console.error('DB error forgot-verify-otp:', err);
      return res.status(500).json({ message: 'Database error' });
    }
    if (!results || results.length === 0) {
      return res.status(400).json({ message: '❌ Invalid or expired OTP.' });
    }

    // mark a flag in DB or just return OK — we'll let reset endpoint check again.
    return res.json({ message: 'OTP verified' });
  });
});

// POST /forgot-reset-password
app.post('/forgot-reset-password', (req, res) => {
  const { identifier, newPassword } = req.body;
  if (!identifier || !newPassword) return res.status(400).json({ message: 'identifier and newPassword required' });

  // Only allow reset if a valid (non-expired) otp exists (so user must verify OTP first)
  const sqlCheck = `
   SELECT * FROM register
   WHERE (email = ? OR username = ?)
     AND otp_expires_at > NOW()
   LIMIT 1
 `;
  db.query(sqlCheck, [identifier, identifier], (err, results) => {
    if (err) {
      console.error('DB error forgot-reset-password check:', err);
      return res.status(500).json({ message: 'Database error' });
    }
    if (!results || results.length === 0) {
      return res.status(400).json({ message: '❌ No valid OTP found. Please request OTP again.' });
    }

    const email = results[0].email;
    const sqlUpdate = `
     UPDATE register
     SET password = ?, otp = NULL, otp_expires_at = NULL
     WHERE email = ? OR username = ?
   `;
    db.query(sqlUpdate, [newPassword, email, results[0].username], (uErr) => {
      if (uErr) {
        console.error('DB error updating password:', uErr);
        return res.status(500).json({ message: 'Database error' });
      }
      return res.json({ message: '✅ Password updated successfully.' });
    });
  });
});

// Login endpoint (with visitor logs)
// Strict case-sensitive login
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const ip_address = req.ip || req.connection.remoteAddress;

  if (!username || !password) {
    return res.status(400).json({ message: "username and password required" });
  }

  // Use BINARY to force case-sensitive comparison on both username and password.
  const sql = "SELECT * FROM register WHERE BINARY username = ? AND BINARY password = ? LIMIT 1";
  db.query(sql, [username, password], (err, results) => {
    if (err) {
      console.error("❌ Database Error (login):", err);
      // Log failed attempt
      const logFailureSql = "INSERT INTO visitor_logs (username, ip_address, status) VALUES (?, ?, 'Failure')";
      db.query(logFailureSql, [username || null, ip_address], () => {
        // ignore errors logging visitor
        return res.status(500).json({ message: "Database error" });
      });
      return;
    }

    if (results && results.length > 0) {
      // success
      const logSuccessSql = "INSERT INTO visitor_logs (username, ip_address, status) VALUES (?, ?, 'Success')";
      db.query(logSuccessSql, [username, ip_address], (logErr) => {
        if (logErr) console.error('Visitor log error (success):', logErr);
        const user = results[0];
        return res.status(200).json({
          message: "✅ Login successful",
          username: user.username,
          email: user.email,
          gender: user.gender
        });
      });
    } else {
      // failure
      const logFailureSql = "INSERT INTO visitor_logs (username, ip_address, status) VALUES (?, ?, 'Failure')";
      db.query(logFailureSql, [username || null, ip_address], (logErr) => {
        if (logErr) console.error('Visitor log error (failure):', logErr);
        return res.status(401).json({ message: "❌ Invalid username or password" });
      });
    }
  });
});


// VISITOR LOGS endpoints
app.get("/user-details", (req, res) => {
  const sql = "SELECT username, registered_at FROM register WHERE username IS NOT NULL";
  db.query(sql, (err, results) => {
    if (err) {
      console.error("❌ DB Error fetching user details:", err);
      return res.status(500).json({ message: "Database error fetching user details." });
    }
    const userMap = results.reduce((acc, user) => {
      if (user.username) {
        acc[user.username] = user.registered_at ? new Date(user.registered_at).toISOString() : null;
      }
      return acc;
    }, {});
    res.status(200).json({ users: userMap });
  });
});

app.get("/visitor-logs", (req, res) => {
  const sql = "SELECT username, login_time, ip_address, status FROM visitor_logs ORDER BY login_time DESC";
  db.query(sql, (err, results) => {
    if (err) {
      console.error("❌ DB Error fetching visitor logs:", err);
      return res.status(500).json({ message: "Database error fetching logs." });
    }
    res.status(200).json({ logs: results });
  });
});

// ---------- UPDATED COMPLAINTS ENDPOINT (SECURE) ----------
app.post('/complaints', (req, res) => {
  const { subject, description, category, location, username } = req.body;

  if (!subject || !description || !username) {
    return res.status(400).json({ error: 'subject, description and username required' });
  }

  // 1) Try to detect admin via role column
  const checkRoleSql = 'SELECT role FROM register WHERE username = ? LIMIT 1';
  db.query(checkRoleSql, [username], (roleErr, roleRows) => {
    if (roleErr) {
      console.error('DB error checking role:', roleErr);
      // continue — we'll still check room assignment
    }

    let isAdmin = false;
    if (roleRows && roleRows.length > 0 && roleRows[0].role) {
      const roleVal = String(roleRows[0].role).toLowerCase();
      if (roleVal === 'admin' || roleVal === 'warden' || roleVal === 'superadmin') {
        isAdmin = true;
      }
    }

    // Fallback: ADMIN_USERNAMES env var (comma-separated)
    if (!isAdmin && process.env.ADMIN_USERNAMES) {
      try {
        const adminList = String(process.env.ADMIN_USERNAMES).split(',').map(s => s.trim()).filter(Boolean);
        if (adminList.includes(username)) isAdmin = true;
      } catch (e) {
        // ignore parsing errors
      }
    }

    // 2) If not admin, ensure user has an assigned room
    if (!isAdmin) {
      const roomCheckSql = 'SELECT room_no FROM rooms WHERE username = ? LIMIT 1';
      db.query(roomCheckSql, [username], (roomErr, roomRows) => {
        if (roomErr) {
          console.error('DB error checking room assignment:', roomErr);
          return res.status(500).json({ error: 'DB error while verifying room assignment' });
        }

        const hasRoom = (roomRows && roomRows.length > 0);

        if (!hasRoom) {
          return res.status(403).json({ error: "❌ You can't submit a complaint because no room is assigned." });
        }

        // Insert complaint now that checks passed
        const insertSql = `INSERT INTO complaints (subject, description, category, location, username) VALUES (?, ?, ?, ?, ?)`;
        db.query(insertSql, [subject, description, category || null, location || null, username], (insErr, insRes) => {
          if (insErr) {
            console.error('Error inserting complaint:', insErr);
            return res.status(500).json({ error: 'Could not save complaint' });
          }
          return res.json({ ok: true, id: insRes.insertId, message: 'Complaint filed successfully' });
        });
      });
    } else {
      // isAdmin === true -> allow directly to insert complaint
      const insertSql = `INSERT INTO complaints (subject, description, category, location, username) VALUES (?, ?, ?, ?, ?)`; 
      db.query(insertSql, [subject, description, category || null, location || null, username], (insErr, insRes) => {
        if (insErr) {
          console.error('Error inserting complaint (admin):', insErr);
          return res.status(500).json({ error: 'Could not save complaint' });
        }
        return res.json({ ok: true, id: insRes.insertId, message: 'Complaint filed successfully (admin)' });
      });
    }
  });
});
// ------------------------------------------------------------------

app.get('/complaints', (req, res) => {
  const sql = `SELECT id, subject, description, category, location, username, status, created_at FROM complaints ORDER BY created_at DESC`;
  db.query(sql, (err, results) => {
    if (err) {
      console.error('Error fetching complaints (fallback):', err);
      return res.status(500).json({ error: 'Could not fetch complaints' });
    }
    res.json(results || []);
  });
});

app.patch('/complaints/:id', (req, res) => {
  const id = req.params.id;
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: 'status is required' });
  const sql = `UPDATE complaints SET status = ? WHERE id = ?`;
  db.query(sql, [status, id], (err, result) => {
    if (err) {
      console.error('Error updating complaint status (fallback):', err);
      return res.status(500).json({ error: 'Could not update complaint' });
    }
    return res.json({ ok: true, affectedRows: result.affectedRows });
  });
});

app.delete('/complaints/:id', (req, res) => {
  const id = req.params.id;
  const sql = 'DELETE FROM complaints WHERE id = ? AND status = "Resolved"';
  db.query(sql, [id], (err, result) => {
    if (err) {
      console.error('Error deleting resolved complaint:', err);
      return res.status(500).json({ error: 'Could not delete complaint' });
    }
    if (result.affectedRows === 0) {
      return res.status(400).json({ error: 'Complaint not found or not resolved' });
    }
    return res.json({ ok: true, message: 'Complaint deleted successfully' });
  });
});

// NOTIFICATIONS endpoints
app.post('/notifications', (req, res) => {
  const { username, subject, message, desired_room } = req.body;
  if (!username || !subject) return res.status(400).json({ message: 'Missing fields' });
  const sql = 'INSERT INTO notifications (username, subject, message, desired_room) VALUES (?, ?, ?, ?)';
  db.query(sql, [username, subject, message || null, desired_room || null], (err, result) => {
    if (err) {
      console.error('Error inserting notification:', err);
      return res.status(500).json({ message: 'DB error', error: err });
    }
    return res.json({ id: result.insertId, message: 'Notification created' });
  });
});

app.get('/notifications', (req, res) => {
  const onlyUnread = req.query.unread === '1';
  let sql = 'SELECT id, username, subject, message, desired_room, is_read, created_at FROM notifications ORDER BY created_at DESC';
  if (onlyUnread) sql = 'SELECT id, username, subject, message, desired_room, is_read, created_at FROM notifications WHERE is_read = 0 ORDER BY created_at DESC';
  db.query(sql, (err, results) => {
    if (err) {
      console.error('Error fetching notifications:', err);
      return res.status(500).json({ message: 'DB error', error: err });
    }
    res.json(results || []);
  });
});

app.patch('/notifications/:id/read', (req, res) => {
  const id = req.params.id;
  const sql = 'UPDATE notifications SET is_read = 1 WHERE id = ?';
  db.query(sql, [id], (err, result) => {
    if (err) {
      console.error('Error marking notification read:', err);
      return res.status(500).json({ message: 'DB error', error: err });
    }
    res.json({ message: 'Marked read', affectedRows: result.affectedRows });
  });
});

// USER/STUDENT DATA & ROOM endpoints (kept as original)
app.get("/users", (req, res) => {
  const sql = "SELECT username, gender, email, contact FROM register WHERE username IS NOT NULL";
  db.query(sql, (err, results) => {
    if (err) return res.status(500).json({ message: "DB error" });
    res.json(results);
  });
});

app.get("/register/:username", (req, res) => {
  const username = req.params.username;
  const sql = "SELECT username, gender, email, contact FROM register WHERE username = ?";
  db.query(sql, [username], (err, results) => {
    if (err) return res.status(500).json({ message: "DB error" });
    res.json(results[0]);
  });
});

app.get("/unassigned-users", (req, res) => {
  const sql = `
       SELECT r.username, r.gender, r.email, r.contact
       FROM register r
       WHERE r.username IS NOT NULL AND r.username NOT IN (
           SELECT username FROM rooms WHERE username IS NOT NULL
       )
   `;
  db.query(sql, (err, results) => {
    if (err) return res.status(500).json({ message: "DB error" });
    res.json(results);
  });
});

app.get("/available-rooms", (req, res) => {
  const sql = `
       SELECT room_no,
               SUM(CASE WHEN username IS NULL THEN 1 ELSE 0 END) AS available_beds
       FROM rooms
       GROUP BY room_no
       HAVING available_beds > 0
   `;

  db.query(sql, (err, results) => {
    if (err) return res.status(500).json({ message: "DB error" });
    res.json(results);
  });
});

app.get("/available-beds/:room_no", (req, res) => {
  const room_no = req.params.room_no;

  const sql = "SELECT bed_no FROM rooms WHERE room_no = ? AND username IS NULL";
  db.query(sql, [room_no], (err, results) => {
    if (err) return res.status(500).json({ message: "DB error" });
    res.json(results);
  });
});

app.get("/assignments", (req, res) => {
  const sql = `
       SELECT r.username, rm.room_no, rm.bed_no
       FROM rooms rm
       JOIN register r ON r.username = rm.username
       WHERE rm.username IS NOT NULL
       ORDER BY rm.room_no, rm.bed_no
   `;
  db.query(sql, (err, results) => {
    if (err) return res.status(500).json({ message: "DB error" });
    if (results.length === 0) {
      return res.status(200).json([]);
    }
    res.json(results);
  });
});

app.get("/assignments/:room_no", (req, res) => {
  const room_no = req.params.room_no;
  const sql = `
       SELECT r.username, rm.room_no, rm.bed_no
       FROM rooms rm
       JOIN register r ON r.username = rm.username
       WHERE rm.room_no = ? AND rm.username IS NOT NULL
       ORDER BY rm.bed_no
   `;
  db.query(sql, [room_no], (err, results) => {
    if (err) return res.status(500).json({ message: "DB error" });
    if (results.length === 0) {
      return res.status(200).json([]);
    }
    res.json(results);
  });
});

app.get("/my-room/:username", (req, res) => {
  const username = req.params.username;
  const sql = "SELECT room_no, bed_no FROM rooms WHERE username = ?";
  db.query(sql, [username], (err, results) => {
    if (err) return res.status(500).json({ message: "DB error" });
    if (results.length === 0) {
      return res.json({ message: "❌ No room assigned yet" });
    }
    res.json(results[0]);
  });
});

app.post("/assign-room", (req, res) => {
  const { username, room_no } = req.body;

  if (!username || !room_no) {
    return res.status(400).json({ message: "⚠ Missing student and room data" });
  }

  const getStudentGenderSql = "SELECT gender FROM register WHERE username = ?";
  db.query(getStudentGenderSql, [username], (err, studentResults) => {
    if (err) return res.status(500).json({ message: "DB error getting student gender" });
    if (studentResults.length === 0) return res.status(404).json({ message: "❌ Student not found" });

    const studentGender = studentResults[0].gender;

    const checkRoomGenderSql = `
           SELECT r.gender
           FROM rooms rm
           JOIN register r ON r.username = rm.username
           WHERE rm.room_no = ? AND rm.username IS NOT NULL
           LIMIT 1
       `;
    db.query(checkRoomGenderSql, [room_no], (err, roomOccupantResults) => {
      if (err) return res.status(500).json({ message: "DB error checking room gender" });

      if (roomOccupantResults.length > 0) {
        const occupantGender = roomOccupantResults[0].gender;

        if (occupantGender !== studentGender) {
          return res.status(403).json({
            message: `❌ Cannot assign ${username}. Room ${room_no} is already occupied by a ${occupantGender} student.`
          });
        }
      }

      const findBedSql = "SELECT bed_no FROM rooms WHERE room_no = ? AND username IS NULL LIMIT 1";
      db.query(findBedSql, [room_no], (err, freeBedResults) => {
        if (err) return res.status(500).json({ message: "DB error finding free bed" });

        if (freeBedResults.length === 0) {
          return res.status(400).json({ message: "❌ No free beds in this room" });
        }

        const freeBed = freeBedResults[0].bed_no;

        const assignSql = "UPDATE rooms SET username = ? WHERE room_no = ? AND bed_no = ?";
        db.query(assignSql, [username, room_no, freeBed], (err2) => {
          if (err2) return res.status(500).json({ message: "DB error during assignment" });
          res.json({ message: `✅ ${username} (${studentGender}) assigned to Room ${room_no}, Bed ${freeBed}` });
        });
      });
    });
  });
});

app.delete("/remove-assignment/:username", (req, res) => {
  const username = req.params.username;
  const sql = "UPDATE rooms SET username = NULL WHERE username = ?";
  db.query(sql, [username], (err) => {
    if (err) return res.status(500).json({ message: "DB error while removing assignment" });
    res.json({ message: `✅ Assignment removed for ${username}` });
  });
});

// DETAILS endpoints
app.post("/save-details", (req, res) => {
  const { username, email, contact, course, year, semester, prevCollege, prevResult } = req.body;

  if (!username || !email || !contact) {
    return res.status(400).json({ message: "⚠ Missing student data" });
  }

  const sql = `INSERT INTO student_details
               (username, email, contact, course, year, semester, prev_college, prev_result)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

  db.query(sql, [username, email, contact, course, year, semester, prevCollege, prevResult], (err) => {
    if (err) {
      console.error("❌ Database Insert Error (save-details alias):", err);
      return res.status(500).json({ message: "Database error" });
    }
    return res.status(200).json({ message: "✅ Academic details saved successfully" });
  });
});

app.get("/details/:username", (req, res) => {
  const username = req.params.username;
  const sql = "SELECT course, year, semester, prev_college, prev_result FROM student_details WHERE username = ?";
  db.query(sql, [username], (err, results) => {
    if (err) return res.status(500).json({ message: "DB error" });
    res.json(results[0]);
  });
});

app.get("/student-details", (req, res) => {
  const sql = "SELECT * FROM student_details";
  db.query(sql, (err, results) => {
    if (err) return res.status(500).json({ message: "DB error" });
    res.json(results);
  });
});

// DELETE student
app.delete("/students/:username", (req, res) => {
  const { username } = req.params;

  db.query("UPDATE rooms SET username = NULL WHERE username = ?", [username], (err) => {
    if (err) return res.status(500).json({ message: "Error freeing room" });

    db.query("DELETE FROM student_details WHERE username = ?", [username], (err2) => {
      if (err2) return res.status(500).json({ message: "Error deleting details" });

      db.query("DELETE FROM register WHERE username = ?", [username], (err3) => {
        if (err3) return res.status(500).json({ message: "Error deleting user" });
        res.json({ message: `✅ Student ${username} deleted successfully (room freed)` });

        // Delete from payment_status
    db.query("DELETE FROM payment_status WHERE username = ?", [username]);

    // Delete all payment requests
    db.query("DELETE FROM payment_requests WHERE username = ?", [username]);

    return res.json({ message: "Student & all payment records deleted successfully" });
      });
    });
  });
});

// Meals and occupancy / dues endpoints
app.get("/meals", (req, res) => {
  const sql = "SELECT * FROM meals";
  db.query(sql, (err, results) => {
    if (err) return res.status(500).json({ message: "DB error" });
    res.json(results);
  });
});

app.get('/rooms-occupancy', (req, res) => {
  const totalSql = 'SELECT COUNT(*) AS total FROM rooms';
  const occSql = 'SELECT COUNT(*) AS occupied FROM rooms WHERE username IS NOT NULL';

  db.query(totalSql, (tErr, tRes) => {
    if (tErr) {
      console.error('Error fetching total rooms:', tErr);
      return res.status(500).json({ error: 'DB error' });
    }
    const total = (tRes && tRes[0] && tRes[0].total) ? Number(tRes[0].total) : 0;
    db.query(occSql, (oErr, oRes) => {
      if (oErr) {
        console.error('Error fetching occupied rooms:', oErr);
        return res.status(500).json({ error: 'DB error' });
      }
      const occupied = (oRes && oRes[0] && oRes[0].occupied) ? Number(oRes[0].occupied) : 0;
      return res.json({ occupied, total });
    });
  });
});

app.get('/dues-count', (req, res) => {
  const sql = `
       SELECT COUNT(*) AS dueCount
       FROM register r
       LEFT JOIN payment_status p ON p.username = r.username
       WHERE r.username IS NOT NULL AND (p.status IS NULL OR p.status <> 'Paid')
   `;

  db.query(sql, (err, results) => {
    if (err) {
      console.error('Error fetching dues count:', err);
      return res.status(500).json({ message: 'DB error' });
    }
    const count = (results && results[0] && results[0].dueCount) ? Number(results[0].dueCount) : 0;
    res.json({ dueCount: count });
  });
});

// GET warden details by username (add to server.js)
app.get('/warden/:username', (req, res) => {
  const username = req.params.username;
  if (!username) return res.status(400).json({ message: 'username required' });

  const sql = 'SELECT username, email, contact, fullname FROM warden WHERE username = ? LIMIT 1';
  db.query(sql, [username], (err, results) => {
    if (err) {
      console.error('/warden/:username DB error', err);
      return res.status(500).json({ message: 'DB error' });
    }
    if (!results || results.length === 0) {
      return res.status(404).json({ message: 'Warden not found' });
    }
    return res.status(200).json(results[0]);
  });
});

// --- START: Replace existing app.post('/warden/login', ...) with this block ---

app.post('/warden/login', (req, res) => {
  const { username, password, jobRole, shift } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ message: 'username and password required' });
  }

  // Normalize incoming role/shift for reliable comparison
  const inputRole = (jobRole || '').toString().trim().toLowerCase();
  const inputShift = (shift || '').toString().trim().toLowerCase();

  if (!inputRole || !inputShift) {
    return res.status(400).json({ message: '⚠ Please provide job role and shift.' });
  }

  // --- STEP 1: fetch stored job-role & shift for this warden from DB ---
  // CHANGE TABLE / COLUMN NAMES BELOW IF YOUR DB DIFFERS:
  const TABLE_NAME = 'JOB_APPLICATIONS'; // <-- change if your table has another name
  const COL_USER = 'warden_username';    // <-- change if different
  const COL_ROLE = 'job_role';           // <-- change if different
  const COL_SHIFT = 'shift';             // <-- change if different
  const COL_APPLIED_AT = 'applied_at';   // used to pick latest entry (if exists)

  // Get latest job application / job-details for this warden
  const sqlJob = `
    SELECT ${COL_ROLE} AS job_role, ${COL_SHIFT} AS shift
    FROM ${TABLE_NAME}
    WHERE ${COL_USER} = ?
    ORDER BY ${COL_APPLIED_AT} DESC
    LIMIT 1
  `;

  db.query(sqlJob, [username], (err, jobResults) => {
    if (err) {
      console.error('DB error fetching job details:', err);
      return res.status(500).json({ message: 'DB error' });
    }

    // If there is no job-details row for this username, we treat that as "both incorrect"
    if (!jobResults || jobResults.length === 0) {
      return res.status(400).json({ message: '⚠ select perfect job role & shift.' });
    }

    // Normalize stored values
    const storedRole = (jobResults[0].job_role || '').toString().trim().toLowerCase();
    const storedShift = (jobResults[0].shift || '').toString().trim().toLowerCase();

    // Compare & return granular errors as requested:
    const roleMatches = storedRole === inputRole;
    const shiftMatches = storedShift === inputShift;

    if (!roleMatches && !shiftMatches) {
      return res.status(400).json({ message: '⚠ select perfect job role & shift.' });
    }
    if (!roleMatches && shiftMatches) {
      return res.status(400).json({ message: '⚠ select perfect job role.' });
    }
    if (roleMatches && !shiftMatches) {
      return res.status(400).json({ message: '⚠ select perfect shift.' });
    }

    // --- STEP 2: role & shift matched the DB record, proceed to authenticate credentials ---
    const sqlAuth = `
      SELECT username, fullname, email, contact, IFNULL(approved,0) AS approved
      FROM warden
      WHERE BINARY username = ? AND BINARY password = ?
      LIMIT 1
    `;
    db.query(sqlAuth, [username, password], (err2, authResults) => {
      if (err2) {
        console.error('DB error during login auth:', err2);
        return res.status(500).json({ message: 'DB error' });
      }
      if (!authResults || authResults.length === 0) {
        return res.status(401).json({ message: 'Invalid username or password' });
      }
      const user = authResults[0];
      if (Number(user.approved) !== 1) {
        return res.status(403).json({ message: 'Account pending admin approval. You will be notified when approved.' });
      }

      // SUCCESS: role+shift validated from DB and credentials OK
      // You can also return role/shift in response if frontend needs to route.
      return res.json({
        message: 'Login successful',
        username: user.username,
        fullname: user.fullname,
        email: user.email,
        role: storedRole,
        shift: storedShift
      });
    });
  });
});
// --- END: login handler ---


// -----------------------------
// Job application submit endpoint
// -----------------------------
app.post('/apply-job', (req, res) => {
  const { username, job_role, shift } = req.body;
  if (!username || !job_role || !shift) return res.status(400).json({ message: 'Missing required fields' });

  const wardenSql = 'SELECT fullname, email, contact FROM warden WHERE username = ?';
  db.query(wardenSql, [username], (err, result) => {
    if (err) return res.status(500).json({ message: 'DB error' });
    if (!result || result.length === 0) return res.status(404).json({ message: 'Warden not found' });

    const { fullname, email, contact } = result[0];
    const insertSql = `INSERT INTO job_applications (warden_username, fullname, email, contact, job_role, shift) VALUES (?, ?, ?, ?, ?, ?)`;
    db.query(insertSql, [username, fullname, email, contact, job_role, shift], (err2, result2) => {
      if (err2) {
        console.error('apply-job insert error', err2);
        return res.status(500).json({ message: 'DB insert error' });
      }
      return res.status(201).json({ message: 'Job application submitted', id: result2.insertId });
    });
  });
});

// -----------------------------
// Replace your existing /admin/wardens/pending handler with this code:
app.get('/admin/wardens/pending', (req, res) => {
  const sqlWardens = `
    SELECT id, fullname, username, email, contact, created_at, IFNULL(approved,0) AS approved
    FROM warden
    WHERE IFNULL(approved,0) = 0
    ORDER BY created_at DESC
    LIMIT 500
  `;
  db.query(sqlWardens, (wErr, wResults) => {
    if (wErr) {
      console.error('/admin/wardens/pending wardens query error', wErr);
      return res.status(500).json({ message: 'DB error' });
    }
    if (!wResults || wResults.length === 0) return res.json([]);

    const usernames = wResults.map(r => r.username).filter(Boolean);
    if (usernames.length === 0) return res.json(wResults);

    const sqlApps = `
      SELECT ja.warden_username, ja.job_role, ja.shift, ja.applied_at
      FROM job_applications ja
      JOIN (
        SELECT warden_username, MAX(applied_at) AS latest_applied
        FROM job_applications
        WHERE warden_username IN (?)
        GROUP BY warden_username
      ) lm ON lm.warden_username = ja.warden_username AND lm.latest_applied = ja.applied_at
    `;
    db.query(sqlApps, [usernames], (aErr, aResults) => {
      if (aErr) {
        console.error('/admin/wardens/pending apps query error', aErr);
        // If apps query fails, still return wardens (without apps) rather than failing completely
        return res.json(wResults);
      }
      const appMap = (aResults || []).reduce((m, a) => { m[a.warden_username] = a; return m; }, {});
      const merged = wResults.map(w => ({
        id: w.id,
        fullname: w.fullname,
        username: w.username,
        email: w.email,
        contact: w.contact,
        created_at: w.created_at,
        approved: w.approved,
        job_role: appMap[w.username]?.job_role || null,
        shift: appMap[w.username]?.shift || null,
        applied_at: appMap[w.username]?.applied_at || null
      }));
      return res.json(merged);
    });
  });
});

// Admin: list approved wardens (with latest job application merged)
app.get('/admin/wardens/approved', (req, res) => {
  const sqlWardens = `
    SELECT id, fullname, username, email, contact, created_at, IFNULL(approved,0) AS approved
    FROM warden
    WHERE IFNULL(approved,0) = 1
    ORDER BY created_at DESC
    LIMIT 500
  `;
  db.query(sqlWardens, (wErr, wResults) => {
    if (wErr) {
      console.error('/admin/wardens/approved wardens query error', wErr);
      return res.status(500).json({ message: 'DB error' });
    }
    if (!wResults || wResults.length === 0) return res.json([]);

    const usernames = wResults.map(r => r.username).filter(Boolean);
    if (usernames.length === 0) return res.json(wResults);

    const sqlApps = `
      SELECT ja.warden_username, ja.job_role, ja.shift, ja.applied_at
      FROM job_applications ja
      JOIN (
        SELECT warden_username, MAX(applied_at) AS latest_applied
        FROM job_applications
        WHERE warden_username IN (?)
        GROUP BY warden_username
      ) lm ON lm.warden_username = ja.warden_username AND lm.latest_applied = ja.applied_at
    `;
    db.query(sqlApps, [usernames], (aErr, aResults) => {
      if (aErr) {
        console.error('/admin/wardens/approved apps query error', aErr);
        // return wardens without apps if apps query fails
        return res.json(wResults);
      }
      const appMap = (aResults || []).reduce((m, a) => { m[a.warden_username] = a; return m; }, {});
      const merged = wResults.map(w => ({
        id: w.id,
        fullname: w.fullname,
        username: w.username,
        email: w.email,
        contact: w.contact,
        created_at: w.created_at,
        approved: w.approved,
        job_role: appMap[w.username]?.job_role || null,
        shift: appMap[w.username]?.shift || null,
        applied_at: appMap[w.username]?.applied_at || null
      }));
      return res.json(merged);
    });
  });
});



// -----------------------------
// Admin: approve a warden
// -----------------------------
app.patch('/admin/wardens/:username/approve', (req, res) => {
  const username = req.params.username;
  if (!username) return res.status(400).json({ message: 'username required' });

  const sql = 'UPDATE warden SET approved = 1 WHERE username = ?';
  db.query(sql, [username], (err, result) => {
    if (err) {
      console.error('approve warden DB error', err);
      return res.status(500).json({ message: 'DB error' });
    }
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Warden not found' });

    // Optionally: send approval email (uncomment to use)
    // sendOTPEmailBrevo(email, 'Your account has been approved').catch(e=>console.error(e));

    return res.json({ message: 'Warden approved' });
  });
});

// -----------------------------
// Admin: reject a warden (delete so they must re-register)
// -----------------------------
app.patch('/admin/wardens/:username/reject', (req, res) => {
  const username = req.params.username;
  if (!username) return res.status(400).json({ message: 'username required' });

  db.query('DELETE FROM job_applications WHERE warden_username = ?', [username], (err1) => {
    if (err1) {
      console.error('Error deleting job_applications during reject', err1);
      // continue
    }
    db.query('DELETE FROM warden WHERE username = ?', [username], (err2, result) => {
      if (err2) {
        console.error('Error deleting warden during reject', err2);
        return res.status(500).json({ message: 'DB error' });
      }
      if (result.affectedRows === 0) return res.status(404).json({ message: 'Warden not found' });
      return res.json({ message: 'Warden rejected and removed. They must re-register.' });
    });
  });
});

// Admin: list all wardens (with latest job application merged)
app.get('/admin/wardens/all', (req, res) => {
  const sqlWardens = `
    SELECT id, fullname, username, email, contact, created_at, IFNULL(approved,0) AS approved
    FROM warden
    ORDER BY created_at DESC
    LIMIT 1000
  `;
  db.query(sqlWardens, (wErr, wResults) => {
    if (wErr) {
      console.error('/admin/wardens/all wardens query error', wErr);
      return res.status(500).json({ message: 'DB error' });
    }
    if (!wResults || wResults.length === 0) return res.json([]);

    const usernames = wResults.map(r => r.username).filter(Boolean);
    if (usernames.length === 0) return res.json(wResults);

    const sqlApps = `
      SELECT ja.warden_username, ja.job_role, ja.shift, ja.applied_at
      FROM job_applications ja
      JOIN (
        SELECT warden_username, MAX(applied_at) AS latest_applied
        FROM job_applications
        WHERE warden_username IN (?)
        GROUP BY warden_username
      ) lm ON lm.warden_username = ja.warden_username AND lm.latest_applied = ja.applied_at
    `;
    db.query(sqlApps, [usernames], (aErr, aResults) => {
      if (aErr) {
        console.error('/admin/wardens/all apps query error', aErr);
        // If apps query fails, still return wardens (without apps) rather than failing
        return res.json(wResults);
      }
      const appMap = (aResults || []).reduce((m, a) => { m[a.warden_username] = a; return m; }, {});
      const merged = wResults.map(w => ({
        id: w.id,
        fullname: w.fullname,
        username: w.username,
        email: w.email,
        contact: w.contact,
        created_at: w.created_at,
        approved: w.approved,
        job_role: appMap[w.username]?.job_role || null,
        shift: appMap[w.username]?.shift || null,
        applied_at: appMap[w.username]?.applied_at || null
      }));
      return res.json(merged);
    });
  });
});



// New endpoint to provide job role and shift validation details
app.get('/api/job-shift-details', (req, res) => {
  // This JSON structure represents the valid combinations (fetched from the "jobdetails.html" source of truth)
  const jobShiftDetails = {
    'education': ['day', 'night'],
    'kitchen': ['day'], // kitchen department only shows day shift
    'maintenance': ['day', 'night']
  };
  res.json(jobShiftDetails);
});

app.get('/admin/wardens/approved', (req, res) => {
  const sql = `
    SELECT username, fullname, email, contact
    FROM warden
    WHERE IFNULL(approved,0) = 1
    ORDER BY fullname ASC
  `;
  db.query(sql, (err, results) => {
    if (err) return res.status(500).json({ message: "DB error" });
    res.json(results || []);
  });
});

// returns counts grouped by job_role+shift, e.g. { "education": { "day": 1, "night": 0 }, "maintenance": {...}, "kitchen": { "day": 1 } }
// -----------------------------
app.get('/api/occupied-job-slots', (req, res) => {
  const sql = `
    SELECT LOWER(job_role) AS job_role, LOWER(shift) AS shift, COUNT(*) AS cnt
    FROM job_applications
    GROUP BY LOWER(job_role), LOWER(shift)
  `;
  db.query(sql, (err, results) => {
    if (err) {
      console.error('/api/occupied-job-slots DB error', err);
      return res.status(500).json({ message: 'DB error' });
    }
    // build nested map
    const map = {};
    (results || []).forEach(row => {
      if (!map[row.job_role]) map[row.job_role] = {};
      map[row.job_role][row.shift] = Number(row.cnt || 0);
    });
    res.json(map);
  });
});

// -----------------------------
// Cancel pending registration
// Deletes the register row for a username when user abandons flow
// -----------------------------
app.post('/register/cancel', (req, res) => {
  const username = (req.body && req.body.username) ? String(req.body.username).trim() : null;
  if (!username) return res.status(400).json({ ok: false, message: 'username required' });

  // Safety: only delete if the username exists and (optionally) hasn't been approved
  // If you store an 'approved' flag or 'registered_at' you can add conditions.
  const sql = 'DELETE FROM register WHERE username = ?';
  db.query(sql, [username], (err, result) => {
    if (err) {
      console.error('/register/cancel DB error for', username, err);
      return res.status(500).json({ ok: false, message: 'DB error' });
    }
    // also clean up any temporary job_applications created by mistake for this username
    db.query('DELETE FROM job_applications WHERE warden_username = ?', [username], (e2) => {
      if (e2) console.error('cleanup job_applications error for', username, e2);
      // return success regardless of cleanup errors
      return res.json({ ok: true, deletedRows: result.affectedRows });
    });
  });
});

app.delete("/warden/delete/:username", (req, res) => {
  const username = req.params.username;

  const sql = "DELETE FROM warden WHERE username = ?";
  db.query(sql, [username], (err, result) => {
    if (err) {
      console.error("Delete error:", err);
      return res.status(500).json({ message: "Database error while deleting user" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json({ message: "Warden registration deleted successfully" });
  });
});


// Health & DB health endpoints
app.get('/health', (req, res) => {
  const uptime = process.uptime();
  db.ping((err) => {
    if (err) return res.status(500).json({ status: 'error', uptime, db: false, error: err.message });
    res.json({ status: 'ok', uptime, db: true });
  });
});

app.get('/db-health', (req, res) => {
  db.query('SELECT 1+1 AS result', (err, results) => {
    if (err) {
      console.error('Database Connection Error:', err);
      return res.status(500).json({
        status: 'Error',
        message: 'Database connection failed or query error.',
        error: err.code || err.message
      });
    }
    if (results && results[0] && results[0].result === 2) {
      return res.status(200).json({
        status: 'OK',
        message: 'Database is connected and healthy.'
      });
    } else {
      return res.status(500).json({
        status: 'Error',
        message: 'Database connected, but query returned unexpected result.'
      });
    }
  });
});

// Catch-all route
app.get(/.*/, (req, res) => {
  res.send("🚀 Hostel Management Backend is running!");
});

// START server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n\n\n✅ Server is running on port ${PORT} \n`);
});
