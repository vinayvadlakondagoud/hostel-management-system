const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mysql = require("mysql2");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");
const { Resend } = require("resend");

dotenv.config();
const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());

// ✅ Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY);

// ✅ DATABASE CONFIG (Render + Local)
const db = mysql.createConnection({
  host: process.env.DB_HOST || "gondola.proxy.rlwy.net",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "nJHYvbTLKeJJsCOOatIuJxNgnvBhpqsb",
  database: process.env.DB_NAME || "railway",
  port: process.env.DB_PORT || 26543,
  ssl: { rejectUnauthorized: false },
});

db.connect((err) => {
  if (err) console.error("❌ Database connection failed:", err.message);
  else console.log("✅ Connected to Railway MySQL successfully!");
});

// ✅ Function to send OTP using Resend
async function sendOTPEmail(email, otp) {
  try {
    await resend.emails.send({
      from: "Hostel Management <onboarding@resend.dev>",
      to: email,
      subject: "Hostel Management OTP Verification",
      html: `
        <h2>Welcome to Hostel Management System</h2>
        <p>Your One-Time Password (OTP) is:</p>
        <h1>${otp}</h1>
        <p>This OTP is valid for 5 minutes.</p>
      `,
    });
    console.log(`✅ OTP email sent successfully to ${email}`);
    return { success: true };
  } catch (error) {
    console.error("❌ Resend error:", error.message);
    return { success: false, message: error.message };
  }
}

    // DATABASE INITIALIZATION & STRUCTURE CHECKS
    // ------------------------------------------------------------------

    // 1. Ensure complaints table exists with proper structure
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

    // 2. Ensure payment_status table exists
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

    // 3. Ensure notifications table exists
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
    db.query(createNotificationsTable, (nErr) => { if (nErr) console.error('createNotificationsTable error', nErr); });


    // 4. ✅ FIX FOR MySQL PARSE ERROR: Ensure 'registered_at' column exists in 'register' table
    // Removed 'IF NOT EXISTS' for broader MySQL version compatibility.
    const alterRegisterTable = `
        ALTER TABLE register 
        ADD COLUMN registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    `;
    db.query(alterRegisterTable, (aErr) => {
        // If the error code is related to "Duplicate column name", we can safely ignore it.
        if (aErr && aErr.code !== 'ER_DUP_FIELDNAME') { 
            console.warn('Could not ensure registered_at column exists in register table:', aErr.message);
        } else {
            console.log('✅ Register table structure checked/updated for registered_at.');
        }
    });

    // 5. ✅ Ensure visitor_logs table exists for Visitor History feature
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
    // 6. Ensure payment_requests table exists for admin approval workflow
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
// PAYMENT STATUS ENDPOINTS
// ------------------------------------------------------------------

// Update payment status (called after payment)
app.post('/payment-status', (req, res) => {
    const { username, status } = req.body;
    if (!username || !status) return res.status(400).json({ error: 'Missing username or status' });
    db.query('REPLACE INTO payment_status (username, status) VALUES (?, ?)', [username, status], (err) => {
        if (err) return res.status(500).json({ error: 'DB error' });
        res.json({ message: 'Payment status updated' });
    });
});

// Get payment status for a user
app.get('/payment-status/:username', (req, res) => {
    const { username } = req.params;
    db.query('SELECT status FROM payment_status WHERE username = ?', [username], (err, results) => {
        if (err) return res.status(500).json({ error: 'DB error' });
        if (results.length === 0) return res.json({ status: 'Pending' });
        res.json({ status: results[0].status });
    });
});

// ------------------------------------------------------------------
// PAYMENT REQUESTS (USER -> ADMIN APPROVAL WORKFLOW)
// ------------------------------------------------------------------

