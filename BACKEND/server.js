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
    approved TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

db.query(createWardenTable, (err) => {
  if (err) console.error("❌ Warden table create error", err);
  else console.log("✅ Warden table ready");
});

// Ensure otp columns exist in register table (best-effort)
const alterWardenOtp = `
  ALTER TABLE warden
  ADD COLUMN otp VARCHAR(10),
  ADD COLUMN otp_expires_at DATETIME
`;
db.query(alterWardenOtp, (err) => {
  if (err && err.errno !== 1060) { // ignore duplicate column error (1060)
    console.warn('Could not ensure otp columns exist in register table:', err && (err.message || err));
  } else {
    console.log('✅ register table OTP columns checked/added (or already present).');
  }
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

  // 1️⃣ Check total warden count
  db.query("SELECT COUNT(*) AS total FROM warden", (err, result) => {
    if (err) return res.status(500).json({ message: "DB error" });

    if (result[0].total >= 5) {
      return res.status(403).json({ message: "Warden registration limit reached (5/5)" });
    }

    // 2️⃣ Check username or email duplicate
    const checkSql = "SELECT 1 FROM warden WHERE username = ? OR email = ?";
    db.query(checkSql, [username, email], (err2, rows) => {
      if (err2) return res.status(500).json({ message: "DB error" });

      if (rows.length > 0) {
        return res.status(409).json({ message: "Username or Email already exists" });
      }

      // 3️⃣ Insert new warden
      const insertSql = `
        INSERT INTO warden (fullname, username, email, contact, password, created_at)
        VALUES (?, ?, ?, ?, ?, NOW())
      `;

      db.query(insertSql, [fullname, username, email, contact, password], (err3) => {
        if (err3) return res.status(500).json({ message: "DB Insert error" });

        return res.json({ message: "Warden account created successfully" });
      });
    });
  });
});


// ----------------------------------------------------------------
// AUTHENTICATION & REGISTRATION ENDPOINTS
// ------------------------------------------------------------------

// SEND OTP (updated to use Brevo)
// Note: This logic mirrors your previous flow (username uniqueness checks) but uses Brevo transmitter.
app.post("/send-otp", async (req, res) => {
  const { email, username } = req.body;

  if (!email || !username) {
    return res.status(400).json({ message: "Email and username are required" });
  }

  // 1. Check if user already exists (and is verified - no OTP/expired)
  // Or check if user exists but has an expired/null OTP
  const sqlCheck = `
    SELECT * FROM register 
    WHERE username = ? OR email = ? 
    LIMIT 1
  `;
  db.query(sqlCheck, [username, email], async (err, results) => {
    if (err) {
      console.error("❌ DB Error during send-otp check:", err);
      return res.status(500).json({ message: "Database error" });
    }

    // Existing and verified user (no OTP) or existing user with expired OTP
    if (results.length > 0 && (!results[0].otp || new Date(results[0].otp_expires_at) < new Date())) {
      const existingUser = results[0];
      if (existingUser.username === username && existingUser.email === email) {
        // User exists, generate new OTP
      } else if (existingUser.username === username) {
        return res.status(409).json({ message: "❌ Username is already registered with a different email." });
      } else if (existingUser.email === email) {
        return res.status(409).json({ message: "❌ Email is already registered with a different username." });
      }
    }

    // 2. Generate OTP (6-digit)
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 5 * 60000); // 5 minutes

    // 3. Send the email
    const emailRes = await sendOTPEmailBrevo(email, otp);

    if (!emailRes.success) {
      return res.status(500).json({ message: `❌ Failed to send OTP email: ${emailRes.message || 'Check server logs.'}` });
    }

    // 4. Update/Insert user with OTP and expiry
    const sqlInsertOrUpdate = `
      INSERT INTO register (username, email, otp, otp_expires_at) 
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE 
      email = VALUES(email), otp = VALUES(otp), otp_expires_at = VALUES(otp_expires_at)
    `;

    db.query(sqlInsertOrUpdate, [username, email, otp, otpExpires], (errUpdate) => {
      if (errUpdate) {
        console.error("❌ DB Error during send-otp update:", errUpdate);
        return res.status(500).json({ message: "Database error updating OTP" });
      }
      return res.json({ message: "✅ OTP sent to email. Please verify." });
    });
  });
});

// REGISTER (verify OTP & complete registration)
app.post("/register", (req, res) => {
  const { username, email, password, gender, contact, otp } = req.body;

  if (!username || !email || !password || !gender || !contact || !otp) {
    return res.status(400).json({ message: "All fields and OTP are required" });
  }

  // Check OTP validity and expiry
  const verifySql = `
    SELECT username FROM register 
    WHERE email = ? AND otp = ? AND otp_expires_at > NOW()
  `;

  db.query(verifySql, [email, otp], (err, results) => {
    if (err) {
      console.error("❌ DB Error during OTP verification:", err);
      return res.status(500).json({ message: "Database error" });
    }

    if (results.length === 0) {
      // Check if OTP is just invalid/expired for existing account
      const checkUserSql = "SELECT 1 FROM register WHERE email = ?";
      db.query(checkUserSql, [email], (checkErr, userCheck) => {
        if (userCheck && userCheck.length > 0) {
          return res.status(401).json({ message: "❌ Invalid or Expired OTP. Please try again." });
        } else {
          return res.status(400).json({ message: "❌ Account not found." });
        }
      });
      return;
    }

    // OTP is valid, complete registration
    const updateSql = `
      UPDATE register 
      SET password = ?, gender = ?, contact = ?, otp = NULL, otp_expires_at = NULL, registered_at = NOW()
      WHERE email = ?
    `;

    db.query(updateSql, [password, gender, contact, email], (updateErr) => {
      if (updateErr) {
        console.error("❌ DB Error during registration completion:", updateErr);
        // Note: The original provided code did not have unique checks for contact/username/email in the register step, 
        // relying only on the send-otp stage for username/email unique checks.
        // If a duplicate username error (ER_DUP_ENTRY) occurs here, it's because the username was used in send-otp 
        // but another user sneaked in. We will return a generic error or refine the flow.
        return res.status(500).json({ message: "Database error during final registration." });
      }

      // Automatically initialize payment status to Pending
      const paymentSql = "REPLACE INTO payment_status (username, status) VALUES (?, 'Pending')";
      db.query(paymentSql, [username], (pErr) => {
        if (pErr) console.warn("Could not set initial payment status for new user:", username, pErr);
      });


      return res.json({ message: "✅ Registration successful. Redirecting to details..." });
    });
  });
});


