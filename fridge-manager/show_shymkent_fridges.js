const mongoose = require('mongoose');
require('dotenv').config();
const Fridge = require('./models/Fridge');
const City = require('./models/City');

/**
 * Скрипт для отображения всех холодильников Шымкента с номерами и кодами
 */
async function showShymkentFridges() {
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
      // Если город не найден, выводим все города для справки
      const allCities = await City.find({});
      console.log('⚠ Город Шымкент не найден. Доступные города:');
      allCities.forEach(city => {
        console.log(`  - ${city.name} (code: ${city.code}, ID: ${city._id})`);
      });
      await mongoose.connection.close();
      return;
    }

    console.log(`✓ Найден город: ${shymkentCity.name} (ID: ${shymkentCity._id})\n`);

    // Находим все холодильники Шымкента
    console.log('=== Поиск холодильников Шымкента ===');
    const fridges = await Fridge.find({ cityId: shymkentCity._id })
      .sort({ code: 1 })
      .select('code number name address active');
    
    console.log(`✓ Найдено холодильников: ${fridges.length}\n`);

    if (fridges.length === 0) {
      console.log('⚠ Холодильников не найдено');
      await mongoose.connection.close();
      return;
    }

    // Статистика
    const withNumber = fridges.filter(f => f.number && f.number.trim() !== '').length;
    const withoutNumber = fridges.length - withNumber;

    console.log('=== Статистика ===');
    console.log(`Всего холодильников: ${fridges.length}`);
    console.log(`С номером (number): ${withNumber}`);
    console.log(`Без номера (number): ${withoutNumber}\n`);

    // Выводим все холодильники
    console.log('=== Все холодильники Шымкента ===\n');
    console.log('Формат: [ID] Название | code: #код | number: номер');
    console.log('─'.repeat(80));

    fridges.forEach((fridge, index) => {
      const hasNumber = fridge.number && fridge.number.trim() !== '';
      const status = fridge.active ? '✓' : '✗';
      
      console.log(`\n[${index + 1}] ${status} ${fridge.name}`);
      console.log(`    code:    #${fridge.code}`);
      if (hasNumber) {
        console.log(`    number:  ${fridge.number}`);
      } else {
        console.log(`    number:  ❌ ОТСУТСТВУЕТ`);
      }
      if (fridge.address) {
        console.log(`    адрес:   ${fridge.address.substring(0, 60)}${fridge.address.length > 60 ? '...' : ''}`);
      }
    });

    console.log('\n' + '─'.repeat(80));
    console.log(`\n✅ Всего: ${fridges.length} холодильников`);

    // Группируем по наличию номера
    console.log('\n=== Группировка по наличию номера ===\n');
    
    const fridgesWithNumber = fridges.filter(f => f.number && f.number.trim() !== '');
    const fridgesWithoutNumber = fridges.filter(f => !f.number || f.number.trim() === '');

    if (fridgesWithNumber.length > 0) {
      console.log(`✅ Холодильники С номером (${fridgesWithNumber.length}):`);
      fridgesWithNumber.slice(0, 20).forEach(f => {
        console.log(`  - #${f.code} | number: ${f.number} | ${f.name}`);
      });
      if (fridgesWithNumber.length > 20) {
        console.log(`  ... и еще ${fridgesWithNumber.length - 20} холодильников`);
      }
    }

    if (fridgesWithoutNumber.length > 0) {
      console.log(`\n❌ Холодильники БЕЗ номера (${fridgesWithoutNumber.length}):`);
      fridgesWithoutNumber.slice(0, 20).forEach(f => {
        console.log(`  - #${f.code} | ${f.name}`);
      });
      if (fridgesWithoutNumber.length > 20) {
        console.log(`  ... и еще ${fridgesWithoutNumber.length - 20} холодильников`);
      }
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
  showShymkentFridges()
    .then(() => {
      console.log('\n✅ Скрипт завершен успешно');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Скрипт завершен с ошибкой:', error);
      process.exit(1);
    });
}

module.exports = showShymkentFridges;

