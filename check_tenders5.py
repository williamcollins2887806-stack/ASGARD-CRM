import paramiko
key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('92.242.61.184', username='root', pkey=key, timeout=15)

# Check tender_status values with proper encoding
cmd1 = """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SET client_encoding TO 'UTF8'; SELECT tender_status, COUNT(*) as cnt FROM tenders GROUP BY tender_status ORDER BY cnt DESC;" """
stdin1, stdout1, stderr1 = client.exec_command(cmd1, timeout=20)
raw = stdout1.read()
print("=== TENDER_STATUS VALUES ===")
print(raw.decode('utf-8'))
err1 = stderr1.read().decode('utf-8')
if err1: print("STDERR:", err1)

# Show sample with both fields
cmd2 = """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SET client_encoding TO 'UTF8'; SELECT id, tender_status, customer_name FROM tenders WHERE tender_status IS NOT NULL ORDER BY id DESC LIMIT 10;" """
stdin2, stdout2, stderr2 = client.exec_command(cmd2, timeout=20)
raw2 = stdout2.read()
print("=== SAMPLE TENDERS ===")
print(raw2.decode('utf-8'))
err2 = stderr2.read().decode('utf-8')
if err2: print("STDERR:", err2)

client.close()
