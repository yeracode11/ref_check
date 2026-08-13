import { Badge } from './ui/Card';
import {
  getWarehouseStatusBadgeClass,
  getWarehouseStatusLabel,
} from '../utils/fridgeUtils';

type WarehouseStatusBadgeProps = {
  status?: string | null;
};

export function WarehouseStatusBadge({ status }: WarehouseStatusBadgeProps) {
  if (!status) return null;
  return (
    <Badge className={getWarehouseStatusBadgeClass(status)}>
      {getWarehouseStatusLabel(status)}
    </Badge>
  );
}
