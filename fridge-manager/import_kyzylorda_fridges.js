const mongoose = require('mongoose');
const XLSX = require('xlsx');
const path = require('path');
require('dotenv').config();
const Fridge = require('./models/Fridge');
const City = require('./models/City');

/**
 * Скрипт для импорта холодильников из Excel файла для Кызылорды
 * 
 * Использование:
 *   node import_kyzylorda_fridges.js [путь_к_файлу]
 * 
 * Если путь не указан, используется kyzylorda.xlsx в корне проекта
 */
async function importKyzylordaFridges(excelFilePath) {
  try {
    console.log('🔌 Подключение к MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✓ Подключено к MongoDB\n');

    // Определяем путь к файлу
    if (!excelFilePath) {
      excelFilePath = path.join(__dirname, '..', 'kyzylorda.xlsx');
    }

    if (!require('fs').existsSync(excelFilePath)) {
      console.log(`❌ Файл не найден: ${excelFilePath}`);
      console.log('Использование: node import_kyzylorda_fridges.js [путь_к_файлу]');
      await mongoose.connection.close();
      process.exit(1);
    }

    // 1. Ищем город Кызылорда
    console.log('=== Поиск города Кызылорда ===');
    let kyzylordaCity = await City.findOne({
      $or: [
        { name: { $regex: /кызылорда|kyzylorda|қызылорда/i } },
        { code: { $regex: /кызылорда|kyzylorda|қызылорда/i } }
      ]
    });

    if (!kyzylordaCity) {
      console.log('⚠ Город Кызылорда не найден, создаем...');
      kyzylordaCity = await City.create({
        name: 'Кызылорда',
        code: 'kyzylorda',
        active: true
      });
      console.log(`✓ Создан город: ${kyzylordaCity.name} (ID: ${kyzylordaCity._id})`);
    } else {
      console.log(`✓ Найден город: ${kyzylordaCity.name} (ID: ${kyzylordaCity._id})`);
    }

    // 2. Читаем Excel файл
    console.log('\n=== Чтение Excel файла ===');
    console.log(`Файл: ${excelFilePath}\n`);
    
    const workbook = XLSX.readFile(excelFilePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Читаем как массив массивов
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });
    
    console.log(`✓ Прочитано строк: ${rawData.length}\n`);

    if (rawData.length === 0) {
      console.log('⚠ Файл пустой или не содержит данных');
      await mongoose.connection.close();
      return;
    }

    // 3. Ищем строку с заголовками
    console.log('=== Поиск строки с заголовками ===');
    let headerRow = -1;
    for (let i = 0; i < Math.min(15, rawData.length); i++) {
      const row = rawData[i];
      if (row && Array.isArray(row)) {
        const rowStr = row.map(cell => String(cell || '').toLowerCase()).join(' ');
        if (rowStr.includes('контрагент') || rowStr.includes('адрес')) {
          headerRow = i;
          console.log(`✓ Найдена строка с заголовками на индексе: ${i}`);
          break;
        }
      }
    }

    if (headerRow === -1) {
      console.log('❌ Строка с заголовками не найдена');
      await mongoose.connection.close();
      process.exit(1);
    }

    const headers = rawData[headerRow].map(h => String(h || '').trim());
    console.log('Заголовки:', headers.filter(h => h).join(', '));
    console.log('');

    // 4. Находим индексы колонок
    const findColumnIndex = (keywords) => {
      for (let i = 0; i < headers.length; i++) {
        const header = String(headers[i] || '').toLowerCase().trim();
        for (const keyword of keywords) {
          if (header.includes(keyword.toLowerCase())) {
            return i;
          }
        }
      }
      return -1;
    };

    const contractorIdx = findColumnIndex(['контрагент']);
    const contractNumIdx = findColumnIndex(['договор']);
    const equipmentIdx = findColumnIndex(['оборудование']);
    const addressIdx = findColumnIndex(['адрес']);
    
    // Для Кызылорды ищем колонку с номером холодильника
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
    // Если не нашли специфичную колонку, ищем просто "номер" (но не договор)
    if (fridgeNumberIdx === -1) {
      for (let i = 0; i < headers.length; i++) {
        const header = String(headers[i] || '').toLowerCase();
        if ((header === 'номер' || header === 'код') && i !== contractNumIdx) {
          fridgeNumberIdx = i;
          break;
        }
      }
    }

    console.log('=== Найденные колонки ===');
    console.log(`  Контрагент: ${contractorIdx >= 0 ? `[${contractorIdx}] "${headers[contractorIdx]}"` : 'НЕ НАЙДЕНА'}`);
    console.log(`  Договор: ${contractNumIdx >= 0 ? `[${contractNumIdx}] "${headers[contractNumIdx]}"` : 'НЕ НАЙДЕНА'}`);
    console.log(`  Оборудование: ${equipmentIdx >= 0 ? `[${equipmentIdx}] "${headers[equipmentIdx]}"` : 'НЕ НАЙДЕНА'}`);
    console.log(`  Адрес: ${addressIdx >= 0 ? `[${addressIdx}] "${headers[addressIdx]}"` : 'НЕ НАЙДЕНА'}`);
    console.log(`  Номер холодильника: ${fridgeNumberIdx >= 0 ? `[${fridgeNumberIdx}] "${headers[fridgeNumberIdx]}"` : 'НЕ НАЙДЕНА'}`);
    console.log('');

    if (contractorIdx === -1) {
      console.log('❌ Ошибка: колонка "Контрагент" не найдена');
      await mongoose.connection.close();
      process.exit(1);
    }

    if (fridgeNumberIdx === -1) {
      console.log('⚠ Предупреждение: колонка с номером холодильника не найдена');
      console.log('Холодильники будут импортированы без номера');
    }

    // 5. Находим максимальный существующий код
    const maxFridge = await Fridge.findOne().sort({ code: -1 });
    let codeCounter = 1;
    if (maxFridge && maxFridge.code) {
      const maxCode = parseInt(maxFridge.code, 10);
      if (!isNaN(maxCode)) {
        codeCounter = maxCode + 1;
      }
    }

    // 6. Обрабатываем данные
    console.log('=== Обработка данных ===\n');
    const dataStartRow = headerRow + 1;
    const records = [];
    let skipped = 0;
    let processed = 0;

    for (let i = dataStartRow; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || !Array.isArray(row)) {
        skipped++;
        continue;
      }

      // Получаем контрагента
      const contractor = contractorIdx >= 0 ? String(row[contractorIdx] || '').trim() : '';
      
      // Пропускаем пустые строки
      if (!contractor || contractor === 'null' || contractor === 'undefined') {
        skipped++;
        continue;
      }

      processed++;

      // Получаем номер холодильника из Excel
      let fridgeNumber = null;
      if (fridgeNumberIdx >= 0) {
        const numberValue = String(row[fridgeNumberIdx] || '').trim();
        if (numberValue && numberValue !== 'null' && numberValue !== 'undefined') {
          fridgeNumber = numberValue;
        }
      }

      // Для Кызылорды, как для Шымкента: используем номер из Excel как code
      // Если номера нет, генерируем последовательный код
      let code;
      if (fridgeNumber) {
        // Используем номер из Excel как code (как для Шымкента)
        code = fridgeNumber;
      } else {
        // Если номера нет, генерируем последовательный код
        code = String(codeCounter);
        while (await Fridge.findOne({ code })) {
          codeCounter++;
          code = String(codeCounter);
        }
        codeCounter++;
      }

      // Получаем адрес (может быть пустым)
      const address = addressIdx >= 0 ? String(row[addressIdx] || '').trim() : '';

      // Формируем описание
      const descriptionParts = [];
      if (contractNumIdx >= 0) {
        const contractNum = String(row[contractNumIdx] || '').trim();
        if (contractNum && contractNum !== 'Без договора') {
          descriptionParts.push(`Договор: ${contractNum}`);
        }
      }
      if (equipmentIdx >= 0) {
        const equipment = String(row[equipmentIdx] || '').trim();
        if (equipment) {
          descriptionParts.push(`Оборудование: ${equipment}`);
        }
      }
      const description = descriptionParts.length > 0 ? descriptionParts.join('; ') : null;

      const record = {
        code, // Для Кызылорды code = номер из Excel (как для Шымкента)
        name: contractor.substring(0, 200),
        cityId: kyzylordaCity._id,
        address: address || null,
        description: description ? description.substring(0, 500) : null,
        location: {
          type: 'Point',
          coordinates: [0.0, 0.0], // Временные координаты
        },
        active: true,
        warehouseStatus: 'warehouse',
      };

      // Добавляем number (равен code, если есть номер из Excel)
      if (fridgeNumber) {
        record.number = fridgeNumber;
      }

      records.push(record);
      codeCounter++;

      // Показываем прогресс каждые 100 записей
      if (records.length % 100 === 0) {
        console.log(`  Обработано: ${records.length} записей...`);
      }
    }

    console.log(`\n✓ Обработано строк: ${processed}`);
    console.log(`✓ Пропущено пустых: ${skipped}`);
    console.log(`✓ Записей для импорта: ${records.length}\n`);

    if (records.length === 0) {
      console.log('⚠ Нет данных для импорта');
      await mongoose.connection.close();
      return;
    }

    // 7. Импортируем в базу данных
    console.log('=== Импорт в базу данных ===\n');
    
    // Загружаем существующие холодильники для проверки дубликатов
    const existingFridges = await Fridge.find({ cityId: kyzylordaCity._id }, { code: 1, number: 1, name: 1 }).lean();
    const existingCodes = new Set(existingFridges.map(f => f.code));
    
    // Создаем Set для проверки дубликатов по комбинации (number + name)
    // Ключ: "number|name" или просто "name" если number нет
    const existingCombinations = new Set();
    existingFridges.forEach(f => {
      const key = f.number && f.number.trim() !== '' 
        ? `${f.number}|${f.name}` 
        : f.name;
      existingCombinations.add(key);
    });

    const recordsToInsert = [];
    const seenInBatch = new Set(); // Для проверки дубликатов внутри текущего импорта
    let duplicates = 0;

    for (const record of records) {
      // Проверяем дубликаты по code
      if (existingCodes.has(record.code)) {
        duplicates++;
        continue;
      }

      // Проверяем дубликаты по комбинации (number + name)
      const combinationKey = record.number && record.number.trim() !== ''
        ? `${record.number}|${record.name}`
        : record.name;
      
      // Проверяем в существующих данных
      if (existingCombinations.has(combinationKey)) {
        duplicates++;
        continue;
      }

      // Проверяем дубликаты внутри текущего батча (если в Excel есть дубликаты)
      if (seenInBatch.has(combinationKey)) {
        duplicates++;
        continue;
      }

      recordsToInsert.push(record);
      existingCodes.add(record.code);
      existingCombinations.add(combinationKey);
      seenInBatch.add(combinationKey);
    }

    console.log(`  Новых записей: ${recordsToInsert.length}`);
    console.log(`  Дубликатов: ${duplicates}\n`);

    if (recordsToInsert.length === 0) {
      console.log('⚠ Все записи уже существуют в базе данных');
      await mongoose.connection.close();
      return;
    }

    // Вставляем записи батчами по 100
    let imported = 0;
    let errors = 0;

    for (let i = 0; i < recordsToInsert.length; i += 100) {
      const batch = recordsToInsert.slice(i, i + 100);
      try {
        await Fridge.insertMany(batch, { ordered: false });
        imported += batch.length;
        console.log(`  Импортировано: ${imported}/${recordsToInsert.length}`);
      } catch (err) {
        // Обрабатываем ошибки дубликатов
        if (err.code === 11000) {
          const duplicateCount = err.writeErrors ? err.writeErrors.length : batch.length;
          errors += duplicateCount;
          imported += (batch.length - duplicateCount);
          console.log(`  Предупреждение: ${duplicateCount} дубликатов в батче`);
        } else {
          console.error(`  Ошибка при импорте батча:`, err.message);
          errors += batch.length;
        }
      }
    }

    console.log('\n=== Итоговая статистика ===');
    console.log(`✅ Импортировано: ${imported}`);
    console.log(`⚠ Дубликатов: ${duplicates + errors}`);
    console.log(`❌ Ошибок: ${errors > duplicates ? errors - duplicates : 0}`);
    console.log(`📊 Всего обработано: ${processed}`);

    if (imported > 0) {
      console.log('\n✅ Импорт завершен успешно!');
      console.log(`📦 Импортировано ${imported} холодильников для города ${kyzylordaCity.name}`);
    }

    await mongoose.connection.close();
    console.log('\n✅ Скрипт завершен');

  } catch (error) {
    console.error('❌ Критическая ошибка:', error);
    console.error(error.stack);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Запуск скрипта
if (require.main === module) {
  const excelFilePath = process.argv[2];
  importKyzylordaFridges(excelFilePath)
    .then(() => {
      console.log('\n✅ Скрипт завершен успешно');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Скрипт завершен с ошибкой:', error);
      process.exit(1);
    });
}

module.exports = importKyzylordaFridges;
