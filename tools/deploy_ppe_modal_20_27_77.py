#!/usr/bin/env python3
"""Deploy: profile modal fix + PPE size catalog (shell 20.27.77)."""
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
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-ppe-modal-{TAG}"

FILES = [
    "src/lib/ppe-sizes.js",
    "src/routes/field-worker.js",
    "src/routes/staff.js",
    "public/assets/js/ppe-sizes.js",
    "public/assets/js/employee.js",
    "public/index.html",
    "public/sw.js",
    "public/m/index.html",
]

# mobile assets — add dynamically
M_ASSETS = ROOT / "public" / "m" / "assets"


def md5_file(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def run(c, cmd, timeout=180):
    print("====", cmd[:200].replace("\n", " "))
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    if out:
        print(out[-15000:] if len(out) > 15000 else out)
    if err.strip():
        print("STDERR:", err[:3000])
    return out


def main():
    files = list(FILES)
    for p in sorted(M_ASSETS.rglob("*")):
        if p.is_file():
            rel = p.relative_to(ROOT).as_posix()
            files.append(rel)

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    # snapshot key files only (not whole m assets)
    snap_list = " ".join(FILES + ["public/m/assets"])
    run(
        c,
        f"mkdir -p /root/snapshots && tar -C {PROJECT} -czf {SNAP}.tgz {snap_list} 2>/dev/null; ls -lh {SNAP}.tgz",
    )

    run(c, f"mkdir -p {PROJECT}/src/lib {PROJECT}/public/assets/js {PROJECT}/public/m/assets")

    for rel in files:
        local = ROOT / rel
        if not local.is_file():
            print("SKIP missing", rel)
            continue
        remote = f"{PROJECT}/{rel}"
        # ensure parent dir
        parent = str(Path(remote).parent).replace("\\", "/")
        try:
            sftp.stat(parent)
        except FileNotFoundError:
            run(c, f"mkdir -p {parent}")
        digest = md5_file(local)
        sftp.put(str(local), remote)
        with sftp.file(remote, "rb") as rf:
            remote_md5 = hashlib.md5(rf.read()).hexdigest()
        ok = remote_md5 == digest
        print(f"  {'OK' if ok else 'FAIL'} {rel}")
        if not ok:
            raise SystemExit("md5 fail " + rel)

    # app update banner for field
    sql_local = ROOT / "tools" / "_tmp_app_update_20_27_77.sql"
    sql_local.write_text(
        """INSERT INTO app_updates (version, title, changes, target) VALUES (
  '20.27.77',
  'Анкета и размеры СИЗ',
  '[{"icon":"🛡","text":"Починена модалка «Проверь анкету» — кнопки снова работают"},{"icon":"👕","text":"Размеры одежды/обуви/каски — только из единого списка"}]'::jsonb,
  'field'
) ON CONFLICT (version) DO UPDATE SET title = EXCLUDED.title, changes = EXCLUDED.changes, published_at = NOW();
""",
        encoding="utf-8",
    )
    sftp.put(str(sql_local), "/tmp/app_update_20_27_77.sql")
    run(c, "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -f /tmp/app_update_20_27_77.sql")

    run(
        c,
        "systemctl restart asgard-crm && sleep 3 && systemctl is-active asgard-crm "
        f"&& grep -o \"SHELL_VERSION = '[^']*'\" {PROJECT}/public/sw.js "
        f"&& grep -o \"index-[^\"]*\\.js\" {PROJECT}/public/m/index.html "
        "&& curl -sS http://127.0.0.1:3000/api/version",
    )

    sftp.close()
    c.close()
    print(f"DONE snapshot={SNAP}.tgz files={len(files)}")


if __name__ == "__main__":
    main()
