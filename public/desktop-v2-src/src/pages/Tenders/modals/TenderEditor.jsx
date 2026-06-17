/**
 * TenderEditor — wizard создания/редактирования тендера.
 * Источник: vanilla `openTenderEditor` в tenders.js (~2100 строк).
 *
 * 3 шага:
 *   1. Основное — заказчик (ДаДата), тип, сроки
 *   2. Условия — цена, тег, комментарий
 *   3. Документы — FileDrop с превью
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { api } from '@/api/client';
import { WizardModal } from '@/modals/Wizard';
import { ConfirmModal } from '@/modals/Confirm';
import { useModal } from '@/modals/ModalProvider';
import { toast } from '@/modals/Notifications';
import { useAuth } from '@/api/useAuth';
import { Btn } from '@/modals/parts';
import {
  Field, TextInput, SelectInput, MoneyInput,
  INNInput, TextareaInput, DatePicker, Combobox, FileDrop
} from '@/inputs/Inputs';
import { innError, percentError, positiveAmountError } from '@/inputs/validators';
import {
  TENDER_TYPES, loadTags,
  findTenderDuplicates, updateCustomerScore
} from '../api';
import { CustomerQuickCreateModal } from './CustomerQuickCreateModal';
import CommentsTab from './CommentsTab';

/* D-50: zip-распаковка на клиенте.
   Если пользователь добавил .zip — раскрываем его через JSZip и подмешиваем
   реальные File-объекты в state.documents. Каждый файл потом загрузится отдельно
   через обычный /api/files/upload (вместо непредсказуемой серверной распаковки).
   Лимиты: пропускаем папки, симлинки, нулевые файлы. Уведомляем пользователя. */
const ZIP_RX = /\.zip$/i;

async function expandZipFile(zipFile) {
  // Динамический импорт — jszip ~95KB, ленивая загрузка не утяжеляет initial bundle.
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(zipFile);
  const out = [];
  const entries = Object.values(zip.files);
  for (const entry of entries) {
    if (entry.dir) continue;
    // Имя без пути (как пользователь увидит)
    const baseName = entry.name.split('/').pop() || entry.name;
    if (!baseName || baseName.startsWith('.')) continue; // .DS_Store и пр.
    try {
      const blob = await entry.async('blob');
      if (!blob || blob.size === 0) continue;
      const file = new File([blob], baseName, {
        type: blob.type || 'application/octet-stream',
        lastModified: entry.date ? entry.date.getTime() : Date.now()
      });
      out.push({ name: file.name, size: file.size, type: file.type, file });
    } catch {
      // Битый entry — пропускаем, не валим весь zip
    }
  }
  return out;
}

/* ─── LS-черновик (vanilla tenders.js:120-202 saveDraft/loadDraft) ──────────
   Раздельный ключ под роль + userId — чтобы РП А не получил черновик РП Б
   на общем рабочем месте. TTL — 24 часа (vanilla — 7 дней, но для wizard'а
   24ч достаточно: дольше — это уже не «незавершённый», а «забытый»).
   Сохраняется только для НОВОГО тендера (не для редактирования). */
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

function draftKey(user) {
  const uid = user?.id || 'anon';
  const role = user?.role || 'any';
  return `tender_draft_${role}_${uid}`;
}

function loadDraftFromLS(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !obj.updatedAt) return null;
    const age = Date.now() - new Date(obj.updatedAt).getTime();
    if (!Number.isFinite(age) || age > DRAFT_TTL_MS) {
      try { localStorage.removeItem(key); } catch { /* noop */ }
      return null;
    }
    return obj;
  } catch { return null; }
}

function saveDraftToLS(key, state) {
  try {
    // Не сохраняем File-объекты — они не сериализуются. Только метаданные.
    const safe = { ...state };
    if (Array.isArray(safe.documents)) {
      safe.documents = safe.documents
        .filter((d) => !(d?.file instanceof File))  // выкидываем не-сохранённые файлы
        .map((d) => ({ ...d, file: undefined }));
    }
    localStorage.setItem(key, JSON.stringify({ ...safe, updatedAt: new Date().toISOString() }));
  } catch { /* quota / private mode — игнор */ }
}

function clearDraftLS(key) {
  try { localStorage.removeItem(key); } catch { /* noop */ }
}

/* Снимок полей, по которому решаем «есть ли изменения» (vanilla tenders.js:154) */
function isFormDirty(state, base) {
  const keys = [
    'customer_name', 'inn', 'kpp', 'address',
    'tender_type', 'tender_name', 'deadline_at',
    'tender_price', 'tender_price_with_vat', 'vat_pct',
    'tag', 'comment',
    'period_month', 'period_year'
  ];
  for (const k of keys) {
    const a = state?.[k] == null ? '' : String(state[k]);
    const b = base?.[k] == null ? '' : String(base[k]);
    if (a !== b) return true;
  }
  if ((state?.documents || []).some((d) => d?.file instanceof File)) return true;
  return false;
}

