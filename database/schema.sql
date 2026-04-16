CREATE DATABASE IF NOT EXISTS liceo_qjump;
USE liceo_qjump;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  student_id VARCHAR(50) UNIQUE NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  age INT,
  sex VARCHAR(20),
  birthday DATE,
  course_year VARCHAR(50),
  role VARCHAR(50) NOT NULL DEFAULT 'Student',
  is_on_cooldown BOOLEAN NOT NULL DEFAULT FALSE,
  cooldown_until DATETIME,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS queue_entries (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  queue_number VARCHAR(10) NOT NULL,
  counter VARCHAR(50) NOT NULL DEFAULT 'Registrar',
  status ENUM('waiting','called','completed','cancelled') NOT NULL DEFAULT 'waiting',
  time_joined DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  time_served DATETIME,
  CONSTRAINT fk_queue_user
    FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS queue_config (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  counter VARCHAR(50) NOT NULL,
  now_serving VARCHAR(10) NOT NULL DEFAULT '000',
  queue_timeout_minutes INT NOT NULL DEFAULT 5,
  max_queue INT NOT NULL DEFAULT 100,
  is_open BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_counter (counter)
);

CREATE INDEX idx_queue_user_status ON queue_entries(user_id, status);
CREATE INDEX idx_queue_counter_status_time ON queue_entries(counter, status, time_joined);

CREATE TABLE IF NOT EXISTS password_reset_otps (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  email VARCHAR(100) NOT NULL,
  otp_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  verified_at DATETIME NULL,
  reset_at DATETIME NULL,
  last_sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_password_reset_email (email),
  CONSTRAINT fk_password_reset_user
    FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

INSERT INTO queue_config (counter, now_serving, queue_timeout_minutes, max_queue, is_open)
VALUES ('Registrar', '000', 5, 100, TRUE)
ON DUPLICATE KEY UPDATE
  now_serving = VALUES(now_serving),
  queue_timeout_minutes = VALUES(queue_timeout_minutes),
  max_queue = VALUES(max_queue),
  is_open = VALUES(is_open);

INSERT INTO queue_config (counter, now_serving, queue_timeout_minutes, max_queue, is_open)
VALUES ('Cashier', '000', 5, 100, TRUE)
ON DUPLICATE KEY UPDATE
  now_serving = VALUES(now_serving),
  queue_timeout_minutes = VALUES(queue_timeout_minutes),
  max_queue = VALUES(max_queue),
  is_open = VALUES(is_open);