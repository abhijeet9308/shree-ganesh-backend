const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cors());

// --- FILE UPLOAD SETUP ---
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB max

// --- BASE URL (domain change hone pe adjust karo) ---
const BASE_URL = process.env.BASE_URL || "https://shree-ganesh-backend-9ic0.onrender.com";

// --- DATABASE CONNECTION ---
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

db.getConnection((err) => {
  if (err) console.log("Database Connection Error:", err);
  else console.log("Database Connected Successfully!");
});

// --- CREATE TABLES AUTOMATICALLY (WITH NEW COLUMNS) ---
const createTables = async () => {
  const queries = [
    `CREATE TABLE IF NOT EXISTS products (
      id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL, category VARCHAR(100) DEFAULT 'General',
      price DECIMAL(10,2) DEFAULT 0, unit VARCHAR(50) DEFAULT 'KG', image TEXT,
      hasVariants BOOLEAN DEFAULT FALSE, variants JSON, isOutOfStock BOOLEAN DEFAULT FALSE,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS orders (
      id INT AUTO_INCREMENT PRIMARY KEY, orderId VARCHAR(50), orderType VARCHAR(20),
      customerName VARCHAR(255), customerPhone VARCHAR(20), items JSON, subtotal DECIMAL(10,2),
      tax DECIMAL(10,2), totalAmount DECIMAL(10,2), status VARCHAR(50) DEFAULT 'Pending',
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS expenses (
      id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(255), amount DECIMAL(10,2),
      category VARCHAR(100), date DATE, notes TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS outlets (
      id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255), address TEXT, phone VARCHAR(20),
      timing VARCHAR(100) DEFAULT '10 AM - 10 PM', mapLink TEXT, image TEXT, isPrimary BOOLEAN DEFAULT FALSE
    )`,
    `CREATE TABLE IF NOT EXISTS staff (
      id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255), phone VARCHAR(20), role VARCHAR(100), salary DECIMAL(10,2)
    )`,
    `CREATE TABLE IF NOT EXISTS attendance (
      id INT AUTO_INCREMENT PRIMARY KEY, staffId INT, staffName VARCHAR(255), date DATE, status VARCHAR(20)
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
      id INT AUTO_INCREMENT PRIMARY KEY, settingKey VARCHAR(100) UNIQUE, settingValue TEXT
    )`
  ];
  
  for (const q of queries) {
    try { await db.promise().query(q); } catch(e) { console.log("Table Error:", e.message); }
  }
  
  // Purane outlets table me naye columns add karo (safe)
  const alterQueries = [
    "ALTER TABLE outlets ADD COLUMN timing VARCHAR(100) DEFAULT '10 AM - 10 PM'",
    "ALTER TABLE outlets ADD COLUMN mapLink TEXT",
    "ALTER TABLE outlets ADD COLUMN image TEXT",
    "ALTER TABLE outlets ADD COLUMN isPrimary BOOLEAN DEFAULT FALSE"
  ];
  for (const q of alterQueries) {
    try { await db.promise().query(q); } catch(e) { /* column already exists — ignore */ }
  }
  
  console.log("✅ Database Tables Checked/Created.");
};
createTables();

// ============================================================
// API ROUTES
// ============================================================

// ============================================================
// 1. PRODUCTS
// ============================================================
app.get("/api/products", (req, res) => {
  db.query("SELECT * FROM products ORDER BY id DESC", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    const products = results.map(p => {
      let parsedVariants = null;
      try { if (p.variants && typeof p.variants === 'string') parsedVariants = JSON.parse(p.variants); } catch (e) {}
      return { ...p, variants: parsedVariants };
    });
    res.json(products);
  });
});

app.post("/api/products", upload.single("imageFile"), (req, res) => {
  const data = req.body;
  const image = req.file ? `${BASE_URL}/uploads/${req.file.filename}` : "";
  let variants = null;
  if (data.hasVariants === 'true') {
    variants = JSON.stringify({ half: Number(data.halfPrice), full: Number(data.fullPrice) });
    data.price = Number(data.fullPrice);
  }
  const query = "INSERT INTO products (name, category, price, unit, image, hasVariants, variants, isOutOfStock) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
  const values = [data.name, data.category, Number(data.price) || 0, data.unit || 'KG', image, data.hasVariants === 'true', variants, data.isOutOfStock === 'true'];
  db.query(query, values, (err) => {
    if (err) { console.log("Error adding product:", err); return res.status(500).json({ error: err.message }); }
    res.json({ success: true, message: "Dish Added!" });
  });
});

