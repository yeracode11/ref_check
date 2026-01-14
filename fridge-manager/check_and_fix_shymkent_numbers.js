const mongoose = require('mongoose');
require('dotenv').config();
const Fridge = require('./models/Fridge');
const City = require('./models/City');

/**
 * Скрипт для проверки и исправления номеров холодильников в Шымкенте
 * Проверяет, что у всех холодильников Шымкента есть поле number
 */
async function checkAndFixShymkentNumbers() {
  try {
    console.log('🔌 Подключение к MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✓ Подключено к MongoDB\n');

    // Сначала выводим все города для отладки
    console.log('=== Все города в базе ===');
    const allCities = await City.find({});
    if (allCities.length === 0) {
      console.log('  ⚠ Городов в базе нет!');
    } else {
      allCities.forEach(city => {
        console.log(`  - ${city.name} (code: ${city.code}, ID: ${city._id})`);
      });
    }
    console.log('');

    // Проверяем, есть ли вообще холодильники в базе
    const totalFridges = await Fridge.countDocuments({});
    console.log(`=== Всего холодильников в базе: ${totalFridges} ===\n`);
    
    if (totalFridges > 0) {
      // Показываем несколько примеров холодильников
      const sampleFridges = await Fridge.find({}).limit(5).populate('cityId');
      console.log('=== Примеры холодильников в базе ===');
      sampleFridges.forEach(f => {
        console.log(`  - code: ${f.code}, number: ${f.number || 'НЕТ'}, name: ${f.name}, city: ${f.cityId?.name || 'НЕТ'}`);
      });
      console.log('');
      
      // Ищем холодильники, у которых number содержит эти цифры
      console.log('=== Поиск холодильников с похожими номерами ===');
      const targetNumbers = ['1080021005', '4083823028', '1080021107'];
      for (const targetNumber of targetNumbers) {
        // Ищем частичные совпадения
        const partialMatches = await Fridge.find({
          $or: [
            { number: { $regex: targetNumber } },
            { code: { $regex: targetNumber } }
          ]
        }).limit(5);
        
        if (partialMatches.length > 0) {
          console.log(`Найдено ${partialMatches.length} холодильников с "${targetNumber}" в номере/коде:`);
          partialMatches.forEach(f => {
            console.log(`  - code: ${f.code}, number: ${f.number || 'НЕТ'}, name: ${f.name}`);
          });
        }
      }
      console.log('');
    }

    // Находим город Шымкент
    console.log('=== Поиск города Шымкент ===');
    let shymkentCity = await City.findOne({
      name: { $regex: /шымкент|shymkent/i }
    });

    // Если не нашли по имени, пробуем по коду
    if (!shymkentCity) {
      shymkentCity = await City.findOne({
        code: { $regex: /шымкент|shymkent/i }
      });
    }

    if (!shymkentCity) {
      console.log('❌ Город Шымкент не найден');
      console.log('⚠ Попробуем найти холодильники напрямую по номерам...\n');
    } else {
      console.log(`✓ Найден город: ${shymkentCity.name} (ID: ${shymkentCity._id})\n`);
    }

    // Находим все холодильники Шымкента
    console.log('=== Поиск холодильников Шымкента ===');
    let shymkentFridges = [];
    if (shymkentCity) {
      shymkentFridges = await Fridge.find({ cityId: shymkentCity._id });
      console.log(`✓ Найдено холодильников по cityId: ${shymkentFridges.length}\n`);
    } else {
      console.log('⚠ Город не найден, ищем холодильники напрямую по номерам...\n');
    }

    // Проверяем конкретные номера
    const targetNumbers = ['1080021005', '4083823028', '1080021107'];
    console.log('=== Проверка конкретных номеров ===');
    
    for (const targetNumber of targetNumbers) {
      // Ищем по number (без привязки к городу, если город не найден)
      let query = { number: targetNumber };
      if (shymkentCity) {
        query.cityId = shymkentCity._id;
      }
      
      let fridge = await Fridge.findOne(query);
      
      if (fridge) {
        console.log(`✓ Найден холодильник с number="${targetNumber}":`);
        console.log(`  - ID: ${fridge._id}`);
        console.log(`  - code: ${fridge.code}`);
        console.log(`  - number: ${fridge.number}`);
        console.log(`  - name: ${fridge.name}`);
        console.log(`  - cityId: ${fridge.cityId}`);
        
        // Проверяем, что number заполнен правильно
        if (!fridge.number || fridge.number !== targetNumber) {
          await Fridge.findByIdAndUpdate(fridge._id, {
            $set: { number: targetNumber }
          });
          console.log(`  ✅ Обновлен: number установлен в "${targetNumber}"`);
        }
      } else {
        // Ищем по code
        query = { code: targetNumber };
        if (shymkentCity) {
          query.cityId = shymkentCity._id;
        }
        fridge = await Fridge.findOne(query);
        
        if (fridge) {
          console.log(`⚠ Найден холодильник с code="${targetNumber}", но без number:`);
          console.log(`  - ID: ${fridge._id}`);
          console.log(`  - code: ${fridge.code}`);
          console.log(`  - number: ${fridge.number || 'ОТСУТСТВУЕТ'}`);
          console.log(`  - name: ${fridge.name}`);
          console.log(`  - cityId: ${fridge.cityId}`);
          
          // Обновляем: устанавливаем number
          await Fridge.findByIdAndUpdate(fridge._id, {
            $set: { number: targetNumber }
          });
          console.log(`  ✅ Обновлен: number установлен в "${targetNumber}"`);
        } else {
          console.log(`❌ Холодильник с номером "${targetNumber}" не найден (ни по number, ни по code)`);
        }
      }
      console.log('');
    }

    // Статистика по всем холодильникам Шымкента (если город найден)
    if (shymkentCity && shymkentFridges.length > 0) {
      console.log('=== Статистика по всем холодильникам Шымкента ===');
      const withNumber = shymkentFridges.filter(f => f.number).length;
      const withoutNumber = shymkentFridges.length - withNumber;
      
      console.log(`Всего холодильников: ${shymkentFridges.length}`);
      console.log(`С полем number: ${withNumber}`);
      console.log(`Без поля number: ${withoutNumber}`);
      
      if (withoutNumber > 0) {
        console.log('\n⚠ Холодильники без поля number:');
        shymkentFridges
          .filter(f => !f.number)
          .slice(0, 10) // Показываем первые 10
          .forEach(f => {
            console.log(`  - code: ${f.code}, name: ${f.name}`);
          });
        if (withoutNumber > 10) {
          console.log(`  ... и еще ${withoutNumber - 10} холодильников`);
        }
      }
    }

    await mongoose.connection.close();
    console.log('\n✅ Проверка завершена');

  } catch (error) {
    console.error('❌ Критическая ошибка:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Запуск скрипта
if (require.main === module) {
  checkAndFixShymkentNumbers()
    .then(() => {
      console.log('\n✅ Скрипт завершен успешно');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Скрипт завершен с ошибкой:', error);
      process.exit(1);
    });
}

module.exports = checkAndFixShymkentNumbers;

