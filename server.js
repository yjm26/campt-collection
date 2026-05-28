const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'campt-collection-secret-key-2026';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public', { maxAge: 0, etag: false }));
app.use('/uploads', express.static('public/uploads'));

// Multer config for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'public/uploads/'),
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// ========== DATABASE SETUP ==========
const db = new Database('campt.db');
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'admin',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    grading TEXT,
    quantity INTEGER DEFAULT 1,
    description TEXT,
    price TEXT NOT NULL,
    image_url TEXT,
    set_name TEXT,
    origin TEXT DEFAULT 'JP',
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Seed default categories if empty
const catCount = db.prepare('SELECT COUNT(*) as count FROM categories').get();
if (catCount.count === 0) {
  const defaultCats = ['Holo / Reverse', 'EX / GX', 'V / VSTAR / VMAX', 'Vintage / Modern', 'AR / CHR / SAR', 'SR', 'Slab', 'Promo', 'Booster Box', 'Legendary'];
  const insertCat = db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)');
  defaultCats.forEach(c => insertCat.run(c));
  console.log('✅ Default categories seeded');
}

// Seed default admin if not exists
const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!adminExists) {
  const hashedPassword = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run('admin', hashedPassword, 'admin');
  console.log('✅ Default admin created: admin / admin123');
}

// Seed sample cards if empty
const cardCount = db.prepare('SELECT COUNT(*) as count FROM cards').get();
if (cardCount.count === 0) {
  const sampleCards = [
    { name: 'Ho-Oh Legend (Bawah)', category: 'Legendary', price: 'RP 4.500.000', set_name: 'Legendary Collection', image_url: '' },
    { name: 'Drowzee', category: 'Base Set', price: 'RP 2.800.000', set_name: 'Base Set', image_url: '', status: 'sold' },
    { name: 'Charizard VMAX', category: "Champion's Path", price: 'RP 15.000.000', set_name: "Champion's Path", image_url: '' },
    { name: 'Glaceon V', category: 'Eeveelutions', price: 'RP 3.200.000', set_name: 'Eeveelutions', image_url: '' },
  ];
  const insert = db.prepare('INSERT INTO cards (name, category, price, set_name, image_url, status) VALUES (?, ?, ?, ?, ?, ?)');
  sampleCards.forEach(c => insert.run(c.name, c.category, c.price, c.set_name, c.image_url, c.status || 'active'));
  console.log('✅ Sample cards seeded');
}

// ========== AUTH MIDDLEWARE ==========
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token required' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

// ========== AUTH ROUTES ==========
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const validPassword = bcrypt.compareSync(password, user.password);
  if (!validPassword) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(req.user.id);
  res.json(user);
});

// ========== CATEGORY ROUTES ==========
app.get('/api/categories', (req, res) => {
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  res.json(categories);
});

app.post('/api/admin/categories', authenticateToken, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Category name required' });
  
  try {
    const result = db.prepare('INSERT INTO categories (name) VALUES (?)').run(name);
    const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid);
    res.json(category);
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Category already exists' });
    throw err;
  }
});

app.put('/api/admin/categories/:id', authenticateToken, (req, res) => {
  const { name } = req.body;
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Category not found' });
  
  db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name || existing.name, req.params.id);
  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  res.json(category);
});

app.delete('/api/admin/categories/:id', authenticateToken, (req, res) => {
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Category not found' });
  
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ message: 'Category deleted' });
});

// ========== CARD ROUTES (PUBLIC) ==========
app.get('/api/cards', (req, res) => {
  const { category, status } = req.query;
  let query = 'SELECT * FROM cards';
  const params = [];

  if (category || status) {
    const conditions = [];
    if (category) { conditions.push('category = ?'); params.push(category); }
    if (status) { conditions.push('status = ?'); params.push(status); }
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY created_at DESC';
  const cards = db.prepare(query).all(...params);
  res.json(cards);
});

app.get('/api/cards/:id', (req, res) => {
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id);
  if (!card) return res.status(404).json({ error: 'Card not found' });
  res.json(card);
});

// ========== CARD ROUTES (ADMIN) ==========
app.post('/api/admin/cards', authenticateToken, upload.single('image'), (req, res) => {
  const { name, category, price, set_name, origin, status } = req.body;
  if (!name || !category || !price) return res.status(400).json({ error: 'Name, category, and price required' });

  const image_url = req.file ? `/uploads/${req.file.filename}` : '';
  const result = db.prepare(
    'INSERT INTO cards (name, category, price, set_name, image_url, origin, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(name, category, price, set_name || '', image_url, origin || 'JP', status || 'active');

  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(card);
});

app.put('/api/admin/cards/:id', authenticateToken, upload.single('image'), (req, res) => {
  const { name, category, price, set_name, origin, status } = req.body;
  const existing = db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Card not found' });

  let image_url = existing.image_url;
  if (req.file) {
    // Delete old image
    if (existing.image_url) {
      const oldPath = path.join(__dirname, 'public', existing.image_url);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    image_url = `/uploads/${req.file.filename}`;
  }

  db.prepare(
    'UPDATE cards SET name=?, category=?, price=?, set_name=?, image_url=?, origin=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
  ).run(
    name || existing.name,
    category || existing.category,
    price || existing.price,
    set_name !== undefined ? set_name : existing.set_name,
    image_url,
    origin || existing.origin,
    status || existing.status,
    req.params.id
  );

  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id);
  res.json(card);
});

app.delete('/api/admin/cards/:id', authenticateToken, (req, res) => {
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id);
  if (!card) return res.status(404).json({ error: 'Card not found' });

  // Delete image file
  if (card.image_url) {
    const imgPath = path.join(__dirname, 'public', card.image_url);
    if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
  }

  db.prepare('DELETE FROM cards WHERE id = ?').run(req.params.id);
  res.json({ message: 'Card deleted' });
});

// ========== STATS ROUTE ==========
app.get('/api/admin/stats', authenticateToken, (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as count FROM cards').get().count;
  const active = db.prepare("SELECT COUNT(*) as count FROM cards WHERE status = 'active'").get().count;
  const sold = db.prepare("SELECT COUNT(*) as count FROM cards WHERE status = 'sold'").get().count;
  res.json({ total, active, sold });
});

// ========== START SERVER ==========
app.listen(PORT, () => {
  console.log(`🚀 Campt's Collection server running on http://localhost:${PORT}`);
  console.log(`📦 Admin panel: http://localhost:${PORT}/admin.html`);
  console.log(`🔐 Default login: admin / admin123`);
});
