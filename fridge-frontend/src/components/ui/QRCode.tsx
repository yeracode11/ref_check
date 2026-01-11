import { useState, useRef, useEffect } from 'react';
import QRCodeSVG from 'react-qr-code';
import { Button } from './Card';

type QRCodeProps = {
  value: string;
  title?: string;
  code?: string;
  size?: number;
  className?: string;
};

// Глобальный контейнер для печати (один на всю страницу)
let globalPrintContainer: HTMLDivElement | null = null;
let printStyleAdded = false;

export function QRCode({ value, title, code, size = 150, className = '' }: QRCodeProps) {
  const [downloading, setDownloading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  // Ленивая загрузка QR-кода - показываем только после того, как компонент отрендерился
  useEffect(() => {
    // Используем requestAnimationFrame для отложенной загрузки
    const timer = requestAnimationFrame(() => {
      // Дополнительная небольшая задержка для обеспечения плавности
      setTimeout(() => {
        setIsVisible(true);
      }, 50);
    });
    return () => cancelAnimationFrame(timer);
  }, []);

  // Добавляем стили для печати (только один раз)
  useEffect(() => {
    if (printStyleAdded) return;
    printStyleAdded = true;

    const styleId = 'qr-print-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      @page {
        size: A4;
        margin: 0;
        padding: 0;
      }
      @media print {
        * {
          margin: 0 !important;
          padding: 0 !important;
        }
        html, body {
          width: 100% !important;
          height: 100% !important;
          overflow: hidden !important;
          margin: 0 !important;
          padding: 0 !important;
        }
        body * {
          visibility: hidden !important;
        }
        #qr-print-global-container,
        #qr-print-global-container * {
          visibility: visible !important;
        }
        #qr-print-global-container {
          position: fixed !important;
          left: 0 !important;
          top: 0 !important;
          width: 100% !important;
          height: 100% !important;
          min-height: auto !important;
          max-height: 100% !important;
          display: flex !important;
          flex-direction: column !important;
          align-items: center !important;
          justify-content: center !important;
          background: white !important;
          z-index: 999999 !important;
          page-break-after: avoid !important;
          page-break-inside: avoid !important;
          overflow: hidden !important;
        }
        #qr-print-global-container .qr-print-image {
          max-width: 70% !important;
          max-height: 70% !important;
          height: auto !important;
          page-break-after: avoid !important;
          page-break-inside: avoid !important;
        }
        #qr-print-global-container .qr-print-text {
          margin-top: 20px !important;
          font-size: 28px !important;
          font-weight: bold !important;
          text-align: center !important;
          page-break-before: avoid !important;
          page-break-after: avoid !important;
          white-space: normal !important;
          word-wrap: break-word !important;
        }
      }
    `;
    document.head.appendChild(style);

    return () => {
      // Не удаляем стили при размонтировании, они нужны глобально
    };
  }, []);

  async function createCanvasWithQR(): Promise<HTMLCanvasElement | null> {
    return new Promise((resolve) => {
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
          // Добавляем отступы
          const padding = 40;
          const textPadding = 20;
          
          // Вычисляем высоту текста
          let textHeight = 0;
          if (code || title) {
            const codeLineHeight = 24; // Высота строки для кода
            const titleLineHeight = 24; // Высота строки для названия
            
            if (title) {
              // Разбиваем название на строки (максимум 3 строки)
              // Используем временный контекст для измерения
              const tempCtx = ctx || canvas.getContext('2d');
              if (tempCtx) {
                tempCtx.font = 'bold 20px Arial';
                const maxWidth = size - 20; // Оставляем небольшой отступ
                const maxLines = 3;
                const words = title.split(' ');
                let lines: string[] = [];
                let currentLine = '';
                
                for (const word of words) {
                  const testLine = currentLine ? `${currentLine} ${word}` : word;
                  const metrics = tempCtx.measureText(testLine);
                  if (metrics.width > maxWidth && currentLine) {
                    lines.push(currentLine);
                    currentLine = word;
                    if (lines.length >= maxLines) {
                      // Обрезаем последнее слово, если нужно
                      let truncated = word;
                      while (tempCtx.measureText(truncated + '...').width > maxWidth && truncated.length > 1) {
                        truncated = truncated.slice(0, -1);
                      }
                      currentLine = truncated + '...';
                      break;
                    }
                  } else {
                    currentLine = testLine;
                  }
                }
                if (currentLine && lines.length < maxLines) {
                  // Проверяем, не слишком ли длинная последняя строка
                  if (tempCtx.measureText(currentLine).width > maxWidth) {
                    let truncated = currentLine;
                    while (tempCtx.measureText(truncated + '...').width > maxWidth && truncated.length > 1) {
                      truncated = truncated.slice(0, -1);
                    }
                    lines.push(truncated + '...');
                  } else {
                    lines.push(currentLine);
                  }
                }
                textHeight += Math.min(lines.length, maxLines) * titleLineHeight;
              }
            }
            
            if (code) {
              textHeight += codeLineHeight + 8; // Высота кода + отступ
            }
            
            textHeight += textPadding; // Отступ между QR и текстом
          }
          
          canvas.width = size + padding * 2;
          canvas.height = size + padding * 2 + textHeight;

          if (ctx) {
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Рисуем QR-код
            ctx.drawImage(img, padding, padding, size, size);
            
            // Рисуем текст под QR-кодом
            if (code || title) {
              ctx.fillStyle = '#000000'; // Черный цвет
              ctx.font = 'bold 20px Arial'; // Жирный шрифт
              ctx.textAlign = 'center';
              ctx.textBaseline = 'top';
              
              let y = padding + size + textPadding;
              
              // Рисуем название с переносами (СВЕРХУ, БОЛЬШИМ ШРИФТОМ)
              if (title) {
                ctx.font = 'bold 20px Arial';
                const maxWidth = size - 20; // Оставляем небольшой отступ по бокам
                const maxLines = 3; // Максимум 3 строки
                const lineHeight = 24;
                
                // Функция для разбиения текста на строки
                const wrapText = (text: string, maxWidth: number): string[] => {
                  const words = text.split(' ');
                  const lines: string[] = [];
                  let currentLine = '';
                  
                  for (const word of words) {
                    const testLine = currentLine ? `${currentLine} ${word}` : word;
                    const metrics = ctx.measureText(testLine);
                    
                    if (metrics.width > maxWidth && currentLine) {
                      // Если текущая строка слишком длинная, сохраняем её и начинаем новую
                      lines.push(currentLine);
                      currentLine = word;
                      
                      // Если достигли максимума строк, обрезаем последнее слово
                      if (lines.length >= maxLines) {
                        // Обрезаем текущее слово, если оно слишком длинное
                        let truncated = word;
                        while (ctx.measureText(truncated + '...').width > maxWidth && truncated.length > 1) {
                          truncated = truncated.slice(0, -1);
                        }
                        currentLine = truncated + '...';
                        break;
                      }
                    } else {
                      currentLine = testLine;
                    }
                  }
                  
                  // Добавляем последнюю строку, если есть место
                  if (currentLine && lines.length < maxLines) {
                    // Проверяем, не слишком ли длинная последняя строка
                    if (ctx.measureText(currentLine).width > maxWidth) {
                      let truncated = currentLine;
                      while (ctx.measureText(truncated + '...').width > maxWidth && truncated.length > 1) {
                        truncated = truncated.slice(0, -1);
                      }
                      lines.push(truncated + '...');
                    } else {
                      lines.push(currentLine);
                    }
                  }
                  
                  return lines;
                };
                
                const lines = wrapText(title, maxWidth);
                
                for (const line of lines) {
                  ctx.fillText(line, canvas.width / 2, y);
                  y += lineHeight;
                }
              }
              
              // Рисуем код СНИЗУ (меньшим шрифтом)
              if (code) {
                y += 8; // Небольшой отступ между названием и кодом
                ctx.font = '16px Arial'; // Обычный шрифт, меньший размер
                ctx.fillStyle = '#666666'; // Серый цвет
                ctx.fillText(`Код: ${code}`, canvas.width / 2, y);
              }
            }
          }
          URL.revokeObjectURL(url);
          resolve(canvas);
        };

        img.onerror = () => {
          URL.revokeObjectURL(url);
          resolve(null);
        };

        img.src = url;
      } catch (error) {
        console.error('Ошибка при подготовке QR-кода:', error);
        resolve(null);
      }
    });
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

      // Используем глобальный контейнер для печати (один на всю страницу)
      if (!globalPrintContainer) {
        globalPrintContainer = document.createElement('div');
        globalPrintContainer.id = 'qr-print-global-container';
        globalPrintContainer.style.position = 'fixed';
        globalPrintContainer.style.left = '-9999px';
        globalPrintContainer.style.top = '0';
        globalPrintContainer.style.width = '100%';
        globalPrintContainer.style.minHeight = '100%';
        globalPrintContainer.style.display = 'flex';
        globalPrintContainer.style.flexDirection = 'column';
        globalPrintContainer.style.alignItems = 'center';
        globalPrintContainer.style.justifyContent = 'center';
        globalPrintContainer.style.background = 'white';
        globalPrintContainer.style.zIndex = '999999';
        globalPrintContainer.style.overflow = 'hidden';
        document.body.appendChild(globalPrintContainer);
      }

      // Очищаем контейнер перед добавлением нового содержимого
      globalPrintContainer.innerHTML = '';

      // Создаем изображение для печати (текст уже включен в canvas)
      const printImg = document.createElement('img');
      printImg.className = 'qr-print-image';
      printImg.src = dataUrl;
      printImg.alt = `QR код ${code || ''}`;
      printImg.style.maxWidth = '80%';
      printImg.style.height = 'auto';
      globalPrintContainer.appendChild(printImg);

      // Показываем контейнер перед печатью
      globalPrintContainer.style.left = '0';
      globalPrintContainer.style.top = '0';

      // Ждем загрузки изображения
      await new Promise((resolve) => {
        if (printImg.complete) {
          resolve(null);
        } else {
          printImg.onload = () => resolve(null);
          printImg.onerror = () => resolve(null);
        }
      });

      // Небольшая задержка для рендеринга
      setTimeout(() => {
        window.print();
        // Скрываем контейнер после печати
        setTimeout(() => {
          if (globalPrintContainer) {
            globalPrintContainer.style.left = '-9999px';
            globalPrintContainer.innerHTML = '';
          }
          setPrinting(false);
        }, 100);
      }, 100);
    } catch (error) {
      console.error('Ошибка при печати QR-кода:', error);
      setPrinting(false);
    }
  }

  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm min-h-[200px] flex items-center justify-center">
        {isVisible ? (
          <QRCodeSVG
            id={`qr-svg-${code || 'default'}`}
            value={value}
            size={size}
            level="L"
            style={{ height: 'auto', maxWidth: '100%', width: '100%' }}
          />
        ) : (
          <div className="text-slate-400 text-sm">Загрузка QR-кода...</div>
        )}
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <Button
          type="button"
          variant="primary"
          onClick={printQR}
          disabled={printing || !isVisible}
          className="text-sm"
        >
          {printing ? 'Печать...' : '🖨️ Печать QR'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={downloadQR}
          disabled={downloading || !isVisible}
          className="text-sm"
        >
          {downloading ? 'Скачивание...' : '📥 Скачать QR'}
        </Button>
      </div>
    </div>
  );
}

