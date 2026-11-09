'use strict';
(()=>{
  const el=id=>document.getElementById(id),input=el('capture-input'),storageKey='open-sesame-shell-drafts-v1';
  const drafts=new Map();let context=null,generic=null,busy=false,ready=false,syncing=false;
  try{const saved=JSON.parse(localStorage.getItem(storageKey)||'{}');for(const [id,value] of Object.entries(saved).slice(0,60))if(/^[A-Za-z0-9_-]{1,80}$/.test(id)&&typeof value==='string')drafts.set(id,value.slice(0,20000))}catch{}
  function active(){return state.scenario==='terminal'&&!window.OpenSesameLauncher?.active&&!window.OpenSesamePageWidgets?.active}
  function persist(){try{localStorage.setItem(storageKey,JSON.stringify(Object.fromEntries([...drafts].filter(([,value])=>value).slice(-60))))}catch{}}
  function saveDraft(){if(!context)return;drafts.set(context,input.value);persist()}
  function sync(){
    if(!ready||syncing)return;syncing=true;
    try{
      const target=window.OpenSesameTerminal?.inputTarget(),next=active()?(target?.paneId||'unselected'):null;
      if(next!==context){
        if(context)saveDraft();else if(next)generic={value:input.value,type:el('capture-type').value,url:attachedUrl,ignored:ignoredInlineUrl};
        context=next;
        if(context){input.value=drafts.get(context)||'';el('capture-type').value='auto';attachedUrl='';ignoredInlineUrl='';closeUrlEditor()}
        else if(generic){input.value=generic.value;el('capture-type').value=generic.type;attachedUrl=generic.url;ignoredInlineUrl=generic.ignored;generic=null}
      }
      const shell=active();input.spellcheck=!shell;input.setAttribute('autocapitalize',shell?'off':'sentences');input.setAttribute('autocorrect',shell?'off':'on');
      document.querySelector('label[for="capture-input"]').textContent=shell?'Input for '+(target?.name||'selected shell'):'Capture an item';
      // A URL attachment is capture metadata; it must never alter terminal input.
      el('attach-link').hidden=shell;if(shell)closeUrlEditor();
    }finally{syncing=false}
  }
  function interpret(raw,view){
    if(!active()||view!=='terminal')return null;
    const typed=raw.trimStart(),match=typed.match(/^\/(\w+)(?:\s|$)/);
    if(typed.trim()==='/'||match&&window.openSesameCapture?.isReservedCommand(match[1]))return null;
    const target=window.OpenSesameTerminal?.inputTarget(),hint=target?.mode==='web'?'Use the input inside this web terminal':target?.connecting?'Opening '+target.name+'…':target?.ready?'Enter to send to '+target.name+' · Shift Enter for a new line':target?.paneId?'Open '+target.name+' to send input':'Add a shell to send input';
    return {kind:'shell',text:raw,target,label:target?.ready?'Send to '+target.name:'Shell input unavailable',hint,incomplete:!target?.ready||!raw.trim()};
  }
  function finishCommand(origin,text){
    if(!origin)return false;
    if(context===origin&&input.value.trim()===text)input.value='';
    if(drafts.get(origin)?.trim()===text)drafts.delete(origin);
    persist();return true;
  }
  function submit(){
    const intent=interpret(input.value,state.scenario);if(!intent)return false;
    if(busy||intent.incomplete){if(intent.incomplete)toast(intent.hint);return true}
    const target=intent.target,sourceContext=context,text=input.value;busy=true;renderDraft();
    window.OpenSesameTerminal.sendInput(target,text).then(()=>{
      // An acknowledgement can arrive after a pane switch or a newly edited draft. Clear only the sent text.
      if(context===sourceContext&&input.value===text){input.value='';drafts.delete(sourceContext)}
      else if(drafts.get(sourceContext)===text)drafts.delete(sourceContext);
      persist();
    }).catch(error=>{toast(error.message||'Shell input failed. Your text has been kept.');saveDraft()}).finally(()=>{busy=false;renderDraft()});
    return true;
  }
  input.addEventListener('input',saveDraft);
  function refresh(){sync();renderDraft()}
  window.addEventListener('open-sesame-terminal-changed',refresh);
  window.addEventListener('open-sesame-view-changed',()=>{refresh();if(active()&&state.expanded&&el('terminal-connect-form').hidden&&el('terminal-project-form').hidden)input.focus({preventScroll:true})});
  window.addEventListener('pagehide',saveDraft);
  document.addEventListener('DOMContentLoaded',()=>{ready=true;refresh()});
  window.OpenSesameShellInput={sync,interpret,submit,saveDraft,finishCommand,get commandContext(){return context},get active(){return active()},get busy(){return busy}};
})();
