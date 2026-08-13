import { useEffect } from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { isChunkLoadError } from '../utils/lazyWithRetry';

export default function RouteErrorFallback() {
  const error = useRouteError();
  const chunkError = isChunkLoadError(error)
    || (isRouteErrorResponse(error) && isChunkLoadError(error.data));

  useEffect(() => {
    if (!chunkError) return;

    let reloaded = false;
    try {
      reloaded = sessionStorage.getItem('stellref:chunk-reload') === '1';
    } catch {
      /* ignore */
    }

    if (!reloaded) {
      try {
        sessionStorage.setItem('stellref:chunk-reload', '1');
      } catch {
        /* ignore */
      }
      window.location.reload();
    }
  }, [chunkError]);

  const message = chunkError
    ? 'Вышло обновление приложения. Страница перезагружается…'
    : isRouteErrorResponse(error)
      ? error.statusText || 'Ошибка маршрута'
      : error instanceof Error
        ? error.message
        : 'Неизвестная ошибка';

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900 mb-2">
          {chunkError ? 'Обновление приложения' : 'Ошибка'}
        </h1>
        <p className="text-sm text-slate-600 mb-4">{message}</p>
        {!chunkError && (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm hover:bg-slate-800"
          >
            Перезагрузить
          </button>
        )}
      </div>
    </div>
  );
}
