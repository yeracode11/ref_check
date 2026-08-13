/**
 * Проставляет locationAtDepot: заглушка в центре города для warehouse/returned.
 *
 *   node scripts/mark-depot-locations.js --dry-run
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
    const depotQuery = { warehouseStatus: { $in: ['warehouse', 'returned'] } };
    const fieldQuery = { warehouseStatus: { $in: ['installed', 'moved'] } };

    const [depotTotal, fieldTotal] = await Promise.all([
      Fridge.countDocuments(depotQuery),
      Fridge.countDocuments(fieldQuery),
    ]);

    console.log(`[mark-depot] warehouse/returned: ${depotTotal}, installed/moved: ${fieldTotal}, apply=${apply}`);

    if (apply) {
      const [depotRes, fieldRes] = await Promise.all([
        Fridge.updateMany(depotQuery, { $set: { locationAtDepot: true } }),
        Fridge.updateMany(fieldQuery, { $set: { locationAtDepot: false } }),
      ]);
      console.log('[mark-depot] updated depot:', depotRes.modifiedCount, 'field:', fieldRes.modifiedCount);
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
