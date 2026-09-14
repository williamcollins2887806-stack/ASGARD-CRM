#!/usr/bin/env python3
"""Deploy vanilla Дружина copy/phone/chips UI (shell 20.27.86). Frontend only, no git reset."""
import hashlib
import io
import sys
from datetime import datetime
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
ROOT = Path(__file__).resolve().parents[1]
TAG = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-prs-copy-ui-{TAG}"
VER = "20.27.86"

FILES = [
    "public/assets/css/components.css",
    "public/assets/css/app.css",
    "public/assets/css/light-theme.css",
    "public/assets/js/personnel.js",
    "public/assets/js/employee.js",
    "public/index.html",
    "public/sw.js",
]

MARKERS = {
    "public/assets/css/components.css": ["asg-copy-btn", "prs-id-phone", "prs-chip--umo"],
    "public/assets/js/personnel.js": ["prsIdentityCell", "fmtPrsPhone", "asg-copy-btn"],
    "public/assets/js/employee.js": ["asg-copy-btn--always", "btnCopyPhone"],
    "public/sw.js": [f"SHELL_VERSION = '{VER}'"],
    "public/index.html": [
        f"ASGARD_SHELL_VERSION = '{VER}'",
        f"personnel.js?v={VER}",
        f"employee.js?v={VER}",
        f"components.css?v={VER}",
    ],
}


def md5_file(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def run(c, cmd, timeout=180):
    print("====", cmd[:220].replace("\n", " "))
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out:
        print(out[-12000:] if len(out) > 12000 else out)
    if err.strip():
        print("STDERR:", err[:2000])
    if code != 0:
        raise SystemExit(f"FAILED ({code}): {cmd[:160]}")
    return out


def main():
    for rel in FILES:
        local = ROOT / rel
        if not local.exists():
            raise SystemExit(f"missing {rel}")
        text = local.read_text(encoding="utf-8")
        for m in MARKERS.get(rel, []):
            if m not in text:
                raise SystemExit(f"marker missing in {rel}: {m}")

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    print("=== SNAPSHOT ===")
    run(
        c,
        "mkdir -p /root/snapshots && tar -C {p} -czf {s}.tgz {files} && ls -lh {s}.tgz".format(
            p=PROJECT,
            s=SNAP,
            files=" ".join(FILES),
        ),
    )

    print("=== UPLOAD ===")
    for rel in FILES:
        local = ROOT / rel
        remote = f"{PROJECT}/{rel}"
        digest = md5_file(local)
        sftp.put(str(local), remote)
        with sftp.file(remote, "rb") as rf:
            remote_md5 = hashlib.md5(rf.read()).hexdigest()
        print(f"  {'OK' if remote_md5 == digest else 'FAIL'} {rel} {digest}")
        if remote_md5 != digest:
            raise SystemExit("md5 fail " + rel)

    print("=== BANNER ===")
    remote_sql = f"/tmp/app_update_{VER.replace('.', '_')}.sql"
    sql_body = (
        "INSERT INTO app_updates (version, title, changes, target)\n"
        "VALUES (\n"
        f"  '{VER}',\n"
        "  'Дружина: копирование, телефон, чипы',\n"
        "  '[\"Кнопка копирования — современная SVG вместо эмодзи\","
        " \"Чипы МЛСП и УМО в одной аккуратной строке\","
        " \"Телефон с иконкой и единым форматом +7 XXX XXX-XX-XX\"]'::jsonb,\n"
        "  'desktop'\n"
        ")\n"
        "ON CONFLICT (version) DO UPDATE\n"
        "SET title = EXCLUDED.title, changes = EXCLUDED.changes, published_at = now();\n"
    )
    with sftp.file(remote_sql, "w") as f:
        f.write(sql_body)
    run(
        c,
        f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 -f {remote_sql} "
        f"&& rm -f {remote_sql}",
    )

    print("=== VERIFY ===")
    run(c, f"grep -o \"SHELL_VERSION = '[^']*'\" {PROJECT}/public/sw.js")
    run(c, f"grep -o \"ASGARD_SHELL_VERSION = '[^']*'\" {PROJECT}/public/index.html")
    run(c, f"grep -n 'asg-copy-btn\\|prsIdentityCell\\|fmtPrsPhone\\|prs-chip--umo' {PROJECT}/public/assets/js/personnel.js | head -20")
    run(c, f"grep -n 'asg-copy-btn' {PROJECT}/public/assets/css/components.css | head -8")
    run(c, f"grep -n 'asg-copy-btn--always' {PROJECT}/public/assets/js/employee.js | head -5")
    run(c, "curl -sS http://127.0.0.1:3000/api/version")
    run(c, "systemctl is-active asgard-crm")
    run(
        c,
        f"curl -sS http://127.0.0.1:3000/assets/js/personnel.js?v={VER} | grep -c prsIdentityCell",
    )

    sftp.close()
    c.close()
    print("DONE", VER, "snapshot=", SNAP + ".tgz")


if __name__ == "__main__":
    main()
