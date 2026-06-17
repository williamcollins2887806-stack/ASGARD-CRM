/**
 * Модалка — детали и редактирование транзакции.
 * Endpoints: GET /bank/transactions/:id · PUT /bank/transactions/:id · POST /:id/distribute
 */
import { useEffect, useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { SelectInput, Combobox, TextareaInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';

import {
  loadTransaction, updateTransaction, distributeTransaction, loadWorks,
  EXPENSE_ARTICLES, INCOME_ARTICLES, TX_STATUSES, DIRECTIONS,
  fmtMoney, fmtDate, fmtDateTime
} from './api';

export default function TransactionDetail({ id, onSaved }) {
  const { close } = useModal();
  const [tx, setTx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [distributing, setDistributing] = useState(false);

  /* Форма */
  const [article, setArticle] = useState('');
  const [workId, setWorkId] = useState('');
  const [category1c, setCategory1c] = useState('');
  const [description, setDescription] = useState('');

  /* Список работ для выбора */
  const [works, setWorks] = useState([]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      loadTransaction(id),
      loadWorks(500)
    ])
      .then(([r, w]) => {
        if (!active) return;
        if (r?.success) {
          const it = r.item;
          setTx(it);
          setArticle(it.article || '');
          setWorkId(it.work_id ? String(it.work_id) : '');
          setCategory1c(it.category_1c || '');
          setDescription(it.description || '');
        } else {
          toast.error('Транзакция не найдена');
          close();
        }
        setWorks(Array.isArray(w) ? w : []);
      })
      .catch((e) => {
        toast.error('Не удалось загрузить: ' + (e?.message || ''));
        close();
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading || !tx) {
    return (
      <MCard>
        <MHead icon="🏦" title="Транзакция" onClose={close} />
        <MBody><div className="p-32 t-center c-t3">⏳ Загружаем…</div></MBody>
        <MFoot><Btn variant="ghost" onClick={close}>Закрыть</Btn></MFoot>
      </MCard>
    );
  }

  const dir = DIRECTIONS[tx.direction] || {};
  const st = TX_STATUSES[tx.status] || { label: tx.status, tone: 'default' };
  const articleOpts = (tx.direction === 'income' ? INCOME_ARTICLES : EXPENSE_ARTICLES);
  const workOpts = works.map((w) => ({
    value: String(w.id),
    label: (w.work_number ? w.work_number + ' · ' : '#' + w.id + ' · ') + (w.work_title || w.title || w.contract_number || 'без названия')
  }));

  const canSave = !!article && !saving;
  const canDistribute = !!article && ['classified', 'confirmed'].includes(tx.status) && !distributing;

  const onSave = async () => {
    setSaving(true);
    try {
      await updateTransaction(id, {
        article,
        work_id: workId ? Number(workId) : null,
        category_1c: category1c || null,
        description
      });
      toast.success('Сохранено');
      onSaved?.();
      close();
    } catch (e) {
      toast.error('Сохранение: ' + (e?.message || ''));
    } finally {
      setSaving(false);
    }
  };

  const onDistribute = async () => {
    setDistributing(true);
    try {
      // Если изменения не сохранены — сначала сохраняем
      if (article !== (tx.article || '') || workId !== (tx.work_id ? String(tx.work_id) : '')) {
        await updateTransaction(id, {
          article,
          work_id: workId ? Number(workId) : null,
          category_1c: category1c || null,
          description
        });
      }
      const r = await distributeTransaction(id);
      if (r?.success) {
        toast.success('Разнесено в реестр расходов/доходов');
        onSaved?.();
        close();
      } else {
        toast.error(r?.error || 'Не удалось разнести');
      }
    } catch (e) {
      toast.error('Распределение: ' + (e?.message || ''));
    } finally {
      setDistributing(false);
    }
  };

  return (
    <MCard>
      <MHead
        icon={dir.sign === '+' ? '📥' : '📤'}
        title={(dir.label || 'Транзакция') + ': ' + (dir.sign || '') + fmtMoney(tx.amount)}
        subtitle={tx.counterparty_name || 'Без контрагента'}
        accent={tx.direction === 'income' ? 'success' : 'warn'}
        onClose={close}
      />
      <MBody>
        <div className="bi-detail-grid">
          {/* Левая колонка — метаданные */}
          <div className="bi-detail-meta">
            <div className="bi-kv">
              <div className="bi-kv-l">Дата операции</div>
              <div className="bi-kv-r">{fmtDate(tx.transaction_date)}</div>
            </div>
            <div className="bi-kv">
              <div className="bi-kv-l">Направление</div>
              <div className="bi-kv-r">
                <span className={'bi-tx-amount ' + (dir.cls || '')}>{dir.sign}{fmtMoney(tx.amount)}</span>
              </div>
            </div>
            <div className="bi-kv">
              <div className="bi-kv-l">Статус</div>
              <div className="bi-kv-r"><span className={'bi-pill bi-pill--' + st.tone}>{st.label}</span></div>
            </div>
            <div className="bi-kv">
              <div className="bi-kv-l">Контрагент</div>
              <div className="bi-kv-r">{tx.counterparty_name || '—'}</div>
            </div>
            {tx.counterparty_inn && (
              <div className="bi-kv">
                <div className="bi-kv-l">ИНН / КПП</div>
                <div className="bi-kv-r">{tx.counterparty_inn} {tx.counterparty_kpp ? ' / ' + tx.counterparty_kpp : ''}</div>
              </div>
            )}
            {tx.counterparty_account && (
              <div className="bi-kv">
                <div className="bi-kv-l">Счёт</div>
                <div className="bi-kv-r">{tx.counterparty_account}</div>
              </div>
            )}
            {tx.our_account && (
              <div className="bi-kv">
                <div className="bi-kv-l">Наш счёт</div>
                <div className="bi-kv-r">{tx.our_account}</div>
              </div>
            )}
            {tx.payment_purpose && (
              <div className="bi-kv">
                <div className="bi-kv-l">Назначение</div>
                <div className="bi-kv-r" style={{ whiteSpace: 'pre-wrap' }}>{tx.payment_purpose}</div>
              </div>
            )}
            {tx.document_number && (
              <div className="bi-kv">
                <div className="bi-kv-l">Документ</div>
                <div className="bi-kv-r">№ {tx.document_number}{tx.document_date ? ' от ' + fmtDate(tx.document_date) : ''}</div>
              </div>
            )}
            {tx.batch_filename && (
              <div className="bi-kv">
                <div className="bi-kv-l">Файл</div>
                <div className="bi-kv-r">{tx.batch_filename}</div>
              </div>
            )}
            {tx.created_at && (
              <div className="bi-kv">
                <div className="bi-kv-l">Импорт</div>
                <div className="bi-kv-r">{fmtDateTime(tx.created_at)}</div>
              </div>
            )}
          </div>

          {/* Правая колонка — форма */}
          <div className="bi-detail-form">
            <label className="bi-label">Статья *</label>
            <SelectInput
              value={article}
              onChange={setArticle}
              options={articleOpts}
              placeholder="— выберите статью —"
            />

            <label className="bi-label mt-12">Работа (опционально)</label>
            {workOpts.length ? (
              <Combobox
                value={workId}
                onChange={(v) => setWorkId(v || '')}
                options={[{ value: '', label: '— без привязки —' }, ...workOpts]}
                placeholder="Начните вводить номер или название…"
              />
            ) : (
              <SelectInput value="" onChange={() => {}} options={[{ value: '', label: 'Работ не найдено' }]} disabled />
            )}

            <label className="bi-label mt-12">Категория 1С (опционально)</label>
            <input
              className="inp-text"
              value={category1c}
              onChange={(e) => setCategory1c(e.target.value)}
              placeholder="например: 91.02.01"
            />

            <label className="bi-label mt-12">Комментарий</label>
            <TextareaInput
              value={description}
              onChange={setDescription}
              minRows={3}
              maxRows={6}
              placeholder="Заметка для отчёта"
            />

            {tx.article_confidence && tx.article_confidence !== 'none' && (
              <div className="bi-conf mt-12">
                Авто-классификация: <b>{tx.article_confidence}</b>
                {tx.confirmed_at && ' · подтверждено ' + fmtDateTime(tx.confirmed_at)}
              </div>
            )}
          </div>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <div className="row gap-8">
          <Btn variant="ghost" disabled={!canSave} onClick={onSave}>
            {saving ? 'Сохраняем…' : '💾 Сохранить'}
          </Btn>
          <Btn variant="success" disabled={!canDistribute} onClick={onDistribute} title={canDistribute ? '' : 'Сначала укажите статью и сохраните'}>
            {distributing ? 'Разносим…' : '📊 Разнести по работам'}
          </Btn>
        </div>
      </MFoot>
    </MCard>
  );
}
