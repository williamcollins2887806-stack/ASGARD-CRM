/**
 * Карточка просмотра расхода (read-only).
 */
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { fmtMoney, fmtDate, getCategory } from './api';

function Row({ label, value }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '180px 1fr',
      gap: 12,
      padding: '6px 0',
      borderBottom: '1px solid var(--brd-2)',
      fontSize: 13
    }}>
      <div className="c-t3">{label}</div>
      <div className="c-t1">{value}</div>
    </div>
  );
}

function Section({ children }) {
  return (
    <div style={{
      fontSize: 11,
      color: 'var(--t-3)',
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      fontWeight: 700,
      margin: '14px 0 6px'
    }}>{children}</div>
  );
}

export default function ExpenseViewModal({ expense, work, creator, onEdit }) {
  const { close } = useModal();
  const cat = getCategory(expense.category);
  const isFot = expense.category === 'fot';

  return (
    <MCard className="modal-wide">
      <MHead
        icon={cat.icon}
        title={`Расход #${expense.id}`}
        subtitle={cat.label}
        accent="default"
        onClose={close}
      />
      <MBody>
        <Section>Основное</Section>
        <Row label="Дата"        value={fmtDate(expense.date)} />
        <Row label="Сумма"       value={<b className="c-gold">{fmtMoney(expense.amount)}</b>} />
        <Row label="Заказчик"    value={work?.customer_name || work?.customer || '—'} />
        <Row label="Работа"      value={work?.work_title || '—'} />
        <Row label="Поставщик"   value={expense.supplier || '—'} />
        <Row label="№ документа" value={expense.doc_number || '—'} />
        {(expense.notes || expense.comment) && (
          <Row label="Комментарий" value={expense.notes || expense.comment} />
        )}

        <Section>Счёт-фактура</Section>
        <Row label="Нужна СФ"    value={expense.invoice_needed   ? 'Да' : 'Нет'} />
        <Row label="СФ получена" value={expense.invoice_received ? 'Да' : 'Нет'} />

        <Section>Аудит</Section>
        <Row label="Кто внёс" value={creator?.name || creator?.login || '—'} />
        <Row label="Создано"  value={expense.created_at ? new Date(expense.created_at).toLocaleString('ru-RU') : '—'} />
        {expense.updated_at && (
          <Row label="Обновлено" value={new Date(expense.updated_at).toLocaleString('ru-RU')} />
        )}

        {isFot && expense.fot_employee_name && (
          <>
            <Section>Детализация ФОТ</Section>
            <Row label="Сотрудник" value={expense.fot_employee_name} />
            <Row label="Оклад"     value={fmtMoney(expense.fot_base_pay || 0)} />
            <Row label="Суточные"  value={fmtMoney(expense.fot_per_diem || 0)} />
            <Row label="Премия"    value={fmtMoney(expense.fot_bonus    || 0)} />
            <Row label="Период с"  value={fmtDate(expense.fot_date_from)} />
            <Row label="Период по" value={fmtDate(expense.fot_date_to)} />
          </>
        )}
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Закрыть</Btn>
        {onEdit && (
          <Btn variant="primary" onClick={() => { close(); onEdit(expense); }}>✎ Редактировать</Btn>
        )}
      </MFoot>
    </MCard>
  );
}