function lookupCompanies(query) {
  if (!query || query.length < 3) return Promise.resolve([]);
  const q = encodeURIComponent(query);
  // Цифровой ввод (ИНН) → точный lookup по ИНН.
  // Буквенный ввод → suggest по названию из ДаДата (vanilla tenders.js:2691,2707).
  const isDigits = /^\d+$/.test(query);
  const url = isDigits
    ? '/api/customers/lookup/' + q
    : '/api/customers/suggest?q=' + q + '&type=party';
  return api(url)
    .then((d) => {
      const list = d.suggestions || d.items || d.companies || (d.suggestion ? [d.suggestion] : []);
      return list.map((c) => ({
        value: c.inn || c.id || c.name,
        label: `${c.name || c.value}${c.inn ? ' · ' + c.inn : ''}`,
        raw: c
      }));
    })
    .catch(() => []);
}

// vanilla tenders.js:23-37 — формирует ссылку на скачивание уже загруженного документа.
// Backend: /api/files/download/:filename (files.js:203). Используется для существующих документов
// при редактировании тендера (когда у позиции нет .file, а есть filename/attachment_path/file_url).
function buildDocumentLink(doc) {
  if (!doc || typeof doc !== 'object') return '';
  const norm = (v) => {
    const r = String(v || '').trim();
    if (!r) return '';
    const l = r.toLowerCase();
    if (l === 'undefined' || l === 'null' || r === '#') return '';
    return r;
  };
  const direct = norm(doc.download_url) || norm(doc.file_url);
  if (direct) return direct;
  const ap = norm(doc.attachment_path || doc.file_path);
  if (ap) {
    if (/^(https?:|data:|blob:|\/)/i.test(ap)) return ap;
    const uIdx = ap.indexOf('uploads/');
    if (uIdx >= 0) return '/' + ap.slice(uIdx);
    const fn = ap.split('/').pop();
    return fn ? `/api/files/download/${encodeURIComponent(fn)}` : '';
  }
  const filename = norm(doc.filename);
  return filename ? `/api/files/download/${encodeURIComponent(filename)}` : '';
}

