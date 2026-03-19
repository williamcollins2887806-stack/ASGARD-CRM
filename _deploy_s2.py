import paramiko, time
key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('92.242.61.184', username='root', pkey=key, timeout=30)
transport = client.get_transport()
transport.set_keepalive(5)
def run(cmd, timeout=60):
    print(f">>> {cmd}")
    chan = transport.open_session()
    chan.settimeout(timeout)
    chan.exec_command(cmd)
    out = b''
    while True:
        if chan.recv_ready(): out += chan.recv(65536)
        if chan.recv_stderr_ready(): chan.recv_stderr(65536)
        if chan.exit_status_ready():
            while chan.recv_ready(): out += chan.recv(65536)
            break
        time.sleep(0.1)
    code = chan.recv_exit_status()
    out_str = out.decode('utf-8', errors='replace').strip()
    print(out_str or '(no output)')
    print(f"Exit: {code}")
    return code, out_str

run("cd /var/www/asgard-crm && git pull origin mobile-v3")
run("systemctl restart asgard-crm && sleep 2 && systemctl is-active asgard-crm")
run("cd /var/www/asgard-crm && git log --oneline -1")
run("curl -s -o /dev/null -w '%{http_code}' https://asgard-crm.ru")
client.close()
print("\nDONE")
