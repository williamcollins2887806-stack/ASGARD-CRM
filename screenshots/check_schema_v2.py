import paramiko

KEY_PATH = "C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy"
HOST = "92.242.61.184"
USER = "root"

queries = [
    (
        "Works row count",
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -c \"SELECT count(*) FROM works;\""
    ),
    (
        "Works MIN id",
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -c \"SELECT min(id) FROM works;\""
    ),
    (
        "Works ALL columns (schema)",
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -c "
        "\"SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'works' ORDER BY ordinal_position;\""
    ),
    (
        "Chats row count",
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -c \"SELECT count(*) FROM chats;\""
    ),
]

def run_query(client, title, cmd):
    print(f"=== {title} ===")
    try:
        stdin, stdout, stderr = client.exec_command(cmd, timeout=20)
        stdout.channel.settimeout(15)
        stderr.channel.settimeout(15)
        out = stdout.read().decode("utf-8", errors="replace")
        err = stderr.read().decode("utf-8", errors="replace")
        if out.strip():
            print(out)
        else:
            print("(no output)")
        if err.strip():
            print(f"STDERR: {err}")
    except Exception as e:
        print(f"ERROR: {e}")
    print()

def main():
    key = paramiko.Ed25519Key.from_private_key_file(KEY_PATH)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    print(f"Connecting to {HOST}...")
    client.connect(HOST, username=USER, pkey=key, timeout=15)
    transport = client.get_transport()
    transport.set_keepalive(5)
    print("Connected.\n")

    for title, cmd in queries:
        run_query(client, title, cmd)

    client.close()
    print("SSH closed.")

if __name__ == "__main__":
    main()