// Create a payment request (submitted by user after dummy payment)
app.post('/payment-request', (req, res) => {
    const { username, amount, card_last4 } = req.body;
    if (!username || !amount) return res.status(400).json({ message: 'username and amount required' });

    // Prevent creating a payment request if the user is already marked as Paid
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

// Admin: list payment requests (optionally filter by status)
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

// Admin: approve a payment request (marks request approved and sets payment_status to Paid)
app.patch('/payment-requests/:id/approve', (req, res) => {
    const id = req.params.id;
    // First fetch request to get username
    db.query('SELECT username FROM payment_requests WHERE id = ?', [id], (err, results) => {
        if (err) return res.status(500).json({ message: 'DB error' });
        if (results.length === 0) return res.status(404).json({ message: 'Request not found' });
        const username = results[0].username;

        db.query('UPDATE payment_requests SET status = ? WHERE id = ?', ['Approved', id], (uErr) => {
            if (uErr) return res.status(500).json({ message: 'DB error' });
            // Mark payment_status as Paid for the user
            db.query('REPLACE INTO payment_status (username, status) VALUES (?, ?)', [username, 'Paid'], (pErr) => {
                if (pErr) console.error('Error updating payment_status after approval:', pErr);
                return res.json({ message: 'Payment request approved and user marked Paid' });
            });
        });
    });
});

// Admin: reject a payment request (marks request rejected, payment_status remains Pending)
app.patch('/payment-requests/:id/reject', (req, res) => {
    const id = req.params.id;
    db.query('SELECT username FROM payment_requests WHERE id = ?', [id], (err, results) => {
        if (err) return res.status(500).json({ message: 'DB error' });
        if (results.length === 0) return res.status(404).json({ message: 'Request not found' });
        const username = results[0].username;

        db.query('UPDATE payment_requests SET status = ? WHERE id = ?', ['Rejected', id], (uErr) => {
            if (uErr) return res.status(500).json({ message: 'DB error' });
            // Optionally ensure payment_status stays Pending
            db.query('REPLACE INTO payment_status (username, status) VALUES (?, ?)', [username, 'Pending'], (pErr) => {
                if (pErr) console.error('Error updating payment_status after rejection:', pErr);
                return res.json({ message: 'Payment request rejected' });
            });
        });
    });
});

// ✅ Fetch the gender of the first occupant for ALL rooms
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

// ------------------------------------------------------------------
// AUTHENTICATION & REGISTRATION ENDPOINTS
// ------------------------------------------------------------------

// ✅ SEND OTP API
app.post("/send-otp", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: "Email is required" });

  const otp = Math.floor(100000 + Math.random() * 900000);
  const otpExpires = new Date(Date.now() + 5 * 60000);

  try {
    await new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO register (email, otp, otp_expires_at)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE otp = VALUES(otp), otp_expires_at = VALUES(otp_expires_at)
      `;
      db.query(sql, [email, otp, otpExpires], (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    const result = await sendOTPEmail(email, otp);
    if (result.success) res.json({ success: true, message: "OTP sent successfully" });
    else res.status(500).json({ success: false, message: result.message });
  } catch (err) {
    console.error("❌ Error during OTP send:", err.message);
    res.status(500).json({ success: false, message: "Server error while sending OTP" });
  }
});

// ✅ VERIFY OTP AND REGISTER USER
app.post("/register", (req, res) => {
  const { username, email, password, gender, contact, otp } = req.body;

  const checkOtpSql = "SELECT otp_expires_at FROM register WHERE email = ? AND otp = ?";
  db.query(checkOtpSql, [email, otp], (err, results) => {
    if (err) return res.status(500).json({ message: "Database error" });
    if (results.length === 0) return res.status(400).json({ message: "Invalid OTP or email" });

    const expiresAt = new Date(results[0].otp_expires_at);
    if (expiresAt < new Date()) return res.status(400).json({ message: "OTP expired" });

    const sql = `
      UPDATE register SET 
        username = ?, password = ?, gender = ?, contact = ?, 
        otp = NULL, otp_expires_at = NULL, registered_at = CURRENT_TIMESTAMP
      WHERE email = ?
    `;
    db.query(sql, [username, password, gender, contact, email], (err2) => {
      if (err2) return res.status(500).json({ message: "Registration error" });
      res.json({ message: "✅ Registration successful" });
    });
  });
});

// ✅ Login API (Updated to log to visitor_logs)
app.post("/login", (req, res) => {
    const { username, password } = req.body;
    const ip_address = req.ip; // Get the user's IP address
    let log_status = 'Success';

    if (!username || !password) {
        log_status = 'Failure (Missing Credentials)';
        db.query('INSERT INTO visitor_logs (username, ip_address, status) VALUES (?, ?, ?)', ['N/A', ip_address, log_status], () => {});
        return res.status(400).json({ message: "Missing username or password" });
    }

    const sql = "SELECT username, password FROM register WHERE username = ?";
    db.query(sql, [username], (err, results) => {
        if (err) {
            log_status = 'Failure (DB Error)';
            db.query('INSERT INTO visitor_logs (username, ip_address, status) VALUES (?, ?, ?)', [username, ip_address, log_status], () => {});
            return res.status(500).json({ message: "Database error" });
        }

        if (results.length === 0 || results[0].password !== password) {
            log_status = 'Failure (Invalid Credentials)';
            db.query('INSERT INTO visitor_logs (username, ip_address, status) VALUES (?, ?, ?)', [username, ip_address, log_status], () => {});
            return res.status(401).json({ message: "Invalid username or password" });
        }

        // Login Success
        db.query('INSERT INTO visitor_logs (username, ip_address, status) VALUES (?, ?, ?)', [username, ip_address, log_status], (logErr) => {
             if (logErr) console.error('Error logging visitor:', logErr);
             res.status(200).json({ message: "Login successful!" });
        });
    });
});

// ------------------------------------------------------------------
// VISITOR LOGS ENDPOINTS (NEW)
// ------------------------------------------------------------------

// ✅ Fetch All Registered User Details (Username and Registered Date)
app.get("/user-details", (req, res) => {
    // Note: registered_at will be a TIMESTAMP/Date object from MySQL, which is handled in the frontend.
    const sql = "SELECT username, registered_at FROM register WHERE username IS NOT NULL";
    db.query(sql, (err, results) => {
        if (err) {
            console.error("❌ DB Error fetching user details:", err);
            return res.status(500).json({ message: "Database error fetching user details." });
        }
        // Map results to an object structure {username: registered_at}
        const userMap = results.reduce((acc, user) => {
            if (user.username) {
                // Ensure the date is a standard ISO string for easy parsing on the frontend
                acc[user.username] = user.registered_at ? new Date(user.registered_at).toISOString() : null;
            }
            return acc;
        }, {});
        res.status(200).json({ users: userMap });
    });
});

// ✅ Fetch Visitor Logs API
app.get("/visitor-logs", (req, res) => {
    // Select all logs, ordered by newest first
    const sql = "SELECT username, login_time, ip_address, status FROM visitor_logs ORDER BY login_time DESC";
    db.query(sql, (err, results) => {
        if (err) {
            console.error("❌ DB Error fetching visitor logs:", err);
            return res.status(500).json({ message: "Database error fetching logs." });
        }
        // Logs are successfully retrieved
        res.status(200).json({ logs: results });
    });
});

// ------------------------------------------------------------------
// COMPLAINTS ENDPOINTS (FALLBACK)
// ------------------------------------------------------------------

// Submit a new complaint
app.post('/complaints', (req, res) => {
    const { subject, description, category, location, username } = req.body;
    if (!subject || !description || !category || !location || !username) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    const sql = 'INSERT INTO complaints (subject, description, category, location, username) VALUES (?, ?, ?, ?, ?)';
    db.query(sql, [subject, description, category, location, username], (err, result) => {
        if (err) {
            console.error('Error submitting complaint (fallback):', err);
            return res.status(500).json({ error: 'Could not submit complaint' });
        }
        return res.status(201).json({ id: result.insertId, message: 'Complaint submitted successfully' });
    });
});

// Get complaints (optional filter by username)
app.get('/complaints', (req, res) => {
    const username = req.query.username;
    const status = req.query.status;
    let sql = 'SELECT * FROM complaints';
    const params = [];

    if (username && status) {
        sql += ' WHERE username = ? AND status = ?';
        params.push(username, status);
    } else if (username) {
        sql += ' WHERE username = ?';
        params.push(username);
    } else if (status) {
        sql += ' WHERE status = ?';
        params.push(status);
    }
    sql += ' ORDER BY created_at DESC';

    db.query(sql, params, (err, results) => {
        if (err) {
            console.error('Error fetching complaints (fallback):', err);
            return res.status(500).json({ error: 'Could not fetch complaints' });
        }
        res.json(results || []);
    });
});

// Update complaint status
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

// Delete a resolved complaint
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

// ------------------------------------------------------------------
// NOTIFICATIONS ENDPOINTS
// ------------------------------------------------------------------

// Create a notification (e.g., room change request from user)
app.post('/notifications', (req, res) => {
    const { username, subject, message, desired_room } = req.body;
    if (!username || !subject) return res.status(400).json({ message: 'Missing fields' });
    const sql = 'INSERT INTO notifications (username, subject, message, desired_room) VALUES (?, ?, ?, ?)';
    db.query(sql, [username, subject, message, desired_room || null], (err, result) => {
        if (err) return res.status(500).json({ message: 'DB error', error: err });
        res.status(201).json({ id: result.insertId, message: 'Notification created' });
    });
});

// Fetch notifications for a user
app.get('/notifications/:username', (req, res) => {
    const username = req.params.username;
    const sql = 'SELECT * FROM notifications WHERE username = ? OR username IS NULL ORDER BY created_at DESC';
    db.query(sql, [username], (err, results) => {
        if (err) return res.status(500).json({ message: 'DB error', error: err });
        res.json(results);
    });
});

// Mark notification as read
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
// USER/STUDENT DATA & ROOM ENDPOINTS
// ------------------------------------------------------------------

// ✅ Fetch all fully registered users
app.get("/users", (req, res) => {
    const sql = "SELECT username, gender, email, contact FROM register WHERE username IS NOT NULL";
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ message: "DB error" });
        res.json(results);
    });
});

// Get basic user info
app.get("/register/:username", (req, res) => {
    const username = req.params.username;
    const sql = "SELECT username, gender, email, contact FROM register WHERE username = ?";
    db.query(sql, [username], (err, results) => {
        if (err) return res.status(500).json({ message: "DB error" });
        res.json(results[0]);
    });
});

// ✅ Fetch unassigned students
app.get("/unassigned-users", (req, res) => {
    const sql = `
        SELECT r.username, r.gender, r.email, r.contact 
        FROM register r 
        WHERE r.username IS NOT NULL
          AND r.username NOT IN (
            SELECT username FROM rooms WHERE username IS NOT NULL
          )
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ message: "DB error" });
        res.json(results);
    });
});

