const path = require('path');

// Всегда грузим .env из папки fridge-manager (не зависим от cwd PM2)
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const { createCorsOriginChecker } = require('./lib/corsOrigins');
const {
  isMongoConnected,
  setupMongoConnectionMonitoring,
  requireMongoMiddleware,
} = require('./lib/mongoConnection');

const app = express();

// Middleware
// Настройка CORS с поддержкой загрузки файлов
const corsOriginRaw = process.env.CORS_ORIGIN || '';
const corsOrigins = corsOriginRaw.split(',').map((s) => s.trim()).filter(Boolean);
const corsOptions = {
  origin: corsOrigins.length ? createCorsOriginChecker(corsOriginRaw) : true,
  credentials: corsOrigins.length > 0 && corsOriginRaw.trim() !== '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'Access-Control-Request-Method',
    'Access-Control-Request-Headers'
  ],
  exposedHeaders: ['Content-Disposition'],
  optionsSuccessStatus: 200, // Для старых браузеров
};
app.use(cors(corsOptions));

// Multer обработает multipart/form-data до json/urlencoded парсеров
const bodyLimitMb = (() => {
  const n = parseInt(process.env.BODY_LIMIT_MB || '10', 10);
  return Number.isFinite(n) && n >= 1 ? n : 10;
})();
const bodyLimit = `${bodyLimitMb}mb`;

app.use((req, res, next) => {
  const contentType = req.headers['content-type'] || '';

  if (contentType.includes('multipart/form-data')) {
    return next();
  }

  if (contentType.includes('application/json')) {
    return express.json({ limit: bodyLimit })(req, res, next);
  }

  if (contentType.includes('application/x-www-form-urlencoded')) {
    return express.urlencoded({ extended: true, limit: bodyLimit })(req, res, next);
  }

  express.json({ limit: bodyLimit })(req, res, (err) => {
    if (err) return next(err);
    express.urlencoded({ extended: true, limit: bodyLimit })(req, res, next);
  });
});

app.use(morgan('dev'));

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

function healthPayload() {
  const mongoReady = isMongoConnected(mongoose);
  const payload = {
    status: mongoReady ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    mongoReady,
  };
  if (!mongoReady) {
    payload.hint = 'Start MongoDB: sudo systemctl start mongod';
  }
  if (process.env.NODE_ENV !== 'production') {
    payload.uptime = process.uptime();
    payload.memory = process.memoryUsage();
  }
  return payload;
}

// Health check (без requireMongo — для мониторинга)
function sendHealth(req, res) {
  const payload = healthPayload();
  const code = payload.mongoReady ? 200 : 503;
  res.status(code).json(payload);
}

app.get('/health', sendHealth);

app.get('/api/health', sendHealth);

app.use('/api', requireMongoMiddleware(mongoose));
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

const checkinRoutes = require('./routes/checkin');
app.use('/api/checkins', checkinRoutes);

const userRoutes = require('./routes/user');
app.use('/api/users', userRoutes);

const fridgeRoutes = require('./routes/fridge');
app.use('/api/fridges', fridgeRoutes);

const cityRoutes = require('./routes/city');
app.use('/api/cities', cityRoutes);

const adminRoutes = require('./routes/admin');
app.use('/api/admin', adminRoutes);

const repairRoutes = require('./routes/repair');
app.use('/api/repairs', repairRoutes);

const salesRoutes = require('./routes/sales');
app.use('/api/sales', salesRoutes);

// DB Connection
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/fridge_manager';

async function start() {
  try {
    console.log('[Server] Connecting to MongoDB...');
    console.log('[Server] MongoDB URI:', mongoUri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')); // Hide credentials
    
    const mongooseOpts = { autoIndex: true };
    const parseMs = (v, min, max) => {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n)) return null;
      return Math.min(max, Math.max(min, n));
    };
    const sel = parseMs(process.env.MONGOOSE_SERVER_SELECTION_TIMEOUT_MS, 2000, 120000);
    const conn = parseMs(process.env.MONGOOSE_CONNECT_TIMEOUT_MS, 2000, 120000);
    const sock = parseMs(process.env.MONGOOSE_SOCKET_TIMEOUT_MS, 10000, 360000);
    mongooseOpts.serverSelectionTimeoutMS = sel != null ? sel : 10000;
    mongooseOpts.connectTimeoutMS = conn != null ? conn : 10000;
    if (sock != null) mongooseOpts.socketTimeoutMS = sock;

    setupMongoConnectionMonitoring(mongoose);

    await mongoose.connect(mongoUri, mongooseOpts);
    
    console.log('[Server] ✅ Connected to MongoDB');
    console.log('[Server] Database:', mongoose.connection.db.databaseName);
    
    // Test user lookup
    const User = require('./models/User');
    const testUser = await User.findOne({ username: 'admin' });
    if (testUser) {
      console.log(`[Server] ✅ Test user 'admin' found in database`);
    } else {
      console.log(`[Server] ⚠️  Test user 'admin' NOT found in database`);
      const userCount = await User.countDocuments();
      console.log(`[Server] Total users in database: ${userCount}`);
    }
    
    const port = process.env.PORT || 4000;
    const server = app.listen(port, '0.0.0.0', () => {
      console.log(`[Server] Server listening on http://0.0.0.0:${port}`);
    });
    
    // Увеличиваем таймауты для длительных операций (импорт больших файлов)
    server.timeout = 900000; // 15 минут (экспорт / импорт)
    server.keepAliveTimeout = 65000; // 65 секунд
    server.headersTimeout = 66000; // 66 секунд (должен быть больше keepAliveTimeout)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[Server] Failed to start server:', err);
    console.error('[Server] cwd:', process.cwd());
    console.error('[Server] __dirname:', __dirname);
    console.error('[Server] MONGODB_URI set:', Boolean(process.env.MONGODB_URI));
    process.exit(1);
  }
}

process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception:', err);
  process.exit(1);
});

start();


