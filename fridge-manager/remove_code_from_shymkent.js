const mongoose = require('mongoose');
require('dotenv').config();
const Fridge = require('./models/Fridge');
const City = require('./models/City');

/**
 * Скрипт для удаления поля code у холодильников Шымкента
 * 
 * Логика:
 * 1. Если code <= 4 символа - удаляем code (оставляем только number)
 * 2. Если code > 4 символов - копируем code в number и удаляем code
 * 
 * ВАЖНО: code - обязательное поле в схеме, поэтому мы не можем его полностью удалить.
 * Вместо этого установим code в пустую строку или минимальное значение.
 * Но лучше оставить code как служебное поле (для внутренней работы),
 * а в интерфейсе уже не показываем code для Шымкента.
 * 
 * Однако, если пользователь хочет полностью удалить code, можно:
 * - Установить code в какое-то служебное значение (например, "SHYMKENT_" + number)
 * - Или оставить code как есть, но просто не использовать его в интерфейсе
 * 
 * Но пользователь явно просит удалить code. Проверим схему - если code required,
 * то нужно будет установить его в какое-то значение.
 */
async function removeCodeFromShymkent() {
  try {
    console.log('🔌 Подключение к MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✓ Подключено к MongoDB\n');

    // Находим город Шымкент
    console.log('=== Поиск города Шымкент ===');
    const shymkentCity = await City.findOne({
      $or: [
        { name: { $regex: /шымкент|shymkent/i } },
        { code: { $regex: /шымкент|shymkent/i } }
      ]
    });

    if (!shymkentCity) {
      console.log('❌ Город Шымкент не найден');
      await mongoose.connection.close();
      return;
    }

    console.log(`✓ Найден город: ${shymkentCity.name} (ID: ${shymkentCity._id})\n`);

    // Находим все холодильники Шымкента
    console.log('=== Поиск холодильников Шымкента ===');
    const fridges = await Fridge.find({ cityId: shymkentCity._id })
      .select('code number name');
    
    console.log(`✓ Найдено холодильников: ${fridges.length}\n`);

    if (fridges.length === 0) {
      console.log('⚠ Холодильников не найдено');
      await mongoose.connection.close();
      return;
    }

    // Группируем по длине code
    const shortCodeFridges = fridges.filter(f => {
      const codeStr = String(f.code || '');
      return codeStr.length > 0 && codeStr.length <= 4;
    });

    const longCodeFridges = fridges.filter(f => {
      const codeStr = String(f.code || '');
      return codeStr.length > 4;
    });

    console.log('=== Статистика ===');
    console.log(`Всего холодильников: ${fridges.length}`);
    console.log(`С коротким code (1-4 символа): ${shortCodeFridges.length}`);
    console.log(`С длинным code (>4 символов): ${longCodeFridges.length}\n`);

    let updatedShort = 0;
    let updatedLong = 0;
    let errors = 0;

    // Обрабатываем холодильники с коротким code (1-4 символа)
    console.log('=== Обработка холодильников с коротким code (1-4 символа) ===');
    console.log('Удаляем code, оставляем только number\n');

    for (let i = 0; i < shortCodeFridges.length; i++) {
      const fridge = shortCodeFridges[i];
      
      try {
        // Проверяем, есть ли number
        if (!fridge.number || fridge.number.trim() === '') {
          console.log(`⚠ [${i + 1}/${shortCodeFridges.length}] Пропущен: ${fridge.name}`);
          console.log(`  code: #${fridge.code}, number: ОТСУТСТВУЕТ`);
          console.log(`  ⚠ У холодильника нет number! Нужно заполнить number из Excel.`);
          continue;
        }

        // Удаляем короткий code, используем number как code
        // Поскольку code - обязательное поле, используем number как code
        // Это позволит сохранить уникальность и не показывать code в интерфейсе
        const newCode = fridge.number;
        
        await Fridge.findByIdAndUpdate(fridge._id, {
          $set: { code: newCode }
        });

        console.log(`✓ [${i + 1}/${shortCodeFridges.length}] Обновлен: ${fridge.name}`);
        console.log(`  Старый code: #${fridge.code} -> Удален (теперь code = number)`);
        console.log(`  number: ${fridge.number}`);
        console.log(`  code теперь равен number (не показывается в интерфейсе)`);
        updatedShort++;
      } catch (error) {
        console.error(`❌ [${i + 1}/${shortCodeFridges.length}] Ошибка: ${error.message}`);
        errors++;
      }
    }

    // Обрабатываем холодильники с длинным code (>4 символов)
    console.log('\n=== Обработка холодильников с длинным code (>4 символов) ===');
    console.log('Копируем code в number, затем удаляем code\n');

    for (let i = 0; i < longCodeFridges.length; i++) {
      const fridge = longCodeFridges[i];
      
      try {
        const codeStr = String(fridge.code || '');
        
        // Копируем code в number (если number еще не заполнен)
        const newNumber = fridge.number && fridge.number.trim() !== '' 
          ? fridge.number  // Если number уже есть, оставляем его
          : codeStr;       // Иначе копируем code в number

        // Устанавливаем code равным number (чтобы не показывать code в интерфейсе)
        const newCode = newNumber;

        await Fridge.findByIdAndUpdate(fridge._id, {
          $set: { 
            code: newCode,
            number: newNumber
          }
        });

        console.log(`✓ [${i + 1}/${longCodeFridges.length}] Обновлен: ${fridge.name}`);
        console.log(`  Старый code: ${codeStr} -> Удален (теперь code = number)`);
        console.log(`  number: ${newNumber}`);
        console.log(`  code теперь равен number (не показывается в интерфейсе)`);
        if (fridge.number && fridge.number.trim() !== '') {
          console.log(`  ⚠ number уже был заполнен, оставлен прежним`);
        }
        updatedLong++;
      } catch (error) {
        console.error(`❌ [${i + 1}/${longCodeFridges.length}] Ошибка: ${error.message}`);
        errors++;
      }
    }

    console.log('\n=== Итоговая статистика ===');
    console.log(`✅ Обновлено с коротким code: ${updatedShort}`);
    console.log(`✅ Обновлено с длинным code: ${updatedLong}`);
    console.log(`❌ Ошибок: ${errors}`);
    console.log(`📊 Всего обработано: ${updatedShort + updatedLong}`);

    if (updatedShort + updatedLong > 0) {
      console.log('\n✅ Обработка завершена!');
      console.log('⚠ Поле code теперь равно number (для сохранения уникальности в базе)');
      console.log('⚠ В интерфейсе code уже не показывается для Шымкента');
      console.log('⚠ Все номера теперь в поле number, code используется только внутренне');
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
  removeCodeFromShymkent()
    .then(() => {
      console.log('\n✅ Скрипт завершен успешно');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Скрипт завершен с ошибкой:', error);
      process.exit(1);
    });
}

module.exports = removeCodeFromShymkent;

