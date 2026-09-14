#!/usr/bin/env python3
"""Fix: office_academy ratings table (V301) + tenders LIMIT idx sync."""
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
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-academy-tenders-{TAG}"

FILES = [
    "src/routes/tenders.js",
    "migrations/V301__office_academy_ratings.sql",
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
    code = o.channel.recv_exit_status()
    if out:
        print(out[-10000:] if len(out) > 10000 else out)
    if err.strip():
        print("STDERR:", err[:2000])
    if code != 0:
        raise SystemExit(f"FAILED ({code}): {cmd[:160]}")
    return out


def main():
    tenders = (ROOT / "src/routes/tenders.js").read_text(encoding="utf-8")
    if "date-filter пушит в params" not in tenders and "idx = params.length + 1" not in tenders:
        raise SystemExit("tenders.js missing idx sync fix")
    if "LIMIT $${idx}::int" not in tenders and "LIMIT ${idx}::int" not in tenders:
        # template literal in source is LIMIT $${idx}::int
        if "LIMIT $${idx}::int OFFSET $${idx + 1}::int" not in tenders:
            # written as: sql += ` ORDER BY t.id DESC LIMIT $${idx}::int OFFSET $${idx + 1}::int`;
            if "LIMIT $" not in tenders or "::int OFFSET $" not in tenders:
                raise SystemExit("tenders.js missing LIMIT ::int cast")

    mig = ROOT / "migrations/V301__office_academy_ratings.sql"
    if "office_academy_lesson_ratings" not in mig.read_text(encoding="utf-8"):
        raise SystemExit("bad migration file")

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    print("=== SNAPSHOT ===")
    existing = []
    for rel in FILES:
        try:
            sftp.stat(f"{PROJECT}/{rel}")
            existing.append(rel)
        except OSError:
            print("  (new)", rel)
    if existing:
        run(
            c,
            "mkdir -p /root/snapshots && tar -C {p} -czf {s}.tgz {files} && ls -lh {s}.tgz".format(
                p=PROJECT, s=SNAP, files=" ".join(existing)
            ),
        )

    print("=== UPLOAD ===")
    for rel in FILES:
        local = ROOT / rel
        remote = f"{PROJECT}/{rel}"
        parent = str(Path(remote).parent).replace("\\", "/")
        run(c, f"mkdir -p {parent}")
        digest = md5_file(local)
        sftp.put(str(local), remote)
        with sftp.file(remote, "rb") as rf:
            rmd5 = hashlib.md5(rf.read()).hexdigest()
        print(f"  {'OK' if rmd5 == digest else 'FAIL'} {rel}")
        if rmd5 != digest:
            raise SystemExit("md5 fail " + rel)

    print("=== MIGRATE V301 ===")
    run(
        c,
        f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 "
        f"-f {PROJECT}/migrations/V301__office_academy_ratings.sql",
    )
    run(
        c,
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "
        "\"SELECT to_regclass('public.office_academy_lesson_ratings') AS ratings;\"",
    )
    # best-effort schema_migrations bookkeeping if table exists
    run(
        c,
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "
        "\"SELECT to_regclass('public.schema_migrations') AS sm;\"",
    )

    print("=== RESTART ===")
    run(
        c,
        "systemctl restart asgard-crm && sleep 3 && systemctl is-active asgard-crm "
        "&& curl -sS http://127.0.0.1:3000/api/version",
    )

    print("=== VERIFY MARKERS ===")
    run(c, f"grep -c 'idx = params.length + 1' {PROJECT}/src/routes/tenders.js")
    run(c, f"grep -c 'LIMIT \\$\\${{idx}}::int' {PROJECT}/src/routes/tenders.js || "
        f"grep -n '::int OFFSET' {PROJECT}/src/routes/tenders.js | head -3")

    sftp.close()
    c.close()
    print("DONE snapshot=", SNAP + ".tgz")


if __name__ == "__main__":
    main()
