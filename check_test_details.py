import paramiko

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('92.242.61.184', username='root', pkey=key, timeout=60, banner_timeout=60, auth_timeout=60)

def run(cmd, timeout=30):
    try:
        stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
        return stdout.read().decode().strip() or stderr.read().decode().strip()
    except Exception as e:
        return f"ERROR: {e}"

sql = r"""
-- Cash requests details
SELECT '--- CASH REQUESTS ---' AS info;
SELECT cr.id, cr.user_id, u.login, cr.purpose, cr.amount, cr.status, cr.created_at
FROM cash_requests cr JOIN users u ON u.id = cr.user_id
WHERE cr.user_id BETWEEN 3478 AND 3492;

-- Works created by test users
SELECT '--- WORKS ---' AS info;
SELECT w.id, w.title, w.created_by, u.login, w.created_at
FROM works w JOIN users u ON u.id = w.created_by
WHERE w.created_by BETWEEN 3478 AND 3492;

-- Audit log
SELECT '--- AUDIT LOG ---' AS info;
SELECT al.id, al.actor_user_id, u.login, al.action, al.entity_type, al.created_at
FROM audit_log al JOIN users u ON u.id = al.actor_user_id
WHERE al.actor_user_id BETWEEN 3478 AND 3492;

-- Notifications count per user
SELECT '--- NOTIFICATIONS (grouped) ---' AS info;
SELECT n.user_id, u.login, COUNT(*) as cnt
FROM notifications n JOIN users u ON u.id = n.user_id
WHERE n.user_id BETWEEN 3478 AND 3492
GROUP BY n.user_id, u.login ORDER BY cnt DESC;
"""

print("=== TEST USER RECORDS DETAILS ===")
result = run(f"""PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "{sql}" """, timeout=30)
print(result)

client.close()
