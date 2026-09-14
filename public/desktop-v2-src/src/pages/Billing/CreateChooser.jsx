import { useModal } from '@/modals';
import { MCard, MHead, MBody } from '@/modals/parts';
import { ConstructorModal } from './ConstructorModal';
import { RegisterModal } from './RegisterModal';
import './billing.css';

export function CreateChooser({ onCreated }) {
  const { close, open } = useModal();

  const issue = (kind) => {
    close();
    open(<ConstructorModal kind={kind} onSaved={onCreated} />, { size: 'full' });
  };
  const register = (kind) => {
    close();
    open(<RegisterModal kind={kind} onSaved={onCreated} />, { size: 'wide' });
  };

  return (
    <MCard className="modal-wide">
      <MHead
        icon="✦"
        title="Что делаем?"
        subtitle="Выставить новый документ конструктором или внести уже существующий"
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div className="bill-choose">
          <button type="button" className="bill-choose-card is-main" onClick={() => issue('invoice')}>
            <div className="badge">Конструктор</div>
            <div className="ttl">Выставить счёт</div>
            <div className="ds">Заказчик, позиции, НДС, живой лист, PDF / Word / Excel</div>
          </button>
          <button type="button" className="bill-choose-card is-main" onClick={() => issue('act')}>
            <div className="badge">Конструктор</div>
            <div className="ttl">Выставить акт</div>
            <div className="ds">Сдача-приёмка. Можно привязать работу и подтянуть заказчика</div>
          </button>
          <button type="button" className="bill-choose-card" onClick={() => register('invoice')}>
            <div className="badge">Реестр</div>
            <div className="ttl">Внести счёт</div>
            <div className="ds">Уже выставлен в 1С или на бумаге — только реестр</div>
          </button>
          <button type="button" className="bill-choose-card" onClick={() => register('act')}>
            <div className="badge">Реестр</div>
            <div className="ttl">Внести акт</div>
            <div className="ds">Готовый акт заказчика — зафиксировать без конструктора</div>
          </button>
          <div className="bill-choose-hint">Конструктор — основной путь. «Внести» — для входящих документов.</div>
        </div>
      </MBody>
    </MCard>
  );
}
