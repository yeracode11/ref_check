/**
 * Разбирает merged-бэкап и пишет JSON-массивы для mongoimport (Extended JSON: $oid, $date).
 *
 *   node --max-old-space-size=8192 extract_for_mongoimport.js /path/to/backup.json ./import
 *
 * Затем (порядок важен):
 *   mongoimport --uri="$MONGODB_URI" --collection=cities   --drop --file=./import/cities.import.json   --jsonArray
 *   mongoimport --uri="$MONGODB_URI" --collection=fridges  --drop --file=./import/fridges.import.json  --jsonArray
 *   mongoimport --uri="$MONGODB_URI" --collection=checkins --drop --file=./import/checkins.import.json --jsonArray
 *   mongoimport --uri="$MONGODB_URI" --collection=counters --mode=upsert --upsertFields=_id --file=./import/counters.import.json --jsonArray
 *
 * Коллекции в Mongo: cities, fridges, checkins (как у Mongoose). users не трогаем.
 */

const fs = require('fs');
const path = require('path');

function isOid(s) {
  return typeof s === 'string' && /^[a-fA-F0-9]{24}$/.test(s);
}

function toExtOid(s) {
  return { $oid: s };
}

function toExtDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(s)) return s;
  return { $date: s };
}

function mapCity(c) {
  const o = { ...c };
  if (isOid(o._id)) o._id = toExtOid(o._id);
  if (o.createdAt) o.createdAt = toExtDate(o.createdAt);
  if (o.updatedAt) o.updatedAt = toExtDate(o.updatedAt);
  delete o.__v;
  return o;
}

function mapFridge(f) {
  const o = { ...f };
  if (isOid(o._id)) o._id = toExtOid(o._id);
  if (o.cityId && typeof o.cityId === 'object' && o.cityId._id != null) {
    o.cityId = toExtOid(String(o.cityId._id));
  } else if (isOid(o.cityId)) {
    o.cityId = toExtOid(o.cityId);
  }
  if (o.createdAt) o.createdAt = toExtDate(o.createdAt);
  if (o.updatedAt) o.updatedAt = toExtDate(o.updatedAt);
  delete o.__v;
  return o;
}

function mapCheckin(c) {
  const o = { ...c };
  if (isOid(o._id)) o._id = toExtOid(o._id);
  for (const k of ['visitedAt', 'createdAt', 'updatedAt']) {
    if (o[k]) o[k] = toExtDate(o[k]);
  }
  delete o.__v;
  return o;
}

function main() {
  const inPath = process.argv[2];
  const outDir = process.argv[3] || './mongoimport_out';
  if (!inPath || !fs.existsSync(inPath)) {
    console.error('Usage: node extract_for_mongoimport.js <backup.json> [outDir]');
    process.exit(1);
  }

  console.error('Reading JSON (нужно много RAM на больших бэкапах)...');
  const bundle = JSON.parse(fs.readFileSync(path.resolve(inPath), 'utf8'));
  if (!bundle.data) {
    console.error('Неверный формат: нет data');
    process.exit(1);
  }

  const { cities = [], fridges = [], checkins = [] } = bundle.data;

  const d = path.resolve(outDir);
  fs.mkdirSync(d, { recursive: true });

  console.error('Writing cities...');
  fs.writeFileSync(path.join(d, 'cities.import.json'), JSON.stringify(cities.map(mapCity)));

  console.error('Writing fridges...');
  fs.writeFileSync(path.join(d, 'fridges.import.json'), JSON.stringify(fridges.map(mapFridge)));

  console.error('Writing checkins...');
  fs.writeFileSync(path.join(d, 'checkins.import.json'), JSON.stringify(checkins.map(mapCheckin)));

  let maxCheckinId = 0;
  for (const c of checkins) {
    const n = typeof c.id === 'number' ? c.id : parseInt(c.id, 10);
    if (Number.isFinite(n) && n > maxCheckinId) maxCheckinId = n;
  }
  const counterDoc = [{ _id: 'checkin', seq: maxCheckinId }];
  fs.writeFileSync(path.join(d, 'counters.import.json'), JSON.stringify(counterDoc));

  console.error(`Done → ${d}`);
  console.error(`  cities: ${cities.length}, fridges: ${fridges.length}, checkins: ${checkins.length}, counter seq: ${maxCheckinId}`);
}

main();
