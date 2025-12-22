/**
 * Скрипт для удаления дубликатов холодильников
 * 
 * Использование:
 *   cd fridge-manager
 *   node remove_duplicate_fridges.js
 *   node remove_duplicate_fridges.js --confirm
 * 
 * Скрипт найдет и удалит дубликаты по коду холодильника,
 * оставляя самую старую запись (по дате создания)
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Fridge = require('./models/Fridge');
const Checkin = require('./models/Checkin');

async function removeDuplicates() {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/fridge_manager';
    console.log('🔌 Подключение к MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('✅ Подключено к MongoDB');

    // Находим все холодильники
    const allFridges = await Fridge.find({}).lean();
    console.log(`📊 Всего холодильников в базе: ${allFridges.length}`);

    // Группируем по коду
    const fridgesByCode = {};
    for (const fridge of allFridges) {
      const code = fridge.code;
      if (!fridgesByCode[code]) {
        fridgesByCode[code] = [];
      }
      fridgesByCode[code].push(fridge);
    }

    // Находим дубликаты (коды с более чем одним холодильником)
    const duplicates = {};
    for (const [code, fridges] of Object.entries(fridgesByCode)) {
      if (fridges.length > 1) {
        duplicates[code] = fridges;
      }
    }

    const duplicateCodes = Object.keys(duplicates);
    console.log(`🔍 Найдено ${duplicateCodes.length} кодов с дубликатами`);

    if (duplicateCodes.length === 0) {
      console.log('✅ Дубликатов не найдено!');
      await mongoose.disconnect();
      return;
    }

    // Показываем статистику
    let totalDuplicates = 0;
    for (const code of duplicateCodes) {
      const count = duplicates[code].length;
      totalDuplicates += count - 1; // -1 потому что один оставляем
      console.log(`  Код ${code}: ${count} записей`);
    }
    console.log(`\n📈 Всего будет удалено: ${totalDuplicates} дубликатов`);

    // Подтверждение
    console.log('\n⚠️  ВНИМАНИЕ: Это действие удалит дубликаты из базы данных!');
    console.log('   Для продолжения введите "yes":');
    
    // В интерактивном режиме можно использовать readline, но для простоты используем аргумент
    const args = process.argv.slice(2);
    if (args[0] !== '--confirm') {
      console.log('\n❌ Для безопасности скрипт требует подтверждения.');
      console.log('   Запустите с флагом --confirm для подтверждения:');
      console.log('   node remove_duplicate_fridges.js --confirm');
      await mongoose.disconnect();
      return;
    }

    console.log('\n🗑️  Удаление дубликатов...');

    let deleted = 0;
    let checkinsMoved = 0;

    for (const code of duplicateCodes) {
      const fridges = duplicates[code];
      
      // Сортируем по дате создания (самый старый первый)
      fridges.sort((a, b) => {
        const dateA = a.createdAt || a._id.getTimestamp();
        const dateB = b.createdAt || b._id.getTimestamp();
        return dateA - dateB;
      });

      // Оставляем первый (самый старый), удаляем остальные
      const keepFridge = fridges[0];
      const deleteFridges = fridges.slice(1);

      console.log(`\n  Код ${code}:`);
      console.log(`    Оставляем: ${keepFridge._id} (создан: ${keepFridge._id.getTimestamp()})`);

      for (const fridgeToDelete of deleteFridges) {
        console.log(`    Удаляем: ${fridgeToDelete._id} (создан: ${fridgeToDelete._id.getTimestamp()})`);

        // Перемещаем чек-ины от удаляемого холодильника к оставляемому
        const checkinsToMove = await Checkin.find({ fridgeId: fridgeToDelete._id.toString() });
        if (checkinsToMove.length > 0) {
          await Checkin.updateMany(
            { fridgeId: fridgeToDelete._id.toString() },
            { $set: { fridgeId: keepFridge._id.toString() } }
          );
          checkinsMoved += checkinsToMove.length;
          console.log(`      Перемещено чек-инов: ${checkinsToMove.length}`);
        }

        // Удаляем холодильник
        await Fridge.deleteOne({ _id: fridgeToDelete._id });
        deleted++;
      }
    }

    console.log('\n✅ Готово!');
    console.log(`   Удалено дубликатов: ${deleted}`);
    console.log(`   Перемещено чек-инов: ${checkinsMoved}`);
    
    // Финальная статистика
    const finalCount = await Fridge.countDocuments();
    console.log(`\n📊 Холодильников в базе после очистки: ${finalCount}`);

    await mongoose.disconnect();
    console.log('\n👋 Отключено от MongoDB');
  } catch (err) {
    console.error('❌ Ошибка:', err);
    process.exit(1);
  }
}

removeDuplicates();

