const express = require('express');
const mongoose = require('mongoose');
const Fridge = require('../models/Fridge');
const Checkin = require('../models/Checkin');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

/** Идентификаторы fridgeId в Checkin: с/без #, как в POST /api/checkins и admin fridge-status */
function buildCheckinFridgeIdCandidates(fridgeLike) {
  const out = [];
  const add = (v) => {
    if (v == null || String(v).trim() === '') return;
    const t = String(v).trim();
    const bare = t.replace(/^#+/, '');
    out.push(t);
    if (bare) {
      out.push(bare);
      out.push(`#${bare}`);
    }
  };
  add(fridgeLike.code);
  add(fridgeLike.number);
  if (fridgeLike.clientInfo?.inn) add(fridgeLike.clientInfo.inn);
  return [...new Set(out)];
}

function visitStatusFromLastVisit(lastVisit) {
  if (!lastVisit) return 'never';
  const t = lastVisit instanceof Date ? lastVisit.getTime() : new Date(lastVisit).getTime();
  if (Number.isNaN(t)) return 'never';
  const diffDays = Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return 'today';
  if (diffDays <= 7) return 'week';
  return 'old';
}

function leanCheckinForApi(doc) {
  if (!doc) return null;
  const o = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  if (o._id != null) delete o._id;
  if (o.__v != null) delete o.__v;
  return o;
}

/**
 * Варианты строк fridgeId для $lookup (как buildCheckinFridgeIdCandidates).
 * Без $regexReplace — на MongoDB 4.2 агрегация с ним падает; здесь только $reduce/$substrCP.
 */
function aggCheckinIdVariants(fieldRef) {
  const trimmed = { $trim: { input: { $ifNull: [fieldRef, ''] } } };
  const bare = {
    $reduce: {
      input: { $range: [0, 24] },
      initialValue: trimmed,
      in: {
        $cond: [
          {
            $and: [
              { $gt: [{ $strLenCP: '$$value' }, 0] },
              { $eq: [{ $substrCP: ['$$value', 0, 1] }, '#'] },
            ],
          },
          {
            $substrCP: [
              '$$value',
              1,
              { $subtract: [{ $strLenCP: '$$value' }, 1] },
            ],
          },
          '$$value',
        ],
      },
    },
  };
  return {
    $cond: [
      { $eq: [{ $strLenCP: bare }, 0] },
      [],
      {
        $let: {
          vars: { trim: trimmed, bare },
          in: {
            $filter: {
              input: ['$$trim', '$$bare', { $concat: ['#', '$$bare'] }],
              as: 'x',
              cond: { $ne: ['$$x', ''] },
            },
          },
        },
      },
    ],
  };
}

/** Fallback: одна выборка чекинов на страницу, без N+1 (если aggregate по fridges падает) */
async function enrichFridgeListWithLastCheckins(fridgeLeanDocs) {
  if (!fridgeLeanDocs.length) return [];
  const idSet = new Set();
  for (const f of fridgeLeanDocs) {
    buildCheckinFridgeIdCandidates(f).forEach((id) => idSet.add(id));
  }
  const allIds = [...idSet];
  if (allIds.length === 0) {
    return fridgeLeanDocs.map((f) => enrichFridgeDocWithVisit({ ...f, lastCheckin: null }));
  }
  const rows = await Checkin.aggregate([
    { $match: { fridgeId: { $in: allIds } } },
    { $sort: { visitedAt: -1 } },
    { $group: { _id: '$fridgeId', doc: { $first: '$$ROOT' } } },
  ]);
  const byFridgeId = new Map(rows.map((r) => [r._id, r.doc]));
  return fridgeLeanDocs.map((f) => {
    const candidates = buildCheckinFridgeIdCandidates(f);
    let best = null;
    let bestT = 0;
    for (const cid of candidates) {
      const row = byFridgeId.get(cid);
      if (row && row.visitedAt) {
        const t = new Date(row.visitedAt).getTime();
        if (t > bestT) {
          bestT = t;
          best = row;
        }
      }
    }
    return enrichFridgeDocWithVisit({ ...f, lastCheckin: best || null });
  });
}

function castFridgeMatchForAggregate(filter) {
  const f = { ...filter };
  if (f.cityId != null && !(f.cityId instanceof mongoose.Types.ObjectId)) {
    const s = String(f.cityId);
    if (mongoose.Types.ObjectId.isValid(s)) f.cityId = new mongoose.Types.ObjectId(s);
  }
  return f;
}

function enrichFridgeDocWithVisit(fridgePlain) {
  const lastCheckin = fridgePlain.lastCheckin != null ? leanCheckinForApi(fridgePlain.lastCheckin) : null;
  const lastVisit = lastCheckin && lastCheckin.visitedAt != null ? lastCheckin.visitedAt : null;
  const visitStatus = visitStatusFromLastVisit(lastVisit);
  return { ...fridgePlain, lastCheckin, lastVisit, visitStatus };
}

// GET /api/fridges
// Для бухгалтеров автоматически фильтрует по их городу
router.get('/', authenticateToken, async (req, res) => {
  try {
    const {
      active, nearLat, nearLng, nearKm, cityId, code, search, limit, skip, warehouseStatus,
    } = req.query;
    const filter = {};
    if (active !== undefined) filter.active = active === 'true';
    
    // Для бухгалтера и менеджера - показываем только их город (если указан)
    if ((req.user.role === 'accountant' || req.user.role === 'manager') && req.user.cityId) {
      filter.cityId = req.user.cityId;
    } else if (cityId) {
      filter.cityId = cityId;
    }
    
    // Поиск по коду: ищем и по короткому code, и по длинному number
    if (code) {
      filter.$or = filter.$or || [];
      filter.$or.push({ code: code });
      filter.$or.push({ number: code });
    }
    
    if (warehouseStatus) filter.warehouseStatus = warehouseStatus;

    // Поиск по нескольким полям (если передан search)
    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      // Если уже есть $or от code, добавляем к нему условия search
      if (filter.$or) {
        filter.$or.push(
          { name: searchRegex },
          { code: searchRegex },
          { number: searchRegex }, // Добавляем поиск по длинному номеру
          { address: searchRegex },
          { description: searchRegex }
        );
      } else {
        filter.$or = [
          { name: searchRegex },
          { code: searchRegex },
          { number: searchRegex }, // Добавляем поиск по длинному номеру
          { address: searchRegex },
          { description: searchRegex },
        ];
      }
    }

    const nearLatNum = nearLat ? Number(nearLat) : undefined;
    const nearLngNum = nearLng ? Number(nearLng) : undefined;
    const nearKmNum = nearKm ? Number(nearKm) : 5;

    if (typeof nearLatNum === 'number' && typeof nearLngNum === 'number') {
      filter.location = {
        $near: {
          $geometry: { type: 'Point', coordinates: [nearLngNum, nearLatNum] },
          $maxDistance: Math.max(0, nearKmNum) * 1000,
        },
      };
    }

    // Пагинация
    // Для админа разрешаем загружать больше (до 10000), для остальных максимум 100
    const isAdmin = req.user?.role === 'admin';
    const maxLimit = isAdmin ? 10000 : 100;
    const limitNum = limit ? Math.max(1, Math.min(maxLimit, Number(limit))) : 50;
    const skipNum = skip ? Math.max(0, Number(skip)) : 0;

    const total = await Fridge.countDocuments(filter);

    const matchAgg = castFridgeMatchForAggregate(filter);
    const pipeline = [
      { $match: matchAgg },
      { $sort: { createdAt: -1 } },
      { $skip: skipNum },
      { $limit: limitNum },
      {
        // Без localField+pipeline (это MongoDB 5.0+); так работает на 4.2/4.4 Atlas
        $lookup: {
          from: 'cities',
          let: { cid: '$cityId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $ne: ['$$cid', null] },
                    { $eq: ['$_id', '$$cid'] },
                  ],
                },
              },
            },
            { $project: { _id: 1, name: 1, code: 1 } },
          ],
          as: '_cityDoc',
        },
      },
      {
        $addFields: {
          cityId: { $arrayElemAt: ['$_cityDoc', 0] },
        },
      },
      { $unset: ['_cityDoc'] },
      {
        $addFields: {
          _checkinLookupIds: {
            $concatArrays: [
              aggCheckinIdVariants('$code'),
              aggCheckinIdVariants('$number'),
              aggCheckinIdVariants('$clientInfo.inn'),
            ],
          },
        },
      },
      {
        $lookup: {
          from: 'checkins',
          let: { ids: '$_checkinLookupIds' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $gt: [{ $size: { $ifNull: ['$$ids', []] } }, 0] },
                    { $in: ['$fridgeId', '$$ids'] },
                  ],
                },
              },
            },
            { $sort: { visitedAt: -1 } },
            { $limit: 1 },
            {
              $project: {
                _id: 0,
                id: 1,
                managerId: 1,
                fridgeId: 1,
                visitedAt: 1,
                address: 1,
                notes: 1,
                photos: 1,
                location: 1,
              },
            },
          ],
          as: '_lastCheckinArr',
        },
      },
      {
        $addFields: {
          lastCheckin: {
            $cond: [
              { $gt: [{ $size: { $ifNull: ['$_lastCheckinArr', []] } }, 0] },
              { $arrayElemAt: ['$_lastCheckinArr', 0] },
              null,
            ],
          },
        },
      },
      { $unset: ['_lastCheckinArr', '_checkinLookupIds'] },
    ];

    let fridges;
    try {
      const rawFridges = await Fridge.aggregate(pipeline);
      fridges = rawFridges.map((f) => enrichFridgeDocWithVisit(f));
    } catch (aggErr) {
      console.error('[GET /api/fridges] aggregate failed:', aggErr.message);
      const leanList = await Fridge.find(filter)
        .populate('cityId', 'name code')
        .sort({ createdAt: -1 })
        .skip(skipNum)
        .limit(limitNum)
        .lean();
      fridges = await enrichFridgeListWithLastCheckins(leanList);
    }

    return res.json({
      data: fridges,
      pagination: {
        total,
        limit: limitNum,
        skip: skipNum,
        hasMore: skipNum + fridges.length < total,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch fridges', details: err.message });
  }
});

