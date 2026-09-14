# -*- coding: utf-8 -*-
"""Deploy: paid participation + analysis_deadline + cancel reason (shell 20.27.119, V340)."""
import io
import sys
import tarfile
import tempfile
from datetime import datetime
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
ROOT = Path(__file__).resolve().parents[1]
VER = "20.27.119"
TAG = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-paid-adl-{TAG}"

FILES = [
    "migrations/V340__tender_participation_analysis_deadline.sql",
    "migrations/V340__tender_participation_analysis_deadline_down.sql",
    "src/lib/business-days.js",
    "src/routes/tenders-registry.js",
    "src/services/pm-analysis-stale-cron.js",
    "public/assets/js/registry_tab.js",
    "public/assets/css/app.css",
    "public/index.html",
    "public/sw.js",
]

MARKERS = {
    "src/lib/business-days.js": ["computeAnalysisDeadline", "subBusinessDays"],
    "src/routes/tenders-registry.js": [
        "participation_paid",
        "analysis_deadline",
        "computeAnalysisDeadline",
        "participation",
    ],
    "src/services/pm-analysis-stale-cron.js": [
        "analysis_deadline_overdue",
        "findAnalysisDeadlineOverdue",
        "getCurrentDuty",
    ],
    "public/assets/js/registry_tab.js": [
        "regFormPaid",
        "analysisDeadlineCell",
        "regArchiveReason",
        "participationCell",
    ],
    "public/assets/css/app.css": ["reg-adl-overdue", "reg-participation-paid"],
    "public/sw.js": [f"SHELL_VERSION = '{VER}'"],
    "public/index.html": [
        f"ASGARD_SHELL_VERSION = '{VER}'",
        f"registry_tab.js?v={VER}",
        f"app.css?v={VER}",
    ],
    "migrations/V340__tender_participation_analysis_deadline.sql": [
        "participation_paid",
        "analysis_deadline",
        "analysis_deadline_overdue",
    ],
}


def run(c, cmd, timeout=300):
    print("====", cmd[:240].replace("\n", " "))
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out:
        print(out[-8000:] if len(out) > 8000 else out)
    if err.strip():
        print("STDERR:", err[:2000])
    if code != 0:
        raise SystemExit(f"FAILED ({code}): {cmd[:160]}")
    return out


def pack_v2() -> Path:
    v2 = ROOT / "public" / "v2"
    if not (v2 / "index.html").exists():
        raise SystemExit("public/v2 missing — build first")
    found = False
    for p in (v2 / "assets").glob("*.js"):
        txt = p.read_text(encoding="utf-8", errors="ignore")
        if "participation_paid" in txt and ("Платное участие" in txt or "analysis_deadline" in txt):
            found = True
            print(f"v2 paid/adl markers in {p.name}")
            break
    if not found:
        # softer: helper strings may be minified differently
        for p in (v2 / "assets").glob("*.js"):
            txt = p.read_text(encoding="utf-8", errors="ignore")
            if "analysis_deadline" in txt and "participation_fee" in txt:
                found = True
                print(f"v2 paid/adl markers (alt) in {p.name}")
                break
    if not found:
        raise SystemExit("v2 build missing participation/analysis_deadline markers — rebuild")
    css_ok = False
    for p in (v2 / "assets").glob("*.css"):
        txt = p.read_text(encoding="utf-8", errors="ignore")
        if "reg-adl-overdue" in txt:
            css_ok = True
            print(f"v2 adl css in {p.name}")
            break
    if not css_ok:
        print("WARN: reg-adl-overdue css not found in v2 assets (may be inlined elsewhere)")
    tmp = Path(tempfile.gettempdir()) / f"asgard-v2-paid-adl-{TAG}.tar.gz"
    with tarfile.open(tmp, "w:gz") as tar:
        tar.add(v2, arcname="v2")
    print(f"packed v2 -> {tmp} ({tmp.stat().st_size} bytes)")
    return tmp


