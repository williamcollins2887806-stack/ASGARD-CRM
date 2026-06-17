/**
 * ExportModal — экспорт в Excel:
 *   • Реестр выплат (для трудовых + лист самозанятых) — POST /api/payroll/payments/export
 *   • Excel-сетка ведомости (баллы за смены) — GET /api/worker-payments/reports/payroll-grid/:y/:m/export
 *
 * Источник vanilla:
 *   • payroll.js → btnExport (sheet.id ⇒ payments/export?sheet_id=)
 *   • payroll.js → btnGridExcel / renderPayrollGrid → btnExportGrid
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { SelectInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import {
  exportPaymentsExcel, exportPayrollGrid, downloadBlob, MONTHS_RU
} from '../api';

export default function ExportModal({ sheetId, sheet, defaultMode = 'payments' }) {
  const { close } = useModal();
  const [mode, setMode] = useState(defaultMode);

  /* Grid period defaults: prev month если нет sheet */
  const now = new Date();
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [year,  setYear]  = useState(sheet?.period_from ? new Date(sheet.period_from).getFullYear() : prevDate.getFullYear());
  const [month, setMonth] = useState(sheet?.period_from ? new Date(sheet.period_from).getMonth() + 1 : prevDate.getMonth() + 1);
  const [busy,  setBusy]  = useState(false);

  const yearOpts  = [-2, -1, 0, 1].map((d) => ({ value: String(now.getFullYear() + d), label: String(now.getFullYear() + d) }));
  const monthOpts = MONTHS_RU.map((m, i) => ({ value: String(i + 1), label: m }));
  const modeOpts  = [
    { value: 'payments', label: '💼 Реестр выплат (для банка)' },
    { value: 'grid',     label: '📋 Ведомость-сетка (баллы за смены)' }
  ];

  const submit = async () => {
    setBusy(true);
    try {
      if (mode === 'payments') {
        const { blob, filename } = await exportPaymentsExcel({ sheet_id: sheetId || sheet?.id });
        downloadBlob(blob, filename);
        toast.success('Файл скачан', { title: filename });
      } else {
        const { blob, filename } = await exportPayrollGrid(Number(year), Number(month));
        downloadBlob(blob, filename);
        toast.success('Файл скачан', { title: filename });
      }
      close();
    } catch (e) {
      toast.error('Не удалось скачать: ' + String(e?.message || e));
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead icon="📥" title="Экспорт в Excel" subtitle="Реестр выплат или ведомость-сетка" accent="default" onClose={close} />
      <MBody>
        <Field label="Что экспортировать">
          <SelectInput value={mode} onChange={setMode} options={modeOpts} />
        </Field>

        {mode === 'payments' && (
          <div style={{ marginTop: 12, padding: 12, background: 'var(--inner-bg)', borderRadius: 'var(--r-md)', fontSize: 13, color: 'var(--t-2)' }}>
            {sheet?.id || sheetId ? (
              <>Файл по ведомости <b>«{sheet?.title || `#${sheetId}`}»</b>. 2 листа: «Реестр выплат (трудовые)» и «Самозанятые (ГПХ)».</>
            ) : (
              <>Будут выгружены все <b>ожидающие/в работе</b> выплаты по реестру. 2 листа.</>
            )}
          </div>
        )}

        {mode === 'grid' && (
          <div className="m-grid-2 mt-10">
            <Field label="Месяц">
              <SelectInput value={String(month)} onChange={(v) => setMonth(Number(v))} options={monthOpts} />
            </Field>
            <Field label="Год">
              <SelectInput value={String(year)} onChange={(v) => setYear(Number(v))} options={yearOpts} />
            </Field>
          </div>
        )}
      </MBody>
      <MFoot>
        <Btn variant="ghost"   onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={submit}>{busy ? '⏳ Готовим…' : '📥 Скачать Excel'}</Btn>
      </MFoot>
    </MCard>
  );
}
