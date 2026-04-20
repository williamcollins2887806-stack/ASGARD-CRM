import { Briefcase } from 'lucide-react';

export default function FieldMyWorks() {
  return (
    <div className="p-4">
      <div className="flex items-center gap-3 mb-4">
        <Briefcase size={24} style={{ color: 'var(--gold)' }} />
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
          Мои проекты
        </h1>
      </div>
      <div
        className="rounded-xl p-6 text-center"
        style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}
      >
        <p style={{ color: 'var(--text-secondary)' }}>Список проектов — скоро</p>
      </div>
    </div>
  );
}
