# 🍳 YOURI Backend API

Backend API untuk **YOURI (Your Smart Cooking Assistant)**, sebuah aplikasi pendamping memasak yang membantu pengguna menemukan resep berdasarkan bahan yang tersedia, memantau progres memasak, serta meningkatkan motivasi melalui sistem gamifikasi.

## 🚀 Fitur Utama

### 🔐 Authentication & Authorization

* Register akun
* Login menggunakan Email & Password
* Login menggunakan Google
* JWT Authentication
* Role-based Authorization (User & Admin)
* Reset Password menggunakan OTP

### 👤 User Management

* Melihat profil pengguna
* Mengubah data profil
* Mengubah password
* Upload foto profil

### 🍽️ Recipe Management

* Membuat resep
* Melihat daftar resep
* Detail resep
* Mengubah resep
* Menghapus resep
* Upload gambar resep

### 🤖 AI Recipe Recommendation

* Pencocokan resep berdasarkan bahan yang tersedia
* Persiapan memasak berbasis AI
* Hasil rekomendasi AI secara asynchronous

### 👨‍🍳 Cooking Activity

* Memulai sesi memasak
* Membatalkan sesi memasak
* Menyelesaikan sesi memasak
* Upload bukti hasil memasak

### 🎮 Gamification

* Sistem XP dan Level
* Weekly History
* Claim Weekly XP
* Sprite Collection
* Equip Sprite
* Level Up Notification

### 🔔 Notification System

* Daftar notifikasi
* Menandai notifikasi sebagai sudah dibaca

### 🛡️ Admin Panel

* Manajemen Sprite Package
* Manajemen Sprite Assets
* Moderasi laporan resep
* Takedown resep bermasalah
* Bulk Signature Upload

---

## 🏗️ Tech Stack

### Backend

* Node.js
* Express.js

### Database

* MongoDB
* Mongoose

### Authentication

* JWT (JSON Web Token)
* bcrypt

### AI

* Google Gemini API

### Cloud Services

* Cloudinary

### Cache

* Redis

### Scheduler

* Node Cron

### Email Service

* Nodemailer

---

## 📦 Dependencies

```json
{
  "@google/generative-ai": "^0.24.1",
  "axios": "^1.16.1",
  "bcrypt": "^6.0.0",
  "cloudinary": "^2.10.0",
  "cors": "^2.8.6",
  "dotenv": "^17.4.2",
  "express": "^5.2.1",
  "jsonwebtoken": "^9.0.3",
  "mongoose": "^9.6.2",
  "node-cron": "^4.2.1",
  "nodemailer": "^8.0.10",
  "redis": "^5.12.1"
}
```

---

## ⚙️ Instalasi

### 1. Clone Repository

```bash
git clone https://github.com/username/youri-backend.git
cd youri-backend
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Konfigurasi Environment

Buat file `.env`

```env
PORT=5000

MONGODB_URI=

JWT_SECRET=

GEMINI_API_KEY=

CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

REDIS_URL=

EMAIL_USER=
EMAIL_PASS=
```

### 4. Jalankan Aplikasi

Development:

```bash
npm run dev
```

Production:

```bash
npm start
```

---

## 📁 Struktur Proyek

```bash
src/
├── controllers/
│   ├── Admin/
│   ├── AuthController.js
│   ├── DashboardController.js
│   ├── ProfileController.js
│   ├── RecipeController.js
│   └── ...
│
├── middleware/
│   ├── authGuard.js
│   └── adminGuard.js
│
├── routes/
│   ├── userRoutes.js
│   ├── cookingRoutes.js
│   └── adminRoutes.js
│
├── models/
├── services/
├── utils/
└── server.js
```

---

## 🔗 API Endpoints

### Authentication

| Method | Endpoint                |
| ------ | ----------------------- |
| POST   | /register               |
| POST   | /login                  |
| POST   | /google-auth            |
| POST   | /request-password-reset |
| POST   | /verify-otp             |
| POST   | /reset-password         |

---

### Profile

| Method | Endpoint         |
| ------ | ---------------- |
| GET    | /profile         |
| PATCH  | /profile         |
| PATCH  | /change-password |

---

### Recipe

| Method | Endpoint     |
| ------ | ------------ |
| GET    | /recipes     |
| POST   | /recipes     |
| GET    | /recipes/:id |
| PUT    | /recipes/:id |
| DELETE | /recipes/:id |

---

### Cooking

| Method | Endpoint            |
| ------ | ------------------- |
| POST   | /match              |
| POST   | /preparing          |
| GET    | /ai-result/:task_id |
| POST   | /start              |
| POST   | /cancel             |
| POST   | /finish             |

---

### Gamification

| Method | Endpoint              |
| ------ | --------------------- |
| GET    | /weekly-history       |
| POST   | /weekly-history/claim |
| GET    | /sprites              |
| POST   | /sprites              |

---

### Notifications

| Method | Endpoint                |
| ------ | ----------------------- |
| GET    | /notifications          |
| PATCH  | /notifications/:id/read |

---

### Admin

| Method | Endpoint                      |
| ------ | ----------------------------- |
| GET    | /sprites/packages             |
| POST   | /sprites/packages             |
| PATCH  | /sprites/packages/:package_id |
| DELETE | /sprites/packages/:package_id |
| GET    | /reports                      |
| POST   | /reports/:report_id/action    |
| POST   | /recipes/:recipe_id/takedown  |

---

## 🔒 Security Features

* Password Hashing (bcrypt)
* JWT Authentication
* Role-based Access Control
* Protected Routes
* Cloudinary Signed Upload
* OTP Verification

---

## 👨‍💻 Tim Pengembang

**YOURI - Your Smart Cooking Assistant**

Dikembangkan sebagai proyek aplikasi pendamping memasak berbasis AI dan Gamifikasi untuk membantu pengguna memasak dengan lebih mudah, terarah, dan menyenangkan.

---

## 📄 License

This project is licensed under the MIT License.

```
```
