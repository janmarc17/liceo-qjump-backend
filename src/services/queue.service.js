const db = require('../config/database');

const DEFAULT_QUEUE_TIMEOUT_MINUTES = 5;
const counterTimers = new Map();
let timeoutColumnReady = false;

function isUnknownColumnError(err) {
  return err && (err.code === 'ER_BAD_FIELD_ERROR' || String(err.message || '').includes('Unknown column'));
}

async function ensureTimeoutColumn() {
  if (timeoutColumnReady) {
    return;
  }

  try {
    await db.query('SELECT queue_timeout_minutes FROM queue_config LIMIT 1');
    timeoutColumnReady = true;
    return;
  } catch (err) {
    if (!isUnknownColumnError(err)) {
      throw err;
    }
  }

  try {
    await db.query(
      `ALTER TABLE queue_config
       ADD COLUMN queue_timeout_minutes INT NOT NULL DEFAULT 5`
    );
  } catch (err) {
    if (err.code !== 'ER_DUP_FIELDNAME') {
      throw err;
    }
  }

  timeoutColumnReady = true;
}

function clearCounterTimer(counter) {
  const existing = counterTimers.get(counter);
  if (existing) {
    clearTimeout(existing.timeoutId);
    counterTimers.delete(counter);
  }
}

function formatDateTime(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

async function getQueueTimeoutMinutes(counter) {
  await ensureTimeoutColumn();

  const [rows] = await db.query(
    'SELECT queue_timeout_minutes FROM queue_config WHERE counter = ? LIMIT 1',
    [counter]
  );

  const value = rows[0]?.queue_timeout_minutes;
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_QUEUE_TIMEOUT_MINUTES;
  }

  return value;
}

async function scheduleCounterTimeout(counter, queueNumber, wss) {
  clearCounterTimer(counter);

  const timeoutMinutes = await getQueueTimeoutMinutes(counter);
  const timeoutMs = timeoutMinutes * 60 * 1000;

  const timeoutId = setTimeout(async () => {
    try {
      const [rows] = await db.query(
        "SELECT id, status FROM queue_entries WHERE queue_number = ? AND counter = ? AND DATE(time_joined) = CURDATE() LIMIT 1",
        [queueNumber, counter]
      );

      if (rows.length === 0 || rows[0].status !== 'called') {
        return;
      }

      await db.query(
        "UPDATE queue_entries SET status = 'completed', time_served = NOW() WHERE id = ?",
        [rows[0].id]
      );

      broadcastToAll(wss, {
        type: 'queue_update',
        payload: { queueNumber, status: 'completed', counter, timedOut: true }
      });

      await assignNextWaiting(counter, wss);
    } catch (err) {
      console.error('scheduleCounterTimeout error:', err);
    }
  }, timeoutMs);

  counterTimers.set(counter, { timeoutId, queueNumber });
}

async function assignNextWaiting(counter, wss) {
  clearCounterTimer(counter);

  const [nextQueue] = await db.query(
    "SELECT id, queue_number FROM queue_entries WHERE counter = ? AND DATE(time_joined) = CURDATE() AND status = 'waiting' ORDER BY id ASC LIMIT 1",
    [counter]
  );

  if (nextQueue.length === 0) {
    await db.query(
      "UPDATE queue_config SET now_serving = '000' WHERE counter = ?",
      [counter]
    );

    broadcastToAll(wss, {
      type: 'now_serving',
      payload: { number: '000', counter }
    });

    return null;
  }

  const next = nextQueue[0];

  await db.query(
    "UPDATE queue_entries SET status = 'called' WHERE id = ?",
    [next.id]
  );

  await db.query(
    "UPDATE queue_config SET now_serving = ? WHERE counter = ?",
    [next.queue_number, counter]
  );

  broadcastToAll(wss, {
    type: 'now_serving',
    payload: { number: next.queue_number, counter }
  });

  await scheduleCounterTimeout(counter, next.queue_number, wss);

  return next.queue_number;
}

