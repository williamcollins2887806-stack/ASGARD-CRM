import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { SelectInput, TextInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { STATUS_OPTIONS, updateProxy, sendProxy } from './api';

function emit() { window.dispatchEvent(new CustomEvent('asgard:proxies:changed')); }

export function ProxyStatusModal({ proxy, onDone }) {
  const { close } = useModal();
  const [status, setStatus] = useState(
    proxy.status === 'revoked' ? 'annulled' : (proxy.status || 'created')
  );
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await updateProxy(proxy.id, { status });
      toast.success('Статус обновлён');
      emit();
      onDone?.();
      close();
    } catch (e) {
      toast.error(e?.message || 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-sm">
      <MHead title="Сменить статус" subtitle={`№ ${proxy.number || proxy.id}`} onClose={close} />
      <MBody>
        <Field label="Статус">
          <SelectInput value={status} onChange={setStatus} options={STATUS_OPTIONS} />
        </Field>
      </MBody>
      <MFoot align="end">
        <Btn onClick={close} disabled={busy}>Отмена</Btn>
        <Btn variant="primary" onClick={save} disabled={busy}>Сохранить</Btn>
      </MFoot>
    </MCard>
  );
}

export function ProxySendModal({ proxy, onDone }) {
  const { close } = useModal();
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!to.trim()) {
      toast.error('Укажите email');
      return;
    }
    setBusy(true);
    try {
      await sendProxy(proxy.id, { to: to.trim(), prefer_signed: !!proxy.signed_file_url });
      toast.success('Отправлено');
      emit();
      onDone?.();
      close();
    } catch (e) {
      toast.error(e?.message || 'Ошибка отправки');
    } finally {
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-sm">
      <MHead
        title="Отправить доверенность"
        subtitle={`№ ${proxy.number || proxy.id} — ${proxy.fio || '—'}`}
        onClose={close}
      />
      <MBody>
        <Field label="Email получателя" required>
          <TextInput value={to} onChange={setTo} placeholder="email@example.com" />
        </Field>
      </MBody>
      <MFoot align="end">
        <Btn onClick={close} disabled={busy}>Отмена</Btn>
        <Btn variant="primary" onClick={send} disabled={busy}>Отправить</Btn>
      </MFoot>
    </MCard>
  );
}
