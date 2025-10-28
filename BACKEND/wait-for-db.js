const mysql = require('mysql');
const { spawn } = require('child_process');

const DB_HOST = process.env.DB_HOST || 'db' || 'localhost';
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || 'admin@123';
const DB_NAME = process.env.DB_NAME || 'HMS';
const DB_PORT = process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306;

const RETRY_MS = 2000;

function tryConnect() {
  return new Promise((resolve, reject) => {
    const conn = mysql.createConnection({ host: DB_HOST, user: DB_USER, password: DB_PASSWORD, database: DB_NAME, port: DB_PORT });
    conn.connect((err) => {
      if (err) {
        conn.destroy();
        return reject(err);
      }
      conn.end();
      resolve();
    });
  });
}

async function waitAndStart() {
  console.log(`Waiting for MySQL at ${DB_HOST}:${DB_PORT}...`);
  while (true) {
    try {
      await tryConnect();
      console.log('MySQL is available — starting server.js');
      break;
    } catch (err) {
      console.log(`MySQL unavailable, retrying in ${RETRY_MS}ms — ${err.message}`);
      await new Promise(r => setTimeout(r, RETRY_MS));
    }
  }

  const child = spawn('node', ['server.js'], { stdio: 'inherit', env: process.env });
  child.on('exit', (code) => {
    console.log(`server.js exited with code ${code}`);
    process.exit(code);
  });
}

waitAndStart().catch(err => {
  console.error('wait-for-db failed:', err);
  process.exit(1);
});
