#!/usr/bin/env python3
"""Deploy brigade cart + MLSP period Excel + CRSelect window fix (shell 20.27.92).
No git reset on prod — snapshot + scp + restart.
"""
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
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-brigade-cart-{TAG}"
VER = "20.27.92"

FILES = [
    "public/assets/js/components/cr-select.js",
    "public/assets/js/brigade-cart.js",
    "public/assets/css/brigade-cart.css",
    "public/assets/js/personnel.js",
    "public/assets/js/telephony_popup.js",
    "public/index.html",
    "public/sw.js",
    "src/routes/brigade-cart.js",
    "src/routes/mlsp-stays.js",
    "src/lib/mlsp-stay-export.js",
    "src/index.js",
]

MARKERS = {
    "public/assets/js/components/cr-select.js": ["window.CRSelect = CRSelect"],
    "public/assets/js/brigade-cart.js": ["mountWorkSelect", "AsgardBrigadeCart", "z-bc-modal"],
    "public/assets/css/brigade-cart.css": ["bc-work-wrap", "z-bc-modal", "bc-bar"],
    "public/assets/js/personnel.js": ["AsgardBrigadeCart", "prs_mlsp_export", "Excel перевахтовка"],
    "public/assets/js/telephony_popup.js": ["pointer-events: none", "tp-visible"],
    "public/sw.js": [f"SHELL_VERSION = '{VER}'"],
    "public/index.html": [
        f"ASGARD_SHELL_VERSION = '{VER}'",
        f"brigade-cart.js?v={VER}",
        f"cr-select.js?v={VER}",
        f"telephony_popup.js?v={VER}",
    ],
    "src/routes/brigade-cart.js": ["/api/staff/brigade-cart", "key_only"],
    "src/routes/mlsp-stays.js": ["fastify.post('/export'", "buildMlspPeriodExcel"],
    "src/lib/mlsp-stay-export.js": ["buildMlspPeriodExcel"],
    "src/index.js": [
        "routes/brigade-cart",
        "routes/mlsp-stays",
        "/api/staff/brigade-cart",
        "/api/staff/mlsp-stays",
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
    # New files may not exist on prod yet — snapshot only what is present.
    existing = []
    for rel in FILES:
        remote = f"{PROJECT}/{rel}"
        try:
            sftp.stat(remote)
            existing.append(rel)
        except OSError:
            print(f"  (skip snap, new file) {rel}")
    if existing:
        run(
            c,
            "mkdir -p /root/snapshots && tar -C {p} -czf {s}.tgz {files} && ls -lh {s}.tgz".format(
                p=PROJECT,
                s=SNAP,
                files=" ".join(existing),
            ),
        )
    else:
        run(c, "mkdir -p /root/snapshots && echo no_existing_files_to_snap")

    print("=== UPLOAD ===")
    for rel in FILES:
        local = ROOT / rel
        remote = f"{PROJECT}/{rel}"
        # ensure parent exists for new files
        parent = str(Path(remote).parent).replace("\\", "/")
        run(c, f"mkdir -p {parent}")
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
        "  'Дружина: корзина бригады и Excel перевахтовки',\n"
        "  '[\"Корзина бригады: планка, назначение, план, оценки, допуски\","
        " \"Выбор работы через CRSelect (поиск)\","
        " \"Excel состав бригады и матрица допусков\","
        " \"Excel перевахтовка за период МЛСП\","
        " \"Фикс кликов планки под telephony popup\"]'::jsonb,\n"
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

    print("=== RESTART ===")
    run(
        c,
        "systemctl restart asgard-crm && sleep 3 && systemctl is-active asgard-crm "
        "&& curl -sS http://127.0.0.1:3000/api/version",
    )

    print("=== VERIFY ===")
    run(c, f"grep -o \"SHELL_VERSION = '[^']*'\" {PROJECT}/public/sw.js")
    run(c, f"grep -o \"ASGARD_SHELL_VERSION = '[^']*'\" {PROJECT}/public/index.html")
    run(c, f"grep -c 'window.CRSelect = CRSelect' {PROJECT}/public/assets/js/components/cr-select.js")
    run(c, f"grep -c mountWorkSelect {PROJECT}/public/assets/js/brigade-cart.js")
    run(c, f"grep -c buildMlspPeriodExcel {PROJECT}/src/routes/mlsp-stays.js")
    run(c, f"test -f {PROJECT}/src/lib/mlsp-stay-export.js && echo mlsp_lib_ok")
    run(c, f"curl -sS -o /dev/null -w '%{{http_code}}\\n' http://127.0.0.1:3000/assets/js/brigade-cart.js?v={VER}")
    run(c, f"curl -sS http://127.0.0.1:3000/assets/js/components/cr-select.js?v={VER} | grep -c 'window.CRSelect = CRSelect'")

    sftp.close()
    c.close()
    print("DONE", VER, "snapshot=", SNAP + ".tgz")


if __name__ == "__main__":
    main()
