const express = require('express');
const Fridge = require('../models/Fridge');
const Checkin = require('../models/Checkin');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/admin/fridge-status
// Возвращает список холодильников с последней датой посещения и статусом для карты
router.get('/fridge-status', authenticateToken, requireAdmin, async (req, res) => {
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

    const fridges = await Fridge.find({}).populate('cityId', 'name code');

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

    return res.json(result);
  } catch (err) {
    return res
      .status(500)
      .json({ error: 'Failed to fetch admin fridge status', details: err.message });
  }
});

module.exports = router;


