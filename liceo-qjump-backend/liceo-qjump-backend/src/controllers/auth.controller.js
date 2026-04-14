const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
require('dotenv').config();

const register = async (req, res) => {
  const { fullName, studentId, email, password } = req.body;

  if (!fullName || !studentId || !email || !password) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  try {
    const [existing] = await db.query(
      'SELECT id FROM users WHERE student_id = ? OR email = ?',
      [studentId, email]
    );
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Student ID or email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      'INSERT INTO users (full_name, student_id, email, password) VALUES (?, ?, ?, ?)',
      [fullName, studentId, email, hashedPassword]
    );

    const user = {
      id: result.insertId,
      fullName,
      studentId,
      email
    };

    const token = jwt.sign(
      { id: user.id, studentId },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({ user, token });

  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ message: 'Server error during registration' });
  }
};

const login = async (req, res) => {
  const { identifier, password } = req.body;

  if (!identifier || !password) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  try {
    const [rows] = await db.query(
      'SELECT * FROM users WHERE student_id = ? OR email = ?',
      [identifier, identifier]
    );

    if (rows.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const user = rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (user.is_on_cooldown && new Date(user.cooldown_until) > new Date()) {
      return res.status(403).json({
        message: `You are on cooldown until ${new Date(user.cooldown_until).toLocaleString()}`
      });
    }

    const userObj = {
      id: user.id,
      fullName: user.full_name,
      studentId: user.student_id,
      email: user.email,
      age: user.age,
      sex: user.sex,
      birthday: user.birthday,
      courseYear: user.course_year
    };

    const token = jwt.sign(
      { id: user.id, studentId: user.student_id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ user: userObj, token });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error during login' });
  }
};

const updateProfile = async (req, res) => {
  const { age, sex, birthday, courseYear } = req.body;
  const userId = req.user.id;

  try {
    await db.query(
      'UPDATE users SET age = ?, sex = ?, birthday = ?, course_year = ? WHERE id = ?',
      [age, sex, birthday, courseYear, userId]
    );

    const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
    const user = rows[0];

    res.json({
      id: user.id,
      fullName: user.full_name,
      studentId: user.student_id,
      email: user.email,
      age: user.age,
      sex: user.sex,
      birthday: user.birthday,
      courseYear: user.course_year
    });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = { register, login, updateProfile };