import paramiko
key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('92.242.61.184', username='root', pkey=key, timeout=15)

# Check tender_status values (the REAL status column)
cmd1 = """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SELECT tender_status, COUNT(*) as cnt FROM tenders GROUP BY tender_status ORDER BY cnt DESC;" """
stdin1, stdout1, stderr1 = client.exec_command(cmd1, timeout=20)
print("=== TENDER_STATUS VALUES ===")
print(stdout1.read().decode())
err1 = stderr1.read().decode()
if err1: print("STDERR:", err1)

# Also show some examples with both status fields
cmd2 = """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SELECT id, tender_status, status, customer_name FROM tenders WHERE tender_status IS NOT NULL AND tender_status != '' ORDER BY id DESC LIMIT 15;" """
stdin2, stdout2, stderr2 = client.exec_command(cmd2, timeout=20)
print("=== SAMPLE TENDERS WITH tender_status ===")
print(stdout2.read().decode())
err2 = stderr2.read().decode()
if err2: print("STDERR:", err2)

client.close()
