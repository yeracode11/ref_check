const mongoose = require('mongoose');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const Fridge = require('./models/Fridge');
const City = require('./models/City');

/**
 * Скрипт для обновления номеров холодильников из Excel файла
 * Читает Excel, находит холодильники по номеру и обновляет поле number
 * 
 * Использование:
 *   node update_numbers_from_excel.js <путь_к_excel_файлу>
 */
async function updateNumbersFromExcel(excelFilePath) {
  try {
    if (!excelFilePath) {
      console.log('❌ Ошибка: не указан путь к Excel файлу');
      console.log('Использование: node update_numbers_from_excel.js <путь_к_excel_файлу>');
      process.exit(1);
    }

    if (!fs.existsSync(excelFilePath)) {
      console.log(`❌ Ошибка: файл не найден: ${excelFilePath}`);
      process.exit(1);
    }

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
      console.log('❌ Город Шымкент не найден');
      await mongoose.connection.close();
      process.exit(1);
    }

    console.log(`✓ Найден город: ${shymkentCity.name} (ID: ${shymkentCity._id})\n`);

    // Читаем Excel файл
    console.log('=== Чтение Excel файла ===');
    console.log(`Файл: ${excelFilePath}\n`);
    
    const workbook = XLSX.readFile(excelFilePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    if (!worksheet) {
      console.log('❌ Лист не найден в Excel файле');
      await mongoose.connection.close();
      process.exit(1);
    }

    // Читаем как массив массивов
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });
    console.log(`✓ Прочитано строк: ${rawData.length}\n`);

    if (rawData.length === 0) {
      console.log('⚠ Файл пустой');
      await mongoose.connection.close();
      return;
    }

    // Ищем строку с заголовками
    let headerRow = -1;
    for (let i = 0; i < Math.min(10, rawData.length); i++) {
      const row = rawData[i];
      if (Array.isArray(row)) {
        const rowStr = row.map(cell => String(cell || '').toLowerCase()).join(' ');
        if (rowStr.includes('контрагент') || rowStr.includes('адрес')) {
          headerRow = i;
          break;
        }
      }
    }

    if (headerRow === -1) {
      console.log('⚠ Строка с заголовками не найдена, используем первую строку');
      headerRow = 0;
    }

    const headers = rawData[headerRow] || [];
    console.log('=== Найденные заголовки ===');
    headers.forEach((h, i) => {
      if (h) console.log(`  [${i}]: ${h}`);
    });
    console.log('');

    // Функция для поиска индекса колонки
    function findColumnIndex(keywords) {
      for (let i = 0; i < headers.length; i++) {
        const header = String(headers[i] || '').toLowerCase();
        for (const keyword of keywords) {
          if (header.includes(keyword.toLowerCase())) {
            return i;
          }
        }
      }
      return -1;
    }

    // Ищем колонки
    const addressIdx = findColumnIndex(['адрес']);
    const contractorIdx = findColumnIndex(['контрагент', 'клиент']);
    
    // Для Шымкента ищем колонку с номером холодильника из Excel
    let fridgeNumberIdx = -1;
    for (let i = 0; i < headers.length; i++) {
      const header = String(headers[i] || '').toLowerCase();
      if ((header.includes('номер') || header.includes('код')) && 
          !header.includes('договор') && 
          !header.includes('дог') &&
          (header.includes('хо') || header.includes('холодильник') || header.includes('хол'))) {
        fridgeNumberIdx = i;
        break;
      }
    }
    // Если не нашли специфичную колонку, ищем просто "номер" или "код" (но не договор)
    if (fridgeNumberIdx === -1) {
      const contractNumIdx = findColumnIndex(['договор', 'дог']);
      for (let i = 0; i < headers.length; i++) {
        const header = String(headers[i] || '').toLowerCase();
        if ((header === 'номер' || header === 'код') && i !== contractNumIdx) {
          fridgeNumberIdx = i;
          break;
        }
      }
    }

    if (fridgeNumberIdx === -1) {
      console.log('⚠ Колонка с номером холодильника не найдена');
      console.log('Попробуем найти по другим признакам...\n');
    } else {
      console.log(`✓ Найдена колонка с номером холодильника: [${fridgeNumberIdx}] "${headers[fridgeNumberIdx]}"\n`);
    }

    // Определяем строку начала данных (обычно после заголовков)
    const dataStartRow = headerRow + 1;

    // Обрабатываем данные
    console.log('=== Обработка данных ===\n');
    let updated = 0;
    let notFound = 0;
    let skipped = 0;
    let errors = 0;

    for (let i = dataStartRow; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || !Array.isArray(row)) {
        continue;
      }

      // Получаем номер холодильника из Excel
      let excelNumber = null;
      if (fridgeNumberIdx >= 0) {
        const numberValue = String(row[fridgeNumberIdx] || '').trim();
        if (numberValue && numberValue !== 'null' && numberValue !== 'undefined') {
          excelNumber = numberValue;
        }
      }

      // Если номер не найден в указанной колонке, пробуем найти в других колонках
      if (!excelNumber) {
        // Ищем колонку с длинным числом (10+ цифр)
        for (let colIdx = 0; colIdx < row.length; colIdx++) {
          const cellValue = String(row[colIdx] || '').trim();
          const digitsOnly = cellValue.replace(/\D/g, '');
          if (digitsOnly.length >= 10) {
            excelNumber = cellValue;
            break;
          }
        }
      }

      if (!excelNumber) {
        skipped++;
        continue;
      }

      // Ищем холодильник в базе по номеру (в поле number или code)
      let fridge = await Fridge.findOne({
        cityId: shymkentCity._id,
        $or: [
          { number: excelNumber },
          { code: excelNumber }
        ]
      });

      if (!fridge) {
        // Пробуем найти по частичному совпадению
        fridge = await Fridge.findOne({
          cityId: shymkentCity._id,
          $or: [
            { number: { $regex: excelNumber } },
            { code: { $regex: excelNumber } }
          ]
        });
      }

      if (fridge) {
        try {
          // Обновляем поле number
          if (fridge.number !== excelNumber) {
            await Fridge.findByIdAndUpdate(fridge._id, {
              $set: { number: excelNumber }
            });
            console.log(`✓ [${i - dataStartRow + 1}] Обновлен: ${fridge.name}`);
            console.log(`  Старый number: ${fridge.number || 'НЕТ'} -> Новый: ${excelNumber}`);
            console.log(`  code: ${fridge.code}`);
            updated++;
          } else {
            console.log(`✓ [${i - dataStartRow + 1}] Уже актуален: ${fridge.name} (number: ${excelNumber})`);
          }
        } catch (error) {
          console.error(`❌ [${i - dataStartRow + 1}] Ошибка при обновлении: ${error.message}`);
          errors++;
        }
      } else {
        console.log(`⚠ [${i - dataStartRow + 1}] Холодильник с номером "${excelNumber}" не найден в базе`);
        notFound++;
      }
    }

    console.log('\n=== Итоговая статистика ===');
    console.log(`✅ Обновлено: ${updated}`);
    console.log(`⚠ Не найдено в базе: ${notFound}`);
    console.log(`⚠ Пропущено (нет номера в Excel): ${skipped}`);
    console.log(`❌ Ошибок: ${errors}`);

    if (updated > 0) {
      console.log('\n✅ Номера успешно обновлены из Excel!');
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
  const excelFilePath = process.argv[2];
  updateNumbersFromExcel(excelFilePath)
    .then(() => {
      console.log('\n✅ Скрипт завершен успешно');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Скрипт завершен с ошибкой:', error);
      process.exit(1);
    });
}

module.exports = updateNumbersFromExcel;

