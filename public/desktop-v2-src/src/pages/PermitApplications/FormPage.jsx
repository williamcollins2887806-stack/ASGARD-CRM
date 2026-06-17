/**
 * FormPage — страница создания/редактирования заявки.
 * Источник: vanilla permit_applications.js → renderForm.
 *
 * Хеш `/permit-application-form` или `/permit-application-form?id=NN`.
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TextInput, TextareaInput, Combobox } from '@/inputs/Inputs';

import EmployeeSelectModal from './EmployeeSelectModal';
import PermitSelectModal from './PermitSelectModal';
import SendConfirmModal from './SendConfirmModal';
import {
  loadAppTypes, loadEmployees, loadApplication,
  createApplication, updateApplication, downloadExcel,
  lookupContractors, downloadBlob,
  CATEGORIES, ALLOWED_ROLES, shortPermitName
} from './api';

import './permit-applications.css';

export default function FormPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [permitTypes, setPermitTypes] = useState([]);
  const [employees, setEmployees]     = useState([]);
  const [loaded, setLoaded]           = useState(false);

  const [appId, setAppId]                       = useState(null);
  const [contractorName, setContractorName]     = useState('');
  const [contractorEmail, setContractorEmail]   = useState('');
  const [title, setTitle]                       = useState('');
  const [coverLetter, setCoverLetter]           = useState('');
  const [items, setItems]                       = useState([]); // [{employee_id, employee, permit_type_ids, existing_permits, notes}]
  const [contractorOpts, setContractorOpts]     = useState([]);
  const [busy, setBusy]                         = useState(false);

  const isAllowed = ALLOWED_ROLES.includes(user?.role);

  // Парсим id из хеша
  useEffect(() => {
    const m = (window.location.hash || '').match(/[?&]id=(\d+)/);
    if (m && m[1]) setAppId(Number(m[1]));
  }, []);

  useEffect(() => {
    if (!isAllowed) return;
    Promise.all([loadAppTypes(), loadEmployees()])
      .then(([types, emps]) => {
        setPermitTypes(types);
        setEmployees((emps || []).filter((e) => e.status !== 'fired' && (e.fio || e.full_name || '').trim()));
        setLoaded(true);
      })
      .catch((e) => toast.error('Ошибка: ' + (e?.message || e)));
  }, [isAllowed]);

  useEffect(() => {
    if (!appId || !loaded) return;
    loadApplication(appId)
      .then((data) => {
        const app = data.application;
        if (app.status !== 'draft' && user?.role !== 'ADMIN') {
          toast.error('Редактировать можно только черновик');
          window.location.hash = '#/permit-applications';
          return;
        }
        setContractorName(app.contractor_name || '');
        setContractorEmail(app.contractor_email || '');
        setTitle(app.title || '');
        setCoverLetter(app.cover_letter || '');
        setItems((data.items || []).map((it) => ({
          employee_id: it.employee_id,
          employee: {
            id: it.employee_id,
            fio: it.employee_fio || '',
            role_tag: it.employee_role_tag || '',
            phone: it.employee_phone || ''
          },
          permit_type_ids: it.permit_type_ids || [],
          existing_permits: it.existing_permits || [],
          notes: it.notes || ''
        })));
      })
      .catch((e) => {
        toast.error('Ошибка: ' + (e?.message || e));
        window.location.hash = '#/permit-applications';
      });
  }, [appId, loaded, user?.role]);

  const onAddEmployees = () => {
    const alreadyIds = items.map((i) => i.employee_id);
    const _filteredEmps = employees.filter((e) => !alreadyIds.includes(e.id));
    modal.open(<EmployeeSelectModal
      employees={employees}
      alreadySelected={alreadyIds}
      onConfirm={(selectedEmps) => {
        setItems((prev) => {
          const map = new Map(prev.map((i) => [i.employee_id, i]));
          selectedEmps.forEach((e) => {
            if (!map.has(e.id)) {
              map.set(e.id, {
                employee_id: e.id,
                employee: e,
                permit_type_ids: [],
                existing_permits: [],
                notes: ''
              });
            }
          });
          return [...map.values()];
        });
      }}
    />, { size: 'wide' });
  };

  const onRemoveEmp = (empId) => {
    setItems((prev) => prev.filter((i) => i.employee_id !== empId));
  };

  const onEditPermits = (item) => {
    const otherItems = items.filter((i) => i.employee_id !== item.employee_id && i.permit_type_ids.length > 0);
    modal.open(<PermitSelectModal
      employeeName={item.employee?.fio || ''}
      currentTypeIds={item.permit_type_ids || []}
      existingPermits={item.existing_permits || []}
      permitTypes={permitTypes}
      otherEmpsItems={otherItems}
      onConfirm={(newIds) => {
        setItems((prev) => prev.map((i) =>
          i.employee_id === item.employee_id ? { ...i, permit_type_ids: newIds } : i
        ));
      }}
    />, { size: 'wide' });
  };

  const onNotesChange = (empId, val) => {
    setItems((prev) => prev.map((i) =>
      i.employee_id === empId ? { ...i, notes: val } : i
    ));
  };

  const validate = () => {
    if (!contractorName || contractorName.trim().length < 2) {
      toast.warn('Укажите подрядчика');
      return false;
    }
    if (items.length === 0) {
      toast.warn('Добавьте сотрудников');
      return false;
    }
    const hasEmpty = items.some((i) => !i.permit_type_ids || i.permit_type_ids.length === 0);
    if (hasEmpty) {
      toast.warn('Для всех сотрудников выберите разрешения');
      return false;
    }
    return true;
  };

  const buildPayload = () => ({
    title: title || null,
    contractor_name: contractorName.trim(),
    contractor_email: contractorEmail.trim() || null,
    cover_letter: coverLetter || null,
    items: items.map((i) => ({
      employee_id: i.employee_id,
      permit_type_ids: i.permit_type_ids,
      notes: i.notes || ''
    }))
  });

  const onSave = async () => {
    if (!validate()) return;
    setBusy(true);
    try {
      const payload = buildPayload();
      if (appId) {
        await updateApplication(appId, payload);
        toast.success('Заявка обновлена');
      } else {
        const r = await createApplication(payload);
        const newId = r?.application?.id;
        if (newId) setAppId(newId);
        toast.success('Заявка создана: ' + (r?.application?.number || ''));
      }
      try { window.dispatchEvent(new CustomEvent('asgard:permit-apps:changed')); } catch { /* noop */ }
    } catch (e) {
      toast.error('Ошибка: ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const onDownloadExcel = async () => {
    if (!appId) {
      toast.warn('Сначала сохраните заявку');
      return;
    }
    try {
      const blob = await downloadExcel(appId);
      downloadBlob(blob, 'реестр.xlsx');
    } catch (e) {
      toast.error('Ошибка: ' + (e?.message || e));
    }
  };

  const onSend = async () => {
    if (!validate()) return;
    // Сохраняем сначала
    setBusy(true);
    try {
      const payload = buildPayload();
      let appData;
      if (appId) {
        await updateApplication(appId, payload);
        appData = await loadApplication(appId);
      } else {
        const r = await createApplication(payload);
        const newId = r?.application?.id;
        if (newId) {
          setAppId(newId);
          appData = await loadApplication(newId);
        }
      }
      setBusy(false);
      if (!appData?.application) return;
      modal.open(<SendConfirmModal
        application={appData.application}
        onSuccess={() => { window.location.hash = '#/permit-applications'; }}
      />);
    } catch (e) {
      toast.error('Ошибка: ' + (e?.message || e));
      setBusy(false);
    }
  };

  const summary = useMemo(() => {
    const emp = items.length;
    const perm = items.reduce((s, i) => s + (i.permit_type_ids || []).length, 0);
    return { emp, perm };
  }, [items]);

  if (!isAllowed) {
    return (
      <div className="card p-32 t-center" >
        <div className="fs-32 opacity-half mb-12">🔒</div>
        <div className="fs-16 fw-700">Доступ закрыт</div>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="card card-empty" >⏳ Загружаем…</div>
    );
  }

  return (
    <div className="pa-form">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 6 }}>
        <Btn variant="ghost" onClick={() => { window.location.hash = '#/permit-applications'; }}>← Назад к списку</Btn>
        <span className="fs-18 fw-700">
          {appId ? 'Редактирование заявки' : 'Новая заявка на оформление'}
        </span>
      </div>

      {/* Подрядчик */}
      <div className="pa-card">
        <h3>Подрядчик</h3>
        <div className="grid-2 gap-14">
          <div>
            <div className="fs-13 mb-6">Компания-подрядчик *</div>
            <Combobox
              value={contractorName}
              onChange={(v, opt) => {
                setContractorName(v);
                if (opt?.email) setContractorEmail(opt.email);
              }}
              options={contractorOpts}
              placeholder="ООО «Центр Безопасности»"
              allowFreeText
              onQuery={async (q) => {
                const list = await lookupContractors(q);
                setContractorOpts(list.map((c) => ({ value: c.name, label: c.name, email: c.email })));
              }}
            />
          </div>
          <div>
            <div className="fs-13 mb-6">Email подрядчика *</div>
            <TextInput type="email" value={contractorEmail} onChange={setContractorEmail} placeholder="permits@company.ru" />
          </div>
        </div>
        <div className="mt-12">
          <div className="fs-13 mb-6">Комментарий</div>
          <TextInput value={title} onChange={setTitle} placeholder="Описание заявки (необязательно)" />
        </div>
      </div>

      {/* Сотрудники */}
      <div className="pa-card">
        <div className="row-spread mb-12">
          <h3 className="m-0">Сотрудники и разрешения</h3>
          <Btn variant="primary" onClick={onAddEmployees}>+ Добавить сотрудников</Btn>
        </div>

        {items.length === 0 ? (
          <div className="t-center p-40 c-t3">
            Нажмите «+ Добавить сотрудников» чтобы начать
          </div>
        ) : (
          <div className="ov-x-auto">
            <table className="pa-emp-table">
              <thead>
                <tr>
                  <th className="w-40"></th>
                  <th>ФИО</th>
                  <th className="w-130">Должность</th>
                  <th>Разрешения</th>
                  <th className="w-160">Примечания</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const emp = it.employee || {};
                  return (
                    <tr key={it.employee_id}>
                      <td>
                        <Btn size="sm" variant="ghost" onClick={() => onRemoveEmp(it.employee_id)} title="Убрать">✕</Btn>
                      </td>
                      <td className="fw-600">{emp.fio || emp.full_name || `Сотрудник #${it.employee_id}`}</td>
                      <td>
                        <span className="pa-perm-badge" style={{ background: 'var(--inner-bg)', color: 'var(--t-2)' }}>
                          {emp.role_tag || ''}
                        </span>
                      </td>
                      <td className="u-wrap">
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                          {(it.permit_type_ids || []).map((tid) => {
                            const pt = permitTypes.find((t) => t.id === tid);
                            if (!pt) return null;
                            const cat = CATEGORIES[pt.category] || { color: 'var(--t-3)' };
                            return (
                              <span
                                key={tid}
                                className="pa-perm-badge"
                                style={{
                                  background: `color-mix(in srgb, ${cat.color} 16%, transparent)`,
                                  color: cat.color
                                }}
                              >
                                {shortPermitName(pt.name)}
                              </span>
                            );
                          })}
                          {(!it.permit_type_ids || it.permit_type_ids.length === 0) && (
                            <span className="fs-11 c-t3">нет разрешений</span>
                          )}
                          <Btn size="sm" variant="ghost" onClick={() => onEditPermits(it)}>+ ещё</Btn>
                        </div>
                      </td>
                      <td>
                        <TextInput
                          value={it.notes}
                          onChange={(v) => onNotesChange(it.employee_id, v)}
                          placeholder="..."
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Сопроводительное письмо */}
      <details className="pa-card p-0" >
        <summary style={{ cursor: 'pointer', padding: 16, fontWeight: 600 }}>
          Сопроводительное письмо (нажмите для редактирования)
        </summary>
        <div style={{ padding: '0 20px 20px' }}>
          <TextareaInput value={coverLetter} onChange={setCoverLetter} minRows={8} maxRows={20} />
        </div>
      </details>

      {/* Sticky футер */}
      <div className="pa-sticky-footer">
        <div className="pa-summary">
          Сотрудников: <b>{summary.emp}</b>, разрешений: <b>{summary.perm}</b>
        </div>
        <div className="u-flex gap-10">
          <Btn variant="ghost"   onClick={onSave}          disabled={busy}>Сохранить черновик</Btn>
          <Btn variant="primary" onClick={onDownloadExcel} disabled={busy}>Скачать Excel</Btn>
          <Btn variant="success" onClick={onSend}          disabled={busy}>Отправить подрядчику</Btn>
        </div>
      </div>
    </div>
  );
}
