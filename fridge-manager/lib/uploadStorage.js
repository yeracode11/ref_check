const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');
const CHECKIN_SUBDIR = 'checkins';

const PHOTO_MAX_MB = (() => {
  const n = parseInt(process.env.PHOTO_UPLOAD_MAX_MB || '8', 10);
  return Number.isFinite(n) && n >= 1 ? n : 8;
})();

const ALLOWED_PHOTO_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
};

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function getPublicBaseUrl() {
  const raw = process.env.PUBLIC_BASE_URL || '';
  return raw.replace(/\/+$/, '');
}

function publicUploadUrl(relativePath) {
  const normalized = String(relativePath || '').replace(/^\/+/, '').replace(/\\/g, '/');
  const urlPath = `/uploads/${normalized}`;
  const base = getPublicBaseUrl();
  return base ? `${base}${urlPath}` : urlPath;
}

function checkinUploadRelativePath(originalName, mimeType) {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const extFromName = path.extname(originalName || '').toLowerCase();
  const ext = EXT_BY_MIME[mimeType] || extFromName || '.jpg';
  const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'].includes(ext) ? ext : '.jpg';
  return `${CHECKIN_SUBDIR}/${y}/${m}/${crypto.randomUUID()}${safeExt}`;
}

const checkinPhotoStorage = multer.diskStorage({
  destination(req, file, cb) {
    const rel = checkinUploadRelativePath(file.originalname, file.mimetype);
    const absDir = path.join(UPLOAD_ROOT, path.dirname(rel));
    try {
      ensureDir(absDir);
      file._relativePath = rel;
      cb(null, absDir);
    } catch (err) {
      cb(err);
    }
  },
  filename(req, file, cb) {
    cb(null, path.basename(file._relativePath || checkinUploadRelativePath(file.originalname, file.mimetype)));
  },
});

function photoFileFilter(req, file, cb) {
  if (ALLOWED_PHOTO_MIMES.has(file.mimetype)) {
    cb(null, true);
    return;
  }
  cb(new Error('Допустимы только изображения JPEG, PNG, WEBP, HEIC'));
}

function buildCheckinPhotoUploader(maxCount = 1) {
  return multer({
    storage: checkinPhotoStorage,
    limits: {
      fileSize: PHOTO_MAX_MB * 1024 * 1024,
      files: maxCount,
    },
    fileFilter: photoFileFilter,
  });
}

function photoUrlsFromFiles(files) {
  const list = Array.isArray(files) ? files : (files ? [files] : []);
  return list.map((f) => {
    const rel = f._relativePath
      || path.join(CHECKIN_SUBDIR, path.basename(f.path || f.filename || '')).replace(/\\/g, '/');
    return publicUploadUrl(rel);
  });
}

ensureDir(path.join(UPLOAD_ROOT, CHECKIN_SUBDIR));

module.exports = {
  UPLOAD_ROOT,
  PHOTO_MAX_MB,
  getPublicBaseUrl,
  publicUploadUrl,
  buildCheckinPhotoUploader,
  photoUrlsFromFiles,
};
