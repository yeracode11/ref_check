/**
 * Состояние подключения к MongoDB и быстрые ответы, если БД недоступна.
 */

const MONGO_READY = 1;

function isMongoConnected(mongoose) {
  return mongoose.connection.readyState === MONGO_READY;
}

function isMongoNetworkError(err) {
  if (!err) return false;
  const name = err.name || '';
  if (
    name === 'MongoServerSelectionError' ||
    name === 'MongoNetworkError' ||
    name === 'MongoNetworkTimeoutError'
  ) {
    return true;
  }
  const msg = String(err.message || '');
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|connect ECONNREFUSED/i.test(msg)) {
    return true;
  }
  const cause = err.cause;
  if (cause && cause.code === 'ECONNREFUSED') return true;
  return false;
}

function mongoUnavailablePayload() {
  return {
    error: 'База данных недоступна',
    details:
      'MongoDB не отвечает (127.0.0.1:27017). Запустите: sudo systemctl start mongod && pm2 restart fridge-manager',
    code: 'MONGO_UNAVAILABLE',
  };
}

function sendMongoUnavailable(res) {
  return res.status(503).json(mongoUnavailablePayload());
}

function mapMongoErrorResponse(err, res, fallbackMessage = 'Database error') {
  if (isMongoNetworkError(err)) {
    return sendMongoUnavailable(res);
  }
  return res.status(500).json({ error: fallbackMessage, details: err.message });
}

function setupMongoConnectionMonitoring(mongoose) {
  const conn = mongoose.connection;

  conn.on('disconnected', () => {
    console.error('[MongoDB] disconnected — API will return 503 until reconnect');
  });

  conn.on('error', (err) => {
    console.error('[MongoDB] connection error:', err.message || err);
  });

  conn.on('reconnected', () => {
    console.log('[MongoDB] reconnected');
  });
}

/**
 * Express: 503 сразу, если MongoDB не в состоянии connected (без ожидания 30 с).
 */
function requireMongoMiddleware(mongoose) {
  return (req, res, next) => {
    if (isMongoConnected(mongoose)) {
      next();
      return;
    }
    sendMongoUnavailable(res);
  };
}

module.exports = {
  isMongoConnected,
  isMongoNetworkError,
  mongoUnavailablePayload,
  sendMongoUnavailable,
  mapMongoErrorResponse,
  setupMongoConnectionMonitoring,
  requireMongoMiddleware,
};
