const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const { normalizeEmail, isValidStudentId, isValidBirthDate } = require('../utils/validators');
require('dotenv').config();

const register = async (req, res) => {
  const { fullName, studentId, email, password, age, sex, birthday, courseYear } = req.body;

  if (!fullName || !studentId || !email || !password) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  if (!isValidStudentId(studentId)) {
    return res.status(400).json({ message: 'Student ID must be exactly 11 digits and start with 2022' });
  }

  if (birthday && !isValidBirthDate(birthday)) {
    return res.status(400).json({ message: 'Birthday cannot be in the future' });
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
      'INSERT INTO users (full_name, student_id, email, password, age, sex, birthday, course_year, role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [fullName, studentId, email, hashedPassword, age || null, sex || null, birthday || null, courseYear || null, 'Student']
    );

    const user = {
      id: result.insertId,
      fullName,
      studentId,
      email,
      age: age || null,
      sex: sex || null,
      birthday: birthday || null,
      courseYear: courseYear || null,
      role: 'Student'
    };

    const token = jwt.sign(
      { id: user.id, studentId, role: user.role },
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
      courseYear: user.course_year,
      role: user.role
    };

    const token = jwt.sign(
      { id: user.id, studentId: user.student_id, role: user.role },
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

  if (birthday && !isValidBirthDate(birthday)) {
    return res.status(400).json({ message: 'Birthday cannot be in the future' });
  }

  try {
    // Update user profile (only allowed fields: age, sex, birthday, courseYear)
    await db.query(
      'UPDATE users SET age = ?, sex = ?, birthday = ?, course_year = ? WHERE id = ?',
      [age || null, sex || null, birthday || null, courseYear || null, userId]
    );

    // Fetch updated user
    const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
    const user = rows[0];

    // Return updated user data
    res.json({
      id: user.id,
      fullName: user.full_name,
      studentId: user.student_id,
      email: user.email,
      age: user.age,
      sex: user.sex,
      birthday: user.birthday,
      courseYear: user.course_year,
      role: user.role
    });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

const getProfile = async (req, res) => {
  const userId = req.user.id;

  try {
    const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
    
    if (rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = rows[0];
    res.json({
      id: user.id,
      fullName: user.full_name,
      studentId: user.student_id,
      email: user.email,
      age: user.age,
      sex: user.sex,
      birthday: user.birthday,
      courseYear: user.course_year,
      role: user.role
    });
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.id;

  // Validate required fields
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'Current password and new password are required' });
  }

  // Validate new password length
  if (newPassword.length < 8) {
    return res.status(400).json({ message: 'New password must be at least 8 characters' });
  }

  try {
    // Fetch current user
    const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
    
    if (rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = rows[0];

    // Verify current password
    const passwordMatch = await bcrypt.compare(currentPassword, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password in database
    await db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, userId]);

    res.json({ message: 'Password changed successfully' });

  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  register,
  login,
  updateProfile,
  getProfile,
  changePassword
};