const jwt = require('jsonwebtoken');
const User = require('../models/User');

const DEFAULT_JWT_SECRET = 'change-this-secret-key-in-production';
const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;

if (!process.env.JWT_SECRET) {
  console.warn('[Auth] JWT_SECRET не задан — используется небезопасный ключ по умолчанию');
}
if (process.env.NODE_ENV === 'production' && JWT_SECRET === DEFAULT_JWT_SECRET) {
  console.error('[Auth] FATAL: задайте JWT_SECRET в production (.env)');
  process.exit(1);
}

async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }

  try {
    const user = await User.findById(decoded.id).select('username role cityId active').lean();
    if (!user) {
      return res.status(403).json({ error: 'User not found' });
    }
    if (!user.active) {
      return res.status(403).json({ error: 'Account is disabled' });
    }

    req.user = {
      id: String(user._id),
      username: user.username,
      role: user.role,
      cityId: user.cityId,
    };
    return next();
  } catch (err) {
    return res.status(500).json({ error: 'Authentication failed', details: err.message });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  return next();
}

function requireAccountant(req, res, next) {
  if (!req.user || (req.user.role !== 'accountant' && req.user.role !== 'admin')) {
    return res.status(403).json({ error: 'Accountant or Admin access required' });
  }
  return next();
}

function requireAdminOrAccountant(req, res, next) {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'accountant')) {
    return res.status(403).json({ error: 'Admin or Accountant access required' });
  }
  return next();
}

function requireAdminOrServiceManager(req, res, next) {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'service_manager')) {
    return res.status(403).json({ error: 'Admin or Service Manager access required' });
  }
  return next();
}

function requireSalesHead(req, res, next) {
  if (!req.user || (req.user.role !== 'sales_head' && req.user.role !== 'admin')) {
    return res.status(403).json({ error: 'Sales Head or Admin access required' });
  }
  return next();
}

function requireAdminOrAccountantOrSalesHead(req, res, next) {
  if (!req.user || !['admin', 'accountant', 'sales_head'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Admin, Accountant or Sales Head access required' });
  }
  return next();
}

function generateToken(user) {
  return jwt.sign(
    { id: user._id, username: user.username, role: user.role, cityId: user.cityId },
    JWT_SECRET,
    { expiresIn: '7d' },
  );
}

module.exports = {
  authenticateToken,
  requireAdmin,
  requireAccountant,
  requireAdminOrAccountant,
  requireAdminOrServiceManager,
  requireSalesHead,
  requireAdminOrAccountantOrSalesHead,
  generateToken,
  JWT_SECRET,
};
