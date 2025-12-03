import { useState } from 'react';
import { QRCodeSVG } from 'react-qr-code';
import { Button } from './Card';

type QRCodeProps = {
  value: string;
  title?: string;
  code?: string;
  size?: number;
  className?: string;
};

export function QRCode({ value, title, code, size = 200, className = '' }: QRCodeProps) {
  const [downloading, setDownloading] = useState(false);

  async function downloadQR() {
    setDownloading(true);
    try {
      // Создаем SVG элемент
      const svg = document.getElementById(`qr-svg-${code || 'default'}`);
      if (!svg) {
        throw new Error('QR код не найден');
      }

      // Конвертируем SVG в canvas, затем в PNG
      const svgData = new XMLSerializer().serializeToString(svg);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();

      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);

      img.onload = () => {
        // Добавляем отступы для текста
        const padding = 40;
        const textHeight = title || code ? 60 : 0;
        canvas.width = size + padding * 2;
        canvas.height = size + padding * 2 + textHeight;

        if (ctx) {
          ctx.fillStyle = 'white';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          // Рисуем QR-код
          ctx.drawImage(img, padding, padding, size, size);

          // Добавляем текст
          if (title || code) {
            ctx.fillStyle = 'black';
            ctx.font = 'bold 16px Arial';
            ctx.textAlign = 'center';
            if (code) {
              ctx.fillText(`#${code}`, canvas.width / 2, size + padding + 25);
            }
            if (title) {
              ctx.fillStyle = 'gray';
              ctx.font = '12px Arial';
              const displayTitle = title.length > 30 ? title.substring(0, 30) + '...' : title;
              ctx.fillText(displayTitle, canvas.width / 2, size + padding + 45);
            }
          }

          // Скачиваем
          canvas.toBlob((blob) => {
            if (blob) {
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `qr_${code || 'fridge'}.png`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }
            setDownloading(false);
          });
        }
        URL.revokeObjectURL(url);
      };

      img.src = url;
    } catch (error) {
      console.error('Ошибка при скачивании QR-кода:', error);
      setDownloading(false);
    }
  }

  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
        <QRCodeSVG
          id={`qr-svg-${code || 'default'}`}
          value={value}
          size={size}
          level="L"
          style={{ height: 'auto', maxWidth: '100%', width: '100%' }}
        />
        {(title || code) && (
          <div className="mt-3 text-center">
            {code && <div className="font-semibold text-sm text-slate-900">#{code}</div>}
            {title && (
              <div className="text-xs text-slate-500 mt-1 truncate max-w-[200px]">{title}</div>
            )}
          </div>
        )}
      </div>
      <Button
        type="button"
        variant="secondary"
        onClick={downloadQR}
        disabled={downloading}
        className="text-sm"
      >
        {downloading ? 'Скачивание...' : '📥 Скачать QR'}
      </Button>
    </div>
  );
}

