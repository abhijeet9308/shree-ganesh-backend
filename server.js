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

// --- API ROUTES ---

// 1. PRODUCTS - GET ALL
app.get("/api/products", (req, res) => {
  db.query("SELECT * FROM products ORDER BY id DESC", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    const products = results.map(p => ({ ...p, variants: p.variants ? JSON.parse(p.variants) : null }));
    res.json(products);
  });
});

// 2. PRODUCTS - ADD NEW (Photo upload ke saath)
app.post("/api/products", upload.single("imageFile"), (req, res) => {
  const { name, category, price, unit } = req.body;
  const image = req.file ? `https://shree-ganesh-backend-9ic0.onrender.com/uploads/${req.file.filename}` : "";
  
  const query = "INSERT INTO products (name, category, price, unit, image) VALUES (?, ?, ?, ?, ?)";
  const values = [name, category, Number(price), unit, image];

  db.query(query, values, (err) => {
    if (err) {
      console.log("Error adding product:", err);
      return res.status(500).json({ error: err.message });
    }
    res.status(201).json({ success: true, message: "Dish Added!" });
  });
});

// 3. PRODUCTS - EDIT/UPDATE (Photo change ke saath)
app.put("/api/products/:id", upload.single("imageFile"), (req, res) => {
  const { name, category, price, unit } = req.body;
  
  db.query("SELECT image FROM products WHERE id = ?", [req.params.id], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    
    let image = results[0]?.image || "";
    if (req.file) image = `https://shree-ganesh-backend-9ic0.onrender.com/uploads/${req.file.filename}`;

    const query = "UPDATE products SET name=?, category=?, price=?, unit=?, image=? WHERE id=?";
    const values = [name, category, Number(price), unit, image, req.params.id];

    db.query(query, values, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, message: "Dish Updated!" });
    });
  });
});

// 4. PRODUCTS - DELETE
app.delete("/api/products/:id", (req, res) => {
  db.query("DELETE FROM products WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// 5. ORDERS - GET ALL
app.get("/api/orders", (req, res) => {
  db.query("SELECT * FROM orders ORDER BY id DESC", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    const orders = results.map(o => ({ ...o, items: JSON.parse(o.items) }));
    res.json(orders);
  });
});

// 6. ORDERS - ADD NEW
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
  const values = [
    orderId, data.orderType, data.customerName, data.customerPhone, JSON.stringify(data.items), 
    data.subtotal, data.tax || 0, data.totalAmount, status
  ];
  db.query(query, values, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, order: { ...data, orderId, status } });
  });
}

// 7. ORDERS - UPDATE STATUS
app.put("/api/orders/:id/status", (req, res) => {
  db.query("UPDATE orders SET status = ? WHERE id = ?", [req.body.status, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// 8. EXPENSES
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

// 9. OUTLETS
app.get("/api/outlets", (req, res) => {
  db.query("SELECT * FROM outlets", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

app.post("/api/outlets", (req, res) => {
  const { name, address, phone, timing, mapLink } = req.body;
  db.query("INSERT INTO outlets (name, address, phone, timing, mapLink) VALUES (?,?,?,?,?)", [name, address, phone, timing, mapLink], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.use("/uploads", express.static(uploadDir));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
