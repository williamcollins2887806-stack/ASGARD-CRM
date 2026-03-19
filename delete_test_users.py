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

# Single transaction: delete all test data in correct FK order
sql = r"""
BEGIN;

-- 1. Cash requests (depend on works)
DELETE FROM cash_requests WHERE user_id BETWEEN 3478 AND 3492;

-- 2. Work expenses (if any, depend on works)
DELETE FROM work_expenses WHERE work_id = 7936;

-- 3. Works (depend on tenders)
DELETE FROM works WHERE created_by BETWEEN 3478 AND 3492;

-- 4. Tenders
DELETE FROM tenders WHERE created_by BETWEEN 3478 AND 3492;

-- 5. Notifications
DELETE FROM notifications WHERE user_id BETWEEN 3478 AND 3492;

-- 6. Audit log
DELETE FROM audit_log WHERE actor_user_id BETWEEN 3478 AND 3492;

-- 7. User permissions
DELETE FROM user_permissions WHERE user_id BETWEEN 3478 AND 3492;

-- 8. Any other potential FK references
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

-- 9. Users themselves
DELETE FROM users WHERE id BETWEEN 3478 AND 3492 AND login LIKE 'test_%';

COMMIT;
"""

print("=== DELETING TEST USERS + DATA ===")
result = run(f"""PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "{sql}" """, timeout=30)
print(result)

# Verify
print("\n=== VERIFY: test users remaining ===")
result = run("""PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SELECT COUNT(*) AS test_users_remaining FROM users WHERE login LIKE 'test_%';" """)
print(result)

client.close()
