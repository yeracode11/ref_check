const mongoose = require('mongoose');
require('dotenv').config();
const Fridge = require('./models/Fridge');
const City = require('./models/City');

/**
 * Скрипт для обновления существующих холодильников Талдыкоргана
 * Устанавливает code = number для холодильников, у которых есть number
 * 
 * Использование:
 *   node migrate_taldykorgan_codes.js
 */

async function migrateTaldykorganCodes() {
  try {
    console.log('🔌 Подключение к MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✓ Подключено к MongoDB\n');

    // Ищем город Талдыкорган
    const cityNames = ['Талдыкорган', 'Талдыкорған', 'Taldykorgan', 'Taldikorgan'];
    let city = null;
    
    for (const name of cityNames) {
      city = await City.findOne({ 
        $or: [
          { name: name },
          { name: { $regex: new RegExp(name, 'i') } }
        ]
      });
      if (city) {
        console.log(`✓ Найден город: ${city.name} (${city.code})`);
        break;
      }
    }

    if (!city) {
      console.error('❌ Город Талдыкорган не найден в базе данных');
      await mongoose.connection.close();
      process.exit(1);
    }

    // Находим все холодильники Талдыкоргана
    const fridges = await Fridge.find({ cityId: city._id });
    console.log(`\n📊 Найдено холодильников в Талдыкоргане: ${fridges.length}`);

    if (fridges.length === 0) {
      console.log('ℹ️ В Талдыкоргане нет холодильников');
      await mongoose.connection.close();
      return;
    }

    // Обновляем холодильники, у которых есть number, но code != number
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const fridge of fridges) {
      try {
        // Если есть number и code != number, обновляем code
        if (fridge.number && fridge.code !== fridge.number) {
          // Проверяем, не существует ли уже холодильник с таким code
          const existing = await Fridge.findOne({ 
            code: fridge.number,
            _id: { $ne: fridge._id } // Исключаем текущий холодильник
          });

          if (existing) {
            console.warn(`⚠️ Холодильник ${fridge._id} (текущий code: ${fridge.code}) не обновлен: code "${fridge.number}" уже используется холодильником ${existing._id}`);
            skipped++;
            continue;
          }

          // Обновляем code
          await Fridge.updateOne(
            { _id: fridge._id },
            { $set: { code: fridge.number } }
          );
          updated++;
          
          if (updated <= 10) {
            console.log(`✓ Обновлен холодильник ${fridge._id}: code "${fridge.code}" -> "${fridge.number}"`);
          }
        } else if (!fridge.number) {
          skipped++;
          if (skipped <= 5) {
            console.log(`⊘ Пропущен холодильник ${fridge._id}: нет поля number`);
          }
        } else {
          skipped++;
          if (skipped <= 5) {
            console.log(`⊘ Пропущен холодильник ${fridge._id}: code уже равен number (${fridge.code})`);
          }
        }
      } catch (err) {
        errors++;
        console.error(`❌ Ошибка при обновлении холодильника ${fridge._id}:`, err.message);
      }
    }

    console.log('\n=== Итоговая статистика ===');
    console.log(`✅ Обновлено: ${updated}`);
    console.log(`⊘ Пропущено: ${skipped}`);
    console.log(`❌ Ошибки: ${errors}`);
    console.log(`📊 Всего холодильников: ${fridges.length}`);

    console.log('\n✅ Миграция завершена успешно!');

    await mongoose.connection.close();
    console.log('\n✅ Скрипт завершен');

  } catch (error) {
    console.error('\n❌ Ошибка при миграции:', error);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
    process.exit(1);
  }
}

migrateTaldykorganCodes();
