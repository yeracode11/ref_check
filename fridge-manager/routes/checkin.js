const express = require('express');
const mongoose = require('mongoose');
const Checkin = require('../models/Checkin');
const Fridge = require('../models/Fridge');
const User = require('../models/User');
const { getNextSequence } = require('../models/Counter');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { findRecentDuplicateCheckin } = require('../utils/checkinGeodesic');
const { invalidateCheckinStatsCache } = require('../lib/checkinStatsCache');
const {
  getCheckinFridgeIdsForCity,
  getAssignedCityId,
  userCanAccessCity,
} = require('../lib/cityScope');

const router = express.Router();

/** Окно идемпотентности: повторная отправка с теми же координатами не создаёт вторую запись */
const CHECKIN_IDEMPOTENCY_WINDOW_MS = 120 * 1000;
const CHECKIN_IDEMPOTENCY_MAX_DISTANCE_M = 40;

function calculateDistanceMeters(loc1, loc2) {
  if (!loc1 || !loc2 || !loc1.coordinates || !loc2.coordinates) {
    return null;
  }
  const [lng1, lat1] = loc1.coordinates;
  const [lng2, lat2] = loc2.coordinates;
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function syncFridgeFromCheckin({
  normalizedFridgeId,
  location,
  fridgeCondition,
  isSeasonalClosure,
  address,
}) {
  const fridge = await Fridge.findOne({
    $or: [
      { code: normalizedFridgeId },
      { number: normalizedFridgeId },
      { 'clientInfo.inn': normalizedFridgeId },
    ],
  });
  if (!fridge) {
    console.warn(`[Checkins] Fridge with code/number/inn ${normalizedFridgeId} not found`);
    return;
  }

  const fridgeIdentifiers = [fridge.code];
  if (fridge.number) fridgeIdentifiers.push(fridge.number);
  if (fridge.clientInfo?.inn) fridgeIdentifiers.push(fridge.clientInfo.inn);

  const recentCheckins = await Checkin.find({
    fridgeId: { $in: fridgeIdentifiers },
  }).sort({ visitedAt: -1 }).limit(2).lean();

  let newWarehouseStatus = fridge.warehouseStatus;
  if (recentCheckins.length === 1) {
    if (fridge.warehouseStatus === 'warehouse' || fridge.warehouseStatus === 'returned') {
      newWarehouseStatus = 'installed';
    }
  } else if (recentCheckins.length >= 2) {
    const secondLastLocation = recentCheckins[1].location;
    const lastLocation = recentCheckins[0].location;
    if (secondLastLocation && lastLocation) {
      const distance = calculateDistanceMeters(secondLastLocation, lastLocation);
      if (distance !== null && distance > 50) {
        newWarehouseStatus = 'moved';
      } else if (fridge.warehouseStatus === 'warehouse' || fridge.warehouseStatus === 'returned') {
        newWarehouseStatus = 'installed';
      } else if (fridge.warehouseStatus === 'moved') {
        newWarehouseStatus = 'installed';
      }
    }
  }

  const fridgeStatusUpdate = {};
  if (fridgeCondition === 'broken') {
    fridgeStatusUpdate.status = 'broken';
    if (!fridge.brokenSince) {
      fridgeStatusUpdate.brokenSince = new Date();
    }
  } else if (fridge.status !== 'under_repair') {
    fridgeStatusUpdate.status = 'working';
    fridgeStatusUpdate.brokenSince = null;
  }

  const seasonalTypes = ['school', 'restricted'];
  if (seasonalTypes.includes(fridge.type)) {
    fridgeStatusUpdate.isSeasonalClosure = isSeasonalClosure;
  }

  await Fridge.findOneAndUpdate(
    {
      $or: [
        { code: normalizedFridgeId },
        { number: normalizedFridgeId },
        { 'clientInfo.inn': normalizedFridgeId },
      ],
    },
    {
      $set: {
        location,
        warehouseStatus: newWarehouseStatus,
        ...(address ? { address } : {}),
        ...fridgeStatusUpdate,
      },
    },
    { new: true },
  );
}

function parseDate(dateString) {
  if (!dateString) return undefined;
  const d = new Date(dateString);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// POST /api/checkins
// body: { managerId, fridgeId, photos?, location: { lat, lng } | { type:'Point', coordinates:[lng,lat] }, address?, notes?, visitedAt? }
router.post('/', async (req, res) => {
  try {
    const { managerId } = req.body;
    const rawFridgeId = req.body?.fridgeId;
    const normalizedFridgeId = String(rawFridgeId || '').trim().replace(/^#/, '');

    if (!managerId || !normalizedFridgeId) {
      return res.status(400).json({ error: 'managerId and fridgeId are required' });
    }

    let location = req.body.location;
    if (!location) {
      return res.status(400).json({ error: 'location is required' });
    }

    // Normalize location to GeoJSON Point
    if (location && typeof location.lat === 'number' && typeof location.lng === 'number') {
      location = { type: 'Point', coordinates: [location.lng, location.lat] };
    }

    if (!location.type || !Array.isArray(location.coordinates) || location.coordinates.length !== 2) {
      return res.status(400).json({ error: 'location must be GeoJSON Point or {lat,lng}' });
    }

    const fridgeCondition =
      req.body.fridgeCondition === 'broken' ? 'broken' : 'working';
    const isSeasonalClosure = req.body.isSeasonalClosure === true
      || req.body.isSeasonalClosure === 'true';

    const [reqLng, reqLat] = location.coordinates;
    const dupWindowStart = new Date(Date.now() - CHECKIN_IDEMPOTENCY_WINDOW_MS);
    const recentForDedupe = await Checkin.find({
      fridgeId: normalizedFridgeId,
      visitedAt: { $gte: dupWindowStart },
    })
      .sort({ visitedAt: -1 })
      .limit(30)
      .lean();

    const duplicate = findRecentDuplicateCheckin(recentForDedupe, {
      managerId: String(managerId),
      fridgeId: normalizedFridgeId,
      lng: reqLng,
      lat: reqLat,
      now: Date.now(),
      windowMs: CHECKIN_IDEMPOTENCY_WINDOW_MS,
      maxDistanceM: CHECKIN_IDEMPOTENCY_MAX_DISTANCE_M,
    });

    if (duplicate && duplicate._id) {
      const existing = await Checkin.findById(duplicate._id);
      if (existing) {
        if (existing.fridgeCondition !== fridgeCondition || existing.isSeasonalClosure !== isSeasonalClosure) {
          existing.fridgeCondition = fridgeCondition;
          existing.isSeasonalClosure = isSeasonalClosure;
          await existing.save();
        }
        try {
          await syncFridgeFromCheckin({
            normalizedFridgeId,
            location,
            fridgeCondition,
            isSeasonalClosure,
            address: req.body.address,
          });
        } catch (updateErr) {
          console.error('Failed to update fridge on idempotent checkin:', updateErr);
        }
        invalidateCheckinStatsCache();
        return res.status(200).json({
          ...existing.toJSON(),
          idempotentReplay: true,
        });
      }
    }

    const id = await getNextSequence('checkin');
    const checkin = await Checkin.create({
      id,
      managerId,
      fridgeId: normalizedFridgeId,
      photos: Array.isArray(req.body.photos) ? req.body.photos : [],
      location,
      address: req.body.address,
      notes: req.body.notes,
      visitedAt: req.body.visitedAt ? new Date(req.body.visitedAt) : undefined,
      fridgeCondition,
      isSeasonalClosure,
    });
    
    try {
      await syncFridgeFromCheckin({
        normalizedFridgeId,
        location,
        fridgeCondition,
        isSeasonalClosure,
        address: req.body.address,
      });
    } catch (updateErr) {
      console.error('Failed to update fridge location from checkin:', updateErr);
    }

    invalidateCheckinStatsCache();
    return res.status(201).json(checkin);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create checkin', details: err.message });
  }
});

// GET /api/checkins
// query: managerId?, fridgeId?, from?, to?, nearLat?, nearLng?, nearKm?, limit?, skip?, meta?
// meta=1 — ответ { data, total, limit, skip, hasMore } вместо голого массива; для admin ещё distinctManagers
// Менеджеры видят только свои отметки, бухгалтеры - только из своего города, админы - все
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { managerId, fridgeId } = req.query;
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    const nearLat = req.query.nearLat ? Number(req.query.nearLat) : undefined;
    const nearLng = req.query.nearLng ? Number(req.query.nearLng) : undefined;
    const nearKm = req.query.nearKm ? Number(req.query.nearKm) : 5; // default 5km

    const filter = {};
    
    // Фильтрация по роли пользователя (приоритет над query параметрами)
    if (req.user.role === 'manager') {
      // Менеджеры видят только свои отметки
      // Учитываем старые записи, где сохраняли username вместо _id
      const managerIds = [req.user.id, req.user.username].filter(Boolean);
      filter.managerId = { $in: managerIds };
      // Логирование для отладки (можно убрать после проверки)
      console.log('[Checkins] Manager filter:', { 
        role: req.user.role, 
        userId: req.user.id, 
        username: req.user.username,
        filterManagerId: managerIds 
      });
    } else if (['accountant', 'service_manager', 'sales_head'].includes(req.user.role)) {
      const cityId = getAssignedCityId(req.user);
      if (cityId) {
        const fridgeCodes = await getCheckinFridgeIdsForCity(cityId);
        filter.fridgeId = { $in: fridgeCodes.length ? fridgeCodes : ['__none__'] };
      }
    } else {
      // Для админов и других ролей можно использовать query параметры
      if (managerId) filter.managerId = managerId;
    }
    
    // Общий фильтр по fridgeId (если не установлен фильтр по городу)
    if (fridgeId && !filter.fridgeId) {
      filter.fridgeId = fridgeId;
    }
    if (from || to) {
      filter.visitedAt = {};
      if (from) filter.visitedAt.$gte = from;
      if (to) filter.visitedAt.$lte = to;
    }

    if (typeof nearLat === 'number' && typeof nearLng === 'number') {
      filter.location = {
        $near: {
          $geometry: { type: 'Point', coordinates: [nearLng, nearLat] },
          $maxDistance: Math.max(0, nearKm) * 1000,
        },
      };
    }

    const limitParsed =
      req.query.limit != null && req.query.limit !== ''
        ? parseInt(req.query.limit, 10)
        : null;
    const limit = Number.isFinite(limitParsed) ? limitParsed : null;
    const skipParsed =
      req.query.skip != null && req.query.skip !== ''
        ? parseInt(req.query.skip, 10)
        : 0;
    const skip = Number.isFinite(skipParsed) ? Math.max(0, skipParsed) : 0;
    const wantMeta = req.query.meta === '1' || req.query.meta === 'true';

    // Для админа по умолчанию возвращаем больше отметок (или все, если limit не указан)
    // Для остальных ролей ограничиваем 300 для производительности
    const defaultLimit = req.user && req.user.role === 'admin' ? null : 300;
    const queryLimit = limit !== null ? limit : defaultLimit;

    let itemsQuery = Checkin.find(filter).sort({ visitedAt: -1, id: -1 });
    if (queryLimit !== null) {
      itemsQuery = itemsQuery.limit(queryLimit);
    }
    if (skip > 0) {
      itemsQuery = itemsQuery.skip(skip);
    }

    let items;
    let total;
    let distinctManagers;

    if (wantMeta) {
      const tasks = [Checkin.countDocuments(filter), itemsQuery.lean().exec()];
      if (req.user && req.user.role === 'admin') {
        tasks.push(Checkin.distinct('managerId', filter));
      }
      const results = await Promise.all(tasks);
      total = results[0];
      items = results[1];
      if (req.user && req.user.role === 'admin') {
        distinctManagers = results[2].filter(Boolean).length;
      }
    } else {
      items = await itemsQuery.exec();
    }

    const toPlain = (item) => (item && typeof item.toObject === 'function' ? item.toObject() : { ...item });

    // Для админа обогащаем данными о менеджерах, чтобы показывать логин вместо сырых идентификаторов
    if (req.user && req.user.role === 'admin' && items.length > 0) {
      const managerIds = [...new Set(items.map((i) => i.managerId).filter(Boolean))];

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

      items = items.map((item) => {
        const plain = toPlain(item);
        const user =
          userMap.get(plain.managerId) ||
          userMap.get(String(plain.managerId));
        return {
          ...plain,
          managerUsername: user ? user.username : plain.managerId,
          managerFullName: user && user.fullName ? user.fullName : '',
        };
      });
    }

    if (wantMeta) {
      const hasMore =
        queryLimit !== null ? skip + items.length < total : false;
      const payload = {
        data: items,
        total,
        limit: queryLimit,
        skip,
        hasMore,
      };
      if (req.user && req.user.role === 'admin' && distinctManagers !== undefined) {
        payload.distinctManagers = distinctManagers;
      }
      return res.json(payload);
    }

    return res.json(items);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch checkins', details: err.message });
  }
});

