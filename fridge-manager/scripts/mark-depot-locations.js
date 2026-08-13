/**
 * locationAtDepot=true для «на складе» и «возврат» без отметки (скрыты на карте).
 * После отметки МХО checkinService ставит locationAtDepot=false.
 *
 *   node scripts/mark-depot-locations.js --apply
 */
const path = require('path');
const fs = require('fs');

function loadMongoUri() {
  const envFile = process.env.ENV_FILE || path.join(__dirname, '..', '.env');
  if (fs.existsSync(envFile)) {
    require('dotenv').config({ path: envFile });
  }
  return process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/fridge_manager';
}

async function main() {
  const apply = process.argv.includes('--apply');
  const mongoose = require('mongoose');
  const Fridge = require('../models/Fridge');

  await mongoose.connect(loadMongoUri());

  try {
    const [depot, field] = await Promise.all([
      Fridge.countDocuments({ warehouseStatus: { $in: ['warehouse', 'returned'] } }),
      Fridge.countDocuments({ warehouseStatus: { $in: ['installed', 'moved'] } }),
    ]);

    console.log(`[mark-depot] warehouse+returned=${depot} field=${field} apply=${apply}`);

    if (apply) {
      const [depotRes, fieldRes] = await Promise.all([
        Fridge.updateMany(
          { warehouseStatus: { $in: ['warehouse', 'returned'] }, locationAtDepot: { $ne: false } },
          { $set: { locationAtDepot: true } },
        ),
        Fridge.updateMany(
          { warehouseStatus: { $in: ['installed', 'moved'] } },
          { $set: { locationAtDepot: false } },
        ),
      ]);
      console.log('[mark-depot] marked depot (no check-in yet):', depotRes.modifiedCount);
      console.log('[mark-depot] field statuses:', fieldRes.modifiedCount);
    } else {
      console.log('[mark-depot] Dry-run — добавьте --apply');
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