def main():
    for rel in FILES:
        local = ROOT / rel
        if not local.exists():
            raise SystemExit(f"missing {rel}")
        text = local.read_text(encoding="utf-8")
        for m in MARKERS.get(rel, []):
            if m not in text:
                raise SystemExit(f"marker missing in {rel}: {m}")

    v2_tar = pack_v2()
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    c.get_transport().set_keepalive(15)
    sftp = c.open_sftp()

    print("=== SNAPSHOT ===")
    run(
        c,
        "mkdir -p /root/snapshots && tar -C {p} -czf {s}.tgz --ignore-failed-read "
        "src/lib/business-days.js src/routes/tenders-registry.js src/services/pm-analysis-stale-cron.js "
        "public/assets/js/registry_tab.js public/assets/css/app.css public/index.html public/sw.js "
        "public/v2 migrations 2>/dev/null; ls -lh {s}.tgz".format(p=PROJECT, s=SNAP),
    )

    print("=== UPLOAD FILES ===")
    remote_tar = f"/tmp/asgard-paid-adl-{TAG}.tar.gz"
    with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as tmp:
        tar_path = Path(tmp.name)
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(ROOT / rel, arcname=rel)
    sftp.put(str(tar_path), remote_tar)
    tar_path.unlink(missing_ok=True)
    run(c, f"tar -xzf {remote_tar} -C {PROJECT}")

    print("=== UPLOAD V2 ===")
    remote_v2 = f"/tmp/asgard-v2-paid-adl-{TAG}.tar.gz"
    sftp.put(str(v2_tar), remote_v2)
    v2_tar.unlink(missing_ok=True)
    run(c, f"tar -xzf {remote_v2} -C {PROJECT}/public")

    print("=== MIGRATE V340 ===")
    run(
        c,
        f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 "
        f"-f {PROJECT}/migrations/V340__tender_participation_analysis_deadline.sql",
    )
    run(
        c,
        """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c \"
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name='tenders'
  AND column_name IN ('participation_paid','participation_fee','analysis_deadline')
ORDER BY 1;
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname='pm_analysis_stale_notices_notice_kind_check';
\" """,
    )

    print("=== VERIFY FILES ===")
    run(
        c,
        f"grep -n 'computeAnalysisDeadline\\|participation_paid\\|analysis_deadline_overdue\\|regFormPaid\\|reg-adl-overdue' "
        f"{PROJECT}/src/lib/business-days.js "
        f"{PROJECT}/src/routes/tenders-registry.js "
        f"{PROJECT}/src/services/pm-analysis-stale-cron.js "
        f"{PROJECT}/public/assets/js/registry_tab.js "
        f"{PROJECT}/public/assets/css/app.css | head -40",
    )
    run(c, f"grep -n \"SHELL_VERSION = '{VER}'\" {PROJECT}/public/sw.js")
    run(c, f"grep -n \"ASGARD_SHELL_VERSION = '{VER}'\" {PROJECT}/public/index.html")
    run(c, f"grep -n 'registry_tab.js?v={VER}' {PROJECT}/public/index.html")
    run(
        c,
        f"grep -l participation_paid {PROJECT}/public/v2/assets/*.js 2>/dev/null | head -5; "
        f"grep -l reg-adl-overdue {PROJECT}/public/v2/assets/*.css 2>/dev/null | head -3",
    )

    print("=== RESTART ===")
    run(c, "systemctl restart asgard-crm")
    run(
        c,
        """bash -lc '
systemctl is-active asgard-crm
for i in 1 2 3 4 5 6 7 8; do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/health || true)
  echo "try $i: $code"
  [ "$code" = "200" ] && break
  sleep 2
done
curl -s http://127.0.0.1:3000/api/version
echo
'""",
    )
    run(c, "journalctl -u asgard-crm -n 40 --no-pager | tail -30")

    print("=== SMOKE API / BUSINESS DAYS ===")
    run(
        c,
        f"""bash -lc 'cd {PROJECT} && node -e "
const b=require(\\"./src/lib/business-days\\");
const free=b.computeAnalysisDeadline({{docs_deadline:\\"2026-09-15\\",participation_paid:false,created_at:\\"2026-09-01\\"}});
const paid=b.computeAnalysisDeadline({{docs_deadline:\\"2026-09-15\\",participation_paid:true,created_at:\\"2026-09-01\\"}});
if(free!==\\"2026-09-10\\"||paid!==\\"2026-09-08\\") {{ console.error({{free,paid}}); process.exit(1); }}
console.log(\\"business-days OK\\", {{free,paid}});
"'""",
    )

    run(
        c,
        """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c \"
INSERT INTO app_updates (version, changes, created_at)
VALUES (
  'v20.27.119',
  'Реестр: платное участие + сумма, внутренний срок анализа (−3/−5 раб.дн.), колонки Участие/Анализ до, причина отмены, email дежурному РП при просрочке (V340).',
  NOW()
);
\" 2>/dev/null || true""",
    )

    sftp.close()
    c.close()
    print("DEPLOY OK", VER, "snap", SNAP)


if __name__ == "__main__":
    main()
