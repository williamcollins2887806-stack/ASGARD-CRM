import paramiko

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('92.242.61.184', username='root', pkey=key, timeout=60, banner_timeout=60, auth_timeout=60)

def run(cmd, timeout=60):
    try:
        stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode().strip()
        err = stderr.read().decode().strip()
        if out:
            print(out)
        if err:
            print("STDERR:", err)
    except Exception as e:
        print(f"ERROR: {e}")

# Check if the SQL file exists
run("ls -la /tmp/delete_test_final.sql", timeout=10)

# Execute the already-written SQL file
print("\n=== EXECUTING ===")
run("PGPASSWORD=123456789 psql -U asgard -d asgard_crm -f /tmp/delete_test_final.sql", timeout=60)

client.close()
