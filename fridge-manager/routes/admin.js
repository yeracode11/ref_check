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
    fileSize: 100 * 1024 * 1024, // 10MB максимум
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
// Поддерживает пагинацию через параметры limit и skip
// Для бухгалтеров возвращает только холодильники их города
router.get('/fridge-status', authenticateToken, requireAdminOrAccountant, async (req, res) => {
  try {
    const { limit, skip, all } = req.query;
    
    // Если all=true, возвращаем все холодильники (для карты)
    const shouldPaginate = all !== 'true';
    const limitNum = shouldPaginate && limit ? Math.max(1, Math.min(100, Number(limit))) : undefined;
    const skipNum = shouldPaginate && skip ? Math.max(0, Number(skip)) : 0;

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

    const result = fridges.map((f) => {
      const lastVisit = lastByFridgeId.get(f.code) || null; // fridgeId у нас = code в Checkin

      // Определяем статус визита
      let visitStatus = 'never';
      if (lastVisit) {
        const diffDays = (now - new Date(lastVisit).getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays < 1) visitStatus = 'today';
        else if (diffDays < 7) visitStatus = 'week';
        else visitStatus = 'old';
      }

      // Определяем статус для отображения на карте
      // warehouse/returned = желтый (приоритет)
      // installed + today = зеленый
      // installed + week = желтый (но не склад)
      // installed + old = красный
      // installed + never = серый
      let status;
      const warehouseStatus = f.warehouseStatus || 'warehouse';
      
      if (warehouseStatus === 'warehouse' || warehouseStatus === 'returned') {
        status = 'warehouse'; // желтый - на складе или возврат
      } else {
        // installed - используем visitStatus
        status = visitStatus;
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
router.get('/export-fridges', authenticateToken, requireAdmin, async (req, res) => {
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

    const fridges = await Fridge.find({}).populate('cityId', 'name code').sort({ code: 1 });

    const now = Date.now();

    // Подготавливаем данные для Excel
    const excelData = fridges.map((f) => {
      const lastVisit = lastByFridgeId.get(f.code) || null;
      
      let status = 'Нет отметок';
      if (lastVisit) {
        const diffDays = (now - new Date(lastVisit).getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays < 1) status = 'Сегодня';
        else if (diffDays < 7) status = 'Неделя';
        else status = 'Давно';
      }

      return {
        'Код': f.code || '',
        'Название': f.name || '',
        'Город': f.cityId?.name || '',
        'Адрес': f.address || '',
        'Описание': f.description || '',
        'Статус': status,
        'Последний визит': lastVisit ? new Date(lastVisit).toLocaleString('ru-RU') : '',
        'Активен': f.active ? 'Да' : 'Нет',
        'Координаты': f.location && f.location.coordinates 
          ? `${f.location.coordinates[1]}, ${f.location.coordinates[0]}` 
          : '',
      };
    });

    // Создаем рабочую книгу Excel
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Холодильники');

    // Настраиваем ширину колонок
    const columnWidths = [
      { wch: 10 }, // Код
      { wch: 30 }, // Название
      { wch: 15 }, // Город
      { wch: 40 }, // Адрес
      { wch: 30 }, // Описание
      { wch: 12 }, // Статус
      { wch: 20 }, // Последний визит
      { wch: 10 }, // Активен
      { wch: 25 }, // Координаты
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
router.post('/import-fridges', authenticateToken, requireAdminOrAccountant, (req, res, next) => {
  // Обработка загрузки файла с обработкой ошибок
  upload.single('file')(req, res, (err) => {
    if (err) {
      console.error('Multer upload error:', err);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Файл слишком большой. Максимальный размер: 100MB' });
      }
      return res.status(400).json({ error: 'Ошибка загрузки файла', details: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Файл не загружен. Убедитесь, что вы выбрали файл.' });
    }

    // Читаем Excel файл из буфера
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Конвертируем в JSON (массив объектов)
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });

    // Ищем строку с заголовками (обычно строка 5, индексация с 0)
    let headerRow = -1;
    for (let i = 0; i < Math.min(10, rawData.length); i++) {
      const row = rawData[i];
      if (row && Array.isArray(row)) {
        const rowStr = row.map(cell => String(cell || '').toLowerCase()).join(' ');
        if (rowStr.includes('адрес') || rowStr.includes('контрагент')) {
          headerRow = i;
          break;
        }
      }
    }

    if (headerRow === -1) {
      return res.status(400).json({ error: 'Не найдена строка с заголовками в Excel файле' });
    }

    const headers = rawData[headerRow].map(h => String(h || '').trim());
    const dataStartRow = headerRow + 2; // Данные начинаются через 2 строки после заголовков

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

    // Определяем город для импорта
    // Если бухгалтер - используем его город, иначе ищем/создаем Тараз
    let city;
    if (req.user.role === 'accountant' && req.user.cityId) {
      city = await City.findById(req.user.cityId);
      if (!city) {
        return res.status(400).json({ error: 'Город бухгалтера не найден' });
      }
    } else {
      // Для админа - используем Тараз по умолчанию
      city = await City.findOne({ code: 'taras' });
      if (!city) {
        city = await City.create({
          name: 'Тараз',
          code: 'taras',
          active: true,
        });
      }
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

    for (let i = dataStartRow; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || !Array.isArray(row)) continue;

      // Получаем адрес
      const address = addressIdx >= 0 ? String(row[addressIdx] || '').trim() : '';
      if (!address || address === 'null' || address === 'undefined') continue; // Пропускаем строки без адреса

      // Получаем контрагента (название)
      const contractor = contractorIdx >= 0 ? String(row[contractorIdx] || '').trim() : '';
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

      records.push({
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
      });

      codeCounter++;
    }

    // Импортируем в базу данных
    let imported = 0;
    let duplicates = 0;
    let errors = 0;

    for (const record of records) {
      try {
        // Проверяем, существует ли уже такой код
        const existing = await Fridge.findOne({ code: record.code });
        if (existing) {
          duplicates++;
          continue;
        }

        await Fridge.create(record);
        imported++;
      } catch (err) {
        errors++;
        console.error(`Ошибка при импорте ${record.code}:`, err.message);
      }
    }

    return res.json({
      success: true,
      imported,
      duplicates,
      errors,
      total: records.length,
    });
  } catch (err) {
    console.error('Ошибка импорта:', err);
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
        // Для админа - по умолчанию Тараз
        city = await City.findOne({ code: 'taras' });
        if (!city) {
          city = await City.create({
            name: 'Тараз',
            code: 'taras',
            active: true,
          });
        }
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

    // Получаем чек-ины по коду холодильника
    const checkins = await Checkin.find({ fridgeId: fridge.code })
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
    };
    fridgesByStatus.forEach((s) => {
      if (s._id) statusCounts[s._id] = s.count;
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
    const lastCheckins = await Checkin.aggregate([
      {
        $match: { fridgeId: { $in: fridgeCodes } },
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

    const fridgesWithLastVisit = cityFridges.map((f) => ({
      code: f.code,
      name: f.name,
      address: f.address,
      lastVisit: lastVisitMap.get(f.code) || null,
      daysSinceVisit: lastVisitMap.get(f.code)
        ? Math.floor((Date.now() - new Date(lastVisitMap.get(f.code)).getTime()) / (1000 * 60 * 60 * 24))
        : null,
    }));

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
    };
    cityFridges.forEach((f) => {
      if (f.warehouseStatus) {
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

// PATCH /api/admin/fridges/:id
// Редактировать холодильник
router.patch('/fridges/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, address, description, cityId, active } = req.body;

    const fridge = await Fridge.findById(req.params.id);
    if (!fridge) {
      return res.status(404).json({ error: 'Холодильник не найден' });
    }

    if (name !== undefined) fridge.name = name;
    if (address !== undefined) fridge.address = address;
    if (description !== undefined) fridge.description = description;
    if (cityId !== undefined) fridge.cityId = cityId || null;
    if (active !== undefined) fridge.active = active;

    await fridge.save();

    const populated = await Fridge.findById(fridge._id).populate('cityId', 'name code');
    return res.json(populated);
  } catch (err) {
    return res.status(500).json({ error: 'Ошибка обновления холодильника', details: err.message });
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
    const deletedCheckins = await Checkin.deleteMany({ fridgeId: fridge.code });

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


