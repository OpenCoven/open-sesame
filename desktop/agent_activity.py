#!/usr/bin/env python3
"""Opt-in lifecycle hook. Stores only state and identity, never hook payload text."""
import argparse
import hashlib
import json
import os
import pathlib
import socket
import subprocess
import sys
import time
from agent_monitor import process_identities

ROOT = pathlib.Path.home() / 'Library/Application Support/Open Sesame/agent-activity'


def report(state):
    identities = process_identities()
    pid = os.getppid()
    rows = subprocess.run(['ps','-u',str(os.getuid()),'-o','pid=,ppid='],capture_output=True,text=True,timeout=2,check=True)
    parents = dict(tuple(map(int,row.split())) for row in rows.stdout.splitlines() if len(row.split()) == 2)
    seen = set()
    while pid and pid not in seen:
        seen.add(pid)
        identity = identities.get(pid)
        if identity:
            key = hashlib.sha256((socket.gethostname()+str(pid)+str(identity[:3])).encode()).hexdigest()[:24]
            ROOT.mkdir(parents=True,exist_ok=True,mode=0o700)
            path = ROOT / (key+'.json')
            tmp = ROOT / (key+'.'+str(os.getpid())+'.tmp')
            fd = os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            with os.fdopen(fd,'w') as f: json.dump({'state':state,'source':'lifecycle','since':int(time.time()*1000),'reason':'Provider lifecycle event'},f)
            os.replace(tmp,path)
            return
        pid = parents.get(pid)
    raise ValueError('No recognized agent ancestor; event ignored.')


def activity(key):
    if not key: return None
    try:
        path = ROOT / (key+'.json')
        if path.stat().st_size > 2048: return None
        value = json.loads(path.read_text())
        if value.get('state') in ('working','waiting','ready','completed') and value.get('source') == 'lifecycle': return value
    except (OSError,ValueError): pass
    return None


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--state',choices=['working','waiting','ready','completed'])
    parser.add_argument('--claude',action='store_true')
    args = parser.parse_args()
    state = args.state
    if args.claude:
        payload = json.loads(sys.stdin.read(65536))
        event = payload.get('hook_event_name')
        state = {'UserPromptSubmit':'working','PreToolUse':'working','PostToolUse':'working','PermissionRequest':'waiting','Stop':'completed'}.get(event)
        if event == 'Notification': state = {'permission_prompt':'waiting','elicitation_dialog':'waiting','idle_prompt':'ready'}.get(payload.get('notification_type'))
    if state: report(state)
