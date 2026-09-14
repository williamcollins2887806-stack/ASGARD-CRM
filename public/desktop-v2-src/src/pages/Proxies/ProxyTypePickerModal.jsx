/**
 * Выбор типа доверенности — спокойная сетка без emoji-шума.
 */
import { useModal } from '@/modals';
import { MCard, MHead, MBody, Btn } from '@/modals/parts';
import { PROXY_TYPES } from './api';

export function ProxyTypePickerModal({ onPick }) {
  const { close } = useModal();
  return (
    <MCard className="modal-wide">
      <MHead
        title="Новая доверенность"
        subtitle="Выберите тип — откроется форма с нужными полями"
        accent="info"
        onClose={close}
      />
      <MBody>
        <div className="prx-typegrid">
          {PROXY_TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              className="prx-typecard"
              onClick={() => { close(); onPick?.(t); }}
            >
              <div className="prx-typecard-ttl">{t.label}</div>
              <div className="prx-typecard-desc">{t.desc}</div>
            </button>
          ))}
        </div>
        <div className="prx-modal-foot">
          <Btn onClick={close}>Отмена</Btn>
        </div>
      </MBody>
    </MCard>
  );
}
