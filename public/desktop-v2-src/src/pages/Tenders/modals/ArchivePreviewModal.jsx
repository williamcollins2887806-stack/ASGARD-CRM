/**
 * ArchivePreviewModal — выбор файлов из тендерного архива перед прикреплением.
 *
 * D-60 в `tests/reports/_DIFF-LEDGER.md`:
 *   Источник — vanilla `tenders.js:2178 showArchivePreview(tId, data)`.
 *   После `/api/tenders/:id/upload-archive` сервер распаковал архив; нужно показать
 *   список файлов с чекбоксами, junk-файлы (Thumbs.db / .DS_Store / __MACOSX и т.п.)
 *   серой строкой по умолчанию НЕ выбраны. Пользователь подтверждает выбор.
 *
 * Props:
 *   tenderId       — id тендера (для эндпоинтов).
 *   onSelect(idx)  — callback с массивом выбранных indices (Promise — родитель
 *                    решает что делать дальше). Возвращает Promise<void>.
 *
 * Endpoints (по плану D-60):
 *   GET  /api/tenders/:id/archive-files  → [{index, name, size, isJunk}, ...]
 *   POST /api/tenders/:id/select-files   body { selected_indices: number[] }
 *
 * Цвета — через токены темы (`--border`, `--inner-bg`, `--text-muted`, `--gold`,
 * `--err`). color-gate соблюдён.
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/api/client';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';

function formatSize(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return '0 Б';
  if (x < 1024) return x + ' Б';
  if (x < 1024 * 1024) return (x / 1024).toFixed(1) + ' КБ';
  return (x / 1024 / 1024).toFixed(1) + ' МБ';
}

// Список файлов: сначала «не-junk», потом junk; внутри — по имени (ru locale)
// — паритет с vanilla 2184-2187.
function sortFiles(files) {
  return [...files].sort((a, b) => {
    if (!!a.isJunk !== !!b.isJunk) return a.isJunk ? 1 : -1;
    return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
  });
}

export function ArchivePreviewModal({ tenderId, onSelect }) {
  const { close } = useModal();
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  // Map<index, boolean> — отметка выбран ли файл.
  const [picked, setPicked] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api(`/api/tenders/${tenderId}/archive-files`)
      .then((d) => {
        if (cancelled) return;
        const list = Array.isArray(d) ? d : (d?.files || d?.items || []);
        const sorted = sortFiles(list);
        // По умолчанию: junk → unchecked, остальные → checked.
        const init = {};
        for (const f of sorted) init[f.index] = !f.isJunk;
        setFiles(sorted);
        setPicked(init);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.serverMsg || e?.message || 'Не удалось загрузить список файлов');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tenderId]);

  const totalCount = files.length;
  const nonJunkCount = useMemo(() => files.filter((f) => !f.isJunk).length, [files]);
  const checkedCount = useMemo(
    () => files.reduce((acc, f) => acc + (picked[f.index] ? 1 : 0), 0),
    [files, picked]
  );

  // Select-all toggle — включает ТОЛЬКО не-junk (по требованию задачи).
  // Тогл считаем по тому, выбраны ли все не-junk сейчас.
  const allNonJunkChecked =
    nonJunkCount > 0 &&
    files.every((f) => f.isJunk || picked[f.index]);

  const toggleSelectAll = () => {
    setPicked((prev) => {
      const next = { ...prev };
      if (allNonJunkChecked) {
        // Снять выбор со всех не-junk
        for (const f of files) if (!f.isJunk) next[f.index] = false;
      } else {
        // Включить все не-junk (junk остаются как были — обычно unchecked)
        for (const f of files) if (!f.isJunk) next[f.index] = true;
      }
      return next;
    });
  };

  const togglePick = (index) => {
    setPicked((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const handleSubmit = async () => {
    const selected = files
      .filter((f) => picked[f.index])
      .map((f) => f.index);
    if (selected.length === 0) {
      toast('Архив', 'Не выбрано ни одного файла', 'warn');
      return;
    }
    setBusy(true);
    try {
      if (typeof onSelect === 'function') {
        // Родитель решает: вызовет POST /api/tenders/:id/select-files сам
        // (или мы дергаем дефолт ниже, если onSelect не передан).
        await onSelect(selected);
      } else {
        await api(`/api/tenders/${tenderId}/select-files`, {
          method: 'POST',
          body: { selected_indices: selected }
        });
        toast('Архив', `Прикреплено: ${selected.length}`, 'ok');
      }
      close();
    } catch (e) {
      toast('Архив', String(e?.serverMsg || e?.message || e), 'err');
      setBusy(false);
    }
  };

  return (
    <MCard className="frame-inside">
      <MHead
        icon="📋"
        title="Содержимое архива"
        subtitle="Выберите файлы для прикрепления"
        accent="gold"
        onClose={close}
      />
      <MBody>
        {loading && (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
            Загружаем список файлов…
          </div>
        )}

        {!loading && error && (
          <div
            role="alert"
            style={{
              padding: '14px 16px',
              background: 'var(--inner-bg)',
              border: '1px solid var(--border)',
              borderLeft: '4px solid var(--err)',
              borderRadius: 8,
              color: 'var(--err)',
              fontSize: 14
            }}
          >
            <span aria-hidden="true">⚠ </span>{error}
          </div>
        )}

        {!loading && !error && files.length === 0 && (
          <div
            style={{
              padding: '24px 16px',
              textAlign: 'center',
              background: 'var(--inner-bg)',
              border: '1px dashed var(--border)',
              borderRadius: 8,
              color: 'var(--text-muted)',
              fontSize: 14
            }}
          >
            Архив пустой — нечего прикреплять.
          </div>
        )}

        {!loading && !error && files.length > 0 && (
          <div className="col gap-10">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                background: 'var(--inner-bg)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                fontSize: 13
              }}
            >
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  cursor: 'pointer',
                  userSelect: 'none'
                }}
              >
                <input
                  type="checkbox"
                  checked={allNonJunkChecked}
                  onChange={toggleSelectAll}
                  aria-label="Выбрать все не-junk файлы"
                />
                <span>
                  {allNonJunkChecked ? 'Снять выбор' : 'Выбрать все'}{' '}
                  <span style={{ color: 'var(--text-muted)' }}>
                    (не-junk: {nonJunkCount})
                  </span>
                </span>
              </label>
              <div style={{ flex: 1 }} />
              <span style={{ color: 'var(--text-muted)' }}>
                Выбрано: <b style={{ color: 'var(--gold)' }}>{checkedCount}</b> из {totalCount}
              </span>
            </div>

            <div
              style={{
                border: '1px solid var(--border)',
                borderRadius: 8,
                maxHeight: '50vh',
                overflowY: 'auto'
              }}
              role="list"
            >
              {files.map((f, i) => {
                const checked = !!picked[f.index];
                return (
                  <label
                    key={f.index ?? i}
                    role="listitem"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 12px',
                      borderBottom: i === files.length - 1 ? 'none' : '1px solid var(--border)',
                      cursor: 'pointer',
                      opacity: f.isJunk ? 0.6 : 1,
                      background: f.isJunk ? 'var(--inner-bg)' : 'transparent'
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => togglePick(f.index)}
                      style={{ flexShrink: 0 }}
                      aria-label={`Выбрать файл ${f.name || ''}`}
                    />
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 13,
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        color: f.isJunk ? 'var(--text-muted)' : 'inherit'
                      }}
                      title={f.name}
                    >
                      {f.name || `[файл #${f.index}]`}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: 'var(--text-muted)',
                        flexShrink: 0
                      }}
                    >
                      {formatSize(f.size)}
                    </span>
                    {f.isJunk && (
                      <span
                        title="Системный файл / мусор (Thumbs.db, .DS_Store и т.п.)"
                        style={{
                          fontSize: 10,
                          color: 'var(--text-muted)',
                          background: 'var(--inner-bg)',
                          border: '1px solid var(--border)',
                          padding: '1px 6px',
                          borderRadius: 4,
                          flexShrink: 0,
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em'
                        }}
                      >
                        junk
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close} disabled={busy}>Отмена</Btn>
        <Btn
          variant="primary"
          disabled={busy || loading || !!error || checkedCount === 0}
          onClick={handleSubmit}
        >
          {busy ? 'Загружаю…' : `Загрузить выбранные (${checkedCount})`}
        </Btn>
      </MFoot>
    </MCard>
  );
}

export default ArchivePreviewModal;
