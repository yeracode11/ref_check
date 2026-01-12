require('dotenv').config();
const mongoose = require('mongoose');

async function migrateCodeFields() {
  try {
    console.log('Подключение к MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✓ Подключено к MongoDB\n');

    const db = mongoose.connection.db;
    const fridgesCollection = db.collection('fridges');

    // Находим все холодильники
    const fridges = await fridgesCollection.find({}).toArray();
    
    console.log(`Найдено холодильников: ${fridges.length}\n`);

    if (fridges.length === 0) {
      console.log('Нет холодильников для миграции');
      await mongoose.disconnect();
      return;
    }

    // Проверяем структуру первого холодильника
    const first = fridges[0];
    console.log('Текущая структура первого холодильника:');
    console.log(`  code: ${first.code ? (first.code.length > 20 ? first.code.substring(0, 20) + '...' : first.code) : 'нет'}`);
    console.log(`  displayCode: ${first.displayCode || 'нет'}`);
    console.log(`  number: ${first.number || 'нет'}\n`);

    // Спрашиваем подтверждение
    const confirmFlag = process.argv.includes('--confirm');
    
    if (!confirmFlag) {
      console.log('⚠️  МИГРАЦИЯ:');
      console.log('  Переименуем поля:');
      console.log('  • code (длинный) → number');
      console.log('  • displayCode (короткий) → code\n');
      console.log('Для подтверждения запустите:');
      console.log('node migrate_code_fields.js --confirm\n');
      await mongoose.disconnect();
      return;
    }

    console.log('=== Миграция полей ===\n');
    
    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const fridge of fridges) {
      try {
        // Проверяем что нужно мигрировать
        const hasOldStructure = fridge.code && !fridge.number;
        const hasDisplayCode = !!fridge.displayCode;

        if (!hasOldStructure && !hasDisplayCode) {
          console.log(`⚠ Пропущен ${fridge._id}: уже мигрирован`);
          skipped++;
          continue;
        }

        const updateDoc = {};
        
        // Поля для установки
        const setFields = {};

        // Если есть старый длинный code, переименовываем его в number
        if (hasOldStructure && fridge.code && fridge.code.length > 10) {
          setFields.number = fridge.code;
        }

        // Если есть displayCode, переименовываем его в code
        if (hasDisplayCode) {
          setFields.code = fridge.displayCode;
        }

        if (Object.keys(setFields).length === 0) {
          console.log(`⚠ Пропущен ${fridge._id}: нечего мигрировать`);
          skipped++;
          continue;
        }

        // Формируем update document с атомарными операторами
        updateDoc.$set = setFields;

        // Удаляем старое поле displayCode если оно было
        if (hasDisplayCode) {
          updateDoc.$unset = { displayCode: "" };
        }

        // Выполняем обновление
        const result = await fridgesCollection.updateOne(
          { _id: fridge._id },
          updateDoc
        );

        if (result.modifiedCount > 0) {
          const newCode = setFields.code || fridge.code;
          const newNumber = setFields.number || fridge.number;
          console.log(`✓ Мигрирован: code=#${newCode}, number=${newNumber ? newNumber.substring(0, 15) + '...' : 'нет'}`);
          migrated++;
        } else {
          skipped++;
        }
      } catch (err) {
        console.error(`❌ Ошибка для ${fridge._id}: ${err.message}`);
        errors++;
      }
    }

    console.log('\n=== Результаты миграции ===');
    console.log(`✓ Мигрировано: ${migrated}`);
    console.log(`⚠ Пропущено: ${skipped}`);
    console.log(`❌ Ошибок: ${errors}`);
    console.log(`📊 Всего холодильников: ${fridges.length}`);

    console.log('\n✅ Миграция завершена!');
    
    await mongoose.disconnect();
    console.log('✓ Соединение с MongoDB закрыто');

  } catch (error) {
    console.error('\n❌ Ошибка:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Проверяем аргументы
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log('Скрипт миграции полей холодильников:\n');
  console.log('  code (длинный) → number');
  console.log('  displayCode (короткий) → code\n');
  console.log('Использование:');
  console.log('  node migrate_code_fields.js           # Предпросмотр');
  console.log('  node migrate_code_fields.js --confirm # Выполнить миграцию');
  process.exit(0);
}

migrateCodeFields();