app.put("/api/products/:id", upload.single("imageFile"), (req, res) => {
  const data = req.body;
  db.query("SELECT image FROM products WHERE id = ?", [req.params.id], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    let image = results[0]?.image || "";
    if (req.file) image = `${BASE_URL}/uploads/${req.file.filename}`;
    let variants = null;
    if (data.hasVariants === 'true') {
      variants = JSON.stringify({ half: Number(data.halfPrice), full: Number(data.fullPrice) });
      data.price = Number(data.fullPrice);
    }
    const query = "UPDATE products SET name=?, category=?, price=?, unit=?, image=?, hasVariants=?, variants=?, isOutOfStock=? WHERE id=?";
    const values = [data.name, data.category, Number(data.price) || 0, data.unit || 'KG', image, data.hasVariants === 'true', variants, data.isOutOfStock === 'true', req.params.id];
    db.query(query, values, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, message: "Dish Updated!" });
    });
  });
});

app.delete("/api/products/:id", (req, res) => {
  db.query("DELETE FROM products WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// ============================================================
// 2. ORDERS
// ============================================================
app.get("/api/orders", (req, res) => {
  db.query("SELECT * FROM orders ORDER BY id DESC", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    const orders = results.map(o => {
      let parsedItems = [];
      try { if (o.items && typeof o.items === 'string') parsedItems = JSON.parse(o.items); else if (o.items) parsedItems = o.items; } catch(e) {}
      return { ...o, items: parsedItems };
    });
    res.json(orders);
  });
});

app.post("/api/orders", (req, res) => {
  const data = req.body;
  if(data.orderType === 'pos') {
    db.query("SELECT orderId FROM orders WHERE orderType = 'pos' ORDER BY id DESC LIMIT 1", (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      let nextBill = 1;
      if(results.length > 0 && results[0].orderId) {
        const parts = results[0].orderId.split('-');
        if(parts.length > 1) nextBill = parseInt(parts[1]) + 1;
      }
      insertOrder(`BILL-${String(nextBill).padStart(3, '0')}`, 'Completed', data, res);
    });
  } else {
    insertOrder("ORD-" + Math.floor(1000 + Math.random() * 9000), 'Pending', data, res);
  }
});

function insertOrder(orderId, status, data, res) {
  const query = "INSERT INTO orders (orderId, orderType, customerName, customerPhone, items, subtotal, tax, totalAmount, status) VALUES (?,?,?,?,?,?,?,?,?)";
  const values = [orderId, data.orderType, data.customerName || '', data.customerPhone || '', JSON.stringify(data.items || []), data.subtotal || 0, data.tax || 0, data.totalAmount || 0, status];
  db.query(query, values, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, order: { ...data, orderId, status } });
  });
}

