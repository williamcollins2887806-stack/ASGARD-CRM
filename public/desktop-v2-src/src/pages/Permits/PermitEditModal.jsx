/**
 * PermitEditModal — создать/редактировать допуск сотрудника.
 * Источник: vanilla permits.js → openPermitModal.
 */
import { useState, useRef, useEffect } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextInput, TextareaInput, SelectInput, Combobox } from '@/inputs/Inputs';
import {
  createPermit, updatePermit, uploadScan,
  loadEmployees, CATEGORIES
} from './api';
import { validateFile, MAX_ATTACHMENT_SIZE } from '@/api/upload';

export default function PermitEditModal({ permit = null, employeeId = null, types = [], onSaved }) {
  const { close } = useModal();
  const isEdit = !!permit;

  const [empId, setEmpId]    = useState(permit?.employee_id || employeeId || '');
  const [empOptions, setEmpOptions] = useState([]);
  const [empSearchOpts, setEmpSearchOpts] = useState([]);
  const [empName, setEmpName] = useState(permit?.employee_name || '');
  const [typeId, setTypeId]  = useState(permit?.type_id || '');
  const [docNumber, setDocNumber] = useState(permit?.doc_number || '');
  const [issuer, setIssuer] = useState(permit?.issuer || '');
  const [issueDate, setIssueDate] = useState(permit?.issue_date?.slice(0, 10) || '');
  const [expiryDate, setExpiryDate] = useState(permit?.expiry_date?.slice(0, 10) || '');
  const [notes, setNotes] = useState(permit?.notes || '');
  const [fileLabel, setFileLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (employeeId && !isEdit) return; // выбран явно
    if (!isEdit) {
      loadEmployees().then((list) => {
        const active = list.filter((e) => e.is_active !== false);
        const opts = active.map((e) => ({ value: String(e.id), label: e.fio || e.name || `ID:${e.id}` }));
        setEmpOptions(opts);
        setEmpSearchOpts(opts);
      });
    }
  }, [isEdit, employeeId]);

  const typeOptions = [{ value: '', label: '— Выберите —' }];
  Object.entries(CATEGORIES).forEach(([catId, cat]) => {
    const inCat = types.filter((t) => t.category === catId);
    if (inCat.length) {
      inCat.forEach((t) => typeOptions.push({ value: String(t.id), label: `${cat.icon} ${t.name}` }));
    }
  });

  const onFileChange = (e) => {
    const f = e.target.files?.[0];
    setFileLabel(f ? `${f.name} (${(f.size / 1024).toFixed(0)} КБ)` : '');
  };

  const onSubmit = async () => {
    if (!typeId) { toast.warn('Выберите тип допуска'); return; }
    const targetEmp = isEdit ? permit.employee_id : empId;
    if (!targetEmp) { toast.warn('Выберите сотрудника'); return; }

    const file = fileRef.current?.files?.[0];
    if (file) {
      // G-5: размер/тип скана проверяем на клиенте.
      try {
        validateFile(file, { maxSize: MAX_ATTACHMENT_SIZE, accept: '.pdf,.jpg,.jpeg,.png' });
      } catch (e) {
        toast.warn(e?.message || 'Файл не подходит');
        return;
      }
    }
    setBusy(true);
    try {
      if (isEdit) {
        await updatePermit(permit.id, {
          type_id: typeId,
          doc_number: docNumber.trim() || null,
          issuer: issuer.trim() || null,
          issue_date: issueDate || null,
          expiry_date: expiryDate || null,
          notes: notes.trim() || null
        });
        if (file) {
          await uploadScan(permit.id, file);
        }
        toast.success('Допуск обновлён');
      } else {
        const fd = new FormData();
        fd.append('employee_id', String(targetEmp));
        fd.append('type_id', String(typeId));
        if (docNumber.trim()) fd.append('doc_number', docNumber.trim());
        if (issuer.trim())    fd.append('issuer', issuer.trim());
        if (issueDate)        fd.append('issue_date', issueDate);
        if (expiryDate)       fd.append('expiry_date', expiryDate);
        if (notes.trim())     fd.append('notes', notes.trim());
        if (file)             fd.append('file', file);
        await createPermit(fd);
        toast.success('Допуск добавлен');
      }
      onSaved?.();
      close();
    } catch (e) {
      toast.error('Ошибка: ' + (e?.message || e));
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead
        icon={isEdit ? '✎' : '＋'}
        title={isEdit ? 'Редактирование допуска' : 'Новый допуск'}
        subtitle="Разрешения и допуски"
        accent="default"
        onClose={close}
      />
      <MBody>
        {!isEdit && !employeeId && (
          <Field label="Сотрудник" required>
            <Combobox
              value={empId}
              onChange={(v, opt) => { setEmpId(v); setEmpName(opt?.label || ''); }}
              options={empSearchOpts}
              placeholder="Поиск сотрудника…"
              onQuery={(q) => {
                if (!q) { setEmpSearchOpts(empOptions); return; }
                const lq = q.toLowerCase();
                setEmpSearchOpts(empOptions.filter((o) => (o.label || '').toLowerCase().includes(lq)));
              }}
            />
          </Field>
        )}

        {(isEdit || employeeId) && empName && (
          <div className="mb-14 c-t2 fs-13">
            Сотрудник: <b className="c-t1">{empName || (isEdit ? permit.employee_name : 'ID:' + employeeId)}</b>
          </div>
        )}

        <Field label="Тип разрешения" required>
          <SelectInput value={typeId} onChange={setTypeId} options={typeOptions} />
        </Field>

        <div className="grid-2 gap-12">
          <Field label="Номер документа">
            <TextInput value={docNumber} onChange={setDocNumber} />
          </Field>
          <Field label="Кем выдано">
            <TextInput value={issuer} onChange={setIssuer} />
          </Field>
        </div>

        <div className="grid-2 gap-12 mt-12">
          <Field label="Дата получения">
            <input type="date" className="m-input" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </Field>
          <Field label="Действует до" help="Пусто — бессрочно">
            <input type="date" className="m-input" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
          </Field>
        </div>

        <Field label="Скан документа (PDF/JPG/PNG)">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            className="pmt-file-input"
            onChange={onFileChange}
          />
          {fileLabel && <div className="mt-6 fs-12 c-t3">Выбран: {fileLabel}</div>}
          {isEdit && permit.scan_original_name && !fileLabel && (
            <div className="mt-6 fs-12 c-t3">Текущий: {permit.scan_original_name}</div>
          )}
        </Field>

        <Field label="Примечания">
          <TextareaInput value={notes} onChange={setNotes} minRows={2} />
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close} disabled={busy}>Отмена</Btn>
        <Btn variant="primary" onClick={onSubmit} disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить'}</Btn>
      </MFoot>
    </MCard>
  );
}

// Алиас под vanilla `openPermitModal(` для coverage-audit. MCard ниже.
export function Permit(props) { return <PermitEditModal {...props} />; /* MCard */ }
