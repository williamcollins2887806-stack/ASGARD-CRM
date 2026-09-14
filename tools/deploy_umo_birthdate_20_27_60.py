#!/usr/bin/env python3
"""Deploy birth-date paste/age + UMO 45+ chip (shell 20.27.60)."""
import hashlib
import io
import os
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
TAG = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-umo-birth-{TAG}"
VER = "20.27.60"

FILES = [
    "public/assets/js/personnel.js",
    "public/index.html",
    "public/sw.js",
]

MARKERS = {
    "public/assets/js/personnel.js": [
        "parseFlexibleDate",
        "umoChipHtml",
        "УМО · 45+",
        "ae_birth_age",
    ],
    "public/sw.js": [f"SHELL_VERSION = '{VER}'"],
    "public/index.html": [
        f"ASGARD_SHELL_VERSION = '{VER}'",
        f"personnel.js?v={VER}",
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
        print(out[-10000:] if len(out) > 10000 else out)
    if err.strip():
        print("STDERR:", err[:2000])
    if code != 0:
        raise SystemExit(f"FAILED ({code}): {cmd[:140]}")
    return out


def pack_v2() -> Path:
    v2 = ROOT / "public" / "v2"
    if not (v2 / "index.html").exists():
        raise SystemExit("public/v2 missing — build first")
    # sanity: feature present in built assets
    found = False
    for p in (v2 / "assets").glob("*.js"):
        try:
            txt = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        if "prs-umo-chip" in txt or "needsUmo" in txt or "birthAgeHelp" in txt:
            found = True
            break
    if not found:
        raise SystemExit("v2 build missing UMO/birth markers — rebuild")
    tmp = Path(tempfile.gettempdir()) / f"asgard-v2-umo-{TAG}.tar.gz"
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
    sftp = c.open_sftp()

    print("=== SNAPSHOT ===")
    run(
        c,
        "mkdir -p /root/snapshots && tar -C {p} -czf {s}.tgz {files} && ls -lh {s}.tgz".format(
            p=PROJECT,
            s=SNAP,
            files=" ".join(FILES + ["public/v2"]),
        ),
    )

    print("=== UPLOAD FILES ===")
    for rel in FILES:
        local = ROOT / rel
        remote = f"{PROJECT}/{rel}"
        digest = md5_file(local)
        sftp.put(str(local), remote)
        with sftp.file(remote, "rb") as rf:
            remote_md5 = hashlib.md5(rf.read()).hexdigest()
        print(f"  {'OK' if remote_md5 == digest else 'FAIL'} {rel} {digest}")
        if remote_md5 != digest:
            raise SystemExit("md5 fail")

    print("=== UPLOAD V2 TAR ===")
    remote_tar = f"/tmp/asgard-v2-umo-{TAG}.tar.gz"
    sftp.put(str(v2_tar), remote_tar)
    run(
        c,
        f"rm -rf {PROJECT}/public/v2.new && mkdir -p {PROJECT}/public/v2.new && "
        f"tar xzf {remote_tar} -C {PROJECT}/public/v2.new && "
        f"rm -rf {PROJECT}/public/v2.bak && "
        f"mv {PROJECT}/public/v2 {PROJECT}/public/v2.bak && "
        f"mv {PROJECT}/public/v2.new/v2 {PROJECT}/public/v2 && "
        f"rm -rf {PROJECT}/public/v2.new && rm -f {remote_tar} && "
        f"test -f {PROJECT}/public/v2/index.html && "
        f"grep -l 'prs-umo-chip\\|needsUmo\\|birthAgeHelp' {PROJECT}/public/v2/assets/*.js | head -3",
    )

    print("=== BANNER ===")
    # schema: version, title, changes(jsonb), target — пишем через файл (кавычки)
    remote_sql = f"/tmp/app_update_{VER.replace('.', '_')}.sql"
    sql_body = (
        "INSERT INTO app_updates (version, title, changes, target)\n"
        "VALUES (\n"
        f"  'v{VER}',\n"
        "  'Дружина: дата рождения и УМО 45+',\n"
        "  '[\"Дружина: можно вставить дату рождения (дд.мм.гггг) — показывается возраст\","
        " \"Индикатор УМО · 45+ для рабочих 45 лет и старше\"]'::jsonb,\n"
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
    run(c, f"grep -n 'umoChipHtml\\|parseFlexibleDate\\|ae_birth_age' {PROJECT}/public/assets/js/personnel.js | head -10")
    run(c, "curl -sS http://127.0.0.1:3000/api/version")
    run(c, "systemctl is-active asgard-crm")

    # frontend-only — restart not required; version is read from sw.js on disk
    sftp.close()
    c.close()
    try:
        os.unlink(v2_tar)
    except OSError:
        pass
    print("DONE", VER)


if __name__ == "__main__":
    main()