// GET /api/checkins/:id
// Менеджеры могут видеть только свои отметки, бухгалтеры - только из своего города
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid id format' });
    }

    const item = await Checkin.findOne({ id });
    if (!item) return res.status(404).json({ error: 'Not found' });

    // Проверка доступа
    if (req.user.role === 'manager') {
      if (item.managerId !== req.user.id && item.managerId !== req.user.username) {
        return res.status(403).json({ error: 'Access denied' });
      }
    } else if (['accountant', 'service_manager', 'sales_head'].includes(req.user.role)) {
      const fridge = await Fridge.findOne({
        $or: [
          { code: item.fridgeId },
          { number: item.fridgeId },
          { 'clientInfo.inn': item.fridgeId },
        ],
      });
      if (!fridge || !userCanAccessCity(req.user, fridge.cityId)) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }
    // Админы имеют доступ ко всем отметкам

    return res.json(item);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid id', details: err.message });
  }
});

// DELETE /api/checkins/:id
// Удалить отметку (только для админа)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid id format' });
    }

    const item = await Checkin.findOne({ id });
    if (!item) {
      return res.status(404).json({ error: 'Отметка не найдена' });
    }

    await Checkin.deleteOne({ id });
    invalidateCheckinStatsCache();

    return res.json({ message: 'Отметка удалена', id });
  } catch (err) {
    return res.status(500).json({ error: 'Ошибка удаления отметки', details: err.message });
  }
});

// DELETE /api/checkins
// Удалить все отметки (только для админа)
router.delete('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await Checkin.deleteMany({});
    invalidateCheckinStatsCache();
    return res.json({
      message: 'Все отметки удалены', 
      deletedCount: result.deletedCount 
    });
  } catch (err) {
    return res.status(500).json({ error: 'Ошибка удаления отметок', details: err.message });
  }
});

module.exports = router;


