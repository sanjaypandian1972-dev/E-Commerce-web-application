require('dotenv').config();
const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'change-this-secret-before-deploying';

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'ecommerce_app',
  waitForConnections: true,
  connectionLimit: 10,
});

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const sign = u => jwt.sign({ id: u.id, name: u.name, role: u.role }, SECRET, { expiresIn: '7d' });

// --- Auth middleware ---
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  try { req.user = jwt.verify(h.replace('Bearer ', ''), SECRET); next(); }
  catch (e) { bad(res, 'Please sign in again.', 401); }
}
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return bad(res, 'Admin access only.', 403);
  next();
}

// --- Auth routes ---
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name || !email || !password) return bad(res, 'Name, email and password are required.');
    if (String(password).length < 6) return bad(res, 'Password must be at least 6 characters.');
    const mail = String(email).trim().toLowerCase();
    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [mail]);
    if (existing.length) return bad(res, 'That email is already registered.', 409);
    const hash = await bcrypt.hash(String(password), 10);
    const [r] = await pool.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [String(name).trim().slice(0, 100), mail, hash, 'user']
    );
    const user = { id: r.insertId, name, role: 'user' };
    res.status(201).json({ token: sign(user), user: { id: user.id, name, role: 'user' } });
  } catch (e) { console.error(e); bad(res, 'Could not create account. Is the database set up?', 500); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [String(email || '').trim().toLowerCase()]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(String(password || ''), user.password_hash)))
      return bad(res, 'Wrong email or password.', 401);
    res.json({ token: sign(user), user: { id: user.id, name: user.name, role: user.role } });
  } catch (e) { console.error(e); bad(res, 'Login failed. Is the database running?', 500); }
});

