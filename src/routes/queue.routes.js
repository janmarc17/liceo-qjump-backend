const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');

let wss = null;
const setWss = (w) => { wss = w; };

const {
  getHomeState,
  getQueueNumber,
  getCurrentQueue,
  getQueueHistory,
  getAllQueues,
  getStats,
  callNextQueue,
  markServed,
  markMissed,
  toggleQueue
} = require('../controllers/queue.controller');

// User routes
router.get('/home', authMiddleware, (req, res) => getHomeState(req, res));
router.post('/get-number', authMiddleware, (req, res) => getQueueNumber(req, res, wss));
router.get('/current', authMiddleware, (req, res) => getCurrentQueue(req, res));
router.get('/history', authMiddleware, (req, res) => getQueueHistory(req, res));

// Admin routes
router.get('/all', authMiddleware, (req, res) => getAllQueues(req, res));
router.get('/stats', authMiddleware, (req, res) => getStats(req, res));
router.post('/call-next', authMiddleware, (req, res) => callNextQueue(req, res, wss));
router.post('/mark-served', authMiddleware, (req, res) => markServed(req, res, wss));
router.post('/mark-missed', authMiddleware, (req, res) => markMissed(req, res, wss));
router.post('/toggle', authMiddleware, (req, res) => toggleQueue(req, res, wss));

module.exports = { router, setWss };