#!/usr/bin/env python3
"""Deploy Work Norms physical dims (V312-V314) + service/UI. Shell 20.27.56. No git reset."""
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
VER = "20.27.56"
TAG = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-work-norms-{TAG}"

FILES = [
    "src/services/work-norms.js",
    "src/routes/work-norms.js",
    "public/assets/js/work_norms_ui.js",
    "public/index.html",
    "public/sw.js",
]

MIGRATIONS = [
    "migrations/V309__work_norms_catalog.sql",
    "migrations/V310__work_norm_experiences.sql",
    "migrations/V311__work_norms_enrich_research.sql",
    "migrations/V312__work_norms_per_direction.sql",
    "migrations/V313__avo_physical_dims.sql",
    "migrations/V314__physical_dims_all_dirs.sql",
]

MARKERS = [
    "physicalInputError",
    "resolveSurfaceM2",
    "plates_m2_shift",
]


def bump_shell():
    sw = ROOT / "public/sw.js"
    t = sw.read_text(encoding="utf-8")
    for cand in ("20.27.55", "20.27.54", "20.27.53"):
        needle = f"const SHELL_VERSION = '{cand}'"
        if needle in t:
            sw.write_text(t.replace(needle, f"const SHELL_VERSION = '{VER}'"), encoding="utf-8")
            print(f"sw.js {cand} -> {VER}")
            break
    else:
        if f"const SHELL_VERSION = '{VER}'" not in t:
            raise SystemExit("sw.js version not found")

    idx = ROOT / "public/index.html"
    t = idx.read_text(encoding="utf-8")
    for cand in ("20.27.55", "20.27.54", "20.27.53"):
        needle = f"window.ASGARD_SHELL_VERSION = '{cand}'"
        if needle in t:
            t = t.replace(needle, f"window.ASGARD_SHELL_VERSION = '{VER}'")
            break
    else:
        if f"window.ASGARD_SHELL_VERSION = '{VER}'" not in t:
            raise SystemExit("ASGARD_SHELL_VERSION not found")

    for cand in ("20.27.55", "20.27.54", "20.27.53", "20.27.52", "20.27.51", "20.27.50", "20.27.49", "20.27.48"):
        t = t.replace(f"assets/js/work_norms_ui.js?v={cand}", f"assets/js/work_norms_ui.js?v={VER}")
    if f"work_norms_ui.js?v={VER}" not in t:
        raise SystemExit("work_norms_ui.js version not bumped")
    idx.write_text(t, encoding="utf-8")
    print(f"index.html ASGARD + work_norms_ui.js -> {VER}")


