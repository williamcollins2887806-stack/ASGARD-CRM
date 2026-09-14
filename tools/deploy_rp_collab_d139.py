#!/usr/bin/env python3
"""Deploy D-139 RP-review collab + residual risk fixes. Snapshot + V304 + tar + restart. NO git reset."""
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
SHELL = "20.27.31"

FILES = [
    "migrations/V304__rp_review_participant_drafts.sql",
    "src/services/rp-review-drafts.js",
    "src/routes/rp-review-collab.js",
    "src/routes/pm-duty.js",
    "src/services/tender-registry-helpers.js",
    "src/routes/personal-kanban.js",
    "public/assets/js/rp_review_modal.js",
    "public/assets/js/registry_api.js",
    "public/assets/js/registry_tab.js",
    "public/assets/js/personal_kanban.js",
    "public/assets/js/mimir_quick_wizard.js",
    "public/assets/css/rp-review-modal.css",
    "public/sw.js",
    "public/index.html",
]


def run(c, cmd, timeout=180):
    print("====", cmd[:200].replace("\n", " "), "====")
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out:
        print(out[-20000:] if len(out) > 20000 else out)
    if err.strip():
        print("STDERR:", err[:3000])
    if code != 0:
        raise SystemExit(f"REMOTE CMD FAILED ({code}): {cmd[:120]}")
    return out


def main():
    for rel in FILES:
        p = ROOT / rel
        if not p.is_file():
            raise SystemExit(f"MISSING LOCAL: {rel}")

    sw = (ROOT / "public/sw.js").read_text(encoding="utf-8")
    idx = (ROOT / "public/index.html").read_text(encoding="utf-8")
    modal = (ROOT / "public/assets/js/rp_review_modal.js").read_text(encoding="utf-8")
    duty = (ROOT / "src/routes/pm-duty.js").read_text(encoding="utf-8")

    if f"SHELL_VERSION = '{SHELL}'" not in sw:
        raise SystemExit(f"LOCAL sw.js not {SHELL}")
    if f"ASGARD_SHELL_VERSION = '{SHELL}'" not in idx:
        raise SystemExit(f"LOCAL index.html not {SHELL}")
    if "mimir_quick_wizard.js" not in idx:
        raise SystemExit("LOCAL index.html missing mimir_quick_wizard.js")
    if "expected_updated_at" not in modal or "override_as_admin" not in modal:
        raise SystemExit("LOCAL modal missing lock/override markers")
    if "REVIEW_CONFLICT" not in duty or "override_as_admin" not in duty:
        raise SystemExit("LOCAL pm-duty missing conflict/override")
    if "registerRpReviewCollabRoutes" not in duty:
        raise SystemExit("LOCAL pm-duty missing collab register")

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    tar_name = f"_deploy_rp_collab_{stamp}.tar.gz"
    tar_local = ROOT / tar_name

    print(f"=== BUILD TAR {tar_name} ({len(FILES)} files) ===")
    with tarfile.open(tar_local, "w:gz") as tar:
        for rel in FILES:
            tar.add(ROOT / rel, arcname=rel)
            print(" +", rel)

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    snap = f"/root/snapshots/asgard-crm-pre-deploy-rp-collab-{stamp}"
    print(f"\n=== SNAPSHOT → {snap} ===")
    snap_cmds = [f"mkdir -p {snap}"]
    for rel in FILES:
        snap_cmds.append(
            f"mkdir -p {snap}/$(dirname {rel}) && "
            f"cp -a {PROJECT}/{rel} {snap}/{rel} 2>/dev/null || true"
        )
    snap_cmds.append(f"ls -la {snap} | head -30")
    run(c, " && ".join(snap_cmds), timeout=120)

    print("\n=== PROD BEFORE ===")
    run(
        c,
        f"grep -oP \"ASGARD_SHELL_VERSION = '\\K[^']+\" {PROJECT}/public/index.html | head -1; "
        f"grep -oP \"SHELL_VERSION = '\\K[^']+\" {PROJECT}/public/sw.js | head -1; "
        f"test -f {PROJECT}/src/routes/rp-review-collab.js && echo COLLAB=yes || echo COLLAB=no; "
        f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -tAc "
        f"\"SELECT COUNT(*) FROM information_schema.tables WHERE table_name='tender_rp_review_participant_drafts'\"",
    )

    remote_tar = f"/tmp/{tar_name}"
    print(f"\n=== SCP {tar_local.name} → {remote_tar} ===")
    sftp.put(str(tar_local), remote_tar)

    print("\n=== EXTRACT ===")
    run(c, f"tar xzf {remote_tar} -C {PROJECT} && ls -la {PROJECT}/src/routes/rp-review-collab.js {PROJECT}/src/services/rp-review-drafts.js {PROJECT}/public/assets/js/mimir_quick_wizard.js")

    print("\n=== APPLY V304 ===")
    run(
        c,
        f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 "
        f"-f {PROJECT}/migrations/V304__rp_review_participant_drafts.sql",
        timeout=120,
    )
    run(
        c,
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -tAc \""
        "SELECT 'drafts_table='||COUNT(*) FROM information_schema.tables "
        "WHERE table_name='tender_rp_review_participant_drafts'; "
        "SELECT 'purpose_col='||COUNT(*) FROM information_schema.columns "
        "WHERE table_name='tkp_quick_sessions' AND column_name='purpose'; "
        "SELECT 'owner_col='||COUNT(*) FROM information_schema.columns "
        "WHERE table_name='tender_rp_reviews' AND column_name='analysis_owner_user_id';\"",
    )

    print("\n=== BANNER ===")
    banner = (
        "D-139: Мимир в анализе/просчёте РП, параллельные черновики, "
        "optimistic lock финала, confirm ADMIN override, toast-fix; shell 20.27.31"
    )
    run(
        c,
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "
        f"\"INSERT INTO app_updates (version, changes, created_at) "
        f"VALUES ('v{SHELL}', '{banner}', NOW());\"",
    )

    print("\n=== RESTART ===")
    run(c, "systemctl restart asgard-crm && sleep 3 && systemctl is-active asgard-crm")

    print("\n=== SMOKE ===")
    run(
        c,
        f"curl -s -o /dev/null -w 'HOME=%{{http_code}}\\n' http://127.0.0.1:3000/; "
        f"curl -s -o /dev/null -w 'MODAL=%{{http_code}}\\n' http://127.0.0.1:3000/assets/js/rp_review_modal.js?v={SHELL}; "
        f"curl -s -o /dev/null -w 'MIMIR=%{{http_code}}\\n' http://127.0.0.1:3000/assets/js/mimir_quick_wizard.js?v={SHELL}; "
        f"curl -s http://127.0.0.1:3000/api/version; echo; "
        f"grep -oP \"ASGARD_SHELL_VERSION = '\\K[^']+\" {PROJECT}/public/index.html | head -1; "
        f"grep -c REVIEW_CONFLICT {PROJECT}/src/routes/pm-duty.js; "
        f"grep -c expected_updated_at {PROJECT}/public/assets/js/rp_review_modal.js; "
        f"journalctl -u asgard-crm -n 40 --no-pager | tail -40",
        timeout=60,
    )

    sftp.close()
    c.close()
    print("\nDEPLOY_OK", SHELL)
    print("SNAPSHOT", snap)
    print("TAR", tar_local)


if __name__ == "__main__":
    main()
