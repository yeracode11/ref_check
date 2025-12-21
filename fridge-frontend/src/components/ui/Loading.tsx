import { memo, useMemo } from 'react';

export const LoadingSpinner = memo(function LoadingSpinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizes = useMemo(() => ({
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8',
  }), []);

  return (
    <div className={`${sizes[size]} animate-spin rounded-full border-2 border-slate-300 border-t-slate-900`} />
  );
});

export const LoadingCard = memo(function LoadingCard() {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 animate-pulse">
      <div className="space-y-3">
        <div className="h-4 bg-slate-200 rounded w-3/4"></div>
        <div className="h-4 bg-slate-200 rounded w-1/2"></div>
        <div className="h-4 bg-slate-200 rounded w-2/3"></div>
      </div>
    </div>
  );
});

type EmptyStateProps = {
  icon?: string;
  title?: string;
  description?: string;
  message?: string; // short alternative prop
};

export const EmptyState = memo(function EmptyState({ icon = '📭', title, description, message }: EmptyStateProps) {
  const displayTitle = useMemo(() => title || message || 'Пусто', [title, message]);
  const displayDescription = useMemo(() => description || '', [description]);

  return (
    <div className="text-center py-12">
      <div className="text-6xl mb-4">{icon}</div>
      <h3 className="text-lg font-semibold text-slate-900 mb-2">{displayTitle}</h3>
      {displayDescription && <p className="text-slate-500">{displayDescription}</p>}
    </div>
  );
});

