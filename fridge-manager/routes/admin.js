const express = require('express');
const multer = require('multer');
const bcrypt = require('bcrypt');
const Fridge = require('../models/Fridge');
const Checkin = require('../models/Checkin');
const City = require('../models/City');
const User = require('../models/User');
const { authenticateToken, requireAdmin, requireAdminOrAccountant } = require('../middleware/auth');
const XLSX = require('xlsx');

// Настройка multer для загрузки файлов в память
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB максимум
  },
  fileFilter: (req, file, cb) => {
    console.log('[Multer] File filter called:', {
      fieldname: file.fieldname,
      originalname: file.originalname,
      mimetype: file.mimetype,
      encoding: file.encoding
    });
    
    // Проверяем тип файла
    const allowedMimes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'application/octet-stream', // иногда Excel файлы имеют этот тип
    ];
    
    if (allowedMimes.includes(file.mimetype) || file.originalname.match(/\.(xlsx|xls)$/i)) {
      console.log('[Multer] File accepted');
      cb(null, true);
    } else {
      console.log('[Multer] File rejected, mimetype:', file.mimetype);
      cb(new Error('Неподдерживаемый тип файла. Разрешены только .xlsx и .xls файлы.'));
    }
  },
});

const router = express.Router();

// GET /api/admin/fridge-status
// Возвращает список холодильников с последней датой посещения и статусом для карты
// Поддерживает пагинацию через параметры limit и skip
// Для бухгалтеров возвращает только холодильники их города
router.get('/fridge-status', authenticateToken, requireAdminOrAccountant, async (req, res) => {
  try {
    const { limit, skip, all } = req.query;
    
    // Если all=true, возвращаем все холодильники (для карты)
    const shouldPaginate = all !== 'true';
    const limitNum = shouldPaginate && limit ? Math.max(1, Math.min(100, Number(limit))) : undefined;
    const skipNum = shouldPaginate && skip ? Math.max(0, Number(skip)) : 0;

    // Агрегируем статистику по каждому холодильнику: получаем все отметки для анализа
    const statsByFridgeId = new Map();
    const checkinStats = await Checkin.aggregate([
      { $sort: { fridgeId: 1, visitedAt: 1 } }, // Сортируем по дате
      {
        $group: {
          _id: '$fridgeId',
          firstVisit: { $first: '$visitedAt' },
          firstLocation: { $first: '$location' },
          lastVisit: { $last: '$visitedAt' },
          lastLocation: { $last: '$location' },
          // Собираем все локации для проверки последних отметок
          allLocations: { $push: '$location' },
          totalCheckins: { $sum: 1 },
        },
      },
    ]);

    checkinStats.forEach((s) => {
      if (s && s._id) {
        // Получаем предпоследнюю локацию (если есть)
        const secondLastLocation = s.allLocations && s.allLocations.length >= 2 
          ? s.allLocations[s.allLocations.length - 2] 
          : null;
        
        statsByFridgeId.set(s._id, {
          lastVisit: s.lastVisit,
          firstLocation: s.firstLocation,
          lastLocation: s.lastLocation,
          secondLastLocation: secondLastLocation,
          totalCheckins: s.totalCheckins,
        });
      }
    });

    // Для бухгалтера фильтруем по городу
    let fridgeQuery = {};
    if (req.user.role === 'accountant' && req.user.cityId) {
      fridgeQuery.cityId = req.user.cityId;
    }

    // Получаем общее количество для пагинации
    const total = await Fridge.countDocuments(fridgeQuery);

    // Получаем холодильники с пагинацией (если нужно)
    let query = Fridge.find(fridgeQuery).populate('cityId', 'name code');
    if (shouldPaginate && limitNum) {
      query = query.limit(limitNum).skip(skipNum);
    }
    const fridges = await query;

    const now = Date.now();

    // Функция для вычисления расстояния между двумя точками (в метрах)
    function calculateDistance(loc1, loc2) {
      if (!loc1 || !loc2 || !loc1.coordinates || !loc2.coordinates) {
        return null;
      }
      const [lng1, lat1] = loc1.coordinates;
      const [lng2, lat2] = loc2.coordinates;
      
      // Формула гаверсинуса для расчета расстояния между двумя точками на сфере
      const R = 6371000; // Радиус Земли в метрах
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLng = (lng2 - lng1) * Math.PI / 180;
      const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    }

    const result = fridges.map((f) => {
      const stats = statsByFridgeId.get(f.code) || null;
      const lastVisit = stats ? stats.lastVisit : null;
      const firstLocation = stats ? stats.firstLocation : null;
      const lastLocation = stats ? stats.lastLocation : null;
      const secondLastLocation = stats ? stats.secondLastLocation : null;
      const totalCheckins = stats ? stats.totalCheckins : 0;

      // Определяем статус визита
      let visitStatus = 'never';
      if (lastVisit) {
        const diffDays = (now - new Date(lastVisit).getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays < 1) visitStatus = 'today';
        else if (diffDays < 7) visitStatus = 'week';
        else visitStatus = 'old';
      }

      // Определяем статус для отображения на карте
      // Новая логика: 
      // - При первой отметке (totalCheckins === 1) - зеленый
      // - При второй и последующих отметках - сравниваем ПОСЛЕДНИЕ ДВЕ координаты (не первую и последнюю!)
      // - Если последние 2 координаты в пределах 50м - зеленый (местоположение стабилизировалось)
      // - Если последние 2 координаты далеко друг от друга (>50м) - красный (холодильник перемещается)
      // - Это позволяет показать зеленый, если после перемещения холодильник снова отмечен в стабильном месте
      let status;
      const warehouseStatus = f.warehouseStatus || 'warehouse';
      
      if (!lastVisit) {
        // Нет посещений - проверяем warehouseStatus
        if (warehouseStatus === 'moved') {
          // Холодильник был перемещен ранее (даже если нет новых отметок)
          status = 'location_changed'; // Красный
        } else {
          // На складе, возврат или установлен без отметок - серый
          // Желтый цвет только для старых отметок (> недели), а не для отсутствия отметок
          status = 'never';
        }
      } else if (totalCheckins === 1) {
        // Первая отметка - всегда зеленый
        status = visitStatus; // today, week, или old
      } else if (totalCheckins >= 2 && lastLocation && secondLastLocation) {
        // Вторая и последующие отметки - сравниваем ПОСЛЕДНИЕ ДВЕ координаты
        const distance = calculateDistance(secondLastLocation, lastLocation);
        if (distance !== null && distance > 50) {
          // Последние 2 отметки далеко друг от друга - холодильник перемещается - красный
          status = 'location_changed';
        } else {
          // Последние 2 отметки близко - местоположение стабилизировалось - зеленый
          status = visitStatus;
        }
      } else {
        // Fallback - если не удалось сравнить координаты, используем warehouseStatus или обычный статус
        if (warehouseStatus === 'moved') {
          status = 'location_changed'; // Красный
        } else {
          status = visitStatus;
        }
      }

      return {
        id: f._id,
        code: f.code,
        name: f.name,
        address: f.address,
        city: f.cityId || null,
        location: f.location,
        lastVisit,
        status, // комбинированный статус для цвета
        warehouseStatus, // статус склада
        visitStatus, // статус последнего визита
        clientInfo: f.clientInfo || null,
      };
    });

    // Если пагинация включена, возвращаем с метаданными
    if (shouldPaginate) {
      return res.json({
        data: result,
        pagination: {
          total,
          limit: limitNum || total,
          skip: skipNum,
          hasMore: limitNum ? (skipNum + result.length) < total : false,
        },
      });
    }

    // Если all=true, возвращаем просто массив (для обратной совместимости с картой)
    return res.json(result);
  } catch (err) {
    return res
      .status(500)
      .json({ error: 'Failed to fetch admin fridge status', details: err.message });
  }
});

