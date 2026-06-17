/**
 * Точка входа открытия тендера — диспатчер «новый / существующий».
 *  • без tenderId  → 3-шаговый wizard создания
 *  • с tenderId    → карточка тендера с табами Карточка / Документы / Комментарии / ДС / История
 *
 * Размещён в отдельном файле, чтобы избежать циклической зависимости:
 * TenderEditor.jsx экспортит и сам wizard и эту обёртку — но обёртке нужен CardModal,
 * который, в свою очередь, импортит wizard. Через этот файл импорты идут строго вниз:
 *   index.jsx → TenderEditor.dispatch → { TenderCardModal | TenderEditorWizard } → деталь
 */
import { TenderCardModal } from './TenderCardModal';
import { TenderEditorWizard } from './TenderEditor';

export function TenderEditorModal({ tenderId }) {
  if (tenderId) return <TenderCardModal tenderId={tenderId} />;
  return <TenderEditorWizard tenderId={null} />;
}
