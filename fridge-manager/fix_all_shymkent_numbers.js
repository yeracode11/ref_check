const mongoose = require('mongoose');
require('dotenv').config();
const Fridge = require('./models/Fridge');
const City = require('./models/City');

/**
 * Скрипт для массового исправления номеров холодильников в Шымкенте
 * Находит все холодильники Шымкента без поля number и заполняет его из code
 */
async function fixAllShymkentNumbers() {
  try {
    console.log('🔌 Подключение к MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✓ Подключено к MongoDB\n');

    // Находим город Шымкент (пробуем разные варианты названия)
    console.log('=== Поиск города Шымкент ===');
    let shymkentCity = await City.findOne({
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
      console.log('\n⚠ Попробуем найти холодильники без привязки к городу...\n');
    } else {
      console.log(`✓ Найден город: ${shymkentCity.name} (ID: ${shymkentCity._id})\n`);
    }

    // Находим все холодильники Шымкента (или все, если город не найден)
    console.log('=== Поиск холодильников ===');
    const query = shymkentCity ? { cityId: shymkentCity._id } : {};
    const allFridges = await Fridge.find(query);
    console.log(`✓ Найдено холодильников: ${allFridges.length}\n`);

    if (allFridges.length === 0) {
      console.log('⚠ Нет холодильников для обработки');
      await mongoose.connection.close();
      return;
    }

    // Фильтруем холодильники без number или с пустым number
    const fridgesWithoutNumber = allFridges.filter(f => !f.number || f.number.trim() === '');
    console.log(`=== Холодильники без поля number: ${fridgesWithoutNumber.length} ===\n`);

    if (fridgesWithoutNumber.length === 0) {
      console.log('✅ У всех холодильников есть поле number!');
      await mongoose.connection.close();
      return;
    }

    // Функция для проверки, похож ли code на длинный номер (10+ цифр)
    function isLongNumber(str) {
      if (!str) return false;
      // Убираем все нецифровые символы и проверяем длину
      const digitsOnly = str.replace(/\D/g, '');
      return digitsOnly.length >= 10;
    }

    // Обрабатываем каждый холодильник
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    console.log('=== Обработка холодильников ===\n');
    
    for (let i = 0; i < fridgesWithoutNumber.length; i++) {
      const fridge = fridgesWithoutNumber[i];
      
      try {
        // Проверяем, похож ли code на длинный номер
        if (isLongNumber(fridge.code)) {
          // Копируем code в number
          await Fridge.findByIdAndUpdate(fridge._id, {
            $set: { number: fridge.code }
          });
          console.log(`✓ [${i + 1}/${fridgesWithoutNumber.length}] Обновлен: code="${fridge.code}" -> number="${fridge.code}"`);
          console.log(`  Холодильник: ${fridge.name}`);
          updated++;
        } else {
          // code не похож на длинный номер - пропускаем
          console.log(`⚠ [${i + 1}/${fridgesWithoutNumber.length}] Пропущен: code="${fridge.code}" (не похож на длинный номер)`);
          console.log(`  Холодильник: ${fridge.name}`);
          skipped++;
        }
      } catch (error) {
        console.error(`❌ [${i + 1}/${fridgesWithoutNumber.length}] Ошибка при обработке холодильника ${fridge._id}:`, error.message);
        errors++;
      }
      
      // Показываем прогресс каждые 10 холодильников
      if ((i + 1) % 10 === 0) {
        console.log(`\n📊 Прогресс: ${i + 1}/${fridgesWithoutNumber.length} (обновлено: ${updated}, пропущено: ${skipped}, ошибок: ${errors})\n`);
      }
    }

    console.log('\n=== Итоговая статистика ===');
    console.log(`Всего холодильников без number: ${fridgesWithoutNumber.length}`);
    console.log(`✅ Обновлено (code скопирован в number): ${updated}`);
    console.log(`⚠ Пропущено (code не похож на длинный номер): ${skipped}`);
    console.log(`❌ Ошибок: ${errors}`);

    if (updated > 0) {
      console.log('\n✅ Номера успешно обновлены! Теперь QR-коды будут показывать правильные номера.');
      console.log('⚠ Если QR-коды уже были распечатаны, их нужно будет перепечатать.');
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
  fixAllShymkentNumbers()
    .then(() => {
      console.log('\n✅ Скрипт завершен успешно');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Скрипт завершен с ошибкой:', error);
      process.exit(1);
    });
}

module.exports = fixAllShymkentNumbers;

