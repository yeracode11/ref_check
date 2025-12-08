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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Disposition'],
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(morgan('dev'));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
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
    await mongoose.connect(mongoUri, {
      autoIndex: true,
    });
    const port = process.env.PORT || 4000;
    app.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`Server listening on http://localhost:${port}`);
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();


