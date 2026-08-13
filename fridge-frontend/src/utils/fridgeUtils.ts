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

export type EquipmentStatus = 'working' | 'broken' | 'under_repair';
export type EquipmentIndicator = 'blue' | 'purple' | 'orange';

const COMPLEX_PART_KEYWORDS = [
  'компрессор',
  'compressor',
  'мотор вентилятора',
  'вентилятор',
  'fan motor',
  'дверь',
  'дверца',
  'door',
];

function isComplexRepairParts(parts?: string[] | null): boolean {
  if (!parts?.length) return false;
  return parts.some((part) => {
    const p = part.trim().toLowerCase();
    return COMPLEX_PART_KEYWORDS.some((kw) => p.includes(kw));
  });
}

const COMPLEX_MXO_WORK_KEYS = new Set([
  'compressor_replace',
  'fan_motor_replace',
  'door_replace',
]);

export function isComplexRepair(
  replacedParts?: string[] | null,
  completedWorks?: string[] | null,
): boolean {
  if (completedWorks?.some((k) => COMPLEX_MXO_WORK_KEYS.has(k))) return true;
  return isComplexRepairParts(replacedParts);
}

export function getEquipmentIndicator(
  status?: EquipmentStatus | null,
  replacedParts?: string[] | null,
  completedWorks?: string[] | null,
): EquipmentIndicator {
  if (status === 'broken') return 'purple';
  if (status === 'under_repair') {
    return isComplexRepair(replacedParts, completedWorks) ? 'orange' : 'blue';
  }
  return 'blue';
}

export function getEquipmentIndicatorLabel(
  status?: EquipmentStatus | null,
  replacedParts?: string[] | null,
  completedWorks?: string[] | null,
): string {
  if (status === 'broken') return 'Сломанный (отмечен ТП)';
  if (status === 'under_repair') {
    return isComplexRepair(replacedParts, completedWorks) ? 'Сложный ремонт' : 'На ремонте';
  }
  return 'Исправен';
}

export function getEquipmentStatusLabel(status?: EquipmentStatus | null): string {
  switch (status) {
    case 'broken':
      return 'Сломан';
    case 'under_repair':
      return 'На ремонте';
    case 'working':
    default:
      return 'Исправен';
  }
}

export function getEquipmentIndicatorClasses(indicator: EquipmentIndicator): string {
  switch (indicator) {
    case 'purple':
      return 'bg-purple-100 text-purple-800 border-purple-300';
    case 'orange':
      return 'bg-orange-100 text-orange-800 border-orange-300';
    case 'blue':
    default:
      return 'bg-blue-100 text-blue-800 border-blue-300';
  }
}

export function getEquipmentMarkerColor(indicator: EquipmentIndicator): string {
  switch (indicator) {
    case 'purple':
      return '#9333ea';
    case 'orange':
      return '#ea580c';
    case 'blue':
    default:
      return '#2563eb';
  }
}

export function showSeasonalClosureCheckbox(type?: string | null): boolean {
  return type === 'school' || type === 'restricted';
}

export type WarehouseStatus = 'warehouse' | 'installed' | 'returned' | 'moved';

export function getWarehouseStatusLabel(status?: WarehouseStatus | string | null): string {
  switch (status) {
    case 'warehouse':
      return 'На складе';
    case 'installed':
      return 'Установлен';
    case 'returned':
      return 'Возврат';
    case 'moved':
      return 'Перемещен';
    default:
      return status || 'Неизвестно';
  }
}

export function getWarehouseStatusBadgeClass(status?: WarehouseStatus | string | null): string {
  switch (status) {
    case 'warehouse':
      return 'bg-blue-100 text-blue-700';
    case 'installed':
      return 'bg-green-100 text-green-700';
    case 'returned':
      return 'bg-yellow-100 text-yellow-700';
    case 'moved':
      return 'bg-gray-900 text-white';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

export type WarehouseStatusTransition = {
  targetStatus: WarehouseStatus;
  actionLabel: string;
  modalTitle: string;
  confirmLabel: string;
  needsClientForm: boolean;
  confirmClassName: string;
};

/** Следующий статус склада и подписи для UI бухгалтера */
export function getWarehouseStatusTransition(
  current?: WarehouseStatus | string | null,
): WarehouseStatusTransition {
  switch (current) {
    case 'installed':
      return {
        targetStatus: 'returned',
        actionLabel: 'Возврат',
        modalTitle: 'Возврат на склад',
        confirmLabel: 'Вернуть на склад',
        needsClientForm: false,
        confirmClassName: 'bg-blue-600 hover:bg-blue-700',
      };
    case 'returned':
      return {
        targetStatus: 'warehouse',
        actionLabel: 'На склад',
        modalTitle: 'Принять на склад',
        confirmLabel: 'Принять на склад',
        needsClientForm: false,
        confirmClassName: 'bg-slate-600 hover:bg-slate-700',
      };
    case 'moved':
      return {
        targetStatus: 'installed',
        actionLabel: 'Установить',
        modalTitle: 'Установка после перемещения',
        confirmLabel: 'Установить',
        needsClientForm: true,
        confirmClassName: 'bg-green-600 hover:bg-green-700',
      };
    case 'warehouse':
    default:
      return {
        targetStatus: 'installed',
        actionLabel: 'Установить',
        modalTitle: 'Установка холодильника',
        confirmLabel: 'Установить',
        needsClientForm: true,
        confirmClassName: 'bg-green-600 hover:bg-green-700',
      };
  }
}
