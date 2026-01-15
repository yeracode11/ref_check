const XLSX = require('xlsx');
const path = require('path');

/**
 * Скрипт для анализа структуры Excel файла для Кызылорды
 */
function analyzeKyzylordaExcel() {
  try {
    const excelFilePath = path.join(__dirname, '..', 'kyzylorda.xlsx');
    
    console.log('=== Анализ Excel файла для Кызылорды ===');
    console.log(`Файл: ${excelFilePath}\n`);
    
    const workbook = XLSX.readFile(excelFilePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    console.log(`✓ Лист: ${sheetName}\n`);
    
    // Читаем как массив массивов
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });
    
    console.log(`✓ Прочитано строк: ${rawData.length}\n`);
    
    if (rawData.length === 0) {
      console.log('⚠ Файл пустой');
      return;
    }
    
    // Показываем первые 15 строк для анализа
    console.log('=== Первые 15 строк файла ===');
    rawData.slice(0, 15).forEach((row, i) => {
      console.log(`\nСтрока ${i + 1}:`);
      if (Array.isArray(row)) {
        row.forEach((cell, j) => {
          if (cell !== null && cell !== undefined && String(cell).trim() !== '') {
            console.log(`  [${j}]: ${String(cell).substring(0, 50)}`);
          }
        });
      }
    });
    
    // Ищем строку с заголовками
    console.log('\n=== Поиск строки с заголовками ===');
    let headerRow = -1;
    for (let i = 0; i < Math.min(15, rawData.length); i++) {
      const row = rawData[i];
      if (row && Array.isArray(row)) {
        const rowStr = row.map(cell => String(cell || '').toLowerCase()).join(' ');
        if (rowStr.includes('адрес') || rowStr.includes('контрагент')) {
          headerRow = i;
          console.log(`✓ Найдена строка с заголовками на индексе: ${i}`);
          break;
        }
      }
    }
    
    if (headerRow === -1) {
      console.log('⚠ Строка с заголовками не найдена автоматически');
      console.log('Проверяем первые строки вручную...\n');
      headerRow = 0; // Предполагаем, что заголовки в первой строке
    }
    
    const headers = rawData[headerRow] || [];
    console.log('\n=== Найденные заголовки ===');
    headers.forEach((h, i) => {
      if (h && String(h).trim() !== '') {
        console.log(`  [${i}]: "${String(h).trim()}"`);
      }
    });
    
    // Функция для поиска индекса колонки
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
    
    // Ищем нужные колонки
    console.log('\n=== Поиск колонок ===');
    const contractorIdx = findColumnIndex(['контрагент']);
    const contractNumIdx = findColumnIndex(['номер', 'договор', 'дог']);
    const quantityIdx = findColumnIndex(['количество', 'кол-во']);
    const spvIdx = findColumnIndex(['спв']);
    const addressIdx = findColumnIndex(['адрес']);
    const tpIdx = findColumnIndex(['тп']);
    
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
    // Если не нашли специфичную колонку, ищем просто "номер" или "код" (но не договор)
    if (fridgeNumberIdx === -1) {
      for (let i = 0; i < headers.length; i++) {
        const header = String(headers[i] || '').toLowerCase();
        if ((header === 'номер' || header === 'код') && i !== contractNumIdx) {
          fridgeNumberIdx = i;
          break;
        }
      }
    }
    
    console.log(`  Контрагент: ${contractorIdx >= 0 ? `[${contractorIdx}] "${headers[contractorIdx]}"` : 'НЕ НАЙДЕНА'}`);
    console.log(`  Номер договора: ${contractNumIdx >= 0 ? `[${contractNumIdx}] "${headers[contractNumIdx]}"` : 'НЕ НАЙДЕНА'}`);
    console.log(`  Количество: ${quantityIdx >= 0 ? `[${quantityIdx}] "${headers[quantityIdx]}"` : 'НЕ НАЙДЕНА'}`);
    console.log(`  СПВ: ${spvIdx >= 0 ? `[${spvIdx}] "${headers[spvIdx]}"` : 'НЕ НАЙДЕНА'}`);
    console.log(`  Адрес: ${addressIdx >= 0 ? `[${addressIdx}] "${headers[addressIdx]}"` : 'НЕ НАЙДЕНА'}`);
    console.log(`  ТП: ${tpIdx >= 0 ? `[${tpIdx}] "${headers[tpIdx]}"` : 'НЕ НАЙДЕНА'}`);
    console.log(`  Номер холодильника: ${fridgeNumberIdx >= 0 ? `[${fridgeNumberIdx}] "${headers[fridgeNumberIdx]}"` : 'НЕ НАЙДЕНА'}`);
    
    // Показываем примеры данных из первых строк
    console.log('\n=== Примеры данных (первые 3 строки после заголовков) ===');
    const dataStartRow = headerRow + 1;
    for (let i = dataStartRow; i < Math.min(dataStartRow + 3, rawData.length); i++) {
      const row = rawData[i];
      if (!row || !Array.isArray(row)) continue;
      
      console.log(`\nСтрока ${i + 1}:`);
      if (contractorIdx >= 0) {
        console.log(`  Контрагент: ${row[contractorIdx] || '(пусто)'}`);
      }
      if (addressIdx >= 0) {
        console.log(`  Адрес: ${row[addressIdx] || '(пусто)'}`);
      }
      if (fridgeNumberIdx >= 0) {
        console.log(`  Номер холодильника: ${row[fridgeNumberIdx] || '(пусто)'}`);
      }
      if (contractNumIdx >= 0) {
        console.log(`  Номер договора: ${row[contractNumIdx] || '(пусто)'}`);
      }
    }
    
    // Статистика
    console.log('\n=== Статистика ===');
    let rowsWithData = 0;
    let rowsWithAddress = 0;
    let rowsWithContractor = 0;
    let rowsWithNumber = 0;
    
    for (let i = dataStartRow; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || !Array.isArray(row)) continue;
      
      const hasAddress = addressIdx >= 0 && row[addressIdx] && String(row[addressIdx]).trim() !== '';
      const hasContractor = contractorIdx >= 0 && row[contractorIdx] && String(row[contractorIdx]).trim() !== '';
      const hasNumber = fridgeNumberIdx >= 0 && row[fridgeNumberIdx] && String(row[fridgeNumberIdx]).trim() !== '';
      
      if (hasAddress || hasContractor) {
        rowsWithData++;
      }
      if (hasAddress) rowsWithAddress++;
      if (hasContractor) rowsWithContractor++;
      if (hasNumber) rowsWithNumber++;
    }
    
    console.log(`  Всего строк данных: ${rowsWithData}`);
    console.log(`  Строк с адресом: ${rowsWithAddress}`);
    console.log(`  Строк с контрагентом: ${rowsWithContractor}`);
    console.log(`  Строк с номером холодильника: ${rowsWithNumber}`);
    
    console.log('\n=== Рекомендации ===');
    if (fridgeNumberIdx === -1) {
      console.log('⚠ ВНИМАНИЕ: Колонка с номером холодильника не найдена!');
      console.log('  Для Кызылорды нужна колонка с названием типа:');
      console.log('  - "Номер холодильника"');
      console.log('  - "Код холодильника"');
      console.log('  - "Номер" (если нет колонки "Номер договора")');
    } else {
      console.log('✓ Колонка с номером холодильника найдена - импорт должен работать корректно');
    }
    
    if (addressIdx === -1 && contractorIdx === -1) {
      console.log('⚠ ВНИМАНИЕ: Не найдены колонки "Адрес" или "Контрагент"!');
      console.log('  Импорт может не работать корректно.');
    }
    
    console.log('\n✅ Анализ завершен');
    
  } catch (error) {
    console.error('❌ Ошибка при анализе файла:', error);
    console.error(error.stack);
  }
}

// Запуск
if (require.main === module) {
  analyzeKyzylordaExcel();
}

module.exports = analyzeKyzylordaExcel;
