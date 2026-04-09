const db = require('../config/database');

const getHomeState = async (req, res) => {
  try {
    const userId = req.user.id;
    const [config] = await db.query('SELECT * FROM queue_config LIMIT 1');
    const queueConfig = config[0];

    const [currentQueue] = await db.query(
      "SELECT * FROM queue_entries WHERE user_id = ? AND status = 'waiting' ORDER BY id DESC LIMIT 1",
      [userId]
    );

    const [waitingAhead] = await db.query(
      "SELECT COUNT(*) as count FROM queue_entries WHERE status = 'waiting' AND id < (SELECT IFNULL(MIN(id), 999999) FROM queue_entries WHERE user_id = ? AND status = 'waiting')",
      [userId]
    );

    const myQueue = currentQueue.length > 0 ? currentQueue[0] : null;
    const peopleAhead = waitingAhead[0].count;

    res.json({
      nowServing: queueConfig.now_serving,
      myQueueNumber: myQueue ? myQueue.queue_number : null,
      peopleAhead: peopleAhead,
      estimatedWaitMinutes: peopleAhead * 3,
      queueAvailable: queueConfig.is_open === 1
    });
  } catch (err) {
    console.error('getHomeState error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

const getQueueNumber = async (req, res, wss) => {
  try {
    const userId = req.user.id;

    const [existing] = await db.query(
      "SELECT * FROM queue_entries WHERE user_id = ? AND status = 'waiting'",
      [userId]
    );
    if (existing.length > 0) {
      return res.status(400).json({ message: 'You already have an active queue number' });
    }

    const [userRows] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
    const user = userRows[0];
    if (user.is_on_cooldown && new Date(user.cooldown_until) > new Date()) {
      return res.status(403).json({ message: `Cooldown active until ${user.cooldown_until}` });
    }

    const [config] = await db.query('SELECT * FROM queue_config LIMIT 1');
    if (!config[0].is_open) {
      return res.status(400).json({ message: 'Queue is currently closed' });
    }

    const [lastQueue] = await db.query(
      "SELECT queue_number FROM queue_entries WHERE DATE(time_joined) = CURDATE() ORDER BY id DESC LIMIT 1"
    );
    const lastNum = lastQueue.length > 0 ? parseInt(lastQueue[0].queue_number) : 0;
    const nextNum = lastNum + 1;

    if (nextNum > config[0].max_queue) {
      return res.status(400).json({ message: 'No queue numbers available' });
    }

    const queueNumber = String(nextNum).padStart(3, '0');
    const timeJoined = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    await db.query(
      'INSERT INTO queue_entries (user_id, queue_number, counter, status) VALUES (?, ?, ?, ?)',
      [userId, queueNumber, 'Registrar', 'waiting']
    );

    const newEntry = {
      queueNumber,
      counter: 'Registrar',
      timeJoined,
      status: 'waiting'
    };

    broadcastToAll(wss, {
      type: 'queue_assigned',
      payload: { userId, ...newEntry }
    });

    res.json(newEntry);
  } catch (err) {
    console.error('getQueueNumber error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

const getCurrentQueue = async (req, res) => {
  try {
    const userId = req.user.id;
    const [rows] = await db.query(
      "SELECT * FROM queue_entries WHERE user_id = ? AND status = 'waiting' ORDER BY id DESC LIMIT 1",
      [userId]
    );
    if (rows.length === 0) return res.json(null);

    const q = rows[0];
    res.json({
      queueNumber: q.queue_number,
      counter: q.counter,
      timeJoined: new Date(q.time_joined).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      status: q.status
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

const getQueueHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const [rows] = await db.query(
      "SELECT * FROM queue_entries WHERE user_id = ? ORDER BY id DESC LIMIT 20",
      [userId]
    );
    res.json(rows.map(q => ({
      queueNumber: q.queue_number,
      counter: q.counter,
      timeJoined: new Date(q.time_joined).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      status: q.status
    })));
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

const getAllQueues = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT q.queue_number, u.full_name, q.counter, q.status, q.time_joined
       FROM queue_entries q
       JOIN users u ON q.user_id = u.id
       WHERE DATE(q.time_joined) = CURDATE()
       ORDER BY q.id ASC`
    );
    res.json(rows.map(r => ({
      number: r.queue_number,
      name: r.full_name,
      queueType: r.counter,
      location: 'Window A',
      status: r.status,
      timeJoined: new Date(r.time_joined).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    })));
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

const getStats = async (req, res) => {
  try {
    const [config] = await db.query('SELECT * FROM queue_config LIMIT 1');
    const [countResult] = await db.query(
      "SELECT COUNT(*) as total FROM queue_entries WHERE DATE(time_joined) = CURDATE() AND status = 'waiting'"
    );
    const [upcoming] = await db.query(
      "SELECT queue_number FROM queue_entries WHERE DATE(time_joined) = CURDATE() AND status = 'waiting' ORDER BY id ASC LIMIT 1 OFFSET 1"
    );

    res.json({
      totalQueue: countResult[0].total,
      nowServing: config[0].now_serving,
      upcomingNumber: upcoming.length > 0 ? upcoming[0].queue_number : '---',
      isOpen: config[0].is_open === 1
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

const callNextQueue = async (req, res, wss) => {
  try {
    const { queueNumber } = req.body;

    await db.query(
      "UPDATE queue_entries SET status = 'serving' WHERE queue_number = ? AND DATE(time_joined) = CURDATE()",
      [queueNumber]
    );
    await db.query(
      "UPDATE queue_config SET now_serving = ?",
      [queueNumber]
    );

    broadcastToAll(wss, {
      type: 'now_serving',
      payload: { number: queueNumber }
    });

    res.json({ success: true, nowServing: queueNumber });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

const markServed = async (req, res, wss) => {
  try {
    const { queueNumber } = req.body;
    await db.query(
      "UPDATE queue_entries SET status = 'served', time_served = NOW() WHERE queue_number = ? AND DATE(time_joined) = CURDATE()",
      [queueNumber]
    );

    broadcastToAll(wss, {
      type: 'queue_update',
      payload: { queueNumber, status: 'served' }
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

const markMissed = async (req, res, wss) => {
  try {
    const { queueNumber } = req.body;

    const [rows] = await db.query(
      "SELECT user_id FROM queue_entries WHERE queue_number = ? AND DATE(time_joined) = CURDATE()",
      [queueNumber]
    );

    await db.query(
      "UPDATE queue_entries SET status = 'missed' WHERE queue_number = ? AND DATE(time_joined) = CURDATE()",
      [queueNumber]
    );

    if (rows.length > 0) {
      const cooldownUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await db.query(
        'UPDATE users SET is_on_cooldown = TRUE, cooldown_until = ? WHERE id = ?',
        [cooldownUntil, rows[0].user_id]
      );
    }

    broadcastToAll(wss, {
      type: 'queue_update',
      payload: { queueNumber, status: 'missed' }
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

const toggleQueue = async (req, res, wss) => {
  try {
    const { isOpen } = req.body;
    await db.query('UPDATE queue_config SET is_open = ?', [isOpen]);

    broadcastToAll(wss, {
      type: 'queue_update',
      payload: { queueAvailable: isOpen }
    });

    res.json({ success: true, isOpen });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

function broadcastToAll(wss, message) {
  if (!wss) return;
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(JSON.stringify(message));
    }
  });
}

module.exports = {
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
};