async function getTimeoutConfig(req, res) {
  try {
    await ensureTimeoutColumn();

    const [rows] = await db.query(
      'SELECT queue_timeout_minutes FROM queue_config ORDER BY counter ASC LIMIT 1'
    );

    const timeoutMinutes = rows[0]?.queue_timeout_minutes ?? DEFAULT_QUEUE_TIMEOUT_MINUTES;
    return res.json({ timeoutMinutes });
  } catch (err) {
    console.error('getTimeoutConfig error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

async function setTimeoutConfig(req, res, wss) {
  try {
    const parsed = Number(req.body?.timeoutMinutes);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 120) {
      return res.status(400).json({ message: 'timeoutMinutes must be an integer between 1 and 120' });
    }

    await ensureTimeoutColumn();

    await db.query(
      'UPDATE queue_config SET queue_timeout_minutes = ?',
      [parsed]
    );

    broadcastToAll(wss, {
      type: 'queue_timeout_updated',
      payload: { timeoutMinutes: parsed }
    });

    return res.json({ success: true, timeoutMinutes: parsed });
  } catch (err) {
    console.error('setTimeoutConfig error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

async function getHomeState(req, res) {
  try {
    const userId = req.user.id;
    const counter = req.query.counter; // Optional counter parameter
    const [config] = await db.query('SELECT * FROM queue_config LIMIT 1');
    
    // Use default config if none exists in database
    const queueConfig = config && config.length > 0 ? config[0] : {
      now_serving: null,
      is_open: 1,
      max_queue: 100
    };

    // Get user's current queue - if counter specified, filter by counter
    let queueQuery = "SELECT * FROM queue_entries WHERE user_id = ? AND status IN ('waiting', 'called')";
    let queryParams = [userId];
    
    if (counter) {
      queueQuery += " AND counter = ?";
      queryParams.push(counter);
    }
    queueQuery += " ORDER BY id DESC LIMIT 1";

    const [currentQueue] = await db.query(queueQuery, queryParams);

    // Get people ahead - if counter specified, only count same counter
    let aheadQuery = "SELECT COUNT(*) as count FROM queue_entries WHERE status = 'waiting' AND id < (SELECT IFNULL(MIN(id), 999999) FROM queue_entries WHERE user_id = ? AND status IN ('waiting', 'called')";
    let aheadParams = [userId];
    
    if (counter) {
      aheadQuery += " AND counter = ?";
      aheadParams.push(counter);
    }
    aheadQuery += ")";
    if (counter) {
      aheadQuery += " AND counter = ?";
      aheadParams.push(counter);
    }

    const [waitingAhead] = await db.query(aheadQuery, aheadParams);

    // Get counter-specific "now serving" if counter is provided
    let nowServingNumber = queueConfig.now_serving;
    if (counter) {
      try {
        const [nowServingData] = await db.query(
          "SELECT now_serving FROM queue_config WHERE counter = ? LIMIT 1",
          [counter]
        );
        if (nowServingData.length > 0) {
          nowServingNumber = nowServingData[0].now_serving;
        } else {
          // If no counter-specific config, use default
          nowServingNumber = null;
        }
      } catch (queryErr) {
        // If counter column doesn't exist, use global now_serving
        nowServingNumber = queueConfig.now_serving;
      }
    }

    const myQueue = currentQueue.length > 0 ? currentQueue[0] : null;
    const peopleAhead = waitingAhead[0].count;

    res.json({
      nowServing: nowServingNumber,
      myQueueNumber: myQueue ? myQueue.queue_number : null,
      counter: myQueue ? myQueue.counter : counter || null,
      peopleAhead: peopleAhead,
      estimatedWaitMinutes: peopleAhead * 3,
      queueAvailable: queueConfig.is_open === 1
    });
  } catch (err) {
    console.error('getHomeState error:', err);
    res.status(500).json({ message: 'Server error' });
  }
}

async function getQueueNumber(req, res, wss) {
  try {
    const userId = req.user.id;
    const { counter = 'Registrar' } = req.body;

    // Validate counter type
    const validCounters = ['Registrar', 'Cashier'];
    if (!validCounters.includes(counter)) {
      return res.status(400).json({ message: 'Invalid counter type. Must be Registrar or Cashier.' });
    }

    // Check if user has ANY active queue (can only have one queue at a time)
    const [existing] = await db.query(
      "SELECT * FROM queue_entries WHERE user_id = ? AND status IN ('waiting', 'called')",
      [userId]
    );
    if (existing.length > 0) {
      return res.status(400).json({ message: 'You already have an active queue. Wait until it is completed or cancelled.' });
    }

    const [userRows] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
    const user = userRows[0];
    if (user.is_on_cooldown && new Date(user.cooldown_until) > new Date()) {
      return res.status(403).json({ message: `Cooldown active until ${user.cooldown_until}` });
    }

    const [config] = await db.query('SELECT * FROM queue_config LIMIT 1');
    const queueConfig = config && config.length > 0 ? config[0] : { is_open: 1, max_queue: 100 };
    
    if (!queueConfig.is_open) {
      return res.status(400).json({ message: 'Queue is currently closed' });
    }

    // Get last queue number for this specific counter today
    const [lastQueue] = await db.query(
      "SELECT queue_number FROM queue_entries WHERE counter = ? AND DATE(time_joined) = CURDATE() ORDER BY id DESC LIMIT 1",
      [counter]
    );
    const lastNum = lastQueue.length > 0 ? parseInt(lastQueue[0].queue_number) : 0;
    const nextNum = lastNum + 1;

    if (nextNum > queueConfig.max_queue) {
      return res.status(400).json({ message: `No queue numbers available for ${counter}` });
    }

    const queueNumber = String(nextNum).padStart(3, '0');
    const timeJoined = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    await db.query(
      'INSERT INTO queue_entries (user_id, queue_number, counter, status) VALUES (?, ?, ?, ?)',
      [userId, queueNumber, counter, 'waiting']
    );

    const newEntry = {
      queueNumber,
      counter: counter,
      queueType: counter,
      timeJoined,
      createdAt: timeJoined,
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
}

async function getCurrentQueue(req, res) {
  try {
    const userId = req.user.id;
    const [rows] = await db.query(
      "SELECT * FROM queue_entries WHERE user_id = ? AND status IN ('waiting', 'called') ORDER BY id DESC LIMIT 1",
      [userId]
    );
    if (rows.length === 0) return res.json(null);

    const q = rows[0];
    res.json({
      queueNumber: q.queue_number,
      counter: q.counter,
      queueType: q.counter,
      timeJoined: new Date(q.time_joined).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      createdAt: formatDateTime(q.time_joined),
      servedAt: q.time_served ? formatDateTime(q.time_served) : null,
      cancelledAt: q.status === 'cancelled' || q.status === 'missed' ? formatDateTime(q.time_served) : null,
      status: q.status
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
}

async function getQueueHistory(req, res) {
  try {
    const userId = req.user.id;
    const [rows] = await db.query(
      "SELECT * FROM queue_entries WHERE user_id = ? ORDER BY id DESC LIMIT 20",
      [userId]
    );
    res.json(rows.map(q => ({
      queueNumber: q.queue_number,
      counter: q.counter,
      queueType: q.counter,
      createdAt: formatDateTime(q.time_joined),
      servedAt: (q.status === 'completed' || q.status === 'served') ? formatDateTime(q.time_served) : null,
      cancelledAt: (q.status === 'cancelled' || q.status === 'missed') ? formatDateTime(q.time_served) : null,
      timeJoined: new Date(q.time_joined).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      status: q.status
    })));
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
}

async function getAllQueues(req, res) {
  try {
    const userRole = req.user?.role || 'Student';
    
    // Role-based access control
    if (userRole === 'Student') {
      return res.status(403).json({ message: 'Unauthorized: Students cannot access queue management' });
    }

    const [rows] = await db.query(
      `SELECT q.queue_number, u.full_name, u.student_id, q.counter, q.status, q.time_joined, q.time_served
       FROM queue_entries q
       JOIN users u ON q.user_id = u.id
       WHERE DATE(q.time_joined) = CURDATE()
       ORDER BY q.counter ASC, q.id ASC`
    );
    
    // Role-based queue filtering
    if (userRole === 'Registrar') {
      // Registrar only sees Registrar queue
      const registrar = rows.filter(r => r.counter === 'Registrar').map(r => ({
        number: r.queue_number,
        name: r.full_name,
        studentId: r.student_id,
        counter: r.counter,
        status: r.status,
        timeJoined: new Date(r.time_joined).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        servedAt: formatDateTime(r.time_served)
      }));
      return res.json({ registrar, cashier: [] });
    }
    
    if (userRole === 'Cashier') {
      // Cashier only sees Cashier queue
      const cashier = rows.filter(r => r.counter === 'Cashier').map(r => ({
        number: r.queue_number,
        name: r.full_name,
        studentId: r.student_id,
        counter: r.counter,
        status: r.status,
        timeJoined: new Date(r.time_joined).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        servedAt: formatDateTime(r.time_served)
      }));
      return res.json({ registrar: [], cashier });
    }

    // Administrator sees both queues
    const registrar = rows.filter(r => r.counter === 'Registrar').map(r => ({
      number: r.queue_number,
      name: r.full_name,
      studentId: r.student_id,
      counter: r.counter,
      status: r.status,
      timeJoined: new Date(r.time_joined).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      servedAt: formatDateTime(r.time_served)
    }));

    const cashier = rows.filter(r => r.counter === 'Cashier').map(r => ({
      number: r.queue_number,
      name: r.full_name,
      studentId: r.student_id,
      counter: r.counter,
      status: r.status,
      timeJoined: new Date(r.time_joined).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      servedAt: formatDateTime(r.time_served)
    }));

    res.json({ registrar, cashier });
  } catch (err) {
    console.error('getAllQueues error:', err);
    res.status(500).json({ message: 'Server error' });
  }
}

async function getStats(req, res) {
  try {
    const userRole = req.user?.role || 'Student';
    
    // Role-based access control
    if (userRole === 'Student') {
      return res.status(403).json({ message: 'Unauthorized: Students cannot access queue statistics' });
    }

    // Prepare response object
    let response = {};

    // If Registrar: only provide Registrar stats
    if (userRole === 'Registrar') {
      const [registrarConfig] = await db.query('SELECT * FROM queue_config WHERE counter = ?', ['Registrar']);
      const [registrarCount] = await db.query(
        "SELECT COUNT(*) as total FROM queue_entries WHERE counter = ? AND DATE(time_joined) = CURDATE() AND status = 'waiting'",
        ['Registrar']
      );
      const [registrarUpcoming] = await db.query(
        "SELECT queue_number FROM queue_entries WHERE counter = ? AND DATE(time_joined) = CURDATE() AND status = 'waiting' ORDER BY id ASC LIMIT 1",
        ['Registrar']
      );

      response.registrar = {
        totalQueue: registrarCount[0].total,
        nowServing: registrarConfig[0]?.now_serving || '000',
        upcomingNumber: registrarUpcoming.length > 0 ? registrarUpcoming[0].queue_number : '---',
        isOpen: registrarConfig[0]?.is_open === 1
      };
      response.cashier = null; // Explicitly deny access to Cashier stats
      return res.json(response);
    }

    // If Cashier: only provide Cashier stats
    if (userRole === 'Cashier') {
      const [cashierConfig] = await db.query('SELECT * FROM queue_config WHERE counter = ?', ['Cashier']);
      const [cashierCount] = await db.query(
        "SELECT COUNT(*) as total FROM queue_entries WHERE counter = ? AND DATE(time_joined) = CURDATE() AND status = 'waiting'",
        ['Cashier']
      );
      const [cashierUpcoming] = await db.query(
        "SELECT queue_number FROM queue_entries WHERE counter = ? AND DATE(time_joined) = CURDATE() AND status = 'waiting' ORDER BY id ASC LIMIT 1",
        ['Cashier']
      );

      response.registrar = null; // Explicitly deny access to Registrar stats
      response.cashier = {
        totalQueue: cashierCount[0].total,
        nowServing: cashierConfig[0]?.now_serving || '000',
        upcomingNumber: cashierUpcoming.length > 0 ? cashierUpcoming[0].queue_number : '---',
        isOpen: cashierConfig[0]?.is_open === 1
      };
      return res.json(response);
    }

    // Administrator: provide both stats
    const [registrarConfig] = await db.query('SELECT * FROM queue_config WHERE counter = ?', ['Registrar']);
    const [cashierConfig] = await db.query('SELECT * FROM queue_config WHERE counter = ?', ['Cashier']);
    
    const [registrarCount] = await db.query(
      "SELECT COUNT(*) as total FROM queue_entries WHERE counter = ? AND DATE(time_joined) = CURDATE() AND status = 'waiting'",
      ['Registrar']
    );
    const [cashierCount] = await db.query(
      "SELECT COUNT(*) as total FROM queue_entries WHERE counter = ? AND DATE(time_joined) = CURDATE() AND status = 'waiting'",
      ['Cashier']
    );

    const [registrarUpcoming] = await db.query(
      "SELECT queue_number FROM queue_entries WHERE counter = ? AND DATE(time_joined) = CURDATE() AND status = 'waiting' ORDER BY id ASC LIMIT 1",
      ['Registrar']
    );
    const [cashierUpcoming] = await db.query(
      "SELECT queue_number FROM queue_entries WHERE counter = ? AND DATE(time_joined) = CURDATE() AND status = 'waiting' ORDER BY id ASC LIMIT 1",
      ['Cashier']
    );

    res.json({
      registrar: {
        totalQueue: registrarCount[0].total,
        nowServing: registrarConfig[0]?.now_serving || '000',
        upcomingNumber: registrarUpcoming.length > 0 ? registrarUpcoming[0].queue_number : '---',
        isOpen: registrarConfig[0]?.is_open === 1
      },
      cashier: {
        totalQueue: cashierCount[0].total,
        nowServing: cashierConfig[0]?.now_serving || '000',
        upcomingNumber: cashierUpcoming.length > 0 ? cashierUpcoming[0].queue_number : '---',
        isOpen: cashierConfig[0]?.is_open === 1
      }
    });
  } catch (err) {
    console.error('getStats error:', err);
    res.status(500).json({ message: 'Server error' });
  }
}

async function callNextQueue(req, res, wss) {
  try {
    const userRole = req.user?.role;
    const { counter } = req.body;

    const validCounters = ['Registrar', 'Cashier'];
    if (!validCounters.includes(counter)) {
      return res.status(400).json({ message: 'Invalid counter. Must be Registrar or Cashier.' });
    }

    // Validate role can access this counter
    if (userRole === 'Registrar' && counter !== 'Registrar') {
      return res.status(403).json({ message: 'Registrar can only manage Registrar queue' });
    }
    if (userRole === 'Cashier' && counter !== 'Cashier') {
      return res.status(403).json({ message: 'Cashier can only manage Cashier queue' });
    }

    // Auto-complete currently called queue before advancing.
    const [currentCalled] = await db.query(
      "SELECT queue_number FROM queue_entries WHERE counter = ? AND DATE(time_joined) = CURDATE() AND status = 'called' ORDER BY id ASC LIMIT 1",
      [counter]
    );

    if (currentCalled.length > 0) {
      clearCounterTimer(counter);

      const completedNumber = currentCalled[0].queue_number;
      await db.query(
        "UPDATE queue_entries SET status = 'completed', time_served = NOW() WHERE queue_number = ? AND counter = ? AND DATE(time_joined) = CURDATE()",
        [completedNumber, counter]
      );

      broadcastToAll(wss, {
        type: 'queue_update',
        payload: { queueNumber: completedNumber, status: 'completed', counter }
      });
    }

    const nextNumber = await assignNextWaiting(counter, wss);

    if (!nextNumber) {
      return res.json({ success: true, nowServing: '000', counter });
    }

    res.json({ success: true, nowServing: nextNumber, counter });
  } catch (err) {
    console.error('callNextQueue error:', err);
    res.status(500).json({ message: 'Server error' });
  }
}

async function markServed(req, res, wss) {
  try {
    const userRole = req.user?.role;
    const { queueNumber, counter } = req.body;

    const validCounters = ['Registrar', 'Cashier'];
    if (!validCounters.includes(counter)) {
      return res.status(400).json({ message: 'Invalid counter. Must be Registrar or Cashier.' });
    }

    // Validate role can access this counter
    if (userRole === 'Registrar' && counter !== 'Registrar') {
      return res.status(403).json({ message: 'Registrar can only manage Registrar queue' });
    }
    if (userRole === 'Cashier' && counter !== 'Cashier') {
      return res.status(403).json({ message: 'Cashier can only manage Cashier queue' });
    }

    const [row] = await db.query(
      "SELECT status FROM queue_entries WHERE queue_number = ? AND counter = ? AND DATE(time_joined) = CURDATE() LIMIT 1",
      [queueNumber, counter]
    );

    if (row.length === 0) {
      return res.status(404).json({ message: 'Queue entry not found' });
    }

    const wasCalled = row[0].status === 'called';

    if (wasCalled) {
      clearCounterTimer(counter);
    }

    await db.query(
      "UPDATE queue_entries SET status = 'completed', time_served = NOW() WHERE queue_number = ? AND counter = ? AND DATE(time_joined) = CURDATE()",
      [queueNumber, counter]
    );

    broadcastToAll(wss, {
      type: 'queue_update',
      payload: { queueNumber, status: 'completed', counter }
    });

    if (wasCalled) {
      await assignNextWaiting(counter, wss);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('markServed error:', err);
    res.status(500).json({ message: 'Server error' });
  }
}

async function markMissed(req, res, wss) {
  try {
    const userRole = req.user?.role;
    const { queueNumber, counter } = req.body;

    const validCounters = ['Registrar', 'Cashier'];
    if (!validCounters.includes(counter)) {
      return res.status(400).json({ message: 'Invalid counter. Must be Registrar or Cashier.' });
    }

    // Validate role can access this counter
    if (userRole === 'Registrar' && counter !== 'Registrar') {
      return res.status(403).json({ message: 'Registrar can only manage Registrar queue' });
    }
    if (userRole === 'Cashier' && counter !== 'Cashier') {
      return res.status(403).json({ message: 'Cashier can only manage Cashier queue' });
    }

    const [rows] = await db.query(
      "SELECT status FROM queue_entries WHERE queue_number = ? AND counter = ? AND DATE(time_joined) = CURDATE() LIMIT 1",
      [queueNumber, counter]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Queue entry not found' });
    }

    const wasCalled = rows[0].status === 'called';

    if (wasCalled) {
      clearCounterTimer(counter);
    }

    await db.query(
      "UPDATE queue_entries SET status = 'cancelled', time_served = NOW() WHERE queue_number = ? AND counter = ? AND DATE(time_joined) = CURDATE()",
      [queueNumber, counter]
    );

    broadcastToAll(wss, {
      type: 'queue_update',
      payload: { queueNumber, status: 'cancelled', counter }
    });

    if (wasCalled) {
      await assignNextWaiting(counter, wss);
    } else {
      const [activeCalled] = await db.query(
        "SELECT id FROM queue_entries WHERE counter = ? AND DATE(time_joined) = CURDATE() AND status = 'called' LIMIT 1",
        [counter]
      );

      if (activeCalled.length === 0) {
        await assignNextWaiting(counter, wss);
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('markMissed error:', err);
    res.status(500).json({ message: 'Server error' });
  }
}

async function toggleQueue(req, res, wss) {
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
}

async function getAdminQueueHistory(req, res) {
  try {
    const rawPage = Number(req.query.page ?? 1);
    const rawLimit = Number(req.query.limit ?? 10);
    const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 10;
    const offset = (page - 1) * limit;

    const queueType = String(req.query.queueType ?? 'all').trim();
    const studentId = String(req.query.studentId ?? '').trim();

    const validTypes = ['all', 'Registrar', 'Cashier'];
    if (!validTypes.includes(queueType)) {
      return res.status(400).json({ message: 'Invalid queueType filter' });
    }

    const whereClauses = [];
    const params = [];

    if (queueType !== 'all') {
      whereClauses.push('q.counter = ?');
      params.push(queueType);
    }

    if (studentId) {
      whereClauses.push('u.student_id LIKE ?');
      params.push(`%${studentId}%`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total
       FROM queue_entries q
       JOIN users u ON q.user_id = u.id
       ${whereSql}`,
      params
    );

    const total = countRows[0]?.total ?? 0;

    const [rows] = await db.query(
      `SELECT q.queue_number, q.counter, q.status, q.time_served, u.student_id
       FROM queue_entries q
       JOIN users u ON q.user_id = u.id
       ${whereSql}
       ORDER BY q.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const history = rows.map((row) => ({
      queueNumber: row.queue_number,
      studentId: row.student_id,
      queueType: row.counter,
      status: row.status,
      servedAt: formatDateTime(row.time_served)
    }));

    return res.json({
      history,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) {
    console.error('getAdminQueueHistory error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

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
  getAdminQueueHistory,
  getAllQueues,
  getStats,
  getTimeoutConfig,
  setTimeoutConfig,
  callNextQueue,
  markServed,
  markMissed,
  toggleQueue,
  // helper exports (if needed elsewhere)
  assignNextWaiting,
  scheduleCounterTimeout,
  clearCounterTimer,
  broadcastToAll
};
