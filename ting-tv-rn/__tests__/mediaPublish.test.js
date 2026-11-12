'use strict';

/**
 * D-406: на ТВ камера публиковалась muted=true, а собеседник не отображался.
 *
 * Причина 1: флаги audio/video у LiveKitRoom только ОБЪЯВЛЯЮТ намерение. В
 * @livekit/react-native 3.1.0 нет ни одного вызова setCameraEnabled или
 * setMicrophoneEnabled — проверено по собранному commonjs. Пока трек не
 * включить явно, он висит muted: на SFU участник есть, камеры и микрофона нет.
 *
 * Причина 2: useTracks с onlySubscribed:false отдаёт и неподписанные публикации,
 * у которых publication.track = null. Плитка создаётся, RTCView пустой —
 * «собеседника не видно».
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const meeting = fs.readFileSync(path.join(root, 'src', 'MeetingScreen.js'), 'utf8');

describe('TV client: публикация медиа (D-406)', () => {
  it('явно включает микрофон после подключения', () => {
    assert.ok(
      /setMicrophoneEnabled\(true/.test(meeting),
      'микрофон не включается явно — уйдёт muted'
    );
  });

  it('явно включает камеру после подключения', () => {
    assert.ok(
      /setCameraEnabled\(true/.test(meeting),
      'камера не включается явно — уйдёт muted'
    );
  });

  it('включение в useEffect и до телеметрии', () => {
    const enableIdx = meeting.indexOf('setCameraEnabled(true');
    const metricsIdx = meeting.indexOf('startTvMetrics(');
    assert.ok(enableIdx > -1 && metricsIdx > -1, 'маркеры не найдены');
    assert.ok(enableIdx < metricsIdx, 'включение медиа должно идти до запуска телеметрии');
  });

  it('useTracks не запрашивает неподписанные треки', () => {
    /* Проверяем код, а не комментарии: в пояснении фраза встречается законно. */
    const code = meeting
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    assert.ok(
      !/onlySubscribed:\s*false/.test(code),
      'onlySubscribed:false даёт publication.track = null — пустые плитки'
    );
  });

  it('плитка берёт именно publication.track', () => {
    assert.ok(
      /publication\s*\?\s*publication\.track/.test(meeting) ||
        /publication\.track/.test(meeting),
      'плитка должна читать publication.track'
    );
  });
});
