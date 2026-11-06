'use strict';
(() => {
  const key = 'open-sesame-live-question-shortcuts-v1';
  const builtins = [
    {name:'what did I miss?', kind:'recap', prompt:'Catch me up on the supplied transcript excerpt. Summarize the most important developments in up to three short bullets.'},
    {name:'recommend questions', kind:'recommend', prompt:'Suggest up to three useful follow-up questions I could ask now. Ground each in something specific from this transcript.'},
    {name:'action items', kind:'actions', prompt:'List agreed next steps from this transcript. Include owners and dates only when the speaker states them.'}
  ];
  const normalize = value => value.trim().replace(/^\//,'').replace(/\s+/g,' ').toLowerCase();
  const matchKey = name => normalize(name).replace(/\?$/,'').trimEnd();
  const reserved = name => window.openSesameCapture?.isReservedCommand(name) || builtins.some(s=>matchKey(s.name)===matchKey(name));
  const validName = name => name.length <= 52 && /^[\p{L}\p{N}][\p{L}\p{N} '\u2019_-]*\??$/u.test(name);
  let saved = [];
  try {
    const records = JSON.parse(localStorage.getItem(key) || '[]');
    if (Array.isArray(records)) for(const row of records) {
      if (saved.length===16) break;
      if (typeof row?.name!=='string' || typeof row?.prompt!=='string') continue;
      const name=normalize(row.name), prompt=row.prompt.trim();
      if(validName(name) && !reserved(name) && prompt && prompt.length<=2000 && !saved.some(s=>matchKey(s.name)===matchKey(name))) saved.push({name,prompt});
    }
  } catch {}
  function persist(next) {
    try { localStorage.setItem(key,JSON.stringify(next)); saved=next }
    catch { throw Error('Could not save these shortcuts on this device.') }
  }
  function save(original,rawName,rawPrompt) {
    const name=normalize(rawName), prompt=rawPrompt.trim();
    if(!validName(name)) throw Error('Use a short name with letters, spaces, or a final question mark.');
    if(!prompt || prompt.length>2000) throw Error('Enter a question of up to 2,000 characters.');
    if(reserved(name) || saved.some(s=>s.name!==original && matchKey(s.name)===matchKey(name))) throw Error('That shortcut is already in use.');
    if(!original && saved.length>=16) throw Error('You can save up to 16 shortcuts.');
    const record={name,prompt};
    persist(original?saved.map(s=>s.name===original?record:s):[...saved,record]);
    return name;
  }
  function remove(name) { persist(saved.filter(s=>s.name!==name)) }
  const all = () => [...builtins,...saved];
  function find(raw) { return all().find(s=>matchKey(s.name)===matchKey(raw)) }
  function since(text,previous) {
    if(!previous)return text;
    if(text===previous)return '';
    if(text.startsWith(previous)){
      const rest=text.slice(previous.length);
      return /^\s*\n/.test(rest)?rest.trim():text.slice(previous.lastIndexOf('\n')+1).trim();
    }
    // A speech recognizer can revise its last partial line.
    const a=previous.split('\n'),b=text.split('\n');let i=0;
    while(i<a.length && i<b.length && a[i]===b[i])i++;
    return b.slice(i).join('\n').trim();
  }
  function local(kind,text) {
    const lines=[...new Set(text.split(/\n+/).map(s=>s.trim()).filter(Boolean))];
    const quote=line=>'“'+(line.length>240?line.slice(0,237)+'…':line)+'”';
    if(kind==='recap')return lines.slice(-3).map(line=>'• '+quote(line)).join('\n');
    const commitment=/\b(I’ll|I'll|I will|we’ll|we'll|we will|let’s|let's|agreed|action item|assigned|will send|by (?:Monday|Tuesday|Wednesday|Thursday|Friday|tomorrow))\b/i;
    if(kind==='actions'){
      const candidates=lines.filter(line=>commitment.test(line)).slice(-5);
      return candidates.length?candidates.map(line=>'• '+quote(line)).join('\n'):'No explicit next steps found in this excerpt.';
    }
    const stems=[
      'What would success look like for this?',
      'What is the next concrete step here?',
      'What still needs a decision here?'
    ];
    return lines.slice(-3).map((line,i)=>stems[i]+'\n'+quote(line)).join('\n\n');
  }
  window.OpenSesameQuestionShortcuts={all,find,save,remove,saved:()=>saved.slice(),since,local};
})();
