# Campt's Collection

Premium Pokemon TCG card store. Curated cards from Japan.

## Struktur

```
campt-collection/
├── public/
│   ├── index.html        # Homepage — gallery, recent orders, FAQ
│   ├── vault.html        # Full catalog — grid + category filter + search
│   ├── checkout.html     # Checkout — form + payment instructions
│   ├── admin.html        # Admin dashboard — CRUD cards, orders, categories
│   ├── login.html        # Admin login
│   ├── pokeball.svg      # Favicon
│   └── uploads/          # Card images (multer storage)
├── server.js             # Backend (Express + SQLite) — ganti ke Supabase
├── package.json
└── BACKEND.md            # ← Full API spec untuk developer backend
```

## Quick Start (Current Backend — SQLite)

```bash
npm install
node server.js
# Open http://localhost:3000
```

## Backend Migration (Supabase)

Lihat **[BACKEND.md](BACKEND.md)** — spesifikasi lengkap database schema, API endpoints, auth, dan business logic yang perlu di-build di Supabase.

Frontend sudah siap, tinggal connect API.

## WhatsApp

Nomor: `6285815801715`
Link: `https://api.whatsapp.com/send/?phone=6285815801715&text&type=phone_number&app_absent=0`

## Payment

- **BCA Transfer:** 5920308661 a/n Christopher Alexander
- **QRIS:** via QR code
