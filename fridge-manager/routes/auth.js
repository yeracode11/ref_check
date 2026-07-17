const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const {
  authenticateToken,
  issueTokenPair,
  JWT_SECRET,
  ACCESS_TOKEN_EXPIRES,
  REFRESH_TOKEN_EXPIRES,
} = require('../middleware/auth');
const { escapeRegExp } = require('../lib/stringHelpers');

const router = express.Router();

function userResponse(user) {
  const userObj = user.toObject ? user.toObject() : { ...user };
  delete userObj.password;
  return userObj;
}

function authPayload(user) {
  const tokens = issueTokenPair(user);
  return {
    token: tokens.accessToken,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
    tokenType: tokens.tokenType,
    user: userResponse(user),
  };
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

    return res.json(authPayload(user));
  } catch (err) {
    console.error('[Auth] Login error:', err);
    return res.status(500).json({ error: 'Login failed', details: err.message });
  }
});

// POST /api/auth/refresh — обновление access token по refresh token (для мобилки)
router.post('/refresh', async (req, res) => {
  try {
    const refreshToken = req.body?.refreshToken || req.body?.token;
    if (!refreshToken) {
      return res.status(400).json({ error: 'refreshToken is required' });
    }

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, JWT_SECRET);
    } catch {
      return res.status(403).json({ error: 'Invalid or expired refresh token' });
    }

    if (decoded.type !== 'refresh') {
      return res.status(403).json({ error: 'Invalid refresh token' });
    }

    const user = await User.findById(decoded.id).select(
      'username password role active email cityId fullName phone',
    );
    if (!user || !user.active) {
      return res.status(403).json({ error: 'Account is disabled or not found' });
    }

    return res.json(authPayload(user));
  } catch (err) {
    console.error('[Auth] Refresh error:', err);
    return res.status(500).json({ error: 'Failed to refresh token', details: err.message });
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

// GET /api/auth/config — публичные настройки клиента (мобилка / веб)
router.get('/config', (req, res) => {
  res.json({
    accessTokenExpires: ACCESS_TOKEN_EXPIRES,
    refreshTokenExpires: REFRESH_TOKEN_EXPIRES,
    apiVersion: '1',
  });
});

module.exports = router;
