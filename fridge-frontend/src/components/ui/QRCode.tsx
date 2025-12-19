import { useState } from 'react';
import QRCodeSVG from 'react-qr-code';
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
  const [printing, setPrinting] = useState(false);

  async function createCanvasWithQR(): Promise<HTMLCanvasElement | null> {
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
        }
        URL.revokeObjectURL(url);
      };

      img.src = url;
      return canvas;
    } catch (error) {
      console.error('Ошибка при подготовке QR-кода:', error);
      return null;
    }
  }

  async function downloadQR() {
    setDownloading(true);
    try {
      const canvas = await createCanvasWithQR();
      if (!canvas) {
        setDownloading(false);
        return;
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
    } catch (error) {
      console.error('Ошибка при скачивании QR-кода:', error);
      setDownloading(false);
    }
  }

  async function printQR() {
    setPrinting(true);
    try {
      const canvas = await createCanvasWithQR();
      if (!canvas) {
        setPrinting(false);
        return;
      }

      const dataUrl = canvas.toDataURL('image/png');
      const printWindow = window.open('', '_blank');

      if (!printWindow) {
        console.error('Не удалось открыть окно печати');
        setPrinting(false);
        return;
      }

      printWindow.document.write(`
        <html>
          <head>
            <title>QR код ${code || ''}</title>
            <style>
              body {
                margin: 0;
                padding: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                height: 100vh;
                background: white;
              }
              img {
                max-width: 100%;
                height: auto;
              }
            </style>
          </head>
          <body>
            <img src="${dataUrl}" alt="QR код ${code || ''}" />
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    } catch (error) {
      console.error('Ошибка при печати QR-кода:', error);
    } finally {
      setPrinting(false);
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
      <div className="flex flex-col sm:flex-row gap-2">
        <Button
          type="button"
          variant="primary"
          onClick={printQR}
          disabled={printing}
          className="text-sm"
        >
          {printing ? 'Печать...' : '🖨️ Печать QR'}
        </Button>
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
    </div>
  );
}

