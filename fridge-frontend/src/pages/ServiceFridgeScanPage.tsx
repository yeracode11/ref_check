import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../shared/apiClient';
import { useAuth } from '../contexts/AuthContext';
import {
  getDisplayIdentifier,
  getEquipmentIndicator,
  getEquipmentIndicatorClasses,
  getEquipmentIndicatorLabel,
  getEquipmentMarkerColor,
  EquipmentStatus,
} from '../utils/fridgeUtils';
import { Card, Button, Badge } from '../components/ui/Card';
import { LoadingSpinner } from '../components/ui/Loading';

type FridgeBrief = {
  _id: string;
  code: string;
  number?: string;
  name: string;
  address?: string;
  status?: EquipmentStatus;
  warehouseStatus?: string;
  brokenSince?: string | null;
  cityId?: { name: string } | null;
  clientInfo?: { inn?: string; name?: string } | null;
};

type RepairRow = {
  _id: string;
  repairDate: string;
  workType: string;
  replacedParts: string[];
  comment?: string;
  status: 'in_progress' | 'completed';
  completedAt?: string;
  isComplexRepair?: boolean;
  estimatedCostKzt?: number;
  technicianId?: { username?: string; fullName?: string };
};

type Props = {
  fridge: FridgeBrief;
};

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Almaty',
  });
}

function formatMoney(kzt: number) {
  return new Intl.NumberFormat('ru-RU').format(kzt) + ' ₸';
}

