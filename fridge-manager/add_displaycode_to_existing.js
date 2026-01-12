require('dotenv').config();
const mongoose = require('mongoose');
const Fridge = require('./models/Fridge');
const City = require('./models/City');
const { getNextSequence } = require('./models/Counter');

async function addDisplayCodeToExisting() {
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

    // Находим все холодильники Шымкента БЕЗ displayCode
    const fridges = await Fridge.find({
      cityId: shymkentCity._id,
      $or: [
        { displayCode: { $exists: false } },
        { displayCode: null },
        { displayCode: '' }
      ]
    }).sort({ createdAt: 1 }); // Сортируем по дате создания (старые первыми)

    console.log(`Найдено холодильников без displayCode: ${fridges.length}\n`);

    if (fridges.length === 0) {
      console.log('✅ Все холодильники уже имеют displayCode');
      await mongoose.disconnect();
      return;
    }

    // Спрашиваем подтверждение
    const confirmFlag = process.argv.includes('--confirm');
    
    if (!confirmFlag) {
      console.log('⚠️  ВНИМАНИЕ: Будет добавлен displayCode к существующим холодильникам');
      console.log('\nПервые 5 холодильников:');
      fridges.slice(0, 5).forEach((f, i) => {
        console.log(`  ${i + 1}. ${f.name} (${f.code})`);
      });
      console.log('\nДля подтверждения запустите скрипт с флагом --confirm:');
      console.log('node add_displaycode_to_existing.js --confirm\n');
      await mongoose.disconnect();
      return;
    }

    // Добавляем displayCode к каждому холодильнику
    console.log('=== Добавление displayCode ===\n');
    
    let updated = 0;
    let errors = 0;

    for (const fridge of fridges) {
      try {
        // Генерируем следующий номер
        const seqNumber = await getNextSequence('fridge');
        const displayCode = String(seqNumber);

        // Обновляем холодильник
        fridge.displayCode = displayCode;
        await fridge.save();

        console.log(`✓ ${displayCode}: ${fridge.name}`);
        updated++;
      } catch (err) {
        console.error(`❌ Ошибка для ${fridge.code}: ${err.message}`);
        errors++;
      }
    }

    console.log('\n=== Результаты ===');
    console.log(`✓ Обновлено: ${updated}`);
    console.log(`❌ Ошибок: ${errors}`);
    console.log(`📊 Всего обработано: ${fridges.length}`);

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
  console.log('Скрипт для добавления displayCode к существующим холодильникам Шымкента\n');
  console.log('Использование:');
  console.log('  node add_displaycode_to_existing.js           # Предпросмотр');
  console.log('  node add_displaycode_to_existing.js --confirm # Выполнить миграцию');
  process.exit(0);
}

addDisplayCodeToExisting();

