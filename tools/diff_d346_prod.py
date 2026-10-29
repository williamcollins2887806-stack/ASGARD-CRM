#!/usr/bin/env python3
"""Read-only: чем прод-версия rp_calc_modal.js отличается от локальной и от git HEAD.

Нужно перед выкладкой: если на проде есть правки, которых нет локально,
заливка локального файла их сотрёт. Смотрим ТОЛЬКО diff, ничего не пишем.
"""
import difflib
import io
import subprocess
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
ROOT = Path(__file__).resolve().parents[1]
REL = "public/assets/js/rp_calc_modal.js"


def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    prod = sftp.file(f"{PROJECT}/{REL}", "r").read().decode("utf-8", "replace").splitlines()
    local = (ROOT / REL).read_text(encoding="utf-8").splitlines()
    try:
        head = subprocess.check_output(["git", "show", f"HEAD:{REL}"], cwd=ROOT).decode("utf-8", "replace").splitlines()
    except subprocess.CalledProcessError:
        head = []

    print(f"строк: прод={len(prod)} локально={len(local)} gitHEAD={len(head)}")

    print("\n########## ПРОД vs ЛОКАЛЬНО ##########")
    d = list(difflib.unified_diff(prod, local, "прод", "локально", lineterm="", n=2))
    if not d:
        print("(идентичны)")
    else:
        for line in d:
            print(line)

    print("\n########## git HEAD vs ПРОД ##########")
    d2 = list(difflib.unified_diff(head, prod, "gitHEAD", "прод", lineterm="", n=2))
    if not d2:
        print("(идентичны)")
    else:
        for line in d2[:400]:
            print(line)
        if len(d2) > 400:
            print(f"... ещё {len(d2) - 400} строк diff")

    sftp.close()
    c.close()


if __name__ == "__main__":
    main()
