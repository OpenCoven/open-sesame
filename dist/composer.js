'use strict';
(()=>{
  const footer=document.querySelector('.widget-capture-footer'),input=document.getElementById('capture-input'),panel=document.getElementById('widget-panel'),toggle=document.getElementById('capture-expand'),head=footer.querySelector('.capture-editor-head');
  let expanded=false,full=false,hadText=false;
  function fullscreen(value){
    if(value&&window.OpenSesameLauncher?.active)window.OpenSesameLauncher.close(true);
    if(full===value)return;const start=input.selectionStart,end=input.selectionEnd;full=value;
    footer.classList.toggle('capture-full',full);panel.classList.toggle('capture-full-open',full);head.hidden=!full;
    toggle.setAttribute('aria-expanded',String(full));toggle.ariaLabel=toggle.title=full?'Collapse capture editor':'Expand capture editor';toggle.innerHTML=icon(full?'close':'expand');
    if(full){footer.setAttribute('role','dialog');footer.setAttribute('aria-modal','true');footer.setAttribute('aria-label','Capture editor')}else{footer.removeAttribute('role');footer.removeAttribute('aria-modal');footer.setAttribute('aria-label','Quick capture')}
    window.openSesameCapture?.hide();sync();input.focus({preventScroll:true});input.setSelectionRange(start,end);window.openSesameCapture?.resize();
  }
  function sync(){
    const hasText=!!input.value.trim();
    if(full&&hadText&&!hasText){hadText=false;fullscreen(false)}hadText=hasText;
    const next=full||footer.contains(document.activeElement)||!!window.OpenSesameVoice?.active||!document.getElementById('capture-url-row').hidden||!document.getElementById('capture-commands').hidden;
    footer.classList.toggle('capture-has-draft',hasText);footer.classList.toggle('capture-expanded',next);
    if(document.getElementById('capture-type').value==='auto'&&!hasText)input.placeholder=window.OpenSesameLauncher?.active?'Search views, type a command, or calculate…':state.scenario==='audio'?(window.OpenSesameLive?.placeholder()||'Ask about the conversation…'):window.OpenSesameCovenChat?.isActive()?'Message Coven, or speak…':({items:'Note, task, or paste a link…',reading:'Paste an article, paper, or type /…',terminal:'Ask an agent, or ! for Bash…',remote:'Capture a note, or / for commands…',focus:'Capture a thought, or /focus…'})[state.scenario]||'Capture, ask, or speak…';
    if(full){const hint=document.getElementById('capture-hint');hint.textContent=hint.textContent.replace(/(^| · )Enter(?= to)/g,'$1⌘ / Ctrl Enter').replace('Shift Enter for a new line','Enter for a new line')}
    if(next!==expanded){expanded=next;window.openSesameCapture?.resize();window.dispatchEvent(new Event('open-sesame-layout'))}
  }
  toggle.addEventListener('click',()=>fullscreen(!full));
  input.addEventListener('paste',event=>{
    const text=event.clipboardData?.getData('text/plain')||'';if(text.length>20000)return;
    if(text.length>650||text.split(/\r?\n/).length>6)setTimeout(()=>{if(input.value.trim())fullscreen(true)},0);
  });
  document.addEventListener('keydown',event=>{
    if(!full||footer.inert||!footer.contains(event.target))return;
    if(event.key==='Escape'&&document.getElementById('capture-commands').hidden&&document.getElementById('capture-url-row').hidden){event.preventDefault();event.stopImmediatePropagation();fullscreen(false)}
    if(event.key==='Tab'&&!event.ctrlKey&&!event.metaKey){const nodes=[...footer.querySelectorAll('button,textarea,input,select')].filter(n=>!n.disabled&&n.getClientRects().length),first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}}
  },true);
  document.getElementById('view-thoughts').addEventListener('click',()=>fullscreen(false));
  document.getElementById('capture-project').addEventListener('change',event=>{if(event.target.value==='__new')fullscreen(false)});
  footer.addEventListener('focusin',sync);footer.addEventListener('focusout',()=>setTimeout(sync,0));input.addEventListener('input',sync);
  window.addEventListener('open-sesame-layout',sync);window.addEventListener('open-sesame-chat-changed',sync);window.addEventListener('open-sesame-view-changed',sync);
  new MutationObserver(sync).observe(footer,{subtree:true,attributes:true,attributeFilter:['hidden']});window.OpenSesameComposer={sync,fullscreen,get full(){return full}};sync();
})();
