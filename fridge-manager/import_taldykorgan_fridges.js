const mongoose = require('mongoose');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const Fridge = require('./models/Fridge');
const City = require('./models/City');

/**
 * Скрипт для импорта холодильников Талдыкоргана из Excel файла
 * 
 * Использование:
 *   node import_taldykorgan_fridges.js ../taldykorgan.xlsx
 */

async function importTaldykorganFridges(excelPath) {
  try {
    if (!excelPath) {
      console.error('❌ Ошибка: Укажите путь к Excel файлу');
      console.error('   Использование: node import_taldykorgan_fridges.js <путь_к_файлу.xlsx>');
      process.exit(1);
    }

    const fullPath = path.resolve(__dirname, excelPath);
    if (!fs.existsSync(fullPath)) {
      console.error(`❌ Файл не найден: ${fullPath}`);
      process.exit(1);
    }

    console.log('🔌 Подключение к MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✓ Подключено к MongoDB\n');

    // Ищем город Талдыкорган
    const cityNames = ['Талдыкорган', 'Талдыкорған', 'Taldykorgan', 'Taldikorgan'];
    let city = null;
    
    for (const name of cityNames) {
      city = await City.findOne({ 
        $or: [
          { name: name },
          { name: { $regex: new RegExp(name, 'i') } }
        ]
      });
      if (city) {
        console.log(`✓ Найден город: ${city.name} (${city.code})`);
        break;
      }
    }

    if (!city) {
      console.error('❌ Город Талдыкорган не найден в базе данных');
      console.log('\nДоступные города:');
      const allCities = await City.find({});
      allCities.forEach(c => {
        console.log(`  - ${c.name} (${c.code})`);
      });
      await mongoose.connection.close();
      process.exit(1);
    }

    // Читаем Excel файл
    console.log(`\n📖 Чтение Excel файла: ${fullPath}`);
    const workbook = XLSX.readFile(fullPath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    console.log(`✓ Лист: ${sheetName}`);

    // Конвертируем в JSON
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });
    console.log(`✓ Всего строк в файле: ${rawData.length}`);

    // Ищем строку с заголовками
    let headerRow = -1;
    for (let i = 0; i < Math.min(10, rawData.length); i++) {
      const row = rawData[i];
      const rowStr = row.map(cell => String(cell || '').toLowerCase()).join(' ');
      if (rowStr.includes('адрес') || rowStr.includes('контрагент')) {
        headerRow = i;
        break;
      }
    }

    if (headerRow === -1) {
      console.error('❌ Не найдена строка с заголовками');
      await mongoose.connection.close();
      process.exit(1);
    }

    const headers = rawData[headerRow].map(h => String(h || '').trim());
    const dataStartRow = headerRow + 1;
    console.log(`✓ Заголовки найдены в строке ${headerRow + 1}`);
    console.log(`✓ Данные начинаются со строки ${dataStartRow + 1}`);

    // Находим индексы колонок
    const findColumnIndex = (keywords) => {
      for (let i = 0; i < headers.length; i++) {
        const header = String(headers[i] || '').toLowerCase();
        if (keywords.some(keyword => header.includes(keyword))) {
          return i;
        }
      }
      return -1;
    };

    const contractorIdx = findColumnIndex(['контрагент']);
    const addressIdx = findColumnIndex(['адрес']);
    const contractNumIdx = findColumnIndex(['номер', 'договор', 'дог']);
    const quantityIdx = findColumnIndex(['количество', 'кол-во']);
    const spvIdx = findColumnIndex(['спв']);
    const tpIdx = findColumnIndex(['тп']);
    
    // Для Талдыкоргана ищем номер холодильника (если есть)
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
    if (fridgeNumberIdx === -1) {
      for (let i = 0; i < headers.length; i++) {
        const header = String(headers[i] || '').toLowerCase();
        if ((header === 'номер' || header === 'код') && i !== contractNumIdx) {
          fridgeNumberIdx = i;
          break;
        }
      }
    }

    console.log('\n📋 Найденные колонки:');
    console.log(`   Контрагент: ${contractorIdx >= 0 ? headers[contractorIdx] : 'не найдено'}`);
    console.log(`   Адрес: ${addressIdx >= 0 ? headers[addressIdx] : 'не найдено'}`);
    if (fridgeNumberIdx >= 0) {
      console.log(`   Номер холодильника: ${headers[fridgeNumberIdx]}`);
    }

    if (contractorIdx === -1 || addressIdx === -1) {
      console.error('❌ Не найдены обязательные колонки (Контрагент, Адрес)');
      await mongoose.connection.close();
      process.exit(1);
    }

    // Парсим данные
    const records = [];
    let skippedNoAddress = 0;

    for (let i = dataStartRow; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || row.length === 0) continue;

      const contractor = String(row[contractorIdx] || '').trim();
      const address = String(row[addressIdx] || '').trim();

      if (!contractor && !address) {
        skippedNoAddress++;
        continue;
      }

      if (!address) {
        skippedNoAddress++;
        continue;
      }

      // Формируем название холодильника
      let name = contractor || 'Холодильник';
      if (contractNumIdx >= 0 && row[contractNumIdx]) {
        name += ` #${row[contractNumIdx]}`;
      }

      // Описание из дополнительных полей
      const descriptionParts = [];
      if (quantityIdx >= 0 && row[quantityIdx]) {
        descriptionParts.push(`Количество: ${row[quantityIdx]}`);
      }
      if (spvIdx >= 0 && row[spvIdx]) {
        descriptionParts.push(`СПВ: ${row[spvIdx]}`);
      }
      if (tpIdx >= 0 && row[tpIdx]) {
        descriptionParts.push(`ТП: ${row[tpIdx]}`);
      }
      const description = descriptionParts.length > 0 ? descriptionParts.join(', ') : null;

      // Номер холодильника (обязателен для Талдыкоргана, как в Шымкенте)
      const fridgeNumber = fridgeNumberIdx >= 0 && row[fridgeNumberIdx] 
        ? String(row[fridgeNumberIdx]).trim() 
        : null;

      if (!fridgeNumber) {
        console.warn(`  Пропущена строка ${i + 1}: нет номера холодильника`);
        continue;
      }

      // Для Талдыкоргана используем номер из Excel как code (как в Шымкенте)
      records.push({
        code: fridgeNumber, // Используем номер как code
        name: name.substring(0, 200),
        address: address.substring(0, 500),
        description: description ? description.substring(0, 500) : null,
        cityId: city._id,
        number: fridgeNumber, // Также сохраняем в number
      });
    }

    console.log(`\n✓ Найдено записей для импорта: ${records.length}`);
    console.log(`  Пропущено (нет адреса): ${skippedNoAddress}`);

    if (records.length === 0) {
      console.log('\n❌ Нет данных для импорта');
      await mongoose.connection.close();
      process.exit(1);
    }

    // Проверяем дубликаты по code (номеру) + name (как в Шымкенте)
    console.log('\n🔍 Проверка дубликатов...');
    const existingFridges = await Fridge.find({ cityId: city._id }, { code: 1, number: 1, name: 1 }).lean();
    const existingCodes = new Set(existingFridges.map(f => f.code));
    const existingByCodeAndName = new Set(
      existingFridges.map(f => `${f.code}|${f.name}`)
    );

    const recordsToInsert = [];
    let duplicates = 0;

    for (const record of records) {
      // Для Талдыкоргана code уже равен номеру из Excel
      const code = record.code;

      // Проверяем дубликат по code (номеру) + name
      const key = `${code}|${record.name}`;
      if (existingByCodeAndName.has(key)) {
        duplicates++;
        continue;
      }

      // Проверяем дубликат по code (если номер уже используется)
      if (existingCodes.has(code)) {
        duplicates++;
        continue;
      }

      existingCodes.add(code);
      existingByCodeAndName.add(key);

      recordsToInsert.push({
        ...record,
        location: {
          type: 'Point',
          coordinates: [0.0, 0.0], // Временные координаты, обновятся при первой отметке
        },
        active: true,
        warehouseStatus: 'warehouse',
      });
    }

    console.log(`✓ Готово к импорту: ${recordsToInsert.length}`);
    console.log(`  Дубликаты: ${duplicates}`);

    if (recordsToInsert.length === 0) {
      console.log('\n❌ Все записи являются дубликатами');
      await mongoose.connection.close();
      process.exit(1);
    }

    // Импортируем батчами
    console.log('\n📦 Импорт в базу данных...');
    const batchSize = 100;
    let imported = 0;
    let errors = 0;

    for (let i = 0; i < recordsToInsert.length; i += batchSize) {
      const batch = recordsToInsert.slice(i, i + batchSize);
      try {
        await Fridge.insertMany(batch, { ordered: false });
        imported += batch.length;
        console.log(`  Импортировано: ${imported}/${recordsToInsert.length}`);
      } catch (batchErr) {
        // Если батч не прошел, пробуем по одной
        for (const record of batch) {
          try {
            const exists = await Fridge.findOne({ code: record.code });
            if (exists) {
              duplicates++;
              continue;
            }
            await Fridge.create(record);
            imported++;
          } catch (err) {
            if (err.code === 11000) {
              duplicates++;
            } else {
              errors++;
              console.error(`  Ошибка при импорте ${record.code}:`, err.message);
            }
          }
        }
      }
    }

    console.log('\n=== Итоговая статистика ===');
    console.log(`✅ Импортировано: ${imported}`);
    console.log(`⚠️  Дубликаты: ${duplicates}`);
    console.log(`❌ Ошибки: ${errors}`);
    console.log(`📊 Всего в файле: ${records.length}`);

    console.log('\n✅ Импорт завершен успешно!');

    await mongoose.connection.close();
    console.log('\n✅ Скрипт завершен');

  } catch (error) {
    console.error('\n❌ Ошибка при импорте:', error);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
    process.exit(1);
  }
}

// Получаем путь к файлу из аргументов
const excelPath = process.argv[2];
importTaldykorganFridges(excelPath);
