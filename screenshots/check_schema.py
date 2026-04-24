import paramiko
import time

KEY_PATH = "C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy"
HOST = "92.242.61.184"
USER = "root"

# Run ALL queries as a single psql script to avoid SSH channel issues
SQL_SCRIPT = r"""
\echo === Chats columns ===
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'chats' ORDER BY ordinal_position;

\echo === Works sr_ columns ===
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'works' AND (column_name LIKE 'sr_%' OR column_name LIKE '%staff%' OR column_name LIKE '%crew%' OR column_name = 'work_status') ORDER BY ordinal_position;

\echo === Chat messages for estimate chats ===
SELECT c.id, c.entity_type, c.entity_id, c.auto_created, c.created_at FROM chats c WHERE c.entity_type = 'estimate' ORDER BY c.id DESC LIMIT 10;

\echo === All recent chats (no title column) ===
SELECT id, entity_type, entity_id, auto_created, created_at FROM chats ORDER BY id DESC LIMIT 10;

\echo === Work #1 all columns ===
SELECT row_to_json(w) FROM works w WHERE id = 1;
"""

def main():
    key = paramiko.Ed25519Key.from_private_key_file(KEY_PATH)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    print(f"Connecting to {HOST}...")
    client.connect(HOST, username=USER, pkey=key, timeout=15)
    transport = client.get_transport()
    transport.set_keepalive(5)
    print("Connected.\n")

    # Write SQL to a temp file on the server, then run it
    write_cmd = f"cat > /tmp/check_schema.sql << 'SQLEOF'\n{SQL_SCRIPT}\nSQLEOF"
    stdin, stdout, stderr = client.exec_command(write_cmd, timeout=10)
    stdout.channel.recv_exit_status()

    # Run the SQL file
    run_cmd = "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -f /tmp/check_schema.sql 2>&1"
    print(f"Running queries...\n")
    stdin, stdout, stderr = client.exec_command(run_cmd, timeout=30)
    
    # Read output using the channel directly
    chan = stdout.channel
    chan.settimeout(25)
    
    chunks = []
    while True:
        if chan.recv_ready():
            data = chan.recv(65536)
            if data:
                chunks.append(data)
        if chan.exit_status_ready():
            # Drain remaining
            time.sleep(0.2)
            while chan.recv_ready():
                data = chan.recv(65536)
                if data:
                    chunks.append(data)
            break
        time.sleep(0.05)

    out = b"".join(chunks).decode("utf-8", errors="replace")
    print(out)

    client.close()
    print("\nSSH closed.")

if __name__ == "__main__":
    main()