// LOGIN endpoint (with visitor logs)
// Strict case-sensitive login
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    // Log failure attempt (without username/password)
    const logSqlFail = "INSERT INTO visitor_logs (username, status, ip_address) VALUES (?, ?, ?)";
    db.query(logSqlFail, ['N/A', 'Fail: Missing credentials', req.ip], () => {});

    return res.status(400).json({ message: "Username and password are required" });
  }

  // 1. Check if user is a regular student or an admin.
  // We assume 'admin' is a hardcoded username for admin login for this simple log.
  const isAdmin = username.toLowerCase() === 'admin';

  // 2. Attempt login
  let sql;
  if (isAdmin) {
    // NOTE: Hardcoded admin credentials are a security risk! Change this in a real environment!
    // This assumes an 'admin' user with a predefined password check.
    // In this simplified setup, we'll check against a hardcoded env variable or similar, 
    // but since we don't see that check, we will only check against the database for 'register' table for now, 
    // unless 'admin' is specifically handled in register table.
    // Assuming for now, 'admin' is a student/user in 'register' table.
    sql = "SELECT username, password, gender, email FROM register WHERE username = ? AND password = ?";
  } else {
    // Regular user login
    sql = "SELECT username, password, gender, email FROM register WHERE username = ? AND password = ?";
  }

  db.query(sql, [username, password], (err, results) => {
    if (err) {
      console.error("❌ DB Error during login:", err);
      return res.status(500).json({ message: "Database error" });
    }

    if (results.length === 0) {
      // Log failure attempt
      const logSqlFail = "INSERT INTO visitor_logs (username, status, ip_address) VALUES (?, ?, ?)";
      db.query(logSqlFail, [username, 'Fail: Invalid credentials', req.ip], () => {});

      return res.status(401).json({ message: "❌ Invalid username or password" });
    }

    // Log success
    const logSqlSuccess = "INSERT INTO visitor_logs (username, status, ip_address) VALUES (?, ?, ?)";
    db.query(logSqlSuccess, [username, 'Success', req.ip], () => {});

    // Successful login - return user data and role.
    const user = results[0];
    const role = (user.username.toLowerCase() === 'admin') ? 'admin' : 'student';

    res.json({
      message: "✅ Login successful!",
      role: role,
      user: {
        username: user.username,
        email: user.email,
        gender: user.gender,
        isAdmin: role === 'admin'
      },
    });
  });
});


// WARDEN LOGIN
app.post("/warden/login", (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: "Username and password are required" });
  }

  const sql = "SELECT username, password, email, contact, IFNULL(approved,0) AS approved FROM warden WHERE username = ? AND password = ?";

  db.query(sql, [username, password], (err, results) => {
    if (err) {
      console.error("❌ DB Error during warden login:", err);
      return res.status(500).json({ message: "Database error" });
    }

    if (results.length === 0) {
      return res.status(401).json({ message: "❌ Invalid username or password" });
    }

    const warden = results[0];

    if (warden.approved === 0) {
      return res.status(403).json({ message: "❌ Your warden account is pending admin approval." });
    }

    // Successful login
    res.json({
      message: "✅ Warden login successful!",
      role: 'warden',
      user: {
        username: warden.username,
        email: warden.email,
        contact: warden.contact,
      },
    });
  });
});


// FORGOT PASSWORD - STEP 1: Send OTP
app.post("/forgot-send-otp", async (req, res) => {
  const { identifier } = req.body; // Can be email or username

  if (!identifier) {
    return res.status(400).json({ message: 'Email or Username is required.' });
  }

  // 1. Find user in register table
  const findSql = "SELECT username, email FROM register WHERE email = ? OR username = ? LIMIT 1";
  db.query(findSql, [identifier, identifier], async (err, results) => {
    if (err) {
      console.error('DB error in /forgot-send-otp', err);
      return res.status(500).json({ message: 'Database error' });
    }
    if (!results || results.length === 0) {
      return res.status(404).json({ message: '❌ No account found with that email/username.' });
    }

    const user = results[0];
    const email = user.email;
    if (!email) {
      return res.status(400).json({ message: '❌ This account has no email associated for OTP.' });
    }

    // 2. Generate OTP (6-digit)
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 5 * 60000); // 5 minutes

    // 3. Send the email
    const emailRes = await sendOTPEmailBrevo(email, otp);

    if (!emailRes.success) {
      return res.status(500).json({ message: `❌ Failed to send OTP email: ${emailRes.message || 'Check server logs.'}` });
    }

    // 4. Update user with OTP and expiry
    const sqlUpdate = `
      UPDATE register 
      SET otp = ?, otp_expires_at = ?
      WHERE email = ?
    `;

    db.query(sqlUpdate, [otp, otpExpires, email], (errUpdate) => {
      if (errUpdate) {
        console.error("❌ DB Error during forgot-send-otp update:", errUpdate);
        return res.status(500).json({ message: "Database error updating OTP" });
      }
      return res.json({ message: "✅ OTP sent to email. Please check your inbox." });
    });
  });
});