// GET /api/admin/export-fridges
// Экспорт всех холодильников в Excel
// Доступно админам (все города) и бухгалтерам (только их город)
router.get('/export-fridges', authenticateToken, requireAdminOrAccountant, async (req, res) => {
  try {
    // Агрегируем последние отметки по каждому холодильнику
    const lastCheckins = await Checkin.aggregate([
      { $sort: { fridgeId: 1, visitedAt: -1 } },
      {
        $group: {
          _id: '$fridgeId',
          lastVisit: { $first: '$visitedAt' },
        },
      },
    ]);

    const lastByFridgeId = new Map();
    lastCheckins.forEach((c) => {
      if (c && c._id) {
        lastByFridgeId.set(c._id, c.lastVisit);
      }
    });

    // Если пользователь бухгалтер — экспортируем только холодильники его города
    const fridgeFilter = {};
    if (req.user.role === 'accountant' && req.user.cityId) {
      fridgeFilter.cityId = req.user.cityId;
    }

    // Получаем холодильники и сортируем: для Шымкента по number, для остальных по code
    const fridges = await Fridge.find(fridgeFilter).populate('cityId', 'name code');
    
    // Сортируем: для Шымкента по number, для остальных по code
    fridges.sort((a, b) => {
      const isShymkentA = a.cityId?.name === 'Шымкент';
      const isShymkentB = b.cityId?.name === 'Шымкент';
      
      if (isShymkentA && isShymkentB) {
        // Оба из Шымкента - сортируем по number
        const numA = a.number || '';
        const numB = b.number || '';
        return numA.localeCompare(numB);
      } else if (isShymkentA) {
        return -1; // Шымкент в начале
      } else if (isShymkentB) {
        return 1; // Шымкент в начале
      } else {
        // Оба не из Шымкента - сортируем по code
        const codeA = a.code || '';
        const codeB = b.code || '';
        return codeA.localeCompare(codeB);
      }
    });

    const now = Date.now();

    // Функция для reverse geocoding (конвертация координат в адрес)
    const axios = require('axios');
    const geocodeCache = new Map();
    let lastGeocodeRequest = 0;
    
    async function reverseGeocode(lat, lng) {
      if (!lat || !lng || (lat === 0 && lng === 0)) return null;
      
      const cacheKey = `${lat.toFixed(6)},${lng.toFixed(6)}`;
      if (geocodeCache.has(cacheKey)) {
        return geocodeCache.get(cacheKey);
      }
      
      try {
        // Соблюдаем лимит Nominatim (1 запрос в секунду)
        const now = Date.now();
        const timeSinceLastRequest = now - lastGeocodeRequest;
        if (timeSinceLastRequest < 1000) {
          await new Promise(resolve => setTimeout(resolve, 1000 - timeSinceLastRequest));
        }
        lastGeocodeRequest = Date.now();
        
        const response = await axios.get(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
          {
            headers: {
              'User-Agent': 'FridgeManager/1.0',
            },
            timeout: 5000,
          }
        );
        
        if (response.data && response.data.address) {
          const addr = response.data.address;
          const parts = [];
          if (addr.road) parts.push(addr.road);
          if (addr.house_number) parts.push(addr.house_number);
          if (addr.city || addr.town || addr.village) parts.push(addr.city || addr.town || addr.village);
          const address = parts.length > 0 ? parts.join(', ') : response.data.display_name || null;
          if (address) {
            geocodeCache.set(cacheKey, address);
            return address;
          }
        }
        return null;
      } catch (error) {
        console.error('[Geocoding] Error:', error.message);
        return null;
      }
    }

    // Подготавливаем данные для Excel с конвертацией координат в адреса
    const excelData = [];
    for (let i = 0; i < fridges.length; i++) {
      const f = fridges[i];
      // Для Шымкента check-ins могут быть привязаны к number, для остальных - к code
      // Ищем последнюю отметку и по code, и по number
      const lastVisit = lastByFridgeId.get(f.code) || (f.number ? lastByFridgeId.get(f.number) : null) || null;
      
      let status = 'Нет отметок';
      if (lastVisit) {
        const diffDays = (now - new Date(lastVisit).getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays < 1) status = 'Сегодня';
        else if (diffDays < 7) status = 'Неделя';
        else status = 'Давно';
      }

      // Конвертируем координаты в адрес
      let geocodedAddress = '';
      if (f.location && f.location.coordinates && f.location.coordinates[0] !== 0 && f.location.coordinates[1] !== 0) {
        const [lng, lat] = f.location.coordinates;
        const addr = await reverseGeocode(lat, lng);
        geocodedAddress = addr || `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      }

      excelData.push({
        'Код': f.code || '',
        'Номер': f.number || '', // Добавляем колонку с длинным номером для Шымкента
        'Название': f.name || '',
        'Город': f.cityId?.name || '',
        'Адрес': f.address || '',
        'Адрес по координатам': geocodedAddress,
        'Описание': f.description || '',
        'Статус': status,
        'Последний визит': lastVisit ? (() => {
          // Конвертируем UTC время в UTC+5 (Казахстан)
          const date = new Date(lastVisit);
          const utcTime = date.getTime();
          const localTime = new Date(utcTime + (5 * 60 * 60 * 1000)); // +5 часов
          return localTime.toLocaleString('ru-RU', { 
            day: '2-digit', 
            month: '2-digit', 
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          });
        })() : '',
        'Активен': f.active ? 'Да' : 'Нет',
      });
      
      // Небольшая задержка между запросами для больших отчетов
      if (i < fridges.length - 1 && i % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Создаем рабочую книгу Excel
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Холодильники');

    // Настраиваем ширину колонок
    const columnWidths = [
      { wch: 10 }, // Код
      { wch: 30 }, // Номер (длинный номер для Шымкента)
      { wch: 30 }, // Название
      { wch: 15 }, // Город
      { wch: 40 }, // Адрес
      { wch: 50 }, // Адрес по координатам
      { wch: 30 }, // Описание
      { wch: 12 }, // Статус
      { wch: 20 }, // Последний визит
      { wch: 10 }, // Активен
    ];
    worksheet['!cols'] = columnWidths;

    // Генерируем буфер Excel файла
    const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    // Устанавливаем заголовки для скачивания файла
    const fileName = `холодильники_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    
    return res.send(excelBuffer);
  } catch (err) {
    return res
      .status(500)
      .json({ error: 'Failed to export fridges', details: err.message });
  }
});

// POST /api/admin/import-fridges
// Импорт холодильников из Excel файла (доступен для админов и бухгалтеров)
// Используем upload.fields([]) чтобы multer обрабатывал и файл, и другие поля FormData
router.post('/import-fridges', authenticateToken, requireAdminOrAccountant, (req, res, next) => {
  console.log('[Import] Starting file upload...');
  console.log('[Import] Request headers:', {
    'content-type': req.headers['content-type'],
    'content-length': req.headers['content-length']
  });
  
  // Используем fields чтобы обработать и файл, и другие поля
  upload.fields([{ name: 'file', maxCount: 1 }])(req, res, (err) => {
    if (err) {
      console.error('[Import] Multer upload error:', err);
      console.error('[Import] Multer error code:', err.code);
      console.error('[Import] Multer error message:', err.message);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Файл слишком большой. Максимальный размер: 100MB', details: err.message });
      }
      return res.status(400).json({ error: 'Ошибка загрузки файла', details: err.message });
    }
    
    // Multer обрабатывает файлы в req.files, а другие поля в req.body
    const file = req.files && req.files['file'] ? req.files['file'][0] : null;
    req.file = file; // Для совместимости с остальным кодом
    
    console.log('[Import] File uploaded successfully:', {
      fieldname: req.file?.fieldname,
      originalname: req.file?.originalname,
      mimetype: req.file?.mimetype,
      size: req.file?.size
    });
    console.log('[Import] Request body after multer:', req.body);
    next();
  });
}, async (req, res) => {
  try {
    console.log('[Import] Processing import request...');
    console.log('[Import] Request body:', req.body);
    console.log('[Import] Request query:', req.query);
    console.log('[Import] File object:', req.file ? {
      fieldname: req.file.fieldname,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      bufferLength: req.file.buffer?.length
    } : 'NO FILE');
    
    if (!req.file) {
      console.error('[Import] No file in request');
      return res.status(400).json({ error: 'Файл не загружен. Убедитесь, что вы выбрали файл.' });
    }

    // Читаем Excel файл из буфера
    console.log('[Import] Reading Excel file...');
    let workbook;
    try {
      workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      console.log('[Import] Excel file read successfully, sheets:', workbook.SheetNames);
    } catch (xlsxErr) {
      console.error('[Import] Error reading Excel file:', xlsxErr);
      return res.status(400).json({ 
        error: 'Ошибка чтения Excel файла', 
        details: xlsxErr.message || 'Файл поврежден или имеет неподдерживаемый формат' 
      });
    }
    
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    if (!worksheet) {
      console.error('[Import] Worksheet not found');
      return res.status(400).json({ error: 'Лист не найден в Excel файле' });
    }
    
    // Конвертируем в JSON (массив объектов)
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });
    console.log('[Import] Raw data rows:', rawData.length);

    // Ищем строку с заголовками (обычно строка 5, индексация с 0)
    let headerRow = -1;
    for (let i = 0; i < Math.min(10, rawData.length); i++) {
      const row = rawData[i];
      if (row && Array.isArray(row)) {
        const rowStr = row.map(cell => String(cell || '').toLowerCase()).join(' ');
        if (rowStr.includes('адрес') || rowStr.includes('контрагент')) {
          headerRow = i;
          console.log('[Import] Found header row at index:', i);
          break;
        }
      }
    }

    if (headerRow === -1) {
      console.error('[Import] Header row not found. First 5 rows:', rawData.slice(0, 5));
      return res.status(400).json({ 
        error: 'Не найдена строка с заголовками в Excel файле',
        details: 'Убедитесь, что в файле есть колонки "Адрес" или "Контрагент"'
      });
    }

    const headers = rawData[headerRow].map(h => String(h || '').trim());
    const dataStartRow = headerRow + 1; // Данные начинаются сразу после заголовков
    
    console.log('[Import] Headers found:', headers);
    console.log('[Import] Data will start from row:', dataStartRow);

    // Находим индексы нужных колонок
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
    const contractNumIdx = findColumnIndex(['номер', 'договор', 'дог']);
    const quantityIdx = findColumnIndex(['количество', 'кол-во']);
    const spvIdx = findColumnIndex(['спв']);
    const addressIdx = findColumnIndex(['адрес']);
    const tpIdx = findColumnIndex(['тп']);
    
    // Для Шымкента ищем колонку с номером холодильника из Excel
    // Ищем колонку, которая содержит "номер" или "код", но не "договор"
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

    console.log('[Import] Column indices:', {
      contractorIdx,
      contractNumIdx,
      quantityIdx,
      spvIdx,
      addressIdx,
      tpIdx,
      headers: headers.slice(0, 10) // Первые 10 заголовков для отладки
    });

    // Определяем город для импорта
    // Приоритет: cityId из запроса > город бухгалтера > ошибка
    let city;
    // Multer помещает текстовые поля FormData в req.body
    const requestedCityId = req.body?.cityId || req.query?.cityId;
    
    console.log('[Import] City selection:', {
      requestedCityId,
      reqBodyKeys: Object.keys(req.body || {}),
      reqBodyCityId: req.body?.cityId,
      reqQueryCityId: req.query?.cityId,
      userRole: req.user.role,
      userCityId: req.user.cityId
    });
    
    if (requestedCityId) {
      // Если указан cityId в запросе, используем его
      city = await City.findById(requestedCityId);
      if (!city) {
        return res.status(400).json({ error: 'Указанный город не найден' });
      }
      console.log('[Import] Using requested city:', city.name, city.code);
      
      // Для бухгалтера проверяем, что он может импортировать только в свой город
      if (req.user.role === 'accountant' && req.user.cityId) {
        if (city._id.toString() !== req.user.cityId.toString()) {
          return res.status(403).json({ error: 'Доступ запрещён: можно импортировать только в свой город' });
        }
      }
    } else if (req.user.role === 'accountant' && req.user.cityId) {
      // Если бухгалтер и cityId не указан, используем его город
      city = await City.findById(req.user.cityId);
      if (!city) {
        return res.status(400).json({ error: 'Город бухгалтера не найден' });
      }
      console.log('[Import] Using accountant city:', city.name, city.code);
    } else {
      // Для админа cityId обязателен
      return res.status(400).json({ error: 'Не указан город для импорта. Пожалуйста, выберите город.' });
    }

    // Парсим данные
    const records = [];
    let codeCounter = 1;

    // Находим максимальный существующий код
    const maxFridge = await Fridge.findOne().sort({ code: -1 });
    if (maxFridge && maxFridge.code) {
      const maxCode = parseInt(maxFridge.code, 10);
      if (!isNaN(maxCode)) {
        codeCounter = maxCode + 1;
      }
    }

    console.log('[Import] Starting to parse data:', {
      dataStartRow,
      totalRows: rawData.length,
      rowsToProcess: rawData.length - dataStartRow,
      codeCounter
    });

    let skippedNoAddress = 0;
    let skippedEmptyRow = 0;
    let processedRows = 0;

    for (let i = dataStartRow; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || !Array.isArray(row)) {
        skippedEmptyRow++;
        continue;
      }

      processedRows++;

      // Получаем адрес (может быть пустым)
      const address = addressIdx >= 0 ? String(row[addressIdx] || '').trim() : '';
      
      // Получаем контрагента (название) - используем для проверки, что строка не пустая
      const contractor = contractorIdx >= 0 ? String(row[contractorIdx] || '').trim() : '';
      
      // Пропускаем строку только если она полностью пустая (нет ни адреса, ни контрагента)
      if ((!address || address === 'null' || address === 'undefined') && 
          (!contractor || contractor === 'null' || contractor === 'undefined')) {
        skippedNoAddress++;
        if (processedRows <= 5) {
          console.log(`[Import] Row ${i} skipped - empty row. Row data:`, row.slice(0, 5));
        }
        continue; // Пропускаем полностью пустые строки
      }

      // Используем контрагента для названия, если он есть
      const name = contractor || `Холодильник ${codeCounter}`;

      // Формируем описание
      const descriptionParts = [];
      if (contractNumIdx >= 0) {
        const contractNum = String(row[contractNumIdx] || '').trim();
        if (contractNum) descriptionParts.push(`Договор: ${contractNum}`);
      }
      if (quantityIdx >= 0) {
        const quantity = String(row[quantityIdx] || '').trim();
        if (quantity) descriptionParts.push(`Кол-во: ${quantity}`);
      }
      if (spvIdx >= 0) {
        const spv = String(row[spvIdx] || '').trim();
        if (spv) descriptionParts.push(`СПВ: ${spv}`);
      }
      if (tpIdx >= 0) {
        const tp = String(row[tpIdx] || '').trim();
        if (tp) descriptionParts.push(`ТП: ${tp}`);
      }
      const description = descriptionParts.length > 0 ? descriptionParts.join('; ') : null;

      // Генерируем уникальный код
      let code = String(codeCounter);
      while (await Fridge.findOne({ code })) {
        codeCounter++;
        code = String(codeCounter);
      }

      // Для Шымкента сохраняем длинный номер из Excel в поле number
      const isShymkent = city.name === 'Шымкент';
      let fridgeNumber = null;
      if (isShymkent && fridgeNumberIdx >= 0) {
        const numberValue = String(row[fridgeNumberIdx] || '').trim();
        if (numberValue && numberValue !== 'null' && numberValue !== 'undefined') {
          fridgeNumber = numberValue;
        }
      }

      const record = {
        code,
        name: name.substring(0, 200),
        cityId: city._id,
        address: null, // Адрес будет обновляться через чек-ины
        description: description ? description.substring(0, 500) : null,
        location: {
          type: 'Point',
          coordinates: [0.0, 0.0], // Временные координаты
        },
        active: true,
      };

      // Добавляем number только если он есть (для Шымкента)
      if (fridgeNumber) {
        record.number = fridgeNumber;
      }

      records.push(record);

      codeCounter++;
    }

    console.log('[Import] Parsing complete:', {
      recordsFound: records.length,
      skippedNoAddress,
      skippedEmptyRow,
      processedRows
    });

    if (records.length === 0) {
      console.log('[Import] No records to import. Sample rows:', rawData.slice(dataStartRow, dataStartRow + 5));
      return res.status(400).json({ 
        error: 'Не найдено данных для импорта',
        details: `Обработано строк: ${processedRows}, пропущено без адреса: ${skippedNoAddress}, пропущено пустых: ${skippedEmptyRow}. Убедитесь, что в файле есть колонка "Адрес" с данными.`
      });
    }

    // Импортируем в базу данных
    // Оптимизация: загружаем все существующие коды в память для быстрой проверки
    console.log('[Import] Loading existing fridge codes into memory...');
    const existingFridges = await Fridge.find({}, { code: 1 }).lean();
    const existingCodes = new Set(existingFridges.map(f => f.code));
    console.log('[Import] Found', existingCodes.size, 'existing fridges');

    // Фильтруем записи, исключая дубликаты
    const recordsToInsert = [];
    let duplicates = 0;
    
    for (const record of records) {
      if (existingCodes.has(record.code)) {
        duplicates++;
        continue;
      }
      // Добавляем код в Set, чтобы избежать дубликатов в текущем импорте
      existingCodes.add(record.code);
      recordsToInsert.push(record);
    }

    console.log('[Import] Starting bulk insert for', recordsToInsert.length, 'records (skipped', duplicates, 'duplicates)');

    let imported = 0;
    let errors = 0;

    // Используем bulkWrite для массовой вставки (быстрее чем отдельные create)
    if (recordsToInsert.length > 0) {
      try {
        // Разбиваем на батчи по 100 записей для избежания перегрузки
        const batchSize = 100;
        for (let i = 0; i < recordsToInsert.length; i += batchSize) {
          const batch = recordsToInsert.slice(i, i + batchSize);
          const operations = batch.map(record => ({
            insertOne: { document: record }
          }));
          
          try {
            await Fridge.bulkWrite(operations, { ordered: false });
            imported += batch.length;
            console.log(`[Import] Inserted batch ${Math.floor(i / batchSize) + 1}, total imported: ${imported}`);
          } catch (batchErr) {
            // Если батч не прошел из-за дубликатов, пробуем вставлять по одной с проверкой
            console.error(`[Import] Batch insert failed, trying individual inserts:`, batchErr.message);
            for (const record of batch) {
              try {
                // Дополнительная проверка перед вставкой
                const exists = await Fridge.findOne({ code: record.code });
                if (exists) {
                  duplicates++;
                  continue;
                }
                await Fridge.create(record);
                imported++;
              } catch (err) {
                // Если ошибка дубликата, считаем как дубликат
                if (err.code === 11000 || err.message?.includes('duplicate')) {
                  duplicates++;
                } else {
                  errors++;
                  console.error(`[Import] Error inserting ${record.code}:`, err.message);
                }
              }
            }
          }
        }
      } catch (err) {
        console.error('[Import] Bulk insert error:', err);
        // Fallback: пробуем вставлять по одной с проверкой дубликатов
        for (const record of recordsToInsert) {
          try {
            // Проверяем, не существует ли уже такой код
            const exists = await Fridge.findOne({ code: record.code });
            if (exists) {
              duplicates++;
              continue;
            }
            await Fridge.create(record);
            imported++;
          } catch (err) {
            // Если ошибка дубликата, считаем как дубликат
            if (err.code === 11000 || err.message?.includes('duplicate')) {
              duplicates++;
            } else {
              errors++;
              console.error(`[Import] Error inserting ${record.code}:`, err.message);
            }
          }
        }
      }
    }

    const result = {
      success: true,
      imported,
      duplicates,
      errors,
      total: records.length,
    };
    
    console.log('[Import] Import complete:', result);
    
    return res.json(result);
  } catch (err) {
    console.error('[Import] Error during import:', err);
    console.error('[Import] Error stack:', err.stack);
    return res
      .status(500)
      .json({ error: 'Failed to import fridges', details: err.message });
  }
});

