#!/usr/bin/env python3
"""Deterministic CLI protocol fixture. Never loads user Coven data or providers."""
import argparse
import json
import os
from pathlib import Path
import sys
import time
import uuid
root = Path(os.environ['OPEN_SESAME_TEST_COVEN_ROOT'])
args = sys.argv[1:]
def emit(value):
    print(json.dumps(value), flush=True)
if args == ['--version']:
    print('coven fixture 0.4.10')
elif args == ['engine', 'status', '--json']:
    emit({'installed': not (root / 'engine-missing').exists()})
elif args == ['familiars', '--json']:
    print((root / 'roster.json').read_text())
elif args == ['status', '--json']:
    emit({'health': {'ok': True, 'private_token': 'fixture-private-token'}, 'overview': {'open_sessions': 2, 'total_familiars': 2, 'skills_count': 1}, 'raw_config': 'fixture-private-token'})
elif args == ['sessions', '--json']:
    emit({'sessions': [json.loads(p.read_text()) for p in (root / 'sessions').glob('*.json')]})
elif args == ['skills', '--json']:
    emit([{'id': 'review', 'name': 'Review', 'version': '1', 'configuration': 'fixture-private-token'}])
elif args[:2] == ['sessions', 'show']:
    print((root / 'sessions' / (args[2] + '.json')).read_text())
elif args and args[0] == 'run':
    parser = argparse.ArgumentParser()
    parser.add_argument('command'); parser.add_argument('harness')
    parser.add_argument('--stream-json', action='store_true'); parser.add_argument('--permission')
    parser.add_argument('--cwd'); parser.add_argument('--familiar'); parser.add_argument('--continue', dest='previous')
    parser.add_argument('--title'); parser.add_argument('--labels')
    parser.add_argument('prompt', nargs='*')
    p = parser.parse_args(); prompt = ' '.join(p.prompt)
    with (root / 'calls.jsonl').open('a') as log:
        log.write(json.dumps({'argv': args, 'pid': os.getpid()}) + '\n')
    if prompt.startswith('Open Sesame application session\n'): prompt = prompt.split('\n\n', 1)[1]
    if 'Current user message:\n' in prompt: prompt = prompt.rsplit('Current user message:\n', 1)[1]
    sid = 'session-' + uuid.uuid4().hex
    (root / 'sessions').mkdir(exist_ok=True)
    (root / 'sessions' / (sid + '.json')).write_text(json.dumps({'id': sid, 'harness': p.harness, 'familiar_id': p.familiar, 'project_root': p.cwd}))
    emit({'type': 'system', 'subtype': 'init', 'session_id': sid, 'cwd': p.cwd, 'permission': 'full' if prompt == 'wrong-policy' else p.permission})
    if prompt in ('nested-protocol', 'foreign-init'):
        emit({'type': 'system', 'subtype': 'init', 'session_id': sid if prompt == 'nested-protocol' else 'another-ledger', 'harness_session_id': 'native-thread'})
    if prompt == 'bad-json':
        print('{broken', flush=True); sys.exit(0)
    if prompt == 'no-result':
        sys.exit(0)
    if prompt == 'incomplete':
        sys.stdout.write('{"type":'); sys.stdout.flush(); sys.exit(0)
    if prompt == 'too-much':
        print('x' * (1024 * 1024 + 1), flush=True); sys.exit(0)
    if prompt == 'wrong-session':
        emit({'type': 'assistant', 'session_id': 'someone-else', 'message': {'content': [{'type': 'text', 'text': 'Wrong identity'}]}}); sys.exit(0)
    if prompt == 'slow':
        emit({'type': 'assistant', 'session_id': sid, 'message': {'content': [{'type': 'text', 'text': 'Ready to wait'}]}})
        time.sleep(60)
    if prompt == 'provider-denied':
        print('authentication required (fixture)', file=sys.stderr); sys.exit(2)
    text = 'Hello from ' + p.familiar
    if prompt == 'long-reply':
        emit({'type': 'assistant', 'session_id': sid, 'message': {'content': [{'type': 'text', 'text': 'x' * 70000}]}})
    elif prompt == 'multiple-messages':
        for part in ['Hello', 'Hello again']:
            emit({'type': 'assistant', 'session_id': sid, 'message': {'content': [{'type': 'text', 'text': part}]}})
    elif prompt == 'tools-between':
        emit({'type': 'text_delta', 'session_id': sid, 'text': 'First thought'})
        emit({'type': 'tool_start', 'session_id': sid, 'tool_name': 'Read', 'input': {'private': 'fixture-sensitive-tool-argument'}})
        emit({'type': 'tool_end', 'session_id': sid, 'tool_name': 'Read'})
        emit({'type': 'text_delta', 'session_id': sid, 'text': 'Second thought'})
    elif p.harness == 'coven-code':
        emit({'type': 'text_delta', 'session_id': sid, 'text': 'Hello'})
        emit({'type': 'text_delta', 'session_id': sid, 'text': ' from ' + p.familiar})
        if prompt == 'delta-final':
            emit({'type': 'assistant', 'session_id': sid, 'message': {'content': [{'type': 'text', 'text': text}]}})
    else:
        emit({'type': 'assistant', 'session_id': sid, 'message': {'content': [{'type': 'text', 'text': text}]}})
    if prompt == 'nested-protocol':
        emit({'type': 'result', 'session_id': sid, 'is_error': False, 'harness_session_id': 'native-thread'})
    if prompt in ('legacy-result', 'legacy-no-outer', 'foreign-legacy'):
        emit({'type': 'result', 'usage': {'input_tokens': 10}, 'cost_usd': 0, **({'session_id': 'foreign'} if prompt == 'foreign-legacy' else {})})
        if prompt == 'legacy-no-outer': sys.exit(0)
    if prompt == 'bad-result-bool': emit({'type': 'result', 'session_id': sid, 'is_error': 'false'})
    emit({'type': 'result', 'session_id': sid, 'is_error': prompt == 'result-error'})
else:
    raise SystemExit('Unsupported fixture command')
