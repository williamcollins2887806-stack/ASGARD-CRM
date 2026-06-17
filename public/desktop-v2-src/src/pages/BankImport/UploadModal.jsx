/**
 * Модалка загрузки банковской выписки.
 * Реюз: FileDrop (drag&drop) + бэкенд `/bank/upload` парсит CSV/TXT/1C-exchange
 * + автоклассификация по правилам/AI.
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { FileDrop, SelectInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { uploadStatement } from './api';
import { validateFile, MAX_ATTACHMENT_SIZE } from '@/api/upload';

const FORMAT_OPTS = [
  { value: '',         label: 'Авто-определение' },
  { value: 'tinkoff',  label: 'Тинькофф (CSV)' },
  { value: 'sber',     label: 'Сбер (CSV)' },
  { value: 'tochka',   label: 'Точка (CSV)' },
  { value: '1c',       label: '1С Обмен (TXT)' },
  { value: 'generic',  label: 'Общий CSV' }
];

export default function UploadModal({ onDone }) {
  const { close } = useModal();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);
  const [format, setFormat] = useState('');

  const doUpload = async (files) => {
    const file = files?.[0];
    if (!file) return;
    // G-5: размер/тип выписки.
    try {
      validateFile(file, { maxSize: MAX_ATTACHMENT_SIZE, accept: '.csv,.txt' });
    } catch (vErr) {
      setErr(vErr?.message || 'Файл не подходит'); return;
    }
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const d = await uploadStatement(file, format || null);
      setResult(d);
      const auto = d.stats?.auto || 0;
      const manual = d.stats?.manual || 0;
      const dupes = d.stats?.duplicates || 0;
      if (manual > 0) {
        toast.warn(`Загружено ${d.stats?.new || 0} новых · ${manual} требуют ручной классификации`);
      } else {
        toast.success(`Загружено ${d.stats?.new || 0} новых · авто-классиф. ${auto}${dupes ? ` · дубли ${dupes}` : ''}`);
      }
    } catch (e) {
      setErr(e.message || 'Сетевая ошибка');
      toast.error('Не удалось обработать файл: ' + (e.message || ''));
    } finally {
      setBusy(false);
    }
  };

  const onClose = () => {
    if (result) onDone?.();
    close();
  };

  return (
    <MCard>
      <MHead
        icon="📥"
        title="Загрузить выписку"
        subtitle="CSV, TXT — 1С, Тинькофф, Сбер, Точка, общий формат"
        onClose={onClose}
      />
      <MBody>
        {result ? (
          <div className="bi-result">
            <div className="bi-result-h">✅ Загружено! Формат: <b>{result.format || '—'}</b></div>
            <div className="bi-result-grid">
              <div><span className="lbl">Всего строк</span><span className="val">{result.stats?.total ?? 0}</span></div>
              <div><span className="lbl">Новых</span><span className="val c-ok">{result.stats?.new ?? 0}</span></div>
              <div><span className="lbl">Дубликатов</span><span className="val c-err">{result.stats?.duplicates ?? 0}</span></div>
              <div><span className="lbl">Авто-классиф.</span><span className="val c-blue">{result.stats?.auto ?? 0}</span></div>
              <div><span className="lbl">Требуют разноски</span><span className="val c-amber">{result.stats?.manual ?? 0}</span></div>
              <div><span className="lbl">Пачка #</span><span className="val">{result.batch_id ?? '—'}</span></div>
            </div>
            <div className="bi-result-hint">
              Перейдите на вкладку «Транзакции» — там можно подтвердить классификацию и распределить по работам.
            </div>
          </div>
        ) : (
          <>
            <div className="mb-12">
              <label className="bi-label">Формат выписки</label>
              <SelectInput
                value={format}
                onChange={setFormat}
                options={FORMAT_OPTS}
                placeholder="Авто-определение"
                disabled={busy}
              />
            </div>
            <FileDrop
              accept=".csv,.txt"
              hint={busy ? 'Обработка файла…' : 'Перетащите CSV/TXT или нажмите'}
              onFiles={doUpload}
            />
            <div className="bi-upload-help">
              Файл парсится на сервере: автоматически определяется банк, проверяются дубликаты по хешу,
              применяются правила классификации. AI-классификация массовая — через bulk-classify.
            </div>
          </>
        )}
        {err && <div className="bi-err mt-12">⚠ {err}</div>}
      </MBody>
      <MFoot>
        <Btn variant="primary" onClick={onClose}>{result ? 'Готово' : 'Закрыть'}</Btn>
      </MFoot>
    </MCard>
  );
}
