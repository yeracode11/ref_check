const express = require('express');
const multer = require('multer');
const Fridge = require('../models/Fridge');
const Checkin = require('../models/Checkin');
const City = require('../models/City');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
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
router.get('/fridge-status', authenticateToken, requireAdmin, async (req, res) => {
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

    // Получаем общее количество для пагинации
    const total = await Fridge.countDocuments({});

    // Получаем холодильники с пагинацией (если нужно)
    let query = Fridge.find({}).populate('cityId', 'name code');
    if (shouldPaginate && limitNum) {
      query = query.limit(limitNum).skip(skipNum);
    }
    const fridges = await query;

    const now = Date.now();

    const result = fridges.map((f) => {
      const lastVisit = lastByFridgeId.get(f.code) || null; // fridgeId у нас = code в Checkin

      let status = 'never';
      if (lastVisit) {
        const diffDays = (now - new Date(lastVisit).getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays < 1) status = 'today'; // 🟢
        else if (diffDays < 7) status = 'week'; // 🟡
        else status = 'old'; // 🔴
      }

      return {
        id: f._id,
        code: f.code,
        name: f.name,
        address: f.address,
        city: f.cityId || null,
        location: f.location,
        lastVisit,
        status,
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
// Импорт холодильников из Excel файла
router.post('/import-fridges', authenticateToken, requireAdmin, (req, res, next) => {
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

    // Получаем или создаем город Тараз
    let city = await City.findOne({ code: 'taras' });
    if (!city) {
      city = await City.create({
        name: 'Тараз',
        code: 'taras',
        active: true,
      });
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
// Создание нового холодильника (только для админа, с автогенерацией кода)
router.post('/fridges', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, address, description, cityId } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Название холодильника обязательно' });
    }

    // Получаем или создаем город Тараз, если cityId не указан
    let city;
    if (cityId) {
      city = await City.findById(cityId);
      if (!city) {
        return res.status(400).json({ error: 'Город не найден' });
      }
    } else {
      city = await City.findOne({ code: 'taras' });
      if (!city) {
        city = await City.create({
          name: 'Тараз',
          code: 'taras',
          active: true,
        });
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

module.exports = router;


