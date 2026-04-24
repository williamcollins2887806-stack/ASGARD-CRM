import paramiko
import sys

KEY_PATH = "C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy"
HOST = "92.242.61.184"
USER = "root"
DB_PREFIX = "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -c"

queries = [
    (
        "Estimates for tender #2",
        DB_PREFIX + ' "SELECT id, tender_id, pm_id, approval_status, sent_for_approval_at, created_at FROM estimates WHERE tender_id = 2 ORDER BY id;"'
    ),
    (
        "Chats linked to estimates",
        DB_PREFIX + " \"SELECT id, title, entity_type, entity_id, auto_created, created_at FROM chats WHERE entity_type = 'estimate' ORDER BY id DESC LIMIT 10;\""
    ),
    (
        "Work #1 staff columns",
        DB_PREFIX + ' "SELECT id, work_title, sr_status, sr_sent_at, sr_masters, sr_fitters, sr_pto, sr_washers FROM works WHERE id = 1;"'
    ),
    (
        "All chats (last 10)",
        DB_PREFIX + ' "SELECT id, title, entity_type, entity_id, auto_created FROM chats ORDER BY id DESC LIMIT 10;"'
    ),
]

def main():
    key = paramiko.Ed25519Key.from_private_key_file(KEY_PATH)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting to {HOST}...")
    client.connect(HOST, username=USER, pkey=key, timeout=30)
    print("Connected.\n")

    for title, cmd in queries:
        print(f"=== {title} ===")
        stdin, stdout, stderr = client.exec_command(cmd, timeout=20)
        out = stdout.read().decode().strip()
        err = stderr.read().decode().strip()
        if out:
            print(out)
        if err:
            print(f"[STDERR] {err}")
        if not out and not err:
            print("(no rows)")
        print()

    client.close()
    print("Done.")

if __name__ == "__main__":
    main()