// POST /api/admin/fridges
// Создание нового холодильника (для админа и бухгалтера, с автогенерацией кода)
router.post('/fridges', authenticateToken, requireAdminOrAccountant, async (req, res) => {
  try {
    const { name, address, description, cityId } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Название холодильника обязательно' });
    }

    // Для бухгалтера проверяем, что он может создавать холодильники только для своего города
    let targetCityId = cityId;
    if (req.user.role === 'accountant' && req.user.cityId) {
      // Бухгалтер может создавать холодильники только для своего города
      targetCityId = req.user.cityId;
      
      // Если указан другой cityId, игнорируем его и используем город бухгалтера
      if (cityId && cityId.toString() !== req.user.cityId.toString()) {
        console.log(`[Admin] Accountant ${req.user.username} tried to create fridge for city ${cityId}, but assigned to their city ${req.user.cityId}`);
      }
    }

    // Получаем или создаем город, если cityId не указан
    let city;
    if (targetCityId) {
      city = await City.findById(targetCityId);
      if (!city) {
        return res.status(400).json({ error: 'Город не найден' });
      }
      
      // Для бухгалтера дополнительная проверка
      if (req.user.role === 'accountant' && city._id.toString() !== req.user.cityId.toString()) {
        return res.status(403).json({ error: 'Доступ запрещён: можно создавать холодильники только для своего города' });
      }
    } else {
      // Если cityId не указан и пользователь - бухгалтер, используем его город
      if (req.user.role === 'accountant' && req.user.cityId) {
        city = await City.findById(req.user.cityId);
        if (!city) {
          return res.status(400).json({ error: 'Город бухгалтера не найден' });
        }
      } else {
        // Для админа cityId обязателен при создании холодильника
        return res.status(400).json({ error: 'Не указан город. Пожалуйста, выберите город для холодильника.' });
      }
    }

    // Генерируем уникальный код
    let codeCounter = 1;
    const maxFridge = await Fridge.findOne().sort({ code: -1 });
    if (maxFridge && maxFridge.code) {
      const maxCode = parseInt(maxFridge.code, 10);
      if (!isNaN(maxCode)) {
        codeCounter = maxCode + 1;
      }
    }

    let code = String(codeCounter);
    while (await Fridge.findOne({ code })) {
      codeCounter++;
      code = String(codeCounter);
    }

    // Создаем холодильник с временными координатами (0, 0)
    // По умолчанию статус = 'warehouse' (на складе)
    const fridge = await Fridge.create({
      code,
      name: name.substring(0, 200),
      cityId: city._id,
      address: address || null,
      description: description ? description.substring(0, 500) : null,
      location: {
        type: 'Point',
        coordinates: [0.0, 0.0], // Временные координаты, обновятся при первой отметке
      },
      active: true,
      warehouseStatus: 'warehouse', // На складе по умолчанию
      statusHistory: [{
        status: 'warehouse',
        changedAt: new Date(),
        changedBy: req.user.id,
        notes: 'Создан на складе',
      }],
    });

    const populatedFridge = await Fridge.findById(fridge._id).populate('cityId', 'name code');

    return res.status(201).json(populatedFridge);
  } catch (err) {
    console.error('Ошибка создания холодильника:', err);
    if (err.code === 11000) {
      return res.status(400).json({ error: 'Холодильник с таким кодом уже существует' });
    }
    return res.status(500).json({ error: 'Ошибка создания холодильника', details: err.message });
  }
});

