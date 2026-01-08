require('dotenv').config();
const mongoose = require('mongoose');
const XLSX = require('xlsx');
const Fridge = require('./models/Fridge');
const City = require('./models/City');
const Counter = require('./models/Counter');
const path = require('path');

async function importShymkentFridges(excelFilePath) {
  try {
    console.log('Подключение к MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✓ Подключено к MongoDB');

    // 1. Ищем город Шымкент
    console.log('\n=== Поиск города Шымкент ===');
    let shymkentCity = await City.findOne({
      name: { $regex: /шымкент|shymkent/i }
    });

    if (!shymkentCity) {
      console.log('⚠ Город Шымкент не найден, создаем...');
      shymkentCity = await City.create({
        name: 'Шымкент',
        coordinates: [69.6038, 42.3417] // Координаты центра Шымкента [lng, lat]
      });
      console.log(`✓ Создан город: ${shymkentCity.name} (ID: ${shymkentCity._id})`);
    } else {
      console.log(`✓ Найден город: ${shymkentCity.name} (ID: ${shymkentCity._id})`);
    }

    // 2. Читаем Excel файл
    console.log('\n=== Чтение Excel файла ===');
    console.log(`Файл: ${excelFilePath}`);
    
    const workbook = XLSX.readFile(excelFilePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Читаем как массив массивов, чтобы найти строку с заголовками
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    
    console.log(`✓ Прочитано строк (сырых): ${rawData.length}`);

    if (rawData.length === 0) {
      console.log('⚠ Файл пустой или не содержит данных');
      await mongoose.connection.close();
      return;
    }

    // Ищем строку с заголовками (где есть "Контрагент")
    let headerRowIndex = -1;
    let headers = [];
    
    for (let i = 0; i < Math.min(10, rawData.length); i++) {
      const row = rawData[i];
      const rowStr = row.join('|').toLowerCase();
      if (rowStr.includes('контрагент') || rowStr.includes('оборудование')) {
        headerRowIndex = i;
        headers = row.map(h => String(h).trim());
        break;
      }
    }

    if (headerRowIndex === -1) {
      console.log('❌ Не найдена строка с заголовками колонок!');
      console.log('Первые 5 строк файла:');
      rawData.slice(0, 5).forEach((row, i) => {
        console.log(`  Строка ${i + 1}:`, row.slice(0, 5));
      });
      await mongoose.connection.close();
      return;
    }

    console.log(`✓ Найдены заголовки в строке ${headerRowIndex + 1}`);
    console.log('Заголовки:', headers.filter(h => h));

    // Преобразуем данные начиная со следующей строки после заголовков
    const dataRows = rawData.slice(headerRowIndex + 1);
    const data = dataRows.map(row => {
      const obj = {};
      headers.forEach((header, idx) => {
        if (header) {
          obj[header] = row[idx] || '';
        }
      });
      return obj;
    }).filter(row => {
      // Пропускаем полностью пустые строки
      return Object.values(row).some(val => String(val).trim());
    });

    console.log(`✓ Обработано строк данных: ${data.length}`);

    if (data.length === 0) {
      console.log('⚠ Нет данных после заголовков');
      await mongoose.connection.close();
      return;
    }

    // 3. Показываем первую строку для проверки
    console.log('\n=== Пример первой строки данных ===');
    console.log(JSON.stringify(data[0], null, 2));
    console.log('\n=== Доступные колонки ===');
    console.log(Object.keys(data[0]));

    // 4. Определяем названия колонок (могут быть пробелы/вариации)
    const getColumnName = (row, possibleNames) => {
      const keys = Object.keys(row);
      for (const name of possibleNames) {
        // Точное совпадение
        if (keys.includes(name)) return name;
        // Поиск с игнорированием регистра и пробелов
        const found = keys.find(k => 
          k.toLowerCase().trim() === name.toLowerCase().trim()
        );
        if (found) return found;
      }
      return null;
    };

    const firstRow = data[0];
    const contractorCol = getColumnName(firstRow, ['Контрагент', 'контрагент', 'Контрагенты']);
    const addressCol = getColumnName(firstRow, ['Фактический адрес контрагента', 'Адрес', 'адрес', 'Фактический адрес']);
    const contractCol = getColumnName(firstRow, ['Договор', 'договор', 'Номер договора']);
    const codeCol = getColumnName(firstRow, ['Номер', 'номер', 'Оборудование Номер ХО', 'Номер ХО', 'Код', 'код']);

    console.log('\n=== Определенные колонки ===');
    console.log(`Контрагент: ${contractorCol}`);
    console.log(`Адрес: ${addressCol}`);
    console.log(`Договор: ${contractCol}`);
    console.log(`Номер ХО: ${codeCol}`);

    if (!contractorCol || !addressCol || !codeCol) {
      console.log('\n❌ Не все обязательные колонки найдены!');
      console.log('Обязательные: Контрагент, Фактический адрес контрагента, Номер');
      console.log('\nДоступные колонки в файле:');
      Object.keys(firstRow).forEach((k, i) => console.log(`  ${i + 1}. "${k}"`));
      await mongoose.connection.close();
      return;
    }

    // 5. Подтверждение
    console.log(`\n⚠️  ВНИМАНИЕ: Будет создано ${data.length} холодильников в Шымкенте!`);
    console.log('\nДля подтверждения запустите скрипт с флагом --confirm:');
    console.log(`node import_shymkent_fridges.js "${excelFilePath}" --confirm`);

    if (!process.argv.includes('--confirm')) {
      console.log('\n✓ Предварительный просмотр завершен (импорт не выполнен)');
      await mongoose.connection.close();
      return;
    }

    // 6. Импорт данных
    console.log('\n=== Импорт холодильников ===');
    
    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      
      try {
        const contractorName = row[contractorCol]?.toString().trim();
        const address = row[addressCol]?.toString().trim();
        const contractNumber = row[contractCol]?.toString().trim() || '';
        let fridgeCode = row[codeCol]?.toString().trim();

        // Пропускаем пустые строки
        if (!contractorName || !address || !fridgeCode) {
          console.log(`⚠ Строка ${i + 1}: Пропущена (пустые обязательные поля)`);
          skipped++;
          continue;
        }

        // Проверяем, существует ли уже холодильник с таким кодом
        const existing = await Fridge.findOne({ code: fridgeCode });
        if (existing) {
          console.log(`⚠ Строка ${i + 1}: Холодильник с кодом "${fridgeCode}" уже существует`);
          skipped++;
          continue;
        }

        // Создаем холодильник
        // Используем координаты центра Шымкента, т.к. точные координаты неизвестны
        const fridge = await Fridge.create({
          code: fridgeCode,
          name: `ХО ${fridgeCode}`,
          cityId: shymkentCity._id,
          location: {
            type: 'Point',
            coordinates: [69.6038, 42.3417] // Центр Шымкента
          },
          address: address,
          description: `Импортировано из Excel`,
          active: true,
          warehouseStatus: 'warehouse', // По умолчанию на складе
          clientInfo: {
            name: contractorName,
            contractNumber: contractNumber,
            notes: 'Импортировано из Excel'
          }
        });

        console.log(`✓ Строка ${i + 1}: Создан "${fridge.code}" - ${contractorName}`);
        created++;

      } catch (error) {
        console.error(`❌ Строка ${i + 1}: Ошибка - ${error.message}`);
        errors++;
      }
    }

    console.log('\n=== Результаты импорта ===');
    console.log(`✓ Создано: ${created}`);
    console.log(`⚠ Пропущено: ${skipped}`);
    console.log(`❌ Ошибок: ${errors}`);
    console.log(`📊 Всего строк: ${data.length}`);

    console.log('\n✅ Импорт завершен!');
    console.log('\n⚠️  ВАЖНО: Все холодильники созданы с координатами центра Шымкента.');
    console.log('После первой отметки координаты обновятся автоматически.');

    await mongoose.connection.close();
    console.log('✓ Соединение с MongoDB закрыто');

  } catch (error) {
    console.error('\n❌ Ошибка:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Проверяем аргументы командной строки
const filePath = process.argv[2];

if (!filePath) {
  console.log('❌ Не указан путь к Excel файлу!');
  console.log('\nИспользование:');
  console.log('  node import_shymkent_fridges.js путь/к/файлу.xlsx');
  console.log('  node import_shymkent_fridges.js путь/к/файлу.xlsx --confirm');
  console.log('\nПример:');
  console.log('  node import_shymkent_fridges.js ./shymkent.xlsx');
  console.log('  node import_shymkent_fridges.js ./shymkent.xlsx --confirm');
  process.exit(1);
}

importShymkentFridges(filePath);


