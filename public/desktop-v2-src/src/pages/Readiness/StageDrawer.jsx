/**
 * Drawer-карточка одной работы с разбивкой по 7 этапам.
 * Доступ к override — PM (свои работы), HEAD_PM, директора, ADMIN.
 *
 * Backend endpoints:
 *   GET    /api/work-readiness/:workId
 *   POST   /api/work-readiness/:workId/override   { stage, forced_done, note }
 *   DELETE /api/work-readiness/:workId/override/:stage
 */
import { useEffect, useState, useCallback } from 'react';
import { useModal, DrawerModal } from '@/modals';
import { Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import Ring from './Ring';
import {
  loadFullReadiness, setOverride, clearOverride,
  canOverride, readyColor
} from './api';

export default function StageDrawer({ workId, currentUser }) {
  const { close } = useModal();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null); // stage key while toggling

  const refresh = useCallback(() => {
    setData(null);
    loadFullReadiness(workId)
      .then(setData)
      .catch((e) => {
        toast.error('Не удалось загрузить готовность: ' + (e?.message || e));
        setData({ error: true });
      });
  }, [workId]);

  useEffect(() => { refresh(); }, [refresh]);

  const canEdit = canOverride(currentUser?.role);

  const toggleOverride = async (stage) => {
    if (!canEdit) return;
    const s = (data?.stages || []).find((x) => x.stage === stage);
    if (!s) return;
    setBusy(stage);
    try {
      if (s.forced) {
        await clearOverride(workId, stage);
        toast.success('Override снят');
      } else {
        await setOverride(workId, stage, true);
        toast.success('Этап закрыт принудительно');
      }
      refresh();
    } catch (e) {
      toast.error('Ошибка: ' + (e?.message || e));
    } finally {
      setBusy(null);
    }
  };

  if (!data) {
    return (
      <DrawerModal title="Готовность проекта" icon="🛡️" onClose={close}>
        <div className="p-24 t-center c-t3">⏳ Загрузка…</div>
      </DrawerModal>
    );
  }

  if (data.error) {
    return (
      <DrawerModal title="Готовность проекта" icon="🛡️" onClose={close}>
        <div className="p-24 t-center c-t3">
          Не удалось загрузить данные
        </div>
      </DrawerModal>
    );
  }

  const applicable = (data.stages || []).filter((s) => s.applicable);

  return (
    <DrawerModal
      title={data.work_title || `Работа #${data.work_id}`}
      subtitle={`Общая готовность ${data.overall_percent}% · ${data.stages_done}/${data.stages_total} этапов${data.blocker ? ` · тормозит: ${stageLabel(data, data.blocker)}` : ''}`}
      icon="🛡️"
      accent={data.overall_percent >= 80 ? 'success' : data.overall_percent >= 50 ? 'warn' : 'danger'}
      onClose={close}
    >
      <div className="rdy-header">
        <Ring value={data.overall_percent} size={88} />
        <div className="flex-1">
          <div className="mini-kpi-label">
            Готовность к старту
          </div>
          <div className="fs-13 c-t2 mt-4">
            Статус: <b>{data.work_status}</b>
            {data.start_plan && (
              <> · план старта: <b>{new Date(data.start_plan).toLocaleDateString('ru-RU')}</b></>
            )}
          </div>
          {data.blocker && (
            <div className="fs-12 c-err mt-6 fw-700">
              ⚠ Главный блокер: {stageLabel(data, data.blocker)}
            </div>
          )}
        </div>
      </div>

      {applicable.length === 0 ? (
        <div className="p-24 t-center c-t3">
          Нет данных по этапам подготовки
        </div>
      ) : (
        <div className="col gap-10">
          {applicable.map((s) => (
            <StageRow
              key={s.stage}
              stage={s}
              canEdit={canEdit}
              busy={busy === s.stage}
              onToggle={() => toggleOverride(s.stage)}
            />
          ))}
        </div>
      )}
    </DrawerModal>
  );
}

function stageLabel(data, stageKey) {
  const s = (data.stages || []).find((x) => x.stage === stageKey);
  return s?.label || stageKey;
}

function StageRow({ stage, canEdit, busy, onToggle }) {
  const tone = readyColor(stage.percent);
  return (
    <div className="rdy-stage-row" style={{ borderLeft: `3px solid ${tone}` }}>
      <div className="row-spread gap-12">
        <div className="row gap-10 flex-1 min-w-0">
          <span className="fs-18">{stage.icon}</span>
          <div className="flex-1">
            <div className="rdy-stage-title">
              {stage.label}
              {stage.forced && (
                <span className="rdy-stage-forced">
                  принудительно
                </span>
              )}
            </div>
            <div className="fs-11-5 c-t3 mt-2">
              {stage.done} из {stage.total} выполнено
            </div>
          </div>
        </div>
        <div className="fs-16 fw-900" style={{ color: tone }}>
          {stage.percent}%
        </div>
      </div>

      {Array.isArray(stage.items) && stage.items.length > 0 && (
        <div className="mt-10 col gap-4">
          {stage.items.map((it, i) => (
            <div key={i} className="row-spread gap-12 fs-12-5">
              <span className="c-t2">
                {it.ok ? '✅' : '⬜'} {it.name}
              </span>
              {it.detail && (
                <span className="c-t3 fs-11-5 t-right">
                  {it.detail}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <div className="mt-10">
          <Btn size="sm" variant="ghost" disabled={busy} onClick={onToggle}>
            {busy ? 'Сохраняем…' : (stage.forced ? '↶ Снять закрытие' : '✓ Закрыть этап вручную')}
          </Btn>
        </div>
      )}
    </div>
  );
}
