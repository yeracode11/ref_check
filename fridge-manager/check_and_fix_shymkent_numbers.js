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

    // Находим город Шымкент
    console.log('=== Поиск города Шымкент ===');
    const shymkentCity = await City.findOne({
      name: { $regex: /шымкент|shymkent/i }
    });

    if (!shymkentCity) {
      console.log('❌ Город Шымкент не найден');
      await mongoose.connection.close();
      return;
    }

    console.log(`✓ Найден город: ${shymkentCity.name} (ID: ${shymkentCity._id})\n`);

    // Находим все холодильники Шымкента
    console.log('=== Поиск холодильников Шымкента ===');
    const shymkentFridges = await Fridge.find({ cityId: shymkentCity._id });
    console.log(`✓ Найдено холодильников: ${shymkentFridges.length}\n`);

    if (shymkentFridges.length === 0) {
      console.log('⚠ Нет холодильников для проверки');
      await mongoose.connection.close();
      return;
    }

    // Проверяем конкретные номера
    const targetNumbers = ['1080021005', '4083823028', '1080021107'];
    console.log('=== Проверка конкретных номеров ===');
    
    for (const targetNumber of targetNumbers) {
      // Ищем по number
      let fridge = await Fridge.findOne({ 
        cityId: shymkentCity._id,
        number: targetNumber 
      });
      
      if (fridge) {
        console.log(`✓ Найден холодильник с number="${targetNumber}":`);
        console.log(`  - ID: ${fridge._id}`);
        console.log(`  - code: ${fridge.code}`);
        console.log(`  - number: ${fridge.number}`);
        console.log(`  - name: ${fridge.name}`);
      } else {
        // Ищем по code
        fridge = await Fridge.findOne({ 
          cityId: shymkentCity._id,
          code: targetNumber 
        });
        
        if (fridge) {
          console.log(`⚠ Найден холодильник с code="${targetNumber}", но без number:`);
          console.log(`  - ID: ${fridge._id}`);
          console.log(`  - code: ${fridge.code}`);
          console.log(`  - number: ${fridge.number || 'ОТСУТСТВУЕТ'}`);
          console.log(`  - name: ${fridge.name}`);
          
          // Обновляем: копируем code в number
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

    // Статистика по всем холодильникам Шымкента
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

