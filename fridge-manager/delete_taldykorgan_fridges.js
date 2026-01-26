const mongoose = require('mongoose');
// Загружаем переменные окружения так же, как в других скриптах (например, backup_database.js)
require('dotenv').config();
const Fridge = require('./models/Fridge');
const Checkin = require('./models/Checkin');
const City = require('./models/City');

/**
 * Удаление всех холодильников только в городе Талдыкорган
 * ВАЖНО: Тараз не затрагивается.
 *
 * Использование на сервере:
 *   cd fridge-manager
 *   node delete_taldykorgan_fridges.js --confirm
 */

async function deleteTaldykorganFridges() {
  try {
    const args = process.argv.slice(2);
    if (!args.includes('--confirm')) {
      console.error('❌ Для удаления требуется флаг --confirm');
      console.error('   Использование: node delete_taldykorgan_fridges.js --confirm');
      process.exit(1);
    }

    console.log('🔌 Подключение к MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✓ Подключено к MongoDB\n');

    // Ищем ТОЛЬКО Талдыкорган (без Тараза)
    const nameVariants = ['Талдыкорган', 'Taldykorgan', 'Taldikorgan', 'Талдыкорған'];
    let city = null;

    for (const name of nameVariants) {
      city = await City.findOne({
        $or: [
          { name: name },
          { name: { $regex: new RegExp(name, 'i') } },
        ],
      });
      if (city) {
        console.log(`✓ Найден город: ${city.name} (${city.code})`);
        break;
      }
    }

    if (!city) {
      console.error('❌ Город Талдыкорган не найден в базе');
      const all = await City.find({}).lean();
      console.log('\nДоступные города:');
      all.forEach((c) => console.log(`  - ${c.name} (${c.code})`));
      await mongoose.connection.close();
      process.exit(1);
    }

    console.log(`\n📦 Поиск холодильников города "${city.name}"...`);
    const fridges = await Fridge.find({ cityId: city._id }).lean();
    console.log(`✓ Найдено холодильников: ${fridges.length}`);

    if (fridges.length === 0) {
      console.log('\n✅ В этом городе нет холодильников для удаления');
      await mongoose.connection.close();
      return;
    }

    // Собираем все коды/номера/ИНН для поиска чек-инов
    const fridgeIds = [];
    fridges.forEach((f) => {
      if (f.code) fridgeIds.push(f.code);
      if (f.number) fridgeIds.push(f.number);
      if (f.clientInfo?.inn) fridgeIds.push(f.clientInfo.inn);
    });

    console.log(`\n📝 Поиск отметок по ${fridgeIds.length} идентификаторам...`);
    const checkinCount = await Checkin.countDocuments({ fridgeId: { $in: fridgeIds } });
    console.log(`✓ Найдено отметок: ${checkinCount}`);

    console.log('\n⚠️  БУДЕТ УДАЛЕНО:');
    console.log(`   - ${fridges.length} холодильников из города "${city.name}"`);
    console.log(`   - ${checkinCount} отметок (чек-инов), связанных с ними`);
    console.log('   - Другие города (например, Тараз) НЕ затрагиваются');

    console.log('\n⏳ Удаление начнётся через 3 секунды (Ctrl+C чтобы отменить)...');
    await new Promise((resolve) => setTimeout(resolve, 3000));

    let deletedCheckins = 0;
    if (checkinCount > 0) {
      const res = await Checkin.deleteMany({ fridgeId: { $in: fridgeIds } });
      deletedCheckins = res.deletedCount || 0;
      console.log(`\n🗑️  Удалено отметок: ${deletedCheckins}`);
    }

    const fridgeRes = await Fridge.deleteMany({ cityId: city._id });
    const deletedFridges = fridgeRes.deletedCount || 0;
    console.log(`🗑️  Удалено холодильников: ${deletedFridges}`);

    console.log('\n✅ Удаление для города Талдыкорган завершено.');
    await mongoose.connection.close();
    console.log('✅ Соединение с MongoDB закрыто.');
  } catch (err) {
    console.error('❌ Ошибка при удалении холодильников Талдыкоргана:', err);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
    process.exit(1);
  }
}

deleteTaldykorganFridges();

