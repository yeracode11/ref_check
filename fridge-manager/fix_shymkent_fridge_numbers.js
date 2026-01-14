const mongoose = require('mongoose');
require('dotenv').config();
const Fridge = require('./models/Fridge');
const City = require('./models/City');

/**
 * Скрипт для исправления номеров холодильников в Шымкенте
 * Находит холодильники по номерам и устанавливает их в поле number
 */
async function fixShymkentFridgeNumbers() {
  try {
    console.log('🔌 Подключение к MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✓ Подключено к MongoDB\n');

    // Номера, которые нужно исправить
    const targetNumbers = ['1080021005', '4083823028', '1080021107'];
    
    console.log('=== Исправление номеров холодильников ===');
    console.log(`Ищем холодильники с номерами: ${targetNumbers.join(', ')}\n`);

    let found = 0;
    let updated = 0;
    let notFound = [];

    for (const targetNumber of targetNumbers) {
      // Ищем холодильник по number
      let fridge = await Fridge.findOne({ number: targetNumber });
      
      if (fridge) {
        console.log(`✓ Найден холодильник с number="${targetNumber}":`);
        console.log(`  - ID: ${fridge._id}`);
        console.log(`  - code: ${fridge.code}`);
        console.log(`  - number: ${fridge.number}`);
        console.log(`  - name: ${fridge.name}`);
        
        // Проверяем, что number правильный
        if (fridge.number !== targetNumber) {
          await Fridge.findByIdAndUpdate(fridge._id, {
            $set: { number: targetNumber }
          });
          console.log(`  ✅ Обновлен: number установлен в "${targetNumber}"`);
          updated++;
        } else {
          console.log(`  ✓ number уже правильный`);
        }
        found++;
      } else {
        // Ищем по code
        fridge = await Fridge.findOne({ code: targetNumber });
        
        if (fridge) {
          console.log(`⚠ Найден холодильник с code="${targetNumber}", но без number:`);
          console.log(`  - ID: ${fridge._id}`);
          console.log(`  - code: ${fridge.code}`);
          console.log(`  - number: ${fridge.number || 'ОТСУТСТВУЕТ'}`);
          console.log(`  - name: ${fridge.name}`);
          
          // Устанавливаем number = code
          await Fridge.findByIdAndUpdate(fridge._id, {
            $set: { number: targetNumber }
          });
          console.log(`  ✅ Обновлен: number установлен в "${targetNumber}"`);
          found++;
          updated++;
        } else {
          // Ищем частичное совпадение
          const partialMatches = await Fridge.find({
            $or: [
              { number: { $regex: targetNumber } },
              { code: { $regex: targetNumber } },
              { name: { $regex: targetNumber } }
            ]
          }).limit(5);
          
          if (partialMatches.length > 0) {
            console.log(`⚠ Найдены похожие холодильники для "${targetNumber}":`);
            partialMatches.forEach(f => {
              console.log(`  - code: ${f.code}, number: ${f.number || 'НЕТ'}, name: ${f.name}`);
            });
            console.log(`  ⚠ Точного совпадения не найдено, пропускаем`);
          } else {
            console.log(`❌ Холодильник с номером "${targetNumber}" не найден`);
            notFound.push(targetNumber);
          }
        }
      }
      console.log('');
    }

    console.log('=== Результаты ===');
    console.log(`Найдено холодильников: ${found}`);
    console.log(`Обновлено: ${updated}`);
    if (notFound.length > 0) {
      console.log(`Не найдено: ${notFound.join(', ')}`);
      console.log(`\n⚠ Эти холодильники не найдены в базе. Возможно, их нужно импортировать из Excel.`);
    }

    await mongoose.connection.close();
    console.log('\n✅ Проверка завершена');

  } catch (error) {
    console.error('❌ Критическая ошибка:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Запуск скрипта
if (require.main === module) {
  fixShymkentFridgeNumbers()
    .then(() => {
      console.log('\n✅ Скрипт завершен успешно');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Скрипт завершен с ошибкой:', error);
      process.exit(1);
    });
}

module.exports = fixShymkentFridgeNumbers;

