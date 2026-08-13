const express = require('express');
const multer = require('multer');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const Fridge = require('../models/Fridge');
const Checkin = require('../models/Checkin');
const City = require('../models/City');
const User = require('../models/User');
const { authenticateToken, requireAdmin, requireAdminOrAccountant, requireAdminOrAccountantOrSalesHead, requireSalesHead } = require('../middleware/auth');
const {
  buildCheckinFridgeIdMatchCondition,
  buildCheckinFridgeIdCandidates,
  visitStatusFromLastVisit,
  combinedVisitMapStatus,
  getLastVisitFromStatsMap,
  resolveEquipmentStatus,
  shouldIncludeInUnvisitedReport,
  shouldCountAsWithoutCheckinsInPeriod,
  shouldCountAsNeverVisited,
  buildDailyCheckinsAggregationStages,
  mapDailyCheckinsAggregationResult,
} = require('../lib/fridgeVisitHelpers');
const { getCheckinStatsForFridges, getCheckinStatsForFridgeQuery, invalidateCheckinStatsCache } = require('../lib/checkinStatsCache');
const { buildTopUnvisitedFromFridges, buildAnalyticsPeriodMatch } = require('../lib/analyticsHelpers');
const { deduplicateCityCheckins } = require('../lib/deduplicateCheckins');
const {
  generateFullExportBuffer,
  buildExportFileName,
  buildFridgesExportFileName,
  parseExportPeriod,
} = require('../lib/salesReportExport');
const { getAssignedCityId, resolveCityFilter, userCanAccessFridge, buildCheckinFilterForFridge, normalizeCityId } = require('../lib/cityScope');
const { applyReturnToHomeCity, WAREHOUSE_STATUSES } = require('../lib/fridgeReturnHelpers');
const { buildCaseInsensitiveRegex } = require('../lib/stringHelpers');
const { buildMapLocationFilter, isMapMarkersRequest } = require('../lib/mapFridgeQuery');
const { fetchMapFridgeViewport, fetchMapFridgeBulk } = require('../lib/mapFridgeViewport');
const { attachLongRunningTimeouts } = require('../lib/longRunningHttp');
const XLSX = require('xlsx');

// Настройка multer для загрузки Excel
const uploadLimitMb = (() => {
  const n = parseInt(process.env.UPLOAD_LIMIT_MB || '25', 10);
  return Number.isFinite(n) && n >= 1 ? n : 25;
})();
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: uploadLimitMb * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    // Проверяем тип файла
    const allowedMimes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'application/octet-stream', // иногда Excel файлы имеют этот тип
    ];
    
    if (allowedMimes.includes(file.mimetype) || file.originalname.match(/\.(xlsx|xls)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Неподдерживаемый тип файла. Разрешены только .xlsx и .xls файлы.'));
    }
  },
});

const router = express.Router();

// GET /api/admin/fridge-status
// Возвращает список холодильников с последней датой посещения и статусом для карты
// query: limit, skip, all=true (все для карты), warehouseStatus, search (как в GET /api/fridges)
// Для бухгалтеров возвращает только холодильники их города
const WAREHOUSE_STATUS_ENUM = ['warehouse', 'installed', 'returned', 'moved'];
const USER_ROLES = ['manager', 'accountant', 'admin', 'service_manager', 'sales_head'];

// GET /api/admin/dashboard-summary — быстрые счётчики для шапки (без обхода всех ХО)
router.get('/dashboard-summary', authenticateToken, requireAdminOrAccountantOrSalesHead, async (req, res) => {
  try {
    let fridgeQuery = { active: true };
    const scopedCityId = resolveCityFilter(req.user, req.query.cityId);
    if (scopedCityId) {
      fridgeQuery.cityId = scopedCityId;
    }

    let checkinMatch = {};
    if (scopedCityId) {
      const { getCheckinFilterForCity } = require('../lib/cityScope');
      checkinMatch = await getCheckinFilterForCity(scopedCityId);
    }

    const [totalFridges, totalCheckins, managerGroups] = await Promise.all([
      Fridge.countDocuments(fridgeQuery),
      Object.keys(checkinMatch).length
        ? Checkin.countDocuments(checkinMatch)
        : Checkin.estimatedDocumentCount(),
      Checkin.aggregate([
        ...(Object.keys(checkinMatch).length ? [{ $match: checkinMatch }] : []),
        { $group: { _id: '$managerId' } },
        { $count: 'n' },
      ]),
    ]);

    const distinctManagers = managerGroups[0]?.n ?? 0;

    return res.json({
      totalFridges,
      totalCheckins,
      distinctManagers,
    });
  } catch (err) {
    console.error('[Admin] dashboard-summary:', err);
    return res.status(500).json({ error: 'Failed to load dashboard summary', details: err.message });
  }
});

