const bcrypt = require('bcryptjs');
const db = require('../config/database');
const { sendOtpEmail } = require('../services/mail.service');
const { normalizeEmail, generateOtp } = require('../utils/validators');
require('dotenv').config();

const OTP_EXPIRY_MS = 5 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
let passwordResetTableReady = false;

async function ensurePasswordResetTable() {
  if (passwordResetTableReady) return;

  await db.query(`
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
    )
  `);

  passwordResetTableReady = true;
}

const forgotPassword = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);

    if (!email) return res.status(400).json({ message: 'Email is required' });

    await ensurePasswordResetTable();

    const [users] = await db.query('SELECT id, email FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1', [email]);
    if (users.length === 0) return res.status(404).json({ message: 'Email not found' });

    const user = users[0];

    const [existingRows] = await db.query('SELECT last_sent_at FROM password_reset_otps WHERE email = ? LIMIT 1', [email]);
    if (existingRows.length > 0 && existingRows[0].last_sent_at) {
      const lastSentAt = new Date(existingRows[0].last_sent_at).getTime();
      if (Number.isFinite(lastSentAt) && Date.now() - lastSentAt < OTP_RESEND_COOLDOWN_MS) {
        return res.status(429).json({ message: 'Please wait 1 minute before requesting another OTP.' });
      }
    }

    const otp = generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

    await db.query(
      `INSERT INTO password_reset_otps
        (user_id, email, otp_hash, expires_at, verified_at, reset_at, last_sent_at, attempts)
       VALUES (?, ?, ?, ?, NULL, NULL, NOW(), 0)
       ON DUPLICATE KEY UPDATE
         user_id = VALUES(user_id),
         otp_hash = VALUES(otp_hash),
         expires_at = VALUES(expires_at),
         verified_at = NULL,
         reset_at = NULL,
         last_sent_at = NOW(),
         attempts = 0`,
      [user.id, email, otpHash, expiresAt]
    );

    await sendOtpEmail(email, otp);

    return res.json({ success: true, message: 'OTP sent successfully' });
  } catch (err) {
    console.error('forgotPassword error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

const verifyOtp = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const otp = String(req.body?.otp || '').trim();

    if (!email || !otp) return res.status(400).json({ message: 'Email and OTP are required' });

    await ensurePasswordResetTable();

    const [rows] = await db.query('SELECT * FROM password_reset_otps WHERE email = ? LIMIT 1', [email]);
    if (rows.length === 0) return res.status(404).json({ message: 'OTP not found. Request a new one.' });

    const record = rows[0];
    const expiresAt = new Date(record.expires_at).getTime();

    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      await db.query('DELETE FROM password_reset_otps WHERE email = ?', [email]);
      return res.status(400).json({ message: 'OTP has expired. Request a new one.' });
    }

    if (record.reset_at) return res.status(400).json({ message: 'OTP has already been used.' });

    if (record.attempts >= MAX_OTP_ATTEMPTS) {
      await db.query('DELETE FROM password_reset_otps WHERE email = ?', [email]);
      return res.status(429).json({ message: 'Too many invalid OTP attempts. Request a new one.' });
    }

    const matches = await bcrypt.compare(otp, record.otp_hash);
    if (!matches) {
      const nextAttempts = Number(record.attempts || 0) + 1;
      if (nextAttempts >= MAX_OTP_ATTEMPTS) {
        await db.query('DELETE FROM password_reset_otps WHERE email = ?', [email]);
        return res.status(429).json({ message: 'Too many invalid OTP attempts. Request a new one.' });
      }

      await db.query('UPDATE password_reset_otps SET attempts = ? WHERE email = ?', [nextAttempts, email]);
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    await db.query('UPDATE password_reset_otps SET verified_at = NOW(), attempts = 0 WHERE email = ?', [email]);
    return res.json({ success: true, message: 'OTP verified successfully' });
  } catch (err) {
    console.error('verifyOtp error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

const resetPassword = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const newPassword = String(req.body?.newPassword || '');

    if (!email || !newPassword) return res.status(400).json({ message: 'Email and new password are required' });

    if (newPassword.length < 8) return res.status(400).json({ message: 'New password must be at least 8 characters' });

    await ensurePasswordResetTable();

    const [rows] = await db.query('SELECT * FROM password_reset_otps WHERE email = ? LIMIT 1', [email]);
    if (rows.length === 0) return res.status(400).json({ message: 'Please verify your OTP first.' });

    const record = rows[0];
    const expiresAt = new Date(record.expires_at).getTime();

    if (!record.verified_at) return res.status(400).json({ message: 'Please verify your OTP first.' });

    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      await db.query('DELETE FROM password_reset_otps WHERE email = ?', [email]);
      return res.status(400).json({ message: 'OTP has expired. Request a new one.' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, record.user_id]);
    await db.query('DELETE FROM password_reset_otps WHERE email = ?', [email]);

    return res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    console.error('resetPassword error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

module.exports = { forgotPassword, verifyOtp, resetPassword };
