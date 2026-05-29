# Campt's Collection — Backend Spec (Supabase)

Frontend sudah jadi, tinggal connect ke backend. Dokumen ini spesifikasi lengkap yang perlu di-build di Supabase.

---

## Tech Stack

- **Database:** PostgreSQL (Supabase)
- **Storage:** Supabase Storage bucket `uploads` untuk gambar kartu
- **Auth:** JWT-based (custom login, bukan Supabase Auth)
- **Deployment:** Edge Functions / Express.js di Railway / Render / VPS

---

## Database Schema

### 1. `users` (Admin)

| Kolom | Tipe | Constraint |
|---|---|---|
| `id` | `SERIAL` | PRIMARY KEY |
| `username` | `TEXT` | UNIQUE, NOT NULL |
| `password` | `TEXT` | NOT NULL (bcrypt hash) |
| `role` | `TEXT` | DEFAULT `'admin'` |
| `created_at` | `TIMESTAMP` | DEFAULT `NOW()` |

**Seed:** Buat 1 admin. `username: "admin"`, `password: bcrypt("admin123")`.

### 2. `cards` (Produk Kartu)

| Kolom | Tipe | Constraint |
|---|---|---|
| `id` | `SERIAL` | PRIMARY KEY |
| `name` | `TEXT` | NOT NULL |
| `category` | `TEXT` | NOT NULL |
| `grading` | `TEXT` | NULL |
| `quantity` | `INTEGER` | DEFAULT 1 |
| `description` | `TEXT` | NULL |
| `price` | `TEXT` | NOT NULL (format: `"RP 4.500.000"`) |
| `image_url` | `TEXT` | NULL (path: `/uploads/filename.jpg`) |
| `set_name` | `TEXT` | NULL |
| `origin` | `TEXT` | DEFAULT `'JP'` |
| `status` | `TEXT` | DEFAULT `'active'` (`active`, `sold`, `inactive`) |
| `created_at` | `TIMESTAMP` | DEFAULT `NOW()` |
| `updated_at` | `TIMESTAMP` | DEFAULT `NOW()` |

### 3. `categories`

| Kolom | Tipe | Constraint |
|---|---|---|
| `id` | `SERIAL` | PRIMARY KEY |
| `name` | `TEXT` | UNIQUE, NOT NULL |
| `created_at` | `TIMESTAMP` | DEFAULT `NOW()` |

**Seed default:** `Holo / Reverse`, `EX / GX`, `V / VSTAR / VMAX`, `Vintage / Modern`, `AR / CHR / SAR`, `SR`, `Slab`, `Promo`, `Booster Box`, `Legendary`.

### 4. `orders`

| Kolom | Tipe | Constraint |
|---|---|---|
| `id` | `SERIAL` | PRIMARY KEY |
| `order_id` | `TEXT` | UNIQUE, NOT NULL (format: `purchase#DDMMYY###`) |
| `customer_name` | `TEXT` | NOT NULL |
| `customer_email` | `TEXT` | NOT NULL |
| `customer_phone` | `TEXT` | NOT NULL |
| `customer_ig` | `TEXT` | NULL |
| `address` | `TEXT` | NOT NULL |
| `city` | `TEXT` | NOT NULL |
| `province` | `TEXT` | NOT NULL |
| `postal_code` | `TEXT` | NOT NULL |
| `items` | `JSONB` | NOT NULL (array of cart items) |
| `total` | `INTEGER` | NOT NULL (total in rupiah) |
| `payment_method` | `TEXT` | NOT NULL (`BCA Transfer`, `QRIS`) |
| `notes` | `TEXT` | NULL |
| `status` | `TEXT` | DEFAULT `'pending'` (`pending`, `processing`, `awaiting_payment`, `shipped`, `completed`, `cancelled`) |
| `created_at` | `TIMESTAMP` | DEFAULT `NOW()` |

---

## Auth

### JWT Config
- **Secret:** Dari env var `JWT_SECRET`
- **Payload:** `{ id, username, role }`
- **Expiry:** 8 jam
- **Header:** `Authorization: Bearer <token>`

### Login Rate Limiting
- Max **5 attempts per IP** dalam 10 menit.
- Jika exceed, return `429` dengan pesan `"Too many login attempts. Try again in 10 minutes."`

---

## API Endpoints

### Auth

