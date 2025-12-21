require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');

const app = express();

// Middleware
// Настройка CORS с поддержкой загрузки файлов
const corsOptions = {
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
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
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(morgan('dev'));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// Routes
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

// DB Connection
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/fridge_manager';

async function start() {
  try {
    console.log('[Server] Connecting to MongoDB...');
    console.log('[Server] MongoDB URI:', mongoUri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')); // Hide credentials
    
    await mongoose.connect(mongoUri, {
      autoIndex: true,
    });
    
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
    app.listen(port, '0.0.0.0', () => {
      console.log(`[Server] Server listening on http://0.0.0.0:${port}`);
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[Server] Failed to start server:', err);
    process.exit(1);
  }
}

start();