// GET /api/admin/fridges/:id
// Получить детальную информацию о холодильнике
router.get('/fridges/:id', authenticateToken, requireAdminOrAccountant, async (req, res) => {
  try {
    const { id } = req.params;
    const fridge = await Fridge.findById(id)
      .populate('cityId', 'name code')
      .populate('statusHistory.changedBy', 'username fullName');

    if (!fridge) {
      return res.status(404).json({ error: 'Холодильник не найден' });
    }

    // Для бухгалтеров проверяем, что холодильник из их города
    if (req.user.role === 'accountant' && req.user.cityId) {
      if (fridge.cityId?._id?.toString() !== req.user.cityId) {
        console.log('Accountant access denied - wrong city:', {
          accountantCityId: req.user.cityId,
          fridgeCityId: fridge.cityId?._id
        });
        return res.status(403).json({ error: 'Доступ запрещён: холодильник из другого города' });
      }
    }

    return res.json(fridge);
  } catch (err) {
    return res.status(500).json({ error: 'Ошибка получения данных', details: err.message });
  }
});

// GET /api/admin/fridges/:id/checkins
// История посещений конкретного холодильника
router.get('/fridges/:id/checkins', authenticateToken, requireAdminOrAccountant, async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 50 } = req.query;

    const fridge = await Fridge.findById(id);
    if (!fridge) {
      return res.status(404).json({ error: 'Холодильник не найден' });
    }

    // Для бухгалтеров проверяем, что холодильник из их города
    if (req.user.role === 'accountant' && req.user.cityId) {
      if (fridge.cityId?.toString() !== req.user.cityId) {
        return res.status(403).json({ error: 'Доступ запрещён: холодильник из другого города' });
      }
    }

    // Получаем чек-ины по коду/номеру холодильника (для Шымкента может быть number)
    const fridgeIds = [fridge.code];
    if (fridge.number) {
      fridgeIds.push(fridge.number);
    }
    const checkins = await Checkin.find({ fridgeId: { $in: fridgeIds } })
      .sort({ visitedAt: -1 })
      .limit(parseInt(limit, 10));

    return res.json(checkins);
  } catch (err) {
    return res.status(500).json({ error: 'Ошибка получения истории', details: err.message });
  }
});

