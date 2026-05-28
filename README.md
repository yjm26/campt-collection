# Campt's Collection - Premium Pokémon Vault

Full-stack web application with admin panel for managing Pokémon TCG cards.

## Quick Start

```bash
# Install dependencies
npm install

# Start server
npm start
```

Server runs at `http://localhost:3000`

## Default Admin Login

- **URL:** http://localhost:3000/login.html
- **Username:** `admin`
- **Password:** `admin123`

## Features

### Public Store
- 🎨 Clean, minimal design with Pokéball theme
- 🖱️ 3D rotatable pixel Pokéball (Canvas-based)
- 🔍 Search & category filters
- 📱 Responsive design
- 💳 Cards fetched dynamically from API

### Admin Panel
- 🔐 JWT-based authentication
- 📊 Dashboard with stats (total/active/sold)
- ➕ Add new cards with image upload
- ✏️ Edit existing cards
- 🗑️ Delete cards
- 🏷️ Status management (active/sold/inactive)
- 🖼️ Image upload with preview

### Backend
- Express.js server
- SQLite database (auto-created)
- JWT authentication
- Multer for file uploads
- CORS enabled

## API Endpoints

### Public
- `GET /api/cards` - List all cards
- `GET /api/cards/:id` - Get single card

### Admin (requires auth)
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get current user
- `POST /api/admin/cards` - Create card
- `PUT /api/admin/cards/:id` - Update card
- `DELETE /api/admin/cards/:id` - Delete card
- `GET /api/admin/stats` - Get statistics

## File Structure

```
campt-collection/
├── server.js          # Express backend
├── package.json
├── public/
│   ├── index.html     # Main store page
│   ├── login.html     # Admin login
│   ├── admin.html     # Admin panel
│   └── uploads/       # Uploaded images
└── campt.db           # SQLite database (auto-created)
```

## Environment Variables

- `PORT` - Server port (default: 3000)
- `JWT_SECRET` - Secret key for JWT tokens

## Security Notes

- Change the default admin password after first login
- Change `JWT_SECRET` in production
- Use HTTPS in production
