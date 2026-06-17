import { useState, useEffect, useRef } from 'react';
import { useModal } from './ModalProvider';
import { MCard, MHead, MBody, MFoot, Btn } from './parts';

/**
 * Многошаговый wizard.
 * steps = [{ key, title, render: (state, setState) => JSX, canNext: (state)=>bool }]
 *
 * Опциональные props:
 *   - onStateChange(state) — синхронный колбэк при каждом изменении state.
 *     Используется для auto-save (LS drafts). НЕ для бизнес-логики.
 *   - bannerSlot — JSX, рисуется между stepper'ом и body (для restore-banner).
 *   - closeGuard(state) => Promise<boolean|null>
 *     Вызывается при попытке отмены. Возвращает:
 *       true  — закрыть как обычно
 *       false — отменить закрытие
 *       null  — отменить закрытие (родитель уже открыл свою подтверждалку)
 */
export function WizardModal({
  title = 'Мастер',
  subtitle,
  icon = '🪄',
  accent = 'purple',
  steps = [],
  initial = {},
  finishText = 'Готово',
  onFinish,
  onCancel,
  onStateChange,
  bannerSlot,
  closeGuard,
  setStateRef  // ref-объект { current: setter } — даём родителю прямой доступ к setState
}) {
  const { close } = useModal();
  const [idx, setIdx] = useState(0);
  const [state, setStateRaw] = useState(initial);
  const [busy, setBusy] = useState(false);
  const cur = steps[idx];
  const isLast = idx === steps.length - 1;
  const canNext = cur?.canNext ? cur.canNext(state) : true;

  // Обёртка для setState: сохраняем стандартный API (объект или функция),
  // и вызываем onStateChange после рендера через ref-сравнение.
  const onChangeRef = useRef(onStateChange);
  onChangeRef.current = onStateChange;

  const setState = (next) => {
    setStateRaw((prev) => {
      const computed = typeof next === 'function' ? next(prev) : next;
      // Откладываем колбэк до следующего тика, чтобы не мешать React batching.
      if (onChangeRef.current) {
        queueMicrotask(() => {
          try { onChangeRef.current?.(computed); } catch { /* noop */ }
        });
      }
      return computed;
    });
  };

  // Полная замена initial → state (для restore-баннера из родителя).
  // Меняем initial-ссылку — пересинхрон через ref-stamp.
  const initialStampRef = useRef(initial);
  useEffect(() => {
    if (initial !== initialStampRef.current) {
      initialStampRef.current = initial;
      setStateRaw(initial);
    }
  }, [initial]);

  // Пробрасываем setState родителю через ref (для inline-патчей типа «подставить созданного контрагента»).
  useEffect(() => {
    if (setStateRef) setStateRef.current = setState;
    return () => { if (setStateRef && setStateRef.current === setState) setStateRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCancel = async () => {
    if (closeGuard) {
      let allow;
      try { allow = await closeGuard(state); } catch { allow = true; }
      if (allow === false || allow == null) return; // null = guard сам открыл диалог
    }
    onCancel?.();
    close();
  };

  const finish = async () => {
    if (!canNext) return;
    setBusy(true);
    try { await onFinish?.(state); close(); } catch { setBusy(false); }
  };

  return (
    <MCard>
      <MHead icon={icon} title={title} subtitle={subtitle ?? cur?.title} accent={accent} onClose={handleCancel} />
      <div className="m-stepper">
        {steps.map((s, i) => (
          <span key={s.key} className="contents">
            <div className={'m-step ' + (i < idx ? 'done ' : i === idx ? 'active ' : '')}>
              <div className="num">{i < idx ? '✓' : i + 1}</div>
              <span>{s.title}</span>
            </div>
            {i < steps.length - 1 && <div className="m-step-sep" />}
          </span>
        ))}
      </div>
      {bannerSlot ? <div className="m-body" style={{ paddingTop: 0, paddingBottom: 0 }}>{bannerSlot}</div> : null}
      <MBody>{cur?.render?.(state, setState) ?? null}</MBody>
      <MFoot align="spread">
        <Btn variant="ghost" onClick={() => idx === 0 ? handleCancel() : setIdx(idx - 1)}>
          {idx === 0 ? 'Отмена' : '← Назад'}
        </Btn>
        {isLast ? (
          <Btn variant="primary" disabled={!canNext || busy} onClick={finish}>
            {busy ? 'Сохраняем…' : finishText}
          </Btn>
        ) : (
          <Btn variant="primary" disabled={!canNext} onClick={() => setIdx(idx + 1)}>
            Далее →
          </Btn>
        )}
      </MFoot>
    </MCard>
  );
}
