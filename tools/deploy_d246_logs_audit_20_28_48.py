#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""D-246 — аудит логов 14–20.09: клиентские и бэковые 500, счёт дайджеста, шум by-index.

Что везём (shell 20.28.47 → 20.28.48):
  * закалка клиента: `registry_detail.js` / `registry_tab.js` (guard AsgardRegistryApi),
    `sla.js` (кэш уведомлений на тик + offline-guard), `router.js` (SLA-тик не в фоне);
  * бэкенд: `worker-payments` (crew-all 42P10 → GROUP BY), `timesheet-v2` / `global-timesheet` /
    `field-logistics` (entered_by_user_id через общий резолвер `src/lib/entered-by-user.js`);
  * дайджест и рейтинг: закрытые ПРОСЧЁТЫ отдельной метрикой (`finalize` + `mode=calc`);
  * миграция V358 — колонка `pm_analysis_rating_daily.activity_json`.
  * Починенный мобильный бандл `public/m/**` (XpBar в FieldProfile.jsx).

ПОРЯДОК (миграция обязана примениться ДО рестарта):
  0) pre-flight: shell_guard(--deploy-gate) + маркеры кода;
  1) снапшот кода (16 файлов, существующих на проде) + снапшот всего `public/m/**`;
  2) заливка кода: tar → /tmp → стейдж в проекте → md5-сверка → атомарный `mv`;
  3) идемпотентная миграция V358 + маркер в `migrations` (D-165: setval + ON CONFLICT);
  4) заливка `public/m/**` (tar поверх каталога) + удаление осиротевших хэшей;
  5) рестарт + health;
  6) runtime-sentinel НА ПРОДЕ (read-only): дайджест 14–20.09 = closed_calc 1 / taken 0,
     письмо содержит обе плитки, crew-all новой SQL не падает и сортирует по ФИО,
     СТАРАЯ SQL обязана падать 42P10 (дискриминатор), V358-колонка есть, маркер стоит,
     `computeUserRating` отдаёт `activity.closed_calc` при конечном score;
  7) смоук: маркеры в прод-файлах, `/api/version`, главная 200.

Любой провал ПОСЛЕ снапшота → откат кода и `public/m` из снапшота + перезапуск + сверка md5.
Снапшот неполон → выкатка не начинается.

