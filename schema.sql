-- Run this whole file in MySQL Workbench (File > Open SQL Script, or paste and run)
-- against your Local instance MySQL80 connection.

CREATE DATABASE IF NOT EXISTS ecommerce_app;
USE ecommerce_app;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin','user') NOT NULL DEFAULT 'user',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL,
  stock INT NOT NULL DEFAULT 0,
  image_url VARCHAR(500),
  category VARCHAR(80),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  total DECIMAL(10,2) NOT NULL,
  status ENUM('pending','paid','shipped','delivered','cancelled') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  product_id INT,
  product_name VARCHAR(150) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  quantity INT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);

-- A few sample products so the store isn't empty on first run
INSERT INTO products (name, description, price, stock, image_url, category) VALUES
('Wireless Headphones', 'Over-ear headphones with noise cancellation.', 59.99, 25, 'https://picsum.photos/seed/headphones/400/300', 'Electronics'),
('Running Shoes', 'Lightweight shoes for daily training.', 74.50, 40, 'https://picsum.photos/seed/shoes/400/300', 'Sportswear'),
('Ceramic Mug Set', 'Set of 4 handmade ceramic mugs.', 22.00, 60, 'https://picsum.photos/seed/mugs/400/300', 'Home'),
('Backpack', '30L water-resistant backpack.', 45.00, 30, 'https://picsum.photos/seed/backpack/400/300', 'Accessories'),
('Desk Lamp', 'Adjustable LED desk lamp with USB port.', 28.75, 15, 'https://picsum.photos/seed/lamp/400/300', 'Home'),
('Yoga Mat', 'Non-slip mat, 6mm thick.', 19.99, 50, 'https://picsum.photos/seed/yoga/400/300', 'Sportswear');

-- After you register your first account through the app (see README), run this
-- to make that account an admin. Replace the email with the one you registered.
-- UPDATE users SET role = 'admin' WHERE email = 'you@example.com';