// GET /api/admin/analytics
// Аналитика: посещения по дням, статистика по менеджерам, топ непосещаемых
router.get('/analytics', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const daysNum = parseInt(days, 10) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysNum);
    startDate.setHours(0, 0, 0, 0);

    // 1. Посещения по дням
    const checkinsByDay = await Checkin.aggregate([
      { $match: { visitedAt: { $gte: startDate } } },
      {
        $group: {
          _id: {
            year: { $year: '$visitedAt' },
            month: { $month: '$visitedAt' },
            day: { $dayOfMonth: '$visitedAt' },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
    ]);

    // Преобразуем в удобный формат
    const dailyCheckins = checkinsByDay.map((item) => ({
      date: `${item._id.year}-${String(item._id.month).padStart(2, '0')}-${String(item._id.day).padStart(2, '0')}`,
      count: item.count,
    }));

    // 2. Статистика по менеджерам
    const managerStats = await Checkin.aggregate([
      { $match: { visitedAt: { $gte: startDate } } },
      {
        $group: {
          _id: '$managerId',
          count: { $sum: 1 },
          lastVisit: { $max: '$visitedAt' },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]);

    // 3. Топ непосещаемых холодильников
    const allFridges = await Fridge.find({ active: true }).select('code name address');
    const lastCheckins = await Checkin.aggregate([
      { $sort: { visitedAt: -1 } },
      {
        $group: {
          _id: '$fridgeId',
          lastVisit: { $first: '$visitedAt' },
        },
      },
    ]);

    const lastVisitMap = new Map();
    lastCheckins.forEach((c) => lastVisitMap.set(c._id, c.lastVisit));

    const fridgesWithLastVisit = allFridges.map((f) => ({
      code: f.code,
      name: f.name,
      address: f.address,
      lastVisit: lastVisitMap.get(f.code) || null,
      daysSinceVisit: lastVisitMap.get(f.code)
        ? Math.floor((Date.now() - new Date(lastVisitMap.get(f.code)).getTime()) / (1000 * 60 * 60 * 24))
        : null,
    }));

    // Сортируем: сначала те, кто никогда не посещался, потом по давности
    const topUnvisited = fridgesWithLastVisit
      .sort((a, b) => {
        if (a.lastVisit === null && b.lastVisit === null) return 0;
        if (a.lastVisit === null) return -1;
        if (b.lastVisit === null) return 1;
        return new Date(a.lastVisit).getTime() - new Date(b.lastVisit).getTime();
      })
      .slice(0, 20);

    // 4. Общая статистика
    const totalFridges = await Fridge.countDocuments({ active: true });
    const totalCheckins = await Checkin.countDocuments({ visitedAt: { $gte: startDate } });
    const uniqueManagers = await Checkin.distinct('managerId', { visitedAt: { $gte: startDate } });
    
    // Холодильники по статусам
    const fridgesByStatus = await Fridge.aggregate([
      { $match: { active: true } },
      {
        $group: {
          _id: '$warehouseStatus',
          count: { $sum: 1 },
        },
      },
    ]);

    const statusCounts = {
      warehouse: 0,
      installed: 0,
      returned: 0,
      moved: 0,
    };
    fridgesByStatus.forEach((s) => {
      if (s._id && statusCounts.hasOwnProperty(s._id)) {
        statusCounts[s._id] = s.count;
      }
    });

    return res.json({
      dailyCheckins,
      managerStats,
      topUnvisited,
      summary: {
        totalFridges,
        totalCheckins,
        uniqueManagers: uniqueManagers.length,
        avgCheckinsPerDay: daysNum > 0 ? Math.round(totalCheckins / daysNum * 10) / 10 : 0,
        fridgesByStatus: statusCounts,
      },
    });
  } catch (err) {
    console.error('Analytics error:', err);
    return res.status(500).json({ error: 'Ошибка получения аналитики', details: err.message });
  }
});

// GET /api/admin/analytics/accountant
// Аналитика для бухгалтера (только для его города)
router.get('/analytics/accountant', authenticateToken, requireAdminOrAccountant, async (req, res) => {
  try {
    // Только бухгалтеры могут использовать этот endpoint
    if (req.user.role !== 'accountant' || !req.user.cityId) {
      return res.status(403).json({ error: 'Доступ только для бухгалтеров с назначенным городом' });
    }

    const { days = 30 } = req.query;
    const daysNum = parseInt(days, 10) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysNum);

    // Получаем все холодильники из города бухгалтера
    const cityFridges = await Fridge.find({ 
      cityId: req.user.cityId,
      active: true 
    }).select('code name address warehouseStatus');
    const fridgeCodes = cityFridges.map(f => f.code);

    if (fridgeCodes.length === 0) {
      return res.json({
        dailyCheckins: [],
        managerStats: [],
        topUnvisited: [],
        summary: {
          totalFridges: 0,
          totalCheckins: 0,
          uniqueManagers: 0,
          avgCheckinsPerDay: 0,
          fridgesByStatus: { warehouse: 0, installed: 0, returned: 0 },
        },
      });
    }

    // 1. Посещения по дням (только для холодильников из города)
    const checkinsByDay = await Checkin.aggregate([
      {
        $match: {
          fridgeId: { $in: fridgeCodes },
          visitedAt: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: '$visitedAt' },
            month: { $month: '$visitedAt' },
            day: { $dayOfMonth: '$visitedAt' },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
    ]);

    const dailyCheckins = checkinsByDay.map((item) => ({
      date: `${item._id.year}-${String(item._id.month).padStart(2, '0')}-${String(item._id.day).padStart(2, '0')}`,
      count: item.count,
    }));

    // 2. Статистика по менеджерам (только для холодильников из города)
    const managerStats = await Checkin.aggregate([
      {
        $match: {
          fridgeId: { $in: fridgeCodes },
          visitedAt: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: '$managerId',
          count: { $sum: 1 },
          lastVisit: { $max: '$visitedAt' },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]);

    // 3. Топ непосещаемых холодильников (только из города)
    // Для Шымкента нужно учитывать и code, и number
    const fridgeIds = [];
    cityFridges.forEach((f) => {
      fridgeIds.push(f.code);
      if (f.number) {
        fridgeIds.push(f.number);
      }
    });
    
    const lastCheckins = await Checkin.aggregate([
      {
        $match: { fridgeId: { $in: fridgeIds } },
      },
      { $sort: { visitedAt: -1 } },
      {
        $group: {
          _id: '$fridgeId',
          lastVisit: { $first: '$visitedAt' },
        },
      },
    ]);

    const lastVisitMap = new Map();
    lastCheckins.forEach((c) => lastVisitMap.set(c._id, c.lastVisit));

    const fridgesWithLastVisit = cityFridges.map((f) => {
      // Для Шымкента ищем и по code, и по number
      const lastVisit = lastVisitMap.get(f.code) || (f.number ? lastVisitMap.get(f.number) : null) || null;
      return {
        code: f.code,
        name: f.name,
        address: f.address,
        lastVisit: lastVisit,
        daysSinceVisit: lastVisit
          ? Math.floor((Date.now() - new Date(lastVisit).getTime()) / (1000 * 60 * 60 * 24))
          : null,
      };
    });

    const topUnvisited = fridgesWithLastVisit
      .sort((a, b) => {
        if (a.lastVisit === null && b.lastVisit === null) return 0;
        if (a.lastVisit === null) return -1;
        if (b.lastVisit === null) return 1;
        return new Date(a.lastVisit).getTime() - new Date(b.lastVisit).getTime();
      })
      .slice(0, 20);

    // 4. Общая статистика (только для города)
    const totalFridges = cityFridges.length;
    const totalCheckins = await Checkin.countDocuments({
      fridgeId: { $in: fridgeCodes },
      visitedAt: { $gte: startDate },
    });
    const uniqueManagers = await Checkin.distinct('managerId', {
      fridgeId: { $in: fridgeCodes },
      visitedAt: { $gte: startDate },
    });

    // Холодильники по статусам
    const statusCounts = {
      warehouse: 0,
      installed: 0,
      returned: 0,
      moved: 0,
    };
    cityFridges.forEach((f) => {
      if (f.warehouseStatus && statusCounts.hasOwnProperty(f.warehouseStatus)) {
        statusCounts[f.warehouseStatus] = (statusCounts[f.warehouseStatus] || 0) + 1;
      }
    });

    return res.json({
      dailyCheckins,
      managerStats,
      topUnvisited,
      summary: {
        totalFridges,
        totalCheckins,
        uniqueManagers: uniqueManagers.length,
        avgCheckinsPerDay: daysNum > 0 ? Number((totalCheckins / daysNum).toFixed(2)) : 0,
        fridgesByStatus: statusCounts,
      },
    });
  } catch (err) {
    console.error('Accountant analytics error:', err);
    return res.status(500).json({ error: 'Ошибка получения аналитики', details: err.message });
  }
});

// ==========================================
// УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ (только для админа)
// ==========================================

// GET /api/admin/users
// Список всех пользователей
router.get('/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { role, active, search } = req.query;
    const filter = {};
    
    if (role) filter.role = role;
    if (active !== undefined) filter.active = active === 'true';
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      filter.$or = [
        { username: searchRegex },
        { fullName: searchRegex },
      ];
    }

    const users = await User.find(filter)
      .select('-password')
      .populate('cityId', 'name code')
      .sort({ createdAt: -1 });

    return res.json(users);
  } catch (err) {
    return res.status(500).json({ error: 'Ошибка получения пользователей', details: err.message });
  }
});

// GET /api/admin/users/:id
// Получить пользователя по ID
router.get('/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password')
      .populate('cityId', 'name code');
    
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    return res.json(user);
  } catch (err) {
    return res.status(500).json({ error: 'Ошибка получения пользователя', details: err.message });
  }
});

