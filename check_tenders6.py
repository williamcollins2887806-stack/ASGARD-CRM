import paramiko
key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('92.242.61.184', username='root', pkey=key, timeout=15)

# Use encode() to hex-encode Cyrillic and then decode locally
cmd1 = """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -A -c "SELECT tender_status || '|' || COUNT(*) FROM tenders GROUP BY tender_status ORDER BY COUNT(*) DESC;" """
stdin1, stdout1, stderr1 = client.exec_command(cmd1, timeout=20)
raw = stdout1.read()
# Try different encodings
for enc in ['utf-8', 'latin-1', 'cp1251', 'koi8-r', 'iso-8859-5']:
    try:
        decoded = raw.decode(enc)
        print(f"=== Encoding: {enc} ===")
        print(decoded)
        print()
    except:
        print(f"=== {enc}: FAILED ===")

client.close()
