'use strict';

/**
 * Тексты вердикта и рекомендаций для дайджеста (только русский).
 */

function shortName(name) {
  const s = String(name || '').trim();
  if (!s) return '';
  const parts = s.split(/\s+/);
  if (parts.length >= 2) return `${parts[0]} ${parts[1][0]}.`;
  return s;
}

function sentence(s) {
  const t = String(s || '').trim();
  if (!t) return '';
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

function fmtD(d) {
  if (!d) return '—';
  const s = String(d).slice(0, 10);
  const [y, m, day] = s.split('-');
  return y ? `${day}.${m}` : s;
}

function buildHeuristicDigestCopy(payload) {
  const k = payload.kpi || {};
  const duty = payload.duty || [];
  const staleN = payload.staleTotal || 0;
  const free = payload.marketplace?.free_total || 0;
  const worksIn = payload.works?.counts?.in_work || 0;
  const worksPrep = payload.works?.counts?.prep || 0;
  const worksTotal = payload.works?.total || 0;
  const periodWord = payload.kind === 'monthly' ? 'месяц' : 'неделю';

  const dutyNames = duty.map((d) => shortName(d.pm_name) || d.pm_name).filter(Boolean);
  const dutyPart = dutyNames.length
    ? sentence(`На дежурстве: ${dutyNames.join(', ')}`)
    : 'Дежурный на период в реестре не найден.';

  const closed = (k.go || 0) + (k.reject || 0);
  let analysisPart;
  if (duty.length === 1 && closed > 0) {
    const d = duty[0];
    const closedDuty = (d.closed != null ? d.closed : ((d.go || 0) + (d.reject || 0)));
    analysisPart = sentence(
      `За ${periodWord} ${shortName(d.pm_name)} закрыл ${closedDuty} анализов` +
      ` — из них «подаём» ${d.go || 0}, «не подаём» ${d.reject || 0}.` +
      ` В реестре тендеров за тот же период: «подались» ${k.submitted || 0}, «отмена» ${k.cancelled || 0}`
    );
  } else if (closed > 0) {
    analysisPart = sentence(
      `За ${periodWord} закрыто анализов: ${closed} («подаём» ${k.go || 0}, «не подаём» ${k.reject || 0}).` +
      ` В реестре тендеров: «подались» ${k.submitted || 0}, «отмена» ${k.cancelled || 0}`
    );
  } else {
    analysisPart = `Закрытых анализов за ${periodWord} почти не было — очередь могла копиться.`;
  }

  const next = payload.nextDuty || {};
  let nextPart;
  if (next.continuing) {
    nextPart = sentence(`Дежурство продолжается: ${shortName(next.pm_name)} до ${fmtD(next.period_end)}`);
  } else if (next.assigned) {
    nextPart = sentence(`Следующий дежурный: ${shortName(next.pm_name)} с ${fmtD(next.period_start)} по ${fmtD(next.period_end)}`);
  } else {
    nextPart = 'Следующий дежурный не назначен.';
  }

  const stalePart = staleN
    ? sentence(`Сейчас ${staleN} незакрытых анализов без движения больше суток или с дедлайном в ближайшие 2 дня`)
    : 'Критичных «зависших» анализов сейчас нет.';

  const worksPart = sentence(
    `Активных работ в CRM: ${worksTotal} (в работе ${worksIn}, в подготовке ${worksPrep}). ` +
    `Свободных заявок без руководителя: ${free}`
  );

  const toTop = (payload.toActivity?.people || []).find((p) => (p.created || 0) > 0);
  const toPart = toTop
    ? sentence(`ТО: ${shortName(toTop.name)} внёс ${toTop.created} тендеров (подались ${toTop.submitted}, отмен ${toTop.cancelled})`)
    : '';

  const fa = payload.fieldApp || {};
  const fieldPart = (fa.total_users || fa.active_users)
    ? sentence(
      `Приложение рабочих: ${fa.total_users || 0} аккаунтов, за ${periodWord} заходили ${fa.active_users || 0}` +
      ((fa.new_users || 0) > 0 ? `, новых аккаунтов ${fa.new_users}` : '')
    )
    : '';

  const verdict = [dutyPart, analysisPart, nextPart, stalePart, worksPart, toPart, fieldPart].filter(Boolean).join(' ');

  const recommendations = [];
  if (staleN > 0) {
    recommendations.push(
      `Закрыть или явно отказать по ${Math.min(staleN, 5)} анализам без движения / с близким дедлайном — иначе очередь и рейтинг портятся.`
    );
  }
  if ((k.go || 0) > 0 && (k.submitted || 0) < Math.max(1, Math.floor((k.go || 0) / 3))) {
    recommendations.push(
      `Решений «подаём» было ${k.go || 0}, а переводов в «подались» только ${k.submitted || 0} — проверить подготовку документов.`
    );
  }
  if ((k.reject || 0) > (k.go || 0) * 2 && (k.reject || 0) > 5) {
    recommendations.push('Много отказов относительно «подаём» — сверить качество входящего потока и причины отказа.');
  }
  if (free >= 5) {
    recommendations.push(`Свободных заявок без руководителя: ${free} — распределить, чтобы не протухли.`);
  }
  if (worksPrep >= 3 && worksIn === 0) {
    recommendations.push('Много работ в подготовке и мало «в работе» — проверить мобилизацию и блокеры старта.');
  }
  if (next && next.needs_successor) {
    if (next.continuing && next.period_end) {
      recommendations.push(
        `Назначить следующего дежурного после ${fmtD(next.period_end)}, чтобы смена не оборвалась.`
      );
    } else {
      recommendations.push('Назначить следующего дежурного в реестре дежурств, чтобы смена не оборвалась.');
    }
  }
  if (!recommendations.length) {
    recommendations.push('Темп анализа и объекты в норме — закрывать анализ в день касания, не копить черновики.');
  }
  return { verdict, recommendations: recommendations.slice(0, 5) };
}

module.exports = { buildHeuristicDigestCopy };
