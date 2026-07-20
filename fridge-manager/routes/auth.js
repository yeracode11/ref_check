const express = require('express');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const { authenticateToken, generateToken } = require('../middleware/auth');
const { escapeRegExp } = require('../lib/stringHelpers');

const router = express.Router();

function userResponse(user) {
  const userObj = user.toObject ? user.toObject() : { ...user };
  delete userObj.password;
  return userObj;
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }

    const normalizedUsername = String(username).trim();
    const loginSelect = 'username password role active email cityId fullName phone';
    let user = await User.findOne({ username: normalizedUsername }).select(loginSelect);
    if (!user) {
      user = await User.findOne({
        username: { $regex: new RegExp(`^${escapeRegExp(normalizedUsername)}$`, 'i') },
      }).select(loginSelect);
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const hashOk = typeof user.password === 'string' && user.password.startsWith('$2');
    if (!hashOk) {
      console.error('[Auth] Stored password is not a bcrypt hash — reset via node create_admin.js');
    }

    if (!user.active) {
      return res.status(403).json({ error: 'Account is disabled' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = generateToken(user);
    return res.json({
      token,
      user: userResponse(user),
    });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    return res.status(500).json({ error: 'Login failed', details: err.message });
  }
});

// GET /api/auth/me - get current user info (protected)
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password').populate('cityId', 'name code');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json(user);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to get user info', details: err.message });
  }
});

module.exports = router;