// ✅ Fetch room inventory (All rooms with occupancy)
app.get("/rooms", (req, res) => {
    const sql = `
        SELECT 
            r.room_no, 
            r.bed_no, 
            r.status, 
            r.username, 
            reg.gender 
        FROM rooms r
        LEFT JOIN register reg ON r.username = reg.username
        ORDER BY r.room_no, r.bed_no`;

    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ message: "DB error" });
        res.json(results);
    });
});

// ✅ Fetch assignments for a specific room
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

// ✅ Get student’s room assignment
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

// ✅ Assign a room to a student
app.post("/assign-room", (req, res) => {
    const { username, room_no } = req.body;
    if (!username || !room_no) {
        return res.status(400).json({ message: "⚠ Missing student and room data" });
    }

    // --- 1. Get student gender ---
    db.query("SELECT gender FROM register WHERE username = ?", [username], (err0, genderResults) => {
        if (err0) return res.status(500).json({ message: "DB error fetching gender" });
        if (genderResults.length === 0) return res.status(404).json({ message: "❌ Student not registered" });
        const studentGender = genderResults[0].gender;

        // --- 2. Check room compatibility/occupancy ---
        const checkRoomSql = `
            SELECT r.gender 
            FROM rooms rm
            JOIN register r ON r.username = rm.username
            WHERE rm.room_no = ? AND rm.username IS NOT NULL
            LIMIT 1
        `;
        db.query(checkRoomSql, [room_no], (err1, occupiedGender) => {
            if (err1) return res.status(500).json({ message: "DB error checking room occupancy" });

            if (occupiedGender.length > 0 && occupiedGender[0].gender !== studentGender) {
                return res.status(400).json({ message: "❌ Gender mismatch: Room is occupied by a student of the opposite gender." });
            }

            // --- 3. Find a free bed in that room ---
            const freeBedSql = "SELECT bed_no FROM rooms WHERE room_no = ? AND username IS NULL LIMIT 1";
            db.query(freeBedSql, [room_no], (errFree, freeBedResults) => {
                if (errFree) return res.status(500).json({ message: "DB error finding free bed" });
                if (freeBedResults.length === 0) {
                    return res.status(400).json({ message: "❌ No free beds in this room" });
                }
                const freeBed = freeBedResults[0].bed_no;

                // --- 4. Assign student to that free bed ---
                const assignSql = "UPDATE rooms SET username = ? WHERE room_no = ? AND bed_no = ?";
                db.query(assignSql, [username, room_no, freeBed], (err2) => {
                    if (err2) return res.status(500).json({ message: "DB error during assignment" });
                    res.json({ message: `✅ ${username} (${studentGender}) assigned to Room ${room_no}, Bed ${freeBed}` });
                });
            });
        });
    });
});