// --- Products ---
app.get('/api/products', async (req, res) => {
  try {
    const { q, category } = req.query;
    let sql = 'SELECT * FROM products WHERE 1=1';
    const params = [];
    if (q) { sql += ' AND (name LIKE ? OR description LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
    if (category) { sql += ' AND category = ?'; params.push(category); }
    sql += ' ORDER BY created_at DESC';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { console.error(e); bad(res, 'Could not load products.', 500); }
});

function cleanProduct(b, partial) {
  const p = {};
  if (b.name !== undefined) p.name = String(b.name).trim().slice(0, 150);
  if (b.description !== undefined) p.description = String(b.description).trim().slice(0, 2000);
  if (b.price !== undefined) p.price = Number(b.price);
  if (b.stock !== undefined) p.stock = parseInt(b.stock, 10);
  if (b.image_url !== undefined) p.image_url = String(b.image_url).trim().slice(0, 500);
  if (b.category !== undefined) p.category = String(b.category).trim().slice(0, 80);
  if (!partial) {
    if (!p.name) return null;
    if (!(p.price >= 0)) return null;
    if (!(p.stock >= 0)) p.stock = 0;
  }
  return p;
}

app.post('/api/products', auth, requireAdmin, async (req, res) => {
  const p = cleanProduct(req.body || {}, false);
  if (!p) return bad(res, 'Name and a valid price are required.');
  try {
    const [r] = await pool.query(
      'INSERT INTO products (name, description, price, stock, image_url, category) VALUES (?,?,?,?,?,?)',
      [p.name, p.description || '', p.price, p.stock || 0, p.image_url || '', p.category || '']
    );
    const [[row]] = await pool.query('SELECT * FROM products WHERE id = ?', [r.insertId]);
    res.status(201).json(row);
  } catch (e) { console.error(e); bad(res, 'Could not create product.', 500); }
});

app.put('/api/products/:id', auth, requireAdmin, async (req, res) => {
  const p = cleanProduct(req.body || {}, true);
  const fields = Object.keys(p);
  if (!fields.length) return bad(res, 'Nothing to update.');
  try {
    await pool.query(`UPDATE products SET ${fields.map(f => f + ' = ?').join(', ')} WHERE id = ?`,
      [...fields.map(f => p[f]), req.params.id]);
    const [[row]] = await pool.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (!row) return bad(res, 'Product not found.', 404);
    res.json(row);
  } catch (e) { console.error(e); bad(res, 'Could not update product.', 500); }
});

app.delete('/api/products/:id', auth, requireAdmin, async (req, res) => {
  try {
    const [r] = await pool.query('DELETE FROM products WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return bad(res, 'Product not found.', 404);
    res.status(204).end();
  } catch (e) { console.error(e); bad(res, 'Could not delete product. It may be referenced by past orders.', 500); }
});

// --- Orders / checkout ---
app.post('/api/orders', auth, async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return bad(res, 'Your cart is empty.');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let total = 0;
    const lines = [];
    for (const it of items) {
      const qty = parseInt(it.quantity, 10);
      if (!qty || qty < 1) continue;
      const [[product]] = await conn.query('SELECT * FROM products WHERE id = ? FOR UPDATE', [it.product_id]);
      if (!product) throw { code: 404, msg: `Product ${it.product_id} no longer exists.` };
      if (product.stock < qty) throw { code: 409, msg: `Not enough stock for "${product.name}".` };
      await conn.query('UPDATE products SET stock = stock - ? WHERE id = ?', [qty, product.id]);
      total += Number(product.price) * qty;
      lines.push({ product_id: product.id, product_name: product.name, price: product.price, quantity: qty });
    }
    if (!lines.length) throw { code: 400, msg: 'Your cart is empty.' };
    const [orderResult] = await conn.query(
      'INSERT INTO orders (user_id, total, status) VALUES (?, ?, ?)', [req.user.id, total, 'pending']
    );
    for (const l of lines) {
      await conn.query(
        'INSERT INTO order_items (order_id, product_id, product_name, price, quantity) VALUES (?,?,?,?,?)',
        [orderResult.insertId, l.product_id, l.product_name, l.price, l.quantity]
      );
    }
    await conn.commit();
    res.status(201).json({ id: orderResult.insertId, total, status: 'pending' });
  } catch (e) {
    await conn.rollback();
    if (e.code && e.msg) bad(res, e.msg, e.code);
    else { console.error(e); bad(res, 'Checkout failed.', 500); }
  } finally { conn.release(); }
});

app.get('/api/orders/mine', auth, async (req, res) => {
  try {
    const [orders] = await pool.query('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]);
    for (const o of orders) {
      const [items] = await pool.query('SELECT * FROM order_items WHERE order_id = ?', [o.id]);
      o.items = items;
    }
    res.json(orders);
  } catch (e) { console.error(e); bad(res, 'Could not load orders.', 500); }
});

app.get('/api/orders', auth, requireAdmin, async (req, res) => {
  try {
    const [orders] = await pool.query(
      `SELECT o.*, u.name AS customer_name, u.email AS customer_email
       FROM orders o JOIN users u ON u.id = o.user_id ORDER BY o.created_at DESC`
    );
    for (const o of orders) {
      const [items] = await pool.query('SELECT * FROM order_items WHERE order_id = ?', [o.id]);
      o.items = items;
    }
    res.json(orders);
  } catch (e) { console.error(e); bad(res, 'Could not load orders.', 500); }
});

app.put('/api/orders/:id/status', auth, requireAdmin, async (req, res) => {
  const allowed = ['pending', 'paid', 'shipped', 'delivered', 'cancelled'];
  if (!allowed.includes(req.body?.status)) return bad(res, 'Invalid status.');
  try {
    const [r] = await pool.query('UPDATE orders SET status = ? WHERE id = ?', [req.body.status, req.params.id]);
    if (!r.affectedRows) return bad(res, 'Order not found.', 404);
    res.json({ ok: true });
  } catch (e) { console.error(e); bad(res, 'Could not update order.', 500); }
});

app.listen(PORT, () => console.log(`Store running at http://localhost:${PORT}`));
