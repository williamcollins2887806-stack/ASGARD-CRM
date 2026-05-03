import paramiko
import os
import base64
import time

KEY_PATH = 'C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy'
HOST = '92.242.61.184'
USER = 'root'
LOCAL_DIR = 'C:/Users/Nikita-ASGARD/ASGARD-CRM/screenshots'
REMOTE_DIR = '/var/www/asgard-crm/public/e2e-screenshots'

ALL_FILES = [
    '01_tenders_page.png',
    '01b_tender_card.png',
    '02_after_handoff.png',
    '02_pm_calcs.png',
    '03_estimates.png',
    '03b_estimate_card.png',
    '03c_approved.png',
    '05_work_card.png',
    '05b_staff_filled.png',
    '05c_staff_requested.png',
    '06_actions_menu.png',
    '07_field_module.png',
    '08_field_crew.png',
    '08_field_logistics.png',
    '08_field_dashboard.png',
    '08_field_timesheet.png',
    '08_field_packing.png',
    '09_personnel.png',
    '10_tenders_final.png',
    '11_works_final.png',
    '99_final.png',
]

key = paramiko.Ed25519Key.from_private_key_file(KEY_PATH)
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, pkey=key, timeout=30)

def run(cmd):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
    return stdout.read().decode(), stderr.read().decode()

# Create dir
run(f'mkdir -p {REMOTE_DIR}')
print('Created remote dir')

# Upload index.html first (read from local)
index_path = os.path.join(LOCAL_DIR, 'index.html')
if os.path.exists(index_path):
    with open(index_path, 'rb') as f:
        data = base64.b64encode(f.read()).decode()
    run(f'echo "{data}" | base64 -d > {REMOTE_DIR}/index.html')
    print('Uploaded index.html')

# Upload each screenshot via base64 over SSH
for fname in ALL_FILES:
    local = os.path.join(LOCAL_DIR, fname)
    if not os.path.exists(local):
        print(f'SKIP {fname}')
        continue

    size = os.path.getsize(local)
    print(f'Uploading {fname} ({size//1024}KB)...', end=' ', flush=True)

    with open(local, 'rb') as f:
        data = base64.b64encode(f.read()).decode()

    # Split into chunks for large files (SSH command line limit)
    chunk_size = 60000
    if len(data) <= chunk_size:
        run(f'echo "{data}" | base64 -d > {REMOTE_DIR}/{fname}')
    else:
        # Write in chunks
        run(f'rm -f /tmp/_upload.b64')
        for i in range(0, len(data), chunk_size):
            chunk = data[i:i+chunk_size]
            run(f'echo -n "{chunk}" >> /tmp/_upload.b64')
        run(f'base64 -d /tmp/_upload.b64 > {REMOTE_DIR}/{fname}')
        run(f'rm -f /tmp/_upload.b64')

    # Verify
    out, _ = run(f'stat -c%s {REMOTE_DIR}/{fname} 2>/dev/null || echo 0')
    remote_size = int(out.strip())
    ok = abs(remote_size - size) < 100  # allow small diff due to base64
    print(f'{"OK" if ok else "FAIL"} ({remote_size})')

# Set permissions
run(f'chmod -R 755 {REMOTE_DIR}')
print(f'\nDone! https://asgard-crm.ru/e2e-screenshots/')

ssh.close()
