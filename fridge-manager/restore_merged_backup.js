/**
 * Восстановление из одного JSON-файла формата:
 * { "version": "1.0", "data": { "cities": [...], "fridges": [...], "checkins": [...] } }
 *
 * Использование:
 *   MONGODB_URI=mongodb://localhost:27017/fridge_manager \
 *   node restore_merged_backup.js /path/to/backup-2026-....json --drop
 *
 * --drop  — перед вставкой очистить коллекции cities, fridges, checkins и счётчик checkin
 *           (пользователей users не трогаем).
 *
 * Для больших файлов (~50k+ чекинов) при нехватке памяти:
 *   node --max-old-space-size=8192 restore_merged_backup.js ...
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config();

const City = require('./models/City');
const Fridge = require('./models/Fridge');
const Checkin = require('./models/Checkin');
const { Counter } = require('./models/Counter');

const BATCH = 500;

function toOid(id) {
  if (!id) return id;
  if (id instanceof mongoose.Types.ObjectId) return id;
  const s = typeof id === 'string' ? id : String(id);
  if (!mongoose.Types.ObjectId.isValid(s)) return null;
  return new mongoose.Types.ObjectId(s);
}

function normalizeCity(doc) {
  const o = { ...doc };
  const oid = toOid(o._id);
  if (!oid) throw new Error(`Invalid city _id: ${o._id}`);
  o._id = oid;
  delete o.__v;
  return o;
}

function normalizeFridge(doc) {
  const o = { ...doc };
  const oid = toOid(o._id);
  if (!oid) throw new Error(`Invalid fridge _id: ${o._id}`);
  o._id = oid;
  if (o.cityId && typeof o.cityId === 'object' && o.cityId._id != null) {
    o.cityId = toOid(o.cityId._id);
  } else {
    o.cityId = toOid(o.cityId);
  }
  if (!o.cityId) throw new Error(`Fridge ${doc.code}: invalid cityId`);
  delete o.__v;
  return o;
}

function normalizeCheckin(doc) {
  const o = { ...doc };
  const oid = toOid(o._id);
  if (!oid) throw new Error(`Invalid checkin _id: ${o._id}`);
  o._id = oid;
  if (o.visitedAt) o.visitedAt = new Date(o.visitedAt);
  if (o.createdAt) o.createdAt = new Date(o.createdAt);
  if (o.updatedAt) o.updatedAt = new Date(o.updatedAt);
  delete o.__v;
  return o;
}

async function insertBatches(Model, label, docs, normalize) {
  let inserted = 0;
  for (let i = 0; i < docs.length; i += BATCH) {
    const chunk = docs.slice(i, i + BATCH).map(normalize);
    await Model.insertMany(chunk, { ordered: false });
    inserted += chunk.length;
    if (inserted % (BATCH * 20) === 0 || inserted === docs.length) {
      console.log(`  ${label}: ${inserted} / ${docs.length}`);
    }
  }
  console.log(`✓ ${label}: всего ${inserted}`);
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--drop');
  const doDrop = process.argv.includes('--drop');
  const filePath = args[0];

  if (!filePath || !fs.existsSync(filePath)) {
    console.error('Укажите путь к JSON-файлу бэкапа.');
    console.error('Пример: node restore_merged_backup.js ./backup.json --drop');
    process.exit(1);
  }

  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/fridge_manager';
  console.log('Подключение:', mongoUri.replace(/\/\/[^:]+:[^@]+@/, '//***@'));
  await mongoose.connect(mongoUri);

  console.log('Чтение JSON (может занять минуту и много RAM)...');
  const raw = fs.readFileSync(path.resolve(filePath), 'utf8');
  const bundle = JSON.parse(raw);

  if (!bundle.data) {
    console.error('Неверный формат: нет поля data');
    process.exit(1);
  }

  const { cities = [], fridges = [], checkins = [] } = bundle.data;

  console.log('\nВ файле:');
  console.log(`  cities: ${cities.length}, fridges: ${fridges.length}, checkins: ${checkins.length}`);
  if (!bundle.data.users) {
    console.log('  (users в файле нет — учётные записи в Mongo не меняются)');
  }

  if (doDrop) {
    console.log('\n--drop: очистка коллекций checkins, fridges, cities, counters(checkin)...');
    await Checkin.deleteMany({});
    await Fridge.deleteMany({});
    await City.deleteMany({});
    await Counter.deleteOne({ _id: 'checkin' });
  }

  console.log('\nВставка cities...');
  await insertBatches(City, 'cities', cities, normalizeCity);

  console.log('\nВставка fridges...');
  await insertBatches(Fridge, 'fridges', fridges, normalizeFridge);

  console.log('\nВставка checkins...');
  await insertBatches(Checkin, 'checkins', checkins, normalizeCheckin);

  const maxCheckinId = checkins.reduce((m, c) => {
    const n = typeof c.id === 'number' ? c.id : parseInt(c.id, 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);

  if (maxCheckinId > 0) {
    await Counter.findOneAndUpdate(
      { _id: 'checkin' },
      { $set: { seq: maxCheckinId } },
      { upsert: true }
    );
    console.log(`\n✓ Counter checkin seq = ${maxCheckinId} (следующая отметка получит id ${maxCheckinId + 1})`);
  }

  await mongoose.connection.close();
  console.log('\nГотово.');
}

main().catch((err) => {
  console.error(err);
  mongoose.connection.close().catch(() => {});
  process.exit(1);
});