app.put("/api/orders/:id/status", (req, res) => {
  db.query("UPDATE orders SET status = ? WHERE id = ?", [req.body.status, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// ============================================================
// 3. EXPENSES (with EDIT + DELETE)
// ============================================================
app.get("/api/expenses", (req, res) => {
  db.query("SELECT * FROM expenses ORDER BY date DESC", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

app.post("/api/expenses", (req, res) => {
  const { title, amount, category, date } = req.body;
  db.query("INSERT INTO expenses (title, amount, category, date) VALUES (?,?,?,?)", [title, amount, category || 'General', date], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.put("/api/expenses/:id", (req, res) => {
  const { title, amount, category, date } = req.body;
  db.query("UPDATE expenses SET title=?, amount=?, category=?, date=? WHERE id=?",
    [title, amount, category || 'General', date, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
});

app.delete("/api/expenses/:id", (req, res) => {
  db.query("DELETE FROM expenses WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// ============================================================
// 4. OUTLETS (with EDIT + DELETE + image + timing + mapLink)
// ============================================================
app.get("/api/outlets", (req, res) => {
  db.query("SELECT * FROM outlets", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

app.post("/api/outlets", upload.single("imageFile"), (req, res) => {
  const { name, address, phone, timing, mapLink, isPrimary } = req.body;
  const image = req.file ? `${BASE_URL}/uploads/${req.file.filename}` : "";
  const query = "INSERT INTO outlets (name, address, phone, timing, mapLink, image, isPrimary) VALUES (?,?,?,?,?,?,?)";
  db.query(query, [name, address, phone, timing || '10 AM - 10 PM', mapLink || '', image, isPrimary === 'true' ? 1 : 0], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.put("/api/outlets/:id", upload.single("imageFile"), (req, res) => {
  const { name, address, phone, timing, mapLink, isPrimary } = req.body;
  db.query("SELECT image FROM outlets WHERE id = ?", [req.params.id], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    let image = results[0]?.image || "";
    if (req.file) image = `${BASE_URL}/uploads/${req.file.filename}`;
    const query = "UPDATE outlets SET name=?, address=?, phone=?, timing=?, mapLink=?, image=?, isPrimary=? WHERE id=?";
    db.query(query, [name, address, phone, timing || '', mapLink || '', image, isPrimary === 'true' ? 1 : 0, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
  });
});

app.delete("/api/outlets/:id", (req, res) => {
  db.query("DELETE FROM outlets WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// ============================================================
// 5. STAFF
// ============================================================
app.get("/api/staff", (req, res) => {
  db.query("SELECT * FROM staff ORDER BY id DESC", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

app.post("/api/staff", (req, res) => {
  const { name, phone, role, salary } = req.body;
  db.query("INSERT INTO staff (name, phone, role, salary) VALUES (?,?,?,?)", [name, phone, role, salary], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.put("/api/staff/:id", (req, res) => {
  const { name, phone, role, salary } = req.body;
  db.query("UPDATE staff SET name=?, phone=?, role=?, salary=? WHERE id=?",
    [name, phone, role, salary, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
});

app.delete("/api/staff/:id", (req, res) => {
  db.query("DELETE FROM staff WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// ============================================================
// 6. ATTENDANCE
// ============================================================
app.get("/api/attendance", (req, res) => {
  const { date } = req.query;
  db.query("SELECT * FROM attendance WHERE date = ?", [date], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

app.post("/api/attendance", (req, res) => {
  const { staffId, staffName, date, status } = req.body;
  db.query("SELECT * FROM attendance WHERE staffId = ? AND date = ?", [staffId, date], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if(results.length > 0) {
      db.query("UPDATE attendance SET status = ? WHERE id = ?", [status, results[0].id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
      });
    } else {
      db.query("INSERT INTO attendance (staffId, staffName, date, status) VALUES (?,?,?,?)", [staffId, staffName, date, status], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
      });
    }
  });
});

// ============================================================
// 7. SETTINGS (with WHITELIST for security)
// ============================================================
app.get("/api/settings", (req, res) => {
  db.query("SELECT * FROM settings", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    const settings = {};
    results.forEach(r => settings[r.settingKey] = r.settingValue);
    res.json(settings);
  });
});

app.post("/api/settings", async (req, res) => {
  const settings = req.body;
  // Whitelist — sirf ye keys allowed hain (security)
  const allowed = [
    'storeName','storePhone','storeEmail','storeAddress','fssai','gstin','storeTimings',
    'logoUrl','instagram','facebook','whatsapp','mapLink',
    'upiId','upiPayee','codEnabled','gstEnabled','cgstPercent','sgstPercent',
    'packingCharge','deliveryCharge','serviceCharge','minOrder','freeDeliveryAbove',
    'deliveryRadius','deliveryPincodes',
    'orderSound','orderPopup','whatsappAlert',
    'billHeader','billFooter','billPrefix','billStartNo','showFssaiOnBill','showQrOnBill','showGstOnBill',
    'adminPassword','shopClosed'
  ];
  try {
    for (const [key, value] of Object.entries(settings)) {
      if (!allowed.includes(key)) continue; // skip unknown keys
      await db.promise().query(
        "INSERT INTO settings (settingKey, settingValue) VALUES (?, ?) ON DUPLICATE KEY UPDATE settingValue = ?",
        [key, String(value), String(value)]
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// 8. HEALTH CHECK
// ============================================================
app.get("/", (req, res) => {
  res.json({ status: "OK", message: "Shree Ganesh Sweets API is running", time: new Date() });
});

// Serve Uploads
app.use("/uploads", express.static(uploadDir));

// ============================================================
// ERROR HANDLER
// ============================================================
app.use((err, req, res, next) => {
  console.error("Server Error:", err.message);
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: "File too large! Max 5MB allowed." });
  }
  res.status(500).json({ error: "Something went wrong!" });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
