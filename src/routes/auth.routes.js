const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const passwordController = require('../controllers/password.controller');
const adminController = require('../controllers/admin.controller');
const authMiddleware = require('../middleware/auth.middleware');

router.post('/register', authController.register);
router.post('/login', authController.login);

// Password reset flow
router.post('/forgot-password', passwordController.forgotPassword);
router.post('/verify-otp', passwordController.verifyOtp);
router.post('/reset-password', passwordController.resetPassword);

// Profile
router.get('/profile', authMiddleware, authController.getProfile);
router.put('/profile', authMiddleware, authController.updateProfile);
router.post('/change-password', authMiddleware, authController.changePassword);

// Admin user management
router.get('/users', authMiddleware, adminController.getAllUsers);
router.post('/users/create', authMiddleware, adminController.createUserByAdmin);
router.put('/users/:id', authMiddleware, adminController.updateUserByAdmin);

module.exports = router;