// POST /api/admin/users
// Создать нового пользователя (бухгалтера, менеджера)
router.post('/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { username, password, role, fullName, phone, cityId, active } = req.body;

    // Валидация
    if (!username || !password) {
      return res.status(400).json({ error: 'Обязательные поля: username, password' });
    }

    if (!['manager', 'accountant', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Некорректная роль. Допустимые: manager, accountant, admin' });
    }

    // Проверка уникальности только по username
    const existing = await User.findOne({ username });
    if (existing) {
      return res.status(400).json({ error: 'Пользователь с таким username уже существует' });
    }

    // Создаём пользователя (пароль хешируется в pre-save hook модели)
    const user = await User.create({
      username,
      password,
      role,
      fullName: fullName || username,
      phone: phone || null,
      cityId: cityId || null,
      active: active !== false,
    });

    // Возвращаем без пароля
    const userObj = user.toObject();
    delete userObj.password;

    return res.status(201).json(userObj);
  } catch (err) {
    console.error('Ошибка создания пользователя:', err);
    console.error('Stack trace:', err.stack);
    if (err.code === 11000) {
      return res.status(400).json({ error: 'Пользователь с таким username уже существует' });
    }
    return res.status(500).json({ error: 'Ошибка создания пользователя', details: err.message });
  }
});

