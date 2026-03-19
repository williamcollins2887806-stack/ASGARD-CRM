import paramiko
key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('92.242.61.184', username='root', pkey=key, timeout=15)

# Check tender statuses via psql
cmd1 = """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SELECT status, COUNT(*) as cnt FROM tenders GROUP BY status ORDER BY cnt DESC;" """
stdin1, stdout1, stderr1 = client.exec_command(cmd1, timeout=20)
print("=== TENDER STATUSES ===")
print(stdout1.read().decode())
err1 = stderr1.read().decode()
if err1: print("STDERR:", err1)

# Sample tenders
cmd2 = """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SELECT id, status, customer_name FROM tenders ORDER BY id DESC LIMIT 10;" """
stdin2, stdout2, stderr2 = client.exec_command(cmd2, timeout=20)
print("=== SAMPLE TENDERS (last 10) ===")
print(stdout2.read().decode())
err2 = stderr2.read().decode()
if err2: print("STDERR:", err2)

# Check distinct statuses with more detail
cmd3 = """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SELECT DISTINCT status FROM tenders ORDER BY status;" """
stdin3, stdout3, stderr3 = client.exec_command(cmd3, timeout=20)
print("=== ALL DISTINCT STATUSES ===")
print(stdout3.read().decode())
err3 = stderr3.read().decode()
if err3: print("STDERR:", err3)

# Check tenders table structure
cmd4 = r"""PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "\d tenders" """
stdin4, stdout4, stderr4 = client.exec_command(cmd4, timeout=20)
print("=== TENDERS TABLE STRUCTURE ===")
print(stdout4.read().decode())
err4 = stderr4.read().decode()
if err4: print("STDERR:", err4)

client.close()
