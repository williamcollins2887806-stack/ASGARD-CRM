/**
 * Модалка редактирования официально устроенного сотрудника.
 * Источник: vanilla `openEditModal()` в official_employees.js.
 *
 * Вкладки:
 *   • 💰 Оплата   — оклад, несгораемая, статус, период отпуска/больничного, тип занятости
 *   • 🆔 Паспорт   — серия/№/выдан/дата/код подразделения (PII, только HR/HR_MANAGER/ADMIN/DIRECTOR_GEN)
 *
 * Backend:
 *   PUT /api/payroll-dashboard/official-employees/:id  — оплата + переключение типа занятости
 *   PUT /api/staff/employees/:id                       — паспорт + ИНН/СНИЛС
 */
import { useState, useEffect } from 'react';
import { useModal, ConfirmModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { NumberInput, SelectInput, TextInput, DatePicker, INNInput } from '@/inputs/Inputs';

import {
  STATUS_OPTS, LEAVE_STATUSES,
  updatePayroll, updatePii, loadEmployeePii,
  EDIT_PII_ROLES
} from './api';

export function OfficialEmployeeEditModal({ employee, userRole, onSaved }) {
  const { close, open } = useModal();
  const canEditPii = EDIT_PII_ROLES.includes(userRole);

  const [tab, setTab] = useState('pay');

  // Pay state
  const [salary, setSalary] = useState(String(employee.official_salary || 0));
  const [nonburn, setNonburn] = useState(String(employee.official_non_burnable || 0));
  const [status, setStatus] = useState(employee.official_status || 'active');
  const [leaveFrom, setLeaveFrom] = useState((employee.official_leave_from || '').slice(0, 10));
  const [leaveTo, setLeaveTo] = useState((employee.official_leave_to || '').slice(0, 10));
  const [savingPay, setSavingPay] = useState(false);

  // PII state
  const [piiLoaded, setPiiLoaded] = useState(false);
  const [passSeries, setPassSeries] = useState('');
  const [passNumber, setPassNumber] = useState('');
  const [passIssued, setPassIssued] = useState('');
  const [passDate, setPassDate] = useState('');
  const [passCode, setPassCode] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [birthPlace, setBirthPlace] = useState('');
  const [regAddress, setRegAddress] = useState('');
  const [inn, setInn] = useState('');
  const [snils, setSnils] = useState('');
  const [savingPii, setSavingPii] = useState(false);

  // Lazy load PII when switching tabs
  useEffect(() => {
    if (tab !== 'pii' || piiLoaded || !canEditPii) return;
    loadEmployeePii(employee.id)
      .then((emp) => {
        if (!emp) return;
        setPassSeries(emp.passport_series || emp.pass_series || '');
        setPassNumber(emp.passport_number || emp.pass_number || '');
        setPassIssued(emp.passport_issued || '');
        setPassDate((emp.passport_date || '').slice(0, 10));
        setPassCode(emp.passport_code || '');
        setBirthDate((emp.birth_date || '').slice(0, 10));
        setBirthPlace(emp.birth_place || '');
        setRegAddress(emp.registration_address || '');
        setInn(emp.inn || '');
        setSnils(emp.snils || '');
        setPiiLoaded(true);
      })
      .catch((e) => toast.error('Не удалось загрузить ПД: ' + (e?.message || e)));
  }, [tab, piiLoaded, canEditPii, employee.id]);

  const showLeave = LEAVE_STATUSES.has(status);
  const name = employee.full_name || employee.fio || 'Сотрудник';

  const savePay = async () => {
    setSavingPay(true);
    try {
      await updatePayroll(employee.id, {
        official_salary: parseFloat(salary) || 0,
        official_non_burnable: parseFloat(nonburn) || 0,
        official_status: status,
        official_leave_from: leaveFrom || null,
        official_leave_to: leaveTo || null
      });
      toast.success('Данные оплаты обновлены');
      onSaved?.();
      close();
    } catch (e) {
      toast.error('Не удалось сохранить: ' + (e?.message || e));
      setSavingPay(false);
    }
  };

  const savePii = async () => {
    setSavingPii(true);
    try {
      await updatePii(employee.id, {
        passport_series: passSeries.trim() || null,
        passport_number: passNumber.trim() || null,
        passport_issued: passIssued.trim() || null,
        passport_date: passDate || null,
        passport_code: passCode.trim() || null,
        birth_date: birthDate || null,
        birth_place: birthPlace.trim() || null,
        registration_address: regAddress.trim() || null,
        inn: inn.trim() || null,
        snils: snils.trim() || null
      });
      toast.success('Паспортные данные обновлены');
      onSaved?.();
      close();
    } catch (e) {
      toast.error('Не удалось сохранить ПД: ' + (e?.message || e));
      setSavingPii(false);
    }
  };

  const transferToSelf = () => {
    open(
      <ConfirmModal
        title={`Перевести «${name}» в самозанятые?`}
        message="Убедитесь, что текущий месяц закрыт. Изменение типа занятости влияет на расчёт зарплаты и налоговую отчётность."
        tone="warn"
        okText="Перевести"
        onConfirm={async () => {
          try {
            await updatePayroll(employee.id, {
              is_officially_employed: false,
              is_self_employed: true
            });
            toast.success('Переведён в самозанятые');
            onSaved?.();
            close();
          } catch (e) {
            toast.error('Не удалось: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  const transferToSalary = () => {
    open(
      <ConfirmModal
        title={`Перевести «${name}» на официальный оклад?`}
        message="Убедитесь, что текущий месяц закрыт. Изменение типа занятости влияет на расчёт зарплаты и налоговую отчётность."
        tone="info"
        okText="Перевести"
        onConfirm={async () => {
          try {
            await updatePayroll(employee.id, {
              is_officially_employed: true,
              is_self_employed: false
            });
            toast.success('Переведён на официальный оклад');
            onSaved?.();
            close();
          } catch (e) {
            toast.error('Не удалось: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  return (
    <MCard>
      <MHead icon="✎" title={`${name} — редактирование`} onClose={() => close()} />
      <MBody>
        <div className="blk-tabs mb-14" >
          <button
            type="button"
            className={tab === 'pay' ? 'on' : ''}
            onClick={() => setTab('pay')}
          >
            <span>💰 Оплата</span>
          </button>
          {canEditPii && (
            <button
              type="button"
              className={tab === 'pii' ? 'on' : ''}
              onClick={() => setTab('pii')}
            >
              <span>🆔 Паспорт</span>
            </button>
          )}
        </div>

        {tab === 'pay' && (
          <>
            <div className="m-grid-2">
              <Field label="Оклад (₽)">
                <NumberInput value={salary} onChange={setSalary} min={0} step={500} />
              </Field>
              <Field label="Несгораемая (₽)">
                <NumberInput value={nonburn} onChange={setNonburn} min={0} step={500} />
              </Field>
              <div className="col-span-2">
                <Field label="Статус занятости">
                  <SelectInput value={status} onChange={setStatus} options={STATUS_OPTS} />
                </Field>
              </div>
              {showLeave && (
                <>
                  <Field label="Начало периода">
                    <DatePicker value={leaveFrom} onChange={(v) => setLeaveFrom(v || '')} />
                  </Field>
                  <Field label="Конец периода">
                    <DatePicker value={leaveTo} onChange={(v) => setLeaveTo(v || '')} />
                  </Field>
                </>
              )}
            </div>

            <div style={{
              marginTop: 18, padding: 14,
              background: 'var(--inner-bg)',
              border: '1px solid var(--brd-2)',
              borderRadius: 'var(--r-md)'
            }}>
              <div style={{
                fontSize: 11, color: 'var(--t-3)',
                textTransform: 'uppercase', letterSpacing: '0.1em',
                fontWeight: 700, marginBottom: 6
              }}>
                Смена типа занятости
              </div>
              <div className="fs-12 c-t3 mb-10">
                ⚠ Выполнять только после закрытия расчётного месяца. Влияет на зарплату и налоговую отчётность.
              </div>
              <div className="u-flex gap-8 u-wrap">
                <Btn variant="warn" onClick={transferToSelf}>→ Перевести в самозанятые</Btn>
                <Btn variant="info" onClick={transferToSalary}>→ Перевести на оклад</Btn>
              </div>
            </div>
          </>
        )}

        {tab === 'pii' && canEditPii && (
          <>
            <div className="m-grid-2">
              <Field label="Серия паспорта">
                <TextInput value={passSeries} onChange={setPassSeries} placeholder="0000" maxLength={4} />
              </Field>
              <Field label="Номер паспорта">
                <TextInput value={passNumber} onChange={setPassNumber} placeholder="000000" maxLength={6} />
              </Field>
              <div className="col-span-2">
                <Field label="Кем выдан">
                  <TextInput value={passIssued} onChange={setPassIssued} placeholder="ОВД района…" />
                </Field>
              </div>
              <Field label="Дата выдачи">
                <DatePicker value={passDate} onChange={(v) => setPassDate(v || '')} />
              </Field>
              <Field label="Код подразделения">
                <TextInput value={passCode} onChange={setPassCode} placeholder="000-000" />
              </Field>
              <Field label="Дата рождения">
                <DatePicker value={birthDate} onChange={(v) => setBirthDate(v || '')} />
              </Field>
              <Field label="Место рождения">
                <TextInput value={birthPlace} onChange={setBirthPlace} />
              </Field>
              <div className="col-span-2">
                <Field label="Адрес регистрации">
                  <TextInput value={regAddress} onChange={setRegAddress} />
                </Field>
              </div>
              <Field label="ИНН">
                <INNInput value={inn} onChange={setInn} />
              </Field>
              <Field label="СНИЛС">
                <TextInput value={snils} onChange={setSnils} placeholder="000-000-000 00" />
              </Field>
            </div>
            <div style={{
              marginTop: 14, padding: 10,
              background: 'var(--warn-bg)',
              border: '1px solid var(--brd-2)',
              borderRadius: 'var(--r-sm)',
              fontSize: 12.5,
              color: 'var(--warn-t)'
            }}>
              ⚠ Персональные данные. Не передавать третьим лицам без согласия сотрудника.
            </div>
          </>
        )}
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={() => close()}>Отмена</Btn>
        {tab === 'pay' && (
          <Btn variant="primary" onClick={savePay} disabled={savingPay}>
            {savingPay ? 'Сохраняем…' : 'Сохранить'}
          </Btn>
        )}
        {tab === 'pii' && canEditPii && (
          <Btn variant="primary" onClick={savePii} disabled={savingPii}>
            {savingPii ? 'Сохраняем…' : 'Сохранить ПД'}
          </Btn>
        )}
      </MFoot>
    </MCard>
  );
}