#### `POST /api/auth/login`
**Body:**
```json
{ "username": "admin", "password": "admin123" }
```
**Response 200:**
```json
{
  "token": "eyJ...",
  "user": { "id": 1, "username": "admin", "role": "admin" }
}
```
**Response 401:** `{ "error": "Invalid credentials" }`
**Response 429:** `{ "error": "Too many login attempts..." }`

#### `GET /api/auth/me`
**Headers:** `Authorization: Bearer <token>`
**Response 200:** `{ "id": 1, "username": "admin", "role": "admin" }`
**Response 401:** `{ "error": "Access token required" }`
**Response 403:** `{ "error": "Invalid or expired token" }`

---

### Cards (Public)

#### `GET /api/cards`
**Query:** `?status=active` (index.html), `?all=true` (admin.html — via header), `?category=Legendary` (opsional)
**Response 200:**
```json
[
  {
    "id": 1,
    "name": "Ho-Oh Legend (Bawah)",
    "category": "Legendary",
    "grading": null,
    "quantity": 1,
    "description": null,
    "price": "RP 4.500.000",
    "image_url": "/uploads/123-abc.jpg",
    "set_name": "Legendary Collection",
    "origin": "JP",
    "status": "active",
    "created_at": "2026-05-29T10:00:00Z",
    "updated_at": "2026-05-29T10:00:00Z"
  }
]
```

#### `GET /api/cards/:id`
**Response 200:** Single card object
**Response 404:** `{ "error": "Card not found" }`

---

### Cards (Admin — requires JWT)

#### `POST /api/admin/cards`
**Content-Type:** `multipart/form-data`
**Fields:** `name`, `category`, `price`, `set_name` (optional), `origin` (default `JP`), `status` (default `active`), `image` (file, optional)

**Response 201:** Created card object

**Image handling:**
- Simpan di Supabase Storage bucket `uploads`
- `image_url` = URL public file (bisa path relatif `/uploads/filename.jpg` jika di-serve sendiri)
- Allowed: `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`
- Max size: 5MB

#### `PUT /api/admin/cards/:id`
**Content-Type:** `multipart/form-data` (sama seperti POST)
- Jika `image` baru diupload, hapus gambar lama dari storage
- Field yang tidak dikirim = tetap pakai value lama

**Response 200:** Updated card object
**Response 404:** `{ "error": "Card not found" }`

#### `DELETE /api/admin/cards/:id`
- Hapus gambar dari storage jika ada
- Hapus record dari database

**Response 200:** `{ "message": "Card deleted" }`
**Response 404:** `{ "error": "Card not found" }`

---

### Categories

#### `GET /api/categories`
**Query:** `?all=true` (admin, butuh JWT untuk lihat semua), tanpa query (public — hanya kategori yang punya card aktif)

**Response 200:**
```json
[
  { "id": 1, "name": "Legendary", "created_at": "..." }
]
```

#### `POST /api/admin/categories` (JWT required)
**Body:** `{ "name": "Vintage" }`
**Response 200:** `{ "id": 2, "name": "Vintage", "created_at": "..." }`
**Response 400:** `{ "error": "Category name required" }` atau `{ "error": "Category already exists" }`

#### `PUT /api/admin/categories/:id` (JWT required)
**Body:** `{ "name": "New Name" }`
**Response 200:** Updated category

#### `DELETE /api/admin/categories/:id` (JWT required)
**Response 200:** `{ "message": "Category deleted" }`

---

### Orders

#### `POST /api/orders` (Public — checkout)
**Body:**
```json
{
  "customer": {
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "+62 812-3456-7890",
    "instagram": "@username",
    "address": "Jl. Contoh No. 1",
    "city": "Jakarta",
    "province": "DKI Jakarta",
    "postal_code": "12345"
  },
  "items": [
    { "id": 1, "name": "Ho-Oh Legend", "price": "RP 4.500.000", "category": "Legendary" }
  ],
  "payment_method": "BCA Transfer",
  "notes": ""
}
```

**Response 200:**
```json
{ "order_id": "purchase#290526456", "message": "Order placed successfully" }
```

**Rules:**
- Generate `order_id` format: `purchase#DDMMYY###` (random 3 digit suffix)
- `total` = sum dari `parseInt(item.price.replace(/[^0-9]/g, ''))`
- Validasi: name harus match `^[a-zA-Z0-9\s.'\-]{2,50}$`, email harus ada `@`

