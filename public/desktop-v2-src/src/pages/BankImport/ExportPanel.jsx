/**
 * Панель экспорта банковских транзакций.
 * GET /api/integrations/bank/export/1c    — текст для загрузки в 1С
 * GET /api/integrations/bank/export/excel — JSON, рендерим .xlsx через SheetJS lazy-load
 *
 * Для 1С — blob через openProtected (без токена в URL — security D-4).
 */
import { useState } from 'react';
import { Btn } from '@/modals/parts';
import { SelectInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { openProtected, fetchBlobUrl } from '@/api/download';

import {
  EXPENSE_ARTICLES, INCOME_ARTICLES, fmtMoney, buildExportUrl
} from './api';

const DIR_OPTS = [
  { value: '',        label: 'Все направления' },
  { value: 'income',  label: '📥 Доходы' },
  { value: 'expense', label: '📤 Расходы' }
];

const STATUS_OPTS_1C = [
  { value: 'distributed', label: 'Разнесённые (готовы к 1С)' },
  { value: 'confirmed',   label: 'Подтверждённые' },
  { value: 'exported_1c', label: 'Уже экспортированные' }
];

export default function ExportPanel({ stats }) {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [article, setArticle] = useState('');
  const [direction, setDirection] = useState('');
  const [status1c, setStatus1c] = useState('distributed');
  const [busy1c, setBusy1c] = useState(false);
  const [busyXlsx, setBusyXlsx] = useState(false);

  const articleOpts = [
    { value: '', label: 'Все статьи' },
    ...EXPENSE_ARTICLES,
    ...INCOME_ARTICLES
  ];

  const onExport1c = async () => {
    if (busy1c) return;
    setBusy1c(true);
    try {
      const url = buildExportUrl('1c', {
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        status: status1c
      });
      const filename = `bank_export_1c_${new Date().toISOString().slice(0, 10)}.txt`;
      await openProtected(url, filename);
      toast.success('Экспорт 1С сформирован — статус транзакций обновлён на exported_1c');
    } catch (e) {
      if (e?.status === 404) toast.warn('Нет транзакций для экспорта в выбранном периоде');
      else toast.error('Экспорт 1С: ' + (e?.message || ''));
    } finally {
      setBusy1c(false);
    }
  };

  const onExportExcel = async () => {
    if (busyXlsx) return;
    setBusyXlsx(true);
    try {
      const url = buildExportUrl('excel', {
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        article: article || undefined,
        direction: direction || undefined
      });
      // backend отдаёт JSON. Если в проекте есть SheetJS как глобал (window.XLSX
      // подгружается lazy на других страницах) — собираем .xlsx, иначе CSV
      // с BOM (Excel открывает корректно).
      const { blobUrl } = await fetchBlobUrl(url);
      const r = await fetch(blobUrl);
      URL.revokeObjectURL(blobUrl);
      const json = await r.json();
      if (!json?.success || !json.items?.length) {
        toast.warn('Нет данных для экспорта');
        return;
      }
      const XLSX = typeof window !== 'undefined' ? window.XLSX : null;
      if (XLSX && XLSX.utils && XLSX.writeFile) {
        const ws = XLSX.utils.json_to_sheet(json.items.map((t) => ({
          'Дата':         (t.transaction_date || '').slice(0, 10),
          'Направление':  t.direction === 'income' ? 'доход' : 'расход',
          'Сумма':        Number(t.amount) || 0,
          'Контрагент':   t.counterparty_name || '',
          'ИНН':          t.counterparty_inn || '',
          'Назначение':   t.payment_purpose || '',
          'Статья':       t.article || '',
          'Работа':       t.work_id || '',
          'Статус':       t.status || '',
          'Документ':     t.document_number || '',
          'Категория 1С': t.category_1c || ''
        })));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Транзакции');
        XLSX.writeFile(wb, `bank_export_${new Date().toISOString().slice(0, 10)}.xlsx`);
        toast.success(`Экспортировано ${json.items.length} строк (xlsx)`);
        return;
      }
      // CSV-fallback (BOM для Excel)
      const rows = [
        ['Дата', 'Направление', 'Сумма', 'Контрагент', 'ИНН', 'Назначение', 'Статья', 'Работа', 'Статус', 'Документ', 'Категория 1С']
      ];
      for (const t of json.items) {
        rows.push([
          (t.transaction_date || '').slice(0, 10),
          t.direction === 'income' ? 'доход' : 'расход',
          t.amount,
          t.counterparty_name || '',
          t.counterparty_inn || '',
          (t.payment_purpose || '').replace(/[\n\r;]/g, ' '),
          t.article || '',
          t.work_id || '',
          t.status || '',
          t.document_number || '',
          t.category_1c || ''
        ]);
      }
      const csv = rows
        .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'))
        .join('\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `bank_export_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast.success(`Экспортировано ${json.items.length} строк (CSV — открывается в Excel)`);
    } catch (e) {
      toast.error('Экспорт Excel: ' + (e?.message || ''));
    } finally {
      setBusyXlsx(false);
    }
  };

  return (
    <div className="col gap-12">
      <div className="bi-export-card">
        <div className="bi-export-h">📤 Экспорт банковских транзакций</div>
        <div className="bi-export-sub">
          Период и фильтры применяются к обоим форматам. 1С-экспорт меняет статус транзакций на <code>exported_1c</code>.
        </div>

        <div className="bi-export-form">
          <div className="bi-export-row">
            <label className="bi-label">Дата с</label>
            <input
              type="date"
              className="inp-text"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="bi-export-row">
            <label className="bi-label">Дата по</label>
            <input
              type="date"
              className="inp-text"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <div className="bi-export-row">
            <label className="bi-label">Направление</label>
            <SelectInput value={direction} onChange={setDirection} options={DIR_OPTS} />
          </div>
          <div className="bi-export-row">
            <label className="bi-label">Статья</label>
            <SelectInput value={article} onChange={setArticle} options={articleOpts} />
          </div>
        </div>
      </div>

      <div className="bi-export-grid">
        <div className="bi-export-card">
          <div className="bi-export-h">📤 Экспорт в 1С (txt, win-1251)</div>
          <div className="bi-export-sub">
            Формат «1С Обмен» — файл загружается напрямую в «Клиент-Банк» 1С.
            После экспорта транзакции помечаются как <code>exported_1c</code>.
          </div>
          <div className="bi-export-form">
            <div className="bi-export-row">
              <label className="bi-label">Какие транзакции экспортировать</label>
              <SelectInput value={status1c} onChange={setStatus1c} options={STATUS_OPTS_1C} />
            </div>
          </div>
          <Btn variant="primary" disabled={busy1c} onClick={onExport1c}>
            {busy1c ? 'Готовим файл…' : '📥 Скачать .txt для 1С'}
          </Btn>
        </div>

        <div className="bi-export-card">
          <div className="bi-export-h">📊 Экспорт в Excel (.xlsx)</div>
          <div className="bi-export-sub">
            Для аналитики/отчётов. Не меняет статус транзакций. Учитывает фильтры выше.
          </div>
          <Btn variant="primary" disabled={busyXlsx} onClick={onExportExcel}>
            {busyXlsx ? 'Готовим…' : '📥 Скачать .xlsx'}
          </Btn>
        </div>
      </div>

      {stats && (
        <div className="bi-export-card">
          <div className="bi-export-h">Сводка</div>
          <div className="bi-export-stats">
            <div><span className="lbl">Доходов</span><span className="val c-ok">{fmtMoney(stats.total_income || 0)}</span></div>
            <div><span className="lbl">Расходов</span><span className="val c-err">{fmtMoney(stats.total_expense || 0)}</span></div>
            <div><span className="lbl">Баланс</span><span className="val c-gold">{fmtMoney(stats.balance || 0)}</span></div>
            <div><span className="lbl">Неразнесённых</span><span className="val c-amber">{stats.unclassified_count || 0}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}
