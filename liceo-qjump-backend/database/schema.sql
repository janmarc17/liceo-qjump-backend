CREATE DATABASE IF NOT EXISTS liceo_qjump;
USE liceo_qjump;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  student_id VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  age INT,
  sex VARCHAR(20),
  birthday DATE,
  course_year VARCHAR(50),
  is_on_cooldown BOOLEAN DEFAULT FALSE,
  cooldown_until DATETIME,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS queue_entries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  queue_number VARCHAR(10) NOT NULL,
  counter VARCHAR(50) DEFAULT 'Registrar',
  status ENUM('waiting','serving','served','cancelled','missed') DEFAULT 'waiting',
  time_joined DATETIME DEFAULT CURRENT_TIMESTAMP,
  time_served DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS queue_config (
  id INT AUTO_INCREMENT PRIMARY KEY,
  now_serving VARCHAR(10) DEFAULT '000',
  max_queue INT DEFAULT 100,
  is_open BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO queue_config (now_serving, max_queue, is_open)
SELECT '000', 100, TRUE
WHERE NOT EXISTS (SELECT 1 FROM queue_config);