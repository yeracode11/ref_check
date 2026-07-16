/**
 * Удаление дублей отметок в городе.
 *
 *   node scripts/remove-duplicate-checkins.js --city "Балхаш" --today --dry-run
 *   node scripts/remove-duplicate-checkins.js --city-id 6a55bb7f4696659778b7242e --date 2026-07-16 --apply
 *
 * MONGODB_URI из .env в fridge-manager/ или ENV_FILE=/path/.env
 */
const path = require('path');
const fs = require('fs');

function loadMongoUri() {
  const envFile = process.env.ENV_FILE || path.join(__dirname, '..', '.env');
  if (fs.existsSync(envFile)) {
    require('dotenv').config({ path: envFile });
  }
  if (!process.env.MONGODB_URI && !process.env.MONGO_URI && fs.existsSync(envFile)) {
    const text = fs.readFileSync(envFile, 'utf8');
    const line = text.split('\n').find((l) => /^\s*MONGODB_URI=/.test(l));
    if (line) {
      let val = line.split('=').slice(1).join('=').trim();
      val = val.replace(/^["']|["']$/g, '');
      process.env.MONGODB_URI = val;
    }
  }
  return process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/fridge_manager';
}

function parseArgs(argv) {
  const args = { dryRun: true, city: null, cityId: null, date: null, today: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.dryRun = false;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--today') args.today = true;
    else if (a === '--city' && argv[i + 1]) { args.city = argv[++i]; }
    else if (a === '--city-id' && argv[i + 1]) { args.cityId = argv[++i]; }
    else if (a === '--date' && argv[i + 1]) { args.date = argv[++i]; }
  }
  if (!args.city && !args.cityId) args.city = 'Балхаш';
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const mongoUri = loadMongoUri();
  const mongoose = require('mongoose');
  const { deduplicateCityCheckins } = require('../lib/deduplicateCheckins');
  const { invalidateCheckinStatsCache } = require('../lib/checkinStatsCache');

  console.log(`[dedupe] dryRun=${args.dryRun} city="${args.city || ''}" cityId=${args.cityId || '(auto)'}`);

  await mongoose.connect(mongoUri);

  try {
    const result = await deduplicateCityCheckins({
      cityName: args.city,
      cityId: args.cityId,
      date: args.date,
      today: args.today,
      dryRun: args.dryRun,
    });

    console.log(`[dedupe] Город: ${result.city.name} (${result.city.id})`);
    if (result.dateKey) console.log(`[dedupe] Дата: ${result.dateKey} (Asia/Almaty)`);
    console.log(`[dedupe] В выборке: ${result.totalInScope}, уникальных: ${result.keptCount}, дублей: ${result.duplicateCount}`);

    if (result.duplicates.length) {
      console.log('[dedupe] Дубли:');
      result.duplicates.forEach((d) => {
        console.log(
          `  id=${d.id} ${new Date(d.visitedAt).toISOString()} fridge=${d.fridgeId} mgr=${d.managerId} → оставляем id=${d.keeperId}`,
        );
      });
    }

    if (args.dryRun && result.duplicateCount > 0) {
      console.log('[dedupe] Dry-run — добавьте --apply для удаления.');
    } else if (!args.dryRun && result.deletedCount > 0) {
      invalidateCheckinStatsCache();
      console.log(`[dedupe] Удалено: ${result.deletedCount}`);
    }
  } catch (err) {
    if (err.cities) {
      console.error(`[dedupe] ${err.message}`);
      err.cities.forEach((c) => console.error(`  - ${c.name} (${c.code})`));
      process.exit(1);
    }
    throw err;
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[dedupe] Ошибка:', err);
  process.exit(1);
});
