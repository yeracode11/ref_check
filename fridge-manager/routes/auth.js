const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { generateToken, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Log login attempt (without password)
    console.log(`[Auth] Login attempt for username: ${username}`);
    
    if (!username || !password) {
      console.log('[Auth] Missing username or password');
      return res.status(400).json({ error: 'username and password are required' });
    }

    // Normalize username: trim whitespace and convert to string
    const normalizedUsername = String(username).trim();
    console.log(`[Auth] Normalized username: "${normalizedUsername}" (original: "${username}")`);

    // Try to find user - first exact match, then case-insensitive
    let user = await User.findOne({ username: normalizedUsername });
    if (!user) {
      // Try case-insensitive search
      user = await User.findOne({ 
        username: { $regex: new RegExp(`^${normalizedUsername}$`, 'i') }
      });
    }
    
    if (!user) {
      // Log all usernames for debugging
      const allUsers = await User.find({}, 'username').limit(10);
      console.log(`[Auth] User not found: ${normalizedUsername}`);
      console.log(`[Auth] Sample usernames in DB:`, allUsers.map(u => u.username));
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    console.log(`[Auth] User found: ${user.username} (ID: ${user._id}, Role: ${user.role})`);

    if (!user.active) {
      console.log(`[Auth] Account disabled for user: ${username}`);
      return res.status(403).json({ error: 'Account is disabled' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      console.log(`[Auth] Invalid password for user: ${username}`);
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    console.log(`[Auth] Successful login for user: ${username} (${user.role})`);
    const token = generateToken(user);
    const userObj = user.toObject();
    delete userObj.password;

    return res.json({
      token,
      user: userObj,
    });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    return res.status(500).json({ error: 'Login failed', details: err.message });
  }
});

// GET /api/auth/me - get current user info (protected)
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, async (err, decoded) => {
      if (err) {
        return res.status(403).json({ error: 'Invalid or expired token' });
      }
      const user = await User.findById(decoded.id).select('-password');
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      return res.json(user);
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to get user info', details: err.message });
  }
});

module.exports = router;