// FORGOT PASSWORD - STEP 2: Reset Password
app.post("/forgot-reset-password", (req, res) => {
  const { identifier, otp, newPassword } = req.body;

  if (!identifier || !otp || !newPassword) {
    return res.status(400).json({ message: 'Identifier, OTP, and new password are required.' });
  }

  // 1. Check OTP validity and expiry for the identifier
  const sqlCheck = `
    SELECT username, email FROM register 
    WHERE (email = ? OR username = ?) AND otp = ? AND otp_expires_at > NOW()
    LIMIT 1
  `;
  db.query(sqlCheck, [identifier, identifier, otp], (err, results) => {
    if (err) {
      console.error('DB error forgot-reset-password check:', err);
      return res.status(500).json({ message: 'Database error' });
    }

    if (!results || results.length === 0) {
      return res.status(400).json({ message: '❌ Invalid or Expired OTP. Please try again.' });
    }

    const email = results[0].email;

    // 2. Update password and clear OTP
    const sqlUpdate = `
      UPDATE register 
      SET password = ?, otp = NULL, otp_expires_at = NULL 
      WHERE email = ?
    `;
    db.query(sqlUpdate, [newPassword, email], (uErr) => {
      if (uErr) {
        console.error('DB error updating password:', uErr);
        return res.status(500).json({ message: 'Database error updating password.' });
      }
      return res.json({ message: '✅ Password updated successfully.' });
    });
  });
});

// ----------------------------------------------------------------
// WARDEN FORGOT PASSWORD ENDPOINTS
// ----------------------------------------------------------------

// WARDEN FORGOT PASSWORD - STEP 1: Send OTP
app.post("/warden/forgot-send-otp", async (req, res) => {
  const { identifier } = req.body; // Can be email or username

  if (!identifier) {
    return res.status(400).json({ message: 'Email or Username is required.' });
  }

  // 1. Find user in warden table
  const findSql = "SELECT username, email FROM warden WHERE email = ? OR username = ? LIMIT 1";
  db.query(findSql, [identifier, identifier], async (err, results) => {
    if (err) {
      console.error('DB error in /warden/forgot-send-otp', err);
      return res.status(500).json({ message: 'Database error' });
    }
    if (!results || results.length === 0) {
      return res.status(404).json({ message: '❌ No warden account found with that email/username.' });
    }

    const user = results[0];
    const email = user.email;
    if (!email) {
      return res.status(400).json({ message: '❌ This account has no email associated for OTP.' });
    }

    // 2. Generate OTP (6-digit)
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 5 * 60000); // 5 minutes

    // 3. Send the email
    const emailRes = await sendOTPEmailBrevo(email, otp);

    if (!emailRes.success) {
      return res.status(500).json({ message: `❌ Failed to send OTP email: ${emailRes.message || 'Check server logs.'}` });
    }

    // 4. Update user with OTP and expiry
    const sqlUpdate = `
      UPDATE warden 
      SET otp = ?, otp_expires_at = ?
      WHERE email = ?
    `;

    db.query(sqlUpdate, [otp, otpExpires, email], (errUpdate) => {
      if (errUpdate) {
        console.error("❌ DB Error during warden forgot-send-otp update:", errUpdate);
        return res.status(500).json({ message: "Database error updating OTP" });
      }
      return res.json({ message: "✅ OTP sent to warden email. Please check your inbox." });
    });
  });
});

// WARDEN FORGOT PASSWORD - STEP 2: Verify OTP
app.post("/warden/forgot-verify-otp", (req, res) => {
  const { identifier, otp } = req.body;

  if (!identifier || !otp) {
    return res.status(400).json({ message: 'Identifier and OTP are required.' });
  }

  // Check OTP validity and expiry for the identifier
  const sqlCheck = `
    SELECT username, email FROM warden 
    WHERE (email = ? OR username = ?) AND otp = ? AND otp_expires_at > NOW()
    LIMIT 1
  `;
  db.query(sqlCheck, [identifier, identifier, otp], (err, results) => {
    if (err) {
      console.error('DB error warden forgot-verify-otp check:', err);
      return res.status(500).json({ message: 'Database error' });
    }

    if (!results || results.length === 0) {
      return res.status(400).json({ message: '❌ Invalid or Expired OTP. Please request OTP again.' });
    }

    // OTP is valid and not expired
    return res.json({ message: '✅ OTP verified successfully.', username: results[0].username });
  });
});

// WARDEN FORGOT PASSWORD - STEP 3: Reset Password
app.post("/warden/forgot-reset-password", (req, res) => {
  const { identifier, otp, newPassword } = req.body;

  if (!identifier || !otp || !newPassword) {
    return res.status(400).json({ message: 'Identifier, OTP, and new password are required.' });
  }

  // 1. Check OTP validity and expiry for the identifier
  const sqlCheck = `
    SELECT username, email FROM warden 
    WHERE (email = ? OR username = ?) AND otp = ? AND otp_expires_at > NOW()
    LIMIT 1
  `;
  db.query(sqlCheck, [identifier, identifier, otp], (err, results) => {
    if (err) {
      console.error('DB error warden forgot-reset-password check:', err);
      return res.status(500).json({ message: 'Database error' });
    }

    if (!results || results.length === 0) {
      return res.status(400).json({ message: '❌ Invalid or Expired OTP. Please request OTP again.' });
    }

    const email = results[0].email;

    // 2. Update password and clear OTP
    const sqlUpdate = `
      UPDATE warden 
      SET password = ?, otp = NULL, otp_expires_at = NULL 
      WHERE email = ?
    `;
    db.query(sqlUpdate, [newPassword, email], (uErr) => {
      if (uErr) {
        console.error('DB error updating warden password:', uErr);
        return res.status(500).json({ message: 'Database error updating password.' });
      }
      return res.json({ message: '✅ Warden password updated successfully.' });
    });
  });
});


// ----------------------------------------------------------------
// ADMIN ENDPOINTS
// ----------------------------------------------------------------

// Admin: Get Warden Count
app.get("/warden-count", (req, res) => {
  db.query("SELECT COUNT(*) AS total FROM warden", (err, result) => {
    if (err) return res.status(500).json({ message: "DB error", error: err.message });
    res.json({ total: result[0].total });
  });
});

