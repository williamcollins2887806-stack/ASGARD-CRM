import { Clock } from 'lucide-react';

export default function FieldShift() {
  return (
    <div className="p-4">
      <div className="flex items-center gap-3 mb-4">
        <Clock size={24} style={{ color: 'var(--gold)' }} />
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
          Смена
        </h1>
      </div>
      <div
        className="rounded-xl p-6 text-center"
        style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}
      >
        <p style={{ color: 'var(--text-secondary)' }}>Текущая смена и таймер — скоро</p>
      </div>
    </div>
  );
}