// ✅ Remove only assignment
app.delete("/remove-assignment/:username", (req, res) => {
    const username = req.params.username;
    const sql = "UPDATE rooms SET username = NULL WHERE username = ?";
    db.query(sql, [username], (err) => {
        if (err) return res.status(500).json({ message: "DB error while removing assignment" });
        res.json({ message: `✅ Assignment removed for ${username}` });
    });
});

// ✅ Save Student Academic Details
app.post("/details", (req, res) => {
    const { username, email, contact, course, year, semester, prevCollege, prevResult } = req.body;
    if (!username || !email || !contact) {
        return res.status(400).json({ message: "⚠ Missing student data" });
    }
    const sql = `INSERT INTO student_details (username, email, contact, course, year, semester, prev_college, prev_result) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE 
                    email = VALUES(email),
                    contact = VALUES(contact),
                    course = VALUES(course),
                    year = VALUES(year),
                    semester = VALUES(semester),
                    prev_college = VALUES(prev_college),
                    prev_result = VALUES(prev_result)`;
    db.query(sql, [username, email, contact, course, year, semester, prevCollege, prevResult], (err) => {
        if (err) {
            console.error('Error saving student details:', err);
            return res.status(500).json({ message: "Database error while saving details" });
        }
        res.json({ message: "✅ Student details saved successfully" });
    });
});

