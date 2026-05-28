const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Generate a random JWT secret if not set in environment
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');

// Rate limiting store (in-memory, reset on restart)
const loginAttempts = new Map();
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

function checkRateLimit(ip) {
  const now = Date.now();
  const attempts = loginAttempts.get(ip) || [];
  const recent = attempts.filter(t => now - t < LOGIN_WINDOW_MS);
  loginAttempts.set(ip, recent);
  if (recent.length >= LOGIN_MAX_ATTEMPTS) {
    return false;
  }
  recent.push(now);
  return true;
}

// Middleware
app.use((req, res, next) => {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0'); // CSP handles this better
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://unpkg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self';"
  );
  // CORS restricted
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'http://localhost:3000';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public', { maxAge: 0, etag: false }));
app.use('/uploads', express.static('public/uploads'));

// Multer config for image uploads - strict extension whitelist
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'public/uploads/'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return cb(new Error('Invalid file type. Only images allowed.'));
    }
    const uniqueName = Date.now() + '-' + crypto.randomBytes(8).toString('hex') + ext;
    cb(null, uniqueName);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /^image\/(jpe?g|png|gif|webp)$/;
    if (!allowed.test(file.mimetype)) {
      return cb(new Error('Only image files are allowed'), false);
    }
    cb(null, true);
  }
});

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

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT UNIQUE NOT NULL,
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_ig TEXT,
    address TEXT NOT NULL,
    city TEXT NOT NULL,
    province TEXT NOT NULL,
    postal_code TEXT NOT NULL,
    items TEXT NOT NULL,
    total INTEGER NOT NULL,
    payment_method TEXT NOT NULL,
    notes TEXT,
    status TEXT DEFAULT 'pending',
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

