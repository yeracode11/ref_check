/**
 * Нормализация и расширение списка CORS origin (www/non-www, без trailing slash).
 */

function normalizeOrigin(origin) {
  if (!origin || typeof origin !== 'string') return '';
  const trimmed = origin.trim().replace(/\/+$/, '');
  try {
    const url = new URL(trimmed);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

function expandOriginVariants(origin) {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return [];

  const variants = new Set([normalized]);
  try {
    const url = new URL(normalized);
    const { protocol, hostname, port } = url;
    const hostWithPort = port ? `${hostname}:${port}` : hostname;

    if (hostname.startsWith('www.')) {
      const bare = hostname.slice(4);
      variants.add(`${protocol}//${port ? `${bare}:${port}` : bare}`.toLowerCase());
    } else {
      variants.add(`${protocol}//www.${hostWithPort}`.toLowerCase());
    }
  } catch {
    // leave single normalized entry
  }

  return [...variants];
}

function buildAllowedOriginSet(corsOriginRaw) {
  const raw = (corsOriginRaw || '').trim();
  if (!raw || raw === '*') {
    return { allowAll: true, origins: new Set() };
  }

  const origins = new Set();
  raw.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((entry) => {
      expandOriginVariants(entry).forEach((v) => origins.add(v));
    });

  return { allowAll: false, origins };
}

function createCorsOriginChecker(corsOriginRaw) {
  const { allowAll, origins } = buildAllowedOriginSet(corsOriginRaw);

  if (allowAll) {
    return (origin, callback) => callback(null, true);
  }

  return (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }

    const normalized = normalizeOrigin(origin);
    if (origins.has(normalized)) {
      callback(null, true);
      return;
    }

    console.warn(`[CORS] blocked origin: ${origin} (normalized: ${normalized})`);
    callback(null, false);
  };
}

module.exports = {
  normalizeOrigin,
  expandOriginVariants,
  buildAllowedOriginSet,
  createCorsOriginChecker,
};
