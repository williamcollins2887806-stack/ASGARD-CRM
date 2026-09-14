/**
 * Chooser — краткое vs полное КП (паритет vanilla openCreateChooser).
 */
import { useModal } from '@/modals';
import { MCard, MHead, MBody, Btn } from '@/modals/parts';
import { TkpFormModal } from './TkpForm';
import { FullKpFormModal } from './FullKpFormModal';

export function CreateTkpChooser({ onCreated }) {
  const { close, open } = useModal();

  const pickClassic = () => {
    close();
    open(<TkpFormModal />);
  };
  const pickFull = () => {
    close();
    open(<FullKpFormModal onSaved={onCreated} />);
  };

  return (
    <MCard className="modal-sm">
      <MHead icon="📄" title="Создать ТКП" subtitle="Какой вариант коммерческого предложения?" onClose={close} />
      <MBody>
        <div className="col gap-12">
          <Btn onClick={pickClassic} style={{ textAlign: 'left', padding: '14px 16px', height: 'auto' }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Краткое ТКП</div>
            <div style={{ fontSize: 12, color: 'var(--t-3)', fontWeight: 400 }}>Стандартная форма: заказчик, описание, таблица работ, условия</div>
          </Btn>
          <Btn onClick={pickFull} style={{ textAlign: 'left', padding: '14px 16px', height: 'auto', borderColor: 'var(--gold)', background: 'var(--gold-bg, rgba(212,168,67,0.08))' }}>
            <div style={{ fontWeight: 700, marginBottom: 4, color: 'var(--gold)' }}>Полное КП</div>
            <div style={{ fontSize: 12, color: 'var(--t-3)', fontWeight: 400 }}>Развёрнутый шаблон: условия, периметр, аппараты, сдача, риски</div>
          </Btn>
        </div>
      </MBody>
    </MCard>
  );
}