// ✅ Get Student Academic Details
app.get("/details/:username", (req, res) => {
    const username = req.params.username;
    const sql = "SELECT * FROM student_details WHERE username = ?";
    db.query(sql, [username], (err, results) => {
        if (err) return res.status(500).json({ message: "DB error" });
        if (results.length === 0) return res.status(404).json({ message: "❌ Details not found" });
        res.json(results[0]);
    });
});

// ✅ Delete Student (Full Removal)
app.delete("/student/:username", (req, res) => {
    const username = req.params.username;
    if (!username) return res.status(400).json({ message: "Missing username" });

    // Step 1: Remove assignment (set username to NULL in rooms)
    db.query("UPDATE rooms SET username = NULL WHERE username = ?", [username], (err) => {
        if (err) return res.status(500).json({ message: "Error freeing room" });
        // Step 2: Delete from student_details
        db.query("DELETE FROM student_details WHERE username = ?", [username], (err2) => {
            if (err2) return res.status(500).json({ message: "Error deleting details" });
            // Step 3: Delete from register
            db.query("DELETE FROM register WHERE username = ?", [username], (err3) => {
                if (err3) return res.status(500).json({ message: "Error deleting user" });
                res.json({ message: `✅ Student ${username} deleted successfully (room freed)` });
            });
        });
    });
});

// ------------------------------------------------------------------
// MISC ENDPOINTS
// ------------------------------------------------------------------

// ✅ Meals API (if used)
app.get("/meals", (req, res) => {
    const sql = "SELECT * FROM meals";
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ message: "DB error" });
        res.json(results);
    });
});

// ✅ Server Healthcheck (for Render's use)
app.get('/health', (req, res) => {
    const uptime = process.uptime();
    db.ping((err) => {
        if (err) return res.status(500).json({ status: 'error', uptime, db: false, error: err.message });
        res.json({ status: 'ok', uptime, db: true });
    });
});


// ✅ DB Healthcheck
app.get("/health", (req, res) => {
  db.ping((err) => {
    if (err) return res.status(500).json({ status: "error", db: false });
    res.json({ status: "ok", db: true });
  });
});

// ✅ Serve frontend if exists
const FRONTEND_DIR = path.join(process.cwd(), "FRONTEND");
if (fs.existsSync(FRONTEND_DIR)) app.use(express.static(FRONTEND_DIR));

// ✅ Place this at the very end of server.js
app.use((req, res) => {
  res.status(404).send("Backend running. Route not found.");
});

// ✅ Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

// ✅ Place this at the very end of server.js
app.use((req, res) => {
  res.status(404).send("Backend running. Route not found.");
});