// Admin: Get Pending Warden Applications (Not yet approved)
app.get('/admin/wardens/pending', (req, res) => {
  const sql = `
    SELECT id, fullname, username, email, contact, created_at
    FROM warden
    WHERE IFNULL(approved, 0) = 0
    ORDER BY created_at DESC
  `;
  db.query(sql, (err, results) => {
    if (err) {
      console.error('/admin/wardens/pending query error', err);
      return res.status(500).json({ message: 'DB error' });
    }
    res.json(results || []);
  });
});

// Admin: Approve a Warden
app.patch('/admin/wardens/:username/approve', (req, res) => {
  const username = req.params.username;
  // Ensure the column exists first, in case alter table failed earlier.
  db.query(`
    ALTER TABLE warden ADD COLUMN approved TINYINT(1) DEFAULT 0
  `, (alterErr) => {
    if (alterErr && alterErr.errno !== 1060) { // 1060 is 'Duplicate column name'
      console.warn('Could not ensure approved column exists:', alterErr);
    }
    
    // Now perform the update
    const sql = 'UPDATE warden SET approved = 1 WHERE username = ?';
    db.query(sql, [username], (err, result) => {
      if (err) {
        console.error('Error approving warden:', err);
        return res.status(500).json({ message: 'DB error' });
      }
      if (result.affectedRows === 0) return res.status(404).json({ message: 'Warden not found' });
      return res.json({ message: 'Warden approved successfully' });
    });
  });
});

// Admin: Reject/Delete a Warden (removes the entire record)
app.delete('/admin/wardens/:username/reject', (req, res) => {
  const username = req.params.username;
  const sql = 'DELETE FROM warden WHERE username = ? AND IFNULL(approved, 0) = 0'; // Only allow deleting pending ones
  
  db.query(sql, [username], (err, result) => {
    if (err) {
      console.error('Error rejecting warden:', err);
      return res.status(500).json({ message: 'DB error' });
    }
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Warden not found or already approved' });
    return res.json({ message: 'Warden rejected and removed. They must re-register.' });
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

    // Get the latest job application for each warden
    const sqlApps = `
      SELECT 
        ja.warden_username, ja.job_role, ja.shift, ja.applied_at
      FROM job_applications ja
      JOIN (
        SELECT 
          warden_username, MAX(applied_at) AS latest_applied 
        FROM job_applications 
        WHERE warden_username IN (?)
        GROUP BY warden_username
      ) lm ON lm.warden_username = ja.warden_username AND lm.latest_applied = ja.applied_at
    `;
    
    db.query(sqlApps, [usernames], (aErr, aResults) => {
      if (aErr) {
        console.error('/admin/wardens/all job_applications query error', aErr);
        // Fallback: return only warden list if job application lookup fails
        return res.json(wResults);
      }
      
      const appMap = aResults.reduce((acc, app) => {
        acc[app.warden_username] = {
          job_role: app.job_role,
          shift: app.shift,
          applied_at: app.applied_at
        };
        return acc;
      }, {});
      
      const combinedResults = wResults.map(warden => ({
        ...warden,
        ...appMap[warden.username]
      }));
      
      res.json(combinedResults);
    });
  });
});

// Admin: list only approved wardens (for job slot counting)
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

    // Get the latest job application for each warden
    const sqlApps = `
      SELECT 
        ja.warden_username, ja.job_role, ja.shift, ja.applied_at
      FROM job_applications ja
      JOIN (
        SELECT 
          warden_username, MAX(applied_at) AS latest_applied 
        FROM job_applications 
        WHERE warden_username IN (?)
        GROUP BY warden_username
      ) lm ON lm.warden_username = ja.warden_username AND lm.latest_applied = ja.applied_at
    `;
    
    db.query(sqlApps, [usernames], (aErr, aResults) => {
      if (aErr) {
        console.error('/admin/wardens/approved job_applications query error', aErr);
        // Fallback: return only warden list if job application lookup fails
        return res.json(wResults);
      }
      
      const appMap = aResults.reduce((acc, app) => {
        acc[app.warden_username] = {
          job_role: app.job_role,
          shift: app.shift,
          applied_at: app.applied_at
        };
        return acc;
      }, {});
      
      const combinedResults = wResults.map(warden => ({
        ...warden,
        ...appMap[warden.username]
      }));
      
      res.json(combinedResults);
    });
  });
});

