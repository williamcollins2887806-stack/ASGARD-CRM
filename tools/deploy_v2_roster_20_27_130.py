#!/usr/bin/env python3
"""Deploy public/v2 build after roster/readiness (shell already 20.27.130). No git reset."""
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
TAG = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-v2-roster-{TAG}"


def run(c, cmd, timeout=300):
    print("====", cmd[:220].replace("\n", " "))
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


def main():
    v2 = ROOT / "public" / "v2"
    if not (v2 / "assets").exists():
        raise SystemExit("public/v2/assets missing")

    # markers in built assets
    found_plan = False
    found_ready = False
    for p in (v2 / "assets").glob("*"):
        if p.suffix not in (".js", ".css"):
            continue
        try:
            t = p.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        if "ft-ts-row--planned" in t or "plan-arrive" in t or "is_planned_only" in t:
            found_plan = True
            print("plan marker in", p.name)
        if "canEditReadiness" in t or "READINESS_EDIT" in t or "userCanEditReadiness" in t:
            found_ready = True
            print("ready marker in", p.name)
        # minified may keep Russian string for not-ready date label
        if "\u041d\u0435 \u0433\u043e\u0442\u043e\u0432 \u0441 \u0434\u0430\u0442\u044b" in t:
            found_ready = True
            print("ready date label in", p.name)
    if not found_plan:
        raise SystemExit("v2 build missing plan UI markers — rebuild")
    if not found_ready:
        print("WARN: readiness marker not found in chunks (OK if only vanilla used)")

    tmp = Path(tempfile.gettempdir()) / f"asgard-v2-roster-{TAG}.tar.gz"
    with tarfile.open(tmp, "w:gz") as tar:
        tar.add(v2, arcname="v2")
    print("packed", tmp, tmp.stat().st_size)

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    run(
        c,
        f"mkdir -p /root/snapshots && tar -C {PROJECT}/public -czf {SNAP}.tgz v2 && ls -lh {SNAP}.tgz",
    )

    remote = f"/tmp/asgard-v2-roster-{TAG}.tar.gz"
    sftp.put(str(tmp), remote)
    tmp.unlink(missing_ok=True)
    run(c, f"tar -xzf {remote} -C {PROJECT}/public && rm -f {remote}")

    run(
        c,
        f"grep -l 'ft-ts-row--planned\\|plan-arrive\\|is_planned_only' {PROJECT}/public/v2/assets/*."
        f"{{js,css}} 2>/dev/null | head -5; "
        f"grep -l 'canEditReadiness\\|Не готов с даты' {PROJECT}/public/v2/assets/*.js 2>/dev/null | head -5; "
        f"test -f {PROJECT}/public/v2/index.html && echo V2_INDEX_OK; "
        f"curl -sS http://127.0.0.1:3000/api/version",
    )

    sftp.close()
    c.close()
    print("DONE v2", "snapshot=", SNAP + ".tgz")


if __name__ == "__main__":
    main()
