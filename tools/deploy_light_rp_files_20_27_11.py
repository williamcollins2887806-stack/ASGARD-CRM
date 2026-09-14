#!/usr/bin/env python3
"""Careful deploy: light fills + RP attachments (shell 20.27.11). Snapshot + MD5, no git reset."""
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
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-light-rp-files-{TAG}"

# Minimal set for this package only
FILES = [
    "public/assets/css/app.css",
    "public/assets/js/rp_review_modal.js",
    "public/sw.js",
    "public/index.html",
]

MARKERS = [
    ("public/assets/css/app.css", "#fff8e1"),
    ("public/assets/css/app.css", "#fff3e8"),
    ("public/assets/css/app.css", "#eef4ff"),
    ("public/assets/js/rp_review_modal.js", "renderAttachmentsSection"),
    ("public/assets/js/rp_review_modal.js", "Вложения РП"),
    ("public/assets/js/rp_review_modal.js", "RP_FILE_ACCEPT"),
    ("public/assets/js/rp_review_modal.js", ".zip,.rar,.7z"),
    ("public/sw.js", "20.27.11"),
    ("public/index.html", "20.27.11"),
]

# Must NOT regress previous hotfixes still needed on prod
KEEP_MARKERS = [
    ("public/assets/js/rp_review_modal.js", "Закрыть анализ"),
    ("public/assets/js/rp_review_modal.js", "Файлы к анализу"),  # may be gone — check separately
    ("public/sw.js", "SHELL_VERSION"),
]


def md5_bytes(data: bytes) -> str:
    return hashlib.md5(data).hexdigest()


def run(c, cmd, timeout=120):
    print("====", cmd[:180].replace("\n", " "))
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    if out:
        print(out[-15000:] if len(out) > 15000 else out)
    if err.strip():
        print("STDERR:", err[:2500])
    return out, err


def main():
    for rel in FILES:
        local = ROOT / rel
        if not local.exists():
            raise SystemExit(f"missing: {rel}")
        text = local.read_text(encoding="utf-8", errors="replace")
        if rel.endswith("sw.js") and "20.27.11" not in text:
            raise SystemExit("sw.js is not 20.27.11 — abort")
        if rel.endswith("index.html") and "20.27.11" not in text:
            raise SystemExit("index.html is not 20.27.11 — abort")
        if rel.endswith("app.css") and "#fff8e1" not in text.lower():
            raise SystemExit("app.css missing pastel #fff8e1 — abort")
        if rel.endswith("rp_review_modal.js") and "renderAttachmentsSection" not in text:
            raise SystemExit("rp_review_modal missing attachments section — abort")

    # Preflight: local still has wipe-fix + created_by meta
    modal = (ROOT / "public/assets/js/rp_review_modal.js").read_text(encoding="utf-8")
    for must in ["Внёс", "syncFromDom", "Закрыть анализ"]:
        if must not in modal:
            raise SystemExit(f"regression risk: missing '{must}' in local modal")

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    print("=== Pre: prod version + script count ===")
    run(c, "curl -sS http://127.0.0.1:3000/api/version")
    run(
        c,
        f"grep -c 'src=\"assets/js/' {PROJECT}/public/index.html; "
        f"grep -o \"ASGARD_SHELL_VERSION = '[^']*'\" {PROJECT}/public/index.html",
    )

    print("\n=== Snapshot (only files we replace) ===")
    run(
        c,
        f"mkdir -p /root/snapshots && tar -C {PROJECT} -czf {SNAP}.tgz "
        + " ".join(FILES)
        + f" && ls -lh {SNAP}.tgz",
    )

    print("\n=== Upload + MD5 ===")
    bad = 0
    for rel in FILES:
        local = ROOT / rel
        remote = f"{PROJECT}/{rel}"
        data = local.read_bytes()
        digest = md5_bytes(data)
        sftp.put(str(local), remote)
        with sftp.file(remote, "rb") as rf:
            remote_md5 = md5_bytes(rf.read())
        ok = remote_md5 == digest
        print(f"  {'OK' if ok else 'FAIL'} {rel}\n    {digest}")
        if not ok:
            bad += 1
    if bad:
        raise SystemExit("MD5 mismatch — NOT restarting; restore from snapshot")

    print("\n=== Markers ===")
    for rel, needle in MARKERS:
        out, _ = run(c, f"grep -F -c {repr(needle)} {PROJECT}/{rel} || true")
        count = (out or "").strip().splitlines()[-1] if out else "0"
        print(f"  {rel} :: {needle!r} => {count}")
        if count.strip() in ("0", ""):
            raise SystemExit(f"marker missing after upload: {needle} in {rel}")

    # Ensure we did not drop critical previous fixes
    for needle in ["Внёс", "Закрыть анализ", "syncFromDom", "_liftAboveModals"]:
        # _liftAboveModals is in confirm.js — only check modal ones here
        if needle == "_liftAboveModals":
            out, _ = run(c, f"grep -F -c '_liftAboveModals' {PROJECT}/public/assets/js/confirm.js || true")
        else:
            out, _ = run(c, f"grep -F -c {repr(needle)} {PROJECT}/public/assets/js/rp_review_modal.js || true")
        count = (out or "").strip().splitlines()[-1] if out else "0"
        print(f"  keep :: {needle} => {count}")
        if count.strip() in ("0", ""):
            raise SystemExit(f"REGRESSION: lost marker {needle}")

    # Script list length should stay same (we only bumped ?v=)
    local_scripts = (ROOT / "public/index.html").read_text(encoding="utf-8").count('src="assets/js/')
    out, _ = run(c, f"grep -c 'src=\"assets/js/' {PROJECT}/public/index.html")
    remote_scripts = int((out or "0").strip().splitlines()[-1])
    print(f"script tags local={local_scripts} prod={remote_scripts}")
    if local_scripts != remote_scripts:
        raise SystemExit("index.html script count diverged — abort restart")

    # Old ?v= must not remain
    out, _ = run(
        c,
        f"grep -oE '\\?v=[0-9.]+' {PROJECT}/public/index.html | sort | uniq -c | sort -rn | head -5",
    )

    print("\n=== Restart ===")
    run(c, "systemctl restart asgard-crm && sleep 4 && systemctl is-active asgard-crm", timeout=90)

    print("\n=== Live ===")
    run(c, "curl -sS http://127.0.0.1:3000/api/version")
    run(c, "curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/")
    print()
    run(c, "journalctl -u asgard-crm -n 25 --no-pager")

    # Confirm previous confirm.js hotfix still on prod (not part of this upload)
    run(c, f"grep -c '_liftAboveModals' {PROJECT}/public/assets/js/confirm.js || true")
    run(c, f"grep -c '11050' {PROJECT}/public/assets/css/cr-modal.css || true")

    sftp.close()
    c.close()
    print(f"\nDONE. Snapshot: {SNAP}.tgz")


if __name__ == "__main__":
    main()
