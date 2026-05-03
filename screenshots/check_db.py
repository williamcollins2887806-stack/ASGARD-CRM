import paramiko
import time

KEY_PATH = 'C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy'
HOST = '92.242.61.184'
USER = 'root'

key = paramiko.Ed25519Key.from_private_key_file(KEY_PATH)
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, pkey=key, timeout=30)
ssh.get_transport().set_keepalive(5)

def run(cmd):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=20)
    return stdout.read().decode()

DB = 'PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -c'

queries = [
    ("Estimates for tender #2",
     f'''{DB} "SELECT id, tender_id, pm_id, approval_status, sent_for_approval_at, created_at FROM estimates WHERE tender_id = 2 ORDER BY id;"'''),

    ("Chats for estimates",
     f'''{DB} "SELECT id, title, entity_type, entity_id, auto_created, created_at FROM chats WHERE entity_type = 'estimate' OR auto_created = true ORDER BY id DESC LIMIT 10;"'''),

    ("Work #1 staff columns",
     f'''{DB} "SELECT id, work_title, work_status, sr_status, sr_sent_at, sr_masters, sr_fitters, sr_pto, sr_washers, sr_rotation_days, sr_is_vachta FROM works WHERE id = 1;"'''),

    ("Staff-related tables",
     f'''{DB} "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND (table_name LIKE '%%staff%%' OR table_name LIKE '%%hr_request%%' OR table_name LIKE '%%personnel%%');"'''),

    ("Works sr_ columns",
     f'''{DB} "SELECT column_name FROM information_schema.columns WHERE table_name = 'works' AND column_name LIKE 'sr_%%' ORDER BY ordinal_position;"'''),

    ("Notifications about estimate",
     f'''{DB} "SELECT id, user_id, title, message, link_hash, created_at FROM notifications WHERE title LIKE '%%просч%%' OR title LIKE '%%estimat%%' OR title LIKE '%%согласов%%' ORDER BY id DESC LIMIT 10;"'''),
]

for title, cmd in queries:
    print(f"\n{'='*50}")
    print(title)
    print('='*50)
    try:
        out = run(cmd + ' 2>/dev/null')
        print(out.strip() or "(empty)")
    except Exception as e:
        print(f"ERROR: {e}")
    time.sleep(1)

ssh.close()
