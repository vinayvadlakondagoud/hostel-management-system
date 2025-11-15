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

// ---------- DATABASE CONFIG (FIXED: Using Pool for resilience) ----------
const pool = mysql.createPool({
    host: process.env.DB_HOST || "gateway01.ap-southeast-1.prod.aws.tidbcloud.com",
    user: process.env.DB_USER || "3TQjs6TX5oYMWB1.root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "hms",
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 4000,
    ssl: { rejectUnauthorized: false },
    waitForConnections: true,  // Wait for available connections if none are free
    connectionLimit: 10,       // Max number of connections in the pool
    queueLimit: 0,
    connectTimeout: 10000,
});

// 'db' is now the pool (callback style compatible for existing routes)
const db = pool;

// Check connection health once and then initialize tables
db.getConnection((err, connection) => {
    if (err) {
        console.error("❌ Database Pool connection failed on startup:", err && (err.stack || err.message || err));
    } else {
        console.log("✅ Database Pool initialized and ready (connection acquired & released)");
        connection.release();
        // Now call the initialization function to create tables sequentially
        initializeDatabase();
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
// Database initialization (Fixed: uses async/await on the Pool)
// ------------------------------------------------------------------
async function initializeDatabase() {
    console.log('--- Starting Database Initialization ---');
    // Use the promise wrapper for sequential DDL operations
    const dbPromise = db.promise(); 

    // Query definitions (kept as in your original file)
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
    const createPaymentTable = `
        CREATE TABLE IF NOT EXISTS payment_status (
            username VARCHAR(100) PRIMARY KEY,
            status VARCHAR(20) DEFAULT 'Pending',
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;
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
    const alterRegisterTable = `
        ALTER TABLE register 
        ADD COLUMN registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    `;
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

    // Execute queries sequentially
    try {
        await dbPromise.execute(createComplaintsTable);
        console.log('✅ Complaints table is ready');
    } catch (cErr) {
        console.error('Could not ensure complaints table exists:', cErr.message);
    }

    try {
        await dbPromise.execute(createPaymentTable);
        console.log('✅ Payment status table is ready');
    } catch (pErr) {
        console.error('Could not ensure payment_status table exists:', pErr.message);
    }
    
    try {
        await dbPromise.execute(createNotificationsTable);
        console.log('✅ Notifications table ready');
    } catch (nErr) {
        console.error('Could not ensure notifications table exists:', nErr.message);
    }

    try {
        await dbPromise.execute(alterRegisterTable);
        console.log('✅ Register table structure checked/updated for registered_at.');
    } catch (aErr) {
        // ignore duplicate column errors (ER_DUP_FIELDNAME / 1060)
        if (aErr.code !== 'ER_DUP_FIELDNAME' && aErr.errno !== 1060) {
            console.warn('Could not ensure registered_at column exists in register table:', aErr.message);
        } else {
            console.log('✅ Register table structure checked/updated for registered_at (or already present).');
        }
    }
    
    try {
        await dbPromise.execute(createVisitorLogsTable);
        console.log('✅ Visitor logs table is ready');
    } catch (vErr) {
        console.error('Could not ensure visitor_logs table exists:', vErr.message);
    }
    
    try {
        await dbPromise.execute(createPaymentRequestsTable);
        console.log('✅ payment_requests table ready');
    } catch (prErr) {
        console.error('Could not ensure payment_requests table exists:', prErr.message);
    }

    console.log('--- Database Initialization Complete ---');
}
// ------------------------------------------------------------------


// ------------------------------------------------------------------
// PAYMENT STATUS
// ------------------------------------------------------------------
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
    return res.status(400).json({ message: 'Payment already marked as Paid.' });
}
if (psResults && psResults.length > 0 && psResults[0].status === 'Pending') {
    // Check if an existing Pending request already exists (less critical check, but good to have)
    db.query('SELECT id FROM payment_requests WHERE username = ? AND status = ?', [username, 'Pending'], (reqErr, reqResults) => {
        if (reqErr) {
            console.error('Error checking payment_requests for pending:', reqErr);
            return res.status(500).json({ message: 'DB error' });
        }
        if (reqResults && reqResults.length > 0) {
             return res.status(400).json({ message: 'You already have a payment request that is Pending admin approval.' });
        }

        // If no Paid status, and no Pending request exists, proceed to insert new request.
        const sql = `INSERT INTO payment_requests (username, amount, card_last4, status) VALUES (?, ?, ?, 'Pending')`;
        db.query(sql, [username, amount, card_last4], (err, result) => {
            if (err) {
                console.error('Error inserting payment request:', err);
                return res.status(500).json({ message: 'DB error' });
            }
            // Also update payment_status to Pending on new request
            db.query('REPLACE INTO payment_status (username, status) VALUES (?, ?)', [username, 'Pending'], (updateErr) => {
                if(updateErr) console.error('Error updating payment_status after request insert:', updateErr);
                res.status(201).json({ id: result.insertId, message: 'Payment request submitted for approval.' });
            });
        });
    });
} else {
    // If no status record or status is Rejected, proceed to insert new request.
    const sql = `INSERT INTO payment_requests (username, amount, card_last4, status) VALUES (?, ?, ?, 'Pending')`;
    db.query(sql, [username, amount, card_last4], (err, result) => {
        if (err) {
            console.error('Error inserting payment request:', err);
            return res.status(500).json({ message: 'DB error' });
        }
        // Also update payment_status to Pending on new request
        db.query('REPLACE INTO payment_status (username, status) VALUES (?, ?)', [username, 'Pending'], (updateErr) => {
            if(updateErr) console.error('Error updating payment_status after request insert:', updateErr);
            res.status(201).json({ id: result.insertId, message: 'Payment request submitted for approval.' });
        });
    });
}
});
});

app.get('/payment-requests', (req, res) => {
    let sql = 'SELECT * FROM payment_requests';
    const params = [];
    const conditions = [];

    if (req.query.status) {
        conditions.push('status = ?');
        params.push(req.query.status);
    }
    if (req.query.search) {
        conditions.push('(username LIKE ? OR id = ?)');
        params.push(`%${req.query.search}%`, req.query.search.replace(/[^0-9]/g, '')); // Search by username or ID
    }

    if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY created_at DESC';

    db.query(sql, params, (err, results) => {
        if (err) {
            console.error('Error fetching payment requests:', err);
            return res.status(500).json({ message: 'DB error' });
        }
        res.json(results);
    });
});


app.patch('/payment-requests/:id/approve', (req, res) => {
    const id = req.params.id;
    // 1. Get username
    db.query('SELECT username FROM payment_requests WHERE id = ?', [id], (err, results) => {
        if (err) return res.status(500).json({ message: 'DB error' });
        if (results.length === 0) return res.status(404).json({ message: 'Request not found' });
        const username = results[0].username;

        // 2. Update request status
        db.query('UPDATE payment_requests SET status = ? WHERE id = ?', ['Approved', id], (uErr) => {
            if (uErr) return res.status(500).json({ message: 'DB error' });
            
            // 3. Update overall payment status
            db.query('REPLACE INTO payment_status (username, status) VALUES (?, ?)', [username, 'Paid'], (pErr) => {
                if (pErr) console.error('Error updating payment_status after approval:', pErr);
                return res.json({ message: 'Payment request approved and user marked Paid' });
            });
        });
    });
});

app.patch('/payment-requests/:id/reject', (req, res) => {
    const id = req.params.id;
    // 1. Get username
    db.query('SELECT username FROM payment_requests WHERE id = ?', [id], (err, results) => {
        if (err) return res.status(500).json({ message: 'DB error' });
        if (results.length === 0) return res.status(404).json({ message: 'Request not found' });
        const username = results[0].username;

        // 2. Update request status
        db.query('UPDATE payment_requests SET status = ? WHERE id = ?', ['Rejected', id], (uErr) => {
            if (uErr) return res.status(500).json({ message: 'DB error' });
            
            // 3. Update overall payment status to Rejected
            db.query('REPLACE INTO payment_status (username, status) VALUES (?, ?)', [username, 'Rejected'], (pErr) => {
                if (pErr) console.error('Error updating payment_status after rejection:', pErr);
                return res.json({ message: 'Payment request rejected and user marked Rejected' });
            });
        });
    });
});

app.patch('/payment-requests/bulk-approve', (req, res) => {
    const sql = `
        UPDATE payment_requests pr
        JOIN payment_status ps ON pr.username = ps.username
        SET pr.status = 'Approved', ps.status = 'Paid'
        WHERE pr.status = 'Pending'
    `;
    db.query(sql, (err, result) => {
        if (err) {
            console.error('Error during bulk approval:', err);
            return res.status(500).json({ message: 'DB error during bulk approval' });
        }
        res.json({ message: `${result.affectedRows} pending payment requests approved and marked as Paid.` });
    });
});

app.patch('/payment-requests/bulk-reject', (req, res) => {
    const sql = `
        UPDATE payment_requests pr
        JOIN payment_status ps ON pr.username = ps.username
        SET pr.status = 'Rejected', ps.status = 'Rejected'
        WHERE pr.status = 'Pending'
    `;
    db.query(sql, (err, result) => {
        if (err) {
            console.error('Error during bulk rejection:', err);
            return res.status(500).json({ message: 'DB error during bulk rejection' });
        }
        res.json({ message: `${result.affectedRows} pending payment requests rejected.` });
    });
});
// ------------------------------------------------------------------
// END PAYMENT ROUTES
// ------------------------------------------------------------------


// Send OTP endpoint (for register and forgot password)
app.post("/send-otp", async (req, res) => {
    const { email, username } = req.body;
    if (!email) {
        return res.status(400).json({ ok: false, message: "Email is required." });
    }

    // Common OTP generation logic
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 5 * 60000); // 5 minutes expiry

    // If only email is present => forgot password flow or initial register flow
    if (!username || username.trim() === '') {
        const insertUpdateOtpSql = "REPLACE INTO register (email, otp, otp_expires_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE otp = ?, otp_expires_at = ?";
        
        try {
            await new Promise((resolve, reject) => {
                db.query(insertUpdateOtpSql, [email, otp, otpExpires, otp, otpExpires], (err) => {
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

            return res.json({ ok: true, message: 'OTP sent' });
            
        } catch (e) {
            return res.status(500).json({ ok: false, message: e || 'Server error' });
        }
    }
    
    // If username present => registration flow (check uniqueness)
    if (username && username.trim() !== '') {
        const checkUsernameSql = "SELECT 1 FROM register WHERE username = ?";
        db.query(checkUsernameSql, [username], (err, usernameResults) => {
            if (err) {
                console.error("❌ DB Error during username uniqueness check:", err);
                return res.status(500).json({ ok: false, message: "Database error" });
            }
            if (usernameResults.length > 0) {
                return res.status(400).json({ ok: false, message: "Username already exists." });
            }
            
            const checkEmailSql = "SELECT 1 FROM register WHERE email = ?";
            db.query(checkEmailSql, [email], (err, emailResults) => {
                if (err) {
                    console.error("❌ DB Error during email uniqueness check:", err);
                    return res.status(500).json({ ok: false, message: "Database error" });
                }
                if (emailResults.length > 0) {
                    return res.status(400).json({ ok: false, message: "Email already registered." });
                }

                // If both unique, save username, email, and OTP
                const insertOtpSql = "INSERT INTO register (username, email, otp, otp_expires_at) VALUES (?, ?, ?, ?)";
                db.query(insertOtpSql, [username, email, otp, otpExpires], async (err) => {
                    if (err) {
                        console.error("❌ DB Error during initial registration insert:", err);
                        return res.status(500).json({ ok: false, message: "Database error during registration insert." });
                    }
                    
                    // send via Brevo
                    const sendResult = await sendOTPEmailBrevo(email, otp);
                    if (!sendResult.success) {
                        console.error('❌ Brevo sendResult:', sendResult);
                        return res.status(500).json({ ok: false, message: sendResult.message || sendResult.info || 'Failed to send OTP' });
                    }

                    return res.json({ ok: true, message: 'OTP sent' });
                });
            });
        });
    }
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
            const checkUserSql = "SELECT 1 FROM register WHERE email = ? AND otp_expires_at > NOW()";
            db.query(checkUserSql, [email], (checkErr, checkResults) => {
                if(checkErr) return res.status(500).json({ message: "Database error" });
                
                if(checkResults.length > 0) {
                    return res.status(400).json({ message: "❌ Invalid OTP. Try again." });
                } else {
                    return res.status(400).json({ message: "❌ OTP expired or invalid. Request a new OTP." });
                }
            });
            return;
        }

        // OTP is valid, finalize registration
        const finalSql = `
            UPDATE register 
            SET 
                username = ?, 
                password = ?, 
                gender = ?, 
                contact = ?, 
                otp = NULL, 
                otp_expires_at = NULL,
                is_admin = 0,
                registered_at = NOW()
            WHERE email = ?
        `;
        db.query(finalSql, [username, password, gender, contact, email], (updateErr) => {
            if (updateErr) {
                console.error("❌ DB Error during final registration update:", updateErr);
                return res.status(500).json({ message: "Database error during final registration." });
            }
            res.status(200).json({ message: "✅ Registration successful. Please login now." });
        });
    });
});

// Login endpoint
app.post("/login", (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: "Username and password required" });

    const sql = "SELECT * FROM register WHERE username = ? AND password = ?";
    db.query(sql, [username, password], (err, results) => {
        if (err) {
            console.error("❌ DB Error during login:", err);
            return res.status(500).json({ message: "Database error" });
        }

        if (results.length === 0) {
            return res.status(401).json({ message: "❌ Invalid username or password." });
        }

        const user = results[0];
        
        // Log successful login activity
        const logSql = "INSERT INTO visitor_logs (username, ip_address, status) VALUES (?, ?, 'Success')";
        const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        db.query(logSql, [user.username, ip], (logErr) => {
            if (logErr) console.warn("Could not log visitor:", logErr);
        });

        // Check if admin is trying to login
        if (user.is_admin === 1) {
            return res.status(200).json({ message: "✅ Admin Login successful", user: { username: user.username, role: 'admin' } });
        }

        // Check if student details are complete
        db.query("SELECT * FROM student_details WHERE username = ?", [user.username], (detailsErr, details) => {
            if (detailsErr) {
                console.error("❌ DB Error checking student details:", detailsErr);
                return res.status(500).json({ message: "Database error" });
            }

            if (details.length === 0) {
                // Details not complete, prompt to fill details
                return res.status(200).json({ message: "✅ Login successful. Please complete your details.", user: { username: user.username, role: 'student', details_complete: false } });
            } else {
                // Details complete, proceed to home
                return res.status(200).json({ message: "✅ Login successful", user: { username: user.username, role: 'student', details_complete: true } });
            }
        });
    });
});

// Forgot Password Helper
const findUserByIdentifier = (identifier, cb) => {
    // Check if identifier is an email (contains @)
    if (identifier.includes('@')) {
        db.query('SELECT username, email FROM register WHERE email = ?', [identifier], cb);
    } else {
        // Assume it's a username
        db.query('SELECT username, email FROM register WHERE username = ?', [identifier], cb);
    }
};

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
        const otpExpires = new Date(Date.now() + 5 * 60000); // 5 minutes expiry
        
        // Save/update OTP
        const insertUpdateOtpSql = "UPDATE register SET otp = ?, otp_expires_at = ? WHERE email = ?";
        
        try {
            await new Promise((resolve, reject) => {
                db.query(insertUpdateOtpSql, [otp, otpExpires, email], (err) => {
                    if (err) {
                        console.error("❌ DB Error during OTP storage for forgot password:", err);
                        return reject("Database error during OTP storage.");
                    }
                    resolve();
                });
            });

            // send via Brevo
            const sendResult = await sendOTPEmailBrevo(email, otp);
            if (!sendResult.success) {
                console.error('❌ Brevo sendResult:', sendResult);
                return res.status(500).json({ ok: false, message: sendResult.message || sendResult.info || 'Failed to send OTP' });
            }

            return res.json({ ok: true, message: 'OTP sent. Check your email.' });
            
        } catch (e) {
            return res.status(500).json({ ok: false, message: e || 'Server error' });
        }
    });
});

// POST /forgot-reset-password
app.post('/forgot-reset-password', (req, res) => {
    const { identifier, otp, newPassword } = req.body;
    if (!identifier || !otp || !newPassword) return res.status(400).json({ message: 'identifier, otp and newPassword required' });

    // 1. Check if a valid (non-expired) otp exists for the identifier
    const sqlCheck = `
        SELECT email FROM register 
        WHERE (email = ? OR username = ?) AND otp = ? AND otp_expires_at > NOW()
        LIMIT 1
    `;
    db.query(sqlCheck, [identifier, identifier, otp], (err, results) => {
        if (err) {
            console.error('DB error forgot-reset-password check:', err);
            return res.status(500).json({ message: 'Database error' });
        }
        if (!results || results.length === 0) {
            return res.status(400).json({ message: '❌ Invalid or expired OTP. Please check your OTP or request a new one.' });
        }
        
        // 2. OTP is valid, update password
        const email = results[0].email;
        const sqlUpdate = `
            UPDATE register 
            SET password = ?, otp = NULL, otp_expires_at = NULL 
            WHERE email = ?
        `;
        db.query(sqlUpdate, [newPassword, email], (updateErr) => {
            if (updateErr) {
                console.error('DB error forgot-reset-password update:', updateErr);
                return res.status(500).json({ message: 'Database error' });
            }
            res.status(200).json({ message: '✅ Password reset successful.' });
        });
    });
});

// Student details
app.post("/student-details", (req, res) => {
    const { username, course, year, semester, prev_college, prev_result, gender } = req.body;
    if (!username || !course || !year || !semester) {
        return res.status(400).json({ message: "Missing required student details" });
    }
    
    // Ensure the table for student_details exists (best-effort)
    const createDetailsTable = `
        CREATE TABLE IF NOT EXISTS student_details (
            username VARCHAR(100) PRIMARY KEY,
            course VARCHAR(100),
            year VARCHAR(20),
            semester VARCHAR(20),
            prev_college VARCHAR(255),
            prev_result DECIMAL(4, 2),
            gender VARCHAR(10),
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;
    db.query(createDetailsTable, (cErr) => {
        if (cErr) console.error('Could not ensure student_details table exists:', cErr);
        
        const sql = `
            REPLACE INTO student_details 
            (username, course, year, semester, prev_college, prev_result, gender) 
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        db.query(sql, [username, course, year, semester, prev_college, prev_result, gender], (err) => {
            if (err) {
                console.error("❌ DB Error saving student details:", err);
                return res.status(500).json({ message: "Database error saving details." });
            }
            res.status(201).json({ message: "✅ Student details saved successfully" });
        });
    });
});

app.get("/student-details/:username", (req, res) => {
    const { username } = req.params;
    const sql = "SELECT * FROM student_details WHERE username = ?";
    db.query(sql, [username], (err, results) => {
        if (err) {
            console.error("❌ DB Error fetching student details:", err);
            return res.status(500).json({ message: "Database error fetching details." });
        }
        if (results.length === 0) {
            return res.status(404).json({ message: "Details not found" });
        }
        res.status(200).json(results[0]);
    });
});

app.get("/student-details", (req, res) => {
    const sql = "SELECT * FROM student_details";
    db.query(sql, (err, results) => {
        if (err) {
            console.error("❌ DB Error fetching all student details:", err);
            return res.status(500).json({ message: "Database error fetching details." });
        }
        res.status(200).json(results);
    });
});

// Get all users (register table)
app.get("/users", (req, res) => {
    const sql = "SELECT username, email, contact, gender, is_admin, registered_at FROM register WHERE is_admin = 0";
    db.query(sql, (err, results) => {
        if (err) {
            console.error("❌ DB Error fetching users:", err);
            return res.status(500).json({ message: "Database error fetching users." });
        }
        // Format the results for easy consumption (especially dates)
        const userMap = results.reduce((acc, user) => {
            acc.push({
                ...user,
                registered_at: user.registered_at ? new Date(user.registered_at).toISOString() : null,
            });
            return acc;
        }, []);
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

// COMPLAINTS endpoints
app.post('/complaints', (req, res) => {
    const { subject, description, category, location, username, user_id } = req.body;
    if (!subject || !description) return res.status(400).json({ error: 'subject and description required' });

    const sql = `INSERT INTO complaints (subject, description, category, location, username) VALUES (?, ?, ?, ?, ?)`;
    db.query(sql, [subject, description, category, location, username], (err, result) => {
        if (err) {
            console.error('Error inserting complaint:', err);
            return res.status(500).json({ error: 'DB error' });
        }
        res.status(201).json({ id: result.insertId, message: 'Complaint lodged successfully' });
    });
});

app.get('/complaints', (req, res) => {
    const { username, status } = req.query;
    let sql = 'SELECT * FROM complaints';
    const params = [];
    const conditions = [];

    if (username) {
        conditions.push('username = ?');
        params.push(username);
    }
    if (status) {
        conditions.push('status = ?');
        params.push(status);
    }

    if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY created_at DESC';

    db.query(sql, params, (err, results) => {
        if (err) {
            console.error('Error fetching complaints:', err);
            return res.status(500).json({ error: 'DB error' });
        }
        res.json(results);
    });
});

app.patch('/complaints/:id/status', (req, res) => {
    const { id } = req.params;
    const { status } = req.body; // 'Pending', 'Resolved', 'Rejected'
    if (!status) return res.status(400).json({ error: 'Status is required' });

    const sql = 'UPDATE complaints SET status = ? WHERE id = ?';
    db.query(sql, [status, id], (err, result) => {
        if (err) {
            console.error('Error updating complaint status:', err);
            return res.status(500).json({ error: 'DB error' });
        }
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Complaint not found' });
        res.json({ message: `Complaint ${id} status updated to ${status}` });
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
    let sql = 'SELECT id, username, subject, message, desired_room, is_read, created_at FROM notifications';
    const params = [];
    
    if (req.query.username) {
        sql += ' WHERE username = ?';
        params.push(req.query.username);
        if (onlyUnread) {
             sql += ' AND is_read = 0';
        }
    } else if (onlyUnread) {
        // Global unread count (admin)
        sql += ' WHERE is_read = 0';
    }
    
    sql += ' ORDER BY created_at DESC';

    db.query(sql, params, (err, results) => {
        if (err) {
            console.error('Error fetching notifications:', err);
            return res.status(500).json({ message: 'DB error' });
        }
        res.json(results);
    });
});

app.patch('/notifications/:id/read', (req, res) => {
    const { id } = req.params;
    const sql = 'UPDATE notifications SET is_read = 1 WHERE id = ?';
    db.query(sql, [id], (err, result) => {
        if (err) {
            console.error('Error marking notification as read:', err);
            return res.status(500).json({ message: 'DB error' });
        }
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Notification not found' });
        res.json({ message: 'Notification marked as read' });
    });
});

// ROOMS & ASSIGNMENTS endpoints
const createRoomsTable = `
   CREATE TABLE IF NOT EXISTS rooms (
       room_no VARCHAR(50) NOT NULL,
       bed_no VARCHAR(50) NOT NULL,
       username VARCHAR(100) DEFAULT NULL,
       PRIMARY KEY (room_no, bed_no),
       INDEX idx_username (username),
       FOREIGN KEY (username) REFERENCES register(username) ON DELETE SET NULL
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

db.query(createRoomsTable, (rErr) => {
    if (rErr) console.error('Could not ensure rooms table exists:', rErr);
    else console.log('✅ Rooms table is ready');
    
    // Check if table is empty, and if so, seed it with sample data (2 rooms, 3 beds each)
    db.query("SELECT COUNT(*) as count FROM rooms", (countErr, countResults) => {
        if (countErr) return console.error('Error checking room count:', countErr);
        if (countResults[0].count === 0) {
            const seedSql = `
                INSERT INTO rooms (room_no, bed_no) VALUES
                ('A101', 'Bed 1'), ('A101', 'Bed 2'), ('A101', 'Bed 3'),
                ('A102', 'Bed 1'), ('A102', 'Bed 2'), ('A102', 'Bed 3'),
                ('B201', 'Bed 1'), ('B201', 'Bed 2'), ('B201', 'Bed 3');
            `;
            db.query(seedSql, (seedErr) => {
                if (seedErr) console.error('Error seeding rooms table:', seedErr);
                else console.log('✅ Rooms table seeded with sample data.');
            });
        }
    });
});

app.get("/rooms-occupancy", (req, res) => {
    const sql = `
        SELECT 
            room_no, 
            COUNT(*) AS total_beds,
            SUM(CASE WHEN username IS NULL THEN 1 ELSE 0 END) AS available_beds
        FROM rooms
        GROUP BY room_no
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ message: "DB error" });
        res.json(results);
    });
});

app.get("/available-rooms", (req, res) => {
    const sql = `
        SELECT 
            room_no, 
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
        res.json(results);
    });
});


app.post("/assign-room", (req, res) => {
    const { username, room_no, bed_no } = req.body;
    if (!username || !room_no || !bed_no) {
        return res.status(400).json({ message: "Missing username, room_no, or bed_no" });
    }

    // 1. Check gender compatibility (requires two queries)
    const getStudentGenderSql = "SELECT gender FROM register WHERE username = ?";
    const getRoomOccupantGenderSql = `
        SELECT r.gender 
        FROM rooms rm
        JOIN register r ON rm.username = r.username
        WHERE rm.room_no = ? AND rm.username IS NOT NULL 
        LIMIT 1
    `;
    
    // Execute queries sequentially or use Promises for parallel
    db.query(getStudentGenderSql, [username], (studentErr, studentResults) => {
        if (studentErr) return res.status(500).json({ message: "DB error checking student gender" });
        if (studentResults.length === 0) return res.status(404).json({ message: "Student not found" });
        const studentGender = studentResults[0].gender;

        db.query(getRoomOccupantGenderSql, [room_no], (roomErr, roomOccupantResults) => {
            if (roomErr) return res.status(500).json({ message: "DB error checking room gender" });

            if (roomOccupantResults.length > 0) {
                const occupantGender = roomOccupantResults[0].gender;
                if (occupantGender !== studentGender) {
                    return res.status(403).json({ message: `❌ Cannot assign ${username}. Room ${room_no} is already occupied by a ${occupantGender} student.` });
                }
            }

            // 2. Unassign any existing room for this user
            db.query("UPDATE rooms SET username = NULL WHERE username = ?", [username], (unassignErr) => {
                if (unassignErr) return res.status(500).json({ message: "DB error unassigning old room" });

                // 3. Assign the new room/bed
                const assignSql = "UPDATE rooms SET username = ? WHERE room_no = ? AND bed_no = ? AND username IS NULL";
                db.query(assignSql, [username, room_no, bed_no], (assignErr, result) => {
                    if (assignErr) {
                        console.error('Error assigning room:', assignErr);
                        return res.status(500).json({ message: "DB error during assignment" });
                    }
                    if (result.affectedRows === 0) {
                        return res.status(400).json({ message: "❌ Bed is not available (already occupied or room/bed combination invalid)" });
                    }

                    // 4. Update student_details (best-effort, assumes table exists)
                    db.query("REPLACE INTO student_details (username, room_no) VALUES (?, ?) ON DUPLICATE KEY UPDATE room_no = ?", [username, room_no, room_no], (detailErr) => {
                         if (detailErr) console.warn('Could not update student_details with room_no:', detailErr);
                    });

                    res.status(200).json({ message: `✅ Room ${room_no} - ${bed_no} assigned to ${username}` });
                });
            });
        });
    });
});


app.delete("/students/:username", (req, res) => {
    const { username } = req.params;
    
    // 1. Unassign room (set username to NULL in rooms table)
    db.query("UPDATE rooms SET username = NULL WHERE username = ?", [username], (err) => {
        if (err) return res.status(500).json({ message: "Error freeing room" });
        
        // 2. Delete student details
        db.query("DELETE FROM student_details WHERE username = ?", [username], (err2) => {
            if (err2) return res.status(500).json({ message: "Error deleting details" });
            
            // 3. Delete user from register table
            db.query("DELETE FROM register WHERE username = ?", [username], (err3) => {
                if (err3) return res.status(500).json({ message: "Error deleting user" });
                
                res.status(200).json({ message: `Student ${username} and all associated data deleted.` });
            });
        });
    });
});

// Admin-home Stats
app.get("/dues-count", (req, res) => {
    const sql = `
        SELECT COUNT(r.username) AS dueCount
        FROM register r
        LEFT JOIN payment_status ps ON r.username = ps.username
        WHERE r.is_admin = 0 AND (ps.status IS NULL OR ps.status <> 'Paid')
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

// Catch-all route (for static file serving, if the file is not found)
app.use((req, res) => {
    // If running with a separate frontend server, this can be removed.
    // If serving frontend from here, this acts as a 404 handler.
    res.status(404).send('Not Found');
});

// Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`✅ Server is running on port ${PORT}`);
});