// PATCH /api/admin/users/:id
// Обновить пользователя
router.patch('/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { username, password, role, fullName, phone, cityId, active } = req.body;

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    // Нельзя редактировать самого себя (защита от удаления своего админа)
    if (user._id.toString() === req.user.id) {
      return res.status(400).json({ error: 'Нельзя редактировать свой аккаунт через этот интерфейс' });
    }

    // Обновляем поля
    if (username !== undefined) user.username = username;
    if (role !== undefined && ['manager', 'accountant', 'admin'].includes(role)) {
      user.role = role;
    }
    if (fullName !== undefined) user.fullName = fullName;
    if (phone !== undefined) user.phone = phone;
    if (cityId !== undefined) user.cityId = cityId || null;
    if (active !== undefined) user.active = active;

    // Если передан новый пароль - обновляем (хешируется в pre-save)
    if (password && password.length >= 6) {
      user.password = password;
    }

    await user.save();

    const userObj = user.toObject();
    delete userObj.password;

    return res.json(userObj);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: 'Пользователь с таким username уже существует' });
    }
    return res.status(500).json({ error: 'Ошибка обновления пользователя', details: err.message });
  }
});

// DELETE /api/admin/users/:id
// Удалить пользователя
router.delete('/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    // Нельзя удалить самого себя
    if (user._id.toString() === req.user.id) {
      return res.status(400).json({ error: 'Нельзя удалить свой аккаунт' });
    }

    await User.findByIdAndDelete(req.params.id);

    return res.json({ message: 'Пользователь удалён', id: req.params.id });
  } catch (err) {
    return res.status(500).json({ error: 'Ошибка удаления пользователя', details: err.message });
  }
});

// ==========================================
// ПОЛНОЕ УПРАВЛЕНИЕ ХОЛОДИЛЬНИКАМИ
// ==========================================

// PATCH /api/admin/fridges/:id/client
// Обновить данные клиента (доступно для бухгалтера)
router.patch('/fridges/:id/client', authenticateToken, requireAdminOrAccountant, async (req, res) => {
  try {
    const { clientInfo } = req.body;

    const fridge = await Fridge.findById(req.params.id);
    if (!fridge) {
      return res.status(404).json({ error: 'Холодильник не найден' });
    }

    // Для бухгалтера проверяем, что холодильник принадлежит его городу
    if (req.user.role === 'accountant' && req.user.cityId) {
      if (fridge.cityId && fridge.cityId.toString() !== req.user.cityId.toString()) {
        return res.status(403).json({ error: 'Доступ запрещён: можно редактировать только холодильники своего города' });
      }
    }

    // Обновляем clientInfo
    if (clientInfo !== undefined) {
      // Если clientInfo пустой объект или null, очищаем данные
      if (!clientInfo || Object.keys(clientInfo).length === 0) {
        fridge.clientInfo = null;
      } else {
        // Обновляем или создаем clientInfo
        // Обрабатываем пустые строки: если поле пустое, сохраняем как undefined (чтобы не хранить пустые строки)
        const cleanValue = (value) => {
          if (value === null || value === undefined) return undefined;
          const trimmed = String(value).trim();
          return trimmed === '' ? undefined : trimmed;
        };
        
        fridge.clientInfo = {
          name: cleanValue(clientInfo.name),
          inn: cleanValue(clientInfo.inn),
          contractNumber: cleanValue(clientInfo.contractNumber),
          contactPhone: cleanValue(clientInfo.contactPhone),
          contactPerson: cleanValue(clientInfo.contactPerson),
          installDate: cleanValue(clientInfo.installDate),
          notes: cleanValue(clientInfo.notes),
        };
        
        // Если все поля пустые, удаляем clientInfo
        const hasAnyValue = Object.values(fridge.clientInfo).some(v => v !== undefined);
        if (!hasAnyValue) {
          fridge.clientInfo = null;
        }
      }
    }

    await fridge.save();

    const populated = await Fridge.findById(fridge._id).populate('cityId', 'name code');
    return res.json(populated);
  } catch (err) {
    return res.status(500).json({ error: 'Ошибка обновления данных клиента', details: err.message });
  }
});

// PATCH /api/admin/fridges/:id/status
// Изменить статус холодильника (warehouseStatus) - доступно для бухгалтера и админа
router.patch('/fridges/:id/status', authenticateToken, requireAdminOrAccountant, async (req, res) => {
  try {
    const { warehouseStatus, clientInfo, notes } = req.body;

    if (!warehouseStatus || !['warehouse', 'installed', 'returned', 'moved'].includes(warehouseStatus)) {
      return res.status(400).json({ error: 'Некорректный статус' });
    }

    const fridge = await Fridge.findById(req.params.id);
    if (!fridge) {
      return res.status(404).json({ error: 'Холодильник не найден' });
    }

    // Для бухгалтера проверяем, что холодильник принадлежит его городу
    if (req.user.role === 'accountant' && req.user.cityId) {
      if (fridge.cityId && fridge.cityId.toString() !== req.user.cityId.toString()) {
        return res.status(403).json({ error: 'Доступ запрещён: можно редактировать только холодильники своего города' });
      }
    }

    // Обновляем warehouseStatus
    const oldStatus = fridge.warehouseStatus;
    fridge.warehouseStatus = warehouseStatus;

    // Обновляем clientInfo если передан
    if (clientInfo !== undefined) {
      if (!clientInfo || Object.keys(clientInfo).length === 0) {
        fridge.clientInfo = null;
      } else {
        const cleanValue = (value) => {
          if (value === null || value === undefined) return undefined;
          const trimmed = String(value).trim();
          return trimmed === '' ? undefined : trimmed;
        };
        
        fridge.clientInfo = {
          name: cleanValue(clientInfo.name),
          inn: cleanValue(clientInfo.inn),
          contractNumber: cleanValue(clientInfo.contractNumber),
          contactPhone: cleanValue(clientInfo.contactPhone),
          contactPerson: cleanValue(clientInfo.contactPerson),
          installDate: cleanValue(clientInfo.installDate),
          notes: cleanValue(clientInfo.notes),
        };
        
        const hasAnyValue = Object.values(fridge.clientInfo).some(v => v !== undefined);
        if (!hasAnyValue) {
          fridge.clientInfo = null;
        }
      }
    }

    // Добавляем запись в историю статусов
    if (oldStatus !== warehouseStatus) {
      fridge.statusHistory.push({
        status: warehouseStatus,
        changedAt: new Date(),
        changedBy: req.user._id,
        notes: notes || `Изменен статус с "${oldStatus}" на "${warehouseStatus}"`,
      });
    }

    await fridge.save();

    const populated = await Fridge.findById(fridge._id).populate('cityId', 'name code');
    return res.json(populated);
  } catch (err) {
    return res.status(500).json({ error: 'Ошибка изменения статуса', details: err.message });
  }
});