// Опции месяцев/лет периода (vanilla tenders.js:2407-2410)
const MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const MONTH_OPTS = MONTH_NAMES.map((n, i) => ({ value: String(i + 1).padStart(2, '0'), label: n }));
function yearOpts() {
  const cur = new Date().getFullYear();
  const out = [];
  for (let y = 2024; y <= cur + 2; y++) out.push({ value: String(y), label: String(y) });
  return out;
}
function ymNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function TenderEditorInner({ initial, tags, onFinish, isNew, lsKey, openCreateCustomer, setStateRef }) {
  const modal = useModal();
  const [companyOptions, setCompanyOptions] = useState([]);
  const [tagOptions, setTagOptions] = useState(tags.map((t) => ({ value: t.name || t, label: t.name || t })));
  // baseInitial = снимок с которого считаем «грязно» (для prompt-on-close).
  const baseInitialRef = useRef(initial);
  // Последний сохранённый snapshot — для onStateChange (autosave каждые 10 с).
  const lastStateRef = useRef(initial);

  useEffect(() => {
    setTagOptions(tags.map((t) => ({ value: t.name || t, label: t.name || t })));
  }, [tags]);

  // ── Autosave черновика — раз в 10 секунд (vanilla tenders.js: setInterval). ──
  // Сохраняем только для НОВОГО тендера (isNew) — редактирование уже есть на сервере.
  useEffect(() => {
    if (!isNew || !lsKey) return;
    const id = setInterval(() => {
      const s = lastStateRef.current;
      if (s && isFormDirty(s, baseInitialRef.current)) {
        saveDraftToLS(lsKey, s);
      }
    }, 10000);
    return () => clearInterval(id);
  }, [isNew, lsKey]);

  const YEAR_OPTS = useMemo(() => yearOpts(), []);

  const steps = [
    {
      key: 'main',
      title: 'Основное',
      canNext: (s) => s.customer_name?.trim() && s.tender_type,
      render: (s, setS) => (
        <div className="col gap-14">
          <Field label="Заказчик" required help="Начни вводить название или ИНН — подскажем из ДаДата">
            <Combobox
              value={s.customer_name || ''}
              onChange={(v, opt) => {
                if (opt?.raw) {
                  setS({
                    ...s,
                    customer_name: opt.raw.name || opt.label?.split(' · ')[0] || v,
                    inn: opt.raw.inn || s.inn || '',
                    kpp: opt.raw.kpp || s.kpp || '',
                    address: opt.raw.address || s.address || ''
                  });
                } else {
                  setS({ ...s, customer_name: v });
                }
              }}
              options={companyOptions}
              placeholder="ООО «Ромашка»"
              onQuery={async (q) => {
                const opts = await lookupCompanies(q);
                setCompanyOptions(opts);
              }}
              allowFreeText
            />
            {/* Создание контрагента inline (vanilla tenders.js:2943 promptCreateCustomer).
                Показываем кнопку если набрано хотя бы 3 символа, а в options пусто
                ИЛИ выбран только free-text без ИНН. */}
            {(s.customer_name || '').trim().length >= 3 && !s.inn?.trim() && (
              <div style={{ marginTop: 6 }}>
                <Btn
                  variant="ghost"
                  size="sm"
                  onClick={() => openCreateCustomer({
                    name: s.customer_name,
                    inn: s.inn,
                    kpp: s.kpp,
                    address: s.address
                  })}
                  title="Создать карточку контрагента прямо сейчас"
                >
                  ➕ Создать заказчика «{(s.customer_name || '').trim().slice(0, 40)}»
                </Btn>
              </div>
            )}
          </Field>

          <div className="grid-2 gap-10">
            <Field label="ИНН" error={innError(s.inn || '')}>
              <INNInput value={s.inn || ''} onChange={(v) => setS({ ...s, inn: v })} />
            </Field>
            <Field
              label="КПП"
              error={s.kpp && s.kpp.length !== 9 ? 'КПП — 9 цифр' : null}
            >
              <TextInput
                value={s.kpp || ''}
                onChange={(v) => setS({ ...s, kpp: v.replace(/\D/g, '').slice(0, 9) })}
                maxLength={9}
                inputMode="numeric"
                placeholder="9 цифр"
              />
            </Field>
          </div>

          <Field label="Адрес">
            <TextInput value={s.address || ''} onChange={(v) => setS({ ...s, address: v })} />
          </Field>

          <Field label="Тип тендера" required>
            <SelectInput
              value={s.tender_type || ''}
              onChange={(v) => setS({ ...s, tender_type: v })}
              options={[{ value: '', label: '— выбрать —' }, ...TENDER_TYPES]}
            />
          </Field>

          <Field label="Название тендера/работы">
            <TextInput
              value={s.tender_name || ''}
              onChange={(v) => setS({ ...s, tender_name: v })}
              placeholder="Например: Капремонт кровли цеха №5"
            />
          </Field>

          <Field label="Дедлайн подачи КП">
            <DatePicker
              value={s.deadline_at || ''}
              onChange={(v) => setS({ ...s, deadline_at: v })}
            />
          </Field>

          <Field label="URL ссылки на площадку" help="Ссылка на тендер на ЭТП (zakupki.gov.ru, B2B-Center, и т.п.)">
            <TextInput
              value={s.purchase_url || ''}
              onChange={(v) => setS({ ...s, purchase_url: v })}
              placeholder="https://..."
            />
          </Field>

          {/* Период исполнения — YYYY-MM, обязателен на бэке (vanilla tenders.js:3529). */}
          <Field label="Период исполнения" required help="Месяц/год исполнения работ по тендеру">
            <div className="grid-2 gap-8">
              <SelectInput
                value={s.period_month || String(new Date().getMonth() + 1).padStart(2, '0')}
                onChange={(v) => setS({ ...s, period_month: v })}
                options={MONTH_OPTS}
              />
              <SelectInput
                value={s.period_year || String(new Date().getFullYear())}
                onChange={(v) => setS({ ...s, period_year: v })}
                options={YEAR_OPTS}
              />
            </div>
          </Field>
        </div>
      )
    },
    {
      key: 'terms',
      title: 'Условия',
      canNext: () => true,
      render: (s, setS) => {
        // Авторасчёт цены с НДС ⇄ без НДС (vanilla tenders.js:2422-2436).
        // НДС% по умолчанию 20 — если приехал из бэка/настроек, бери его, иначе 20.
        const vatPct = Number(s.vat_pct) > 0 ? Number(s.vat_pct) : 20;
        const vatMul = 1 + vatPct / 100;
        const onPriceChange = (v) => {
          const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
          const withVat = n > 0 ? Math.round(n * vatMul * 100) / 100 : '';
          setS({ ...s, tender_price: v, tender_price_with_vat: withVat === '' ? '' : String(withVat) });
        };
        const onPriceVatChange = (v) => {
          const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
          const noVat = n > 0 ? Math.round((n / vatMul) * 100) / 100 : '';
          setS({ ...s, tender_price_with_vat: v, tender_price: noVat === '' ? '' : String(noVat) });
        };
        const onVatPctChange = (v) => {
          // меняем процент — пересчитываем «с НДС» от текущего «без НДС»
          const newPct = Number(String(v).replace(',', '.')) || 0;
          const base = Number(String(s.tender_price || '').replace(/\s/g, '').replace(',', '.'));
          const newWithVat = base > 0 ? Math.round(base * (1 + newPct / 100) * 100) / 100 : (s.tender_price_with_vat || '');
          setS({ ...s, vat_pct: v, tender_price_with_vat: newWithVat === '' ? '' : String(newWithVat) });
        };
        return (
        <div className="col gap-14">
          <div className="grid-2 gap-10">
            <Field
              label="Цена тендера (без НДС)"
              help="НМЦК или ориентировочная цена"
              error={positiveAmountError(s.tender_price, 'Цена тендера')}
            >
              <MoneyInput value={s.tender_price || ''} onChange={onPriceChange} />
            </Field>
            <Field
              label="Цена с НДС"
              help="Считается автоматически от цены и ставки"
              error={positiveAmountError(s.tender_price_with_vat, 'Цена с НДС')}
            >
              <MoneyInput value={s.tender_price_with_vat || ''} onChange={onPriceVatChange} />
            </Field>
          </div>

          <Field
            label="Ставка НДС, %"
            help="Обычно 20%. Влияет на автопересчёт цен."
            error={percentError(s.vat_pct, 'НДС')}
          >
            <TextInput
              value={String(s.vat_pct ?? 20)}
              onChange={onVatPctChange}
              placeholder="20"
              inputMode="numeric"
            />
          </Field>

          <Field label="Тег" help="Помогает группировать в воронке">
            <Combobox
              value={s.tag || ''}
              onChange={(v) => setS({ ...s, tag: v })}
              options={tagOptions}
              placeholder="Например: РЖД"
            />
          </Field>

          <Field label="Комментарий">
            <TextareaInput
              value={s.comment || ''}
              onChange={(v) => setS({ ...s, comment: v })}
              placeholder="Любые заметки по тендеру"
              minRows={3}
              maxRows={8}
            />
          </Field>

          {/* КРУГ B: «Условия оплаты» снято — в таблице tenders нет такой колонки и vanilla
             тоже не шлёт payment_terms. Это был sink-стуб: пользователь выбирал, бэк молча игнорил.
             Условия оплаты живут в ТКП / смете (см. Tkp/TkpForm payment_preset + custom_payment_terms). */}
        </div>
        );
      }
    },
    {
      key: 'docs',
      title: 'Документы',
      canNext: () => true,
      render: (s, setS) => (
        <div className="col gap-14">
          <Field
            label="Файлы тендера"
            help="ТЗ, КД, чертежи. Если архив — распакуем"
          >
            <FileDrop
              accept=".pdf,.doc,.docx,.xls,.xlsx,.zip,.rar,.jpg,.jpeg,.png"
              multiple
              hint="Перетащи файлы или нажми — можно несколько. ZIP распакуем автоматически"
              onFiles={async (files) => {
                // D-50: распознать .zip и распаковать на клиенте через JSZip.
                // Каждый файл из архива добавится отдельно — загрузится обычным POST /api/files/upload.
                const arr = Array.from(files);
                const result = [];
                let zipExpanded = 0;
                let zipErrors = 0;
                for (const f of arr) {
                  if (ZIP_RX.test(f.name)) {
                    try {
                      const inner = await expandZipFile(f);
                      if (inner.length === 0) {
                        toast('ZIP', `${f.name}: пустой архив или только папки`, 'warn');
                      } else {
                        result.push(...inner);
                        zipExpanded += inner.length;
                      }
                    } catch (e) {
                      zipErrors++;
                      toast('ZIP', `${f.name}: ${e?.message || 'ошибка распаковки'}`, 'err');
                    }
                  } else {
                    result.push({ name: f.name, size: f.size, type: f.type, file: f });
                  }
                }
                if (zipExpanded > 0) {
                  toast('ZIP распакован', `Добавлено файлов из архива: ${zipExpanded}${zipErrors ? `, ошибок: ${zipErrors}` : ''}`, zipErrors ? 'warn' : 'ok');
                }
                if (result.length) {
                  setS({ ...s, documents: [...(s.documents || []), ...result] });
                }
              }}
            />
          </Field>

          {s.documents?.length > 0 && (
            <div className="files-attach-box">
              <div className="files-attach-head">
                Прикреплено · {s.documents.length}
              </div>
              {s.documents.map((d, i) => {
                // Уже сохранённый документ (с сервера) — рисуем ссылкой на /api/files/download.
                // Новый файл из FileDrop (с .file: File) — без ссылки, только имя+размер.
                const dlUrl = d.file instanceof File ? '' : buildDocumentLink(d);
                const label = d.name || d.original_name || d.filename || 'файл';
                return (
                  <div key={i} className="files-attach-row">
                    <div className="ellipsis">
                      {dlUrl ? (
                        <a
                          href={dlUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="files-attach-name"
                          style={{ color: 'var(--gold)', textDecoration: 'none' }}
                          title="Скачать"
                        >📄 {label}</a>
                      ) : (
                        <span className="files-attach-name">{label}</span>
                      )}
                      <span className="files-attach-size">
                        {formatBytes(d.size)}
                      </span>
                    </div>
                    <button
                      className="btn-ghost files-attach-rm"
                      onClick={() => setS({ ...s, documents: s.documents.filter((_, j) => j !== i) })}
                      title="Убрать"
                    >×</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )
    },
    /* D-51: вкладка комментариев в wizard'е.
       Для нового тендера (нет id) показываем хинт — комменты появятся после сохранения.
       Для редактируемого — встраиваем существующий CommentsTab (GET/POST/DELETE
       /api/tenders/:id/comments из ../api). */
    {
      key: 'comments',
      title: 'Комментарии',
      canNext: () => true,
      render: () => (
        <div className="col gap-14">
          {initial.id ? (
            <CommentsTab tenderId={initial.id} />
          ) : (
            <div
              style={{
                padding: '24px 16px',
                textAlign: 'center',
                background: 'var(--inner-bg)',
                border: '1px dashed var(--border)',
                borderRadius: 8,
                color: 'var(--text-muted)'
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 8 }}>💬</div>
              <div style={{ fontSize: 14 }}>
                Комментарии станут доступны после создания тендера.<br />
                Заполните основные поля и нажмите «✓ Создать».
              </div>
            </div>
          )}
        </div>
      )
    }
  ];

  // Restore-banner (vanilla tenders.js:131 loadDraft — UI «У вас есть незавершённый…»)
  // Рендерится между stepper'ом и body, как явная подсказка восстановления.
  // Сам restore-механизм (приём draft в initial) реализован в TenderEditorWizard.
  // Здесь мы только рисуем баннер если есть .__draftRestored=true в initial.
  const showDraftBanner = isNew && !!initial.__draftRestored;
  const banner = showDraftBanner ? (
    <div
      className="restore-banner"
      role="status"
      style={{
        background: 'var(--inner-bg)',
        border: '1px solid var(--gold)',
        borderRadius: 8,
        padding: '10px 14px',
        margin: '10px 0',
        display: 'flex',
        gap: 10,
        alignItems: 'center',
        fontSize: 13
      }}
    >
      <span aria-hidden="true">💾</span>
      <span style={{ flex: 1 }}>
        Восстановлен черновик от{' '}
        <b>{initial.__draftAt ? new Date(initial.__draftAt).toLocaleString('ru-RU') : 'недавнего времени'}</b>
      </span>
    </div>
  ) : null;

  // closeGuard — открывает confirm «Сохранить черновик?» если есть несохранённые изменения.
  // Возврат null = guard сам отрисовал диалог (Wizard НЕ закрывается).
  const closeGuard = isNew && lsKey
    ? async (currentState) => {
        if (!isFormDirty(currentState, baseInitialRef.current)) return true; // нет изменений → закрыть
        return await new Promise((resolve) => {
          modal.open(
            <ConfirmModal
              tone="warn"
              icon="💾"
              title="Закрыть мастер?"
              message="У вас есть несохранённые изменения. Сохранить как черновик и продолжить позже?"
              okText="Сохранить и закрыть"
              cancelText="Закрыть без сохранения"
              onConfirm={() => {
                saveDraftToLS(lsKey, currentState);
                toast.success('Черновик сохранён');
                resolve(true);
              }}
              onCancel={() => {
                clearDraftLS(lsKey);
                resolve(true);
              }}
            />,
            { size: 'narrow' }
          );
        }).then((doClose) => doClose);
      }
    : null;

  return (
    <WizardModal
      title={initial.id ? `Тендер #${initial.id}` : 'Новый тендер'}
      icon="📋"
      accent="gold"
      steps={steps}
      initial={initial}
      finishText={initial.id ? '💾 Сохранить' : '✓ Создать'}
      onFinish={onFinish}
      onStateChange={(next) => { lastStateRef.current = next; }}
      bannerSlot={banner}
      closeGuard={closeGuard}
      setStateRef={setStateRef}
    />
  );
}

/**
 * TenderEditorWizard — wizard для создания/редактирования полей тендера.
 * Используется И из TenderEditorModal (новый), И из TenderCardModal (кнопка
 * «✎ Редактировать в мастере» на вкладке Карточка существующего тендера).
 *
 * Принимает onSaved-callback — родитель использует чтобы перезагрузить карточку.
 */
export function TenderEditorWizard({ tenderId, onSaved }) {
  const { user } = useAuth();
  const modal = useModal();
  const isNew = !tenderId;
  const lsKey = isNew ? draftKey(user) : null;

  const [initial, setInitial] = useState(null);
  const [tags, setTags] = useState([]);
  // Ref-handle на wizard'овский setState — даёт inline-патчить state без reset.
  const wizardSetStateRef = useRef(null);

  useEffect(() => {
    const loadInitial = tenderId
      ? api(`/api/tenders/${tenderId}`).then((d) => d.tender || d || {}).catch(() => ({}))
      : Promise.resolve({});
    Promise.all([loadInitial, loadTags()]).then(([t, tg]) => {
      // Разворачиваем серверный t.period (YYYY-MM) в month/year для двух CRSelect-подобных
      // селектов. Если t пустой (новый тендер) — берём текущий месяц/год (поведение vanilla
      // tenders.js:2404 ymNow()).
      const srvPeriod = t?.period || ymNow();
      const periodYear = srvPeriod.slice(0, 4);
      const periodMonth = srvPeriod.slice(5, 7);
      // Базовый объект — дефолты для нового тендера (включая 20% НДС, текущий период).
      const base = {
        customer_name: '', inn: '', kpp: '', address: '',
        tender_type: '', tender_name: '', deadline_at: '',
        tender_price: '', tag: '', comment: '',
        documents: []
      };
      // Слиянием с серверным `t` затирать дефолты можно — но period/vat_pct/tender_price_with_vat
      // вычисляем отдельно (см. выше) и проставляем ПОСЛЕ spread, иначе spread их перепишет.
      const serverInitial = {
        ...base,
        ...t,
        period_month: t?.period ? t.period.slice(5, 7) : periodMonth,
        period_year: t?.period ? t.period.slice(0, 4) : periodYear,
        vat_pct: (t && t.vat_pct != null) ? t.vat_pct : 20,
        tender_price_with_vat: (t && t.tender_price_with_vat != null) ? t.tender_price_with_vat : '',
        id: tenderId
      };

      // ── Восстановление черновика (vanilla tenders.js:131 loadDraft) ──
      // Только для НОВОГО тендера — у редактируемого данные уже на сервере.
      if (isNew && lsKey) {
        const draft = loadDraftFromLS(lsKey);
        if (draft && Object.keys(draft).some((k) => k !== 'updatedAt' && draft[k])) {
          // Показываем confirm: восстановить или начать с нуля
          modal.open(
            <ConfirmModal
              tone="info"
              icon="💾"
              title="Восстановить черновик?"
              message={`У вас есть незавершённый черновик от ${new Date(draft.updatedAt).toLocaleString('ru-RU')}. Восстановить заполненные поля?`}
              okText="Восстановить"
              cancelText="Начать с нуля"
              onConfirm={() => {
                // Поверх serverInitial кладём поля черновика (но НЕ заглушим
                // случайно period_month/period_year если их в черновике нет).
                const merged = { ...serverInitial };
                const skip = new Set(['updatedAt', 'documents']);
                for (const [k, v] of Object.entries(draft)) {
                  if (skip.has(k)) continue;
                  if (v != null && v !== '') merged[k] = v;
                }
                // Если в черновике период — используем его month/year.
                if (draft.period_month) merged.period_month = draft.period_month;
                if (draft.period_year)  merged.period_year  = draft.period_year;
                merged.__draftRestored = true;
                merged.__draftAt = draft.updatedAt;
                setInitial(merged);
              }}
              onCancel={() => {
                clearDraftLS(lsKey);
                setInitial(serverInitial);
              }}
            />,
            { size: 'narrow' }
          );
        } else {
          setInitial(serverInitial);
        }
      } else {
        setInitial(serverInitial);
      }

      setTags(tg);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenderId]);

  if (!initial) {
    return (
      <div className="loading-card">
        <div className="muted">⏳ Загружаем…</div>
      </div>
    );
  }

  /**
   * Pre-submit duplicate check (vanilla tenders.js:243 findDuplicates).
   * Возвращает Promise<true> если submit можно продолжить, Promise<false> если отменён.
   */
  const checkDuplicates = async (state) => {
    if (!isNew) return true; // редактирование существующего — не дубликат
    const cleanInn = String(state.inn || '').replace(/\D/g, '');
    const customer = String(state.customer_name || '').trim();
    const subject = String(state.tender_name || '').trim();
    const amount = Number(String(state.tender_price || '').replace(/\s/g, '').replace(',', '.'));

    if (!cleanInn && !customer) return true;
    if (!subject) return true; // нечего сравнивать

    const { exact, similar } = await findTenderDuplicates({
      customer_inn: cleanInn,
      customer,
      subject,
      amount: Number.isFinite(amount) ? amount : null
    });

    if (!exact.length && !similar.length) return true;

    return await new Promise((resolve) => {
      const top = exact[0] || similar[0];
      const allMatches = [...exact, ...similar];
      const titleText = exact.length
        ? `Уже существует тендер с тем же заказчиком и предметом: #${top.id} «${top.tender_title || ''}» (${top.tender_status || '—'}).`
        : `Возможно, такой тендер уже есть — #${top.id} «${top.tender_title || ''}» (${top.tender_status || '—'}).`;
      const list = allMatches.slice(0, 5).map((m) => (
        `• #${m.id} «${m.tender_title || ''}» — ${m.customer_name || ''} (${m.tender_status || '—'})`
      )).join('\n');
      modal.open(
        <ConfirmModal
          tone={exact.length ? 'danger' : 'warn'}
          icon="⚠️"
          title={exact.length ? 'Похоже на дубликат' : 'Возможный дубликат'}
          message={`${titleText}\n\nНайденные совпадения:\n${list}\n\nПродолжить создание?`}
          okText={exact.length ? 'Всё равно создать' : 'Продолжить'}
          cancelText={exact.length ? 'Открыть существующий' : 'Отмена'}
          onConfirm={() => resolve(true)}
          onCancel={() => {
            // Если есть exact-match — переходим к нему
            if (exact.length) {
              window.location.hash = `#/tenders?id=${exact[0].id}`;
            }
            resolve(false);
          }}
        />,
        { size: 'narrow' }
      );
    });
  };

  const onFinish = async (state) => {
    // ── Проверка дубликатов перед submit'ом ──
    const proceed = await checkDuplicates(state);
    if (!proceed) {
      // throw чтобы Wizard оставил busy=false и не закрыл модалку
      const e = new Error('cancelled by duplicate check');
      e.cancelled = true;
      throw e;
    }

    try {
      // Маппинг полей формы → имена бэка (src/routes/tenders.js POST/PUT).
      // Бэк принимает: customer (→customer_name), customer_inn, tender_number (→tender_title),
      // tender_type, tender_status, period, deadline (→docs_deadline), tender_price,
      // tender_price_with_vat, vat_pct, responsible_pm_id, tag (→group_tag),
      // docs_link (→purchase_url), comment_to.
      // КРУГ A п.5 smoke: раньше слали inn/tender_name/deadline_at — бэк их игнорил.
      // Закрытие долга A-5: добавлены period (YYYY-MM из month+year), tender_price_with_vat и vat_pct.
      const periodMonth = state.period_month || String(new Date().getMonth() + 1).padStart(2, '0');
      const periodYear = state.period_year || String(new Date().getFullYear());
      const period = `${periodYear}-${periodMonth}`;
      // Парс money-строк: убираем пробелы, заменяем запятую на точку
      const parseMoney = (v) => {
        if (v == null || v === '') return null;
        const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
        return Number.isFinite(n) ? n : null;
      };
      const vatPct = Number(state.vat_pct);
      const payload = {
        customer_name: state.customer_name,
        customer_inn: state.inn,
        tender_type: state.tender_type,
        tender_title: state.tender_name,
        period,
        docs_deadline: state.deadline_at || null,
        tender_price: parseMoney(state.tender_price),
        tender_price_with_vat: parseMoney(state.tender_price_with_vat),
        vat_pct: Number.isFinite(vatPct) && vatPct >= 0 ? vatPct : 20,
        tag: state.tag,
        purchase_url: state.purchase_url?.trim() || null,
        comment_to: state.comment
      };
      let savedId = tenderId;
      if (tenderId) {
        await api(`/api/tenders/${tenderId}`, { method: 'PUT', body: payload });
        toast('Сохранено', 'Тендер обновлён', 'ok');
      } else {
        const created = await api('/api/tenders', { method: 'POST', body: payload });
        savedId = created?.tender?.id || created?.id;
        toast('Создан', `Тендер #${savedId || ''}`, 'ok');
      }

      // Загружаем прикреплённые файлы — vanilla tenders.js:2002-2053.
      // Без этого блока ATTACHED документы из шага 3 ТЕРЯЛИСЬ — выявлено в КРУГ A пункт 4.
      // Архивы (.zip/.rar/.7z) идут через /api/tenders/:id/upload-archive (с preview/confirm),
      // обычные файлы — через /api/files/upload.
      const pending = (state.documents || []).filter((d) => d.file instanceof File);
      if (savedId && pending.length) {
        const token = localStorage.getItem('asgard_token') || localStorage.getItem('auth_token') || '';
        const ARCHIVE_RX = /\.(zip|rar|7z|tar|tar\.gz|tgz|gz|bz2|jar)$/i;
        let okCnt = 0, errCnt = 0, arcCnt = 0;
        for (const d of pending) {
          if (d.file.size > 200 * 1024 * 1024) {
            toast('Файл слишком большой', `${d.name} > 200 МБ`, 'err');
            errCnt++; continue;
          }
          if (ARCHIVE_RX.test(d.name)) {
            // Архив — серверная распаковка через upload-archive; preview-выбор делается отдельно
            // на странице тендера (vanilla 2058+). Здесь просто загружаем — пользователь увидит
            // preview-модалку в карточке тендера. Если не реализована — файл всё равно сохранится.
            try {
              const fd = new FormData();
              fd.append('file', d.file);
              const r = await fetch(`/api/tenders/${savedId}/upload-archive`, {
                method: 'POST',
                headers: { Authorization: 'Bearer ' + token },
                body: fd
              });
              if (!r.ok) throw new Error('HTTP ' + r.status);
              arcCnt++;
            } catch (e) {
              toast('Архив', `${d.name}: ${e?.message || e}`, 'err');
              errCnt++;
            }
            continue;
          }
          try {
            const fd = new FormData();
            fd.append('file', d.file);
            fd.append('tender_id', String(savedId));
            fd.append('type', 'Документ');
            const r = await fetch('/api/files/upload', {
              method: 'POST',
              headers: { Authorization: 'Bearer ' + token },
              body: fd
            });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            okCnt++;
          } catch (e) {
            toast('Файл', `${d.name}: ${e?.message || e}`, 'err');
            errCnt++;
          }
        }
        if (okCnt || arcCnt) {
          toast('Документы',
            `Загружено: ${okCnt}${arcCnt ? ` + ${arcCnt} архив` : ''}${errCnt ? `, ошибок: ${errCnt}` : ''}`,
            errCnt ? 'warn' : 'ok'
          );
        }
      }

      // ── Очистка черновика после успешного submit'а (vanilla tenders.js:150 clearDraft) ──
      if (isNew && lsKey) {
        clearDraftLS(lsKey);
      }

      // ── Обновление рейтинга заказчика (vanilla tenders.js:2773 updateCustomerScore) ──
      // Только для НОВОГО тендера и только если есть customer_inn. Тихо: не блокируем.
      const innClean = String(state.inn || '').replace(/\D/g, '');
      if (isNew && innClean && savedId) {
        // Не блокируем UI — пусть отработает в фоне.
        updateCustomerScore(innClean, {
          event: 'tender_created',
          amount: payload.tender_price,
          ref_type: 'tender',
          ref_id: savedId
        });
      }

      window.dispatchEvent(new CustomEvent('asgard:tenders:changed'));
      onSaved?.(savedId);
    } catch (e) {
      if (e?.cancelled) throw e; // не показываем toast при отмене дубликат-проверки
      toast('Ошибка', String(e?.message || e), 'err');
      throw e;
    }
  };

  // Inline-открытие создателя контрагента (vanilla tenders.js:2929 openCustomerCreator).
  // Используется кнопкой «➕ Создать заказчика» в step 1. Патчим state wizard'а
  // ЧЕРЕЗ ref-handle — не через setInitial, чтобы НЕ ресетить другие уже-введённые поля.
  const openCreateCustomer = (prefill) => {
    modal.open(
      <CustomerQuickCreateModal
        prefill={prefill}
        onCreated={(customer) => {
          const patch = (prev) => ({
            ...prev,
            customer_name: customer.name || customer.full_name || prev.customer_name,
            inn: customer.inn || prev.inn,
            kpp: customer.kpp || prev.kpp,
            address: customer.address || prev.address
          });
          if (wizardSetStateRef.current) {
            wizardSetStateRef.current(patch);
          } else {
            // fallback (на случай если wizard ещё не смонтирован)
            setInitial((prev) => prev ? patch(prev) : prev);
          }
          toast.success('Контрагент подставлен в тендер');
        }}
      />,
      { size: 'wide' }
    );
  };

  return (
    <TenderEditorInner
      initial={initial}
      tags={tags}
      onFinish={onFinish}
      isNew={isNew}
      lsKey={lsKey}
      openCreateCustomer={openCreateCustomer}
      setStateRef={wizardSetStateRef}
    />
  );
}

/* Public entry-point — см. `./TenderEditor.dispatch.jsx`.
 * Эта обёртка не реэкспортится отсюда, чтобы не создавать цикл импортов:
 *   TenderEditor.dispatch → { TenderCardModal | TenderEditorWizard }
 *   TenderCardModal → TenderEditor (для wizard)
 * Импорт `TenderEditorModal` всегда идёт ИМЕННО из `./TenderEditor.dispatch`. */

function formatBytes(n) {
  if (!n) return '0 Б';
  if (n < 1024) return n + ' Б';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' КБ';
  return (n / 1024 / 1024).toFixed(1) + ' МБ';
}