**Response 400:** `{ "error": "Customer info and items required" }` atau validasi error
**Response 409:** `{ "error": "Order already exists" }` (jika order_id collision)

#### `GET /api/admin/orders` (JWT required)
**Response 200:** Array of orders, `items` field sudah di-parse dari JSONB menjadi array.

#### `PUT /api/admin/orders/:id/status` (JWT required)
**Body:** `{ "status": "completed" }`
**Valid statuses:** `pending`, `processing`, `awaiting_payment`, `shipped`, `completed`, `cancelled`

**Business logic:** Jika status = `completed`, otomatis update `status = 'sold'` untuk semua card di `items` yang punya `id`.

**Response 200:** `{ "message": "Order status updated" }`

#### `DELETE /api/admin/orders/:id` (JWT required)
**Response 200:** `{ "message": "Order deleted" }`

#### `DELETE /api/admin/orders` (JWT required)
Clear semua orders.
**Response 200:** `{ "message": "All orders cleared" }`

---

### Social Proof (Public)

#### `GET /api/recent-buyers`
Return completed orders (blurred) untuk section "Recent Orders" di homepage.

**Response 200:**
```json
[
  {
    "order_id": "purchase#290526###",
    "customer_name": "J***n",
    "item_names": ["Ho-Oh Legend"],
    "date": "29 May 2026"
  }
]
```

**Rules:**
- Hanya `status = 'completed'`
- `customer_name` di-blur: char pertama + `***` + char terakhir
- `order_id` di-blur: 6 digit pertama, sisanya `###`
- Limit 12, sort DESC by `created_at`

#### `GET /api/active-orders` (saat ini tidak dipakai frontend, tapi ada di backend)
Return non-completed orders (blurred).

**Response 200:**
```json
[
  {
    "order_id": "purchase#290526###",
    "customer_name": "J***n",
    "item_names": ["Ho-Oh Legend"],
    "total": 4500000,
    "status": "pending",
    "status_label": "Awaiting Payment",
    "status_color": "orange",
    "date": "29 May 2026"
  }
]
```

---

## Supabase Specific Notes

### RLS (Row Level Security)
- `cards`: SELECT public (tanpa auth), INSERT/UPDATE/DELETE hanya dengan JWT admin
- `orders`: INSERT public (checkout), SELECT/UPDATE/DELETE hanya admin
- `categories`: SELECT public, INSERT/UPDATE/DELETE hanya admin
- `users`: SELECT hanya admin

### JWT Integration
Karena login custom (bukan Supabase Auth), ada 2 opsi:

1. **Express.js middleware** — buat Express server terpisah (Railway/Render), handle JWT sendiri, query Supabase via `@supabase/supabase-js` client
2. **Supabase Edge Functions** — deploy semua endpoint sebagai Edge Functions, JWT verification manual di function

Opsi 1 lebih mudah karena backend sudah ada (`server.js`), tinggal ganti `better-sqlite3` → `@supabase/supabase-js`.

### Image Storage
- Bucket: `uploads` (public)
- Path: `uploads/<timestamp>-<random>.<ext>`
- Supabase public URL: `https://<project>.supabase.co/storage/v1/object/public/uploads/<path>`
- Frontend expect `image_url` format: `/uploads/filename.jpg` (relative) atau full URL

### CORS
Set `ALLOWED_ORIGIN` ke domain frontend (Vercel, localhost, dll).

---

## Frontend Files Reference

| File | Halaman | API yang dipakai |
|---|---|---|
| `public/index.html` | Homepage (gallery, recent orders) | `GET /api/cards?status=active`, `GET /api/recent-buyers` |
| `public/vault.html` | Full catalog + filter categories | `GET /api/cards`, `GET /api/categories` |
| `public/checkout.html` | Checkout form | `POST /api/orders` |
| `public/admin.html` | Admin dashboard (CRUD cards, orders, categories) | Semua `/api/admin/*` |
| `public/login.html` | Admin login | `POST /api/auth/login`, `GET /api/auth/me` |

---

## Frontend Base URL

Frontend gunakan `API_BASE = window.location.origin` — artinya API harus served dari domain yang sama, atau base URL perlu diubah jika terpisah.

Untuk development: `http://localhost:3000`
Untuk production: ganti `API_BASE` di setiap halaman atau set proxy/Vercel rewrites.
