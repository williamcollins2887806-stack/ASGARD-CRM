#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy Дружина «Без статуса» + V337 restore + shell 20.27.110. No git reset, no mobile rebuild."""
import hashlib
import io
import sys
import tarfile
import tempfile
import time
from datetime import datetime
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
ROOT = Path(__file__).resolve().parents[1]
PROJECT = "/var/www/asgard-crm"
TAG = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-crew-unknown-{TAG}"
NEW_VER = "20.27.110"

UPLOAD = [
    "public/assets/js/personnel.js",
    "public/assets/js/employee.js",
    "public/assets/js/brigade-cart.js",
    "public/index.html",
    "public/sw.js",
    "src/routes/worker-readiness.js",
    "src/services/readiness-cron.js",
    "src/lib/brigade-cart-export.js",
    "migrations/V337__restore_false_crew_archive.sql",
    "migrations/V337__restore_false_crew_archive_down.sql",
]

MARKERS = {
    "src/routes/worker-readiness.js": ["groups.unknown++", "effective_status = 'unknown'"],
    "src/services/readiness-cron.js": ["WITH candidates AS", "NOT IN ('ready', 'on_site', 'approved', 'archive')"],
    "src/lib/brigade-cart-export.js": ["unknown: 'Без статуса'"],
    "migrations/V337__restore_false_crew_archive.sql": ["V337: снят ложный архив"],
    "public/assets/js/personnel.js": ["label: 'Без статуса'", "grouped['unknown']"],
    "public/assets/js/employee.js": ['data-st="unknown"', "Без статуса"],
    "public/assets/js/brigade-cart.js": ["unknown: 'Без статуса'"],
    "public/index.html": [
        f"ASGARD_SHELL_VERSION = '{NEW_VER}'",
        f"personnel.js?v={NEW_VER}",
        f"employee.js?v={NEW_VER}",
        f"brigade-cart.js?v={NEW_VER}",
    ],
    "public/sw.js": [f"SHELL_VERSION = '{NEW_VER}'"],
}


