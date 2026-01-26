/**
 * Утилиты для работы с холодильниками
 */

/**
 * Извлекает номер из названия холодильника
 * Ищет длинные последовательности цифр (10+ цифр), которые могут быть номерами
 * @param name - название холодильника
 * @returns номер или null, если не найден
 */
export function extractNumberFromName(name: string): string | null {
  if (!name) return null;
  
  // Ищем последовательности из 10+ цифр подряд
  // Это может быть номер типа "025211025046" (12 цифр)
  const numberPattern = /\d{10,}/g;
  const matches = name.match(numberPattern);
  
  if (matches && matches.length > 0) {
    // Возвращаем первый найденный длинный номер
    return matches[0];
  }
  
  return null;
}

/**
 * Получает отображаемый идентификатор холодильника
 * Приоритет: ИНН > number > извлеченный из названия номер > code
 * @param fridge - объект холодильника
 * @param cityName - название города
 * @returns идентификатор для отображения или null
 */
export function getDisplayIdentifier(
  fridge: { 
    clientInfo?: { inn?: string } | null;
    number?: string | null;
    code?: string;
    name?: string;
  },
  cityName?: string | null
): string | null {
  // 1. Если есть ИНН клиента (ручное создание) → используем ИНН для всех городов
  if (fridge.clientInfo?.inn) {
    return fridge.clientInfo.inn;
  }
  
  // 2. Если есть number (импорт из Excel) → используем number
  if (fridge.number) {
    return fridge.number;
  }
  
  // 3. Для Кызылорды: если нет number, пытаемся извлечь номер из названия
  if (cityName === 'Кызылорда' && fridge.name) {
    const extractedNumber = extractNumberFromName(fridge.name);
    if (extractedNumber) {
      return extractedNumber;
    }
    // Если не нашли номер в названии, возвращаем null (не показываем code)
    return null;
  }
  
  // 4. Для остальных городов используем code
  return fridge.code || null;
}
