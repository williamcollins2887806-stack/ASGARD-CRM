import paramiko
key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('92.242.61.184', username='root', pkey=key, timeout=15)

# Check tenders table columns via information_schema
cmd1 = """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name='tenders' ORDER BY ordinal_position;" """
stdin1, stdout1, stderr1 = client.exec_command(cmd1, timeout=30)
print("=== TENDERS TABLE COLUMNS ===")
print(stdout1.read().decode())
err1 = stderr1.read().decode()
if err1: print("STDERR:", err1)

# Check if there's a separate status field or if status is managed differently
cmd2 = """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SELECT column_name FROM information_schema.columns WHERE table_name='tenders' AND column_name LIKE '%status%';" """
stdin2, stdout2, stderr2 = client.exec_command(cmd2, timeout=20)
print("=== STATUS-RELATED COLUMNS ===")
print(stdout2.read().decode())
err2 = stderr2.read().decode()
if err2: print("STDERR:", err2)

# Check if there's a tender_statuses table or similar
cmd3 = """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE '%tender%' ORDER BY table_name;" """
stdin3, stdout3, stderr3 = client.exec_command(cmd3, timeout=20)
print("=== TENDER-RELATED TABLES ===")
print(stdout3.read().decode())
err3 = stderr3.read().decode()
if err3: print("STDERR:", err3)

# Check a few real tenders with all columns to understand the data
cmd4 = """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SELECT id, status, customer_name, created_at FROM tenders WHERE customer_name IS NOT NULL AND customer_name != '' ORDER BY id DESC LIMIT 5;" """
stdin4, stdout4, stderr4 = client.exec_command(cmd4, timeout=20)
print("=== REAL TENDERS WITH DATA ===")
print(stdout4.read().decode())
err4 = stderr4.read().decode()
if err4: print("STDERR:", err4)

client.close()
