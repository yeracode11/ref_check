import { useEffect, useRef } from 'react';

type AdminFridgeForMap = {
  id: string;
  name: string;
  code: string;
  address?: string;
  status: 'today' | 'week' | 'old' | 'never';
  location?: { type: 'Point'; coordinates: [number, number] };
};

type Props = {
  fridges: AdminFridgeForMap[];
};

declare global {
  interface Window {
    ymaps?: any;
  }
}

const YMAPS_URL = `https://api-maps.yandex.ru/2.1/?apikey=${
  import.meta.env.VITE_YANDEX_MAPS_API_KEY || ''
}&lang=ru_RU`;

let ymapsLoadingPromise: Promise<any> | null = null;

function loadYMaps(): Promise<any> {
  if (window.ymaps) {
    return Promise.resolve(window.ymaps);
  }
  if (ymapsLoadingPromise) {
    return ymapsLoadingPromise;
  }

  ymapsLoadingPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = YMAPS_URL;
    script.async = true;
    script.onload = () => {
      if (window.ymaps) {
        window.ymaps.ready(() => resolve(window.ymaps));
      } else {
        reject(new Error('Yandex Maps API не загрузился'));
      }
    };
    script.onerror = () => reject(new Error('Ошибка загрузки Yandex Maps API'));
    document.body.appendChild(script);
  });

  return ymapsLoadingPromise;
}

export function AdminFridgeMap({ fridges }: Props) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<any>(null);
  const clustererRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!mapRef.current) return;

      try {
        const ymaps = await loadYMaps();
        if (cancelled || !mapRef.current) return;

        if (!mapInstanceRef.current) {
          // Центр Тараза (примерные координаты)
          const center: [number, number] = [42.8996, 71.3696];
          const map = new ymaps.Map(mapRef.current, {
            center,
            zoom: 12,
            controls: ['zoomControl', 'typeSelector', 'fullscreenControl'],
          });

          const clusterer = new ymaps.Clusterer({
            preset: 'islands#invertedBlueClusterIcons',
            groupByCoordinates: false,
            clusterDisableClickZoom: false,
            clusterOpenBalloonOnClick: true,
          });

          map.geoObjects.add(clusterer);
          mapInstanceRef.current = map;
          clustererRef.current = clusterer;
        }

        // Обновляем маркеры
        const clusterer = clustererRef.current;
        clusterer.removeAll();

        const placemarks: any[] = [];

        fridges.forEach((f) => {
          if (!f.location || !Array.isArray(f.location.coordinates)) return;
          const [lng, lat] = f.location.coordinates;
          if (lat === 0 && lng === 0) return; // пропускаем временные координаты

          let preset = 'islands#grayCircleIcon';
          if (f.status === 'today') preset = 'islands#greenCircleIcon';
          else if (f.status === 'week') preset = 'islands#yellowCircleIcon';
          else if (f.status === 'old') preset = 'islands#redCircleIcon';

          const placemark = new window.ymaps.Placemark(
            [lat, lng],
            {
              balloonContentHeader: `<strong>${f.name}</strong>`,
              balloonContentBody: `<div>Код: ${f.code}</div>${
                f.address ? `<div>Адрес: ${f.address}</div>` : ''
              }`,
              hintContent: f.name,
            },
            {
              preset,
            }
          );

          placemarks.push(placemark);
        });

        if (placemarks.length > 0) {
          clusterer.add(placemarks);
          const map = mapInstanceRef.current;
          map.setBounds(clusterer.getBounds(), { checkZoomRange: true, zoomMargin: 40 });
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Не удалось инициализировать карту Яндекс:', e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fridges]);

  return (
    <div className="w-full h-[480px] rounded-lg overflow-hidden border border-slate-200">
      <div ref={mapRef} className="w-full h-full" />
    </div>
  );
}