router.get('/fridge-status', authenticateToken, requireAdminOrAccountantOrSalesHead, async (req, res) => {
  try {
    const { limit, skip, all, warehouseStatus, search } = req.query;
    const forMap = all === 'true' && isMapMarkersRequest(req.query);
    
    // Если all=true, возвращаем все холодильники (для карты)
    const shouldPaginate = all !== 'true';
    const limitNum = shouldPaginate && limit ? Math.max(1, Math.min(100, Number(limit))) : undefined;
    const skipNum = shouldPaginate && skip ? Math.max(0, Number(skip)) : 0;

    // Для бухгалтера и НОП фильтруем по городу
    let fridgeQuery = { active: true };
    const scopedCityId = resolveCityFilter(req.user, req.query.cityId);
    if (scopedCityId) {
      fridgeQuery.cityId = scopedCityId;
    }

    if (
      warehouseStatus &&
      typeof warehouseStatus === 'string' &&
      WAREHOUSE_STATUS_ENUM.includes(warehouseStatus)
    ) {
      fridgeQuery.warehouseStatus = warehouseStatus;
    }

    if (search && String(search).trim()) {
      const searchRegex = buildCaseInsensitiveRegex(search);
      if (searchRegex) {
        fridgeQuery.$or = [
          { name: searchRegex },
          { code: searchRegex },
          { number: searchRegex },
          { address: searchRegex },
          { description: searchRegex },
        ];
      }
    }

    if (forMap) {
      Object.assign(fridgeQuery, buildMapLocationFilter());
    }

    let query = Fridge.find(fridgeQuery);
    if (forMap) {
      query = query.select('_id code name address location warehouseStatus status type').lean();
    } else {
      query = query.populate('cityId', 'name code').sort({ createdAt: -1 }).lean();
    }
    if (shouldPaginate && limitNum) {
      query = query.limit(limitNum).skip(skipNum);
    }

    const cacheScopeKey = JSON.stringify({ ...fridgeQuery, forMap: !!forMap });
    const statsScopeSuffix = shouldPaginate
      ? `:p:${skipNum}:${limitNum ?? 'all'}`
      : forMap
        ? ':map'
        : ':all';
    const [total, fridges] = await Promise.all([
      Fridge.countDocuments(fridgeQuery),
      query.exec(),
    ]);
    const statsByFridgeId = await getCheckinStatsForFridges(
      fridges.map((f) => ({
        _id: f._id,
        code: f.code,
        number: f.number,
        clientInfo: f.clientInfo,
        type: f.type,
      })),
      cacheScopeKey + statsScopeSuffix,
      { useCache: true },
    );

    const now = Date.now();

    const result = fridges.map((f) => {
      const { lastVisit, lastVisitTime, lastFridgeCondition } = getLastVisitFromStatsMap(statsByFridgeId, f);

      const visitStatus = visitStatusFromLastVisit(lastVisit, { nowMs: now, fridgeType: f.type });

      if (lastVisitTime != null && lastVisitTime > now) {
        console.warn(
          `[Admin] lastVisit in future for fridge ${f.code}: now=${new Date(now).toISOString()} last=${new Date(lastVisitTime).toISOString()}`,
        );
      }

      const warehouseStatus = f.warehouseStatus || 'warehouse';
      const status = combinedVisitMapStatus(lastVisit, warehouseStatus, {
        nowMs: now,
        fridgeType: f.type,
      });
      const finalStatus = status === 'location_changed' ? (visitStatus || 'never') : status;

      if (forMap) {
        return {
          id: f._id,
          code: f.code,
          name: f.name,
          address: f.address,
          location: f.location,
          status: finalStatus,
          warehouseStatus,
          visitStatus,
          equipmentStatus: resolveEquipmentStatus(f.status, lastFridgeCondition),
        };
      }

      return {
        id: f._id,
        code: f.code,
        name: f.name,
        address: f.address,
        city: f.cityId || null,
        location: f.location,
        lastVisit,
        status: finalStatus, // комбинированный статус для цвета (гарантированно не location_changed)
        warehouseStatus, // статус склада
        visitStatus, // статус последнего визита
        equipmentStatus: resolveEquipmentStatus(f.status, lastFridgeCondition),
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

// GET /api/admin/map-fridges?west=&south=&east=&north=&zoom=&cityId=
// Точки или серверные кластеры только для видимой области (как 2GIS / карты с viewport).
router.get('/map-fridges', authenticateToken, requireAdminOrAccountantOrSalesHead, async (req, res) => {
  try {
    if (req.user.role === 'sales_head' && !getAssignedCityId(req.user)) {
      return res.status(403).json({
        error: 'Для НОП не назначен город. Обратитесь к администратору.',
      });
    }

    const payload = await fetchMapFridgeViewport(req.user, req.query);
    return res.json(payload);
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({
      error: status === 400 ? err.message : 'Failed to load map viewport',
      details: err.message,
    });
  }
});

// GET /api/admin/map-fridges/bulk?cityId=&skip=&limit=
// Все точки города порциями — клиент lazy load, потом одна отрисовка на карте.
router.get('/map-fridges/bulk', authenticateToken, requireAdminOrAccountantOrSalesHead, async (req, res) => {
  try {
    if (req.user.role === 'sales_head' && !getAssignedCityId(req.user)) {
      return res.status(403).json({
        error: 'Для НОП не назначен город. Обратитесь к администратору.',
      });
    }

    const payload = await fetchMapFridgeBulk(req.user, req.query);
    return res.json(payload);
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({
      error: status === 400 ? err.message : 'Failed to load map bulk',
      details: err.message,
    });
  }
});

// GET /api/admin/export-sales-report
// Алиас полного отчёта (как export-fridges) для НОП
router.get('/export-sales-report', authenticateToken, requireSalesHead, async (req, res) => {
  try {
    if (req.user.role === 'sales_head' && !getAssignedCityId(req.user)) {
      return res.status(403).json({
        error: 'Для НОП не назначен город. Обратитесь к администратору.',
      });
    }

    const { cityId, equipmentStatus, search, period } = req.query;
    let cityName = '';
    const scopedCityId = resolveCityFilter(req.user, cityId);
    if (scopedCityId) {
      const city = await City.findById(scopedCityId).select('name').lean();
      cityName = city?.name || '';
    }

    const exportPeriod = parseExportPeriod(period);

    const excelBuffer = await generateFullExportBuffer(
      req.user,
      { cityId, equipmentStatus, search, period: exportPeriod.key },
      { geocode: false, activeOnly: false },
    );

    const fileName = buildFridgesExportFileName(cityName, exportPeriod.fileSuffix);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    return res.send(excelBuffer);
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to export sales report',
      details: err.message,
    });
  }
});

// GET /api/admin/export-fridges
// Полный Excel: холодильники + состояние фонда + ремонты + отметки ТП
// Доступно админам, бухгалтерам и НОП (по своему городу)
router.get(
  '/export-fridges',
  authenticateToken,
  requireAdminOrAccountantOrSalesHead,
  attachLongRunningTimeouts(),
  async (req, res) => {
  try {
    if (req.user.role === 'sales_head' && !getAssignedCityId(req.user)) {
      return res.status(403).json({
        error: 'Для НОП не назначен город. Обратитесь к администратору.',
      });
    }

    const enableGeocoding = req.query.geocode !== 'false';
    let { cityId, equipmentStatus, search, period } = req.query;
    if (req.user.role === 'admin') {
      cityId = undefined;
    }

    let cityName = '';
    const scopedCityId = resolveCityFilter(req.user, cityId);
    if (scopedCityId) {
      const city = await City.findById(scopedCityId).select('name').lean();
      cityName = city?.name || '';
    }

    const exportPeriod = parseExportPeriod(period);

    console.log(
      `[Export] Generating full report for ${req.user.role}${cityName ? ` (${cityName})` : ''}, period=${exportPeriod.key}...`,
    );
    const started = Date.now();
    const excelBuffer = await generateFullExportBuffer(
      req.user,
      { cityId, equipmentStatus, search, period: exportPeriod.key },
      { geocode: enableGeocoding, activeOnly: false },
    );
    console.log(
      `[Export] Done in ${((Date.now() - started) / 1000).toFixed(1)}s, ${excelBuffer.length} bytes`,
    );

    const fileName = buildFridgesExportFileName(cityName, exportPeriod.fileSuffix);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    return res.send(excelBuffer);
  } catch (err) {
    return res
      .status(500)
      .json({ error: 'Failed to export fridges', details: err.message });
  }
},
);

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

    // Определяем город ДО проверки колонок (нужно для минимального формата Астаны)
    let city;
    const requestedCityId = req.body?.cityId || req.query?.cityId;
    if (requestedCityId) {
      city = await City.findById(requestedCityId);
      if (!city) {
        return res.status(400).json({ error: 'Указанный город не найден' });
      }
      if (req.user.role === 'accountant' && req.user.cityId && city._id.toString() !== req.user.cityId.toString()) {
        return res.status(403).json({ error: 'Доступ запрещён: можно импортировать только в свой город' });
      }
    } else if (req.user.role === 'accountant' && req.user.cityId) {
      city = await City.findById(req.user.cityId);
      if (!city) {
        return res.status(400).json({ error: 'Город бухгалтера не найден' });
      }
    } else {
      city = null; // Для админа без cityId - проверим позже
    }

    // Ищем строку с заголовками
    // Стандартный формат: "Адрес" или "Контрагент"
    // Минимальный складской формат: "Оборудование" и "Номер"
    let headerRow = -1;
    for (let i = 0; i < Math.min(10, rawData.length); i++) {
      const row = rawData[i];
      if (row && Array.isArray(row)) {
        const rowStr = row.map(cell => String(cell || '').toLowerCase()).join(' ');
        if (rowStr.includes('адрес') || rowStr.includes('контрагент') ||
            rowStr.includes('номер') || rowStr.includes('оборудование')) {
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
        details: 'Убедитесь, что в файле есть колонки "Адрес", "Контрагент", "Номер" или "Оборудование"'
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

    // Новый формат: Контрагент, Договор, Оборудование (опционально), Номер, Адрес
    const contractorIdx = findColumnIndex(['контрагент']);
    const contractNumIdx = findColumnIndex(['договор', 'дог']);
    const equipmentIdx = findColumnIndex(['оборудование', 'equipment']);
    const addressIdx = findColumnIndex(['адрес']);
    
    // Ищем колонку "Номер" (номер холодильника) - это отдельная колонка, не договор
    let fridgeNumberIdx = -1;
    for (let i = 0; i < headers.length; i++) {
      const header = String(headers[i] || '').toLowerCase().trim();
      // Ищем точно "номер" или "код", но не "договор"
      if ((header === 'номер' || header === 'код') && i !== contractNumIdx) {
        fridgeNumberIdx = i;
        break;
      }
    }
    
    // Если не нашли точное совпадение, ищем по частичному совпадению
    if (fridgeNumberIdx === -1) {
      for (let i = 0; i < headers.length; i++) {
        const header = String(headers[i] || '').toLowerCase();
        if ((header.includes('номер') || header.includes('код')) && 
            !header.includes('договор') && 
            !header.includes('дог') &&
            i !== contractNumIdx) {
          fridgeNumberIdx = i;
          break;
        }
      }
    }

    console.log('[Import] Column indices:', {
      contractorIdx,
      contractNumIdx,
      equipmentIdx,
      addressIdx,
      fridgeNumberIdx,
      headers: headers.slice(0, 10)
    });

    const cityName = (city && city.name) ? String(city.name) : '';

    // Минимальный формат для складских файлов во всех городах:
    // допускается только "Номер" (и опционально "Оборудование") без "Контрагент"/"Адрес"
    const isMinimalWarehouseFormat =
      !!city &&
      fridgeNumberIdx !== -1 &&
      contractorIdx === -1 &&
      addressIdx === -1;

    if (isMinimalWarehouseFormat) {
      if (fridgeNumberIdx === -1) {
        return res.status(400).json({ 
          error: 'Не найдена колонка "Номер" в Excel файле',
          details: `Найденные заголовки: ${headers.join(', ')}`
        });
      }
      if (!city) {
        return res.status(400).json({ error: 'Не указан город для импорта. Пожалуйста, выберите город.' });
      }
      console.log(`[Import] ${cityName || 'City'} warehouse minimal format: only Номер required (Оборудование optional)`);
    } else {
      // Обычный формат: требуем Контрагент, Адрес и Номер
      if (!city) {
        return res.status(400).json({ error: 'Не указан город для импорта. Пожалуйста, выберите город.' });
      }
      if (contractorIdx === -1) {
        return res.status(400).json({ error: 'Не найдена колонка "Контрагент" в Excel файле' });
      }
      if (addressIdx === -1) {
        return res.status(400).json({ error: 'Не найдена колонка "Адрес" в Excel файле' });
      }
      if (fridgeNumberIdx === -1) {
        return res.status(400).json({ 
          error: 'Не найдена колонка "Номер" в Excel файле',
          details: `Найденные заголовки: ${headers.join(', ')}`
        });
      }
    }

    // Город обязателен для импорта
    if (!city) {
      return res.status(400).json({ error: 'Не указан город для импорта. Пожалуйста, выберите город.' });
    }
    
    console.log('[Import] City:', city.name, city.code, 'ID:', city._id);

    // Парсим данные
    const records = [];
    // Не нужен codeCounter - всегда используем номер из Excel

    console.log('[Import] Starting to parse data:', {
      dataStartRow,
      totalRows: rawData.length,
      rowsToProcess: rawData.length - dataStartRow
    });

    let skippedNoAddress = 0;
    let skippedEmptyRow = 0;
    let skippedNoNumber = 0; // Для городов с номерами
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
      
      // Для всех городов: если в файле указаны только номера без контрагента и адреса,
      // такие строки считаем "холодильниками на складе" и НЕ пропускаем их.
      const isWarehouseRow =
        (!address || address === 'null' || address === 'undefined') &&
        (!contractor || contractor === 'null' || contractor === 'undefined');

      // Пропускаем строку только если она полностью пустая (нет ни адреса, ни контрагента)
      // Для всех городов оставляем строки, где есть только номер (warehouse),
      // чтобы создать по ним холодильники со статусом "warehouse"
      if (!isWarehouseRow &&
          (!address || address === 'null' || address === 'undefined') && 
          (!contractor || contractor === 'null' || contractor === 'undefined')) {
        skippedNoAddress++;
        if (processedRows <= 5) {
          console.log(`[Import] Row ${i} skipped - empty row. Row data:`, row.slice(0, 5));
        }
        continue; // Пропускаем полностью пустые строки
      }

      // Используем контрагента для названия, если он есть
      const name = contractor || 'Холодильник';

      // Формируем описание из Договора и Оборудования
      const descriptionParts = [];
      if (contractNumIdx >= 0) {
        const contractNum = String(row[contractNumIdx] || '').trim();
        if (contractNum && contractNum !== 'Без договора' && contractNum !== 'null' && contractNum !== 'undefined') {
          descriptionParts.push(`Договор: ${contractNum}`);
        }
      }
      // Оборудование (опционально)
      if (equipmentIdx >= 0) {
        const equipment = String(row[equipmentIdx] || '').trim();
        if (equipment && equipment !== 'null' && equipment !== 'undefined') {
          descriptionParts.push(`Оборудование: ${equipment}`);
        }
      }
      const description = descriptionParts.length > 0 ? descriptionParts.join('; ') : null;

      // Номер из Excel обязателен - всегда используем его как code
      const numberValue = String(row[fridgeNumberIdx] || '').trim();
      if (!numberValue || numberValue === 'null' || numberValue === 'undefined') {
        console.warn(`[Import] Row ${i}: Number is empty. Skipping.`);
        skippedNoNumber++;
        continue; // Пропускаем строку без номера
      }
      
      const fridgeNumber = numberValue;
      const code = fridgeNumber; // Всегда используем номер из Excel как code
      
      const record = {
        code, // Всегда равен номеру из Excel
        name: name.substring(0, 200),
        cityId: city._id,
        address: address ? address.substring(0, 500) : null, // Сохраняем адрес из Excel (если есть)
        description: description ? description.substring(0, 500) : null,
        number: fridgeNumber, // Сохраняем также в поле number
        location: {
          type: 'Point',
          coordinates: [0.0, 0.0], // Временные координаты
        },
        active: true,
      };

      // Для всех городов: строки без адреса и контрагента (только номер) считаем "на складе"
      // и сразу выставляем статус склада = warehouse
      if (isWarehouseRow) {
        record.warehouseStatus = 'warehouse';
        record.statusHistory = [{
          status: 'warehouse',
          changedAt: new Date(),
          changedBy: req.user && req.user.id ? req.user.id : null,
          notes: `Импорт со склада (${cityName || 'Неизвестный город'})`,
        }];
      }

      records.push(record);
    }

    console.log('[Import] Parsing complete:', {
      recordsFound: records.length,
      skippedNoAddress,
      skippedNoNumber,
      skippedEmptyRow,
      processedRows
    });

    if (records.length === 0) {
      console.log('[Import] No records to import. Sample rows:', rawData.slice(dataStartRow, dataStartRow + 5));
      return res.status(400).json({ 
        error: 'Не найдено данных для импорта',
        details: `Обработано строк: ${processedRows}, пропущено без адреса: ${skippedNoAddress}, пропущено без номера: ${skippedNoNumber}, пропущено пустых: ${skippedEmptyRow}. Убедитесь, что в файле есть колонка "Адрес" с данными.`
      });
    }

    // Импортируем в базу данных
    // Загружаем существующие коды для проверки дубликатов
    console.log('[Import] Loading existing fridge codes for duplicate check...');
    
    const existingFridges = await Fridge.find({}, { code: 1, cityId: 1, number: 1 }).lean();
    const existingCodes = new Set(existingFridges.map(f => f.code));
    
    // Проверяем дубликаты по number + cityId
    const existingByNumberAndCity = new Map();
    existingFridges
      .filter(f => {
        // Проверяем, что есть number и cityId совпадает
        if (!f.number) return false;
        if (!f.cityId) return false;
        // Сравниваем cityId как строки для надежности
        const fCityId = f.cityId.toString ? f.cityId.toString() : String(f.cityId);
        const targetCityId = city._id.toString ? city._id.toString() : String(city._id);
        return fCityId === targetCityId;
      })
      .forEach(f => {
        const key = `${f.number}|${city._id}`;
        existingByNumberAndCity.set(key, f.code); // Сохраняем также code для логирования
      });
    
    console.log('[Import] Found', existingCodes.size, 'existing fridges total');
    console.log('[Import] Found', existingByNumberAndCity.size, 'existing fridges with numbers in city', city.name);
    if (existingByNumberAndCity.size > 0) {
      console.log('[Import] Sample existing numbers:', Array.from(existingByNumberAndCity.keys()).slice(0, 5));
    }

    // Фильтруем записи, исключая дубликаты
    const recordsToInsert = [];
    let duplicates = 0;
    const codesInThisImport = new Set(); // Для проверки дубликатов внутри импорта
    const numbersInThisImport = new Set(); // Для проверки дубликатов номеров внутри импорта (для городов с номерами)
    const duplicateDetails = []; // Для логирования деталей дубликатов
    
    for (const record of records) {
      let isDuplicate = false;
      let duplicateReason = '';
      
      // Проверяем дубликат по code
      if (existingCodes.has(record.code)) {
        isDuplicate = true;
        duplicateReason = `code "${record.code}" already exists in database`;
      } else if (codesInThisImport.has(record.code)) {
        isDuplicate = true;
        duplicateReason = `code "${record.code}" duplicate in this import file`;
      }
      
      // Проверяем дубликаты по number + cityId
      if (!isDuplicate && record.number) {
        // Проверяем в базе данных
        const key = `${record.number}|${city._id}`;
        if (existingByNumberAndCity.has(key)) {
          isDuplicate = true;
          const existingCode = existingByNumberAndCity.get(key);
          duplicateReason = `number "${record.number}" already exists in database (code: ${existingCode})`;
        }
        // Проверяем дубликаты внутри импорта
        else if (numbersInThisImport.has(record.number)) {
          isDuplicate = true;
          duplicateReason = `number "${record.number}" duplicate in this import file`;
        }
      }
      
      if (isDuplicate) {
        duplicates++;
        // Логируем первые 10 дубликатов для отладки
        if (duplicateDetails.length < 10) {
          duplicateDetails.push({
            code: record.code,
            number: record.number || 'N/A',
            name: record.name,
            reason: duplicateReason
          });
        }
        continue;
      }
      
      // Добавляем код и номер в Set, чтобы избежать дубликатов в текущем импорте
      codesInThisImport.add(record.code);
      if (record.number) {
        numbersInThisImport.add(record.number);
      }
      recordsToInsert.push(record);
    }
    
    if (duplicateDetails.length > 0) {
      console.log('[Import] Duplicate details (first 10):', duplicateDetails);
    }

    const geocodeOnImport =
      req.body?.geocodeAddresses === '1' ||
      req.body?.geocodeAddresses === 'true' ||
      String(req.body?.geocodeAddresses || '').toLowerCase() === 'on';

    let importGeocodeOk = 0;
    let importGeocodeFail = 0;
    let importGeocodeSkipped = 0;

    if (geocodeOnImport && recordsToInsert.length > 0) {
      const { forwardGeocodeQuery } = require('../lib/nominatimGeocode');
      console.log(
        '[Import] Geocoding addresses (OpenStreetMap Nominatim, ~1 req/s) for',
        recordsToInsert.length,
        'rows...',
      );
      for (const record of recordsToInsert) {
        if (!record.address || !String(record.address).trim()) {
          importGeocodeSkipped += 1;
          continue;
        }
        const query = `${record.address}, ${city.name}, Казахстан`;
        const coords = await forwardGeocodeQuery(query);
        if (coords) {
          record.location = { type: 'Point', coordinates: coords };
          importGeocodeOk += 1;
        } else {
          importGeocodeFail += 1;
        }
      }
      console.log('[Import] Geocode summary:', { importGeocodeOk, importGeocodeFail, importGeocodeSkipped });
    }

    console.log('[Import] Starting bulk insert for', recordsToInsert.length, 'records (skipped', duplicates, 'duplicates)');

    let imported = 0;
    let errors = 0;

    // Используем bulkWrite для массовой вставки (быстрее чем отдельные create)
    if (recordsToInsert.length > 0) {
      try {
        // Разбиваем на батчи по 50 записей для избежания перегрузки и таймаута
        const batchSize = 50;
        for (let i = 0; i < recordsToInsert.length; i += batchSize) {
          const batch = recordsToInsert.slice(i, i + batchSize);
          const operations = batch.map(record => ({
            insertOne: { document: record }
          }));
          
          try {
            await Fridge.bulkWrite(operations, { ordered: false });
            imported += batch.length;
            console.log(`[Import] Inserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(recordsToInsert.length / batchSize)}, imported: ${imported}/${recordsToInsert.length}`);
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
      duplicateDetails: duplicateDetails.slice(0, 10), // Возвращаем детали первых 10 дубликатов
      geocodeOnImport,
      importGeocodeOk,
      importGeocodeFail,
      importGeocodeSkipped,
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
// Создание нового холодильника (для админа и бухгалтера, без автогенерации кода)
router.post('/fridges', authenticateToken, requireAdminOrAccountant, async (req, res) => {
  try {
    const { name, address, description, cityId, number, clientInfo } = req.body;
    
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

    // При ручном создании для всех городов ИНН клиента обязателен
    if (!clientInfo || !clientInfo.inn) {
      return res.status(400).json({ error: 'При ручном создании необходимо указать ИНН клиента' });
    }

    // Определяем code для холодильника
    // При ручном создании для всех городов используем ИНН как code
    let code;
    let fridgeClientInfo = null;
    
    if (clientInfo && clientInfo.inn) {
      code = String(clientInfo.inn).trim();
      if (!code) {
        return res.status(400).json({ error: 'ИНН клиента не может быть пустым' });
      }
      
      // Сохраняем clientInfo
      fridgeClientInfo = { inn: code };
      
      // Проверяем, не существует ли уже холодильник с таким code
      const existingFridge = await Fridge.findOne({ code });
      if (existingFridge) {
        return res.status(400).json({ error: `Холодильник с ИНН "${code}" уже существует` });
      }
    } else {
      // Если ИНН не указан (не должно произойти, т.к. проверка выше), генерируем код
      let codeCounter = 1;
      const maxFridge = await Fridge.findOne().sort({ code: -1 });
      if (maxFridge && maxFridge.code) {
        const maxCode = parseInt(maxFridge.code, 10);
        if (!isNaN(maxCode)) {
          codeCounter = maxCode + 1;
        }
      }

      code = String(codeCounter);
      while (await Fridge.findOne({ code })) {
        codeCounter++;
        code = String(codeCounter);
      }
    }

    // Создаем холодильник с временными координатами (0, 0)
    // По умолчанию статус = 'warehouse' (на складе)
    const fridgeData = {
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
    };

    // При ручном создании для всех городов сохраняем clientInfo с ИНН
    if (fridgeClientInfo) {
      fridgeData.clientInfo = fridgeClientInfo;
    }

    const fridge = await Fridge.create(fridgeData);

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

// POST /api/admin/fridges/geocode-locations
// Координаты по тексту адреса (Nominatim). Роут до GET /fridges/:id не обязателен, но оставляем явным именем.
router.post('/fridges/geocode-locations', authenticateToken, requireAdminOrAccountant, async (req, res) => {
  try {
    const { cityId, mode } = req.body || {};
    if (!cityId) {
      return res.status(400).json({ error: 'Укажите cityId' });
    }
    if (req.user.role === 'accountant' && req.user.cityId && String(cityId) !== String(req.user.cityId)) {
      return res.status(403).json({ error: 'Можно обрабатывать только свой город' });
    }

    const city = await City.findById(cityId).lean();
    if (!city) {
      return res.status(404).json({ error: 'Город не найден' });
    }

    const fullMode = mode === 'all_with_address' ? 'all_with_address' : 'zero_only';

    const fridges = await Fridge.find({ cityId })
      .select('_id address location code warehouseStatus')
      .lean();

    const { forwardGeocodeQuery } = require('../lib/nominatimGeocode');
    const { isAtCityDepotCenter } = require('../lib/fridgeReturnHelpers');

    let updated = 0;
    let failed = 0;
    let skipped = 0;

    for (const f of fridges) {
      if (!f.address || !String(f.address).trim()) {
        skipped += 1;
        continue;
      }
      const c = f.location && f.location.coordinates;
      const isZero =
        !c ||
        !Array.isArray(c) ||
        c.length < 2 ||
        (Number(c[0]) === 0 && Number(c[1]) === 0);
      const atDepotCenter = isAtCityDepotCenter(
        { location: f.location, warehouseStatus: 'warehouse' },
        city,
      );
      if (fullMode === 'zero_only' && !isZero && !atDepotCenter) {
        skipped += 1;
        continue;
      }

      const query = `${f.address}, ${city.name}, Казахстан`;
      const coords = await forwardGeocodeQuery(query);
      if (!coords) {
        failed += 1;
        continue;
      }

      await Fridge.updateOne(
        { _id: f._id },
        { $set: { location: { type: 'Point', coordinates: coords } } },
      );
      updated += 1;
    }

    return res.json({
      success: true,
      updated,
      failed,
      skipped,
      mode: fullMode,
      cityName: city.name,
    });
  } catch (err) {
    console.error('[Admin] geocode-locations:', err);
    return res.status(500).json({ error: 'Ошибка геокодирования', details: err.message });
  }
});

// GET /api/admin/fridges/:id
// Получить детальную информацию о холодильнике
router.get('/fridges/:id', authenticateToken, requireAdminOrAccountant, async (req, res) => {
  try {
    const { id } = req.params;
    const fridgeDoc = await Fridge.findById(id)
      .populate('cityId', 'name code')
      .populate('statusHistory.changedBy', 'username fullName');

    if (!fridgeDoc) {
      return res.status(404).json({ error: 'Холодильник не найден' });
    }

    // Для бухгалтеров проверяем, что холодильник из их города
    if (req.user.role === 'accountant' && !userCanAccessFridge(req.user, fridgeDoc)) {
      console.log('Accountant access denied - wrong city:', {
        accountantCityId: req.user.cityId,
        fridgeCityId: fridgeDoc.cityId?._id || fridgeDoc.cityId,
      });
      return res.status(403).json({ error: 'Доступ запрещён: холодильник из другого города' });
    }

    const idMatch = buildCheckinFridgeIdMatchCondition(fridgeDoc);

    const latestCheckin = idMatch
      ? await Checkin.findOne(idMatch, { visitedAt: 1 }).sort({ visitedAt: -1 }).lean()
      : null;

    const lastVisit = latestCheckin?.visitedAt || null;
    const visitStatus = visitStatusFromLastVisit(lastVisit, { nowMs: Date.now() });

    const fridge = fridgeDoc.toObject();
    fridge.lastVisit = lastVisit;
    fridge.visitStatus = visitStatus;

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
    if (req.user.role === 'accountant' && !userCanAccessFridge(req.user, fridge)) {
      return res.status(403).json({ error: 'Доступ запрещён: холодильник из другого города' });
    }

    const idMatch = buildCheckinFridgeIdMatchCondition(fridge);
    const checkins = idMatch
      ? await Checkin.find(idMatch).sort({ visitedAt: -1 }).limit(parseInt(limit, 10))
      : [];

    return res.json(checkins);
  } catch (err) {
    return res.status(500).json({ error: 'Ошибка получения истории', details: err.message });
  }
});

// GET /api/admin/analytics
// Аналитика: посещения по дням, статистика по менеджерам, топ непосещаемых
router.get('/analytics', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { days = 30, cityId } = req.query;
    const daysNum = parseInt(days, 10) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysNum);
    startDate.setHours(0, 0, 0, 0);

    const fridgeQuery = { active: true };
    if (cityId && cityId !== 'all') {
      fridgeQuery.cityId = cityId;
    }

    const allFridges = await Fridge.find(fridgeQuery)
      .select('code number name address cityId clientInfo type')
      .populate('cityId', 'name')
      .lean();

    let periodMatch = { visitedAt: { $gte: startDate } };
    if (cityId && cityId !== 'all') {
      if (allFridges.length === 0) {
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
      periodMatch = await buildAnalyticsPeriodMatch(cityId, startDate);
    }

    const statsCacheKey = JSON.stringify({ route: 'admin-analytics', cityId: cityId || 'all' });
    const statsByFridgeId = await getCheckinStatsForFridges(allFridges, statsCacheKey, { useCache: true });

    const [
      checkinsByDay,
      managerStats,
      totalFridges,
      uniqueManagers,
      fridgesByStatus,
    ] = await Promise.all([
      Checkin.aggregate(buildDailyCheckinsAggregationStages(periodMatch)),
      Checkin.aggregate([
        { $match: periodMatch },
        {
          $group: {
            _id: '$managerId',
            count: { $sum: 1 },
            lastVisit: { $max: '$visitedAt' },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ]),
      Fridge.countDocuments(fridgeQuery),
      Checkin.distinct('managerId', periodMatch),
      Fridge.aggregate([
        { $match: fridgeQuery },
        {
          $group: {
            _id: '$warehouseStatus',
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const dailyCheckins = mapDailyCheckinsAggregationResult(checkinsByDay);

    // Обогащаем статистику данными о менеджерах
    let enrichedManagerStats = managerStats;
    if (managerStats.length > 0) {
      const managerIds = managerStats.map((m) => m._id);
      const objectIdStrings = managerIds.filter((id) => mongoose.isValidObjectId(id));
      const objectIds = objectIdStrings.map((id) => new mongoose.Types.ObjectId(id));

      const users = await User.find({
        $or: [
          { username: { $in: managerIds } },
          { _id: { $in: objectIds } },
        ],
      }).select('username fullName');

      const userMap = new Map();
      users.forEach((u) => {
        if (u.username) userMap.set(u.username, u);
        userMap.set(String(u._id), u);
      });

      const detailed = managerStats.map((m) => {
        const user =
          userMap.get(String(m._id)) ||
          userMap.get(m._id);
        return {
          ...m,
          username: user ? user.username : String(m._id),
          fullName: user && user.fullName ? user.fullName : '',
        };
      });

      const mergedMap = new Map();
      detailed.forEach((m) => {
        const key = m.username || String(m._id);
        const existing = mergedMap.get(key);
        if (!existing) {
          mergedMap.set(key, { ...m });
        } else {
          existing.count += m.count;
          if (m.lastVisit && (!existing.lastVisit || new Date(m.lastVisit) > new Date(existing.lastVisit))) {
            existing.lastVisit = m.lastVisit;
          }
        }
      });

      enrichedManagerStats = Array.from(mergedMap.values());
    }

    const topUnvisited = buildTopUnvisitedFromFridges(allFridges, statsByFridgeId);

    const totalCheckins = dailyCheckins.reduce((sum, row) => sum + row.count, 0);

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
      managerStats: enrichedManagerStats,
      topUnvisited,
      summary: {
        totalFridges,
        totalCheckins,
        uniqueManagers: uniqueManagers.length,
        // Среднее количество отметок в день
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
// Аналитика отметок ТП для бухгалтера и НОП (по городу)
router.get('/analytics/accountant', authenticateToken, requireAdminOrAccountantOrSalesHead, async (req, res) => {
  try {
    const scopedCityId = resolveCityFilter(req.user, req.query.cityId);
    if ((req.user.role === 'accountant' || req.user.role === 'sales_head') && !scopedCityId) {
      return res.status(403).json({ error: 'Для роли не назначен город. Обратитесь к администратору.' });
    }
    if (req.user.role === 'admin' && !scopedCityId) {
      return res.json({
        dailyCheckins: [],
        managerStats: [],
        topUnvisited: [],
        summary: {
          totalFridges: 0,
          totalCheckins: 0,
          uniqueManagers: 0,
          avgCheckinsPerDay: 0,
          withoutCheckinsInPeriod: 0,
          neverVisited: 0,
          fridgesByStatus: { warehouse: 0, installed: 0, returned: 0 },
        },
      });
    }

    const { days = 30 } = req.query;
    const daysNum = parseInt(days, 10) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysNum);

    const cityFridges = await Fridge.find({
      cityId: scopedCityId,
      active: true,
    })
      .select('code number name address warehouseStatus clientInfo type')
      .populate('cityId', 'name code')
      .lean();

    if (cityFridges.length === 0) {
      return res.json({
        dailyCheckins: [],
        managerStats: [],
        topUnvisited: [],
        summary: {
          totalFridges: 0,
          totalCheckins: 0,
          uniqueManagers: 0,
          avgCheckinsPerDay: 0,
          withoutCheckinsInPeriod: 0,
          neverVisited: 0,
          fridgesByStatus: { warehouse: 0, installed: 0, returned: 0 },
        },
      });
    }

    const periodMatch = await buildAnalyticsPeriodMatch(scopedCityId, startDate);

    const statsCacheKey = JSON.stringify({ route: 'accountant-analytics', cityId: String(scopedCityId) });
    const statsByFridgeId = await getCheckinStatsForFridges(cityFridges, statsCacheKey, { useCache: true });

    const [
      checkinsByDay,
      managerStats,
      uniqueFridgeIds,
      uniqueManagers,
    ] = await Promise.all([
      Checkin.aggregate(buildDailyCheckinsAggregationStages(periodMatch)),
      Checkin.aggregate([
        { $match: periodMatch },
        {
          $group: {
            _id: '$managerId',
            count: { $sum: 1 },
            lastVisit: { $max: '$visitedAt' },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ]),
      Checkin.distinct('fridgeId', periodMatch),
      Checkin.distinct('managerId', periodMatch),
    ]);

    const dailyCheckins = mapDailyCheckinsAggregationResult(checkinsByDay);

    // Обогащаем статистику данными о менеджерах
    let enrichedManagerStats = managerStats;
    if (managerStats.length > 0) {
      const managerIds = managerStats.map((m) => m._id);
      const objectIdStrings = managerIds.filter((id) => mongoose.isValidObjectId(id));
      const objectIds = objectIdStrings.map((id) => new mongoose.Types.ObjectId(id));

      const users = await User.find({
        $or: [
          { username: { $in: managerIds } },
          { _id: { $in: objectIds } },
        ],
      }).select('username fullName');

      const userMap = new Map();
      users.forEach((u) => {
        if (u.username) userMap.set(u.username, u);
        userMap.set(String(u._id), u);
      });

      const detailed = managerStats.map((m) => {
        const user =
          userMap.get(String(m._id)) ||
          userMap.get(m._id);
        return {
          ...m,
          username: user ? user.username : String(m._id),
          fullName: user && user.fullName ? user.fullName : '',
        };
      });

      // Объединяем по username: если у одного менеджера были разные managerId, складываем count
      const mergedMap = new Map();
      detailed.forEach((m) => {
        const key = m.username || String(m._id);
        const existing = mergedMap.get(key);
        if (!existing) {
          mergedMap.set(key, { ...m });
        } else {
          existing.count += m.count;
          if (m.lastVisit && (!existing.lastVisit || new Date(m.lastVisit) > new Date(existing.lastVisit))) {
            existing.lastVisit = m.lastVisit;
          }
        }
      });

      enrichedManagerStats = Array.from(mergedMap.values());
    }

    const lastVisitMap = new Map();
    cityFridges.forEach((fridge) => {
      const { lastVisit } = getLastVisitFromStatsMap(statsByFridgeId, fridge);
      if (!lastVisit) return;
      for (const id of buildCheckinFridgeIdCandidates(fridge)) {
        lastVisitMap.set(id, lastVisit);
        lastVisitMap.set(String(id).trim(), lastVisit);
        const n = Number(id);
        if (Number.isFinite(n)) lastVisitMap.set(n, lastVisit);
      }
    });

    const resolveLastVisit = (fridge) => {
      for (const id of buildCheckinFridgeIdCandidates(fridge)) {
        const hit =
          lastVisitMap.get(id) ??
          lastVisitMap.get(String(id).trim()) ??
          (Number.isFinite(Number(id)) ? lastVisitMap.get(Number(id)) : undefined);
        if (hit) return hit;
      }
      return null;
    };

    const fridgesWithLastVisit = cityFridges.map((f) => {
      const lastVisit = resolveLastVisit(f);
      const daysSinceVisit = lastVisit
        ? Math.floor((Date.now() - new Date(lastVisit).getTime()) / (1000 * 60 * 60 * 24))
        : null;
      return {
        code: f.code,
        number: f.number,
        name: f.name,
        address: f.address,
        cityId: f.cityId || null,
        type: f.type || 'regular',
        lastVisit,
        daysSinceVisit,
      };
    });

    const topUnvisited = buildTopUnvisitedFromFridges(cityFridges, statsByFridgeId);

    const visitedInPeriodSet = new Set();
    uniqueFridgeIds.forEach((id) => {
      visitedInPeriodSet.add(String(id).trim());
      const n = Number(id);
      if (Number.isFinite(n)) visitedInPeriodSet.add(String(n));
    });

    const fridgeVisitedInPeriod = (fridge) =>
      buildCheckinFridgeIdCandidates(fridge).some((id) => {
        const s = String(id).trim();
        return visitedInPeriodSet.has(s)
          || (Number.isFinite(Number(s)) && visitedInPeriodSet.has(String(Number(s))));
      });

    const totalFridges = cityFridges.length;
    const totalCheckins = dailyCheckins.reduce((sum, row) => sum + row.count, 0);
    const withoutCheckinsInPeriod = cityFridges.filter(
      (f) => shouldCountAsWithoutCheckinsInPeriod(f, fridgeVisitedInPeriod(f)),
    ).length;
    const neverVisited = fridgesWithLastVisit.filter(
      (row) => shouldCountAsNeverVisited({ type: row.type }, row.lastVisit),
    ).length;

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
      managerStats: enrichedManagerStats,
      topUnvisited,
      summary: {
        totalFridges,
        totalCheckins,
        uniqueManagers: uniqueManagers.length,
        avgCheckinsPerDay: daysNum > 0 ? Number((totalCheckins / daysNum).toFixed(2)) : 0,
        withoutCheckinsInPeriod,
        neverVisited,
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
      const searchRegex = buildCaseInsensitiveRegex(search);
      if (searchRegex) {
        filter.$or = [
          { username: searchRegex },
          { fullName: searchRegex },
        ];
      }
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

    if (!USER_ROLES.includes(role)) {
      return res.status(400).json({
        error: `Некорректная роль. Допустимые: ${USER_ROLES.join(', ')}`,
      });
    }

    if (['accountant', 'service_manager', 'sales_head', 'manager'].includes(role) && !cityId) {
      return res.status(400).json({ error: 'Для этой роли необходимо указать город (cityId)' });
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
    if (role !== undefined) {
      if (!USER_ROLES.includes(role)) {
        return res.status(400).json({
          error: `Некорректная роль. Допустимые: ${USER_ROLES.join(', ')}`,
        });
      }
      user.role = role;
    }
    if (fullName !== undefined) user.fullName = fullName;
    if (phone !== undefined) user.phone = phone;
    if (cityId !== undefined) user.cityId = normalizeCityId(cityId);
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
    if (req.user.role === 'accountant' && !userCanAccessFridge(req.user, fridge)) {
      return res.status(403).json({ error: 'Доступ запрещён: можно редактировать только холодильники своего города' });
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
    const { warehouseStatus, clientInfo, notes, isSeasonalClosure } = req.body;

    if (!warehouseStatus || !['warehouse', 'installed', 'returned', 'moved'].includes(warehouseStatus)) {
      return res.status(400).json({ error: 'Некорректный статус' });
    }

    const fridge = await Fridge.findById(req.params.id);
    if (!fridge) {
      return res.status(404).json({ error: 'Холодильник не найден' });
    }

    // Для бухгалтера проверяем, что холодильник принадлежит его городу
    if (req.user.role === 'accountant' && !userCanAccessFridge(req.user, fridge)) {
      return res.status(403).json({ error: 'Доступ запрещён: можно редактировать только холодильники своего города' });
    }

    // Обновляем warehouseStatus
    const oldStatus = fridge.warehouseStatus;
    fridge.warehouseStatus = warehouseStatus;

    if (isSeasonalClosure !== undefined) {
      fridge.isSeasonalClosure = isSeasonalClosure === true || isSeasonalClosure === 'true';
    }

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
        changedBy: req.user.id,
        notes: notes || `Изменен статус с "${oldStatus}" на "${warehouseStatus}"`,
      });

      // На складе / возврат: заглушка в центре города до отметки менеджера
      if (WAREHOUSE_STATUSES.has(warehouseStatus)) {
        let cityDoc = fridge.cityId;
        if (cityDoc && typeof cityDoc === 'object' && !cityDoc.name) {
          cityDoc = null;
        }
        if (!cityDoc?.name && fridge.cityId) {
          cityDoc = await City.findById(fridge.cityId).select('name code').lean();
        }
        applyReturnToHomeCity(fridge, cityDoc);
      } else if (warehouseStatus === 'installed' || warehouseStatus === 'moved') {
        fridge.locationAtDepot = false;
      }
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
    const { name, address, description, cityId, active, isSeasonalClosure } = req.body;

    const fridge = await Fridge.findById(req.params.id);
    if (!fridge) {
      return res.status(404).json({ error: 'Холодильник не найден' });
    }

    // Для бухгалтера проверяем, что холодильник принадлежит его городу
    if (req.user.role === 'accountant' && !userCanAccessFridge(req.user, fridge)) {
      return res.status(403).json({ error: 'Доступ запрещён: можно редактировать только холодильники своего города' });
    }

    // Бухгалтер может редактировать только название, адрес и описание
    // Админ может редактировать все поля, включая cityId и active
    if (name !== undefined) fridge.name = name;
    if (address !== undefined) fridge.address = address;
    if (description !== undefined) fridge.description = description;
    if (isSeasonalClosure !== undefined) {
      fridge.isSeasonalClosure = isSeasonalClosure === true || isSeasonalClosure === 'true';
    }
    
    // Только админ может менять cityId и active
    if (req.user.role === 'admin') {
      if (cityId !== undefined) fridge.cityId = normalizeCityId(cityId);
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

// DELETE /api/admin/fridges/city/:cityId
// Удалить все холодильники определенного города (только для админа)
// ВАЖНО: Этот роут должен быть ПЕРЕД /fridges/:id, чтобы Express обрабатывал точное совпадение первым
router.delete('/fridges/city/:cityId', authenticateToken, requireAdmin, async (req, res) => {
  let checkinsDeleted = 0;
  let deletedCount = 0;
  
  try {
    const cityId = req.params.cityId;
    console.log('[Admin] Starting deletion of all fridges for city:', cityId);
    console.log('[Admin] User:', req.user?.username, req.user?.role);
    
    // Проверяем, что город существует
    const city = await City.findById(cityId);
    if (!city) {
      return res.status(404).json({ error: 'Город не найден' });
    }
    
    // Проверяем, что модели доступны
    if (!Fridge) {
      throw new Error('Fridge model is not available');
    }
    if (!Checkin) {
      console.warn('[Admin] Checkin model is not available, will skip checkin deletion');
    }
    
    // Получаем все холодильники этого города
    const fridges = await Fridge.find({ cityId: cityId });
    const count = fridges.length;
    console.log(`[Admin] Found ${count} fridges to delete for city ${city.name}`);
    
    if (count === 0) {
      return res.json({ 
        message: `Нет холодильников для удаления в городе ${city.name}`, 
        deleted: 0,
        checkinsDeleted: 0
      });
    }

    // Собираем все идентификаторы холодильников (code, number, ИНН) для удаления связанных чек-инов
    const fridgeIdentifiers = [];
    fridges.forEach(f => {
      fridgeIdentifiers.push(f.code);
      if (f.number) {
        fridgeIdentifiers.push(f.number);
      }
      if (f.clientInfo?.inn) {
        fridgeIdentifiers.push(f.clientInfo.inn);
      }
    });

    // Удаляем все связанные отметки посещений
    if (Checkin && fridgeIdentifiers.length > 0) {
      try {
        console.log('[Admin] Deleting checkins for city fridges...');
        const checkinResult = await Checkin.deleteMany({ 
          fridgeId: { $in: fridgeIdentifiers } 
        });
        checkinsDeleted = checkinResult.deletedCount || 0;
        console.log(`[Admin] Deleted ${checkinsDeleted} checkins`);
      } catch (checkinErr) {
        // Логируем ошибку, но продолжаем удаление холодильников
        console.error('[Admin] Error deleting checkins (continuing with fridge deletion):', checkinErr);
        console.error('[Admin] Checkin error message:', checkinErr.message);
        // Не прерываем выполнение, просто продолжаем
      }
    } else {
      console.log('[Admin] Skipping checkin deletion (model not available or no identifiers)');
    }

    // Удаляем все холодильники города
    try {
      console.log('[Admin] Deleting fridges for city...');
      const deleteResult = await Fridge.deleteMany({ cityId: cityId });
      deletedCount = deleteResult.deletedCount || 0;
      console.log(`[Admin] Deleted ${deletedCount} fridges`);
    } catch (fridgeErr) {
      console.error('[Admin] Error deleting fridges:', fridgeErr);
      return res.status(500).json({ 
        error: 'Ошибка удаления холодильников', 
        details: fridgeErr.message 
      });
    }

    console.log(`[Admin] Successfully deleted all fridges for city ${city.name}: ${deletedCount} fridges, ${checkinsDeleted} checkins`);

    return res.json({ 
      message: `Удалено ${deletedCount} холодильников и ${checkinsDeleted} отметок посещений из города ${city.name}`, 
      deleted: deletedCount,
      checkinsDeleted: checkinsDeleted,
      cityName: city.name
    });
  } catch (err) {
    console.error('[Admin] Unexpected error deleting city fridges:', err);
    return res.status(500).json({ 
      error: 'Ошибка удаления холодильников города', 
      details: err.message || 'Неизвестная ошибка'
    });
  }
});

// DELETE /api/admin/fridges/:id
// Удалить холодильник
router.delete('/fridges/:id', authenticateToken, requireAdminOrAccountant, async (req, res) => {
  try {
    const fridge = await Fridge.findById(req.params.id);
    if (!fridge) {
      return res.status(404).json({ error: 'Холодильник не найден' });
    }

    if (req.user.role === 'accountant' && !userCanAccessFridge(req.user, fridge)) {
      return res.status(403).json({ error: 'Доступ запрещён: можно удалять только холодильники своего города' });
    }

    const checkinFilter = buildCheckinFilterForFridge(fridge);
    const deletedCheckins = await Checkin.deleteMany(checkinFilter);

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

// GET /api/admin/statistics/by-cities
// Статистика по городам с разбивкой по статусам отметок
router.get('/statistics/by-cities', authenticateToken, requireAdminOrAccountant, async (req, res) => {
  try {
    // Для бухгалтера фильтруем по городу
    let fridgeQuery = { active: true };
    if (req.user.role === 'accountant' && req.user.cityId) {
      fridgeQuery.cityId = req.user.cityId;
    }

    const cacheScopeKey = JSON.stringify({ route: 'by-cities', ...fridgeQuery });
    const [fridges, statsByFridgeId] = await Promise.all([
      Fridge.find(fridgeQuery)
        .select('_id code number clientInfo.inn type cityId warehouseStatus')
        .populate('cityId', 'name code')
        .lean(),
      getCheckinStatsForFridgeQuery(fridgeQuery, cacheScopeKey, { useCache: true }),
    ]);

    const now = Date.now();

    // Группируем холодильники по городам
    const cityStatsMap = new Map();

    fridges.forEach((f) => {
      const cityId = f.cityId?._id?.toString() || 'unknown';
      const cityName = f.cityId?.name || 'Не указан';
      const cityCode = f.cityId?.code || '';

      if (!cityStatsMap.has(cityId)) {
        cityStatsMap.set(cityId, {
          cityId: cityId,
          cityName: cityName,
          cityCode: cityCode,
          total: 0,
          fresh: 0, // today/week
          old: 0, // old
          never: 0, // never (на складе)
          warehouse: 0,
          installed: 0,
          returned: 0,
          moved: 0,
        });
      }

      const stats = cityStatsMap.get(cityId);
      stats.total++;

      const { lastVisit, lastVisitTime } = getLastVisitFromStatsMap(statsByFridgeId, f);

      const warehouseStatus = f.warehouseStatus || 'warehouse';

      if (!lastVisitTime) {
        stats.never++;
      } else if (warehouseStatus === 'returned') {
        stats.never++;
      } else {
        const vs = visitStatusFromLastVisit(lastVisit, { nowMs: now });
        if (vs === 'today' || vs === 'week') {
          stats.fresh++;
        } else {
          stats.old++;
        }
      }

      // Статус склада (для информации)
      if (warehouseStatus === 'warehouse') {
        stats.warehouse++;
      } else if (warehouseStatus === 'installed') {
        stats.installed++;
      } else if (warehouseStatus === 'returned') {
        stats.returned++;
      } else if (warehouseStatus === 'moved') {
        stats.moved++;
      }
    });

    // Преобразуем Map в массив и сортируем по названию города
    const cityStats = Array.from(cityStatsMap.values()).sort((a, b) => 
      a.cityName.localeCompare(b.cityName, 'ru')
    );

    return res.json({
      cities: cityStats,
      summary: {
        totalCities: cityStats.length,
        totalFridges: cityStats.reduce((sum, c) => sum + c.total, 0),
        totalFresh: cityStats.reduce((sum, c) => sum + c.fresh, 0),
        totalOld: cityStats.reduce((sum, c) => sum + c.old, 0),
        totalNever: cityStats.reduce((sum, c) => sum + c.never, 0),
      },
    });
  } catch (err) {
    console.error('[Admin] Error getting city statistics:', err);
    return res.status(500).json({ 
      error: 'Ошибка получения статистики по городам', 
      details: err.message 
    });
  }
});

// POST /api/admin/checkins/deduplicate
// Удаление дублей отметок (один ТП + один холодильник + близкие координаты в окне 5 мин)
// body: { cityId?, cityName?, date?, today?, apply?: true } — без apply только предпросмотр
router.post('/checkins/deduplicate', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { cityId, cityName, date, today, apply } = req.body || {};
    const dryRun = apply !== true && apply !== 'true';

    const result = await deduplicateCityCheckins({
      cityId,
      cityName,
      date,
      today: today === true || today === 'true',
      dryRun,
    });

    if (!dryRun && result.deletedCount > 0) {
      invalidateCheckinStatsCache();
    }

    return res.json(result);
  } catch (err) {
    if (err.cities) {
      return res.status(404).json({ error: err.message, cities: err.cities });
    }
    console.error('[Admin] deduplicate checkins error:', err);
    return res.status(500).json({ error: 'Ошибка удаления дублей', details: err.message });
  }
});

// GET /api/admin/backup
// Резервное копирование всех холодильников и отметок (только для админа)
router.get('/backup', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('[Admin] Starting backup creation...');
    console.log('[Admin] User:', req.user?.username, req.user?.role);

    // Получаем все холодильники с полной информацией параллельно
    const [fridges, checkins, cities] = await Promise.all([
      Fridge.find({}).populate('cityId', 'name code').lean(),
      Checkin.find({}).lean(),
      City.find({}).lean(),
    ]);
    console.log(`[Admin] Found ${fridges.length} fridges`);
    console.log(`[Admin] Found ${checkins.length} checkins`);
    console.log(`[Admin] Found ${cities.length} cities`);

    // Формируем объект резервной копии
    const backup = {
      version: '1.0',
      createdAt: new Date().toISOString(),
      createdBy: req.user?.username || 'unknown',
      metadata: {
        fridgesCount: fridges.length,
        checkinsCount: checkins.length,
        citiesCount: cities.length,
      },
      data: {
        cities: cities,
        fridges: fridges,
        checkins: checkins,
      },
    };

    // Устанавливаем заголовки для скачивания файла
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `backup-${timestamp}.json`;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    console.log(`[Admin] Backup created successfully: ${filename}`);

    return res.json(backup);
  } catch (err) {
    console.error('[Admin] Error creating backup:', err);
    return res.status(500).json({ 
      error: 'Ошибка создания резервной копии', 
      details: err.message 
    });
  }
});

module.exports = router;


