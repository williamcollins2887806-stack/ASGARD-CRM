import paramiko
key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('92.242.61.184', username='root', pkey=key, timeout=15)

# Step 1: Check current chat_groups permissions
cmd1 = """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "
SELECT role, module_key, can_read, can_write, can_delete 
FROM role_presets 
WHERE module_key = 'chat_groups' 
ORDER BY role;
" """
stdin, stdout, stderr = client.exec_command(cmd1, timeout=15)
print("CURRENT PERMISSIONS:")
print(stdout.read().decode('utf-8', errors='replace'))
print(stderr.read().decode('utf-8', errors='replace'))

# Step 2: Check what roles exist
cmd2 = """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "
SELECT DISTINCT role FROM users WHERE is_active = true ORDER BY role;
" """
stdin2, stdout2, stderr2 = client.exec_command(cmd2, timeout=15)
print("ACTIVE ROLES:")
print(stdout2.read().decode('utf-8', errors='replace'))
print(stderr2.read().decode('utf-8', errors='replace'))

# Step 3: Grant chat_groups read/write to ALL roles
cmd3 = """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "
INSERT INTO role_presets (role, module_key, can_read, can_write, can_delete)
SELECT r.role, 'chat_groups', true, true, false
FROM (SELECT DISTINCT role FROM users WHERE is_active = true) r
WHERE NOT EXISTS (
  SELECT 1 FROM role_presets rp 
  WHERE rp.role = r.role AND rp.module_key = 'chat_groups'
);
" """
stdin3, stdout3, stderr3 = client.exec_command(cmd3, timeout=15)
print("GRANT RESULT:")
print(stdout3.read().decode('utf-8', errors='replace'))
print(stderr3.read().decode('utf-8', errors='replace'))

# Step 4: Also update any existing rows that might have can_read=false or can_write=false
cmd3b = """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "
UPDATE role_presets 
SET can_read = true, can_write = true 
WHERE module_key = 'chat_groups' AND (can_read = false OR can_write = false);
" """
stdin3b, stdout3b, stderr3b = client.exec_command(cmd3b, timeout=15)
print("UPDATE EXISTING RESULT:")
print(stdout3b.read().decode('utf-8', errors='replace'))
print(stderr3b.read().decode('utf-8', errors='replace'))

# Step 5: Verify
cmd4 = """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "
SELECT role, module_key, can_read, can_write 
FROM role_presets 
WHERE module_key = 'chat_groups' 
ORDER BY role;
" """
stdin4, stdout4, stderr4 = client.exec_command(cmd4, timeout=15)
print("FINAL PERMISSIONS:")
print(stdout4.read().decode('utf-8', errors='replace'))
print(stderr4.read().decode('utf-8', errors='replace'))

client.close()
