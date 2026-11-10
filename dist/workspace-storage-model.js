'use strict';
// Serialized values remain owned by the existing models. This layer owns commit/recovery generations.
(()=>{
 const MAX_BYTES=16*1024*1024;
 const jsonKeys=['items-v1','notes-v1','projects-v1','settings-v1','widget-lifecycle-v1','widget-lifecycle-v2','builtin-widgets-v1','tools-v1','page-tabs-v1','reading-v1','focus-agenda-v1','focus-calendar-v1','capture-draft-v1','focus-session-v1','workspace-rails-v1','familiar-drafts-v1','edit-drafts-v1','task-draft-v1','tool-drafts-v1','image-draft-v1'];
 const textKeys=['current-project','items-view-v1','focus-duration-v1','familiar-queued-draft-v1','default-familiar-v1'];
 const allowed=new Set([...jsonKeys,...textKeys].map(k=>'open-sesame-'+k));
 const copy=value=>JSON.parse(JSON.stringify(value));
 const error=(code,message,extra={})=>Object.assign(Error(message),{code,...extra});
 const bytes=value=>new TextEncoder().encode(value).byteLength;
 function plain(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)}
 function bounded(value,depth=0,budget={nodes:0}){
  if(++budget.nodes>100000||depth>24)throw error('invalid','Workspace content is too complex.');
  if(value===null||typeof value==='boolean')return;
  if(typeof value==='number'){if(!Number.isFinite(value))throw error('invalid','Invalid workspace number.');return}
  if(typeof value==='string'){if(value.length>1000000)throw error('invalid','Workspace text is too long.');return}
  if(typeof value!=='object')throw error('invalid','Invalid workspace value.');
  for(const key of Object.keys(value)){
   if(['__proto__','prototype','constructor'].includes(key)||/^(access[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key|(?:session|auth)[_-]?token|credentials?|password|private[_-]?key|pairing[_-]?(key|token)|authorization)$/i.test(key))throw error('authority','Credential or authority fields cannot enter workspace data.');
   bounded(value[key],depth+1,budget);
  }
 }
 function values(input){
  if(!plain(input)||Object.keys(input).length>allowed.size)throw error('invalid','Invalid workspace key map.');
  const result={};
  for(const [key,raw]of Object.entries(input)){
   if(!allowed.has(key))throw error('authority','Unsupported workspace key: '+key);
   if(typeof raw!=='string')throw error('invalid','Serialized workspace values must be strings.');
   if(jsonKeys.includes(key.slice(12))){
    let data;try{data=JSON.parse(raw)}catch{throw error('corrupt','Saved '+key+' needs recovery; its original is preserved.')}
    bounded(data);
    if(['items-v1','notes-v1','projects-v1','focus-agenda-v1','tools-v1','builtin-widgets-v1'].includes(key.slice(12))&&!Array.isArray(data))throw error('corrupt','Expected a saved list for '+key);
    if(['items-v1','notes-v1'].includes(key.slice(12))&&(data.length>300||data.some(x=>!plain(x)||typeof x.id!=='string'||typeof x.text!=='string')))throw error('corrupt','Saved items need recovery.');
    if(key.endsWith('projects-v1')&&(data.length>30||data.some(x=>!plain(x)||typeof x.id!=='string'||typeof x.name!=='string')))throw error('corrupt','Saved projects need recovery.');
    if(['settings-v1','widget-lifecycle-v1','widget-lifecycle-v2','page-tabs-v1','reading-v1','focus-calendar-v1','capture-draft-v1','focus-session-v1','workspace-rails-v1','familiar-drafts-v1','edit-drafts-v1','task-draft-v1','tool-drafts-v1','image-draft-v1'].includes(key.slice(12))&&!plain(data))throw error('corrupt','Expected saved object for '+key);
    if(key.endsWith('tools-v1'))for(const x of data)if(!plain(x)||typeof x.id!=='string'||!plain(x.definition)||![1,2].includes(x.definition.schemaVersion))throw error('corrupt','Saved tool instances need recovery.');
   }else if(raw.length>20000)throw error('invalid','Workspace preference is too long.');
   const suffix=key.slice(12);
   if(['items-v1','notes-v1','projects-v1'].includes(suffix)){const rows=JSON.parse(raw);if(new Set(rows.map(x=>x.id)).size!==rows.length)throw error('corrupt','Duplicate saved identities require recovery.');}
   if(suffix==='focus-agenda-v1'){const rows=JSON.parse(raw);if(!rows.length||rows.length>100||rows.some(x=>!plain(x)||typeof x.id!=='string'||typeof x.name!=='string'||!Number.isFinite(x.minutes)||x.minutes<=0))throw error('corrupt','Invalid saved focus agenda.');}
   if(suffix==='image-draft-v1'){const x=JSON.parse(raw);if((x.prompt!==undefined&&(typeof x.prompt!=='string'||x.prompt.length>4000))||(x.shape!==undefined&&!['square','landscape','portrait'].includes(x.shape)))throw error('corrupt','Saved image prompt needs recovery.');}
   if(suffix==='reading-v1'){const x=JSON.parse(raw),http=url=>{try{return ['http:','https:'].includes(new URL(url).protocol)}catch{return false}};if((x.feeds!==undefined&&(!Array.isArray(x.feeds)||x.feeds.length>20||x.feeds.some(f=>!plain(f)||typeof f.id!=='string'||(!f.sample&&!http(f.url)))))||(x.entries!==undefined&&(!Array.isArray(x.entries)||x.entries.length>200||x.entries.some(e=>!plain(e)||typeof e.id!=='string'||typeof e.title!=='string'||e.title.length>300||(e.body!==undefined&&(typeof e.body!=='string'||e.body.length>180000)))))||(x.meta!==undefined&&(!plain(x.meta)||Object.entries(x.meta).some(([key,value])=>key.length>=5000||!plain(value)))))throw error('corrupt','Saved Reader data needs recovery.');}
   if(suffix==='focus-calendar-v1'){const x=JSON.parse(raw);if((x.events!==undefined&&(!Array.isArray(x.events)||x.events.length>500))||(x.mode!==undefined&&!['day','week','month'].includes(x.mode)))throw error('corrupt','Saved focus calendar needs recovery.');}
   if(['widget-lifecycle-v1','widget-lifecycle-v2'].includes(suffix)){const x=JSON.parse(raw);if(Object.values(x).some(v=>!['active','inactive','uninstalled'].includes(v)))throw error('corrupt','Saved widget lifecycle needs recovery.');}
   if(suffix==='focus-session-v1'){const x=JSON.parse(raw);if(x.version!==1||typeof x.running!=='boolean'||![x.minutes,x.remaining,x.end,x.elapsed,x.started].every(Number.isFinite)||x.minutes<=0||x.minutes>1440||x.remaining<0||!Array.isArray(x.topics)||!x.topics.length||!Array.isArray(x.completed))throw error('corrupt','Saved focus session needs recovery.');}
   result[key]=raw;
  }
  if(result['open-sesame-items-v1']){const projects=new Set(JSON.parse(result['open-sesame-projects-v1']||'[]').map(x=>x.id));for(const item of JSON.parse(result['open-sesame-items-v1']))if(item.projectId&&!projects.has(item.projectId))throw error('corrupt','An item references a missing project; recover the original relationship before migrating.');}
  if(bytes(JSON.stringify(result))>MAX_BYTES-4096)throw error('quota','Workspace exceeds the sixteen MiB limit; export/recover before adding more.');
  return result;
 }
 function snapshot(input){
  if(!plain(input)||input.schemaVersion!==1)throw error('version','Unsupported workspace version; original data is preserved.');
  if(!Number.isSafeInteger(input.revision)||input.revision<1||input.revision>=Number.MAX_SAFE_INTEGER)throw error('corrupt','Invalid saved workspace revision.');
  if(typeof input.digest!=='string'||!/^[a-f0-9]{64}$/.test(input.digest))throw error('corrupt','Workspace checksum is missing.');return {schemaVersion:1,revision:input.revision,digest:input.digest,mutationId:typeof input.mutationId==='string'?input.mutationId:'',values:values(input.values)};
 }
 async function checksum(values){const canonical=JSON.stringify(Object.fromEntries(Object.entries(values).sort(([a],[b])=>a<b?-1:a>b?1:0)));return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical)))].map(v=>v.toString(16).padStart(2,'0')).join('')}
 async function checkedSnapshot(input){const value=snapshot(input);if(await checksum(value.values)!==value.digest)throw error('corrupt','Saved workspace checksum does not match; recover the original generation.');return value}
 function legacyValues(input){
  const result={};for(const key of allowed){const old='perch-'+key.slice(12);const raw=input[key]??input[old];if(raw!==undefined&&raw!==null)result[key]=raw}
  return values(result);
 }
 function parseExport(text){
  if(typeof text!=='string'||bytes(text)>MAX_BYTES)throw error('invalid','Import is too large.');let data;try{data=JSON.parse(text)}catch{throw error('invalid','Import is not readable JSON.')}
  if(!plain(data)||data.format!=='open-sesame-workspace'||data.schemaVersion!==1||Object.keys(data).some(k=>!['format','schemaVersion','values'].includes(k)))throw error('version','Unsupported workspace export.');
  return values(data.values);
 }
 function create(backend,{validate=()=>{}}={}){
  let current=null,previous=null,rawState=null,status='unhydrated',tail=Promise.resolve();
  const ready=()=>{if(status!=='ready')throw error(status,'Workspace '+status+'. Reconcile or recover before saving.');};
  async function hydrate(legacy={}){
   if(status!=='unhydrated')throw error('state','Workspace hydration already started.');status='hydrating';
   try{const state=await backend.read();rawState=state;if(state.current){current=await checkedSnapshot(state.current);validate(copy(current.values));previous=state.previous;status='ready';return}
    const migrated=legacyValues(legacy);validate(copy(migrated));const initial={schemaVersion:1,revision:1,mutationId:crypto.randomUUID(),values:migrated,digest:await checksum(migrated)};const ack=await backend.commit(0,initial);current=await acknowledged(ack,initial);status='ready';
   }catch(e){status=e.committed===false?'recovery':e.code==='uncertain'?'uncertain':'recovery';throw e}
  }
  async function acknowledged(ack,next){
   try{const checked=await checkedSnapshot(ack);if(checked.mutationId!==next.mutationId||checked.revision!==next.revision||checked.digest!==next.digest)throw Error('Mismatched generation');return checked}catch{status='uncertain';throw error('uncertain','Persistence acknowledgment did not match the requested generation. Reconcile before saving.')}
  }
  function enqueue(fn){const operation=tail.then(fn);tail=operation.catch(()=>{});return operation}
  async function commit(patch,expected=current?.revision){
   ready();if(expected!==current.revision)throw error('conflict','Workspace changed. Reopen the import or reconcile this scene.');
   const checkedValues=values(patch);validate(copy(checkedValues));const digest=await checksum(checkedValues);
   if(digest===current.digest){const state=await backend.read();rawState=state;try{await checkedSnapshot(state.current)}catch(e){status='recovery';throw e}if(state.current?.revision!==current.revision){status='conflict';throw error('conflict','Workspace changed in another scene. Reload after preserving drafts.')}if(state.current.digest!==current.digest){status='recovery';throw error('corrupt','Workspace content changed without a revision. Recover before saving.')}return current.revision}
   const next={schemaVersion:1,revision:current.revision+1,mutationId:crypto.randomUUID(),values:checkedValues,digest};
   let ack;try{ack=await backend.commit(current.revision,next,{expectedDigest:current.digest,expectedValues:current.values})}catch(e){if(e.code==='corrupt'){status='recovery';rawState=await backend.read()}else if(e.code==='conflict')status='conflict';else if(e.committed!==false)status='uncertain';throw e}
   const checked=await acknowledged(ack,next);
   previous=current;current=checked;return current.revision;
  }
  return {
   hydrate,async flush(){await tail;ready()},retire(){status='retired'},get status(){return status},get revision(){return current?.revision??0},
   getItem(key){ready();if(!allowed.has(key))throw error('authority','Unsupported workspace key');return current.values[key]??null},
   entries(){ready();return copy(current.values)},
   setItem(key,value){return enqueue(()=>commit({...current?.values,[key]:value}))},
   removeItem(key){return enqueue(()=>{ready();if(!allowed.has(key))throw error('authority','Unsupported workspace key');const next={...current.values};delete next[key];return commit(next)})},
   patch(changes){return enqueue(()=>{ready();const next={...current.values};for(const [key,value]of Object.entries(changes)){if(!allowed.has(key))throw error('authority','Unsupported workspace key');if(value===null)delete next[key];else next[key]=value}return commit(next)})},
   reconcile(){return enqueue(async()=>{const state=await backend.read();rawState=state;try{current=await checkedSnapshot(state.current);validate(copy(current.values));previous=state.previous;status='ready';return current.revision}catch(e){status='recovery';throw e}})},
   exportJSON(){ready();return JSON.stringify({format:'open-sesame-workspace',schemaVersion:1,values:copy(current.values)},null,2)+'\n'},
   previewImport(text){ready();const next=parseExport(text);validate(copy(next));return next},
   importJSON(text,{mode,expectedRevision,retireAfter=false}={}){return enqueue(async()=>{
    ready();if(mode!=='replace'||!Number.isSafeInteger(expectedRevision))throw error('confirmation','Choose explicit Replace after reviewing the preview and current revision.');
    const revision=await commit(parseExport(text),expectedRevision);if(retireAfter)status='retired';return revision;
   })},
   restorePrevious({expectedRevision,retireAfter=false}={}){return enqueue(async()=>{if(status==='recovery'){const state=rawState||await backend.read();if(!state.previous||!Number.isSafeInteger(state.current?.revision))throw error('recovery','Export the preserved original for manual recovery; no valid previous generation is available.');if(expectedRevision!==state.current.revision)throw error('conflict','Recovery revision changed.');const safe=await checkedSnapshot(state.previous);validate(copy(safe.values));const next={schemaVersion:1,revision:expectedRevision+1,mutationId:crypto.randomUUID(),values:safe.values,digest:await checksum(safe.values)};let ack;try{ack=await backend.commit(expectedRevision,next,{preserveRecovery:true,expectedValues:state.current.values,expectedDigest:state.current.digest})}catch(e){if(e.committed!==false)status='uncertain';throw e}current=await acknowledged(ack,next);previous=safe;status=retireAfter?'retired':'ready';return current.revision}ready();if(!previous)throw error('recovery','No previous committed generation is available.');const revision=await commit((await checkedSnapshot(previous)).values,expectedRevision);if(retireAfter)status='retired';return revision})}
  };
 }
 globalThis.OpenSesameWorkspaceStorageModel={create,values,legacyValues,snapshot,parseExport,allowed:[...allowed],MAX_BYTES};
})();