// PATCH /api/admin/fridges/:id
// Редактировать холодильник (доступно для админа и бухгалтера)
router.patch('/fridges/:id', authenticateToken, requireAdminOrAccountant, async (req, res) => {
  try {
    const { name, address, description, cityId, active } = req.body;

    const fridge = await Fridge.findById(req.params.id);
    if (!fridge) {
      return res.status(404).json({ error: 'Холодильник не найден' });
    }

    // Для бухгалтера проверяем, что холодильник принадлежит его городу
    if (req.user.role === 'accountant' && req.user.cityId) {
      if (fridge.cityId && fridge.cityId.toString() !== req.user.cityId.toString()) {
        return res.status(403).json({ error: 'Доступ запрещён: можно редактировать только холодильники своего города' });
      }
    }

    // Бухгалтер может редактировать только название, адрес и описание
    // Админ может редактировать все поля, включая cityId и active
    if (name !== undefined) fridge.name = name;
    if (address !== undefined) fridge.address = address;
    if (description !== undefined) fridge.description = description;
    
    // Только админ может менять cityId и active
    if (req.user.role === 'admin') {
      if (cityId !== undefined) fridge.cityId = cityId || null;
      if (active !== undefined) fridge.active = active;
    }

    await fridge.save();

    const populated = await Fridge.findById(fridge._id).populate('cityId', 'name code');
    return res.json(populated);
  } catch (err) {
    return res.status(500).json({ error: 'Ошибка обновления холодильника', details: err.message });
  }
});

// DELETE /api/admin/fridges/all
// Удаление всех холодильников (только для админа, необратимая операция)
// ВАЖНО: Этот роут должен быть ПЕРЕД /fridges/:id, чтобы Express обрабатывал точное совпадение первым
router.delete('/fridges/all', authenticateToken, requireAdmin, async (req, res) => {
  let checkinsDeleted = 0;
  let deletedCount = 0;
  
  try {
    console.log('[Admin] Starting deletion of all fridges...');
    console.log('[Admin] User:', req.user?.username, req.user?.role);
    
    // Проверяем, что модели доступны
    if (!Fridge) {
      throw new Error('Fridge model is not available');
    }
    if (!Checkin) {
      console.warn('[Admin] Checkin model is not available, will skip checkin deletion');
    }
    
    // Получаем количество холодильников перед удалением
    let count = 0;
    try {
      count = await Fridge.countDocuments();
      console.log(`[Admin] Found ${count} fridges to delete`);
    } catch (countErr) {
      console.error('[Admin] Error counting fridges:', countErr);
      console.error('[Admin] Count error stack:', countErr.stack);
      return res.status(500).json({ 
        error: 'Ошибка при подсчете холодильников', 
        details: countErr.message 
      });
    }
    
    if (count === 0) {
      return res.json({ 
        message: 'Нет холодильников для удаления', 
        deleted: 0,
        checkinsDeleted: 0
      });
    }

    // Удаляем все связанные отметки посещений
    // Сначала удаляем все checkins, так как они ссылаются на холодильники
    if (Checkin) {
      try {
        console.log('[Admin] Deleting all checkins...');
        const checkinResult = await Checkin.deleteMany({});
        checkinsDeleted = checkinResult.deletedCount || 0;
        console.log(`[Admin] Deleted ${checkinsDeleted} checkins`);
      } catch (checkinErr) {
        // Логируем ошибку, но продолжаем удаление холодильников
        console.error('[Admin] Error deleting checkins (continuing with fridge deletion):', checkinErr);
        console.error('[Admin] Checkin error message:', checkinErr.message);
        console.error('[Admin] Checkin error name:', checkinErr.name);
        if (checkinErr.stack) {
          console.error('[Admin] Checkin error stack:', checkinErr.stack);
        }
        // Не прерываем выполнение, просто продолжаем
      }
    } else {
      console.log('[Admin] Skipping checkin deletion (model not available)');
    }

    // Удаляем все холодильники
    try {
      console.log('[Admin] Deleting all fridges...');
      const deleteResult = await Fridge.deleteMany({});
      deletedCount = deleteResult.deletedCount || 0;
      console.log(`[Admin] Deleted ${deletedCount} fridges`);
    } catch (fridgeErr) {
      console.error('[Admin] Error deleting fridges:', fridgeErr);
      console.error('[Admin] Fridge error message:', fridgeErr.message);
      console.error('[Admin] Fridge error name:', fridgeErr.name);
      if (fridgeErr.stack) {
        console.error('[Admin] Fridge error stack:', fridgeErr.stack);
      }
      return res.status(500).json({ 
        error: 'Ошибка удаления холодильников', 
        details: fridgeErr.message 
      });
    }

    console.log(`[Admin] Successfully deleted all fridges: ${deletedCount} fridges, ${checkinsDeleted} checkins`);

    return res.json({ 
      message: `Удалено ${deletedCount} холодильников и ${checkinsDeleted} отметок посещений`, 
      deleted: deletedCount,
      checkinsDeleted: checkinsDeleted
    });
  } catch (err) {
    console.error('[Admin] Unexpected error deleting all fridges:', err);
    console.error('[Admin] Error message:', err.message);
    console.error('[Admin] Error name:', err.name);
    if (err.stack) {
      console.error('[Admin] Error stack:', err.stack);
    }
    return res.status(500).json({ 
      error: 'Ошибка удаления всех холодильников', 
      details: err.message || 'Неизвестная ошибка'
    });
  }
});

// DELETE /api/admin/fridges/:id
// Удалить холодильник
router.delete('/fridges/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const fridge = await Fridge.findById(req.params.id);
    if (!fridge) {
      return res.status(404).json({ error: 'Холодильник не найден' });
    }

    // Также удаляем связанные чек-ины
      // Удаляем все check-ins для этого холодильника (и по code, и по number)
      const fridgeIds = [fridge.code];
      if (fridge.number) {
        fridgeIds.push(fridge.number);
      }
      const deletedCheckins = await Checkin.deleteMany({ fridgeId: { $in: fridgeIds } });

    await Fridge.findByIdAndDelete(req.params.id);

    return res.json({ 
      message: 'Холодильник удалён', 
      id: req.params.id,
      code: fridge.code,
      deletedCheckins: deletedCheckins.deletedCount,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Ошибка удаления холодильника', details: err.message });
  }
});

// DELETE /api/admin/fridges/:id/soft
// Мягкое удаление (деактивация) холодильника
router.delete('/fridges/:id/soft', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const fridge = await Fridge.findById(req.params.id);
    if (!fridge) {
      return res.status(404).json({ error: 'Холодильник не найден' });
    }

    fridge.active = false;
    await fridge.save();

    return res.json({ message: 'Холодильник деактивирован', id: req.params.id });
  } catch (err) {
    return res.status(500).json({ error: 'Ошибка деактивации холодильника', details: err.message });
  }
});

module.exports = router;


