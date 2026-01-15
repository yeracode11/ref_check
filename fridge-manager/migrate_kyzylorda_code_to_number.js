const mongoose = require('mongoose');
require('dotenv').config();
const Fridge = require('./models/Fridge');
const City = require('./models/City');

/**
 * Скрипт для миграции кодов холодильников Кызылорды
 * 
 * Логика (как для Шымкента):
 * 1. Если code <= 4 символа и есть number - устанавливаем code = number
 * 2. Если code > 4 символов:
 *    - Если есть number - устанавливаем code = number
 *    - Если нет number - копируем code в number, затем устанавливаем code = number
 * 
 * ВАЖНО: code - обязательное поле в схеме, поэтому устанавливаем code = number
 * для сохранения уникальности в базе. В интерфейсе code уже не показывается для Кызылорды.
 */
async function migrateKyzylordaCodeToNumber() {
  try {
    console.log('🔌 Подключение к MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✓ Подключено к MongoDB\n');

    // Находим город Кызылорда
    console.log('=== Поиск города Кызылорда ===');
    const kyzylordaCity = await City.findOne({
      $or: [
        { name: { $regex: /кызылорда|kyzylorda|қызылорда/i } },
        { code: { $regex: /кызылорда|kyzylorda|қызылорда/i } }
      ]
    });

    if (!kyzylordaCity) {
      console.log('❌ Город Кызылорда не найден');
      await mongoose.connection.close();
      return;
    }

    console.log(`✓ Найден город: ${kyzylordaCity.name} (ID: ${kyzylordaCity._id})\n`);

    // Находим все холодильники Кызылорды
    console.log('=== Поиск холодильников Кызылорды ===');
    const fridges = await Fridge.find({ cityId: kyzylordaCity._id })
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
    let skipped = 0;
    let errors = 0;

    // Обрабатываем холодильники с коротким code (1-4 символа)
    console.log('=== Обработка холодильников с коротким code (1-4 символа) ===');
    console.log('Устанавливаем code = number\n');

    for (let i = 0; i < shortCodeFridges.length; i++) {
      const fridge = shortCodeFridges[i];
      
      try {
        // Проверяем, есть ли number
        if (!fridge.number || fridge.number.trim() === '') {
          console.log(`⚠ [${i + 1}/${shortCodeFridges.length}] Пропущен: ${fridge.name}`);
          console.log(`  code: #${fridge.code}, number: ОТСУТСТВУЕТ`);
          console.log(`  ⚠ У холодильника нет number! Нужно заполнить number из Excel.`);
          skipped++;
          continue;
        }

        // Устанавливаем code = number
        const newCode = fridge.number;
        
        await Fridge.findByIdAndUpdate(fridge._id, {
          $set: { code: newCode }
        });

        console.log(`✓ [${i + 1}/${shortCodeFridges.length}] Обновлен: ${fridge.name}`);
        console.log(`  Старый code: #${fridge.code} -> Новый code: ${newCode}`);
        console.log(`  number: ${fridge.number}`);
        console.log(`  code теперь равен number (как для Шымкента)`);
        updatedShort++;
      } catch (error) {
        console.error(`❌ [${i + 1}/${shortCodeFridges.length}] Ошибка: ${error.message}`);
        errors++;
      }
    }

    // Обрабатываем холодильники с длинным code (>4 символов)
    console.log('\n=== Обработка холодильников с длинным code (>4 символов) ===');
    console.log('Устанавливаем code = number (копируем code в number, если number отсутствует)\n');

    for (let i = 0; i < longCodeFridges.length; i++) {
      const fridge = longCodeFridges[i];
      
      try {
        const codeStr = String(fridge.code || '');
        
        // Определяем number: если уже есть, используем его, иначе копируем code
        const newNumber = fridge.number && fridge.number.trim() !== '' 
          ? fridge.number  // Если number уже есть, оставляем его
          : codeStr;       // Иначе копируем code в number

        // Устанавливаем code = number
        const newCode = newNumber;

        await Fridge.findByIdAndUpdate(fridge._id, {
          $set: { 
            code: newCode,
            number: newNumber
          }
        });

        console.log(`✓ [${i + 1}/${longCodeFridges.length}] Обновлен: ${fridge.name}`);
        console.log(`  Старый code: ${codeStr.substring(0, 50)}${codeStr.length > 50 ? '...' : ''}`);
        console.log(`  Новый code: ${newCode.substring(0, 50)}${newCode.length > 50 ? '...' : ''}`);
        console.log(`  number: ${newNumber.substring(0, 50)}${newNumber.length > 50 ? '...' : ''}`);
        console.log(`  code теперь равен number (как для Шымкента)`);
        if (fridge.number && fridge.number.trim() !== '') {
          console.log(`  ⚠ number уже был заполнен, оставлен прежним`);
        } else {
          console.log(`  ⚠ number был скопирован из code`);
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
    console.log(`⚠ Пропущено (нет number): ${skipped}`);
    console.log(`❌ Ошибок: ${errors}`);
    console.log(`📊 Всего обработано: ${updatedShort + updatedLong}`);

    if (updatedShort + updatedLong > 0) {
      console.log('\n✅ Обработка завершена!');
      console.log('⚠ Поле code теперь равно number (для сохранения уникальности в базе)');
      console.log('⚠ В интерфейсе code уже не показывается для Кызылорды');
      console.log('⚠ Все номера теперь в поле number, code используется только внутренне');
    }

    if (skipped > 0) {
      console.log(`\n⚠ ВНИМАНИЕ: ${skipped} холодильников пропущено, так как у них нет поля number.`);
      console.log('⚠ Для этих холодильников нужно заполнить number из Excel файла.');
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
  migrateKyzylordaCodeToNumber()
    .then(() => {
      console.log('\n✅ Скрипт завершен успешно');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Скрипт завершен с ошибкой:', error);
      process.exit(1);
    });
}

module.exports = migrateKyzylordaCodeToNumber;