// GET /api/fridges/:id
router.get('/:id', async (req, res) => {
  try {
    const fridge = await Fridge.findById(req.params.id).populate('cityId', 'name code');
    if (!fridge) return res.status(404).json({ error: 'Not found' });
    const plain = fridge.toObject();
    const ids = buildCheckinFridgeIdCandidates(plain);
    const lastCheckin = ids.length
      ? await Checkin.findOne({ fridgeId: { $in: ids } }).sort({ visitedAt: -1 }).lean()
      : null;
    return res.json(enrichFridgeDocWithVisit({ ...plain, lastCheckin }));
  } catch (err) {
    return res.status(400).json({ error: 'Invalid id', details: err.message });
  }
});

// POST /api/fridges
router.post('/', async (req, res) => {
  try {
    const { code, name, address, description } = req.body;
    if (!code || !name) {
      return res.status(400).json({ error: 'code and name are required' });
    }

    let location = req.body.location;
    if (!location) {
      return res.status(400).json({ error: 'location is required' });
    }

    if (location && typeof location.lat === 'number' && typeof location.lng === 'number') {
      location = { type: 'Point', coordinates: [location.lng, location.lat] };
    }

    if (!location.type || !Array.isArray(location.coordinates) || location.coordinates.length !== 2) {
      return res.status(400).json({ error: 'location must be GeoJSON Point or {lat,lng}' });
    }

    const fridge = await Fridge.create({ code, name, location, address, description });
    return res.status(201).json(fridge);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: 'Fridge code already exists' });
    }
    return res.status(500).json({ error: 'Failed to create fridge', details: err.message });
  }
});

// PATCH /api/fridges/:id
router.patch('/:id', async (req, res) => {
  try {
    const updates = { ...req.body };
    if (updates.location && typeof updates.location.lat === 'number' && typeof updates.location.lng === 'number') {
      updates.location = { type: 'Point', coordinates: [updates.location.lng, updates.location.lat] };
    }
    const fridge = await Fridge.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!fridge) return res.status(404).json({ error: 'Not found' });
    return res.json(fridge);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update fridge', details: err.message });
  }
});

// DELETE /api/fridges/:id
router.delete('/:id', async (req, res) => {
  try {
    const fridge = await Fridge.findByIdAndDelete(req.params.id);
    if (!fridge) return res.status(404).json({ error: 'Not found' });
    return res.json({ message: 'Fridge deleted' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete fridge', details: err.message });
  }
});

module.exports = router;

