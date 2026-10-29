#!/usr/bin/env python3
"""Read-only: сравнить файлы оболочки прод vs git HEAD (есть ли чужие правки).

Сравнение построчное — не по md5, потому что прод-файлы могут иметь CRLF,
и md5 тогда ложно показывает расхождение.
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

FILES = ["public/index.html", "public/sw.js", "public/h/index.html", "public/h/sw.js"]


def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    for rel in FILES:
        prod = sftp.file(f"{PROJECT}/{rel}", "r").read().decode("utf-8", "replace").splitlines()
        try:
            head = subprocess.check_output(
                ["git", "show", f"HEAD:{rel}"], cwd=ROOT
            ).decode("utf-8", "replace").splitlines()
        except subprocess.CalledProcessError:
            print(f"\n### {rel}: НЕТ В GIT")
            continue
        d = [l for l in difflib.unified_diff(head, prod, "gitHEAD", "прод", lineterm="", n=0)]
        only = [l for l in d if (l.startswith("+") or l.startswith("-")) and not l.startswith(("+++", "---"))]
        print(f"\n### {rel}: строк прод={len(prod)} HEAD={len(head)}, изменённых строк={len(only)}")
        for l in only[:20]:
            print("   " + l[:140])
        if len(only) > 20:
            print(f"   ... ещё {len(only) - 20}")

    sftp.close()
    c.close()


if __name__ == "__main__":
    main()
