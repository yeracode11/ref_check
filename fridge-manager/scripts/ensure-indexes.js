#!/usr/bin/env node
/**
 * Создаёт performance-индексы в MongoDB (идempotent).
 * Запуск на сервере: node scripts/ensure-indexes.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Fridge = require('../models/Fridge');
const Checkin = require('../models/Checkin');

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/fridge_manager';
  await mongoose.connect(uri);
  console.log('[ensure-indexes] connected');

  await Fridge.syncIndexes();
  console.log('[ensure-indexes] Fridge indexes synced');

  await Checkin.syncIndexes();
  console.log('[ensure-indexes] Checkin indexes synced');

  await mongoose.disconnect();
  console.log('[ensure-indexes] done');
}

main().catch((err) => {
  console.error('[ensure-indexes] failed:', err);
  process.exit(1);
});
