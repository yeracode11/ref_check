import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const CHUNK_RELOAD_KEY = 'stellref:chunk-reload';

export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes('failed to fetch dynamically imported module')
    || msg.includes('importing a module script failed')
    || msg.includes('error loading dynamically imported module')
    || msg.includes('dynamically imported module')
  );
}

/** Сбрасывает флаг одноразовой перезагрузки после успешной загрузки приложения. */
export function clearChunkReloadFlag(): void {
  try {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
  } catch {
    /* ignore */
  }
}

async function importWithChunkReload<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
): Promise<{ default: T }> {
  try {
    return await factory();
  } catch (error) {
    if (!isChunkLoadError(error)) throw error;

    let reloaded = false;
    try {
      reloaded = sessionStorage.getItem(CHUNK_RELOAD_KEY) === '1';
    } catch {
      /* ignore */
    }

    if (!reloaded) {
      try {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
      } catch {
        /* ignore */
      }
      window.location.reload();
      return new Promise(() => {});
    }

    throw error;
  }
}

export function lazyWithRetry<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(() => importWithChunkReload(factory));
}
