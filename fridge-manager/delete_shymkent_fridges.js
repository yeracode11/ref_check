require('dotenv').config();
const mongoose = require('mongoose');
const Fridge = require('./models/Fridge');
const City = require('./models/City');
const CheckIn = require('./models/CheckIn');

async function deleteShymkentFridges() {
  try {
    console.log('Подключение к MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✓ Подключено к MongoDB');

    // 1. Ищем город Шымкент
    console.log('\n=== Поиск города Шымкент ===');
    const shymkentCity = await City.findOne({
      name: { $regex: /шымкент|shymkent/i }
    });

    if (shymkentCity) {
      console.log(`✓ Найден город: ${shymkentCity.name} (ID: ${shymkentCity._id})`);
    } else {
      console.log('⚠ Город Шымкент не найден в базе');
    }

    // 2. Ищем холодильники из Шымкента
    console.log('\n=== Поиск холодильников из Шымкента ===');
    
    const query = {
      $or: [
        // По адресу
        { address: { $regex: /шымкент|shymkent/i } },
      ]
    };

    // Добавляем поиск по cityId если город найден
    if (shymkentCity) {
      query.$or.push({ cityId: shymkentCity._id });
    }

    const fridges = await Fridge.find(query);
    console.log(`✓ Найдено холодильников: ${fridges.length}`);

    if (fridges.length === 0) {
      console.log('\n⚠ Нет холодильников для удаления');
      await mongoose.connection.close();
      return;
    }

    // 3. Показываем что будет удалено
    console.log('\n=== Список холодильников для удаления ===');
    fridges.forEach((f, index) => {
      console.log(`${index + 1}. Код: ${f.code}, Название: ${f.name}, Адрес: ${f.address || 'не указан'}`);
    });

    // 4. Подтверждение
    console.log(`\n⚠️  ВНИМАНИЕ: Будет удалено ${fridges.length} холодильников из Шымкента!`);
    console.log('Также будут удалены все связанные отметки (check-ins).');
    console.log('\nДля подтверждения запустите скрипт с флагом --confirm:');
    console.log('node delete_shymkent_fridges.js --confirm');

    if (!process.argv.includes('--confirm')) {
      console.log('\n✓ Предварительный просмотр завершен (удаление не выполнено)');
      await mongoose.connection.close();
      return;
    }

    // 5. Удаление
    console.log('\n=== Удаление холодильников ===');
    const fridgeIds = fridges.map(f => f._id);

    // Удаляем отметки (check-ins)
    const checkinsResult = await CheckIn.deleteMany({ fridgeId: { $in: fridgeIds } });
    console.log(`✓ Удалено отметок: ${checkinsResult.deletedCount}`);

    // Удаляем холодильники
    const fridgesResult = await Fridge.deleteMany({ _id: { $in: fridgeIds } });
    console.log(`✓ Удалено холодильников: ${fridgesResult.deletedCount}`);

    console.log('\n✅ Удаление завершено успешно!');

    await mongoose.connection.close();
    console.log('✓ Соединение с MongoDB закрыто');

  } catch (error) {
    console.error('\n❌ Ошибка:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

deleteShymkentFridges();

