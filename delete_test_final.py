import paramiko

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('92.242.61.184', username='root', pkey=key, timeout=60, banner_timeout=60, auth_timeout=60)

def run(cmd, timeout=60):
    try:
        stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
        return stdout.read().decode().strip() or stderr.read().decode().strip()
    except Exception as e:
        return f"ERROR: {e}"

sql_file = r"""cat > /tmp/delete_test_final.sql << 'SQLEOF'
BEGIN;

-- Level 0: deepest FK deps
DELETE FROM estimate_approval_requests WHERE tender_id IN (22801,22802,22803,22804);
DELETE FROM estimates WHERE tender_id IN (22801,22802,22803,22804);
DELETE FROM documents WHERE tender_id IN (22801,22802,22803,22804);

-- Level 1: cash_requests -> works -> tenders
DELETE FROM cash_requests WHERE user_id BETWEEN 3478 AND 3492;
DELETE FROM work_expenses WHERE work_id = 7936;
DELETE FROM works WHERE id = 7936;
DELETE FROM tenders WHERE id IN (22801,22802,22803,22804);

-- Level 2: user-linked tables (all potentially have FK to users)
DELETE FROM notifications WHERE user_id BETWEEN 3478 AND 3492;
DELETE FROM audit_log WHERE actor_user_id BETWEEN 3478 AND 3492;
DELETE FROM user_permissions WHERE user_id BETWEEN 3478 AND 3492;
DELETE FROM push_subscriptions WHERE user_id BETWEEN 3478 AND 3492;
DELETE FROM user_dashboard WHERE user_id BETWEEN 3478 AND 3492;
DELETE FROM todo_items WHERE user_id BETWEEN 3478 AND 3492;
DELETE FROM reminders WHERE user_id BETWEEN 3478 AND 3492;
DELETE FROM user_menu_settings WHERE user_id BETWEEN 3478 AND 3492;
DELETE FROM mimir_conversations WHERE user_id BETWEEN 3478 AND 3492;
DELETE FROM mimir_usage_log WHERE user_id BETWEEN 3478 AND 3492;
DELETE FROM webauthn_challenges WHERE user_id BETWEEN 3478 AND 3492;
DELETE FROM webauthn_credentials WHERE user_id BETWEEN 3478 AND 3492;
DELETE FROM saved_reports WHERE user_id BETWEEN 3478 AND 3492;
DELETE FROM role_analytics_cache WHERE user_id BETWEEN 3478 AND 3492;
DELETE FROM employee_plan WHERE user_id BETWEEN 3478 AND 3492;
DELETE FROM user_email_accounts WHERE user_id BETWEEN 3478 AND 3492;
DELETE FROM user_call_status WHERE user_id BETWEEN 3478 AND 3492;
DELETE FROM training_applications WHERE user_id BETWEEN 3478 AND 3492;
DELETE FROM user_requests WHERE user_id BETWEEN 3478 AND 3492;
DELETE FROM staff WHERE user_id BETWEEN 3478 AND 3492;
DELETE FROM employees WHERE user_id BETWEEN 3478 AND 3492;
DELETE FROM email_log WHERE user_id BETWEEN 3478 AND 3492;
DELETE FROM call_history WHERE user_id BETWEEN 3478 AND 3492;
DELETE FROM cash_balance_log WHERE user_id BETWEEN 3478 AND 3492;
DELETE FROM cash_messages WHERE user_id BETWEEN 3478 AND 3492;
DELETE FROM chat_group_members WHERE user_id BETWEEN 3478 AND 3492;
DELETE FROM chat_messages WHERE sender_id BETWEEN 3478 AND 3492;
DELETE FROM expenses WHERE user_id BETWEEN 3478 AND 3492;
DELETE FROM user_stories WHERE user_id BETWEEN 3478 AND 3492;
DELETE FROM telephony_escalations WHERE user_id BETWEEN 3478 AND 3492;

-- Level 3: users
DELETE FROM users WHERE id BETWEEN 3478 AND 3492 AND login LIKE 'test_%';

COMMIT;

-- Verify
SELECT 'REMAINING TEST USERS: ' || COUNT(*) FROM users WHERE login LIKE 'test_%';
SELECT 'REMAINING TEST TENDERS: ' || COUNT(*) FROM tenders WHERE id IN (22801,22802,22803,22804);
SELECT 'REMAINING TEST WORKS: ' || COUNT(*) FROM works WHERE id = 7936;
SQLEOF"""

print("=== Writing SQL file ===")
run(sql_file, timeout=10)

print("=== Executing delete ===")
result = run("PGPASSWORD=123456789 psql -U asgard -d asgard_crm -f /tmp/delete_test_final.sql 2>&1", timeout=60)
print(result)

client.close()
