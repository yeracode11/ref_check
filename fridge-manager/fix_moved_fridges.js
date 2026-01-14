const mongoose = require('mongoose');
require('dotenv').config();
const Fridge = require('./models/Fridge');
const Checkin = require('./models/Checkin');

/**
 * Скрипт для исправления холодильников с warehouseStatus = 'moved'
 * 
 * После отключения черной метки, холодильники с warehouseStatus = 'moved'
 * больше не будут показываться черным цветом, но их статус можно обновить
 * на 'installed', если у них есть стабильные координаты.
 */
async function fixMovedFridges() {
  try {
    console.log('🔌 Подключение к MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✓ Подключено к MongoDB\n');

    // Находим все холодильники с warehouseStatus = 'moved'
    console.log('=== Поиск холодильников с warehouseStatus = "moved" ===');
    const movedFridges = await Fridge.find({ warehouseStatus: 'moved' })
      .select('_id code number name cityId location warehouseStatus');
    
    console.log(`✓ Найдено холодильников с статусом "moved": ${movedFridges.length}\n`);

    if (movedFridges.length === 0) {
      console.log('✅ Холодильников с статусом "moved" не найдено');
      await mongoose.connection.close();
      return;
    }

    // Показываем статистику
    console.log('=== Статистика ===');
    console.log(`Всего холодильников с warehouseStatus = "moved": ${movedFridges.length}\n`);

    // Для каждого холодильника проверяем последние отметки
    let updatedCount = 0;
    let skippedCount = 0;
    let noCheckinsCount = 0;

    for (let i = 0; i < movedFridges.length; i++) {
      const fridge = movedFridges[i];
      
      try {
        // Находим все отметки для этого холодильника (по code и number)
        const checkins = await Checkin.find({
          $or: [
            { fridgeId: fridge.code },
            { fridgeId: fridge.number }
          ]
        })
        .sort({ createdAt: -1 })
        .select('location createdAt')
        .limit(2);

        if (checkins.length === 0) {
          console.log(`⚠ [${i + 1}/${movedFridges.length}] ${fridge.name}`);
          console.log(`  code: ${fridge.code}, number: ${fridge.number || 'нет'}`);
          console.log(`  Нет отметок - оставляем warehouseStatus = "moved"`);
          noCheckinsCount++;
          continue;
        }

        if (checkins.length === 1) {
          // Только одна отметка - можно обновить на 'installed'
          await Fridge.findByIdAndUpdate(fridge._id, {
            $set: { warehouseStatus: 'installed' }
          });
          console.log(`✓ [${i + 1}/${movedFridges.length}] Обновлен: ${fridge.name}`);
          console.log(`  code: ${fridge.code}, number: ${fridge.number || 'нет'}`);
          console.log(`  Одна отметка - обновлен на warehouseStatus = "installed"`);
          updatedCount++;
          continue;
        }

        // Две или больше отметок - проверяем расстояние между последними двумя
        const lastLocation = checkins[0].location;
        const secondLastLocation = checkins[1].location;

        if (!lastLocation || !secondLastLocation || 
            !lastLocation.coordinates || !secondLastLocation.coordinates) {
          console.log(`⚠ [${i + 1}/${movedFridges.length}] ${fridge.name}`);
          console.log(`  code: ${fridge.code}, number: ${fridge.number || 'нет'}`);
          console.log(`  Некорректные координаты - пропущен`);
          skippedCount++;
          continue;
        }

        // Вычисляем расстояние между последними двумя координатами
        const [lng1, lat1] = lastLocation.coordinates;
        const [lng2, lat2] = secondLastLocation.coordinates;

        // Формула гаверсинуса для расчета расстояния в метрах
        const R = 6371000; // Радиус Земли в метрах
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distance = R * c;

        if (distance <= 50) {
          // Последние две отметки близко - местоположение стабилизировалось
          await Fridge.findByIdAndUpdate(fridge._id, {
            $set: { warehouseStatus: 'installed' }
          });
          console.log(`✓ [${i + 1}/${movedFridges.length}] Обновлен: ${fridge.name}`);
          console.log(`  code: ${fridge.code}, number: ${fridge.number || 'нет'}`);
          console.log(`  Расстояние между последними отметками: ${distance.toFixed(2)}м`);
          console.log(`  Местоположение стабилизировалось - обновлен на warehouseStatus = "installed"`);
          updatedCount++;
        } else {
          // Последние две отметки далеко - оставляем 'moved'
          console.log(`⚠ [${i + 1}/${movedFridges.length}] Пропущен: ${fridge.name}`);
          console.log(`  code: ${fridge.code}, number: ${fridge.number || 'нет'}`);
          console.log(`  Расстояние между последними отметками: ${distance.toFixed(2)}м`);
          console.log(`  Холодильник все еще перемещается - оставляем warehouseStatus = "moved"`);
          skippedCount++;
        }
      } catch (error) {
        console.error(`❌ [${i + 1}/${movedFridges.length}] Ошибка для ${fridge.name}:`, error.message);
        skippedCount++;
      }
    }

    console.log('\n=== Итоговая статистика ===');
    console.log(`✅ Обновлено на "installed": ${updatedCount}`);
    console.log(`⚠ Пропущено (все еще перемещается или нет данных): ${skippedCount}`);
    console.log(`📊 Без отметок: ${noCheckinsCount}`);
    console.log(`📈 Всего обработано: ${movedFridges.length}`);

    if (updatedCount > 0) {
      console.log('\n✅ Обработка завершена!');
      console.log('⚠ После обновления черные метки больше не будут показываться');
      console.log('⚠ Холодильники с warehouseStatus = "moved" останутся, но не будут черными');
    }

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
  fixMovedFridges()
    .then(() => {
      console.log('\n✅ Скрипт завершен успешно');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Скрипт завершен с ошибкой:', error);
      process.exit(1);
    });
}

module.exports = fixMovedFridges;
