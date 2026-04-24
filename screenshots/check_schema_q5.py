import paramiko

KEY_PATH = "C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy"
HOST = "92.242.61.184"
USER = "root"

def main():
    key = paramiko.Ed25519Key.from_private_key_file(KEY_PATH)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    print(f"Connecting to {HOST}...")
    client.connect(HOST, username=USER, pkey=key, timeout=15)
    transport = client.get_transport()
    transport.set_keepalive(5)
    print("Connected.\n")

    cmd = "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -c \"SELECT row_to_json(w) FROM works w WHERE id = 1;\""
    print(f"=== Work #1 all columns ===")
    print(f"CMD: {cmd}\n")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
    stdout.channel.settimeout(25)
    stderr.channel.settimeout(25)

    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    print(f"STDOUT ({len(out)} chars): {out[:3000]}")
    if err.strip():
        print(f"STDERR: {err}")
    print()

    client.close()
    print("SSH closed.")

if __name__ == "__main__":
    main()