def md5_file(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def run(c, cmd, timeout=300):
    print("====", cmd[:240].replace("\n", " "))
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out:
        print(out[-12000:] if len(out) > 12000 else out)
    if err.strip():
        print("STDERR:", err[:3000])
    if code != 0:
        raise SystemExit(f"FAILED ({code}): {cmd[:160]}")
    return out


def main():
    bump_shell()

    for rel in FILES + MIGRATIONS:
        p = ROOT / rel
        if not p.exists():
            raise SystemExit(f"missing {rel}")

    svc = (ROOT / "src/services/work-norms.js").read_text(encoding="utf-8")
    for m in MARKERS:
        if m not in svc:
            raise SystemExit(f"marker missing in work-norms.js: {m}")

    # ensure route registered in local index (upload only if needed)
    idx_js = (ROOT / "src/index.js").read_text(encoding="utf-8")
    if "routes/work-norms" not in idx_js:
        raise SystemExit("src/index.js missing work-norms register")

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    print("=== PREFLIGHT PROD ===")
    pre = run(
        c,
        "ls -la {p}/src/services/work-norms.js {p}/src/routes/work-norms.js "
        "{p}/public/assets/js/work_norms_ui.js 2>&1; "
        "ls {p}/migrations/V309*.sql {p}/migrations/V310*.sql {p}/migrations/V311*.sql "
        "{p}/migrations/V312*.sql {p}/migrations/V313__avo*.sql {p}/migrations/V314*.sql 2>&1; "
        "grep -n work-norms {p}/src/index.js | head -5; "
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -tAc "
        "\"SELECT EXISTS(SELECT 1 FROM information_schema.columns "
        "WHERE table_name='work_norm_categories' AND column_name='experience_schema_json');\"".format(
            p=PROJECT
        ),
    )
    need_index = "routes/work-norms" not in pre

    print("=== SNAPSHOT ===")
    snap_list = FILES + MIGRATIONS + (["src/index.js"] if need_index else [])
    run(
        c,
        f"mkdir -p /root/snapshots && tar -C {PROJECT} -czf {SNAP}.tgz {' '.join(snap_list)} 2>/dev/null; "
        f"ls -lh {SNAP}.tgz",
    )

    print("=== UPLOAD ===")
    upload = FILES + MIGRATIONS + (["src/index.js"] if need_index else [])
    if need_index:
        print("NOTE: uploading src/index.js (work-norms register missing on prod)")
    else:
        print("NOTE: skip src/index.js (work-norms already registered)")

    for rel in ("src/services", "src/routes", "migrations", "public/assets/js"):
        try:
            sftp.stat(f"{PROJECT}/{rel}")
        except OSError:
            run(c, f"mkdir -p {PROJECT}/{rel}", timeout=30)

    for rel in upload:
        local = ROOT / rel
        remote = f"{PROJECT}/{rel}"
        digest = md5_file(local)
        sftp.put(str(local), remote)
        with sftp.file(remote, "rb") as rf:
            remote_md5 = hashlib.md5(rf.read()).hexdigest()
        print(f"  {'OK' if remote_md5 == digest else 'FAIL'} {rel} {digest}")
        if remote_md5 != digest:
            raise SystemExit("md5 fail")

    # remote smoke helper
    smoke_js = (
        "const {Pool}=require('pg');\n"
        "const wn=require('./src/services/work-norms');\n"
        "const pool=new Pool({host:'localhost',database:'asgard_crm',user:'asgard',password:'123456789'});\n"
        "(async()=>{\n"
        "  const ok=await wn.previewCalc(pool,{category_code:'plates',method_code:'hydro_dis',"
        "inputs:{surface_m2:120},fouling:'medium',posts:1});\n"
        "  const bad=await wn.previewCalc(pool,{category_code:'plates',method_code:'hydro_dis',"
        "inputs:{apparatus:3},fouling:'medium',posts:1});\n"
        "  const boiler=await wn.previewCalc(pool,{category_code:'boilers',method_code:'hydro',"
        "inputs:{surface_m2:400},fouling:'medium',posts:1});\n"
        "  console.log('OK_PLATES', ok.results&&ok.results.work_days, ok.rate&&ok.rate.code);\n"
        "  console.log('ERR_PLATES', bad.error&&bad.error.slice(0,100));\n"
        "  console.log('OK_BOILER', boiler.results&&boiler.results.work_days, boiler.rate&&boiler.rate.code);\n"
        "  if(!(ok.results&&ok.results.work_days>0)) process.exit(2);\n"
        "  if(!bad.error) process.exit(3);\n"
        "  if(!(boiler.results&&boiler.results.work_days>0)) process.exit(4);\n"
        "  await pool.end();\n"
        "  console.log('SMOKE_PASS');\n"
        "})().catch(e=>{console.error(e);process.exit(1);});\n"
    )
    with sftp.file(f"{PROJECT}/_wn_smoke.js", "w") as f:
        f.write(smoke_js)

    sftp.close()

    print("=== MIGRATIONS (idempotent apply V309..V314) ===")
    for rel in MIGRATIONS:
        remote = f"{PROJECT}/{rel}"
        name = Path(rel).name
        run(
            c,
            f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=0 -f {remote} "
            f"2>&1 | tail -50; echo DONE:{name}",
            timeout=180,
        )

    print("=== VERIFY SCHEMA ===")
    rates = run(
        c,
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -tAc "
        "\"SELECT code FROM work_norm_rates WHERE code IN ("
        "'plates_m2_shift','boiler_hydro_m2_shift','boiler_mech_m2_shift',"
        "'boiler_chem_hours','itp_m3_shift','compabloc_m2_shift','plates_pack_pcs_shift'"
        ") ORDER BY 1;\"",
    )
    needed = [
        "plates_m2_shift",
        "boiler_hydro_m2_shift",
        "boiler_mech_m2_shift",
        "boiler_chem_hours",
        "itp_m3_shift",
        "compabloc_m2_shift",
        "plates_pack_pcs_shift",
    ]
    for code in needed:
        if code not in rates:
            raise SystemExit(f"rate missing after migrations: {code}")

    print("=== RESTART ===")
    run(c, "systemctl restart asgard-crm && sleep 3 && systemctl is-active asgard-crm")

    print("=== SMOKE ===")
    run(
        c,
        "curl -s -o /dev/null -w 'home:%{http_code}\\n' https://asgard-crm.ru/; "
        f"grep -n \"physicalInputError\\|plates_m2_shift\" {PROJECT}/src/services/work-norms.js | head -5; "
        f"grep -n \"ASGARD_SHELL_VERSION\\|work_norms_ui.js\" {PROJECT}/public/index.html | head -5; "
        "journalctl -u asgard-crm -n 25 --no-pager | tail -25",
    )
    run(c, f"cd {PROJECT} && node _wn_smoke.js && rm -f _wn_smoke.js", timeout=60)

    run(
        c,
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "
        "\"INSERT INTO app_updates (version, changes, created_at) VALUES "
        f"('v{VER}', "
        "'Work Norms: срок только от физ. объёма (м²/м³/м/трубки×Ø×L/Ду). "
        "Пластины/котлы/ИТП/компаблок — без сут/шт. V312–V314.', "
        "NOW());\"",
    )

    c.close()
    print("=== DEPLOY DONE", VER, "===")


if __name__ == "__main__":
    main()
