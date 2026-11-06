"""Opt-in loopback inbox for BlueBubbles and a local Photon adapter. No shell access."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import sqlite3
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs

class Controller:
    def __init__(self, sender, chat, provider='bluebubbles', path=None, port=8766, allow_self=False):
        if not isinstance(sender,str) or not sender.strip() or len(sender)>500 or not isinstance(chat,str) or not chat.strip() or len(chat)>500 or provider not in ('bluebubbles', 'photon'):
            raise ValueError('Set a provider, exact allowed sender, and exact conversation ID.')
        self.sender, self.chat, self.provider = str(sender).strip().casefold(), str(chat).strip(), provider
        self.allow_self = allow_self is True and provider == 'bluebubbles'
        self.token = secrets.token_urlsafe(32)
        self.lock = threading.RLock()
        if path is None:
            preferred = Path.home() / '.local/share/Open Sesame/controller.sqlite'
            legacy = Path.home() / '.local/share/Perch/controller.sqlite'
            # Reuse existing receipts rather than replaying previously handled messages.
            path = preferred if preferred.exists() or not legacy.exists() else legacy
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db = sqlite3.connect(path, check_same_thread=False)
        os.chmod(path, 0o600)
        self.db.execute('CREATE TABLE IF NOT EXISTS commands (id TEXT PRIMARY KEY, text TEXT, state TEXT, result TEXT, created REAL)')
        self.db.execute('CREATE TABLE IF NOT EXISTS configuration (id INTEGER PRIMARY KEY, binding TEXT)')
        binding = hashlib.sha256(json.dumps([self.provider,self.sender,self.chat,self.allow_self]).encode()).hexdigest()
        old = self.db.execute('SELECT binding FROM configuration WHERE id=1').fetchone()
        if not old or old[0] != binding:
            self.db.execute("UPDATE commands SET state='interrupted',result='Controller permissions changed; command cancelled.' WHERE state IN ('queued','running')")
        self.db.execute('INSERT OR REPLACE INTO configuration VALUES (1,?)',(binding,))
        self.db.execute("UPDATE commands SET state='interrupted',result='Interrupted; review Open Sesame before resending.' WHERE state='running'")
        self.db.commit()
        owner = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def setup(self):
                super().setup()
                self.connection.settimeout(5)
            def answer(self, status, data):
                body = json.dumps(data).encode()
                self.send_response(status)
                self.send_header('Content-Type','application/json')
                self.send_header('Content-Length',str(len(body)))
                self.send_header('Cache-Control','no-store')
                self.end_headers(); self.wfile.write(body)
            def authorized(self):
                return not self.headers.get('Origin') and hmac.compare_digest(self.headers.get('Authorization',''), 'Bearer '+owner.token)
            def do_POST(self):
                blue = self.path.startswith('/bluebubbles/')
                valid = hmac.compare_digest(self.path, '/bluebubbles/'+owner.token) if blue else self.path=='/command' and self.authorized()
                if not valid or self.headers.get('Origin'): return self.answer(403, {'error':'Unauthorized'})
                try:
                    length = int(self.headers.get('Content-Length','0'))
                    if length<1 or length>65536: return self.answer(413, {'error':'Invalid body size'})
                    payload = json.loads(self.rfile.read(length))
                    event = owner.bluebubbles(payload) if blue else payload
                    if event is None: return self.answer(200, {'ignored':True})
                    result = owner.accept(event, 'bluebubbles' if blue else 'photon')
                    self.answer(200,result)
                except (ValueError, TypeError, KeyError): self.answer(400, {'error':'Invalid or unauthorized message'})
            def do_GET(self):
                if not self.authorized() or urlsplit(self.path).path!='/result': return self.answer(403, {'error':'Unauthorized'})
                key = parse_qs(urlsplit(self.path).query).get('id',[''])[0]
                with owner.lock:
                    row = owner.db.execute('SELECT state,result FROM commands WHERE id=?',(key,)).fetchone()
                self.answer(200, {'state':row[0],'result':row[1]} if row else {'state':'unknown'})
        try: self.server = ThreadingHTTPServer(('127.0.0.1', int(port)), Handler)
        except Exception:
            self.db.close(); raise
        self.server.daemon_threads = True
        threading.Thread(target=self.server.serve_forever,daemon=True).start()

    def bluebubbles(self,payload):
        if not isinstance(payload,dict) or payload.get('type')!='new-message': return None
        data = payload.get('data') or {}
        if not isinstance(data,dict): raise ValueError('Invalid message data')
        own = data.get('isFromMe') is True
        if own and (not self.allow_self or not isinstance(data.get('text'),str) or not data['text'].lower().startswith(('open sesame ', 'open sesame:', 'perch ', 'perch:'))): return None
        if not own and data.get('isFromMe') is not False: return None
        chats = data.get('chats') or []
        handle = data.get('handle') or {}
        if not isinstance(chats,list) or len(chats)!=1 or not isinstance(chats[0],dict) or not isinstance(handle,dict): raise ValueError('One chat required')
        return {'id':data.get('guid'),'sender':self.sender if own else handle.get('address'),'chat':chats[0].get('guid'),'text':data.get('text')}

    def accept(self, event, provider):
        if not isinstance(event,dict) or provider!=self.provider: raise ValueError('Wrong provider')
        if str(event.get('sender','')).strip().casefold()!=self.sender or event.get('chat')!=self.chat: raise ValueError('Not allowed')
        key, text = event.get('id'), event.get('text')
        if not isinstance(key,str) or not key or len(key)>500 or not isinstance(text,str) or not text.strip() or len(text)>2000: raise ValueError('Invalid message')
        key = hashlib.sha256((provider+':'+key).encode()).hexdigest()
        with self.lock:
            old = self.db.execute('SELECT state,result FROM commands WHERE id=?',(key,)).fetchone()
            if old: return {'id':key,'state':old[0],'result':old[1],'duplicate':True}
            if self.db.execute("SELECT count(*) FROM commands WHERE state IN ('queued','running')").fetchone()[0]>=100: raise ValueError('Inbox full')
            self.db.execute("INSERT INTO commands VALUES (?,?,'queued','',?)",(key,text.strip(),time.time()));self.db.commit()
        return {'id':key,'state':'queued'}

    def poll(self):
        with self.lock:
            row=self.db.execute("SELECT id,text FROM commands WHERE state='queued' ORDER BY created LIMIT 1").fetchone()
            if not row: return None
            self.db.execute("UPDATE commands SET state='running' WHERE id=?",(row[0],));self.db.commit()
            return {'id':row[0],'text':row[1]}

    def ack(self,key,result):
        with self.lock:
            self.db.execute("UPDATE commands SET state='done', result=? WHERE id=? AND state='running'",(str(result)[:3000],key));self.db.commit()
        return True

    def info(self):
        base='http://127.0.0.1:'+str(self.server.server_port)
        return {'running':True,'provider':self.provider,'endpoint':base+'/bluebubbles/'+self.token if self.provider=='bluebubbles' else base,'token':self.token if self.provider=='photon' else '', 'sender':self.sender,'chat':self.chat}

    def close(self):
        self.server.shutdown();self.server.server_close()
        with self.lock: self.db.close()
