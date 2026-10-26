const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(cors());

// --- FILE UPLOAD SETUP ---
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

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

// --- CREATE TABLES AUTOMATICALLY ---
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
      id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255), address TEXT, phone VARCHAR(20)
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
  queries.forEach(q => db.query(q, (err) => { if (err) console.log("Table Error:", err.message); }));
  console.log("Database Tables Checked/Created.");
};
createTables();

// --- API ROUTES ---

// 1. PRODUCTS
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
  const image = req.file ? `https://shree-ganesh-backend-9ic0.onrender.com/uploads/${req.file.filename}` : "";
  let variants = null;
  if (data.hasVariants === 'true') {
    variants = JSON.stringify({ half: Number(data.halfPrice), full: Number(data.fullPrice) });
    data.price = Number(data.fullPrice);
  }
  const query = "INSERT INTO products (name, category, price, unit, image, hasVariants, variants, isOutOfStock) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
  const values = [data.name, data.category, Number(data.price), data.unit, image, data.hasVariants === 'true', variants, data.isOutOfStock === 'true'];
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
    if (req.file) image = `https://shree-ganesh-backend-9ic0.onrender.com/uploads/${req.file.filename}`;
    let variants = null;
    if (data.hasVariants === 'true') {
      variants = JSON.stringify({ half: Number(data.halfPrice), full: Number(data.fullPrice) });
      data.price = Number(data.fullPrice);
    }
    const query = "UPDATE products SET name=?, category=?, price=?, unit=?, image=?, hasVariants=?, variants=?, isOutOfStock=? WHERE id=?";
    const values = [data.name, data.category, Number(data.price), data.unit, image, data.hasVariants === 'true', variants, data.isOutOfStock === 'true', req.params.id];
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

// 2. ORDERS
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
  const values = [orderId, data.orderType, data.customerName, data.customerPhone, JSON.stringify(data.items), data.subtotal, data.tax || 0, data.totalAmount, status];
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

// 3. EXPENSES
app.get("/api/expenses", (req, res) => {
  db.query("SELECT * FROM expenses ORDER BY date DESC", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

app.post("/api/expenses", (req, res) => {
  const { title, amount, category, date } = req.body;
  db.query("INSERT INTO expenses (title, amount, category, date) VALUES (?,?,?,?)", [title, amount, category, date], (err) => {
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

// 4. OUTLETS
app.get("/api/outlets", (req, res) => {
  db.query("SELECT * FROM outlets", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

app.post("/api/outlets", (req, res) => {
  const { name, address, phone } = req.body;
  db.query("INSERT INTO outlets (name, address, phone) VALUES (?,?,?)", [name, address, phone], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// 5. STAFF
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

// 6. ATTENDANCE
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

// 7. SETTINGS
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
  for (const [key, value] of Object.entries(settings)) {
    await db.promise().query(
      "INSERT INTO settings (settingKey, settingValue) VALUES (?, ?) ON DUPLICATE KEY UPDATE settingValue = ?",
      [key, value, value]
    );
  }
  res.json({ success: true });
});

// Serve Uploads
app.use("/uploads", express.static(uploadDir));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