def md5_file(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    for rel in UPLOAD:
        p = ROOT / rel
        if not p.is_file():
            raise SystemExit(f"missing {rel}")
        text = p.read_text(encoding="utf-8")
        for m in MARKERS.get(rel, []):
            if m not in text:
                raise SystemExit(f"marker missing in {rel}: {m}")

    v2_index = ROOT / "public" / "v2" / "index.html"
    if not v2_index.is_file():
        raise SystemExit("public/v2/index.html missing — run v2 build")
    modal = list((ROOT / "public" / "v2" / "assets").glob("EmployeeDetailModal-*.js"))
    if not modal:
        raise SystemExit("v2 EmployeeDetailModal chunk missing")
    modal_txt = modal[0].read_text(encoding="utf-8", errors="replace")
    if "Без статуса" not in modal_txt:
        raise SystemExit("v2 build missing «Без статуса»")
    print("local markers ok, v2 chunk", modal[0].name)

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    def run(cmd, timeout=180, check=True):
        print("====", cmd[:220].replace("\n", " "))
        _, o, e = c.exec_command(cmd, timeout=timeout)
        out = o.read().decode("utf-8", "replace")
        err = e.read().decode("utf-8", "replace")
        code = o.channel.recv_exit_status()
        if out.strip():
            print(out[-12000:] if len(out) > 12000 else out)
        if err.strip():
            print("STDERR:", err[:2500])
        if check and code != 0:
            raise SystemExit(f"FAILED ({code}): {cmd[:180]}")
        return out

    print("=== SCOPE ===")
    print("VANILLA: personnel.js employee.js brigade-cart.js index.html sw.js")
    print("BACKEND: worker-readiness.js readiness-cron.js brigade-cart-export.js V337")
    print("V2: public/v2 tar after vanilla upload")
    print("MOBILE: skip")

    print("=== SNAPSHOT ===")
    run("mkdir -p /root/snapshots")
    run(
        "tar -C {p} -czf {s}.tgz "
        "src/routes/worker-readiness.js src/services/readiness-cron.js "
        "public/assets/js/personnel.js public/assets/js/employee.js "
        "public/index.html public/sw.js".format(p=PROJECT, s=SNAP)
    )
    run(f"cp -a {PROJECT}/public/v2 {PROJECT}/public/v2.bak-crew-{TAG} || true", check=False)
    run(f"ls -lh {SNAP}.tgz")

    print("=== UPLOAD ===")
    for rel in UPLOAD:
        local = ROOT / rel
        remote = f"{PROJECT}/{rel}"
        parent = str(Path(remote).as_posix().rsplit("/", 1)[0])
        run(f"mkdir -p {parent}")
        digest = md5_file(local)
        sftp.put(str(local), remote)
        with sftp.file(remote, "rb") as rf:
            rmd5 = hashlib.md5(rf.read()).hexdigest()
        print(f"  {'OK' if rmd5 == digest else 'FAIL'} {rel}")
        if rmd5 != digest:
            raise SystemExit("md5 fail " + rel)

    print("=== VANILLA+BACKEND uploaded, now V2 tar ===")
    print("=== TAR v2 ===")
    tmp_v2 = Path(tempfile.gettempdir()) / f"asgard_v2_crew_{TAG}.tar"
    with tarfile.open(tmp_v2, "w") as tar:
        tar.add(ROOT / "public" / "v2", arcname="v2")
    print("v2 tar", tmp_v2.stat().st_size)
    sftp.put(str(tmp_v2), f"/tmp/asgard_v2_crew_{TAG}.tar")
    run(
        f"cd {PROJECT}/public && test -d v2 && "
        f"tar xf /tmp/asgard_v2_crew_{TAG}.tar && test -f v2/index.html && "
        f"grep -oE 'assets/[^\" ]+' v2/index.html | head -8"
    )
    run(f"grep -l 'Без статуса' {PROJECT}/public/v2/assets/EmployeeDetailModal-*.js | head")

    print("=== MIGRATE V337 ===")
    run(
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "
        "\"SELECT readiness_status, COUNT(*)::int AS n FROM employees "
        "WHERE is_active = true GROUP BY 1 ORDER BY 1;\""
    )
    run(
        f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 "
        f"-f {PROJECT}/migrations/V337__restore_false_crew_archive.sql"
    )
    run(
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "
        "\"SELECT readiness_status, COUNT(*)::int AS n FROM employees "
        "WHERE is_active = true GROUP BY 1 ORDER BY 1;\""
    )
    run(
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "
        "\"SELECT COUNT(*)::int AS restored FROM worker_readiness_log "
        "WHERE comment = 'V337: снят ложный архив — была недавняя работа';\""
    )

    print("=== BANNER ===")
    remote_sql = f"/tmp/app_update_{NEW_VER.replace('.', '_')}.sql"
    sql_body = (
        "INSERT INTO app_updates (version, title, changes, target)\n"
        "VALUES (\n"
        f"  '{NEW_VER}',\n"
        "  'Дружина: статус «Без статуса»',\n"
        "  '[\"Кто не готов / не на объекте / не в архиве — больше не падает в архив\","
        " \"Новый статус Без статуса\","
        " \"Автоархив только если 6 месяцев нет смен и назначений\"]'::jsonb,\n"
        "  'desktop'\n"
        ")\n"
        "ON CONFLICT (version) DO UPDATE\n"
        "SET title = EXCLUDED.title, changes = EXCLUDED.changes, published_at = now();\n"
    )
    with sftp.file(remote_sql, "w") as f:
        f.write(sql_body)
    run(
        f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 -f {remote_sql}; "
        f"rm -f {remote_sql}",
        check=False,
    )

    print("=== RESTART ===")
    run("systemctl restart asgard-crm")
    ok = False
    for i in range(1, 10):
        time.sleep(2)
        health = run(
            "systemctl is-active asgard-crm; "
            "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health || echo fail",
            check=False,
        )
        if "active" in health and "200" in health:
            ok = True
            print(f"HEALTH OK on try {i}")
            break
    if not ok:
        run("journalctl -u asgard-crm -n 80 --no-pager", check=False)
        raise SystemExit("health failed after restart")

    print("=== SMOKE ===")
    run("curl -s http://127.0.0.1:3000/api/version")
    run(f"grep -o \"SHELL_VERSION = '[^']*'\" {PROJECT}/public/sw.js")
    run(f"grep -o \"ASGARD_SHELL_VERSION = '[^']*'\" {PROJECT}/public/index.html")
    run(f"grep -n \"Без статуса\" {PROJECT}/public/assets/js/personnel.js | head")
    run(f"grep -n \"groups.unknown\" {PROJECT}/src/routes/worker-readiness.js | head")
    run(f"grep -n \"WITH candidates AS\" {PROJECT}/src/services/readiness-cron.js | head")
    run(
        f"curl -sS http://127.0.0.1:3000/assets/js/personnel.js?v={NEW_VER} | grep -c \"Без статуса\""
    )
    run("journalctl -u asgard-crm -n 40 --no-pager | tail -40")

    sftp.close()
    c.close()
    print("DEPLOYED crew-unknown", TAG, "shell", NEW_VER, "snap", SNAP + ".tgz")


if __name__ == "__main__":
    main()
