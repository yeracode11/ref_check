export type MxoRepairWorkKey =
  | 'led_lamp'
  | 'fan_motor_replace'
  | 'fan_motor_service'
  | 'condenser_clean'
  | 'electric_motor_replace'
  | 'restickering'
  | 'compressor_replace'
  | 'thermostat_replace'
  | 'refrigerant_leak'
  | 'evaporator_condenser'
  | 'wiring_repair'
  | 'power_cord'
  | 'microcontroller'
  | 'buttons_replace'
  | 'door_adjust'
  | 'door_replace'
  | 'door_handles'
  | 'painting';

export type MxoRepairWork = {
  key: MxoRepairWorkKey;
  label: string;
};

/** Перечень работ МХО — ремонтник холодильного оборудования (не ТП) */
export const MXO_REPAIR_WORKS: MxoRepairWork[] = [
  { key: 'led_lamp', label: 'Замена лампы лед 30/120' },
  { key: 'fan_motor_replace', label: 'Замена фан мотора' },
  { key: 'fan_motor_service', label: 'Чистка смазка фан мотора' },
  { key: 'condenser_clean', label: 'Чистка мойка конденсатора EXTRA LARGE/LARGE' },
  { key: 'electric_motor_replace', label: 'Замена Электродвигателя' },
  { key: 'restickering', label: 'Переклейка' },
  { key: 'compressor_replace', label: 'Замена компрессора' },
  { key: 'thermostat_replace', label: 'Замена Термостата' },
  { key: 'refrigerant_leak', label: 'Устроение утечки хладагента /забитый фильтр' },
  { key: 'evaporator_condenser', label: 'Замена испарителя / конденсатора' },
  { key: 'wiring_repair', label: 'Ремонт электро проводки' },
  { key: 'power_cord', label: 'Замена сетевого шнура / вилки' },
  { key: 'microcontroller', label: 'Замена микро контроллера' },
  { key: 'buttons_replace', label: 'Замена кнопок , свет/ сеть .' },
  { key: 'door_adjust', label: 'Регулировка двери' },
  { key: 'door_replace', label: 'Замена двери' },
  { key: 'door_handles', label: 'Ремонт ручек двери' },
  { key: 'painting', label: 'Окраска ХО / полки' },
];

const LABEL_BY_KEY = Object.fromEntries(
  MXO_REPAIR_WORKS.map((w) => [w.key, w.label]),
) as Record<MxoRepairWorkKey, string>;

export function getMxoWorkLabels(keys?: string[] | null): string[] {
  if (!keys?.length) return [];
  return keys.map((k) => LABEL_BY_KEY[k as MxoRepairWorkKey]).filter(Boolean);
}

export function workTypeFromCompletedWorks(keys: string[]): string {
  return getMxoWorkLabels(keys).join('; ');
}
