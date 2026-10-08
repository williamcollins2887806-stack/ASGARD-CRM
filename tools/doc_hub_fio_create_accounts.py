#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Create Zuban + AGPZ accounts on prod and remap doc_registry."""
from __future__ import annotations

import json
import re
import secrets
import string
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tests" / "reports" / "doc-hub-excel"
SSH_HOST = "92.242.61.184"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")


def connect():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = None
    for loader in (
        getattr(paramiko, "Ed25519Key", None),
        getattr(paramiko, "ECDSAKey", None),
        paramiko.RSAKey,
    ):
        if not loader:
            continue
        try:
            pkey = loader.from_private_key_file(SSH_KEY)
            break
        except Exception:
            pass
    ssh.connect(SSH_HOST, username="root", pkey=pkey, timeout=25)
    return ssh


def run(ssh, cmd, timeout=300):
    print("$", cmd[:200])
    _i, o, e = ssh.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", "replace")
    err = e.read().decode("utf-8", "replace")
    rc = o.channel.recv_exit_status()
    def safe(s):
        return s.encode("cp1251", "replace").decode("cp1251", "replace")
    if out.strip():
        print(safe(out[-4000:]))
    if err.strip():
        print("STDERR:", safe(err[-1500:]))
    print("rc=", rc)
    return rc, out, err


def gen_password(n=12):
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(n)) + "#A1"


def build_remap(zuban_id: int, agpz_id: int, pant_id: int, tuma_id: int) -> dict:
    rows = json.loads((OUT / "merged-rows.json").read_text(encoding="utf-8"))

    def norm(s):
        return re.sub(r"\s+", " ", str(s or "").lower().replace("ё", "е")).strip()

    def parts(s):
        return [norm(p) for p in re.split(r"\s*[\/,;+]+\s*|\s+и\s+", str(s or "")) if p.strip()]

    def map_owner(name):
        if not name:
            return None
        n = norm(name)
        ps = parts(name)
        # Петрушенко → Тумаева
        if any(p.startswith("петрушенко") for p in ps):
            return tuma_id
        # Сатубалдиева / Пираев / Михайлушкин (solo or leading) → AGPZ
        # Combo Баринов/Михайлушкин: keep Баринов (already set) — only force AGPZ if Mikhailushkin-only
        if "баринов" in n and "михайлуш" in n:
            return None
        if any(p.startswith("сатубал") or p.startswith("пираев") or p.startswith("михайлуш") for p in ps):
            return agpz_id
        return None

    def map_pm(name):
        if not name:
            return None
        n = norm(name)
        ps = parts(name)
        if any(p.startswith("платиц") for p in ps) or "платиц" in n:
            return pant_id
        if any(p.startswith("зубан") or p.startswith("зубар") for p in ps):
            return zuban_id
        if any(p.startswith("михайлуш") for p in ps):
            return agpz_id
        if any(p.startswith("сатубал") or p.startswith("пираев") for p in ps):
            return agpz_id
        if any(p.startswith("петрушенко") for p in ps):
            return tuma_id
        return None

    out_rows = []
    for r in rows:
        oid = map_owner(r.get("doc_owner_name"))
        pid = map_pm(r.get("work_pm_name"))
        if not oid and not pid:
            continue
        out_rows.append(
            {
                "invoice_number": r.get("invoice_number"),
                "counterparty_name": r.get("counterparty_name"),
                "invoice_date": r.get("invoice_date"),
                "amount_gross": r.get("amount_gross"),
                "doc_owner_id": oid,
                "work_pm_id": pid,
                "doc_owner_name": r.get("doc_owner_name"),
                "work_pm_name": r.get("work_pm_name"),
            }
        )
    return {"rows": out_rows}


