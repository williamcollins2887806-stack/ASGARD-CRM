/**
 * Модалка создания записи логистики.
 * Перенесена с vanilla travel.js openAddModal().
 */
import { useState, useEffect, useMemo } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import {
  TextInput, TextareaInput, SelectInput, NumberInput, Checkbox, DatePicker
} from '@/inputs/Inputs';

import {
  TYPE_OPTS, TRANSPORT_TYPES, HOUSING_TYPES, todayIso,
  createLogistics, uploadAttachment
} from './api';
import { validateFile, MAX_ATTACHMENT_SIZE } from '@/api/upload';

export function TravelAddModal({ employees, works, onSaved }) {
  const { close } = useModal();

  const [type, setType] = useState('ticket_to');
  const [employeeId, setEmployeeId] = useState('');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [depAt, setDepAt] = useState('');
  const [arrAt, setArrAt] = useState('');
  const [transNo, setTransNo] = useState('');
  const [hotelAddr, setHotelAddr] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [referralAt, setReferralAt] = useState('');
  const [dateFrom, setDateFrom] = useState(todayIso());
  const [dateTo, setDateTo] = useState('');
  const [amount, setAmount] = useState('');
  const [vat, setVat] = useState(false);
  const [workId, setWorkId] = useState('');
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);

  const isTransport = useMemo(() => TRANSPORT_TYPES.has(type), [type]);
  const isHousing   = useMemo(() => HOUSING_TYPES.has(type), [type]);
  const isTransfer  = type === 'transfer';
  const isDirective = type === 'directive_mo';

  const empOpts = useMemo(
    () => employees.map((e) => ({ value: String(e.id), label: e.fio || '—' })),
    [employees]
  );
  const workOpts = useMemo(
    () => works.map((w) => ({ value: String(w.id), label: w.work_title || ('Проект #' + w.id) })),
    [works]
  );

  // Если есть время вылета — подставим в date_from
  useEffect(() => {
    if (depAt && !dateFrom) setDateFrom(String(depAt).slice(0, 10));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depAt]);
  useEffect(() => {
    if (arrAt && !dateTo) setDateTo(String(arrAt).slice(0, 10));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrAt]);

  const submit = async () => {
    if (!type || !employeeId || !title.trim()) {
      toast.error('Заполните тип, сотрудника и название');
      return;
    }
    if (file) {
      // G-5: размер/тип вложения логистики.
      try {
        validateFile(file, { maxSize: MAX_ATTACHMENT_SIZE, accept: '.pdf,.jpg,.jpeg,.png,.doc,.docx' });
      } catch (vErr) {
        toast.error(vErr?.message || 'Файл не подходит'); return;
      }
    }
    setSaving(true);
    try {
      const result = await createLogistics({
        item_type: type,
        employee_id: parseInt(employeeId, 10),
        title: title.trim(),
        description: desc.trim() || null,
        date_from: dateFrom || null,
        date_to: dateTo || null,
        departure_at: depAt ? new Date(depAt).toISOString() : null,
        arrival_at: arrAt ? new Date(arrAt).toISOString() : null,
        transport_no: transNo.trim() || null,
        hotel_address: hotelAddr.trim() || null,
        driver_phone: driverPhone.trim() || null,
        referral_at: referralAt || null,
        amount: amount ? parseFloat(amount) : null,
        vat_included: vat,
        work_id: workId ? parseInt(workId, 10) : null
      });

      const logId = result?.logistics_id;
      if (file && logId) {
        try {
          await uploadAttachment(logId, file);
          toast.success('Запись и файл сохранены');
        } catch (e) {
          toast.warn('Запись создана, файл не загружен: ' + (e?.message || e));
        }
      } else {
        toast.success('Запись сохранена');
      }
      onSaved?.(type);
      close();
    } catch (e) {
      toast.error('Не удалось сохранить: ' + (e?.message || e));
      setSaving(false);
    }
  };

  return (
    <MCard>
      <MHead icon="➕" title="Новая запись логистики" onClose={() => close()} />
      <MBody>
        <div className="m-grid-2">
          <Field label="Тип" required>
            <SelectInput value={type} onChange={setType} options={TYPE_OPTS} placeholder="— выбрать —" />
          </Field>
          <Field label="Сотрудник" required>
            <SelectInput value={employeeId} onChange={setEmployeeId} options={empOpts} placeholder="— выбрать —" />
          </Field>
          <div className="col-span-2">
            <Field label="Название / Маршрут" required>
              <TextInput
                value={title}
                onChange={setTitle}
                placeholder="Авиабилет Саратов–Москва / Гостиница «Охотник» / Направление на МО"
              />
            </Field>
          </div>
          <div className="col-span-2">
            <Field label="Описание (необязательно)">
              <TextareaInput
                value={desc}
                onChange={setDesc}
                placeholder="Рейс SU-1234, № брони, инструктаж…"
                minRows={2}
              />
            </Field>
          </div>

          {isTransport && (
            <>
              <Field label="🛫 Вылет (дата и время)">
                <input
                  type="datetime-local"
                  className="m-input"
                  value={depAt}
                  onChange={(e) => setDepAt(e.target.value)}
                />
              </Field>
              <Field label="🛬 Прилёт (дата и время)">
                <input
                  type="datetime-local"
                  className="m-input"
                  value={arrAt}
                  onChange={(e) => setArrAt(e.target.value)}
                />
              </Field>
              <div className="col-span-2">
                <Field label="№ рейса / поезда">
                  <TextInput value={transNo} onChange={setTransNo} placeholder="SU-1402 / поезд 092Э" />
                </Field>
              </div>
            </>
          )}

          {isHousing && (
            <div className="col-span-2">
              <Field label="📍 Адрес гостиницы / жилья" help="Чтобы рабочий доехал по навигатору.">
                <TextInput
                  value={hotelAddr}
                  onChange={setHotelAddr}
                  placeholder='г. Москва, ул. Тверская 1, оф. 101'
                />
              </Field>
            </div>
          )}

          {isTransfer && (
            <div className="col-span-2">
              <Field label="📞 Телефон водителя" help="Кому позвонить по приезде.">
                <TextInput value={driverPhone} onChange={setDriverPhone} placeholder="+7 999 123 45 67" />
              </Field>
            </div>
          )}

          {isDirective && (
            <Field label="🩺 Дата выдачи направления" help="День, когда сотрудник получил направление на руки.">
              <DatePicker value={referralAt} onChange={(v) => setReferralAt(v || '')} />
            </Field>
          )}

          <Field label="Дата (с)">
            <DatePicker value={dateFrom} onChange={(v) => setDateFrom(v || '')} />
          </Field>
          <Field label="Дата (по)">
            <DatePicker value={dateTo} onChange={(v) => setDateTo(v || '')} />
          </Field>

          <Field label="Сумма (₽)">
            <NumberInput value={amount} onChange={setAmount} min={0} step={100} placeholder="0" />
          </Field>
          <div style={{ alignSelf: 'end', paddingBottom: 8 }}>
            <Checkbox checked={vat} onChange={setVat} label="С НДС" />
          </div>

          <div className="col-span-2">
            <Field label="Работа (привязать расход)" help="Если указана работа и сумма — расход добавится автоматически.">
              <SelectInput value={workId} onChange={setWorkId} options={workOpts} placeholder="— не привязано —" />
            </Field>
          </div>

          <div className="col-span-2">
            <Field label="Файл (билет / ваучер / направление)">
              <input
                type="file"
                className="m-input"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </Field>
          </div>
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={() => close()} disabled={saving}>Отмена</Btn>
        <Btn variant="primary" onClick={submit} disabled={saving}>
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
