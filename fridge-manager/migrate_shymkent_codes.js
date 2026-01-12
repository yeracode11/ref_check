require('dotenv').config();
const mongoose = require('mongoose');
const Fridge = require('./models/Fridge');
const City = require('./models/City');
const { getNextSequence } = require('./models/Counter');

async function migrateShymkentCodes() {
  try {
    console.log('Подключение к MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✓ Подключено к MongoDB\n');

    // Находим город Шымкент
    const shymkentCity = await City.findOne({
      name: { $regex: /шымкент|shymkent/i }
    });

    if (!shymkentCity) {
      console.log('❌ Город Шымкент не найден');
      await mongoose.disconnect();
      return;
    }

    console.log(`✓ Найден город: ${shymkentCity.name} (ID: ${shymkentCity._id})\n`);

    // Находим все холодильники Шымкента
    const allFridges = await Fridge.find({
      cityId: shymkentCity._id
    }).sort({ createdAt: 1 }); // Сортируем по дате создания

    // Фильтруем только холодильники с длинным кодом (больше 10 символов)
    const fridges = allFridges.filter(f => f.code && f.code.length > 10);

    console.log(`Найдено холодильников с длинным кодом: ${fridges.length}\n`);

    if (fridges.length === 0) {
      console.log('✅ Все холодильники уже имеют короткий код');
      await mongoose.disconnect();
      return;
    }

    // Показываем первые 5 для проверки
    console.log('Первые 5 холодильников:');
    fridges.slice(0, 5).forEach((f, i) => {
      console.log(`  ${i + 1}. ${f.name}`);
      console.log(`     Текущий код: ${f.code.substring(0, 30)}...`);
    });
    console.log('');

    // Спрашиваем подтверждение
    const confirmFlag = process.argv.includes('--confirm');
    
    if (!confirmFlag) {
      console.log('⚠️  МИГРАЦИЯ:');
      console.log('  Будет выполнено:');
      console.log('  1. Длинный код переместится в поле "number"');
      console.log('  2. Будет сгенерирован короткий код в поле "code" (#1, #2, #3...)');
      console.log('  3. ВСЕ ОТМЕТКИ И ДАННЫЕ СОХРАНЯТСЯ\n');
      console.log('Для подтверждения запустите:');
      console.log('node migrate_shymkent_codes.js --confirm\n');
      await mongoose.disconnect();
      return;
    }

    console.log('=== Миграция кодов холодильников ===\n');
    
    let migrated = 0;
    let errors = 0;

    for (const fridge of fridges) {
      try {
        // Сохраняем старый длинный код
        const oldCode = fridge.code;

        // Генерируем новый короткий код
        const seqNumber = await getNextSequence('fridge');
        const shortCode = String(seqNumber);

        // Обновляем холодильник
        fridge.code = shortCode; // Короткий код
        fridge.number = oldCode; // Длинный номер из Excel
        
        await fridge.save();

        console.log(`✓ #${shortCode}: ${fridge.name}`);
        console.log(`  Старый: ${oldCode.substring(0, 25)}...`);
        console.log(`  Новый: code=#${shortCode}, number=${oldCode.substring(0, 20)}...`);
        console.log('');
        
        migrated++;
      } catch (err) {
        console.error(`❌ Ошибка для ${fridge._id}: ${err.message}`);
        errors++;
      }
    }

    console.log('\n=== Результаты миграции ===');
    console.log(`✓ Мигрировано: ${migrated}`);
    console.log(`❌ Ошибок: ${errors}`);
    console.log(`📊 Всего холодильников: ${fridges.length}`);

    console.log('\n✅ Миграция завершена!');
    console.log('📋 Что изменилось:');
    console.log('  • code теперь содержит короткий номер (#1, #2, #3...)');
    console.log('  • number содержит длинный номер из Excel');
    console.log('  • Все отметки мерчендайзеров сохранены');
    console.log('  • QR коды будут показывать короткий номер\n');
    
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
  console.log('Скрипт миграции кодов холодильников Шымкента\n');
  console.log('Преобразует длинные коды в короткие порядковые номера');
  console.log('БЕЗОПАСНО: сохраняет все отметки и данные\n');
  console.log('Использование:');
  console.log('  node migrate_shymkent_codes.js           # Предпросмотр');
  console.log('  node migrate_shymkent_codes.js --confirm # Выполнить миграцию');
  process.exit(0);
}

migrateShymkentCodes();