// Seed default admin with a random password (print once)
const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!adminExists) {
  const randomPassword = crypto.randomBytes(6).toString('base64');
  const hashedPassword = bcrypt.hashSync(randomPassword, 12);
  db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run('admin', hashedPassword, 'admin');
  console.log('✅ Default admin created');
  console.log(`   Username: admin`);
  console.log(`   Password: ${randomPassword} (CHANGE THIS IMMEDIATELY)`);
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
    // ENFORCE: only admin role can access admin routes
    if (decoded.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
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

  // Rate limiting per IP
  const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
  if (!checkRateLimit(clientIp)) {
    return res.status(429).json({ error: 'Too many login attempts. Try again in 10 minutes.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const validPassword = bcrypt.compareSync(password, user.password);
  if (!validPassword) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(req.user.id);
  res.json(user);
});

// ========== CATEGORY ROUTES ==========
app.get('/api/categories', (req, res) => {
  const { all } = req.query;
  let categories;
  if (all === 'true') {
    categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  } else {
    categories = db.prepare(`
      SELECT DISTINCT c.* FROM categories c
      INNER JOIN cards ON cards.category = c.name
      WHERE cards.status = 'active'
      ORDER BY c.name
    `).all();
  }
  res.json(categories);
});

app.post('/api/admin/categories', authenticateToken, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Category name required' });

  try {
    const result = db.prepare('INSERT INTO categories (name) VALUES (?)').run(name);
    const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(result.lastInsertRowid));
    res.json(category);
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Category already exists' });
    console.error('Category create error:', err.message);
    return res.status(500).json({ error: 'Failed to create category' });
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

// ========== ORDER ROUTES ==========
app.post('/api/orders', (req, res) => {
  const { customer, items, payment_method, notes } = req.body;

  if (!customer || !items || items.length === 0) {
    return res.status(400).json({ error: 'Customer info and items required' });
  }

  // Input validation
  const nameRegex = /^[a-zA-Z0-9\s.'\-]{2,50}$/;
  if (!customer.name || !nameRegex.test(customer.name)) {
    return res.status(400).json({ error: 'Invalid customer name' });
  }
  if (!customer.email || !customer.email.includes('@')) {
    return res.status(400).json({ error: 'Invalid email' });
  }

  const total = items.reduce((sum, item) => {
    return sum + (parseInt(item.price.replace(/[^0-9]/g, '')) || 0);
  }, 0);

  // Generate order ID with random suffix (non-predictable)
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(-2);
  const randomSuffix = String(Math.floor(Math.random() * 900) + 100);
  const orderId = `purchase#${dd}${mm}${yy}${randomSuffix}`;

  try {
    db.prepare(`
      INSERT INTO orders (order_id, customer_name, customer_email, customer_phone, customer_ig, address, city, province, postal_code, items, total, payment_method, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(orderId, customer.name, customer.email, customer.phone, customer.instagram || '', customer.address, customer.city, customer.province, customer.postal_code, JSON.stringify(items), total, payment_method, notes || '');

    res.json({ order_id: orderId, message: 'Order placed successfully' });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Order already exists' });
    }
    console.error('Order create error:', err.message);
    return res.status(500).json({ error: 'Failed to place order' });
  }
});

app.get('/api/admin/orders', authenticateToken, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
  orders.forEach(o => { try { o.items = JSON.parse(o.items); } catch(e) { o.items = []; }});
  res.json(orders);
});

app.put('/api/admin/orders/:id/status', authenticateToken, (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'processing', 'awaiting_payment', 'shipped', 'completed', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);

  if (status === 'completed') {
    const order = db.prepare('SELECT items FROM orders WHERE id = ?').get(req.params.id);
    if (order) {
      try {
        const items = JSON.parse(order.items);
        const updateCard = db.prepare("UPDATE cards SET status = 'sold', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status != 'sold'");
        let soldCount = 0;
        items.forEach(item => {
          if (item.id) {
            const result = updateCard.run(item.id);
            soldCount += result.changes;
          }
        });
        return res.json({ message: soldCount > 0 ? `Order status updated — ${soldCount} card(s) marked as sold` : 'Order status updated' });
      } catch (err) {
        console.error('Failed to auto-mark cards as sold:', err.message);
      }
    }
  }

  res.json({ message: 'Order status updated' });
});

// Public recent buyers (for trust/social proof) - returns ONLY completed orders with blurred data
app.get('/api/recent-buyers', (req, res) => {
  try {
    const orders = db.prepare(`
      SELECT order_id, customer_name, items, status, created_at
      FROM orders WHERE status = 'completed'
      ORDER BY created_at DESC LIMIT 12
    `).all();

    const buyers = orders.map(o => {
      let items = [];
      try { items = JSON.parse(o.items); } catch(e) { items = []; }
      const name = o.customer_name;
      const blurred = name.length > 2 ? name.charAt(0) + '***' + name.charAt(name.length - 1) : name.charAt(0) + '***';
      return {
        order_id: o.order_id.replace(/(\d{6})\d{3}/, '$1###'),
        customer_name: blurred,
        item_names: items.map(i => i.name),
        date: new Date(o.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
      };
    });

    res.json(buyers);
  } catch (err) {
    console.error('Recent buyers error:', err.message);
    return res.status(500).json({ error: 'Failed to load recent buyers' });
  }
});

// Delete single order
app.delete('/api/admin/orders/:id', authenticateToken, (req, res) => {
  db.prepare('DELETE FROM orders WHERE id = ?').run(req.params.id);
  res.json({ message: 'Order deleted' });
});

// Clear all orders
app.delete('/api/admin/orders', authenticateToken, (req, res) => {
  db.prepare('DELETE FROM orders').run();
  res.json({ message: 'All orders cleared' });
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
  try {
    const cards = db.prepare(query).all(...params);
    res.json(cards);
  } catch (err) {
    console.error('Cards query error:', err.message);
    return res.status(500).json({ error: 'Failed to load cards' });
  }
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

  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(Number(result.lastInsertRowid));
  res.status(201).json(card);
});

app.put('/api/admin/cards/:id', authenticateToken, upload.single('image'), (req, res) => {
  const { name, category, price, set_name, origin, status } = req.body;
  const existing = db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Card not found' });

  let image_url = existing.image_url;
  if (req.file) {
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
});
