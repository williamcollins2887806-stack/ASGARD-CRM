# -*- coding: utf-8 -*-
"""Deploy: field timesheet stages by work_id + day conflict overwrite (shell 20.27.66)."""
import hashlib
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
VER = "20.27.66"
TAG = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-ts-conflict-{TAG}"

FILES = [
    "src/lib/timesheet-day-conflict.js",
    "src/routes/field-manage.js",
    "src/routes/field-stages.js",
    "src/routes/timesheet-v2.js",
    "public/assets/js/field-tab.js",
    "public/assets/js/timesheet-v2.js",
    "public/desktop-v2-src/src/pages/PmWorks/modals/FieldTab/api.js",
    "public/desktop-v2-src/src/pages/PmWorks/modals/FieldTab/field-tab.css",
    "public/desktop-v2-src/src/pages/PmWorks/modals/FieldTab/tabs/BulkShiftModal.jsx",
    "public/desktop-v2-src/src/pages/PmWorks/modals/FieldTab/tabs/ShiftPopover.jsx",
    "public/desktop-v2-src/src/pages/PmWorks/modals/FieldTab/tabs/Stages.jsx",
    "public/desktop-v2-src/src/pages/PmWorks/modals/FieldTab/tabs/Timesheet.jsx",
    "public/desktop-v2-src/src/pages/PmWorks/modals/FieldTab/tabs/timesheetUtils.js",
    "public/desktop-v2-src/src/pages/Timesheet/index.jsx",
    "public/mobile-app/src/pages/timesheet/TimesheetMobile.jsx",
    "public/index.html",
    "public/sw.js",
]

MARKERS = {
    "src/lib/timesheet-day-conflict.js": ["day_conflict", "confirmOverwrite", "assertNoCheckinConflict"],
    "src/routes/field-manage.js": [
        "assertNoStageConflict",
        "ТОЛЬКО work_id = эта работа",
        "AND fts.work_id = $1",
    ],
    "src/routes/field-stages.js": ["assertNoCheckinConflict", "ORDER BY COALESCE(date_from"],
    "src/routes/timesheet-v2.js": [
        "assertNoCheckinConflict",
        "totals — после цикла placeCell",
        "ORDER BY COALESCE(date_from, created_at::date) DESC",
    ],
    "public/assets/js/field-tab.js": ["apiCheckinWithConflictConfirm", "requires_confirmation"],
    "public/assets/js/timesheet-v2.js": ["confirm_overwrite", "requires_confirmation"],
    "public/sw.js": [f"SHELL_VERSION = '{VER}'"],
    "public/index.html": [
        f"ASGARD_SHELL_VERSION = '{VER}'",
        f"field-tab.js?v={VER}",
    ],
    "public/desktop-v2-src/src/pages/PmWorks/modals/FieldTab/tabs/Timesheet.jsx": [
        "requires_confirmation",
        "confirm_overwrite",
    ],
    "public/desktop-v2-src/src/pages/PmWorks/modals/FieldTab/tabs/BulkShiftModal.jsx": [
        "confirm_overwrite",
        "Перезаписать все такие дни",
    ],
}


def md5_file(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


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
    needles = ("confirm_overwrite", "requires_confirmation", "Перезаписать")
    found = False
    for p in (v2 / "assets").glob("*.js"):
        try:
            txt = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        if all(n in txt for n in needles[:2]):
            found = True
            print(f"v2 conflict markers in {p.name}")
            break
    if not found:
        raise SystemExit("v2 build missing conflict markers — rebuild desktop-v2-src")
    tmp = Path(tempfile.gettempdir()) / f"asgard-v2-ts-conflict-{TAG}.tar.gz"
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
    # Новый файл на проде может отсутствовать — игнорируем missing.
    run(
        c,
        "mkdir -p /root/snapshots && tar -C {p} -czf {s}.tgz --ignore-failed-read {files} public/v2 && ls -lh {s}.tgz".format(
            p=PROJECT,
            s=SNAP,
            files=" ".join(FILES),
        ),
    )

    print("=== UPLOAD FILES ===")
    remote_tar = f"/tmp/asgard-ts-conflict-{TAG}.tar.gz"
    with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as tmp:
        tar_path = Path(tmp.name)
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(ROOT / rel, arcname=rel)
    sftp.put(str(tar_path), remote_tar)
    tar_path.unlink(missing_ok=True)
    run(c, f"tar -xzf {remote_tar} -C {PROJECT}")

    print("=== UPLOAD V2 ===")
    remote_v2 = f"/tmp/asgard-v2-ts-conflict-{TAG}.tar.gz"
    sftp.put(str(v2_tar), remote_v2)
    v2_tar.unlink(missing_ok=True)
    run(c, f"tar -xzf {remote_v2} -C {PROJECT}/public")

    print("=== VERIFY MARKERS ON PROD ===")
    run(
        c,
        f"grep -n 'ТОЛЬКО work_id = эта работа\\|fts.work_id = \\$1\\|day_conflict\\|SHELL_VERSION' "
        f"{PROJECT}/src/routes/field-manage.js {PROJECT}/src/lib/timesheet-day-conflict.js "
        f"{PROJECT}/public/sw.js | head -40",
    )

    print("=== RESTART ===")
    run(c, "systemctl restart asgard-crm && sleep 2 && systemctl is-active asgard-crm")

    # banner
    run(
        c,
        """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c \"
INSERT INTO app_updates (version, changes, created_at)
VALUES ('v20.27.66',
  'Полевой табель: этапы только своей работы; при создании отметки work_id по назначению на дату; конфликт смена↔этап — предупреждение и перезапись; без двойного счёта баллов.',
  NOW());
\" """,
    )

    print("=== HEALTH ===")
    run(c, "curl -s -o /dev/null -w '%{http_code}' https://asgard-crm.ru/api/health || curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health || true")

    sftp.close()
    c.close()
    print("DEPLOY OK", VER, "snap", SNAP)


if __name__ == "__main__":
    main()
