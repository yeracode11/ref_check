const mongoose = require('mongoose');
require('dotenv').config();
const Fridge = require('./models/Fridge');
const Checkin = require('./models/Checkin');
const City = require('./models/City');

/**
 * Скрипт для миграции холодильников Шымкента:
 * - Сохраняет все отметки (check-ins)
 * - Обновляет fridgeId в check-ins с code на number (для Шымкента)
 * - Убеждается, что у всех холодильников Шымкента есть поле number
 */
async function migrateShymkentToNumber() {
  try {
    console.log('🔌 Подключение к MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✓ Подключено к MongoDB\n');

    // 1. Находим город Шымкент
    console.log('=== Поиск города Шымкент ===');
    const shymkentCity = await City.findOne({
      name: { $regex: /шымкент|shymkent/i }
    });

    if (!shymkentCity) {
      console.log('❌ Город Шымкент не найден');
      await mongoose.connection.close();
      return;
    }

    console.log(`✓ Найден город: ${shymkentCity.name} (ID: ${shymkentCity._id})\n`);

    // 2. Находим все холодильники Шымкента
    console.log('=== Поиск холодильников Шымкента ===');
    const shymkentFridges = await Fridge.find({ cityId: shymkentCity._id });
    console.log(`✓ Найдено холодильников: ${shymkentFridges.length}\n`);

    if (shymkentFridges.length === 0) {
      console.log('⚠ Нет холодильников для миграции');
      await mongoose.connection.close();
      return;
    }

    // 3. Статистика
    let updatedCheckins = 0;
    let skippedNoNumber = 0;
    let skippedNoCheckins = 0;
    let errors = 0;

    // 4. Обрабатываем каждый холодильник
    console.log('=== Миграция данных ===');
    for (let i = 0; i < shymkentFridges.length; i++) {
      const fridge = shymkentFridges[i];
      
      try {
        // Проверяем, есть ли number
        if (!fridge.number) {
          console.log(`⚠ Холодильник #${fridge.code} (${fridge.name}): нет поля number, пропускаем`);
          skippedNoNumber++;
          continue;
        }

        // Находим все check-ins для этого холодильника (по старому code)
        const checkins = await Checkin.find({ fridgeId: fridge.code });
        
        if (checkins.length === 0) {
          console.log(`✓ Холодильник #${fridge.code} (${fridge.name}): нет отметок`);
          skippedNoCheckins++;
          continue;
        }

        // Обновляем fridgeId в check-ins с code на number
        const result = await Checkin.updateMany(
          { fridgeId: fridge.code },
          { $set: { fridgeId: fridge.number } }
        );

        if (result.modifiedCount > 0) {
          console.log(`✓ Холодильник #${fridge.code} (${fridge.name}): обновлено ${result.modifiedCount} отметок (code: ${fridge.code} -> number: ${fridge.number})`);
          updatedCheckins += result.modifiedCount;
        } else {
          console.log(`⚠ Холодильник #${fridge.code} (${fridge.name}): отметки не обновлены (возможно, уже обновлены)`);
        }

      } catch (error) {
        console.error(`❌ Ошибка при обработке холодильника #${fridge.code}: ${error.message}`);
        errors++;
      }
    }

    // 5. Итоговая статистика
    console.log('\n=== Результаты миграции ===');
    console.log(`✓ Всего холодильников: ${shymkentFridges.length}`);
    console.log(`✓ Обновлено отметок: ${updatedCheckins}`);
    console.log(`⚠ Пропущено (нет number): ${skippedNoNumber}`);
    console.log(`⚠ Пропущено (нет отметок): ${skippedNoCheckins}`);
    console.log(`❌ Ошибок: ${errors}`);

    // 6. Проверяем, что все отметки обновлены
    console.log('\n=== Проверка результатов ===');
    const checkinsWithCode = await Checkin.find({ 
      fridgeId: { $in: shymkentFridges.map(f => f.code) }
    });
    
    if (checkinsWithCode.length > 0) {
      console.log(`⚠ Внимание: найдено ${checkinsWithCode.length} отметок, которые всё ещё используют code вместо number`);
      console.log('   Это может быть нормально, если холодильники были созданы после миграции');
    } else {
      console.log('✓ Все отметки успешно обновлены на использование number');
    }

    await mongoose.connection.close();
    console.log('\n✅ Миграция завершена');

  } catch (error) {
    console.error('❌ Критическая ошибка:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Запуск скрипта
if (require.main === module) {
  migrateShymkentToNumber()
    .then(() => {
      console.log('\n✅ Скрипт завершен успешно');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Скрипт завершен с ошибкой:', error);
      process.exit(1);
    });
}

module.exports = migrateShymkentToNumber;

