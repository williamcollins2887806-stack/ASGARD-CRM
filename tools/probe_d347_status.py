#!/usr/bin/env python3
"""Read-only: коды ответов по тендеру 2101 + состояние просчёта в БД.

Нужно понять, что именно вернул PUT /rp-review: 400 (валидация) или 409
(optimistic lock). И в каком состоянии запись после загрузки ТКП.
"""
import io
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("92.242.61.184", username="root",
          pkey=paramiko.Ed25519Key.from_private_key_file(str(KEY)), timeout=30)


def run(cmd, limit=9000):
    print("====", cmd[:150], "====")
    _, o, e = c.exec_command(cmd, timeout=180)
    out = o.read().decode("utf-8", "replace")
    err = e.read().decode("utf-8", "replace")
    print((out[:limit] if out else "(пусто)"))
    if err.strip():
        print("STDERR:", err[:1200])


# 1. Какие вообще коды возвращались (400/409/403/415) за 3 часа
run('journalctl -u asgard-crm --since "3 hours ago" --no-pager '
    '| grep -oE "\\"statusCode\\":(400|401|403|404|409|415|500)" | sort | uniq -c')

# 2. Строки с не-200 статусами целиком
print()
run('journalctl -u asgard-crm --since "3 hours ago" --no-pager '
    '| grep -E "\\"statusCode\\":(400|409|403|415|500)" | tail -25')

# 3. Достаём DSN, чтобы сходить в БД
print()
run("grep -oP 'DATABASE_URL=\\K.*' /etc/systemd/system/asgard-crm.service 2>/dev/null "
    "|| grep -rhoP 'postgres[^\\s\"]+' /var/www/asgard-crm/.env 2>/dev/null | head -1")

c.close()
