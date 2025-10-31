const express = require("express");
const mysql = require("mysql2");
const bodyParser = require("body-parser");
const cors = require("cors");
const nodemailer = require("nodemailer");

const app = express();
app.use(cors());
app.use(bodyParser.json());


// ⚙️ EMAIL CONFIG (Environment-based for Render)
const email_user = process.env.EMAIL_USER || "hostelmanagementsystem.portal@gmail.com";
const email_pass = process.env.EMAIL_PASS || "vzna gxqt eyey pvbq"; // App password (securely stored on Render)

// NEW: Using explicit SMTP host/port for better reliability in deployment
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', // Explicit Gmail SMTP server
    port: 465, // Standard secure port for SMTPS
    secure: true, // Use SSL/TLS
    auth: {
        user: email_user,
        pass: email_pass // This MUST be the correct App Password
    },
    // Optional: Log connection errors for better debugging on Render
    logger: true 
});

// ✅ DATABASE CONFIG (Render + Local)
const db = mysql.createConnection({
  host: process.env.DB_HOST || "gondola.proxy.rlwy.net",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "nJHYvbTLKeJJsCOOatIuJxNgnvBhpqsb",
  database: process.env.DB_NAME || "hms",
  port: process.env.DB_PORT || 26543,
  ssl: { rejectUnauthorized: true },
  authPlugins: {
    mysql_clear_password: () => () => process.env.DB_PASSWORD || "nJHYvbTLKeJJsCOOatIuJxNgnvBhpqsb",
  }
});

db.connect((err) => {
  if (err) {
    console.error("❌ Database connection failed:", err.message);
  } else {
    console.log("✅ Connected to Railway MySQL successfully!");
  }
});

app.get("/", (req, res) => {
  res.send("🚀 Hostel Management Backend Connected to Railway!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`⚡ Server running on port ${PORT}`));

    // ------------------------------------------------------------------
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
app.post("/send-otp", (req, res) => {
    const { email, username } = req.body;
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ message: "❌ Please enter a valid email address format." });
    }

    // Check if the chosen username is already taken
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

            // Check if the email is already FULLY registered (username IS NOT NULL)
            const checkRegisteredSql = "SELECT username FROM register WHERE email = ? AND username IS NOT NULL";
            db.query(checkRegisteredSql, [email], (err, results) => {
                if (err) {
                    console.error("❌ DB Error during registered user check:", err);
                    return res.status(500).json({ message: "Database error. Please try again." });
                }
                
                if (results.length > 0) {
                    return res.status(409).json({ message: "❌ This email is already registered. Please login instead." });
                }

                // --- Generate OTP and Expiry ---
                const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP
                const otpExpires = new Date(Date.now() + 5 * 60000); // OTP expires in 5 minutes

                // Insert/Update the OTP into the database for the given email
                const insertUpdateOtpSql = `
                    INSERT INTO register (email, otp, otp_expires_at) 
                    VALUES (?, ?, ?) 
                    ON DUPLICATE KEY UPDATE otp = VALUES(otp), otp_expires_at = VALUES(otp_expires_at)`;

                db.query(insertUpdateOtpSql, [email, otp, otpExpires], (err) => {
                    if (err) {
                        console.error("❌ DB Error during OTP storage:", err);
                        return res.status(500).json({ message: "Database error during OTP storage. Try a different email." });
                    }

                    // --- Send Email ---
                    const mailOptions = {
                        from: email_user, 
                        to: email,
                        subject: 'Hostel Management OTP Verification',
                        text: `Your One-Time Password (OTP) for registration is: ${otp}. It is valid for 5 minutes.`,
                        html: `<p>Your One-Time Password (OTP) for registration is: <b>${otp}</b></p><p>It is valid for 5 minutes.</p>`
                    };

                    transporter.sendMail(mailOptions, (error, info) => {
                        if (error) {
                            console.error("❌ Nodemailer Error:", error);
                            return res.status(500).json({ message: "Failed to send OTP email." });
                        }
                        console.log('✅ Email sent: ' + info.response);
                        res.status(200).json({ message: "OTP sent successfully" });
                    });
                });
            });
        });
        return; 
    }

    // If no username provided, run only email check and send OTP
    const checkRegisteredSql = "SELECT username FROM register WHERE email = ? AND username IS NOT NULL";
    db.query(checkRegisteredSql, [email], (err, results) => {
        if (err) {
            console.error("❌ DB Error during registered user check:", err);
            return res.status(500).json({ message: "Database error. Please try again." });
        }
        
        if (results.length > 0) {
            return res.status(409).json({ message: "❌ This email is already registered. Please login instead." });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpires = new Date(Date.now() + 5 * 60000);

        const insertUpdateOtpSql = `
            INSERT INTO register (email, otp, otp_expires_at) 
            VALUES (?, ?, ?) 
            ON DUPLICATE KEY UPDATE otp = VALUES(otp), otp_expires_at = VALUES(otp_expires_at)`;

        db.query(insertUpdateOtpSql, [email, otp, otpExpires], (err) => {
            if (err) {
                console.error("❌ DB Error during OTP storage:", err);
                return res.status(500).json({ message: "Database error during OTP storage. Try a different email." });
            }

            const mailOptions = {
                from: email_user, 
                to: email,
                subject: 'Hostel Management OTP Verification',
                text: `Your One-Time Password (OTP) for registration is: ${otp}. It is valid for 5 minutes.`,
                html: `<p>Your One-Time Password (OTP) for registration is: <b>${otp}</b></p><p>It is valid for 5 minutes.</p>`
            };

            transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                    console.error("❌ Nodemailer Error:", error);
                    return res.status(500).json({ message: "Failed to send OTP email." });
                }
                console.log('✅ Email sent: ' + info.response);
                res.status(200).json({ message: "OTP sent successfully" });
            });
        });
    });
});

