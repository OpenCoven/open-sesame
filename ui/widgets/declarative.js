import * as model from '../definitions.js';
import {createDefinitionStore,performAction} from './declarative-model.js';

// Definitions only describe text, fields and closed operations. They never supply a path to
// code, HTML, a bridge method, an arbitrary request or a native capability.
export async function mount({surface,signal,bridge,navigate,report,catalogChanged=()=>{}}) {
  const document=surface.ownerDocument;
  const node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);return n;};
  const store=createDefinitionStore(bridge);
  let entries=[], preview=null, readable=false, ticket=0;
  let writes=Promise.resolve();
  const drafts=new Map(), lifetimes=new Map(), noteIds=new Map();
  const status=node('p');status.setAttribute('role','status');
  // A sentence that reports a failure is drawn in the warning colour; any other clears it.
  const say=(text,tone)=>{if(signal.aborted)return;status.textContent=text;if(tone)status.dataset.tone=tone;else delete status.dataset.tone;};
  const current=()=>!signal.aborted;
  const title=node('h2','JSON widgets');
  const explanation=node('p','Import a widget definition, review its sample content and requested access, then install it.');
  const label=node('label','Import widget JSON '),file=node('input');
  file.type='file';file.accept='.json,application/json';file.setAttribute('aria-label','Import widget JSON');label.append(file);
  const previewHost=node('section'),collection=node('div');collection.className='json-collection';
  surface.append(title,explanation,label,status,previewHost,collection);

  const button=(parent,text,action)=>{
    const b=node('button',text);b.type='button';
    b.addEventListener('click',async()=>{
      b.disabled=true;
      try{await action();}catch(error){say(error.message||String(error),'warn');}
      finally{b.disabled=false;}
    });parent.append(b);return b;
  };
  const announce=()=>catalogChanged(entries.map(entry=>({id:entry.id,name:entry.definition.name})));
  const save=update=>{
    const operation=writes.then(async()=>{
      if(!current())return false;
      const next=update(entries);
      await store.save(next);
      if(!current())return false;
      entries=next;announce();return true;
    });
    writes=operation.catch(()=>{});
    return operation;
  };
  const retire=id=>{
    lifetimes.get(id)?.abort();lifetimes.delete(id);
  };
  const config=entry=>drafts.get(entry.id)||model.configuration(entry.definition,entry.config);
  // render() and renderPreview() draw their parts again, so each action puts the keyboard back
  // on the control that comes next instead of leaving it on the page (issue #199).
  const cardOf=id=>[...collection.children].find(child=>child.dataset.instance===id);
  const buttonOf=(parent,text)=>[...(parent?.querySelectorAll('button')||[])].find(b=>b.textContent===text);

  function content(parent,definition,values,data) {
    for(const component of definition.components) {
      const row=node('div');row.className='json-component';
      row.append(node('strong',component.label));
      if(component.type==='input') {
        const input=node('textarea');input.value=values[component.field]||'';input.maxLength=2000;
        input.setAttribute('aria-label',component.label);
        input.addEventListener('input',()=>{values[component.field]=input.value;});row.append(input);
      } else if(component.type==='list') {
        const list=node('ul');
        for(const item of component.items||data?.entries||[])list.append(node('li',item));row.append(list);
      } else row.append(node('p',component.text??data?.[component.field]??'—'));
      parent.append(row);
    }
  }
  function renderPreview() {
    previewHost.replaceChildren();
    if(!preview)return;
    const definition=preview;
    previewHost.append(node('h3',`Preview: ${definition.name}`),node('p',definition.description),node('p',`${definition.author} · ${definition.license}`),node('p',`Requested access: ${definition.capabilities.join(', ')||'None'}`),node('p','Sample content · no action or provider is run.'));
    content(previewHost,definition,model.configuration(definition),definition.fixtures);
    button(previewHost,'Install widget',async()=>{
      const entry={...model.instance(definition),active:true};
      if(await save(current=>[...current,entry])){preview=null;renderPreview();render();say('Widget installed.');cardOf(entry.id)?.querySelector('button')?.focus();}
    }).disabled=!readable;
    for(const entry of entries) button(previewHost,`Replace ${entry.definition.name}`,async()=>{
      if(await save(current=>current.map(old=>old.id===entry.id?model.replace(old,definition):old))){retire(entry.id);drafts.delete(entry.id);preview=null;renderPreview();render();say('Widget replaced.');}
    }).disabled=!readable;
    button(previewHost,'Dismiss preview',()=>{preview=null;renderPreview();});
  }
  function render() {
    const activeIds=new Set(entries.filter(entry=>entry.active!==false).map(entry=>entry.id));
    for(const id of lifetimes.keys())if(!activeIds.has(id))retire(id);
    collection.replaceChildren();
    for(const entry of entries) {
      const card=node('section');card.className='json-card';card.dataset.instance=entry.id;
      card.append(node('h3',entry.definition.name));
      button(card,entry.active===false?'Turn on':'Turn off',async()=>{
        const active=entry.active===false;
        // Off retires activity immediately, even when the storage reply is delayed.
        if(!active){retire(entry.id);entry.active=false;render();}
        if(await save(current=>current.map(old=>old.id===entry.id?{...old,active}:old)))render();
        else render();
      });
      button(card,'Export definition',()=>{
        const url=URL.createObjectURL(new Blob([JSON.stringify(entry.definition,null,2)+'\n'],{type:'application/json'}));
        const link=node('a');link.href=url;link.download=`${entry.definition.id}.json`;link.click();
        setTimeout(()=>URL.revokeObjectURL(url),0);
      });
      if(entry.previous)button(card,'Roll back',async()=>{
        if(await save(current=>current.map(old=>old.id===entry.id?model.rollback(old):old))){retire(entry.id);drafts.delete(entry.id);render();say('Widget rolled back.');}
      });
      const remove=button(card,'Remove widget',()=>{
        remove.hidden=true;
        const confirm=button(card,'Confirm removal',async()=>{
          const previousActive=entry.active!==false;
          retire(entry.id);entry.active=false;render();
          try {
            if(await save(current=>current.filter(old=>old.id!==entry.id))){drafts.delete(entry.id);render();say('Widget removed.');if(current())file.focus();}
          } catch(error) {
            entries=entries.map(old=>old.id===entry.id?{...old,active:previousActive}:old);
            if(current())render();
            throw error;
          }
        });
        button(card,'Keep widget',()=>{render();buttonOf(cardOf(entry.id),'Remove widget')?.focus();});
        confirm.focus();
      });
      if(entry.active!==false) {
        const lifetime=lifetimes.get(entry.id)||new AbortController();lifetimes.set(entry.id,lifetime);
        const values=config(entry);drafts.set(entry.id,values);
        const panel=node('div');panel.dataset.jsonSurface=entry.id;
        // Installed widgets use literals/configuration until the person asks for source data.
        // Fixture values appear only in the explicitly labelled preview above.
        content(panel,entry.definition,values,null);
        button(panel,'Save configuration',async()=>{
          if(await save(current=>current.map(old=>old.id===entry.id?{...old,config:{...values}}:old)))say('Configuration saved.');
        });
        if(entry.definition.source)button(panel,'Load data',()=>{
          say('This data source is not available in this version.');
        });
        for(const action of entry.definition.actions)button(panel,action.label,async()=>{
          const turn=lifetime.signal;
          const key=entry.id+':'+entry.definition.actions.indexOf(action);
          const payload=JSON.stringify([entry.definition.id,entry.definition.version,action.operation,Object.hasOwn(values,action.value)?values[action.value]:action.value]);
          let attempt=noteIds.get(key);
          if(action.operation==='note.save'&&(!attempt||attempt.payload!==payload)) {
            attempt={id:crypto.randomUUID(),payload};noteIds.set(key,attempt);
          }
          let result;
          try {result=await performAction(entry.definition,action,values,{bridge,navigate,signal:turn},attempt?.id);}
          catch(error){if(!current()||turn.aborted||action.operation==='note.save'&&noteIds.get(key)!==attempt)return;throw error;}
          const latest=noteIds.get(key)===attempt;
          // A confirmed commit retires its retry ID even when its former surface is gone.
          if(action.operation==='note.save'&&result?.item?.id===attempt.id&&latest)noteIds.delete(key);
          if(!current()||turn.aborted||action.operation==='note.save'&&!latest)return;
          if(action.operation==='note.save') {
            if(result?.item?.id!==attempt.id)throw Error('The note could not be saved. Your input is retained.');
            say('Note saved.');
          }
        });
        card.append(panel);
      }
      collection.append(card);
    }
    if(!entries.length)collection.append(node('p','No JSON widgets installed.'));
  }
  file.addEventListener('change',async()=>{
    const turn=++ticket;
    try {
      const chosen=file.files?.[0];if(!chosen)return;
      if(chosen.size>100000)throw Error('Package must be JSON under 100 KB');
      const raw=await chosen.text();
      if(!current()||ticket!==turn)return;
      try {preview=model.parse(raw);}
      catch(error){
        // The engine's parser text and the validator's field list are not sentences for a person.
        if(error instanceof SyntaxError)throw Error('This file is not JSON. Choose a widget definition file (.json).');
        throw Error(`This definition cannot be installed: ${error.message}`);
      }
      renderPreview();say('Review the sample and requested access before installing.');
    }catch(error){if(current()&&ticket===turn){preview=null;renderPreview();say(error.message,'warn');}}
  });
  try {
    entries=await store.read();readable=true;
    if(current()){announce();render();}
  }catch(error){say(`${error.message} Import previews still work; installation needs working storage.`,'warn');}
  signal.addEventListener('abort',()=>{ticket++;for(const id of lifetimes.keys())retire(id);},{once:true});
  return {dispose:async()=>{ticket++;for(const id of lifetimes.keys())retire(id);await writes;surface.replaceChildren();},command:async action=>{
    if(!action.startsWith('instance:'))return;
    const id=action.slice('instance:'.length),entry=entries.find(item=>item.id===id);
    if(!entry)throw Error('This JSON widget is no longer installed.');
    if(entry.active===false&&await save(current=>current.map(old=>old.id===id?{...old,active:true}:old)))render();
    const card=cardOf(id);
    card?.scrollIntoView({block:'nearest'});card?.querySelector('button')?.focus();
  }};
}
