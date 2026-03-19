"""
Деплой Мимир AI-анализ подсказок (Level 4)
1. git pull
2. Миграция V047
3. Рестарт сервера
"""
import paramiko, time

KEY = 'C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy'
HOST = '92.242.61.184'
USER = 'root'
APP = '/var/www/asgard-crm'

def ssh_cmd(ssh, cmd, timeout=30):
    print(f'>>> {cmd}')
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out: print(out)
    if err: print(f'[stderr] {err}')
    return out

def main():
    key = paramiko.Ed25519Key.from_private_key_file(KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, pkey=key, timeout=15)
    print('Connected to', HOST)

    # 1. Git pull
    ssh_cmd(ssh, f'cd {APP} && git fetch origin mobile-v3 && git reset --hard origin/mobile-v3')
    ssh_cmd(ssh, f'cd {APP} && git log -1 --oneline')

    # 2. Миграция V047
    migration = """
CREATE TABLE IF NOT EXISTS mimir_hint_analysis_cache (
    id              SERIAL PRIMARY KEY,
    cache_key       VARCHAR(200) NOT NULL,
    role            VARCHAR(50) NOT NULL,
    page            VARCHAR(100) NOT NULL,
    user_id         INTEGER,
    hints_hash      VARCHAR(16) NOT NULL,
    analysis_text   TEXT NOT NULL,
    hints_snapshot  JSONB,
    tokens_input    INTEGER DEFAULT 0,
    tokens_output   INTEGER DEFAULT 0,
    model_used      VARCHAR(100),
    duration_ms     INTEGER DEFAULT 0,
    generated_at    TIMESTAMP DEFAULT NOW(),
    expires_at      TIMESTAMP DEFAULT (NOW() + INTERVAL '24 hours')
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hint_analysis_key ON mimir_hint_analysis_cache (cache_key);
CREATE INDEX IF NOT EXISTS idx_hint_analysis_expires ON mimir_hint_analysis_cache (expires_at);
"""
    print('\n=== Миграция V047 ===')
    ssh_cmd(ssh, f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c \"{migration.strip().replace(chr(10), ' ')}\"", timeout=15)

    # 3. Рестарт
    print('\n=== Рестарт ===')
    ssh_cmd(ssh, 'systemctl restart asgard-crm')
    time.sleep(3)
    ssh_cmd(ssh, 'systemctl status asgard-crm --no-pager -l | head -15')

    # 4. Проверка
    print('\n=== Проверка ===')
    ssh_cmd(ssh, 'curl -s -o /dev/null -w "%{http_code}" https://asgard-crm.ru/')
    ssh_cmd(ssh, f'cd {APP} && git log -1 --oneline')
    ssh_cmd(ssh, "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c \"SELECT count(*) FROM information_schema.tables WHERE table_name='mimir_hint_analysis_cache'\"")

    ssh.close()
    print('\nDone!')

if __name__ == '__main__':
    main()
