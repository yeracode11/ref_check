const express = require('express');
const mongoose = require('mongoose');
const Checkin = require('../models/Checkin');
const Fridge = require('../models/Fridge');
const User = require('../models/User');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const {
  getCheckinFilterForCity,
  getAssignedCityId,
  userCanAccessCity,
  ensureCityScopedUserHasCity,
  findFridgeByIdentifier,
} = require('../lib/cityScope');
const {
  createCheckinRecord,
  locationFromLatLngFields,
  normalizeLocationInput,
} = require('../lib/checkinService');
const { invalidateCheckinStatsCache } = require('../lib/checkinStatsCache');

const router = express.Router();

function parseDate(dateString) {
  if (!dateString) return undefined;
  const d = new Date(dateString);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// POST /api/checkins
// body: { fridgeId, photos?, location, ... } — managerId берётся из JWT
router.post('/', authenticateToken, async (req, res) => {
  try {
    if (req.user?.role === 'manager' && !ensureCityScopedUserHasCity(req, res)) return;

    const location = normalizeLocationInput(req.body.location)
      || locationFromLatLngFields(req.body);

    const result = await createCheckinRecord({
      user: req.user,
      fridgeId: req.body.fridgeId,
      location,
      photos: req.body.photos,
      address: req.body.address,
      notes: req.body.notes,
      visitedAt: req.body.visitedAt,
      fridgeCondition: req.body.fridgeCondition,
      isSeasonalClosure: req.body.isSeasonalClosure,
      managerIdOverride: req.body.managerId,
    });

    return res.status(result.status).json({
      ...result.checkin,
      idempotentReplay: result.idempotentReplay,
    });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({
      error: err.message || 'Failed to create checkin',
      details: err.details,
    });
  }
});

// GET /api/checkins
// query: managerId?, fridgeId?, from?, to?, nearLat?, nearLng?, nearKm?, limit?, skip?, meta?
// meta=1 — ответ { data, total, limit, skip, hasMore } вместо голого массива; для admin ещё distinctManagers
// Менеджеры видят только свои отметки, бухгалтеры - только из своего города, админы - все
router.get('/', authenticateToken, async (req, res) => {
  try {
    if (!ensureCityScopedUserHasCity(req, res)) return;

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
    } else if (['accountant', 'service_manager', 'sales_head'].includes(req.user.role)) {
      const cityId = getAssignedCityId(req.user);
      if (cityId) {
        Object.assign(filter, await getCheckinFilterForCity(cityId));
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
      if (item.fridgeRef) {
        const fridge = await Fridge.findById(item.fridgeRef).select('cityId').lean();
        if (!fridge || !userCanAccessCity(req.user, fridge.cityId)) {
          return res.status(403).json({ error: 'Access denied' });
        }
      } else {
        const fridge = await findFridgeByIdentifier(item.fridgeId, {
          cityId: getAssignedCityId(req.user),
        });
        if (!fridge || !userCanAccessCity(req.user, fridge.cityId)) {
          return res.status(403).json({ error: 'Access denied' });
        }
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


