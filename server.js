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

const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

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

// --- PRODUCTS API ---
app.get("/api/products", (req, res) => {
  db.query("SELECT * FROM products ORDER BY id DESC", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    const products = results.map(p => ({ ...p, variants: p.variants ? JSON.parse(p.variants) : null }));
    res.json(products);
  });
});

app.post("/api/products", upload.single("imageFile"), (req, res) => {
  const data = req.body;
  // Photo ka link Render ke hisaab se
  const image = req.file ? `https://shree-ganesh-backend-9ic0.onrender.com/uploads/${req.file.filename}` : "";
  
  let variants = null;
  if (data.hasVariants === 'true') {
    variants = JSON.stringify({ half: Number(data.halfPrice), full: Number(data.fullPrice) });
    data.price = Number(data.fullPrice);
  }

  const query = "INSERT INTO products (name, category, price, unit, image, hasVariants, variants, isOutOfStock) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
  const values = [data.name, data.category, Number(data.price), data.unit, image, data.hasVariants === 'true', variants, data.isOutOfStock === 'true'];

  db.query(query, values, (err) => {
    if (err) {
      console.log("Error adding product:", err);
      return res.status(500).json({ error: err.message });
    }
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

// --- ORDERS API ---
app.get("/api/orders", (req, res) => {
  db.query("SELECT * FROM orders ORDER BY id DESC", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    const orders = results.map(o => ({ ...o, items: JSON.parse(o.items) }));
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
      const orderId = `BILL-${String(nextBill).padStart(3, '0')}`;
      insertOrder(orderId, 'Completed', data, res);
    });
  } else {
    const orderId = "ORD-" + Math.floor(1000 + Math.random() * 9000);
    insertOrder(orderId, 'Pending', data, res);
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

app.use("/uploads", express.static(uploadDir));
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
