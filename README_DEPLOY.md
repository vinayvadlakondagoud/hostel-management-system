Notes about Docker Compose changes
- The backend now mounts the `FRONTEND/` folder and serves it via Express static middleware. A separate nginx frontend service is no longer required.
- A `wait-for-db.js` helper is used to wait for MySQL availability before starting the Node server in the container. `docker-compose` runs `node wait-for-db.js`.

2. Create `docker-compose.yml` at repo root:
3. Start Docker Compose (PowerShell):

4. Health checks & logs:
    docker exec -it <db_container_name> mysql -u root -p

Health endpoint
- Backend exposes GET /health which returns JSON { status: 'ok', db: true } when the server and DB are reachable. The Compose file includes a healthcheck that probes this endpoint.
Deployment guide — Hostel Management System

This guide shows how to run the full stack (MySQL + Node backend + static frontend) locally and with Docker Compose.

Quick prerequisites
- Docker & Docker Compose (for the recommended approach)
- Node.js & npm (for local/manual runs)
- MySQL (local) or access to a managed MySQL instance

A. Run locally (quick)
1. Start MySQL and create database/user (example):

    mysql -u root -p
    CREATE DATABASE IF NOT EXISTS HMS;
    CREATE USER 'hms_user'@'localhost' IDENTIFIED BY 'your_password';
    GRANT ALL PRIVILEGES ON HMS.* TO 'hms_user'@'localhost';
    FLUSH PRIVILEGES;
    EXIT;

2. Install backend dependencies and start server:

    cd "BACKEND"
    npm install

    # set env vars (PowerShell example)
    $env:DB_HOST='127.0.0.1'
    $env:DB_USER='hms_user'
    $env:DB_PASSWORD='your_password'
    $env:DB_NAME='HMS'
    $env:PORT='3000'
    node server.js

3. Serve frontend (if your backend doesn't already serve static files):

    # From FRONTEND folder
    cd "FRONTEND"
    npx http-server -p 8080

4. Open the app
- Backend API: http://localhost:3000
- Frontend (nginx/http-server): http://localhost:8080 (or backend if it serves static files)

B. Docker Compose (recommended)
1. Review `docker-compose.yml` and set secure passwords in the file or use environment variables.
2. From repo root run:

    docker-compose up -d --build

3. Verify containers:

    docker-compose ps
    docker-compose logs -f backend

4. Visit the app
- Frontend: http://localhost:8080
- Backend API: http://localhost:3000

Notes:
- The `frontend` service uses nginx to serve files from `./FRONTEND`. If you prefer the backend to serve the static files, update `server.js` to use `express.static` and remove or ignore the `frontend` service.
- The backend container mounts `./FRONTEND` into `/usr/src/app/FRONTEND` so at runtime the server can serve static files without rebuilding the image.

C. Cloud / production notes
- Use a managed database (RDS, Cloud SQL, etc.) in production.
- Store secrets in environment variable stores or secrets manager (do not commit them).
- Add TLS (nginx or cloud provider) and a domain name.
- Implement server-side authentication/authorization (localStorage-based role checks are insufficient for production).

D. Helpful commands
- Stop & remove containers:
    docker-compose down

- View logs:
    docker-compose logs -f backend

- Rebuild after code changes:
    docker-compose up -d --build backend

If you'd like, I can also:
- Add a small health endpoint to `server.js` (GET /health → 200) and wire docker-compose healthchecks.
- Add a script to wait for MySQL readiness before starting the backend (start script wrapper).
- Push the images to a registry and prepare a Render/Heroku/Cloud Run deploy config.

Tell me which of the optional tasks you want me to do next and I'll implement them.

---

Render one-click deploy (detailed)
----------------------------------
This section provides a step-by-step Render deployment using Docker. It assumes you pushed the repo to GitHub and will let Render build the Docker image from `BACKEND/Dockerfile` using the repository root as the build context (so FRONTEND files are included in the image).

1) Prepare the repository
    - Ensure your code is pushed to GitHub (branch: `main` or `master`).
    - Confirm `BACKEND/Dockerfile` exists and the project root contains `FRONTEND/` and `BACKEND/` directories.

2) Create a managed MySQL (recommended) or external MySQL
    - On Render: New → Databases → MySQL (if available). Create credentials and note host/port/user/password/db name.
    - If you prefer PlanetScale/ClearDB/Amazon RDS, create a database there and copy credentials.

3) Create the Render Web Service
    - In Render dashboard click New → Web Service.
    - Select your GitHub repo and choose the branch.
    - For "Environment" pick Docker.
    - For "Dockerfile Path" use `BACKEND/Dockerfile`.
    - Leave Build Command empty (Dockerfile will be used).
    - Leave Start Command empty (Dockerfile's CMD runs `npm start`).
    - Set Health Check Path to `/health`.

4) Set environment variables (in Render Dashboard → Environment)
    - DB_HOST: <managed-db-host>
    - DB_PORT: <managed-db-port> (usually 3306)
    - DB_USER: <db-username>
    - DB_PASSWORD: <db-password>
    - DB_NAME: <db-name>
    - PORT: 3000

    If you created a Render Managed Database, you may be able to "Link" it to the service so Render populates these automatically.

5) Deploy & verify
    - Click Create Service / Deploy.
    - Watch build logs on Render. After startup, visit the provided URL e.g. `https://your-service.onrender.com`.
    - Health check: `https://your-service.onrender.com/health` should return `{"status":"ok","db":true,...}`.
    - Test API endpoints: `/complaints`, `/dues-count` etc.

Optional: add a GitHub README "Deploy to Render" button
    - Add this to your repo README (replace REPO_URL with your GitHub repo):

```markdown
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://dashboard.render.com/start/docker?repo=REPO_URL)
```

Troubleshooting
    - Build fails: check Dockerfile context and that Dockerfile copies the `FRONTEND` files if you expect static files in the image.
    - DB connection errors: confirm DB credentials and that the DB's inbound rules allow connections from Render. Use private networking or Render's "Link a Database" if available.
    - Logs: use Render's service logs to see `wait-for-db` output and server logs.

If you want, I can generate a `render.yaml` manifest that declares the Web Service and the Database so deployment can be done by importing the manifest into Render (this effectively becomes a one-file deploy). Tell me if you want the `render.yaml` next and I will create it.