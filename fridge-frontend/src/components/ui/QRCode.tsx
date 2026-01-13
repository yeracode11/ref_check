import { useState, useRef, useEffect } from 'react';
import QRCodeSVG from 'react-qr-code';
import { Button } from './Card';

type QRCodeProps = {
  value: string;
  title?: string;
  code?: string;
  number?: string; // Длинный номер из Excel
  cityName?: string; // Название города для определения формата
  size?: number;
  className?: string;
};

// Глобальный контейнер для печати (один на всю страницу)
let globalPrintContainer: HTMLDivElement | null = null;
let printStyleAdded = false;

export function QRCode({ value, title, code, number, cityName, size = 100, className = '' }: QRCodeProps) {
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
          // Определяем формат: для Шымкента - новый формат, для остальных - старый
          const isShymkent = cityName === 'Шымкент';
          
          // Добавляем отступы
          const padding = 40;
          const textPadding = 20;
          
          let topTextHeight = 0;
          let bottomTextHeight = 0;
          const topPadding = 10;
          const bottomPadding = 10;
          
          // Сначала устанавливаем минимальные размеры canvas для вычисления высоты текста
          canvas.width = size + padding * 2;
          canvas.height = size + padding * 2;
          
          if (!ctx) {
            URL.revokeObjectURL(url);
            resolve(null);
            return;
          }
          
          // Временно настраиваем контекст для измерения текста
          ctx.font = 'bold 20px Arial';
          ctx.textAlign = 'center';
          
          if (isShymkent) {
            // Новый формат для Шымкента: только длинный номер снизу (без кода с #)
            // Если номер не помещается, уменьшаем QR-код и размещаем номер внизу QR-кода
            let shymkentQRSize = Math.floor(size * 0.92); // 92% от исходного размера
            let numberLines: string[] = [];
            let numberInsideQR = false; // Флаг: номер внутри QR-кода или снаружи
            
            if (number) {
              // Размер шрифта номера
              ctx.font = 'bold 14px Arial'; // Увеличено до 14px
              const maxWidth = shymkentQRSize;
              const chars = number.split('');
              let currentLine = '';
              
              // Разбиваем номер на строки
              for (const char of chars) {
                const testLine = currentLine + char;
                const metrics = ctx.measureText(testLine);
                
                if (metrics.width > maxWidth && currentLine) {
                  numberLines.push(currentLine);
                  currentLine = char;
                  // Если больше 2 строк, уменьшаем QR-код и размещаем номер внутри
                  if (numberLines.length >= 2) {
                    // Уменьшаем QR-код, чтобы номер поместился внутри
                    shymkentQRSize = Math.floor(size * 0.80); // 80% от исходного размера
                    numberInsideQR = true;
                    // Пересчитываем с новым размером
                    ctx.font = 'bold 14px Arial';
                    const newMaxWidth = shymkentQRSize;
                    numberLines = [];
                    currentLine = '';
                    // Разбиваем заново с учетом нового размера
                    for (const char2 of chars) {
                      const testLine2 = currentLine + char2;
                      const metrics2 = ctx.measureText(testLine2);
                      if (metrics2.width > newMaxWidth && currentLine) {
                        numberLines.push(currentLine);
                        currentLine = char2;
                        if (numberLines.length >= 3) break; // Максимум 3 строки внутри QR
                      } else {
                        currentLine = testLine2;
                      }
                    }
                    break;
                  }
                } else {
                  currentLine = testLine;
                }
              }
              
              if (currentLine && numberLines.length < (numberInsideQR ? 3 : 2)) {
                numberLines.push(currentLine);
              }
              
              if (numberInsideQR) {
                // Номер внутри QR-кода - не добавляем высоту снизу
                bottomTextHeight = 0;
              } else {
                // Номер снаружи QR-кода
                bottomTextHeight = Math.min(numberLines.length, 2) * 18 + bottomPadding; // 18px между строками
              }
            }
          } else {
            // Старый формат для остальных городов (Тараз): код и название снизу в canvas
            // Увеличиваем размер QR кода для Тараза (для термопринтера 70x30)
            const tarazQRSize = Math.floor(size * 0.92); // 92% от исходного размера (увеличено для четкости)
            
            if (code) {
              // Высота для кода - увеличиваем размер шрифта для четкости при печати
              ctx.font = 'bold 24px Arial'; // Увеличено до 24px для четкости
              bottomTextHeight += 32 + topPadding; // Увеличено для лучшего отображения
            }
            
            if (title) {
              // Вычисляем высоту для title (может быть в несколько строк) - увеличиваем размер шрифта
              ctx.font = 'bold 22px Arial'; // Увеличено до 22px для четкости
              const maxWidth = tarazQRSize;
              const words = title.split(' ');
              let lines: string[] = [];
              let currentLine = '';
              
              for (const word of words) {
                const testLine = currentLine ? `${currentLine} ${word}` : word;
                const metrics = ctx.measureText(testLine);
                
                if (metrics.width > maxWidth && currentLine) {
                  lines.push(currentLine);
                  currentLine = word;
                  if (lines.length >= 2) break; // Максимум 2 строки
                } else {
                  currentLine = testLine;
                }
              }
              
              if (currentLine && lines.length < 2) {
                lines.push(currentLine);
              }
              
              bottomTextHeight += Math.min(lines.length, 2) * 26 + bottomPadding; // Увеличено для четкости
            }
          }
          
          // Теперь устанавливаем финальные размеры canvas
          if (isShymkent) {
            // Используем размер, вычисленный выше (может быть уменьшен, если номер не помещается)
            // Пересчитываем для точности
            let shymkentQRSize = Math.floor(size * 0.92);
            let numberInsideQR = false;
            if (number) {
              ctx.font = 'bold 14px Arial';
              const maxWidth = shymkentQRSize;
              const chars = number.split('');
              let testLines: string[] = [];
              let currentLine = '';
              for (const char of chars) {
                const testLine = currentLine + char;
                const metrics = ctx.measureText(testLine);
                if (metrics.width > maxWidth && currentLine) {
                  testLines.push(currentLine);
                  currentLine = char;
                  if (testLines.length >= 2) {
                    // Номер не помещается - уменьшаем QR-код
                    shymkentQRSize = Math.floor(size * 0.80);
                    numberInsideQR = true;
                    // Пересчитываем строки с новым размером
                    ctx.font = 'bold 14px Arial';
                    const newMaxWidth = shymkentQRSize;
                    testLines = [];
                    currentLine = '';
                    for (const char2 of chars) {
                      const testLine2 = currentLine + char2;
                      const metrics2 = ctx.measureText(testLine2);
                      if (metrics2.width > newMaxWidth && currentLine) {
                        testLines.push(currentLine);
                        currentLine = char2;
                        if (testLines.length >= 3) break;
                      } else {
                        currentLine = testLine2;
                      }
                    }
                    if (currentLine && testLines.length < 3) {
                      testLines.push(currentLine);
                    }
                    break;
                  }
                } else {
                  currentLine = testLine;
                }
              }
              if (currentLine && testLines.length < 2 && !numberInsideQR) {
                testLines.push(currentLine);
              }
              if (!numberInsideQR) {
                bottomTextHeight = Math.min(testLines.length, 2) * 18 + bottomPadding;
              } else {
                bottomTextHeight = 0; // Номер внутри QR-кода
              }
            }
            canvas.width = shymkentQRSize + padding * 2;
            canvas.height = shymkentQRSize + padding * 2 + bottomTextHeight;
          } else {
            // Для Тараза - QR код (увеличен) + текст снизу
            const tarazQRSize = Math.floor(size * 0.92); // Увеличено до 92% для четкости при печати
            canvas.width = tarazQRSize + padding * 2;
            canvas.height = tarazQRSize + padding * 2 + bottomTextHeight;
          }

          // Пересоздаем контекст после изменения размеров canvas
          const finalCtx = canvas.getContext('2d');
          if (!finalCtx) {
            URL.revokeObjectURL(url);
            resolve(null);
            return;
          }
          
          finalCtx.fillStyle = 'white';
          finalCtx.fillRect(0, 0, canvas.width, canvas.height);
          
          finalCtx.textAlign = 'center';
          finalCtx.textBaseline = 'top';
            
            let currentY = padding;
            
            if (isShymkent) {
              // Новый формат для Шымкента: только длинный номер снизу (без кода с #)
              let shymkentQRSize = Math.floor(size * 0.92);
              let numberLines: string[] = [];
              let numberInsideQR = false;
              
              // Определяем, нужно ли уменьшать QR-код
              if (number) {
                finalCtx.font = 'bold 14px Arial'; // Увеличено до 14px
                const maxWidth = shymkentQRSize;
                const chars = number.split('');
                let currentLine = '';
                
                for (const char of chars) {
                  const testLine = currentLine + char;
                  const metrics = finalCtx.measureText(testLine);
                  
                  if (metrics.width > maxWidth && currentLine) {
                    numberLines.push(currentLine);
                    currentLine = char;
                    if (numberLines.length >= 2) {
                      // Уменьшаем QR-код и размещаем номер внутри
                      shymkentQRSize = Math.floor(size * 0.80);
                      numberInsideQR = true;
                      // Пересчитываем с новым размером
                      finalCtx.font = 'bold 14px Arial';
                      const newMaxWidth = shymkentQRSize;
                      numberLines = [];
                      currentLine = '';
                      for (const char2 of chars) {
                        const testLine2 = currentLine + char2;
                        const metrics2 = finalCtx.measureText(testLine2);
                        if (metrics2.width > newMaxWidth && currentLine) {
                          numberLines.push(currentLine);
                          currentLine = char2;
                          if (numberLines.length >= 3) break;
                        } else {
                          currentLine = testLine2;
                        }
                      }
                      break;
                    }
                  } else {
                    currentLine = testLine;
                  }
                }
                
                if (currentLine && numberLines.length < (numberInsideQR ? 3 : 2)) {
                  numberLines.push(currentLine);
                }
              }
              
              const qrX = (canvas.width - shymkentQRSize) / 2;
              
              if (numberInsideQR) {
                // Номер внутри QR-кода: рисуем QR-код, затем номер поверх внизу
                finalCtx.drawImage(img, qrX, currentY, shymkentQRSize, shymkentQRSize);
                
                // Рисуем белый фон для номера внизу QR-кода
                const numberHeight = numberLines.length * 18;
                finalCtx.fillStyle = 'white';
                finalCtx.fillRect(qrX, currentY + shymkentQRSize - numberHeight - 4, shymkentQRSize, numberHeight + 4);
                
                // Рисуем номер поверх QR-кода
                finalCtx.font = 'bold 14px Arial';
                finalCtx.fillStyle = '#000000';
                numberLines.forEach((line, idx) => {
                  finalCtx.fillText(line, canvas.width / 2, currentY + shymkentQRSize - numberHeight + (idx * 18));
                });
              } else {
                // Номер снаружи QR-кода: рисуем QR-код, затем номер снизу
                finalCtx.drawImage(img, qrX, currentY, shymkentQRSize, shymkentQRSize);
                currentY += shymkentQRSize + bottomPadding;
                
                // Рисуем номер снизу
                if (number && numberLines.length > 0) {
                  finalCtx.font = 'bold 14px Arial';
                  finalCtx.fillStyle = '#000000';
                  numberLines.forEach((line, idx) => {
                    finalCtx.fillText(line, canvas.width / 2, currentY + (idx * 18));
                  });
                }
              }
            } else {
              // Старый формат для остальных городов (Тараз и др.)
              // Увеличиваем размер QR кода для термопринтера 70x30, чтобы избежать искажений при печати
              const tarazQRSize = Math.floor(size * 0.92); // Увеличено до 92% для четкости
              const qrX = (canvas.width - tarazQRSize) / 2;
              
              // Включаем сглаживание для лучшего качества при печати
              finalCtx.imageSmoothingEnabled = true;
              finalCtx.imageSmoothingQuality = 'high';
              
              // Рисуем QR-код (увеличен)
              finalCtx.drawImage(img, qrX, currentY, tarazQRSize, tarazQRSize);
              currentY += tarazQRSize + bottomPadding;
              
              // Рисуем код СНИЗУ QR кода - увеличиваем размер шрифта для четкости
              if (code) {
                finalCtx.font = 'bold 24px Arial'; // Увеличено до 24px для четкости
                finalCtx.fillStyle = '#000000';
                const displayCode = code.startsWith('#') ? code : `#${code}`;
                finalCtx.fillText(displayCode, canvas.width / 2, currentY);
                currentY += 32; // Увеличено для лучшего отображения
              }
              
              // Рисуем название СНИЗУ QR кода (с переносом строки) - увеличиваем размер шрифта
              if (title) {
                finalCtx.font = 'bold 22px Arial'; // Увеличено до 22px для четкости
                finalCtx.fillStyle = '#000000';
                
                // Разбиваем title на строки если не помещается
                const maxWidth = tarazQRSize;
                const words = title.split(' ');
                let lines: string[] = [];
                let currentLine = '';
                
                for (const word of words) {
                  const testLine = currentLine ? `${currentLine} ${word}` : word;
                  const metrics = finalCtx.measureText(testLine);
                  
                  if (metrics.width > maxWidth && currentLine) {
                    lines.push(currentLine);
                    currentLine = word;
                    if (lines.length >= 2) break; // Максимум 2 строки
                  } else {
                    currentLine = testLine;
                  }
                }
                
                if (currentLine && lines.length < 2) {
                  lines.push(currentLine);
                }
                
                // Рисуем строки
                lines.forEach((line, idx) => {
                  finalCtx.fillText(line, canvas.width / 2, currentY + (idx * 26)); // Увеличено до 26px
                });
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

  const isShymkent = cityName === 'Шымкент';

  // Размер QR кода: для Шымкента 92%, для Тараза 92% (увеличено для четкости при печати)
  const displaySize = isShymkent ? Math.floor(size * 0.92) : Math.floor(size * 0.92);

  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm min-h-[200px] flex flex-col items-center justify-center">
        {isVisible ? (
          <QRCodeSVG
            id={`qr-svg-${code || 'default'}`}
            value={value}
            size={displaySize}
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

