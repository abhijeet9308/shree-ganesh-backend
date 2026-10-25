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

// File Upload Setup
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// Database Connection
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10
});

db.getConnection((err) => {
  if (err) console.log("DB Error:", err);
  else console.log("Database Connected Successfully!");
});

// Create Tables (Agar pehle se nahi hain toh)
db.query(`CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255), category VARCHAR(100), 
  price DECIMAL(10,2), unit VARCHAR(50), image TEXT, hasVariants BOOLEAN, 
  variants JSON, isOutOfStock BOOLEAN, createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);
db.query(`CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY, orderId VARCHAR(50), orderType VARCHAR(20), 
  customerName VARCHAR(255), customerPhone VARCHAR(20), items JSON, subtotal DECIMAL(10,2), 
  tax DECIMAL(10,2), totalAmount DECIMAL(10,2), status VARCHAR(50), createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);
db.query(`CREATE TABLE IF NOT EXISTS outlets (
  id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255), address TEXT, phone VARCHAR(20)
)`);

// --- ROUTES ---

// 1. PRODUCTS (Dishes)
app.get("/api/products", (req, res) => {
  db.query("SELECT * FROM products ORDER BY id DESC", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

app.post("/api/products", upload.single("imageFile"), (req, res) => {
  const { name, category, price, unit } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : "";
  
  db.query("INSERT INTO products (name, category, price, unit, image) VALUES (?, ?, ?, ?, ?)", 
  [name, category, price, unit, image], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, message: "Dish Added!" });
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
    res.json(results);
  });
});

app.post("/api/orders", (req, res) => {
  const { orderType, customerName, customerPhone, items, subtotal, tax, totalAmount, status } = req.body;
  const orderId = (orderType === 'pos' ? "BILL-" : "ORD-") + Date.now().toString().slice(-4);
  
  db.query("INSERT INTO orders (orderId, orderType, customerName, customerPhone, items, subtotal, tax, totalAmount, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", 
  [orderId, orderType, customerName, customerPhone, JSON.stringify(items), subtotal, tax, totalAmount, status], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, orderId });
  });
});

// 3. OUTLETS
app.get("/api/outlets", (req, res) => {
  db.query("SELECT * FROM outlets", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// Images Serve karna
app.use("/uploads", express.static(uploadDir));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Backend Server running on port ${PORT}`));
