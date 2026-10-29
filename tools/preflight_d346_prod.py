#!/usr/bin/env python3
"""Read-only сверка прода с локальной копией перед выкладкой D-346.

Ничего не меняет. Показывает:
  * версию оболочки на проде,
  * md5 по файлам, которые собираемся заливать,
  * есть ли на проде посторонние правки в этих файлах (сравнение с git HEAD).
"""
import hashlib
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

FILES = [
    "public/assets/js/rp_calc_modal.js",
    "public/index.html",
    "public/sw.js",
    "public/h/index.html",
    "public/h/sw.js",
]


def md5b(b: bytes) -> str:
    return hashlib.md5(b).hexdigest()


def git_show(rel: str) -> bytes | None:
    """Содержимое файла в последнем коммите — база для «чужих правок»."""
    try:
        return subprocess.check_output(["git", "show", f"HEAD:{rel}"], cwd=ROOT, stderr=subprocess.DEVNULL)
    except subprocess.CalledProcessError:
        return None


def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    _, o, _ = c.exec_command(f"grep -oP \"SHELL_VERSION = '\\K[^']+\" {PROJECT}/public/sw.js | head -1")
    print("ПРОД версия оболочки:", o.read().decode().strip())
    _, o, _ = c.exec_command(
        f"grep -oP \"function wantApproval\\(\\K[^)]*\" {PROJECT}/public/assets/js/rp_calc_modal.js | head -1"
    )
    params = o.read().decode().strip()
    print(f"ПРОД wantApproval(параметр): {params!r}  "
          f"({'СЛОМАНО — нет state' if params == '' else 'ок'})")

    print("\n--- md5: прод / локально / git HEAD ---")
    print(f"{'файл':46} {'прод=локально':14} {'прод=HEAD':10}")
    for rel in FILES:
        local = md5b((ROOT / rel).read_bytes())
        try:
            remote = md5b(sftp.file(f"{PROJECT}/{rel}", "r").read())
        except IOError:
            print(f"{rel:46} НЕТ НА ПРОДЕ")
            continue
        head = git_show(rel)
        hm = md5b(head) if head is not None else "—"
        print(f"{rel:46} {str(local == remote):14} {str(remote == hm):10}")

    sftp.close()
    c.close()


if __name__ == "__main__":
    main()
