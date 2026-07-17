const jwt = require('jsonwebtoken');
const User = require('../models/User');

const DEFAULT_JWT_SECRET = 'change-this-secret-key-in-production';
const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;

const ACCESS_TOKEN_EXPIRES = process.env.JWT_ACCESS_EXPIRES || '1h';
const REFRESH_TOKEN_EXPIRES = process.env.JWT_REFRESH_EXPIRES || '90d';

function accessExpiresInSeconds() {
  if (ACCESS_TOKEN_EXPIRES.endsWith('h')) {
    return parseInt(ACCESS_TOKEN_EXPIRES, 10) * 3600;
  }
  if (ACCESS_TOKEN_EXPIRES.endsWith('d')) {
    return parseInt(ACCESS_TOKEN_EXPIRES, 10) * 86400;
  }
  if (ACCESS_TOKEN_EXPIRES.endsWith('m')) {
    return parseInt(ACCESS_TOKEN_EXPIRES, 10) * 60;
  }
  const n = parseInt(ACCESS_TOKEN_EXPIRES, 10);
  return Number.isFinite(n) ? n : 3600;
}

if (!process.env.JWT_SECRET) {
  console.warn('[Auth] JWT_SECRET не задан — используется небезопасный ключ по умолчанию');
}
if (process.env.NODE_ENV === 'production' && JWT_SECRET === DEFAULT_JWT_SECRET) {
  console.error('[Auth] FATAL: задайте JWT_SECRET в production (.env)');
  process.exit(1);
}

function buildAccessPayload(user) {
  return {
    id: String(user._id || user.id),
    username: user.username,
    role: user.role,
    cityId: user.cityId,
    type: 'access',
  };
}

function generateAccessToken(user) {
  return jwt.sign(buildAccessPayload(user), JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRES });
}

function generateRefreshToken(user) {
  return jwt.sign(
    { id: String(user._id || user.id), type: 'refresh' },
    JWT_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRES },
  );
}

/** @deprecated используйте generateAccessToken — alias для совместимости */
function generateToken(user) {
  return generateAccessToken(user);
}

function issueTokenPair(user) {
  return {
    accessToken: generateAccessToken(user),
    refreshToken: generateRefreshToken(user),
    expiresIn: accessExpiresInSeconds(),
    tokenType: 'Bearer',
  };
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

  if (decoded.type && decoded.type !== 'access') {
    return res.status(403).json({ error: 'Invalid token type' });
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

function requireManagerOrAdmin(req, res, next) {
  if (!req.user || (req.user.role !== 'manager' && req.user.role !== 'admin')) {
    return res.status(403).json({ error: 'Manager or Admin access required' });
  }
  return next();
}

function requireMobileRole(req, res, next) {
  const allowed = ['manager', 'service_manager', 'admin'];
  if (!req.user || !allowed.includes(req.user.role)) {
    return res.status(403).json({ error: 'Mobile access not allowed for this role' });
  }
  return next();
}

module.exports = {
  authenticateToken,
  requireAdmin,
  requireAccountant,
  requireAdminOrAccountant,
  requireAdminOrServiceManager,
  requireSalesHead,
  requireAdminOrAccountantOrSalesHead,
  requireManagerOrAdmin,
  requireMobileRole,
  generateToken,
  generateAccessToken,
  generateRefreshToken,
  issueTokenPair,
  accessExpiresInSeconds,
  JWT_SECRET,
  ACCESS_TOKEN_EXPIRES,
  REFRESH_TOKEN_EXPIRES,
};
