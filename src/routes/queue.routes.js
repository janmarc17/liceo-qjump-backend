const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const roleMiddleware = require('../middleware/role.middleware');

let wss = null;
const setWss = (w) => { wss = w; };

const {
  getHomeState,
  getQueueNumber,
  getCurrentQueue,
  getQueueHistory,
  getAdminQueueHistory,
  getAllQueues,
  getStats,
  getTimeoutConfig,
  setTimeoutConfig,
  callNextQueue,
  markServed,
  markMissed,
  toggleQueue
} = require('../controllers/queue.controller');

// User routes - accessible to all authenticated users
router.get('/home', authMiddleware, (req, res) => getHomeState(req, res));
router.post('/get-number', authMiddleware, (req, res) => getQueueNumber(req, res, wss));
router.get('/current', authMiddleware, (req, res) => getCurrentQueue(req, res));
router.get('/history', authMiddleware, (req, res) => getQueueHistory(req, res));

// Role-aware dashboard routes
router.get('/all', authMiddleware, roleMiddleware(['Administrator', 'Registrar', 'Cashier']), (req, res) => getAllQueues(req, res));
router.get('/stats', authMiddleware, roleMiddleware(['Administrator', 'Registrar', 'Cashier']), (req, res) => getStats(req, res));
router.get('/history-admin', authMiddleware, roleMiddleware(['Administrator']), (req, res) => getAdminQueueHistory(req, res));

// Role-specific queue operations (Admin can manage both, staff can manage only their own counter)
router.post('/call-next', authMiddleware, roleMiddleware(['Administrator', 'Registrar', 'Cashier']), (req, res) => callNextQueue(req, res, wss));
router.post('/mark-served', authMiddleware, roleMiddleware(['Administrator', 'Registrar', 'Cashier']), (req, res) => markServed(req, res, wss));
router.post('/mark-missed', authMiddleware, roleMiddleware(['Administrator', 'Registrar', 'Cashier']), (req, res) => markMissed(req, res, wss));

// Admin-only timeout configuration
router.get('/timeout-config', authMiddleware, roleMiddleware(['Administrator']), (req, res) => getTimeoutConfig(req, res));
router.put('/timeout-config', authMiddleware, roleMiddleware(['Administrator']), (req, res) => setTimeoutConfig(req, res, wss));

// Legacy admin-only routes (for backward compatibility)
router.post('/toggle', authMiddleware, roleMiddleware(['Administrator']), (req, res) => toggleQueue(req, res, wss));

module.exports = { router, setWss };