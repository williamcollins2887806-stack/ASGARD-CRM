#!/usr/bin/env python3
"""Deploy field PIN auth 20.27.78 — wipe sessions + PIN hashes."""
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
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-field-pin-{TAG}"

FILES = [
    "src/routes/field-auth.js",
    "public/sw.js",
    "public/index.html",
    "public/m/index.html",
]


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
    if out:
        print(out[-12000:] if len(out) > 12000 else out)
    if err.strip():
        print("STDERR:", err[:2500])
    return out


def main():
    files = list(FILES)
    m_assets = ROOT / "public" / "m" / "assets"
    for p in sorted(m_assets.rglob("*")):
        if p.is_file() and p.suffix in {".js", ".css", ".html", ".svg", ".png", ".json"}:
            # skip huge glb binaries for speed — already on prod
            if "avatars" in p.as_posix():
                continue
            files.append(p.relative_to(ROOT).as_posix())

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    run(
        c,
        f"mkdir -p /root/snapshots && tar -C {PROJECT} -czf {SNAP}.tgz "
        f"src/routes/field-auth.js public/sw.js public/index.html public/m/index.html public/m/assets/index-*.js "
        f"2>/dev/null; ls -lh {SNAP}.tgz",
    )

    for rel in files:
        local = ROOT / rel
        if not local.is_file():
            print("SKIP", rel)
            continue
        remote = f"{PROJECT}/{rel}"
        parent = str(Path(remote).parent).replace("\\", "/")
        run(c, f"mkdir -p {parent}")
        digest = md5_file(local)
        sftp.put(str(local), remote)
        with sftp.file(remote, "rb") as rf:
            ok = hashlib.md5(rf.read()).hexdigest() == digest
        print(f"  {'OK' if ok else 'FAIL'} {rel}")
        if not ok:
            raise SystemExit("md5 fail " + rel)

    sql = ROOT / "tools" / "_tmp_field_pin_wipe.sql"
    sql.write_text(
        """BEGIN;
DELETE FROM field_sessions;
UPDATE users u
SET pin_hash = NULL, updated_at = NOW()
FROM employees e
WHERE e.user_id = u.id;
INSERT INTO app_updates (version, title, changes, target) VALUES (
  '20.27.78',
  'Новый вход: PIN вместо года рождения',
  '[{"icon":"🔐","text":"Вход по году рождения отключён"},{"icon":"📱","text":"Первый раз — SMS, создаёшь PIN из 4 цифр"},{"icon":"⚡","text":"Дальше только PIN, телефон не спрашиваем"},{"icon":"🔁","text":"Забыл PIN — снова SMS и новый код"}]'::jsonb,
  'field'
) ON CONFLICT (version) DO UPDATE SET title = EXCLUDED.title, changes = EXCLUDED.changes, published_at = NOW();
COMMIT;
SELECT
  (SELECT count(*) FROM field_sessions) AS sessions_left,
  (SELECT count(*) FROM users u JOIN employees e ON e.user_id = u.id WHERE u.pin_hash IS NOT NULL) AS pins_left;
""",
        encoding="utf-8",
    )
    sftp.put(str(sql), "/tmp/field_pin_wipe.sql")
    run(c, "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -f /tmp/field_pin_wipe.sql")

    run(c, "systemctl restart asgard-crm")
    run(c, "sleep 3 && systemctl is-active asgard-crm")
    run(c, f"grep -o \"SHELL_VERSION = '[^']*'\" {PROJECT}/public/sw.js")
    run(c, f"grep -o 'index-[^\"]*\\.js' {PROJECT}/public/m/index.html | head -1")
    run(c, "grep -n BIRTH_LOGIN_DISABLED /var/www/asgard-crm/src/routes/field-auth.js | head -3")
    run(c, "curl -sS http://127.0.0.1:3000/api/version")
    run(
        c,
        "curl -sS -X POST http://127.0.0.1:3000/api/field/auth/login-by-birth "
        "-H 'Content-Type: application/json' -d '{\"phone\":\"79001234567\",\"birth_year\":1990}'",
    )

    sftp.close()
    c.close()
    sql.unlink(missing_ok=True)
    print(f"DONE snapshot={SNAP}.tgz")


if __name__ == "__main__":
    main()
