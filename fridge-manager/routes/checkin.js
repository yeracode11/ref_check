const express = require('express');
const Checkin = require('../models/Checkin');
const Fridge = require('../models/Fridge');
const { getNextSequence } = require('../models/Counter');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

function parseDate(dateString) {
  if (!dateString) return undefined;
  const d = new Date(dateString);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// POST /api/checkins
// body: { managerId, fridgeId, photos?, location: { lat, lng } | { type:'Point', coordinates:[lng,lat] }, address?, notes?, visitedAt? }
router.post('/', async (req, res) => {
  try {
    const { managerId, fridgeId } = req.body;
    if (!managerId || !fridgeId) {
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

    const id = await getNextSequence('checkin');
    const checkin = await Checkin.create({
      id,
      managerId,
      fridgeId,
      photos: Array.isArray(req.body.photos) ? req.body.photos : [],
      location,
      address: req.body.address,
      notes: req.body.notes,
      visitedAt: req.body.visitedAt ? new Date(req.body.visitedAt) : undefined,
    });

    // Обновляем местоположение и адрес холодильника по последней отметке
    // fridgeId в чек-ине должен совпадать с code в модели Fridge
    try {
      await Fridge.findOneAndUpdate(
        { code: fridgeId },
        {
          $set: {
            location,
            // Если менеджер передал новый адрес — обновим его; иначе не трогаем старый
            ...(req.body.address ? { address: req.body.address } : {}),
          },
        },
        { new: true }
      );
    } catch (updateErr) {
      // Не падаем, если не нашли холодильник или ошибка обновления, просто логируем
      // eslint-disable-next-line no-console
      console.error('Failed to update fridge location from checkin:', updateErr);
    }

    return res.status(201).json(checkin);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create checkin', details: err.message });
  }
});

// GET /api/checkins
// query: managerId?, fridgeId?, from?, to?, nearLat?, nearLng?, nearKm?
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
    if (managerId) filter.managerId = managerId;
    if (fridgeId) filter.fridgeId = fridgeId;

    // Фильтрация по роли пользователя
    if (req.user.role === 'manager') {
      // Менеджеры видят только свои отметки
      filter.managerId = req.user.id;
    } else if (req.user.role === 'accountant' && req.user.cityId) {
      // Бухгалтеры видят отметки только из своего города
      // Нужно найти все холодильники из их города
      const fridgesInCity = await Fridge.find({ cityId: req.user.cityId }, { code: 1 });
      const fridgeCodes = fridgesInCity.map(f => f.code);
      filter.fridgeId = { $in: fridgeCodes };
    }
    // Админы видят все отметки (без дополнительной фильтрации)
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

    const items = await Checkin.find(filter).sort({ visitedAt: -1, id: -1 }).limit(500);
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
    if (req.user.role === 'manager' && item.managerId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    } else if (req.user.role === 'accountant' && req.user.cityId) {
      // Проверить, что холодильник из города бухгалтера
      const fridge = await Fridge.findOne({ code: item.fridgeId });
      if (!fridge || fridge.cityId?.toString() !== req.user.cityId) {
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

    return res.json({ message: 'Отметка удалена', id });
  } catch (err) {
    return res.status(500).json({ error: 'Ошибка удаления отметки', details: err.message });
  }
});

module.exports = router;


