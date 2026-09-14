#!/usr/bin/env python3
"""Safe deploy: ONLY rp-draft wipe fix (3 files). Snapshot + verify. No pm-duty, no other JS."""
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

# Minimal set — frontend-only, no backend restart needed
FILES = [
    "public/assets/js/rp_review_modal.js",
    "public/sw.js",
    "public/index.html",
]


def md5_bytes(data: bytes) -> str:
    return hashlib.md5(data).hexdigest()


def run(c, cmd, timeout=120):
    print("====", cmd[:160].replace("\n", " "), "====")
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    if out:
        print(out[-15000:] if len(out) > 15000 else out)
    if err.strip():
        print("STDERR:", err[:2000])
    return out


def main():
    # Preflight local
    for rel in FILES:
        p = ROOT / rel
        if not p.is_file():
            raise SystemExit(f"MISSING LOCAL: {rel}")
    modal = (ROOT / "public/assets/js/rp_review_modal.js").read_text(encoding="utf-8")
    if "Only sync fields that are currently mounted" not in modal:
        raise SystemExit("LOCAL modal missing wipe-fix marker")
    sw = (ROOT / "public/sw.js").read_text(encoding="utf-8")
    if "20.27.8" not in sw:
        raise SystemExit("LOCAL sw.js not bumped to 20.27.8")
    idx = (ROOT / "public/index.html").read_text(encoding="utf-8")
    if "ASGARD_SHELL_VERSION = '20.27.8'" not in idx:
        raise SystemExit("LOCAL index.html not bumped")
    if "rp_review_modal.js?v=20.27.8" not in idx:
        raise SystemExit("LOCAL index.html modal cache bust missing")

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    snap = f"/root/snapshots/asgard-crm-pre-deploy-rp-draft-wipe-{stamp}"
    print(f"\n=== SNAPSHOT → {snap} ===")
    run(
        c,
        f"mkdir -p {snap} && "
        + " && ".join(
            f"cp -a {PROJECT}/{rel} {snap}/$(basename {rel}).bak 2>/dev/null || true"
            for rel in FILES
        )
        + f" && ls -la {snap}",
    )

    print("\n=== PROD BEFORE: versions ===")
    run(
        c,
        f"grep -n \"SHELL_VERSION\\|ASGARD_SHELL_VERSION\\|rp_review_modal.js\" "
        f"{PROJECT}/public/sw.js {PROJECT}/public/index.html | head -20; "
        f"grep -c 'Only sync fields that are currently mounted' "
        f"{PROJECT}/public/assets/js/rp_review_modal.js || true; "
        f"grep -c 'Reading missing nodes' "
        f"{PROJECT}/public/assets/js/rp_review_modal.js || true",
    )

    # Compare index.html size / key markers so we don't silently drop prod-only scripts
    print("\n=== index.html risk check (script count / unique local scripts) ===")
    run(
        c,
        f"echo PROD_SCRIPTS=$(grep -c 'script defer src=' {PROJECT}/public/index.html); "
        f"echo PROD_VER=$(grep -oP \"ASGARD_SHELL_VERSION = '\\K[^']+\" {PROJECT}/public/index.html | head -1)",
    )
    local_scripts = set()
    for line in idx.splitlines():
        if "script defer src=" in line and "assets/js/" in line:
            # strip ?v=
            start = line.find("assets/js/")
            end = line.find("?", start)
            if end < 0:
                end = line.find('"', start)
            local_scripts.add(line[start:end])
    print(f"LOCAL_SCRIPTS={len(local_scripts)}")

    # Fetch prod script list
    prod_idx = sftp.file(f"{PROJECT}/public/index.html", "r").read().decode("utf-8", errors="replace")
    prod_scripts = set()
    for line in prod_idx.splitlines():
        if "script defer src=" in line and "assets/js/" in line:
            start = line.find("assets/js/")
            end = line.find("?", start)
            if end < 0:
                end = line.find('"', start)
            prod_scripts.add(line[start:end])
    only_local = sorted(local_scripts - prod_scripts)
    only_prod = sorted(prod_scripts - local_scripts)
    print(f"PROD_SCRIPTS={len(prod_scripts)}")
    print("ONLY_IN_LOCAL (would appear after upload):", only_local[:30], f"... total {len(only_local)}")
    print("ONLY_ON_PROD (would be LOST if we overwrite index):", only_prod[:30], f"... total {len(only_prod)}")

    if only_prod:
        print("\n!!! ABORT-ish: prod has scripts not in local index.html.")
        print("    Strategy: upload modal+sw, patch version on prod index in-place (no full overwrite).")
        strategy = "patch_index"
    else:
        strategy = "full_index"

    print(f"\n=== STRATEGY: {strategy} ===")

    # Always upload modal + sw
    for rel in ("public/assets/js/rp_review_modal.js", "public/sw.js"):
        local = ROOT / rel
        remote = f"{PROJECT}/{rel}"
        data = local.read_bytes()
        print(f"UPLOAD {rel} md5={md5_bytes(data)} size={len(data)}")
        sftp.put(str(local), remote)

    if strategy == "full_index":
        local = ROOT / "public/index.html"
        remote = f"{PROJECT}/public/index.html"
        data = local.read_bytes()
        print(f"UPLOAD public/index.html md5={md5_bytes(data)} size={len(data)}")
        sftp.put(str(local), remote)
    else:
        # In-place version bump on prod index.html: 20.27.x → 20.27.8 (or whatever prod has)
        # Prefer sed replace of known old versions to 20.27.8
        run(
            c,
            f"python3 - <<'PY'\n"
            f"from pathlib import Path\n"
            f"p = Path('{PROJECT}/public/index.html')\n"
            f"t = p.read_text(encoding='utf-8')\n"
            f"import re\n"
            f"old = re.search(r\"ASGARD_SHELL_VERSION = '([^']+)'\", t)\n"
            f"print('old_ver', old.group(1) if old else None)\n"
            f"t2 = re.sub(r\"ASGARD_SHELL_VERSION = '[^']+'\", \"ASGARD_SHELL_VERSION = '20.27.8'\", t, count=1)\n"
            f"t2 = re.sub(r\"(\\?v=)20\\.\\d+\\.\\d+\", r\"\\g<1>20.27.8\", t2)\n"
            f"# ensure modal specifically\n"
            f"t2 = t2.replace('rp_review_modal.js?v=', 'rp_review_modal.js?v=')  # noop keep\n"
            f"if \"ASGARD_SHELL_VERSION = '20.27.8'\" not in t2:\n"
            f"    raise SystemExit('bump failed')\n"
            f"p.write_text(t2, encoding='utf-8')\n"
            f"print('index patched in place, len', len(t2))\n"
            f"PY"
        )

    print("\n=== PROD AFTER verify ===")
    run(
        c,
        f"grep -n \"ASGARD_SHELL_VERSION\\|SHELL_VERSION =\" {PROJECT}/public/sw.js {PROJECT}/public/index.html | head -10; "
        f"grep -n 'rp_review_modal.js' {PROJECT}/public/index.html | head -3; "
        f"grep -c 'Only sync fields that are currently mounted' {PROJECT}/public/assets/js/rp_review_modal.js; "
        f"grep -n 'if (summaryEl) reportJson.summary' {PROJECT}/public/assets/js/rp_review_modal.js | head -3; "
        f"grep -n 'if (pointInps.length)' {PROJECT}/public/assets/js/rp_review_modal.js | head -3; "
        f"curl -s -o /dev/null -w 'HTTP %{http_code}\\n' http://127.0.0.1:3000/; "
        f"systemctl is-active asgard-crm",
    )

    # md5 compare local vs remote for modal+sw
    print("\n=== MD5 local vs prod ===")
    for rel in ("public/assets/js/rp_review_modal.js", "public/sw.js"):
        local_md5 = md5_bytes((ROOT / rel).read_bytes())
        remote_data = sftp.file(f"{PROJECT}/{rel}", "r").read()
        remote_md5 = md5_bytes(remote_data)
        ok = "OK" if local_md5 == remote_md5 else "MISMATCH"
        print(f"{ok} {rel} local={local_md5} prod={remote_md5}")

    print(f"\nSNAPSHOT: {snap}")
    print("NO backend restart (static assets only). NO other files touched.")
    sftp.close()
    c.close()


if __name__ == "__main__":
    main()