// ✅ Register API (Includes setting registered_at)
app.post("/register", (req, res) => {
    const { username, password, gender, email, contact, otp } = req.body;

    // --- 1. Verify OTP and Expiry ---
    const verifySql = "SELECT * FROM register WHERE email = ? AND otp = ? AND otp_expires_at > NOW()";
    db.query(verifySql, [email, otp], (err, results) => {
        if (err) {
            console.error("❌ DB Error during OTP verification:", err);
            return res.status(500).json({ message: "Database error" });
        }
        
        if (results.length === 0) {
            const checkUserSql = "SELECT 1 FROM register WHERE email = ?";
            db.query(checkUserSql, [email], (err, userCheck) => {
                if (userCheck.length > 0) {
                    return res.status(401).json({ message: "❌ Invalid or Expired OTP. Please resend." });
                } else {
                    return res.status(400).json({ message: "❌ Invalid OTP/Email combination." });
                }
            });
            return; 
        }

        // --- 2. Check for Username Uniqueness ---
        const checkUsernameSql = "SELECT 1 FROM register WHERE username = ? AND email != ?";
        db.query(checkUsernameSql, [username, email], (err3, userCheck) => {
            if (err3) {
                console.error("❌ DB Error during final username check:", err3);
                return res.status(500).json({ message: "Database error during username validation." });
            }
            if (userCheck.length > 0) {
                return res.status(409).json({ message: "❌ This Username is already taken. Please choose another." });
            }

            // --- 3. Complete Registration (Update User Data and set registered_at) ---
            const finalRegisterSql = `
                UPDATE register 
                SET username = ?, password = ?, gender = ?, contact = ?, 
                otp = NULL, otp_expires_at = NULL, registered_at = CURRENT_TIMESTAMP 
                WHERE email = ?`;
            
            db.query(finalRegisterSql, [username, password, gender, contact, email], (err2) => {

                if (err2) {
                    console.error("❌ Database Update Error:", err2);
                    if (err2.code === 'ER_DUP_ENTRY') {
                        return res.status(409).json({ message: "❌ Username or Email already taken. Please review your details." });
                    }
                    return res.status(500).json({ message: "Database error during final registration." });
                }
                res.status(200).json({ message: "✅ User registered successfully & Email Verified!" });
            });
        });
    });
});

