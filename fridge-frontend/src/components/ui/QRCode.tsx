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

  // Ленивая, но максимально быстрая загрузка QR-кода:
  // рендерим SVG в следующий кадр после появления модального окна,
  // без лишних таймаутов, чтобы попап открывался мгновенно.
  useEffect(() => {
    const frameId = requestAnimationFrame(() => {
      setIsVisible(true);
    });
    return () => cancelAnimationFrame(frameId);
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
          // Определяем формат: для Шымкента, Астаны, Кызылорды и Талдыкоргана - новый формат (перенос строк, жирный текст), для остальных - старый
          const isShymkent = cityName === 'Шымкент' || cityName === 'Shymkent' || cityName === 'Астана' || cityName === 'Astana' || cityName === 'Кызылорда' || cityName === 'Талдыкорган';
          const isKyzylorda = cityName === 'Кызылорда';
          const isTaldykorgan = cityName === 'Талдыкорган';
          
          // Добавляем отступы
          const padding = 40;
          const textPadding = 20;
          
          let topTextHeight = 0;
          let bottomTextHeight = 0;
          const topPadding = 10;
          const bottomPadding = 10;
          // Параметры кода для старого формата (Тараз и др.)
          let tarazCodeLines: string[] = [];
          let tarazCodeFontSize = 24;
          let tarazCodeLineHeight = 30;
          
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
            // Новый формат для Шымкента, Кызылорды и Талдыкоргана: только длинный номер снизу (без кода с #)
            // Если номер не помещается, уменьшаем QR-код и размещаем номер внизу QR-кода
            // Для Кызылорды и Талдыкоргана используем меньший размер QR-кода (75%), для Шымкента 92%
            let shymkentQRSize = (isKyzylorda || isTaldykorgan)
              ? Math.floor(size * 0.75) // 75% от исходного размера для Кызылорды и Талдыкоргана
              : Math.floor(size * 0.92); // 92% от исходного размера для Шымкента
            let numberLines: string[] = [];
            let numberInsideQR = false; // Флаг: номер внутри QR-кода или снаружи
            
            // Для Кызылорды: если нет number, не показываем code (порядковый номер не нужен)
            // Для Шымкента и Талдыкоргана: используем number, если он передан, иначе code как fallback
            // Проверяем явно: если number !== undefined и !== null, используем его (даже если пустая строка)
            let displayNumber = '';
            if (isKyzylorda) {
              // Для Кызылорды показываем только number, если он есть
              displayNumber = (number !== undefined && number !== null) ? number : '';
            } else {
              // Для Шымкента и Талдыкоргана используем number, если есть, иначе code
              displayNumber = (number !== undefined && number !== null) ? number : (code || '');
            }
            
            if (displayNumber) {
              // Размер шрифта номера
              ctx.font = 'bold 14px Arial'; // Увеличено до 14px
              const maxWidth = shymkentQRSize;
              const chars = displayNumber.split('');
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
                    // Для Кызылорды и Талдыкоргана 60%, для Шымкента 80%
                    shymkentQRSize = (isKyzylorda || isTaldykorgan)
                      ? Math.floor(size * 0.60) // 60% от исходного размера для Кызылорды и Талдыкоргана
                      : Math.floor(size * 0.80); // 80% от исходного размера для Шымкента
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
            // Размер QR кода для Тараза 82% от исходного (чуть больше, чем у Талдыкоргана)
            const tarazQRSize = Math.floor(size * 0.82); // 82% от исходного размера
            
            if (code) {
              // Высота для кода: адаптивно уменьшаем шрифт, чтобы весь код влез (приоритет 2 строки)
              const displayCode = code.startsWith('#') ? code : `#${code}`;
              const maxWidth = tarazQRSize - 10;
              const chars = displayCode.split('');

              const splitToLines = (fontSize: number) => {
                ctx.font = `bold ${fontSize}px Arial`;
                const lines: string[] = [];
                let currentLine = '';
                for (const char of chars) {
                  const testLine = currentLine + char;
                  const metrics = ctx.measureText(testLine);
                  if (metrics.width > maxWidth && currentLine) {
                    lines.push(currentLine);
                    currentLine = char;
                  } else {
                    currentLine = testLine;
                  }
                }
                if (currentLine) lines.push(currentLine);
                return lines;
              };

              tarazCodeFontSize = 24;
              tarazCodeLines = splitToLines(tarazCodeFontSize);
              while (tarazCodeLines.length > 2 && tarazCodeFontSize > 12) {
                tarazCodeFontSize -= 1;
                tarazCodeLines = splitToLines(tarazCodeFontSize);
              }
              // Если даже при минимальном размере в 2 строки не влезло — разрешаем 3 строки
              if (tarazCodeLines.length > 3) {
                tarazCodeLines = [tarazCodeLines[0], tarazCodeLines[1], tarazCodeLines.slice(2).join('')];
              }

              tarazCodeLineHeight = tarazCodeFontSize + 6;
              bottomTextHeight += Math.max(tarazCodeLines.length, 1) * tarazCodeLineHeight + topPadding;
            }
            
            // Для Тараза добавляем название контрагента (title)
            const isTaraz = cityName === 'Тараз' || cityName === 'Taraz';
            if (isTaraz && title) {
              // Высота для названия - используем чуть больший жирный шрифт для названия
              ctx.font = 'bold 18px Arial'; // Увеличенный жирный шрифт для названия
              const maxWidth = tarazQRSize - 20; // Максимальная ширина с отступами
              const titleLines = [];
              const words = title.split(' ');
              let currentLine = '';
              
              for (const word of words) {
                const testLine = currentLine ? `${currentLine} ${word}` : word;
                const metrics = ctx.measureText(testLine);
                if (metrics.width > maxWidth && currentLine) {
                  titleLines.push(currentLine);
                  currentLine = word;
                  if (titleLines.length >= 2) break; // Максимум 2 строки для названия
                } else {
                  currentLine = testLine;
                }
              }
              if (currentLine && titleLines.length < 2) {
                titleLines.push(currentLine);
              }
              
              bottomTextHeight += titleLines.length * 20 + 10; // 20px между строками, 10px отступ сверху
            }
          }
          
          // Теперь устанавливаем финальные размеры canvas
          if (isShymkent) {
            // Используем размер, вычисленный выше (может быть уменьшен, если номер не помещается)
            // Пересчитываем для точности
            // Для Кызылорды и Талдыкоргана используем меньший размер QR-кода (75%), для Шымкента 92%
            let shymkentQRSize = (isKyzylorda || isTaldykorgan)
              ? Math.floor(size * 0.75) // 75% от исходного размера для Кызылорды и Талдыкоргана
              : Math.floor(size * 0.92); // 92% от исходного размера для Шымкента
            let numberInsideQR = false;
            // Для Кызылорды: если нет number, не показываем code (порядковый номер не нужен)
            // Для Шымкента и Талдыкоргана: используем number, если он передан, иначе code как fallback
            // Проверяем явно: если number !== undefined и !== null, используем его (даже если пустая строка)
            let displayNumber = '';
            if (isKyzylorda) {
              // Для Кызылорды показываем только number, если он есть
              displayNumber = (number !== undefined && number !== null) ? number : '';
            } else {
              // Для Шымкента и Талдыкоргана используем number, если есть, иначе code
              displayNumber = (number !== undefined && number !== null) ? number : (code || '');
            }
            if (displayNumber) {
              ctx.font = 'bold 14px Arial';
              const maxWidth = shymkentQRSize;
              const chars = displayNumber.split('');
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
                    // Для Кызылорды и Талдыкоргана 60%, для Шымкента 80%
                    shymkentQRSize = (isKyzylorda || isTaldykorgan)
                      ? Math.floor(size * 0.60) // 60% от исходного размера для Кызылорды и Талдыкоргана
                      : Math.floor(size * 0.80); // 80% от исходного размера для Шымкента
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
            // Для Тараза - QR код + текст снизу
            const tarazQRSize = Math.floor(size * 0.82); // 82% от исходного размера
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
              // Новый формат для Шымкента, Кызылорды и Талдыкоргана: только длинный номер снизу (без кода с #)
              // Для Кызылорды и Талдыкоргана используем меньший размер QR-кода (75%), для Шымкента 92%
              let shymkentQRSize = (isKyzylorda || isTaldykorgan)
                ? Math.floor(size * 0.75) // 75% от исходного размера для Кызылорды и Талдыкоргана
                : Math.floor(size * 0.92); // 92% от исходного размера для Шымкента
              let numberLines: string[] = [];
              let numberInsideQR = false;
              
              // Для Шымкента используем number, если он передан (даже если пустой), иначе code как fallback
              // Проверяем явно: если number !== undefined и !== null, используем его (даже если пустая строка)
              // Иначе используем code
              const displayNumber = (number !== undefined && number !== null) ? number : (code || '');
              
              // Определяем, нужно ли уменьшать QR-код
              if (displayNumber) {
                finalCtx.font = 'bold 14px Arial'; // Увеличено до 14px
                const maxWidth = shymkentQRSize;
                const chars = displayNumber.split('');
                let currentLine = '';
                
                for (const char of chars) {
                  const testLine = currentLine + char;
                  const metrics = finalCtx.measureText(testLine);
                  
                  if (metrics.width > maxWidth && currentLine) {
                    numberLines.push(currentLine);
                    currentLine = char;
                    if (numberLines.length >= 2) {
                      // Уменьшаем QR-код и размещаем номер внутри
                      // Для Кызылорды и Талдыкоргана 60%, для Шымкента 80%
                      shymkentQRSize = (isKyzylorda || isTaldykorgan)
                        ? Math.floor(size * 0.60) // 60% от исходного размера для Кызылорды и Талдыкоргана
                        : Math.floor(size * 0.80); // 80% от исходного размера для Шымкента
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
                if (displayNumber && numberLines.length > 0) {
                  finalCtx.font = 'bold 14px Arial';
                  finalCtx.fillStyle = '#000000';
                  numberLines.forEach((line, idx) => {
                    finalCtx.fillText(line, canvas.width / 2, currentY + (idx * 18));
                  });
                }
              }
            } else {
              // Старый формат для остальных городов (Тараз и др.)
              // Размер QR кода для Тараза 82% от исходного (чуть больше, чем у Талдыкоргана)
              const tarazQRSize = Math.floor(size * 0.82); // 82% от исходного размера
              const qrX = (canvas.width - tarazQRSize) / 2;
              
              // Включаем сглаживание для лучшего качества при печати
              finalCtx.imageSmoothingEnabled = true;
              finalCtx.imageSmoothingQuality = 'high';
              
              // Рисуем QR-код (увеличен)
              finalCtx.drawImage(img, qrX, currentY, tarazQRSize, tarazQRSize);
              currentY += tarazQRSize + bottomPadding;
              
              // Рисуем код снизу QR: длинные коды переносим на 2 строки
              if (code) {
                finalCtx.font = `bold ${tarazCodeFontSize}px Arial`;
                finalCtx.fillStyle = '#000000';
                tarazCodeLines.forEach((line, idx) => {
                  finalCtx.fillText(line, canvas.width / 2, currentY + (idx * tarazCodeLineHeight));
                });
                currentY += Math.max(tarazCodeLines.length, 1) * tarazCodeLineHeight;
              }
              
              // Для Тараза добавляем название контрагента (title)
              const isTaraz = cityName === 'Тараз' || cityName === 'Taraz';
              if (isTaraz && title) {
                finalCtx.font = 'bold 18px Arial'; // Увеличенный жирный шрифт для названия
                finalCtx.fillStyle = '#000000';
                const maxWidth = tarazQRSize - 20; // Максимальная ширина с отступами
                const titleLines = [];
                const words = title.split(' ');
                let currentLine = '';
                
                for (const word of words) {
                  const testLine = currentLine ? `${currentLine} ${word}` : word;
                  const metrics = finalCtx.measureText(testLine);
                  if (metrics.width > maxWidth && currentLine) {
                    titleLines.push(currentLine);
                    currentLine = word;
                    if (titleLines.length >= 2) break; // Максимум 2 строки для названия
                  } else {
                    currentLine = testLine;
                  }
                }
                if (currentLine && titleLines.length < 2) {
                  titleLines.push(currentLine);
                }
                
                // Рисуем название под кодом
                titleLines.forEach((line, idx) => {
                  finalCtx.fillText(line, canvas.width / 2, currentY + (idx * 20));
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

  const isShymkent = cityName === 'Шымкент' || cityName === 'Shymkent' || cityName === 'Астана' || cityName === 'Astana' || cityName === 'Кызылорда' || cityName === 'Талдыкорган';
  const isKyzylorda = cityName === 'Кызылорда';
  const isTaldykorgan = cityName === 'Талдыкорган';

  // Размер QR кода: для Кызылорды и Талдыкоргана 75%, для Шымкента/Астаны 92%, для остальных 92%
  const displaySize = (isKyzylorda || isTaldykorgan)
    ? Math.floor(size * 0.75) // 75% для Кызылорды и Талдыкоргана
    : (isShymkent ? Math.floor(size * 0.92) : Math.floor(size * 0.92)); // 92% для Шымкента и остальных

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

