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

sql = r"""
SELECT * FROM (
SELECT 'tasks_creator' AS src, COUNT(*) AS cnt FROM tasks WHERE creator_id BETWEEN 3478 AND 3492
UNION ALL SELECT 'tasks_assignee', COUNT(*) FROM tasks WHERE assignee_id BETWEEN 3478 AND 3492
UNION ALL SELECT 'tenders_pm', COUNT(*) FROM tenders WHERE pm_id BETWEEN 3478 AND 3492
UNION ALL SELECT 'tenders_created_by', COUNT(*) FROM tenders WHERE created_by_user_id BETWEEN 3478 AND 3492
UNION ALL SELECT 'chat_messages_sender', COUNT(*) FROM chat_messages WHERE sender_id BETWEEN 3478 AND 3492
UNION ALL SELECT 'chat_group_members', COUNT(*) FROM chat_group_members WHERE user_id BETWEEN 3478 AND 3492
UNION ALL SELECT 'cash_requests', COUNT(*) FROM cash_requests WHERE user_id BETWEEN 3478 AND 3492
UNION ALL SELECT 'comments_user', COUNT(*) FROM task_comments WHERE user_id BETWEEN 3478 AND 3492
UNION ALL SELECT 'notifications', COUNT(*) FROM notifications WHERE user_id BETWEEN 3478 AND 3492
UNION ALL SELECT 'meetings_author', COUNT(*) FROM meetings WHERE minutes_author_id BETWEEN 3478 AND 3492
UNION ALL SELECT 'meeting_participants', COUNT(*) FROM meeting_participants WHERE user_id BETWEEN 3478 AND 3492
UNION ALL SELECT 'user_stories', COUNT(*) FROM user_stories WHERE user_id BETWEEN 3478 AND 3492
UNION ALL SELECT 'works_pm', COUNT(*) FROM works WHERE pm_id BETWEEN 3478 AND 3492
UNION ALL SELECT 'works_created_by', COUNT(*) FROM works WHERE created_by BETWEEN 3478 AND 3492
UNION ALL SELECT 'mimir_conversations', COUNT(*) FROM mimir_conversations WHERE user_id BETWEEN 3478 AND 3492
UNION ALL SELECT 'mimir_usage_log', COUNT(*) FROM mimir_usage_log WHERE user_id BETWEEN 3478 AND 3492
UNION ALL SELECT 'audit_log', COUNT(*) FROM audit_log WHERE actor_user_id BETWEEN 3478 AND 3492
UNION ALL SELECT 'push_subscriptions', COUNT(*) FROM push_subscriptions WHERE user_id BETWEEN 3478 AND 3492
UNION ALL SELECT 'user_permissions', COUNT(*) FROM user_permissions WHERE user_id BETWEEN 3478 AND 3492
UNION ALL SELECT 'user_dashboard', COUNT(*) FROM user_dashboard WHERE user_id BETWEEN 3478 AND 3492
UNION ALL SELECT 'employees', COUNT(*) FROM employees WHERE user_id BETWEEN 3478 AND 3492
UNION ALL SELECT 'expenses', COUNT(*) FROM expenses WHERE user_id BETWEEN 3478 AND 3492
UNION ALL SELECT 'todo_items', COUNT(*) FROM todo_items WHERE user_id BETWEEN 3478 AND 3492
UNION ALL SELECT 'reminders', COUNT(*) FROM reminders WHERE user_id BETWEEN 3478 AND 3492
UNION ALL SELECT 'documents', COUNT(*) FROM documents WHERE uploaded_by_user_id BETWEEN 3478 AND 3492
UNION ALL SELECT 'pass_requests', COUNT(*) FROM pass_requests WHERE author_id BETWEEN 3478 AND 3492
UNION ALL SELECT 'estimates_user', COUNT(*) FROM estimates WHERE user_id BETWEEN 3478 AND 3492
UNION ALL SELECT 'invoices', COUNT(*) FROM invoices WHERE created_by BETWEEN 3478 AND 3492
UNION ALL SELECT 'contracts', COUNT(*) FROM contracts WHERE created_by BETWEEN 3478 AND 3492
UNION ALL SELECT 'email_log', COUNT(*) FROM email_log WHERE user_id BETWEEN 3478 AND 3492
UNION ALL SELECT 'call_history', COUNT(*) FROM call_history WHERE user_id BETWEEN 3478 AND 3492
UNION ALL SELECT 'staff_user', COUNT(*) FROM staff WHERE user_id BETWEEN 3478 AND 3492
) sub WHERE cnt > 0;
"""

print("=== RECORDS CREATED BY TEST USERS (non-zero only) ===")
result = run(f"""PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "{sql}" """, timeout=60)
print(result)

client.close()
