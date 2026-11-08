#!/usr/bin/env python3
"""Minimal Coven Familiars integration using the same adapter as Open Sesame.

List and connect are read-only. A provider turn runs only with --message.
"""
import argparse
import json
from pathlib import Path
import sys
import uuid
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'desktop'))
from coven_runtime import CovenRuntime, state_directory

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--list', action='store_true', help='Discover the installed Coven roster')
    parser.add_argument('--familiar', help='An exact id returned by --list')
    parser.add_argument('--message', help='Explicitly send this text; otherwise no provider is invoked')
    parser.add_argument('--harness', choices=['coven-code', 'codex', 'claude'])
    args = parser.parse_args()
    if args.message is not None and not args.familiar: parser.error('--message requires --familiar')
    runtime = CovenRuntime(lambda event: print(json.dumps(event, ensure_ascii=False), flush=True), directory=state_directory().parent / 'familiars-example')
    try:
        status = runtime.status()
        print(json.dumps({'status': status}, ensure_ascii=False))
        if not status['available']: return 1
        roster = runtime.familiars()
        if args.list or not args.familiar:
            print(json.dumps({'familiars': roster}, ensure_ascii=False))
        if args.message is not None:
            conversation = runtime.open(args.familiar)
        if args.message is not None:
            result = runtime.send({'runId': uuid.uuid4().hex, 'familiarId': args.familiar,
                                   'conversationId': conversation['conversationId'], 'revision': conversation['revision'],
                                   'sessionId': conversation['sessionId'], 'harness': args.harness or conversation['harness'],
                                   'prompt': args.message})
            print(json.dumps({'result': result}, ensure_ascii=False))
        return 0
    except (ValueError, OSError) as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1
    finally:
        runtime.close()

if __name__ == '__main__': raise SystemExit(main())
