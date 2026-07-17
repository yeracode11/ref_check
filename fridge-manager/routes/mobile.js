const express = require('express');
const Checkin = require('../models/Checkin');
const Fridge = require('../models/Fridge');
const User = require('../models/User');
const {
  authenticateToken,
  requireMobileRole,
  requireManagerOrAdmin,
} = require('../middleware/auth');
const {
  createCheckinRecord,
  locationFromLatLngFields,
} = require('../lib/checkinService');
const {
  buildCheckinPhotoUploader,
  photoUrlsFromFiles,
  PHOTO_MAX_MB,
  getPublicBaseUrl,
} = require('../lib/uploadStorage');
const { findFridgeByIdentifier, getAssignedCityId } = require('../lib/cityScope');
const { MXO_REPAIR_WORKS } = require('../lib/mxoRepairWorks');
const { localDateKeyFromVisit, DEFAULT_VISIT_TIMEZONE, expandCheckinFridgeIdsForInQuery, buildCheckinFridgeIdCandidates } = require('../lib/fridgeVisitHelpers');

const router = express.Router();
const uploadPhoto = buildCheckinPhotoUploader(1);
const uploadCheckinPhotos = buildCheckinPhotoUploader(5);

function parseBool(value) {
  return value === true || value === 'true' || value === '1';
}

function handleMulterError(err, req, res, next) {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `Файл слишком большой (макс. ${PHOTO_MAX_MB} MB)` });
  }
  return res.status(400).json({ error: err.message || 'Upload failed' });
}

// GET /api/mobile/bootstrap — стартовые данные для приложения после логина
router.get('/bootstrap', authenticateToken, requireMobileRole, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select('-password')
      .populate('cityId', 'name code')
      .lean();

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const roleFeatures = {
      manager: { checkins: true, scan: true, repairs: false },
      service_manager: { checkins: false, scan: true, repairs: true },
      admin: { checkins: true, scan: true, repairs: true },
    };

    return res.json({
      user,
      city: user.cityId || null,
      features: roleFeatures[user.role] || roleFeatures.manager,
      mxoRepairWorks: MXO_REPAIR_WORKS,
      server: {
        publicBaseUrl: getPublicBaseUrl() || null,
        timezone: DEFAULT_VISIT_TIMEZONE,
        photoMaxMb: PHOTO_MAX_MB,
        maxPhotosPerCheckin: 5,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load bootstrap', details: err.message });
  }
});

// GET /api/mobile/fridges/lookup?code= — быстрый поиск по QR / номеру
router.get('/fridges/lookup', authenticateToken, requireMobileRole, async (req, res) => {
  try {
    const code = String(req.query.code || req.query.q || '').trim();
    if (!code) {
      return res.status(400).json({ error: 'code is required' });
    }

    const fridge = await Fridge.findOne({
      $or: [
        { code: code.replace(/^#/, '') },
        { number: code.replace(/^#/, '') },
        { 'clientInfo.inn': code.replace(/^#/, '') },
      ],
      active: true,
    })
      .populate('cityId', 'name code')
      .lean();

    if (!fridge) {
      return res.status(404).json({ error: 'Fridge not found' });
    }

    const assignedCityId = getAssignedCityId(req.user);
    if (assignedCityId && fridge.cityId && String(fridge.cityId._id || fridge.cityId) !== String(assignedCityId)) {
      return res.status(403).json({ error: 'Холодильник из другого города' });
    }

    const ids = expandCheckinFridgeIdsForInQuery(buildCheckinFridgeIdCandidates(fridge));
    const lastCheckin = ids.length
      ? await Checkin.findOne({ fridgeId: { $in: ids } }).sort({ visitedAt: -1 }).lean()
      : null;

    return res.json({
      ...fridge,
      lastCheckin,
      displayId: fridge.number || fridge.code,
      showSeasonalClosure: ['school', 'restricted'].includes(fridge.type),
    });
  } catch (err) {
    return res.status(500).json({ error: 'Lookup failed', details: err.message });
  }
});

// GET /api/mobile/checkins/today — отметки текущего пользователя за сегодня (Asia/Almaty)
router.get('/checkins/today', authenticateToken, requireManagerOrAdmin, async (req, res) => {
  try {
    const todayKey = localDateKeyFromVisit(new Date(), DEFAULT_VISIT_TIMEZONE);
    const start = new Date(`${todayKey}T00:00:00+05:00`);
    const end = new Date(`${todayKey}T23:59:59.999+05:00`);

    const managerIds = [req.user.id, req.user.username].filter(Boolean);
    const items = await Checkin.find({
      managerId: { $in: managerIds },
      visitedAt: { $gte: start, $lte: end },
    })
      .sort({ visitedAt: -1 })
      .lean();

    return res.json({
      date: todayKey,
      total: items.length,
      data: items,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch today checkins', details: err.message });
  }
});

// POST /api/mobile/uploads/photo — загрузка одного фото, возвращает URL
router.post(
  '/uploads/photo',
  authenticateToken,
  requireManagerOrAdmin,
  (req, res, next) => uploadPhoto.single('photo')(req, res, (err) => handleMulterError(err, req, res, next)),
  (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'photo file is required' });
    }
    const [url] = photoUrlsFromFiles([req.file]);
    return res.status(201).json({ url, urls: [url] });
  },
);

// POST /api/mobile/checkins — отметка с фото (multipart) или JSON-полями lat/lng
router.post(
  '/checkins',
  authenticateToken,
  requireManagerOrAdmin,
  (req, res, next) => uploadCheckinPhotos.array('photos', 5)(req, res, (err) => handleMulterError(err, req, res, next)),
  async (req, res) => {
    try {
      const uploadedUrls = photoUrlsFromFiles(req.files);
      let extraPhotos = [];
      if (req.body.photoUrls) {
        try {
          const parsed = JSON.parse(req.body.photoUrls);
          if (Array.isArray(parsed)) extraPhotos = parsed.map(String);
        } catch {
          extraPhotos = String(req.body.photoUrls).split(',').map((s) => s.trim()).filter(Boolean);
        }
      }

      const location = locationFromLatLngFields(req.body);
      if (!location) {
        return res.status(400).json({ error: 'lat and lng are required' });
      }

      const result = await createCheckinRecord({
        user: req.user,
        fridgeId: req.body.fridgeId,
        location,
        photos: [...uploadedUrls, ...extraPhotos],
        address: req.body.address,
        notes: req.body.notes,
        fridgeCondition: req.body.fridgeCondition,
        isSeasonalClosure: parseBool(req.body.isSeasonalClosure),
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
  },
);

module.exports = router;
