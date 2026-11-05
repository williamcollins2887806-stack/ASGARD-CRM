#!/usr/bin/env python3
"""Asterisk AGI: resolve Ting dial_code (6 digits) + optional PIN via CRM API.

D18: раньше AGI не передавал PIN, поэтому комнаты с PIN были недоступны по телефону
(сервер всегда отвечал 403 «Требуется PIN»). Диалплан передаёт PIN вторым аргументом:
    AGI(ting-resolve.py,${TINGCODE},${TINGPIN})
"""
import os
import sys
import json
import urllib.request
import urllib.error


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
    # D18: PIN приходит вторым аргументом (собран DTMF в диалплане).
    pin = ''
    if len(sys.argv) > 2:
        pin = ''.join(c for c in sys.argv[2] if c.isdigit())
    if len(code) != 6:
        agi_cmd('SET VARIABLE TING_OK 0')
        agi_cmd('SET VARIABLE TING_ERR bad_code')
        return

    secret = os.environ.get('THING_DIALIN_SECRET', '')
    if not secret and os.path.exists('/etc/asgard-crm/thing.env'):
        for line in open('/etc/asgard-crm/thing.env'):
            if line.startswith('THING_DIALIN_SECRET='):
                secret = line.split('=', 1)[1].strip()

    payload = {'dial_code': code}
    if pin:
        payload['pin'] = pin
    # D19: номер звонящего — иначе телефонный участник не попадает в ростер и протокол.
    caller = os.environ.get('TING_CALLER', '')
    if caller:
        payload['caller'] = ''.join(c for c in caller if c.isdigit() or c == '+')

    req = urllib.request.Request(
        'http://127.0.0.1:3000/api/thing/dial-in/resolve',
        data=json.dumps(payload).encode(),
        headers={
            'Content-Type': 'application/json',
            'X-Thing-Dialin-Secret': secret,
        },
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = ''
        try:
            body = e.read().decode()
        except Exception:
            pass
        err = 'pin_required' if ('PIN' in body or e.code == 403) else 'api'
        agi_cmd('SET VARIABLE TING_OK 0')
        agi_cmd('SET VARIABLE TING_ERR %s' % err)
        agi_cmd('VERBOSE "ting-resolve http %s %s" 1' % (e.code, err))
        return
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

    safe = ''.join(c for c in room if c.isalnum() or c in '_-')
    agi_cmd('SET VARIABLE TING_OK 1')
    agi_cmd('SET VARIABLE TING_ROOM "%s"' % safe)
    agi_cmd('SET VARIABLE TING_SLUG "%s"' % (data.get('slug') or ''))
    agi_cmd('SET VARIABLE TING_TITLE "%s"' % str(data.get('title') or '').replace('"', ''))
    agi_cmd('SET VARIABLE TING_ROOM_ID "%s"' % (data.get('room_id') or ''))


if __name__ == '__main__':
    main()
