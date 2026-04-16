const bcrypt = require('bcryptjs');
const db = require('../config/database');
const { isValidStudentId } = require('../utils/validators');
require('dotenv').config();

const getAllUsers = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, full_name, student_id, email, role FROM users ORDER BY created_at DESC'
    );

    const users = rows.map(user => ({
      id: user.id,
      fullName: user.full_name,
      studentId: user.student_id,
      email: user.email,
      role: user.role
    }));

    res.json(users);
  } catch (err) {
    console.error('Get all users error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

const createUserByAdmin = async (req, res) => {
  const { fullName, studentId, email, password, role } = req.body;

  // require fields
  if (!fullName || !email || !password || !role) {
    return res.status(400).json({ message: 'Full name, email, password, and role are required' });
  }

  // student id kay require ra siya sa student nga role 
  if (role === 'Student' && !studentId) {
    return res.status(400).json({ message: 'Student ID is required for Student role' });
  }

  if (role === 'Student' && !isValidStudentId(studentId)) {
    return res.status(400).json({ message: 'Student ID must be exactly 11 digits and start with 2022' });
  }

  const validRoles = ['Administrator', 'Cashier', 'Registrar', 'Student'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ message: 'Invalid role' });
  }

  try {
    let existingQuery = 'SELECT id FROM users WHERE email = ?';
    let existingParams = [email];
    if (role === 'Student') {
      existingQuery = 'SELECT id FROM users WHERE student_id = ? OR email = ?';
      existingParams = [studentId, email];
    }

    const [existing] = await db.query(existingQuery, existingParams);
    if (existing.length > 0) {
      return res.status(409).json({ message: 'User with this email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    let insertQuery, insertParams;
    if (role === 'Student') {
      insertQuery = 'INSERT INTO users (full_name, student_id, email, password, role) VALUES (?, ?, ?, ?, ?)';
      insertParams = [fullName, studentId, email, hashedPassword, role];
    } else {
      insertQuery = 'INSERT INTO users (full_name, email, password, role) VALUES (?, ?, ?, ?)';
      insertParams = [fullName, email, hashedPassword, role];
    }

    const [result] = await db.query(insertQuery, insertParams);

    const user = {
      id: result.insertId,
      fullName,
      studentId: role === 'Student' ? studentId : null,
      email,
      role
    };

    res.status(201).json({ user, message: 'User created successfully' });
  } catch (err) {
    console.error('Create user by admin error:', err);
    res.status(500).json({ message: 'Server error during user creation' });
  }
};

const updateUserByAdmin = async (req, res) => {
  const { id } = req.params;
  const { fullName, studentId, email, role } = req.body;

  // required fields
  if (!fullName || !email || !role) {
    return res.status(400).json({ message: 'Full name, email, and role are required' });
  }

  if (role === 'Student' && !studentId) {
    return res.status(400).json({ message: 'Student ID is required for Student role' });
  }

  if (role === 'Student' && !isValidStudentId(studentId)) {
    return res.status(400).json({ message: 'Student ID must be exactly 11 digits and start with 2022' });
  }

  const validRoles = ['Administrator', 'Cashier', 'Registrar', 'Student'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ message: 'Invalid role' });
  }

  try {
    const [userRows] = await db.query('SELECT * FROM users WHERE id = ?', [id]);
    if (userRows.length === 0) return res.status(404).json({ message: 'User not found' });

    const currentUser = userRows[0];

    if (email !== currentUser.email) {
      const [emailCheck] = await db.query('SELECT id FROM users WHERE email = ? AND id != ?', [email, id]);
      if (emailCheck.length > 0) return res.status(409).json({ message: 'Email already in use' });
    }

    if (role === 'Student' && studentId !== currentUser.student_id) {
      const [studentIdCheck] = await db.query('SELECT id FROM users WHERE student_id = ? AND id != ?', [studentId, id]);
      if (studentIdCheck.length > 0) return res.status(409).json({ message: 'Student ID already in use' });
    }

    let updateQuery, updateParams;
    if (role === 'Student') {
      updateQuery = 'UPDATE users SET full_name = ?, student_id = ?, email = ?, role = ? WHERE id = ?';
      updateParams = [fullName, studentId, email, role, id];
    } else {
      updateQuery = 'UPDATE users SET full_name = ?, email = ?, role = ? WHERE id = ?';
      updateParams = [fullName, email, role, id];
    }

    await db.query(updateQuery, updateParams);

    const [updatedRows] = await db.query('SELECT id, full_name, student_id, email, role FROM users WHERE id = ?', [id]);
    const updatedUser = updatedRows[0];

    const user = {
      id: updatedUser.id,
      fullName: updatedUser.full_name,
      studentId: updatedUser.student_id,
      email: updatedUser.email,
      role: updatedUser.role
    };

    res.json({ user, message: 'User updated successfully' });
  } catch (err) {
    console.error('Update user by admin error:', err);
    res.status(500).json({ message: 'Server error during user update' });
  }
};

module.exports = { getAllUsers, createUserByAdmin, updateUserByAdmin };
