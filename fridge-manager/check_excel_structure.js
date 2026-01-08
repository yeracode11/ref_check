const XLSX = require('xlsx');

function checkExcelStructure(excelFilePath) {
  try {
    console.log('=== Проверка структуры Excel файла ===');
    console.log(`Файл: ${excelFilePath}\n`);
    
    const workbook = XLSX.readFile(excelFilePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Читаем как массив массивов
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    
    console.log(`✓ Прочитано строк: ${rawData.length}\n`);

    // Показываем первые 10 строк
    console.log('=== Первые 10 строк файла ===');
    rawData.slice(0, 10).forEach((row, i) => {
      console.log(`Строка ${i + 1}:`, row.slice(0, 10));
    });

    // Ищем строку с заголовками
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
      const rowStr = row.join('|').toLowerCase();
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
      console.log('\n❌ Не найдена строка с заголовками колонок!');
      return;
    }

    console.log(`\n✓ Найдены заголовки в строке ${headerRowIndex + 1}`);
    console.log('\n=== Заголовки колонок ===');
    headers.forEach((h, i) => {
      if (h) console.log(`  Колонка ${i + 1}: "${h}"`);
    });

    // Преобразуем несколько первых строк данных
    const dataRows = rawData.slice(headerRowIndex + 1, headerRowIndex + 6);
    
    console.log('\n=== Первые 5 строк данных ===');
    dataRows.forEach((row, i) => {
      console.log(`\nСтрока ${i + 1}:`);
      headers.forEach((header, idx) => {
        if (header && row[idx]) {
          console.log(`  ${header}: ${row[idx]}`);
        }
      });
    });

    // Определяем нужные колонки
    const getColumnIndex = (headers, possibleNames) => {
      for (const name of possibleNames) {
        const idx = headers.findIndex(h => 
          h.toLowerCase().trim() === name.toLowerCase().trim()
        );
        if (idx !== -1) return idx;
      }
      return -1;
    };

    const contractorIdx = getColumnIndex(headers, ['Контрагент', 'контрагент']);
    const addressIdx = getColumnIndex(headers, ['Фактический адрес контрагента', 'Адрес', 'адрес']);
    const contractIdx = getColumnIndex(headers, ['Договор', 'договор']);
    const codeIdx = getColumnIndex(headers, ['Номер', 'номер', 'Оборудование Номер ХО']);

    console.log('\n=== Найденные колонки ===');
    console.log(`Контрагент: ${contractorIdx !== -1 ? `Колонка ${contractorIdx + 1} (${headers[contractorIdx]})` : '❌ НЕ НАЙДЕНО'}`);
    console.log(`Адрес: ${addressIdx !== -1 ? `Колонка ${addressIdx + 1} (${headers[addressIdx]})` : '❌ НЕ НАЙДЕНО'}`);
    console.log(`Договор: ${contractIdx !== -1 ? `Колонка ${contractIdx + 1} (${headers[contractIdx]})` : '⚠ НЕ НАЙДЕНО (не обязательно)'}`);
    console.log(`Номер ХО: ${codeIdx !== -1 ? `Колонка ${codeIdx + 1} (${headers[codeIdx]})` : '❌ НЕ НАЙДЕНО'}`);

    if (contractorIdx === -1 || addressIdx === -1 || codeIdx === -1) {
      console.log('\n❌ Не все обязательные колонки найдены!');
    } else {
      console.log('\n✅ Все обязательные колонки найдены!');
      
      // Подсчитываем непустые строки
      let validRows = 0;
      for (let i = headerRowIndex + 1; i < rawData.length; i++) {
        const row = rawData[i];
        const code = row[codeIdx] ? String(row[codeIdx]).trim() : '';
        const contractor = row[contractorIdx] ? String(row[contractorIdx]).trim() : '';
        const address = row[addressIdx] ? String(row[addressIdx]).trim() : '';
        
        if (code && contractor && address) {
          validRows++;
        }
      }
      
      console.log(`\n📊 Статистика:`);
      console.log(`  Всего строк в файле: ${rawData.length}`);
      console.log(`  Строка с заголовками: ${headerRowIndex + 1}`);
      console.log(`  Строк данных: ${rawData.length - headerRowIndex - 1}`);
      console.log(`  Валидных строк (с заполненными обязательными полями): ${validRows}`);
    }

  } catch (error) {
    console.error('\n❌ Ошибка:', error.message);
  }
}

const filePath = process.argv[2];

if (!filePath) {
  console.log('❌ Не указан путь к Excel файлу!');
  console.log('\nИспользование:');
  console.log('  node check_excel_structure.js путь/к/файлу.xlsx');
  console.log('\nПример:');
  console.log('  node check_excel_structure.js ./shymkent_tt.xls');
  process.exit(1);
}

checkExcelStructure(filePath);

