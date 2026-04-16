const nodemailer = require('nodemailer');
require('dotenv').config();

function createTransporter() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return null;

  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD
    }
  });
}

const transporter = createTransporter();

async function sendOtpEmail(email, otp) {
  if (!transporter) {
    throw new Error('Gmail SMTP credentials are not configured');
  }

  const fromName = process.env.GMAIL_FROM_NAME || 'Liceo_Q';

  await transporter.sendMail({
    from: `"${fromName}" <${process.env.GMAIL_USER}>`,
    to: email,
    text: `Your OTP code is: ${otp}. It will expire in 5 minutes.`,
    html: `
      <div style="font-family: Arial, sans-serif; color: #1f1f1f; line-height: 1.6;">
        <p>Your OTP code is:</p>
        <div style="font-size:28px; font-weight:800; letter-spacing:4px; color:#8b0000; margin:12px 0 16px;">${otp}</div>
        <p>This code will expire in 5 minutes.</p>
      </div>
    `
  });
}

module.exports = { sendOtpEmail };