export default function ServiceFridgeScanPage({ fridge: initialFridge }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [fridge, setFridge] = useState(initialFridge);
  const [repairs, setRepairs] = useState<RepairRow[]>([]);
  const [summary, setSummary] = useState<{
    totalRepairCostKzt: number;
    complexRepairCount: number;
    activeRepair: RepairRow | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [repairForm, setRepairForm] = useState({
    workType: '',
    replacedParts: '',
    comment: '',
    completeImmediately: false,
  });

  const loadData = async () => {
    try {
      setLoading(true);
      const [fridgeRes, historyRes] = await Promise.all([
        api.get(`/api/fridges/${initialFridge._id}`),
        api.get(`/api/fridges/${initialFridge._id}/history`),
      ]);
      setFridge({ ...initialFridge, ...fridgeRes.data });
      setRepairs(historyRes.data?.data || []);
      setSummary(historyRes.data?.summary || null);
      if (historyRes.data?.fridge) {
        setFridge((prev) => ({ ...prev, ...historyRes.data.fridge }));
      }
      setError(null);
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [initialFridge._id]);

  const activeRepair = summary?.activeRepair || repairs.find((r) => r.status === 'in_progress') || null;
  const indicator = getEquipmentIndicator(fridge.status, activeRepair?.replacedParts);
  const indicatorLabel = getEquipmentIndicatorLabel(fridge.status, activeRepair?.replacedParts);
  const markerColor = getEquipmentMarkerColor(indicator);

  const displayId = getDisplayIdentifier(
    { clientInfo: fridge.clientInfo, number: fridge.number, code: fridge.code, name: fridge.name },
    fridge.cityId?.name,
  );

  const handleSaveRepair = async () => {
    if (!repairForm.workType.trim()) {
      alert('Укажите вид выполненных работ');
      return;
    }
    try {
      setSaving(true);
      const parts = repairForm.replacedParts.split(',').map((p) => p.trim()).filter(Boolean);
      await api.post('/api/repairs', {
        fridgeId: fridge._id,
        workType: repairForm.workType.trim(),
        replacedParts: parts,
        comment: repairForm.comment.trim() || undefined,
        completeImmediately: repairForm.completeImmediately,
      });
      setShowForm(false);
      setRepairForm({ workType: '', replacedParts: '', comment: '', completeImmediately: false });
      await loadData();
    } catch (e: any) {
      alert(e?.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCompleteRepair = async (repairId: string) => {
    try {
      setCompletingId(repairId);
      await api.patch(`/api/repairs/${repairId}/complete`);
      await loadData();
    } catch (e: any) {
      alert(e?.response?.data?.error || e.message);
    } finally {
      setCompletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto px-4 py-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Карточка оборудования (МХО)</h1>
        <p className="text-slate-500 mt-1 text-sm">Сканирование QR-кода · контроль ремонтов</p>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50 text-red-700 text-sm">{error}</Card>
      )}

      {/* Статус с цветовой индикацией */}
      <Card
        className={`border-2 border-l-[6px] ${
          indicator === 'purple'
            ? 'border-l-purple-600'
            : indicator === 'orange'
              ? 'border-l-orange-600'
              : 'border-l-blue-600'
        } ${getEquipmentIndicatorClasses(indicator)}`}
      >
        <div className="flex items-start gap-4">
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl shrink-0 border-2 border-white shadow"
            style={{ backgroundColor: markerColor }}
          >
            🧊
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-slate-900">{fridge.name}</h2>
            {displayId && (
              <p className="text-sm font-mono text-slate-600 mt-0.5">{displayId}</p>
            )}
            <div className="flex flex-wrap gap-2 mt-2">
              <Badge className={getEquipmentIndicatorClasses(indicator)}>{indicatorLabel}</Badge>
              {fridge.warehouseStatus === 'warehouse' && (
                <Badge className="bg-blue-100 text-blue-800">На складе</Badge>
              )}
            </div>
            {indicator === 'orange' && fridge.brokenSince && (
              <p className="text-xs text-orange-800 mt-2">
                Период сложного ремонта: с {formatDate(fridge.brokenSince)}
                {activeRepair?.completedAt
                  ? ` по ${formatDate(activeRepair.completedAt)}`
                  : activeRepair
                    ? ' — ремонт в работе'
                    : ''}
              </p>
            )}
            {indicator === 'purple' && fridge.brokenSince && (
              <p className="text-xs text-purple-800 mt-2">
                Поломка выявлена: {formatDate(fridge.brokenSince)}
              </p>
            )}
            {fridge.address && (
              <p className="text-sm text-slate-600 mt-2">📍 {fridge.address}</p>
            )}
          </div>
        </div>
        <div className="mt-4 pt-3 border-t border-slate-200/60 flex flex-wrap gap-4 text-xs text-slate-600">
          <span>🔵 Синий — исправен</span>
          <span>🟣 Фиолетовый — сломан (ТП)</span>
          <span>🟠 Оранжевый — сложный ремонт</span>
        </div>
      </Card>

      {/* Сводка */}
      {summary && (
        <div className="grid grid-cols-3 gap-3">
          <Card className="text-center py-3">
            <div className="text-2xl font-bold text-slate-900">{repairs.length}</div>
            <div className="text-xs text-slate-500">Ремонтов всего</div>
          </Card>
          <Card className="text-center py-3">
            <div className="text-2xl font-bold text-orange-600">{summary.complexRepairCount}</div>
            <div className="text-xs text-slate-500">Сложных</div>
          </Card>
          <Card className="text-center py-3">
            <div className="text-lg font-bold text-slate-900">{formatMoney(summary.totalRepairCostKzt)}</div>
            <div className="text-xs text-slate-500">Оценка затрат</div>
          </Card>
        </div>
      )}

      {/* История ремонтов */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-900">История ремонтов и заменённых деталей</h3>
          <Button type="button" onClick={() => setShowForm(!showForm)} className="text-sm">
            {showForm ? 'Отмена' : '+ Записать ремонт'}
          </Button>
        </div>

        {showForm && (
          <div className="mb-6 p-4 bg-orange-50 border border-orange-200 rounded-lg space-y-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Вид выполненных работ *</label>
              <input
                type="text"
                value={repairForm.workType}
                onChange={(e) => setRepairForm({ ...repairForm, workType: e.target.value })}
                placeholder="Замена компрессора, диагностика..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Перечень заменённых деталей</label>
              <input
                type="text"
                value={repairForm.replacedParts}
                onChange={(e) => setRepairForm({ ...repairForm, replacedParts: e.target.value })}
                placeholder="компрессор, мотор вентилятора, дверь (через запятую)"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Комментарии по ремонту</label>
              <textarea
                value={repairForm.comment}
                onChange={(e) => setRepairForm({ ...repairForm, comment: e.target.value })}
                rows={2}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm resize-none"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={repairForm.completeImmediately}
                onChange={(e) => setRepairForm({ ...repairForm, completeImmediately: e.target.checked })}
              />
              Ремонт завершён
            </label>
            <Button type="button" disabled={saving} onClick={handleSaveRepair}>
              {saving ? 'Сохранение...' : 'Сохранить запись'}
            </Button>
          </div>
        )}

        {repairs.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-8">Записей о ремонтах пока нет</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b">
                  <th className="py-2 pr-3">Дата</th>
                  <th className="py-2 pr-3">Вид работ</th>
                  <th className="py-2 pr-3">Запчасти</th>
                  <th className="py-2 pr-3">Сотрудник</th>
                  <th className="py-2 pr-3">Комментарий</th>
                  <th className="py-2">Затраты</th>
                </tr>
              </thead>
              <tbody>
                {repairs.map((r) => (
                  <tr key={r._id} className="border-b border-slate-100 align-top">
                    <td className="py-3 pr-3 whitespace-nowrap">
                      <div>{formatDate(r.repairDate)}</div>
                      <Badge className={`mt-1 text-xs ${r.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                        {r.status === 'completed' ? 'Завершён' : 'В работе'}
                      </Badge>
                      {r.isComplexRepair && (
                        <div className="text-xs text-orange-600 mt-1">Сложный</div>
                      )}
                    </td>
                    <td className="py-3 pr-3 font-medium">{r.workType}</td>
                    <td className="py-3 pr-3 text-slate-600">
                      {r.replacedParts?.length ? r.replacedParts.join(', ') : '—'}
                    </td>
                    <td className="py-3 pr-3">
                      {r.technicianId?.fullName || r.technicianId?.username || '—'}
                    </td>
                    <td className="py-3 pr-3 text-slate-500 italic max-w-[140px]">
                      {r.comment || '—'}
                    </td>
                    <td className="py-3">
                      <div>{r.estimatedCostKzt ? formatMoney(r.estimatedCostKzt) : '—'}</div>
                      {r.status === 'in_progress' && (
                        <button
                          type="button"
                          disabled={completingId === r._id}
                          onClick={() => handleCompleteRepair(r._id)}
                          className="mt-1 text-xs text-green-700 hover:underline disabled:opacity-50"
                        >
                          {completingId === r._id ? '...' : 'Завершить'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="flex gap-3">
        <Button type="button" variant="secondary" onClick={() => navigate('/fridges')} className="flex-1">
          К списку холодильников
        </Button>
      </div>

      <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-500">
        МХО: {user?.fullName || user?.username}
        {fridge.cityId?.name && ` · ${fridge.cityId.name}`}
      </div>
    </div>
  );
}