// -----------------------------
// Job application submit endpoint
// -----------------------------
app.post('/apply-job', (req, res) => {
  const { username, job_role, shift } = req.body;

  if (!username || !job_role || !shift) return res.status(400).json({ message: 'Missing required fields' });

  // 1. Get warden details (fullname, email, contact)
  const wardenSql = 'SELECT fullname, email, contact FROM warden WHERE username = ?';
  db.query(wardenSql, [username], (err, result) => {
    if (err) return res.status(500).json({ message: 'DB error' });
    if (!result || result.length === 0) return res.status(404).json({ message: 'Warden not found' });

    const { fullname, email, contact } = result[0];

    // 2. Insert application
    const insertSql = `
      INSERT INTO job_applications (warden_username, fullname, email, contact, job_role, shift)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    db.query(insertSql, [username, fullname, email, contact, job_role, shift], (err2, result2) => {
      if (err2) {
        console.error('apply-job insert error', err2);
        return res.status(500).json({ message: 'DB insert error' });
      }

      return res.status(201).json({ message: 'Job application submitted successfully', id: result2.insertId });
    });
  });
});

// Admin: Get occupied job slots (count of latest applications)
app.get('/api/occupied-job-slots', (req, res) => {
  // Select all job applications and count them, grouped by role and shift
  // NOTE: This counts ALL applications. A more accurate count for 'occupied slots' 
  // should ideally check only the latest application for each *approved* warden.
  // For simplicity based on typical request, we count all.

  // A more robust query (assuming job_applications stores the *current* role/shift):
  const sql = `
    SELECT 
        LOWER(ja.job_role) AS job_role, 
        LOWER(ja.shift) AS shift, 
        COUNT(DISTINCT ja.warden_username) AS cnt
    FROM job_applications ja
    JOIN warden w ON w.username = ja.warden_username AND w.approved = 1
    JOIN (
        -- Subquery to find the latest application ID for each approved warden
        SELECT 
            warden_username, 
            MAX(applied_at) AS latest_applied_at
        FROM job_applications
        GROUP BY warden_username
    ) latest ON latest.warden_username = ja.warden_username AND latest.latest_applied_at = ja.applied_at
    GROUP BY LOWER(ja.job_role), LOWER(ja.shift)
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

  // Only delete users who have not completed registration (i.e., password is NULL)
  const sql = "DELETE FROM register WHERE username = ? AND password IS NULL";
  db.query(sql, [username], (err, result) => {
    if (err) {
      console.error('register/cancel delete error', err);
      return res.status(500).json({ ok: false, message: 'DB error' });
    }
    
    if (result.affectedRows > 0) {
      console.log(`✅ Cancelled pending registration for ${username}`);
      return res.json({ ok: true, message: 'Registration cancelled' });
    } else {
      // User might be fully registered or username didn't exist
      return res.status(404).json({ ok: false, message: 'Pending registration not found or already completed.' });
    }
  });
});

// ------------------------------------------------------------------
// USER/STUDENT DATA & ROOM endpoints (kept as original)
// ------------------------------------------------------------------

// Get all users
app.get("/users", (req, res) => {
  const sql = "SELECT username, gender, email, contact FROM register WHERE username IS NOT NULL";
  db.query(sql, (err, results) => {
    if (err) return res.status(500).json({ message: "DB error" });
    res.json(results);
  });
});

// Get single user by username
app.get("/register/:username", (req, res) => {
  const username = req.params.username;
  const sql = "SELECT username, gender, email, contact FROM register WHERE username = ?";
  db.query(sql, [username], (err, results) => {
    if (err) return res.status(500).json({ message: "DB error" });
    if (results.length === 0) return res.status(404).json({ message: "User not found" });
    res.json(results[0]);
  });
});

// Get unassigned users (users in register but not in rooms table)
app.get("/unassigned-users", (req, res) => {
  const sql = `
    SELECT r.username, r.gender, r.contact, r.email
    FROM register r
    LEFT JOIN rooms rm ON r.username = rm.username
    WHERE rm.username IS NULL AND r.password IS NOT NULL
  `;
  db.query(sql, (err, results) => {
    if (err) return res.status(500).json({ message: "DB error" });
    if (results.length === 0) {
      return res.status(200).json([]);
    }
    res.json(results);
  });
});


// ROOM MANAGEMENT ENDPOINTS (Require rooms table to exist)
const createRoomsTable = `
  CREATE TABLE IF NOT EXISTS rooms (
    room_no VARCHAR(50) NOT NULL,
    bed_no INT NOT NULL,
    username VARCHAR(100) UNIQUE,
    PRIMARY KEY (room_no, bed_no),
    INDEX idx_username (username)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;
db.query(createRoomsTable, (err) => {
  if (err) console.error("❌ Rooms table create error", err);
  else console.log("✅ Rooms table ready");
});

// Get Room Information (Capacity, Occupancy, Gender)
app.get("/rooms", (req, res) => {
  // 1. Get capacity (count distinct room_no/bed_no pairs)
  const capacitySql = "SELECT COUNT(*) AS total_capacity FROM rooms";
  
  // 2. Get occupancy (count rows where username is not null)
  const occupancySql = `
    SELECT 
        COUNT(*) AS occupied,
        SUM(CASE WHEN r.gender = 'Male' THEN 1 ELSE 0 END) AS occupied_male,
        SUM(CASE WHEN r.gender = 'Female' THEN 1 ELSE 0 END) AS occupied_female
    FROM rooms rm
    JOIN register r ON rm.username = r.username
    WHERE rm.username IS NOT NULL;
  `;

  // 3. Get room details (room_no, available beds, assigned gender)
  const detailsSql = `
    SELECT 
      rm.room_no, 
      COUNT(rm.bed_no) AS capacity, 
      SUM(CASE WHEN rm.username IS NOT NULL THEN 1 ELSE 0 END) AS occupied_count,
      MAX(r.gender) AS assigned_gender
    FROM rooms rm
    LEFT JOIN register r ON rm.username = r.username
    GROUP BY rm.room_no
    ORDER BY rm.room_no
  `;

  const results = {};

  db.query(capacitySql, (cErr, cRes) => {
    if (cErr) { console.error("Room capacity error:", cErr); return res.status(500).json({ message: "DB error" }); }
    results.total_capacity = cRes[0].total_capacity;

    db.query(occupancySql, (oErr, oRes) => {
      if (oErr) { console.error("Room occupancy error:", oErr); return res.status(500).json({ message: "DB error" }); }
      results.occupied = oRes[0].occupied;
      results.occupied_male = Number(oRes[0].occupied_male);
      results.occupied_female = Number(oRes[0].occupied_female);
      results.available = results.total_capacity - results.occupied;

      db.query(detailsSql, (dErr, dRes) => {
        if (dErr) { console.error("Room details error:", dErr); return res.status(500).json({ message: "DB error" }); }
        results.rooms = dRes.map(row => ({
          room_no: row.room_no,
          capacity: row.capacity,
          occupied_count: row.occupied_count,
          available_count: row.capacity - row.occupied_count,
          assigned_gender: row.assigned_gender
        }));
        
        res.json(results);
      });
    });
  });
});

// Admin endpoint to initialize rooms (DANGER: Wipes current room data)
app.post("/initialize-rooms", (req, res) => {
  const { roomDetails } = req.body; // e.g., [{ room_no: 'A101', beds: 4 }, ...]

  if (!roomDetails || roomDetails.length === 0) {
    return res.status(400).json({ message: "Room details array is required" });
  }

  // 1. Clear existing rooms
  db.query("DELETE FROM rooms", (delErr) => {
    if (delErr) { console.error("Error clearing rooms:", delErr); return res.status(500).json({ message: "DB error during clear" }); }
    
    // 2. Prepare insert values
    const insertValues = [];
    roomDetails.forEach(room => {
      if (room.room_no && typeof room.beds === 'number' && room.beds > 0) {
        for (let i = 1; i <= room.beds; i++) {
          insertValues.push([room.room_no, i, null]); // room_no, bed_no, username
        }
      }
    });

    if (insertValues.length === 0) {
      return res.status(200).json({ message: "Rooms cleared, but no new valid rooms to insert." });
    }

    // 3. Bulk insert new room data
    const insertSql = "INSERT INTO rooms (room_no, bed_no, username) VALUES ?";
    db.query(insertSql, [insertValues], (insErr, result) => {
      if (insErr) { console.error("Error inserting rooms:", insErr); return res.status(500).json({ message: "DB error during insert" }); }
      
      return res.json({ 
        message: `✅ Rooms initialized successfully! Total rooms created: ${roomDetails.length}. Total beds created: ${result.affectedRows}.` 
      });
    });
  });
});


// Get student's assigned room
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

// Assign room to a user
app.post("/assign-room", (req, res) => {
  const { username, room_no } = req.body;

  if (!username || !room_no) {
    return res.status(400).json({ message: "⚠ Missing student and room data" });
  }

  // 1. Get student gender (to check room gender compatibility)
  const getStudentGenderSql = "SELECT gender FROM register WHERE username = ?";
  db.query(getStudentGenderSql, [username], (err, studentResults) => {
    if (err) return res.status(500).json({ message: "DB error fetching student gender" });
    if (studentResults.length === 0) return res.status(404).json({ message: "Student not found" });

    const studentGender = studentResults[0].gender;

    // 2. Check room's current assigned gender (based on existing occupants)
    const getRoomGenderSql = `
      SELECT r.gender
      FROM rooms rm
      JOIN register r ON rm.username = r.username
      WHERE rm.room_no = ? AND rm.username IS NOT NULL
      LIMIT 1
    `;
    db.query(getRoomGenderSql, [room_no], (rErr, roomGenderResults) => {
      if (rErr) return res.status(500).json({ message: "DB error checking room gender" });

      const roomAssignedGender = roomGenderResults.length > 0 ? roomGenderResults[0].gender : null;

      // Gender compatibility check
      if (roomAssignedGender && roomAssignedGender !== studentGender) {
        return res.status(409).json({ message: `❌ Room ${room_no} is already assigned to a ${roomAssignedGender} student. Cannot mix genders.` });
      }

      // 3. Find an available bed in the room
      const findBedSql = "SELECT bed_no FROM rooms WHERE room_no = ? AND username IS NULL LIMIT 1";
      db.query(findBedSql, [room_no], (bErr, bedResults) => {
        if (bErr) return res.status(500).json({ message: "DB error finding available bed" });
        if (bedResults.length === 0) return res.status(409).json({ message: `❌ Room ${room_no} is full.` });

        const bed_no = bedResults[0].bed_no;

        // 4. Check if student is already assigned a room
        db.query('SELECT 1 FROM rooms WHERE username = ? LIMIT 1', [username], (aErr, aResults) => {
          if (aErr) return res.status(500).json({ message: "DB error checking existing assignment" });
          if (aResults.length > 0) return res.status(400).json({ message: "❌ Student already has an assigned room." });

          // 5. Perform the assignment
          const assignSql = "UPDATE rooms SET username = ? WHERE room_no = ? AND bed_no = ?";
          db.query(assignSql, [username, room_no, bed_no], (assignErr) => {
            if (assignErr) {
              console.error("❌ DB Error during room assignment:", assignErr);
              return res.status(500).json({ message: "Database error during assignment" });
            }

            // 6. Send success response
            return res.json({ 
              message: `✅ Room ${room_no}, Bed ${bed_no} assigned successfully to ${username}`,
              room_no: room_no,
              bed_no: bed_no
            });
          });
        });
      });
    });
  });
});


// Unassign room from a user
app.post("/unassign-room", (req, res) => {
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ message: "⚠ Missing username" });
  }

  const sql = "UPDATE rooms SET username = NULL WHERE username = ?";
  db.query(sql, [username], (err, result) => {
    if (err) {
      console.error("❌ DB Error during room unassignment:", err);
      return res.status(500).json({ message: "Database error during unassignment" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: `❌ Student ${username} was not assigned a room.` });
    }

    res.json({ message: `✅ Assignment removed for ${username}` });
  });
});

// ------------------------------------------------------------------
// STUDENT ACADEMIC/PREVIOUS DETAILS ENDPOINTS
// ------------------------------------------------------------------
// ------------------------------------------------------------------
// STUDENT ACADEMIC/PREVIOUS DETAILS ENDPOINTS
// ------------------------------------------------------------------
const createStudentDetailsTable = `
  CREATE TABLE IF NOT EXISTS student_details (
    username VARCHAR(255) PRIMARY KEY, // <-- FIX: Changed from VARCHAR(100) to VARCHAR(255) for FK compatibility
    email VARCHAR(100),
    contact VARCHAR(15),
    course VARCHAR(100),
    year VARCHAR(50),
    semester VARCHAR(50),
    prev_college VARCHAR(255),
    prev_result VARCHAR(100),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (username) REFERENCES register(username) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;
db.query(createStudentDetailsTable, (err) => {
  if (err) console.error("❌ student_details table create error", err);
  else console.log("✅ student_details table ready");
});


// Save/Update academic details
app.post("/save-details", (req, res) => {
  const { username, email, contact, course, year, semester, prevCollege, prevResult } = req.body;

  if (!username || !email || !contact) {
    // Basic check, username is the key. Email/contact are also stored for completeness.
    return res.status(400).json({ message: "⚠ Missing username, email, or contact" });
  }

  // Use REPLACE INTO to insert or update the details based on the primary key (username)
  const sql = `
    REPLACE INTO student_details 
    (username, email, contact, course, year, semester, prev_college, prev_result) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;
  db.query(sql, [username, email, contact, course, year, semester, prevCollege, prevResult], (err) => {
    if (err) {
      console.error("❌ Database Insert/Update Error (save-details):", err);
      // Check for foreign key error specifically (ER_NO_REFERENCED_ROW_2)
      if (err.code === 'ER_NO_REFERENCED_ROW_2') {
        return res.status(404).json({ message: "Student username not found in main register table." });
      }
      return res.status(500).json({ message: "Database error saving details" });
    }
    return res.status(200).json({ message: "✅ Academic details saved successfully" });
  });
});

// Get academic details
app.get("/details/:username", (req, res) => {
  const username = req.params.username;
  const sql = "SELECT course, year, semester, prev_college, prev_result FROM student_details WHERE username = ?";
  db.query(sql, [username], (err, results) => {
    if (err) return res.status(500).json({ message: "DB error" });
    if (results.length === 0) {
      return res.status(404).json({ message: "Details not found" });
    }
    res.json(results[0]);
  });
});


// ------------------------------------------------------------------
// NOTIFICATIONS
// ------------------------------------------------------------------

// POST a new notification (Admin/Warden function)
app.post('/notifications', (req, res) => {
  const { username, subject, message, desired_room } = req.body;
  if (!username || !subject || !message) {
    return res.status(400).json({ message: 'Missing username, subject, or message' });
  }
  
  const sql = `
    INSERT INTO notifications (username, subject, message, desired_room) 
    VALUES (?, ?, ?, ?)
  `;
  db.query(sql, [username, subject, message, desired_room || null], (err, result) => {
    if (err) {
      console.error('Error inserting notification:', err);
      return res.status(500).json({ message: 'DB error' });
    }
    res.status(201).json({ id: result.insertId, message: 'Notification created' });
  });
});

// GET notifications for a specific user
app.get('/notifications/:username', (req, res) => {
  const username = req.params.username;
  const sql = `
    SELECT id, username, subject, message, desired_room, is_read, created_at 
    FROM notifications 
    WHERE username = ? 
    ORDER BY created_at DESC
    LIMIT 50
  `;
  db.query(sql, [username], (err, results) => {
    if (err) return res.status(500).json({ message: 'DB error' });
    res.json(results || []);
  });
});

// PATCH to mark a notification as read
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

// ------------------------------------------------------------------
// ADMIN/COMPLAINTS ENDPOINTS (SECURE)
// ------------------------------------------------------------------

// Helper to convert comma-separated string to Array (only for rooms/beds if needed)
function parseRoomInput(roomStr) {
  if (!roomStr) return [];
  return roomStr.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

// POST a complaint (Student or Admin)
app.post('/complaints', (req, res) => {
  const { subject, description, category, location, username, isAdmin } = req.body;
  
  if (!subject || !description || !username) {
    return res.status(400).json({ error: 'Subject, description, and username are required' });
  }

  // Sanitize inputs
  const safeUsername = String(username).trim();
  const safeCategory = (category || '').trim();
  const safeLocation = (location || '').trim();

  // If coming from student flow (isAdmin is explicitly false or missing), check if user exists.
  if (!isAdmin || isAdmin === false) {
    db.query('SELECT 1 FROM register WHERE username = ? LIMIT 1', [safeUsername], (err, results) => {
      if (err) return res.status(500).json({ error: 'DB error checking user' });
      if (results.length === 0) {
        return res.status(403).json({ error: 'Complaint can only be filed by a registered student.' });
      }

      // User is validated as a student -> insert complaint
      const insertSql = `INSERT INTO complaints (subject, description, category, location, username) VALUES (?, ?, ?, ?, ?)`;
      db.query(insertSql, [subject, description, safeCategory, safeLocation, safeUsername], (insErr, insRes) => {
        if (insErr) {
          console.error('Error inserting complaint:', insErr);
          return res.status(500).json({ error: 'Could not save complaint' });
        }
        return res.json({ ok: true, id: insRes.insertId, message: 'Complaint filed successfully' });
      });
    });
  } else { 
    // isAdmin === true -> allow directly to insert complaint (assuming the caller is an authenticated admin/warden)
    const insertSql = `INSERT INTO complaints (subject, description, category, location, username) VALUES (?, ?, ?, ?, ?)`;
    db.query(insertSql, [subject, description, safeCategory, safeLocation, safeUsername], (insErr, insRes) => {
      if (insErr) {
        console.error('Error inserting complaint (admin):', insErr);
        return res.status(500).json({ error: 'Could not save complaint' });
      }
      return res.json({ ok: true, id: insRes.insertId, message: 'Complaint filed successfully (admin)' });
    });
  }
});


// GET all complaints (Admin/Warden function)
app.get('/complaints', (req, res) => {
  const statusFilter = req.query.status; // Optional: 'New', 'In Progress', 'Resolved'
  
  let sql = `
    SELECT id, subject, description, category, location, username, status, created_at 
    FROM complaints
  `;
  const params = [];

  if (statusFilter) {
    sql += ' WHERE status = ?';
    params.push(statusFilter);
  }

  sql += ' ORDER BY created_at DESC';

  db.query(sql, params, (err, results) => {
    if (err) {
      console.error('Error fetching complaints:', err);
      return res.status(500).json({ message: 'Database error fetching complaints' });
    }
    res.json(results || []);
  });
});

// GET complaints for a specific user (Student function)
app.get('/my-complaints/:username', (req, res) => {
  const username = req.params.username;
  const sql = `
    SELECT id, subject, description, category, location, username, status, created_at 
    FROM complaints
    WHERE username = ?
    ORDER BY created_at DESC
  `;

  db.query(sql, [username], (err, results) => {
    if (err) {
      console.error('Error fetching user complaints:', err);
      return res.status(500).json({ message: 'Database error fetching complaints' });
    }
    res.json(results || []);
  });
});

// PATCH to update complaint status (Admin/Warden function)
app.patch('/complaints/:id', (req, res) => {
  const id = req.params.id;
  const { status } = req.body;

  if (!status || !id) {
    return res.status(400).json({ message: 'Missing complaint ID or status' });
  }

  // Basic validation for status values
  const validStatuses = ['New', 'In Progress', 'Resolved', 'Rejected'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ message: 'Invalid status value' });
  }

  const sql = 'UPDATE complaints SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
  db.query(sql, [status, id], (err, result) => {
    if (err) {
      console.error('Error updating complaint status:', err);
      return res.status(500).json({ message: 'Database error updating status' });
    }
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Complaint not found' });
    }
    res.json({ message: 'Status updated successfully' });
  });
});

// DELETE a resolved complaint (Admin/Warden function - clean up)
app.delete('/complaints/:id', (req, res) => {
  const id = req.params.id;
  // Only allow deletion of complaints that are 'Resolved' to prevent accidental loss of active issues.
  const sql = 'DELETE FROM complaints WHERE id = ? AND status = "Resolved"'; 
  db.query(sql, [id], (err, result) => {
    if (err) {
      console.error('Error deleting complaint:', err);
      return res.status(500).json({ message: 'Database error deleting complaint' });
    }
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Complaint not found or not in "Resolved" status' });
    }
    res.json({ message: 'Complaint deleted successfully' });
  });
});


// ----------------------------------------------------------------
// ADMIN DASHBOARD DATA ENDPOINTS
// ----------------------------------------------------------------

// Get count of total users and currently assigned users
app.get('/api/user-stats', (req, res) => {
  const totalSql = 'SELECT COUNT(*) AS total FROM register WHERE password IS NOT NULL'; // Count registered users
  const assignedSql = 'SELECT COUNT(DISTINCT username) AS assigned FROM rooms WHERE username IS NOT NULL'; // Count unique assigned users

  db.query(totalSql, (tErr, tRes) => {
    if (tErr) { console.error('Error fetching total users:', tErr); return res.status(500).json({ error: 'DB error' }); }
    const total = (tRes && tRes[0] && tRes[0].total) ? Number(tRes[0].total) : 0;

    db.query(assignedSql, (aErr, aRes) => {
      if (aErr) { console.error('Error fetching assigned users:', aErr); return res.status(500).json({ error: 'DB error' }); }
      const assigned = (aRes && aRes[0] && aRes[0].assigned) ? Number(aRes[0].assigned) : 0;
      
      res.json({ total_users: total, assigned_users: assigned });
    });
  });
});

// Get count of rooms/beds (total and occupied)
app.get('/api/room-stats', (req, res) => {
  const totalSql = 'SELECT COUNT(*) AS total FROM rooms'; // Total beds
  const occSql = 'SELECT COUNT(*) AS occupied FROM rooms WHERE username IS NOT NULL'; // Occupied beds

  db.query(totalSql, (tErr, tRes) => {
    if (tErr) { console.error('Error fetching total rooms:', tErr); return res.status(500).json({ error: 'DB error' }); }
    const total = (tRes && tRes[0] && tRes[0].total) ? Number(tRes[0].total) : 0;

    db.query(occSql, (oErr, oRes) => {
      if (oErr) { console.error('Error fetching occupied rooms:', oErr); return res.status(500).json({ error: 'DB error' }); }
      const occupied = (oRes && oRes[0] && oRes[0].occupied) ? Number(oRes[0].occupied) : 0;
      
      res.json({ total_beds: total, occupied_beds: occupied, available_beds: total - occupied });
    });
  });
});

// Get count of complaints by status
app.get('/api/complaint-stats', (req, res) => {
  const sql = 'SELECT status, COUNT(*) AS count FROM complaints GROUP BY status';

  db.query(sql, (err, results) => {
    if (err) { console.error('Error fetching complaint stats:', err); return res.status(500).json({ error: 'DB error' }); }
    
    const stats = results.reduce((acc, row) => {
      acc[row.status] = row.count;
      return acc;
    }, { 'New': 0, 'In Progress': 0, 'Resolved': 0, 'Rejected': 0, 'total': 0 });
    
    stats.total = Object.values(stats).reduce((sum, count) => sum + count, 0);

    res.json(stats);
  });
});

// Get count of payments by status
app.get('/api/payment-stats', (req, res) => {
  const sql = 'SELECT status, COUNT(*) AS count FROM payment_status GROUP BY status';

  db.query(sql, (err, results) => {
    if (err) { console.error('Error fetching payment stats:', err); return res.status(500).json({ error: 'DB error' }); }
    
    const stats = results.reduce((acc, row) => {
      acc[row.status] = row.count;
      return acc;
    }, { 'Pending': 0, 'Paid': 0, 'total': 0 });
    
    stats.total = Object.values(stats).reduce((sum, count) => sum + count, 0);

    res.json(stats);
  });
});

// Get user registration dates (for visitor logs)
app.get("/user-registered-at", (req, res) => {
  const sql = "SELECT username, registered_at FROM register WHERE password IS NOT NULL";
  db.query(sql, (err, results) => {
    if (err) {
      console.error("❌ DB Error fetching user details:", err);
      return res.status(500).json({ message: "Database error fetching user details." });
    }
    
    // Map results to { username: registered_at }
    const userMap = results.reduce((acc, user) => {
      if (user.username) {
        acc[user.username] = user.registered_at ? new Date(user.registered_at).toISOString() : null;
      }
      return acc;
    }, {});
    
    res.status(200).json({ users: userMap });
  });
});

// Get visitor logs
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


// ----------------------------------------------------------------
// HEALTH CHECK
// ----------------------------------------------------------------

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
        message: 'Database connected, but simple query failed.'
      });
    }
  });
});

// ----------------------------------------------------------------
// START SERVER
// ----------------------------------------------------------------

// The actual server is started here
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`🌐 Accessible at http://localhost:${PORT}`);
});
