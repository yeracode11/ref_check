require('dotenv').config();
const mongoose = require('mongoose');
const XLSX = require('xlsx');
const https = require('https');
const Fridge = require('./models/Fridge');
const City = require('./models/City');
const Counter = require('./models/Counter');
const path = require('path');

// Функция для геокодирования адреса через Nominatim (OpenStreetMap)
// Бесплатный сервис, не требует API ключа!
async function geocodeAddress(address) {
  return new Promise((resolve, reject) => {
    // Добавляем "Казахстан, Шымкент" для более точных результатов
    const fullAddress = `${address}, Шымкент, Казахстан`;
    const encodedAddress = encodeURIComponent(fullAddress);
    
    // Nominatim API (OpenStreetMap)
    // Бесплатный, но требует User-Agent
    const url = `https://nominatim.openstreetmap.org/search?q=${encodedAddress}&format=json&limit=1&countrycodes=kz`;

    const options = {
      headers: {
        'User-Agent': 'RefCheckFridgeManager/1.0' // Обязательно для Nominatim
      }
    };

    https.get(url, options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          
          if (json && json.length > 0) {
            const result = json[0];
            const lat = parseFloat(result.lat);
            const lng = parseFloat(result.lon);
            
            // Проверяем, что координаты в пределах Шымкента
            // Шымкент: примерно 42.2-42.5 lat, 69.4-69.8 lng
            if (lat >= 42.0 && lat <= 43.0 && lng >= 69.0 && lng <= 70.5) {
              resolve([lng, lat]);
            } else {
              console.warn(`⚠ Координаты вне Шымкента: [${lat}, ${lng}] для "${address}"`);
              resolve(null);
            }
          } else {
            resolve(null);
          }
        } catch (err) {
          console.error(`Ошибка парсинга геокодирования: ${err.message}`);
          resolve(null);
        }
      });
    }).on('error', (err) => {
      console.error(`Ошибка геокодирования: ${err.message}`);
      resolve(null);
    });
  });
}

// Функция задержки для ограничения запросов к API
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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
    // Это должна быть строка с короткими значениями (не длинный текст),
    // которая содержит "Контрагент" и другие колонки
    let headerRowIndex = -1;
    let headers = [];
    
    for (let i = 0; i < Math.min(15, rawData.length); i++) {
      const row = rawData[i];
      
      // Проверяем, что это короткие значения (не описание)
      const hasShortValues = row.some(cell => {
        const str = String(cell).trim();
        return str.length > 0 && str.length < 100 && !str.includes('\n');
      });
      
      if (!hasShortValues) continue;
      
      // Ищем строку с ключевыми заголовками
      const hasContractor = row.some(cell => String(cell).trim().toLowerCase() === 'контрагент');
      const hasAddress = row.some(cell => String(cell).trim().toLowerCase().includes('адрес'));
      const hasNumber = row.some(cell => String(cell).trim().toLowerCase() === 'номер');
      
      if (hasContractor && (hasAddress || hasNumber)) {
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
    let geocoded = 0;
    let geocodeFailed = 0;

    // Используем Nominatim (OpenStreetMap) для геокодирования - бесплатно!
    console.log('✓ Используется Nominatim (OpenStreetMap) для геокодирования адресов');
    console.log('  Бесплатный сервис, API ключ не требуется!');
    const useGeocoding = true;

    // Функция для генерации случайных координат в пределах Шымкента (fallback)
    const getRandomShymkentCoordinates = () => {
      const centerLng = 69.6038;
      const centerLat = 42.3417;
      const randomLng = centerLng + (Math.random() - 0.5) * 0.2;
      const randomLat = centerLat + (Math.random() - 0.5) * 0.2;
      return [randomLng, randomLat];
    };

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

        // Геокодируем адрес (преобразуем текстовый адрес в GPS координаты)
        let coordinates = null;
        if (useGeocoding && address) {
          try {
            coordinates = await geocodeAddress(address);
            if (coordinates) {
              geocoded++;
              console.log(`✓ Строка ${i + 1}: Геокодирован "${address}" -> [${coordinates[1].toFixed(4)}, ${coordinates[0].toFixed(4)}]`);
            } else {
              geocodeFailed++;
              console.warn(`⚠ Строка ${i + 1}: Не удалось геокодировать "${address}"`);
            }
            // Задержка 1 сек между запросами к API (требование Nominatim: max 1 req/sec)
            await delay(1000);
          } catch (err) {
            geocodeFailed++;
            console.warn(`⚠ Строка ${i + 1}: Ошибка геокодирования "${address}": ${err.message}`);
          }
        }

        // Если геокодирование не удалось, используем случайные координаты
        if (!coordinates) {
          coordinates = getRandomShymkentCoordinates();
        }

        // Создаем холодильник
        const fridge = await Fridge.create({
          code: fridgeCode,
          name: contractorName, // Название = название клиента
          cityId: shymkentCity._id,
          location: {
            type: 'Point',
            coordinates: coordinates
          },
          address: address,
          description: `Импортировано из Excel. Договор: ${contractNumber || 'не указан'}`,
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
    
    if (useGeocoding) {
      console.log('\n=== Геокодирование (Nominatim/OpenStreetMap) ===');
      console.log(`✓ Успешно геокодировано: ${geocoded}`);
      console.log(`⚠ Не удалось геокодировать: ${geocodeFailed}`);
      if ((geocoded + geocodeFailed) > 0) {
        console.log(`📍 Точность: ${((geocoded / (geocoded + geocodeFailed)) * 100).toFixed(1)}%`);
      }
    }

    console.log('\n✅ Импорт завершен!');
    console.log('\n📋 Информация:');
    console.log('  ✓ Названия холодильников = названия клиентов из Excel');
    console.log('  ✓ Адреса сохранены из колонки "Фактический адрес контрагента"');
    if (useGeocoding) {
      console.log('  ✓ GPS координаты получены через Nominatim (OpenStreetMap) - бесплатно!');
      if (geocodeFailed > 0) {
        console.log(`  ⚠ ${geocodeFailed} адресов не геокодированы (используются случайные координаты)`);
      }
    }
    console.log('  ✓ Все холодильники имеют статус "На складе" (warehouse)');

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


