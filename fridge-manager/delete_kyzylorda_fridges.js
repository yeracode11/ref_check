const mongoose = require('mongoose');
require('dotenv').config();
const Fridge = require('./models/Fridge');
const City = require('./models/City');
const Checkin = require('./models/Checkin');

/**
 * Скрипт для удаления всех холодильников Кызылорды
 * 
 * ВАЖНО: Это необратимая операция!
 * Удаляет:
 * - Все холодильники города Кызылорда
 * - Все связанные отметки (чек-ины) этих холодильников
 * 
 * Использование:
 *   node delete_kyzylorda_fridges.js --confirm
 */
async function deleteKyzylordaFridges() {
  try {
    console.log('🔌 Подключение к MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✓ Подключено к MongoDB\n');

    // Проверяем флаг подтверждения
    const args = process.argv.slice(2);
    if (!args.includes('--confirm')) {
      console.log('⚠ ВНИМАНИЕ: Этот скрипт удалит ВСЕ холодильники Кызылорды!');
      console.log('⚠ Это необратимая операция!');
      console.log('\nДля подтверждения запустите скрипт с флагом --confirm:');
      console.log('  node delete_kyzylorda_fridges.js --confirm\n');
      await mongoose.connection.close();
      process.exit(1);
    }

    // Находим город Кызылорда
    console.log('=== Поиск города Кызылорда ===');
    const kyzylordaCity = await City.findOne({
      $or: [
        { name: { $regex: /кызылорда|kyzylorda|қызылорда/i } },
        { code: { $regex: /кызылорда|kyzylorda|қызылорда/i } }
      ]
    });

    if (!kyzylordaCity) {
      // Если город не найден, выводим все города для справки
      const allCities = await City.find({});
      console.log('⚠ Город Кызылорда не найден. Доступные города:');
      allCities.forEach(city => {
        console.log(`  - ${city.name} (code: ${city.code}, ID: ${city._id})`);
      });
      await mongoose.connection.close();
      return;
    }

    console.log(`✓ Найден город: ${kyzylordaCity.name} (ID: ${kyzylordaCity._id})\n`);

    // Находим все холодильники Кызылорды
    console.log('=== Поиск холодильников Кызылорды ===');
    const fridges = await Fridge.find({ cityId: kyzylordaCity._id })
      .select('_id code number name');
    
    console.log(`✓ Найдено холодильников: ${fridges.length}\n`);

    if (fridges.length === 0) {
      console.log('✅ Холодильников Кызылорды не найдено');
      await mongoose.connection.close();
      return;
    }

    // Показываем первые 10 холодильников для подтверждения
    console.log('=== Первые 10 холодильников для удаления ===');
    fridges.slice(0, 10).forEach((f, i) => {
      console.log(`  ${i + 1}. ${f.name} (code: ${f.code}, number: ${f.number || 'нет'})`);
    });
    if (fridges.length > 10) {
      console.log(`  ... и еще ${fridges.length - 10} холодильников\n`);
    } else {
      console.log('');
    }

    // Подсчитываем связанные чек-ины
    console.log('=== Подсчет связанных отметок (чек-инов) ===');
    const fridgeIds = fridges.map(f => f._id.toString());
    const fridgeCodes = fridges.map(f => f.code);
    const fridgeNumbers = fridges.map(f => f.number).filter(n => n && n.trim() !== '');
    
    // Ищем чек-ины по fridgeId, code и number
    const checkinsByFridgeId = await Checkin.countDocuments({
      fridgeId: { $in: fridgeIds }
    });
    
    const checkinsByCode = await Checkin.countDocuments({
      fridgeId: { $in: fridgeCodes }
    });
    
    const checkinsByNumber = fridgeNumbers.length > 0 ? await Checkin.countDocuments({
      fridgeId: { $in: fridgeNumbers }
    }) : 0;

    // Общее количество уникальных чек-инов (может быть пересечение)
    const allCheckinFridgeIds = new Set();
    const checkins1 = await Checkin.find({ fridgeId: { $in: fridgeIds } }).select('_id');
    checkins1.forEach(c => allCheckinFridgeIds.add(c._id.toString()));
    
    const checkins2 = await Checkin.find({ fridgeId: { $in: fridgeCodes } }).select('_id');
    checkins2.forEach(c => allCheckinFridgeIds.add(c._id.toString()));
    
    if (fridgeNumbers.length > 0) {
      const checkins3 = await Checkin.find({ fridgeId: { $in: fridgeNumbers } }).select('_id');
      checkins3.forEach(c => allCheckinFridgeIds.add(c._id.toString()));
    }

    const totalCheckins = allCheckinFridgeIds.size;
    console.log(`✓ Найдено связанных отметок: ${totalCheckins}`);
    console.log(`  - По fridgeId: ${checkinsByFridgeId}`);
    console.log(`  - По code: ${checkinsByCode}`);
    console.log(`  - По number: ${checkinsByNumber}\n`);

    // Удаляем чек-ины
    console.log('=== Удаление связанных отметок ===');
    let deletedCheckins = 0;
    
    // Удаляем по fridgeId
    const result1 = await Checkin.deleteMany({ fridgeId: { $in: fridgeIds } });
    deletedCheckins += result1.deletedCount;
    
    // Удаляем по code
    const result2 = await Checkin.deleteMany({ fridgeId: { $in: fridgeCodes } });
    deletedCheckins += result2.deletedCount;
    
    // Удаляем по number
    if (fridgeNumbers.length > 0) {
      const result3 = await Checkin.deleteMany({ fridgeId: { $in: fridgeNumbers } });
      deletedCheckins += result3.deletedCount;
    }

    console.log(`✓ Удалено отметок: ${deletedCheckins}\n`);

    // Удаляем холодильники
    console.log('=== Удаление холодильников ===');
    const deleteResult = await Fridge.deleteMany({ cityId: kyzylordaCity._id });
    console.log(`✓ Удалено холодильников: ${deleteResult.deletedCount}\n`);

    console.log('=== Итоговая статистика ===');
    console.log(`✅ Удалено холодильников: ${deleteResult.deletedCount}`);
    console.log(`✅ Удалено отметок: ${deletedCheckins}`);
    console.log(`\n✅ Все холодильники Кызылорды успешно удалены!`);

    await mongoose.connection.close();
    console.log('\n✅ Скрипт завершен');

  } catch (error) {
    console.error('❌ Критическая ошибка:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Запуск скрипта
if (require.main === module) {
  deleteKyzylordaFridges()
    .then(() => {
      console.log('\n✅ Скрипт завершен успешно');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Скрипт завершен с ошибкой:', error);
      process.exit(1);
    });
}

module.exports = deleteKyzylordaFridges;
