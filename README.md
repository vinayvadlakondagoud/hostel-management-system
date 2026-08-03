# 🏨 Hostel Management System

A full-stack Hostel Management System designed to streamline hostel operations such as student management, room allocation, complaints, feedback, payments, and communication between students and wardens.

---

## 🚀 Live Demo

* 🌐 **Live App:** https://hostel-management-system-1-3c10.onrender.com

---

## 🧠 Features

* 👤 User Authentication (Login/Register)
* 🏠 Student Dashboard
* 🏨 Room Allocation & My Room
* 💳 Payment Management
* 📝 Feedback & Complaint System
* 📩 Messaging System (Student ↔ Warden)
* 🔔 Notices & Notifications
* 🍽️ Meal Management
* 🛠️ Admin/Warden Controls
* 📊 Organized Data Management
* 🌐 Fully Responsive UI

---

## 🛠️ Tech Stack

### Frontend:

* HTML5
* CSS3
* JavaScript (Vanilla)

### Backend:

* Node.js
* Express (v5)

### Database:

* MySQL

### Deployment:

* Docker / docker-compose
* Render (Live deployment)

---

## 📂 Project Structure

```
BACKEND   → Node.js + Express REST API (serves API + static frontend)
FRONTEND  → Vanilla HTML5 / CSS3 / JavaScript UI (served by Express)
```

---

## ⚙️ Installation & Setup

### 1️⃣ Prerequisites

* Node.js (>= 18)
* MySQL (8.x) or Docker

### 2️⃣ Clone Repository

```bash
git clone https://github.com/vinayvadlakondagoud/hostel-management-system.git
cd hostel-management-system
```

### 3️⃣ Backend Setup

```bash
cd BACKEND
npm install
npm start
```

> The Express server serves both the REST API and the static frontend (from the `FRONTEND` folder), so the app runs on a single port (`PORT`, default 3000).

### 4️⃣ Environment Variables

Create a `.env` file in `BACKEND/` with your database credentials:

```
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=HMS
```

### 5️⃣ Run with Docker (Alternative)

```bash
docker-compose up
```

---

## 📌 Future Improvements

* 📱 Mobile App Version
* 📈 Analytics Dashboard

---

## 🤝 Contributing

Contributions are welcome! Feel free to fork this repo and submit a pull request.

---

## 👨‍💻 Author

**Vinay Vadlakonda**

* GitHub: https://github.com/vinayvadlakondagoud

---

## ⭐ Show Your Support

If you like this project, give it a ⭐ on GitHub!