def main():
    zuban_pass = gen_password()
    agpz_pass = gen_password()

    ssh = connect()
    sftp = ssh.open_sftp()

    local_js = ROOT / "tools" / "doc_hub_fio_accounts_prod.js"
    sftp.put(str(local_js), "/var/www/asgard-crm/tools/doc_hub_fio_accounts_prod.js")
    with sftp.file("/tmp/doc-hub-fio-remap.json", "w") as f:
        f.write(json.dumps({"rows": []}))

    # Phase 1 create
    rc, out, _ = run(
        ssh,
        "cd /var/www/asgard-crm && node tools/doc_hub_fio_accounts_prod.js "
        f"--zuban-pass '{zuban_pass}' --agpz-pass '{agpz_pass}'",
    )
    if rc != 0:
        raise SystemExit(rc)
    summary = json.loads(out[out.find("{") :])
    zuban_id = summary["zuban"]["user"]["id"]
    agpz_id = summary["agpz"]["user"]["id"]
    pant_id = summary["pantuzhenko"]["id"]
    tuma_id = summary["tumaeva"]["id"]
    print("IDs", zuban_id, agpz_id, pant_id, tuma_id)

    remap = build_remap(zuban_id, agpz_id, pant_id, tuma_id)
    remap_path = OUT / "fio-remap-payload.json"
    remap_path.write_text(json.dumps(remap, ensure_ascii=False, indent=2), encoding="utf-8")
    print("remap rows", len(remap["rows"]))
    sftp.put(str(remap_path), "/tmp/doc-hub-fio-remap.json")

    # Phase 2 remap
    rc, out2, _ = run(
        ssh,
        "cd /var/www/asgard-crm && node tools/doc_hub_fio_accounts_prod.js "
        f"--zuban-pass '{zuban_pass}' --agpz-pass '{agpz_pass}'",
    )
    if rc != 0:
        raise SystemExit(rc)
    summary2 = json.loads(out2[out2.find("{") :])

    creds = {
        "zuban": {
            "id": zuban_id,
            "login": "r.zuban",
            "email": "r.zuban@asgard-service.com",
            "password": zuban_pass,
            "role": "PM",
            "action": summary2["zuban"]["action"],
        },
        "agpz": {
            "id": agpz_id,
            "login": "agpz",
            "email": "agpz@asgard-service.com",
            "password": agpz_pass,
            "role": "OFFICE_MANAGER",
            "action": summary2["agpz"]["action"],
        },
        "maps": {
            "Платицин→Пантузенко": pant_id,
            "Петрушенко→Тумаева": tuma_id,
            "Пираев+Сатубалдиева+Михайлушкин→AGPZ": agpz_id,
            "Зубань→r.zuban": zuban_id,
        },
        "remap": summary2.get("remap"),
        "counts": summary2.get("counts"),
        "note": "v.mikhailushkin@asgard-service.com NOT created; Mikhailushkin docs → AGPZ",
    }
    (OUT / "fio-accounts-created.json").write_text(
        json.dumps(creds, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    md = "\n".join(
        [
            "# FIO accounts + remap (prod)",
            "",
            f"- **Зубань РП**: `{creds['zuban']['login']}` / {creds['zuban']['email']} / id={zuban_id} / pass `{zuban_pass}` ({creds['zuban']['action']})",
            f"- **АГПЗ офис**: `{creds['agpz']['login']}` / {creds['agpz']['email']} / id={agpz_id} / pass `{agpz_pass}` ({creds['agpz']['action']})",
            f"- Платицин → Пантузенко #{pant_id}",
            f"- Петрушенко → Тумаева #{tuma_id}",
            f"- Пираев + Сатубалдиева + Михайлушкин → AGPZ #{agpz_id}",
            f"- Remap: matched={summary2.get('remap',{}).get('matched')} owner_updates≈{summary2.get('remap',{}).get('updated_owner')} pm_updates≈{summary2.get('remap',{}).get('updated_pm')}",
            f"- Counts: {json.dumps(summary2.get('counts'), ensure_ascii=False)}",
            "",
            "Аккаунт `v.mikhailushkin@…` **не** создавался — его документы на AGPZ.",
            "",
        ]
    )
    (OUT / "fio-accounts-created.md").write_text(md, encoding="utf-8")
    print(md)
    sftp.close()
    ssh.close()


if __name__ == "__main__":
    main()
