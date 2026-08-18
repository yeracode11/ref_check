const RETURN_KEY = 'authReturnTo';

/** Сохранить URL для возврата после логина (QR-скан, мобильные браузеры теряют router state). */
export function saveAuthReturnTo(path: string) {
  if (!path || path === '/login') return;
  try {
    sessionStorage.setItem(RETURN_KEY, path);
  } catch {
    /* ignore */
  }
}

export function peekAuthReturnTo(): string | null {
  try {
    return sessionStorage.getItem(RETURN_KEY);
  } catch {
    return null;
  }
}

export function consumeAuthReturnTo(): string | null {
  const path = peekAuthReturnTo();
  if (path) {
    try {
      sessionStorage.removeItem(RETURN_KEY);
    } catch {
      /* ignore */
    }
  }
  return path;
}

export function buildLoginPath(returnTo?: string | null) {
  if (!returnTo || returnTo === '/login') return '/login';
  return `/login?returnTo=${encodeURIComponent(returnTo)}`;
}

export function resolveReturnPath(
  routerFrom: string | undefined,
  searchReturnTo: string | null,
): string {
  const fromQuery = searchReturnTo?.trim();
  if (fromQuery && fromQuery.startsWith('/') && !fromQuery.startsWith('//')) {
    return fromQuery;
  }
  const fromStorage = consumeAuthReturnTo();
  if (fromStorage?.startsWith('/')) return fromStorage;
  if (routerFrom?.startsWith('/')) return routerFrom;
  return '/';
}