Запуск: python tools/deploy_d246_logs_audit_20_28_48.py
"""

from __future__ import annotations

import hashlib
import subprocess
import sys
import tarfile
import tempfile
import time
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]


class DeployError(Exception):
    """Сбой выкатки (ssh/scp/проверка). Ловится в main() → rollback()."""

    pass


ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools"
sys.path.insert(0, str(TOOLS))

import shell_guard  # noqa: E402

VER = "20.28.48"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
SSH_HOST = "root@92.242.61.184"
PROJECT = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-d246-{STAMP}.tgz"
SNAP_M = f"/root/snapshots/asgard-crm-pre-deploy-d246-m-{STAMP}.tgz"
# md5 прод-файлов на момент снапшота: откат сверяется с ними, без карты откат не подтверждён.
SNAP_MD5: dict[str, str] = {}
SNAP_M_MD5: dict[str, str] = {}

MIGRATION = "migrations/V358__rating_daily_activity.sql"
MIGRATION_NAME = "V358__rating_daily_activity"

# Файлы, которых на проде ещё нет (создаются этой выкаткой).
NEW_FILES = {"src/lib/entered-by-user.js", MIGRATION}

CODE_FILES = [
    "src/lib/entered-by-user.js",
    "src/services/pm-analysis-rating.js",
    "src/services/pm-analysis-weekly-email.js",
    "src/services/pm-analysis-weekly-report.js",
    "src/prompts/pm-analysis-weekly-prompt.js",
    "src/routes/timesheet-v2.js",
    "src/routes/global-timesheet.js",
    "src/routes/field-logistics.js",
    "src/routes/worker-payments.js",
    "public/assets/js/registry_detail.js",
    "public/assets/js/registry_tab.js",
    "public/assets/js/router.js",
    "public/assets/js/sla.js",
    "public/index.html",
    "public/sw.js",
]
FILES = CODE_FILES + [MIGRATION]
EXISTING_ON_PROD = [f for f in FILES if f not in NEW_FILES]

# Если на диске не тот код, что мы проверяли, — падаем ДО заливки.
MARKERS = [
    ("src/lib/entered-by-user.js", "resolveEnteredByUserId"),
    ("src/services/pm-analysis-weekly-report.js", "AS closed_calc"),
    ("src/services/pm-analysis-rating.js", "loadCalcClosedStats"),
    ("src/services/pm-analysis-rating.js", "activity_json"),
    ("src/services/pm-analysis-weekly-email.js", "Закрыто просчётов"),
    ("src/services/pm-analysis-weekly-prompt.js", "Дополнительно закрыто просчётов"),
    ("src/routes/worker-payments.js", "GROUP BY e.id, e.fio, e.full_name, e.position"),
    ("src/routes/timesheet-v2.js", "resolveEnteredByUserId"),
    ("src/routes/global-timesheet.js", "resolveEnteredByUserId"),
    ("src/routes/field-logistics.js", "resolveEnteredByUserId"),
    ("public/assets/js/registry_detail.js", "AsgardRegistryApi missing"),
    ("public/assets/js/registry_tab.js", "AsgardRegistryApi missing"),
    ("public/assets/js/sla.js", "notifCache"),
    ("public/assets/js/router.js", "visibilitychange"),
    ("public/index.html", VER),
    ("public/sw.js", VER),
]

SMOKE_GREPS = [
    ("src/lib/entered-by-user.js", "resolveEnteredByUserId"),
    ("src/services/pm-analysis-weekly-report.js", "closed_calc"),
    ("src/services/pm-analysis-rating.js", "activity_json"),
    ("src/routes/worker-payments.js", "GROUP BY e.id, e.fio"),
    ("public/assets/js/sla.js", "notifCache"),
    ("public/assets/js/router.js", "document.hidden"),
    ("public/assets/js/registry_detail.js", "AsgardRegistryApi missing"),
    ("public/index.html", VER),
    ("public/sw.js", VER),
]

# ── runtime-sentinel НА ПРОДЕ: только чтение (SELECT + рендер письма в память) ──
RUNTIME_JS = r"""
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
process.env.DB_USER = process.env.DB_USER || 'asgard';
process.env.DB_NAME = process.env.DB_NAME || 'asgard_crm';
const db = require('/var/www/asgard-crm/src/services/db');

const bad = [];
const say = (ok, label, proof) => {
  console.log((ok ? 'OK   ' : 'FAIL ') + label + (proof !== undefined ? '  — ' + proof : ''));
  if (!ok) bad.push(label);
};
const NAME_SQL = "COALESCE(NULLIF(TRIM(e.fio), ''), NULLIF(TRIM(e.full_name), ''), 'ID ' || e.id)";

