import { MXO_REPAIR_WORKS, MxoRepairWorkKey } from '../constants/mxoRepairWorks';

type Props = {
  selected: MxoRepairWorkKey[];
  onChange: (selected: MxoRepairWorkKey[]) => void;
  disabled?: boolean;
};

export function RepairWorkChecklist({ selected, onChange, disabled }: Props) {
  const toggle = (key: MxoRepairWorkKey) => {
    if (disabled) return;
    if (selected.includes(key)) {
      onChange(selected.filter((k) => k !== key));
    } else {
      onChange([...selected, key]);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-slate-700">
        Перечень выполненных работ <span className="text-red-500">*</span>
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1 border border-slate-200 rounded-lg p-3 bg-white">
        {MXO_REPAIR_WORKS.map((work) => {
          const checked = selected.includes(work.key);
          return (
            <label
              key={work.key}
              className={`flex items-start gap-2.5 text-sm rounded-md px-2 py-1.5 cursor-pointer transition-colors ${
                checked ? 'bg-orange-50 text-orange-950' : 'hover:bg-slate-50 text-slate-700'
              } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <input
                type="checkbox"
                className="mt-0.5 shrink-0 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
                checked={checked}
                disabled={disabled}
                onChange={() => toggle(work.key)}
              />
              <span className="leading-snug">{work.label}</span>
            </label>
          );
        })}
      </div>
      {selected.length > 0 && (
        <p className="text-xs text-slate-500">Выбрано работ: {selected.length}</p>
      )}
    </div>
  );
}
