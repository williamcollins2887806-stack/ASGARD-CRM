/**
 * Заявка на пропуск — из карточки тендера.
 * Источник: vanilla `public/assets/js/tenders.js → openPassRequestFromTender (строки 4271..4441)`.
 * Endpoint: POST /api/pass-requests
 * Поля payload: work_id, object_name, pass_date_from, pass_date_to, contact_person,
 *               contact_phone, employees_json, vehicles_json, notes.
 *
 * Сотрудники собираются из /api/users (активные) + ручной ввод дополнительных ФИО.
 * Транспорт — текстарея, парс «<марка> <номер>» по строкам.
 */
import { useState, useEffect, useMemo } from 'react';
import { api } from '@/api/client';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import {
  Field, TextInput, TextareaInput, DatePicker, SearchInput, Checkbox
} from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';

function takeIso(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function parseVehicles(text) {
  const lines = (text || '').split('\n').map((s) => s.trim()).filter(Boolean);
  return lines.map((line) => {
    const parts = line.split(/\s+/);
    if (parts.length < 2) return { brand: 'ТС', plate: line };
    return { brand: parts.slice(0, -1).join(' ') || 'ТС', plate: parts[parts.length - 1] };
  });
}

export function PassRequestModal({ tender }) {
  const { close } = useModal();
  const [staff, setStaff] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [staffQuery, setStaffQuery] = useState('');
  const [extraEmps, setExtraEmps] = useState('');
  const [vehicles, setVehicles] = useState('');

  const [objectName, setObjectName] = useState(tender?.customer_name || tender?.tender_title || tender?.tender_name || '');
  const [dateFrom, setDateFrom] = useState(takeIso(tender?.work_start_plan));
  const [dateTo, setDateTo] = useState(takeIso(tender?.work_end_plan));
  const [contactPerson, setContactPerson] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [clientEmail, setClientEmail] = useState(tender?.client_email || '');
  const [notes, setNotes] = useState(tender?.tender_comment_to || '');
  const [busy, setBusy] = useState(false);

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const validateEmail = (val) => {
    const v = String(val || '').trim();
    if (!v) return true; // пусто допустимо (поле опциональное)
    return EMAIL_RE.test(v);
  };
  const onEmailBlur = () => {
    if (!validateEmail(clientEmail)) {
      toast.error('Некорректный email клиента');
    }
  };

  useEffect(() => {
    api('/api/users?limit=500')
      .then((d) => {
        const list = (d?.users || d?.items || []).filter((u) => u.is_active !== false && (u.name || u.login));
        setStaff(list);
      })
      .catch(() => setStaff([]));
  }, []);

  const filteredStaff = useMemo(() => {
    if (!staffQuery.trim()) return staff;
    const q = staffQuery.toLowerCase();
    return staff.filter((s) => {
      const name = (s.name || s.login || '').toLowerCase();
      const pos = (s.position || s.role || '').toLowerCase();
      return name.includes(q) || pos.includes(q);
    });
  }, [staff, staffQuery]);

  const toggleStaff = (id) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (!objectName.trim()) return toast('Проверка', 'Укажите объект', 'warn');
    if (!dateFrom || !dateTo) return toast('Проверка', 'Укажите даты пропуска', 'warn');
    if (!validateEmail(clientEmail)) {
      toast.error('Некорректный email клиента');
      return;
    }

    const employees = [];
    selected.forEach((id) => {
      const u = staff.find((s) => String(s.id) === String(id));
      if (u) {
        employees.push({
          fio: u.name || u.login || '',
          position: u.position || u.role || '',
          user_id: u.id
        });
      }
    });
    extraEmps.split('\n').map((s) => s.trim()).filter(Boolean).forEach((line) => {
      employees.push({ fio: line });
    });

    const parsedVehicles = parseVehicles(vehicles);

    const tenderTag = tender?.id ? `\n[Тендер #${tender.id}: ${tender.tender_title || tender.tender_name || ''}]` : '';

    const body = {
      work_id: tender?.work_id || null,
      object_name: objectName.trim(),
      pass_date_from: dateFrom,
      pass_date_to: dateTo,
      contact_person: contactPerson.trim(),
      contact_phone: contactPhone.trim(),
      client_email: clientEmail.trim(),
      employees_json: employees,
      vehicles_json: parsedVehicles,
      notes: (notes || '') + tenderTag
    };

    setBusy(true);
    try {
      const res = await api('/api/pass-requests', { method: 'POST', body: body });
      toast('Готово', 'Заявка на пропуск создана', 'ok');
      // Открыть PDF в новом окне для скачивания/отправки заказчику
      // (vanilla tenders.js:4429 — `/api/pass-requests/:id/pdf`).
      const id = res?.item?.id || res?.id;
      if (id) {
        try {
          // PDF через blob с Authorization-header (без токена в URL — иначе утечка в логи/Referer)
          const { openProtected } = await import('@/api/download');
          await openProtected('/api/pass-requests/' + id + '/pdf', `pass_request_${id}.pdf`);
        } catch (_) { /* popup blocked / fetch error — не критично */ }
      }
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-lg">
      <MHead
        icon="🔑"
        title="Заявка на пропуск"
        subtitle={tender?.id ? `Тендер #${tender.id} · ${tender.customer_name || ''}` : ''}
      />
      <MBody>
        <div className="col gap-14">
          <Field label="Объект (название)" required>
            <TextInput value={objectName} onChange={setObjectName} placeholder="Название объекта" />
          </Field>

          <div className="grid-2 gap-12">
            <Field label="Дата с" required>
              <DatePicker value={dateFrom} onChange={setDateFrom} />
            </Field>
            <Field label="Дата по" required>
              <DatePicker value={dateTo} onChange={setDateTo} />
            </Field>
          </div>

          <div className="grid-2 gap-12">
            <Field label="Контактное лицо">
              <TextInput value={contactPerson} onChange={setContactPerson} placeholder="ФИО" />
            </Field>
            <Field label="Телефон">
              <TextInput value={contactPhone} onChange={setContactPhone} placeholder="+7…" />
            </Field>
          </div>

          <Field label="Email клиента" help="Для отправки PDF-пропуска заказчику">
            <TextInput
              value={clientEmail}
              onChange={setClientEmail}
              onBlur={onEmailBlur}
              placeholder="client@example.com"
              type="email"
            />
          </Field>

          <div>
            <div className="modal-section-title">
              👥 Сотрудники ({selected.size} выбрано)
            </div>
            <SearchInput value={staffQuery} onChange={setStaffQuery} placeholder="Поиск по ФИО / должности" />
            <div className="pick-list">
              {filteredStaff.length === 0 && (
                <div className="pick-list-empty">
                  Никого не нашли
                </div>
              )}
              {filteredStaff.map((u) => (
                <div
                  key={u.id}
                  className={'pick-row' + (selected.has(u.id) ? ' is-active' : '')}
                  onClick={() => toggleStaff(u.id)}
                >
                  <Checkbox checked={selected.has(u.id)} onChange={() => toggleStaff(u.id)} />
                  <div className="pick-row-main">
                    <div className="pick-row-name">{u.name || u.login}</div>
                    {(u.position || u.role) && (
                      <div className="pick-row-sub">{u.position || u.role}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Field label="Дополнительные сотрудники (ФИО, по одному на строку)">
            <TextareaInput
              value={extraEmps}
              onChange={setExtraEmps}
              placeholder="Иванов Иван Иванович"
              minRows={2}
              maxRows={4}
            />
          </Field>

          <Field label="Транспорт (марка + номер, по одному на строку)" help="Газель А123БВ77">
            <TextareaInput
              value={vehicles}
              onChange={setVehicles}
              placeholder="Газель А123БВ77"
              minRows={2}
              maxRows={4}
            />
          </Field>

          <Field label="Примечания">
            <TextareaInput value={notes} onChange={setNotes} minRows={2} maxRows={4} />
          </Field>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={submit}>
          {busy ? 'Сохраняем…' : '🔑 Создать заявку'}
        </Btn>
      </MFoot>
    </MCard>
  );
}

export default PassRequestModal;