// ✅ Login API (Updated to log to visitor_logs)
app.post("/login", (req, res) => {
    const { username, password } = req.body;
    const ip_address = req.ip || req.connection.remoteAddress;

    const sql = "SELECT * FROM register WHERE username = ? AND password = ?";
    db.query(sql, [username, password], (err, results) => {
        if (err) {
            console.error("❌ Database Error:", err);
            // Log failure (if the error is not database connection related, otherwise it fails)
            const logFailureSql = "INSERT INTO visitor_logs (username, ip_address, status) VALUES (?, ?, 'Failure')";
            db.query(logFailureSql, [username, ip_address]); 
            return res.status(500).json({ message: "Database error" });
        }
        if (results.length > 0) {
            // ✅ Log success
            const logSuccessSql = "INSERT INTO visitor_logs (username, ip_address, status) VALUES (?, ?, 'Success')";
            db.query(logSuccessSql, [username, ip_address]);
            // Return user details to the client so frontend can persist them
            const user = results[0];
            res.status(200).json({
                message: "✅ Login successful",
                username: user.username,
                email: user.email,
                gender: user.gender
            });
        } else {
            // Log failure
            const logFailureSql = "INSERT INTO visitor_logs (username, ip_address, status) VALUES (?, ?, 'Failure')";
            db.query(logFailureSql, [username, ip_address]);
            res.status(401).json({ message: "❌ Invalid username or password" });
        }
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

// Create new complaint
app.post('/complaints', (req, res) => {
    const { subject, description, category, location, username, user_id } = req.body;
    if (!subject || !description) return res.status(400).json({ error: 'subject and description required' });

    const sql = `INSERT INTO complaints (subject, description, category, location, username) VALUES (?, ?, ?, ?, ?)`;
    db.query(sql, [subject, description, category || null, location || null, username || null], (err, result) => {
        if (err) {
            console.error('Error inserting complaint (fallback):', err);
            return res.status(500).json({ error: 'Could not save complaint' });
        }
        return res.json({ ok: true, id: result.insertId, message: 'Complaint filed successfully' });
    });
});

// Get all complaints
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
    if (!username || !subject) return res.status(400).json({ message: 'username and subject required' });

    const sql = 'INSERT INTO notifications (username, subject, message, desired_room) VALUES (?, ?, ?, ?)';
    db.query(sql, [username, subject, message || null, desired_room || null], (err, result) => {
        if (err) {
            console.error('Error inserting notification:', err);
            return res.status(500).json({ message: 'DB error', error: err });
        }
        return res.json({ id: result.insertId, message: 'Notification created' });
    });
});

// Admin: list notifications (optionally only unread)
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

// Mark a notification read
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
        WHERE r.username IS NOT NULL AND r.username NOT IN (
            SELECT username FROM rooms WHERE username IS NOT NULL
        )
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ message: "DB error" });
        res.json(results);
    });
});

// ✅ Fetch available rooms with free beds
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

// ✅ Get available beds for a specific room
app.get("/available-beds/:room_no", (req, res) => {
    const room_no = req.params.room_no;

    const sql = "SELECT bed_no FROM rooms WHERE room_no = ? AND username IS NULL";
    db.query(sql, [room_no], (err, results) => {
        if (err) return res.status(500).json({ message: "DB error" });
        res.json(results);
    });
});

// ✅ Fetch all current assignments
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

    // --- 1. Get the gender of the student being assigned ---
    const getStudentGenderSql = "SELECT gender FROM register WHERE username = ?";
    db.query(getStudentGenderSql, [username], (err, studentResults) => {
        if (err) return res.status(500).json({ message: "DB error getting student gender" });
        if (studentResults.length === 0) return res.status(404).json({ message: "❌ Student not found" });

        const studentGender = studentResults[0].gender;

        // --- 2. Check the gender of students already in the room ---
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
            
            // --- 3. Find first free bed in that room ---
            const findBedSql = "SELECT bed_no FROM rooms WHERE room_no = ? AND username IS NULL LIMIT 1";
            db.query(findBedSql, [room_no], (err, freeBedResults) => {
                if (err) return res.status(500).json({ message: "DB error finding free bed" });
                
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

    const sql = `INSERT INTO student_details
                (username, email, contact, course, year, semester, prev_college, prev_result)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

    db.query(sql, [username, email, contact, course, year, semester, prevCollege, prevResult], (err) => {
        if (err) {
            console.error("❌ Database Insert Error:", err);
            return res.status(500).json({ message: "Database error" });
        }
        res.status(200).json({ message: "✅ Academic details saved successfully" });
    });
});

// Get academic details
app.get("/details/:username", (req, res) => {
    const username = req.params.username;
    const sql = "SELECT course, year, semester, prev_college, prev_result FROM student_details WHERE username = ?";
    db.query(sql, [username], (err, results) => {
        if (err) return res.status(500).json({ message: "DB error" });
        res.json(results[0]);
    });
});

// Fetch all students with academic details
app.get("/student-details", (req, res) => {
    const sql = "SELECT * FROM student_details";
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ message: "DB error" });
        res.json(results);
    });
});

// ✅ Delete a student completely (including room assignment and details)
app.delete("/students/:username", (req, res) => {
    const { username } = req.params;

    // Step 1: Free up any assigned room
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

// ✅ Rooms occupancy summary
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

// ------------------------------------------------------------------
// DUES COUNT
// ------------------------------------------------------------------
// Returns the number of students who have NOT been marked as 'Paid'.
// This includes users with status NULL (no record) or status != 'Paid' (e.g., Pending, Rejected)
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


// ✅ Start server
// Serve static frontend files if available (mounted into /usr/src/app/FRONTEND in Docker)
const path = require('path');
const FRONTEND_DIR = path.join(__dirname, 'FRONTEND');
if (require('fs').existsSync(FRONTEND_DIR)) {
    app.use(express.static(FRONTEND_DIR));
}

// Health endpoint
app.get('/health', (req, res) => {
    const uptime = process.uptime();
    db.ping((err) => {
        if (err) return res.status(500).json({ status: 'error', uptime, db: false, error: err.message });
        res.json({ status: 'ok', uptime, db: true });
    });
});
