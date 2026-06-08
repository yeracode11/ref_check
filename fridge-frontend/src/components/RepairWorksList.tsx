import { getMxoWorkLabels } from '../constants/mxoRepairWorks';

type Props = {
  completedWorks?: string[];
  replacedParts?: string[];
  workType?: string;
  compact?: boolean;
};

export function RepairWorksList({ completedWorks, replacedParts, workType, compact }: Props) {
  const labels = getMxoWorkLabels(completedWorks);
  const items = labels.length ? labels : (replacedParts?.length ? replacedParts : []);

  if (items.length > 0) {
    return (
      <ul className={`${compact ? 'text-xs' : 'text-sm'} text-slate-600 mt-2 space-y-1`}>
        {items.map((label) => (
          <li key={label} className="flex items-start gap-1.5">
            <span className="text-green-600 shrink-0">✓</span>
            <span>{label}</span>
          </li>
        ))}
      </ul>
    );
  }

  if (workType) {
    return <p className={`${compact ? 'text-xs' : 'text-sm'} text-slate-600 mt-2`}>{workType}</p>;
  }

  return null;
}
