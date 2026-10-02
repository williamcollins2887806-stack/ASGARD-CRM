#!/usr/bin/env python3
"""Asterisk AGI: resolve Ting dial_code (6 digits) via CRM API."""
import os
import sys
import json
import urllib.request

def agi_read():
    env = {}
    while True:
        line = sys.stdin.readline().strip()
        if line == '':
            break
        if ':' in line:
            k, v = line.split(':', 1)
            env[k.strip()] = v.strip()
    return env

def agi_cmd(cmd):
    sys.stdout.write(cmd + '\n')
    sys.stdout.flush()
    return sys.stdin.readline().strip()

def main():
    agi_read()
    code = ''
    if len(sys.argv) > 1:
        code = ''.join(c for c in sys.argv[1] if c.isdigit())
    if len(code) != 6:
        agi_cmd('SET VARIABLE TING_OK 0')
        agi_cmd('SET VARIABLE TING_ERR bad_code')
        return

    secret = os.environ.get('THING_DIALIN_SECRET', '')
    # also try file
    if not secret and os.path.exists('/etc/asgard-crm/thing.env'):
        for line in open('/etc/asgard-crm/thing.env'):
            if line.startswith('THING_DIALIN_SECRET='):
                secret = line.split('=', 1)[1].strip()

    req = urllib.request.Request(
        'http://127.0.0.1:3000/api/thing/dial-in/resolve',
        data=json.dumps({'dial_code': code}).encode(),
        headers={
            'Content-Type': 'application/json',
            'X-Thing-Dialin-Secret': secret,
        },
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
    except Exception as e:
        agi_cmd('SET VARIABLE TING_OK 0')
        agi_cmd('SET VARIABLE TING_ERR api')
        agi_cmd('VERBOSE "ting-resolve fail %s" 1' % str(e).replace('"', ''))
        return

    room = data.get('livekit_room_name') or ''
    if not room:
        agi_cmd('SET VARIABLE TING_OK 0')
        agi_cmd('SET VARIABLE TING_ERR not_found')
        return

    # SIP URI user must be safe
    safe = ''.join(c for c in room if c.isalnum() or c in '_-')
    agi_cmd('SET VARIABLE TING_OK 1')
    agi_cmd('SET VARIABLE TING_ROOM "%s"' % safe)
    agi_cmd('SET VARIABLE TING_SLUG "%s"' % (data.get('slug') or ''))
    agi_cmd('SET VARIABLE TING_TITLE "%s"' % str(data.get('title') or '').replace('"', ''))

if __name__ == '__main__':
    main()