(async () => {
  // ── 1. Дайджест недели аудита: просчёт 17.09 (log#317) виден, анализов нет ──
  const { buildWeeklyDigest } = require('/var/www/asgard-crm/src/services/pm-analysis-weekly-report');
  const dg = await buildWeeklyDigest(db, { weekStart: '2026-09-14', weekEnd: '2026-09-20' });
  const kpi = dg.kpi || {};
  say(Number(kpi.closed_calc) === 1, 'дайджест 14–20.09: закрыто просчётов = 1', 'closed_calc=' + kpi.closed_calc);
  say(Number(kpi.taken) === 0, 'дайджест 14–20.09: закрыто анализов = 0 (плитки не смешаны)', 'taken=' + kpi.taken);

  // 1б. письмо содержит обе плитки (split tiles) и сноску.
  const { generatePmAnalysisWeeklyEmail } = require('/var/www/asgard-crm/src/services/pm-analysis-weekly-email');
  const html = generatePmAnalysisWeeklyEmail(dg);
  say(html.indexOf('Закрыто просчётов') >= 0, 'письмо: плитка «Закрыто просчётов»');
  say(html.indexOf('Закрыто анализов') >= 0, 'письмо: плитка «Закрыто анализов»');

  // ── 2. crew-all: новая SQL не падает + алфавитный порядок; старая обязана падать ──
  const { rows: works } = await db.query(`
    SELECT ea.work_id, count(DISTINCT ea.employee_id) AS n
    FROM employee_assignments ea
    WHERE ea.work_id IS NOT NULL
    GROUP BY 1 ORDER BY n DESC LIMIT 5`);
  say(works.length > 0, 'crew-all: на проде есть работы с бригадой', 'works=' + works.map(w => w.work_id).join(','));

  let newOk = true, newRows = [], newErr = '';
  for (const w of works) {
    try {
      const r = await db.query(`
        SELECT e.id AS employee_id, ${NAME_SQL} AS employee_name, e.position, 0 AS per_diem_rate
        FROM employees e
        LEFT JOIN employee_assignments ea ON ea.employee_id = e.id AND ea.work_id = $1
        LEFT JOIN field_checkins fc ON fc.employee_id = e.id AND fc.work_id = $1
        WHERE (ea.work_id = $1 OR fc.work_id = $1) AND COALESCE(e.is_active, true) = true
        GROUP BY e.id, e.fio, e.full_name, e.position
        ORDER BY e.fio`, [w.work_id]);
      if (r.rows.length > 0) { newOk = true; newRows = r.rows; break; }
    } catch (e) { newOk = false; newErr = e.code + ' ' + e.message; }
  }
  say(newOk, 'crew-all: новая SQL выполняется', newRows.length ? ('rows=' + newRows.length) : ('err=' + newErr));
  say(newRows.length > 0, 'crew-all: on_site не пуст', 'rows=' + newRows.length);
  const names = newRows.map(r => r.employee_name);
  const sorted = names.slice().sort((a, b) => String(a).localeCompare(String(b), 'ru'));
  say(JSON.stringify(names) === JSON.stringify(sorted), 'crew-all: порядок алфавитный', names.slice(0, 3).join(' | '));

  // Дискриминатор: СТАРЫЙ вариант обязан падать 42P10, иначе проверка ничего не доказывает.
  let oldCode = '';
  try {
    await db.query(`
      SELECT DISTINCT e.id AS employee_id, ${NAME_SQL} AS employee_name, e.position, 0 AS per_diem_rate
      FROM employees e
      LEFT JOIN employee_assignments ea ON ea.employee_id = e.id AND ea.work_id = $1
      LEFT JOIN field_checkins fc ON fc.employee_id = e.id AND fc.work_id = $1
      WHERE (ea.work_id = $1 OR fc.work_id = $1) AND COALESCE(e.is_active, true) = true
      ORDER BY e.fio`, [works[0].work_id]);
  } catch (e) { oldCode = e.code || ''; }
  say(oldCode === '42P10', 'crew-all: дискриминатор — старая SQL падает 42P10', 'code=' + oldCode);

  // ── 3. V358: колонка + маркер миграции ──
  const col = await db.query(`SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_name='pm_analysis_rating_daily' AND column_name='activity_json'`);
  say(col.rows[0].n === 1, 'V358: колонка pm_analysis_rating_daily.activity_json есть', 'n=' + col.rows[0].n);
  const mig = await db.query(`SELECT count(*)::int AS n FROM migrations WHERE name = $1`, ['__MIG_NAME__']);
  say(mig.rows[0].n === 1, 'V358: маркер в migrations', 'name=__MIG_NAME__ n=' + mig.rows[0].n);

  // ── 4. Рейтинг: activity.closed_calc есть, score конечный (без записи снапшотов) ──
  const rating = require('/var/www/asgard-crm/src/services/pm-analysis-rating');
  const ids = (await rating.listPmUserIds(db)).slice(0, 3);
  say(ids.length > 0, 'рейтинг: есть РП для проверки', 'ids=' + ids.join(','));
  let calcSeen = 0;
  for (const uid of ids) {
    const p = await rating.computeUserRating(db, uid, 'd30', '2026-09-22');
    const hasActivity = !!(p && p.activity && Object.prototype.hasOwnProperty.call(p.activity, 'closed_calc'));
    const finite = Number.isFinite(p && p.score);
    const gradeOk = typeof (p && p.grade) === 'string' && p.grade.length > 0;
    if (hasActivity) calcSeen++;
    say(hasActivity && finite && gradeOk,
        'рейтинг uid=' + uid + ': activity.closed_calc + конечный score',
        'closed_calc=' + (p.activity ? p.activity.closed_calc : '?') + ' score=' + p.score + ' grade=' + p.grade);
  }
  say(calcSeen === ids.length, 'рейтинг: activity.closed_calc у всех проверенных', 'calcSeen=' + calcSeen + '/' + ids.length);

  await db.end();
  console.log(bad.length ? 'RUNTIME_FAIL ' + bad.join(' | ') : 'RUNTIME_OK');
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.log('FATAL: ' + (e && e.message)); process.exit(1); });
"""


def md5_file(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def run(cmd: list[str], cwd: Path | None = None, check: bool = True) -> subprocess.CompletedProcess:
    print(f"$ {' '.join(cmd[:6])}{' ...' if len(cmd) > 6 else ''}")
    p = subprocess.run(cmd, cwd=str(cwd) if cwd else None, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if p.stdout.strip():
        print(p.stdout[-8000:])
    if p.stderr.strip():
        print("STDERR:", p.stderr[-2000:])
    if check and p.returncode != 0:
        raise DeployError(f"FAIL ({p.returncode}): {' '.join(cmd[:4])}")
    return p


def ssh(remote: str) -> subprocess.CompletedProcess:
    """SSH с ретраями: канал до прода рвётся нестабильно."""
    for attempt in range(1, 5):
        p = run(["ssh", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=25",
                 "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4", SSH_HOST, remote],
                check=False)
        if p.returncode == 0:
            return p
        print(f"  [ssh] попытка {attempt}/4 не удалась (rc={p.returncode}), повтор...")
        time.sleep(5)
    raise DeployError(f"SSH не прошёл за 4 попытки: {remote[:80]}")


def ssh_soft(remote: str) -> subprocess.CompletedProcess:
    """SSH без ретраев: нужен код возврата удалённой команды."""
    return run(["ssh", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=25",
                "-o", "ServerAliveInterval=15", SSH_HOST, remote], check=False)


def scp_retry(local: str, remote: str) -> None:
    for attempt in range(1, 5):
        p = run(["scp", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=25",
                 "-o", "ServerAliveInterval=15", local, f"{SSH_HOST}:{remote}"], check=False)
        if p.returncode == 0:
            return
        print(f"  [scp] попытка {attempt}/4 не удалась (rc={p.returncode}), повтор...")
        time.sleep(5)
    raise DeployError(f"scp не прошёл за 4 попытки: {remote}")


def prod_md5_map(prefix: str) -> dict[str, str]:
    """md5 всех файлов под каталогом прода (для снапшота и отката)."""
    res = ssh(f"cd {PROJECT} && find {prefix} -type f -exec md5sum {{}} +")
    out: dict[str, str] = {}
    for line in (res.stdout or "").splitlines():
        parts = line.split(None, 1)
        if len(parts) == 2 and len(parts[0]) == 32:
            out[parts[1].strip()] = parts[0]
    return out


def local_files_under(prefix: str) -> list[str]:
    return sorted(str(p.relative_to(ROOT)).replace("\\", "/")
                  for p in (ROOT / prefix).rglob("*") if p.is_file())


def make_snapshot() -> None:
    """Снапшот кода + public/m ДО любой заливки. Неполный снапшот = выкатка не начинается."""
    print("\n=== 1. SNAPSHOT ===")
    for rel in EXISTING_ON_PROD:
        res = ssh(f"test -f {PROJECT}/{rel} && echo PRESENT || echo MISSING")
        if "PRESENT" not in (res.stdout or ""):
            raise DeployError(f"на проде нет файла {rel} — снапшот был бы неполным")
    ssh(f"mkdir -p /root/snapshots && tar -C {PROJECT} -czf {SNAP} " + " ".join(EXISTING_ON_PROD))
    listing = ssh(f"tar -tzf {SNAP}").stdout or ""
    missing = [rel for rel in EXISTING_ON_PROD if rel not in listing]
    if missing:
        raise DeployError(f"в снапшоте нет {missing} — откат был бы частичным")
    for rel in EXISTING_ON_PROD:
        val = ((ssh(f"md5sum {PROJECT}/{rel}").stdout or "").split() or [""])[0]
        if len(val) != 32:
            raise DeployError(f"не снял md5 прод-файла {rel} — откат нечем подтвердить")
        SNAP_MD5[rel] = val
    print(f"снапшот кода: {SNAP} — {len(EXISTING_ON_PROD)} файлов, md5 снят ({len(SNAP_MD5)})")

    ssh(f"tar -C {PROJECT} -czf {SNAP_M} public/m")
    listing_m = ssh(f"tar -tzf {SNAP_M}").stdout or ""
    if "public/m/index.html" not in listing_m:
        raise DeployError("в снапшоте public/m нет index.html — откат был бы частичным")
    SNAP_M_MD5.update(prod_md5_map("public/m"))
    if not SNAP_M_MD5:
        raise DeployError("карта md5 public/m пуста — откат нечем подтвердить")
    print(f"снапшот public/m: {SNAP_M} — {len(SNAP_M_MD5)} файлов, md5 снят")
    print((ssh(f"ls -lh {SNAP} {SNAP_M}").stdout or "").strip())


def upload_code() -> None:
    """tar → /tmp → стейдж в проекте → md5-сверка → атомарный mv. Прод не видит обрезанных файлов."""
    print(f"\n=== 2. ЗАЛИВКА КОДА: {len(CODE_FILES)} файл(ов) ===")
    remote_tar = f"/tmp/asgard-d246-code-{STAMP}.tgz"
    stage = f"{PROJECT}/.deploy-stage-d246-code-{STAMP}"
    with tempfile.TemporaryDirectory() as tmp:
        tar_path = Path(tmp) / "d246-code.tgz"
        with tarfile.open(tar_path, "w:gz") as tar:
            for rel in CODE_FILES:
                tar.add(ROOT / rel, arcname=rel)
        scp_retry(str(tar_path), remote_tar)
    ssh(f"rm -rf {stage} && mkdir -p {stage} && tar xzf {remote_tar} -C {stage} "
        f"&& rm -f {remote_tar} && echo EXTRACT_OK")
    for rel in CODE_FILES:
        local = md5_file(ROOT / rel)
        res = ssh(f"md5sum {stage}/{rel}")
        staged = (res.stdout or "").split()[0] if res.stdout.strip() else "?"
        if staged != local:
            ssh_soft(f"rm -rf {stage}")
            rollback(f"стейдж кода не совпал: {rel} (local={local} stage={staged})")
    ssh(" && ".join([f"mv -f {stage}/{rel} {PROJECT}/{rel}" for rel in CODE_FILES])
        + f" && rm -rf {stage} && echo SWITCH_OK")
    for rel in CODE_FILES:
        local = md5_file(ROOT / rel)
        remote = ((ssh(f"md5sum {PROJECT}/{rel}").stdout or "").split() or ["?"])[0]
        ok = remote == local
        print(f"  {'OK  ' if ok else 'FAIL'} {rel}  local={local} prod={remote}")
        if not ok:
            rollback(f"md5 не совпал после заливки: {rel} (local={local} prod={remote})")


def apply_migration() -> None:
    """V358 идемпотентна (ADD COLUMN IF NOT EXISTS). Маркер — с setval (D-208/D-165)."""
    print("\n=== 3. МИГРАЦИЯ V358 ===")
    ssh(f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 "
        f"-f {PROJECT}/{MIGRATION}")
    sql = ("SELECT setval('migrations_id_seq', GREATEST("
           "(SELECT COALESCE(max(id),1) FROM migrations),"
           "(SELECT last_value FROM migrations_id_seq)));")
    ssh(f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 -c \"{sql}\"")
    ins = (f"INSERT INTO migrations (name) VALUES ('{MIGRATION_NAME}') "
           f"ON CONFLICT (name) DO NOTHING;")
    ssh(f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 -c \"{ins}\"")
    chk = ssh(f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -tAc \"SELECT "
              f"(SELECT count(*) FROM information_schema.columns WHERE table_name='pm_analysis_rating_daily' "
              f"AND column_name='activity_json') || '/' || "
              f"(SELECT count(*) FROM migrations WHERE name='{MIGRATION_NAME}') || '/' || "
              f"(SELECT max(id) FROM migrations) || '/' || "
              f"(SELECT last_value FROM migrations_id_seq)\"")
    out = (chk.stdout or "").strip()
    print(f"  колонка/маркер/max(id)/last_value = {out}")
    parts = out.split("/")
    if len(parts) != 4 or parts[0] != "1" or parts[1] != "1":
        rollback(f"V358 не подтверждена (колонка/маркер): {out}")
    if int(parts[2]) < int(parts[3]):
        rollback(f"последовательность migrations отстала: max(id)={parts[2]} last_value={parts[3]}")


def upload_mobile() -> None:
    """public/m целиком поверх каталога + снос осиротевших хэшированных бандлов."""
    print("\n=== 4. ЗАЛИВКА public/m ===")
    local = local_files_under("public/m")
    res = ssh(f"cd {PROJECT} && find public/m -type f")
    prod = sorted(l.strip() for l in (res.stdout or "").splitlines() if l.strip())
    added = [p for p in local if p not in prod]
    stale = [p for p in prod if p not in local]
    print(f"  локально {len(local)}, на проде {len(prod)}, новых {len(added)}, осиротевших {len(stale)}")

    remote_tar = f"/tmp/asgard-d246-m-{STAMP}.tgz"
    with tempfile.TemporaryDirectory() as tmp:
        tar_path = Path(tmp) / "d246-m.tgz"
        with tarfile.open(tar_path, "w:gz") as tar:
            tar.add(ROOT / "public" / "m", arcname="public/m")
        scp_retry(str(tar_path), remote_tar)
    ssh(f"cd {PROJECT} && tar xzf {remote_tar} && rm -f {remote_tar} && echo EXTRACT_OK")

    if stale:
        print(f"  снос осиротевших: {len(stale)}")
        for i in range(0, len(stale), 50):
            ssh("rm -f " + " ".join(f"{PROJECT}/{p}" for p in stale[i:i + 50]))

    for rel in ("public/m/index.html",):
        local_h = md5_file(ROOT / rel)
        remote_h = ((ssh(f"md5sum {PROJECT}/{rel}").stdout or "").split() or ["?"])[0]
        ok = local_h == remote_h
        print(f"  {'OK  ' if ok else 'FAIL'} {rel}  local={local_h} prod={remote_h}")
        if not ok:
            rollback(f"md5 public/m не совпал: {rel}")
    # Полная сверка каталога: пропущенный файл в раздаче = чёрный экран у рабочих.
    after = prod_md5_map("public/m")
    mism = [p for p in local if after.get(p) != md5_file(ROOT / p)]
    print(f"  сверка public/m: {len(local) - len(mism)}/{len(local)} совпало")
    if mism:
        rollback(f"public/m разошёлся после заливки: {mism[:5]}")


def restart() -> None:
    print("\n=== 5. RESTART ===")
    ok = False
    for i in range(1, 11):
        time.sleep(2)
        res = ssh_soft("systemctl restart asgard-crm; sleep 3; systemctl is-active asgard-crm; "
                       "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health || echo fail")
        out = res.stdout or ""
        if "active" in out and "200" in out:
            print(f"  HEALTH OK (попытка {i})")
            ok = True
            break
    if not ok:
        ssh_soft("journalctl -u asgard-crm -n 80 --no-pager")
        rollback("health не подтверждён после рестарта")


def runtime_check() -> None:
    """Фактический прогон сервисов на проде (только чтение)."""
    print("\n=== 6. RUNTIME-SENTINEL НА ПРОДЕ (read-only) ===")
    with tempfile.TemporaryDirectory() as tmp:
        js_path = Path(tmp) / "_d246_prod_sentinel.js"
        js_path.write_text(RUNTIME_JS.replace("__MIG_NAME__", MIGRATION_NAME), encoding="utf-8")
        scp_retry(str(js_path), "/tmp/_d246_prod_sentinel.js")
    res = ssh_soft(f"cd {PROJECT} && DB_PASSWORD=123456789 DB_USER=asgard DB_NAME=asgard_crm "
                   f"node /tmp/_d246_prod_sentinel.js")
    out = res.stdout or ""
    print(out)
    if "RUNTIME_OK" not in out:
        rollback("runtime-sentinel на проде не прошёл (см. вывод выше)")


def smoke() -> None:
    print("\n=== 7. SMOKE ===")
    ssh("curl -s http://127.0.0.1:3000/api/version; echo; "
        "curl -s -o /dev/null -w 'home:%{http_code}\\n' https://asgard-crm.ru/")
    for rel, needle in SMOKE_GREPS:
        res = ssh(f"grep -c {needle!r} {PROJECT}/{rel}")
        cnt = (res.stdout or "0").strip().splitlines()[-1] if (res.stdout or "").strip() else "0"
        print(f"  {'OK  ' if cnt not in ('', '0') else 'FAIL'} {rel} :: {needle} = {cnt}")
        if cnt in ("", "0"):
            rollback(f"смоук: маркер не найден на проде: {rel} :: {needle}")
    ssh("journalctl -u asgard-crm -n 20 --no-pager | tail -20")


def rollback(reason: str) -> None:
    """Возврат кода и public/m из снапшотов + ПРОВЕРКА по md5 + is-active."""
    print("\n" + "!" * 78)
    print(f"! ОТКАТ: {reason}")
    print("!" * 78)

    def try_ssh(cmd: str) -> str:
        try:
            return ssh(cmd).stdout or ""
        except DeployError as exc:
            print(f"  [откат] ssh не прошёл: {exc}")
            return ""

    try_ssh(f"tar -C {PROJECT} -xzf {SNAP}")
    try_ssh(f"tar -C {PROJECT} -xzf {SNAP_M}")
    for rel in NEW_FILES:
        try_ssh(f"rm -f {PROJECT}/{rel}")
    mismatch = []
    for rel, want in SNAP_MD5.items():
        got = (try_ssh(f"md5sum {PROJECT}/{rel}").split() or ["?"])[0]
        if got != want:
            mismatch.append(f"{rel}: в снапшоте {want}, на проде {got}")
    after = prod_md5_map("public/m")
    for rel, want in SNAP_M_MD5.items():
        if after.get(rel) != want:
            mismatch.append(f"{rel}: в снапшоте {want}, на проде {after.get(rel)}")
    active = "active" in try_ssh("systemctl restart asgard-crm && sleep 4 && systemctl is-active asgard-crm")
    if not SNAP_MD5:
        mismatch.append("карта md5 кода пуста — подтвердить возврат нечем")

    if mismatch or not active:
        print("!!! ОТКАТ НЕ ПОДТВЕРЖДЁН — нужен ручной разбор: " + SNAP)
        for m in mismatch[:20]:
            print("    · " + m)
        if not active:
            print("    · сервис не подтверждён как active")
        raise SystemExit("ДЕПЛОЙ ПРЕРВАН, ОТКАТ НЕ ПОДТВЕРЖДЁН (прод может быть в смешанном "
                         f"состоянии — сверься со снапшотами {SNAP} / {SNAP_M}): {reason}")

    print(f"ОТКАТ ПОДТВЕРЖДЁН: код {len(SNAP_MD5)}/{len(SNAP_MD5)}, public/m "
          f"{len(SNAP_M_MD5)}/{len(SNAP_M_MD5)}, сервис active")
    raise SystemExit(f"ДЕПЛОЙ ПРЕРВАН И ОТКАЧЕН: {reason}")


def main() -> None:
    print("=" * 78)
    print(f"DEPLOY D-246 «аудит логов 14–20.09» — shell {VER}")
    print("=" * 78)

    print("\n=== 0. PRE-FLIGHT ===")
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=True)
    print("shell_guard: OK (оболочка валидна, HEAD == .last-verified)")

    missing = [f for f in FILES if not (ROOT / f).is_file()]
    if missing:
        raise SystemExit(f"нет файлов: {missing}")
    for rel, needle in MARKERS:
        if needle not in (ROOT / rel).read_text(encoding="utf-8"):
            raise SystemExit(f"маркер отсутствует: {rel} :: {needle}")
    print(f"маркеры: OK ({len(MARKERS)}/{len(MARKERS)}); файлов к заливке: {len(FILES)} + public/m")
    for f in FILES:
        print(f"   ~ {f}")

    snapshot_done = False
    try:
        make_snapshot()
        snapshot_done = True
        upload_code()
        apply_migration()
        upload_mobile()
        restart()
        runtime_check()
        smoke()
    except DeployError as exc:
        if snapshot_done:
            rollback(f"аварийное завершение выкатки: {exc}")
        raise
    except Exception as exc:
        if snapshot_done:
            rollback(f"непредвиденный сбой выкатки: {exc!r}")
        raise

    print("\n=== DEPLOY DONE ===")
    print(f"shell {VER}; снапшоты: {SNAP} / {SNAP_M}")
    print("Дальше (post-deploy, порядок важен — D-166):")
    print("  python tools/restore_asset_sync.py plan")
    print("  node tools/audit_silent_reverts.js --post-deploy")


if __name__ == "__main__":
    main()
