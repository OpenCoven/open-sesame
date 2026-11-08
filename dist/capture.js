'use strict';
(()=>{
  const views={widgets:'plugins',plugins:'plugins',console:'agents',familiars:'familiars',projects:'items',library:'items',reader:'reading',live:'audio',agents:'agents',desktops:'remote',lockin:'lockin',music:'music',focus:'focus',youtube:'youtube',media:'media',terminal:'terminal',shells:'terminal',items:'items',reading:'reading',vnc:'remote'};
  function isReservedCommand(name){
    const first=name.trim().toLowerCase().split(/\s+/)[0];
    return Object.hasOwn(views,first) || ['tools','tool','record','transcribe','agent','computer','note','outline','task','todo','bookmark','search','find','screenshot'].includes(first);
  }
  function interpret(raw,type='auto',context=''){
    if(window.OpenSesameLauncher?.active)context='';
    const text=raw.trim();if(!text)return context==='terminal'&&window.OpenSesameCovenChat?.isActive()?{kind:'chat',task:'',incomplete:true,hint:'Enter to send · Shift Enter for a new line',label:'Send to familiar'}:{kind:'item',hint:'Capture, or type / for commands'};
    const calculation=type==='auto'&&!/^[!\/]/.test(text)?window.OpenSesameCalculator?.calculate(text):null;
    if(calculation)return {kind:'calculation',calculation,incomplete:!!calculation.error,label:'Copy result',hint:calculation.error||'Enter to copy result'};
    if(context==='audio' && window.OpenSesameLive?.inQuestions?.() && text.startsWith('/') && text.length>1){
      const name=text.slice(1).trim();
      if(name && !isReservedCommand(name))return {kind:'live',question:text,label:'Ask about transcript',hint:'Ask about this conversation · Enter'};
    }
    if(text.startsWith('!')&&type==='auto')return {kind:'bash',task:text.slice(1).trim(),hint:'Review Bash command',label:'Review Bash command',incomplete:!text.slice(1).trim()};
    const slash=text.match(/^\/(\w+)(?:\s+([\s\S]*))?$/),prefixed=text.match(/^(note|task|todo|bookmark|computer|agent):\s*([\s\S]*)$/i);
    const command=(slash?.[1]||prefixed?.[1]||'').toLowerCase(),body=(slash?.[2]??prefixed?.[2]??'').trim();
    if(command){
      if(command==='tool')return {kind:'tool',id:body,label:'Open tool',hint:'Open installed tool'};
      if(command==='tools')return {kind:'tools',label:'Open Tools',hint:'Import, preview and manage tools'};
      if(['record','transcribe'].includes(command))return {kind:'audio-mode',mode:command,label:command==='record'?'Start recorder':'Start transcription',hint:'Microphone · '+(command==='record'?'record audio':'live transcript')};
      const control=command==='computer'?window.OpenSesameComputer?.parse(body):null;if(control)return {kind:'computer',control,label:control.label,hint:window.openSesameBridge?.available?'Run on this Mac':'Desktop companion required'};
      if(command==='outline')return {kind:'item',type:'note',text:window.OpenSesameCaptureCatalog.outlineText(body),hint:body?'Save outline':'Add a topic, then subtopics separated by > or new lines',incomplete:!body};
      if(command==='screenshot')return {kind:'screen',request:body,hint:'Screen notes · demo',label:'Open demo screen notes'};
      if(['find','search'].includes(command))return {kind:'find',query:body,hint:'Search this conversation',label:'Search conversation',incomplete:!body};
      if(['computer','agent'].includes(command))return {kind:'agent',task:body,computer:command==='computer',hint:body?'Review '+(command==='computer'?'computer action':'Coven request'):'Describe the '+(command==='computer'?'computer action':'agent task'),label:'Review in Agents',incomplete:!body};
      if(['note','task','todo','bookmark'].includes(command))return {kind:'item',type:command==='todo'?'task':command,text:body,hint:'Save '+(command==='todo'?'task':command),incomplete:!body};
      if(views[command])return {kind:'view',view:views[command],value:body,hint:'Open '+(command==='lockin'?'Focus':command),label:'Open '+command};
      if(!body&&window.OpenSesameCaptureCatalog?.search('/'+command).length)return {kind:'help',hint:'Choose a command'};
      return {kind:'error',hint:'Unknown command · type / to see options'};
    }
    if(text==='/')return {kind:'help',hint:'Choose a command'};
    if(text.startsWith('/'))return {kind:'error',hint:'Choose a command · type / for options'};
    if(context==='audio'&&window.OpenSesameLive?.inQuestions?.()!==false&&type==='auto')return {kind:'live',question:text,label:'Ask about transcript',hint:'Ask about the transcript · Enter'};
    if(type!=='auto')return {kind:'item',hint:'Save '+type};
    if(context==='terminal'&&window.OpenSesameCovenChat?.isActive())return {kind:'chat',task:text,hint:'Enter to send · Shift Enter for a new line',label:'Send to familiar'};
    if(/^(?:hf|arxiv)\s*[: ]\s*\S+/i.test(text))return {kind:'view',view:'reading',value:text,hint:'Read paper',label:'Open in Reading'};
    if(context==='reading'&&typeof pageUrl==='function'&&pageUrl(text))return {kind:'view',view:'reading',value:text,hint:'Add article to Reading',label:'Add to Reading'};
    const open=text.match(/^(?:open|show|go to)\s+(plugins|familiars|console|library|reader|live|agents|desktops|lockin|music|focus|youtube|media|terminal|shells|items|reading|vnc)(?:\s+([\s\S]*))?$/i);
    if(open)return {kind:'view',view:views[open[1].toLowerCase()],value:open[2]?.trim()||'',hint:'Open '+open[1],label:'Open '+open[1]};
    const control=window.OpenSesameComputer?.parse(text);if(control)return {kind:'computer',control,label:control.label,hint:window.openSesameBridge?.available?'Run on this Mac':'Desktop companion required'};
    if(context==='audio'&&window.OpenSesameLive?.inQuestions?.()!==false){
      const label=window.OpenSesameLive?.action()||'Search transcript';
      return {kind:'live',question:text,label,hint:label+' · Enter'};
    }
    if(/^(?:open|launch|click|type|scroll|navigate|search the web|take a screenshot|switch to|move the mouse)\b/i.test(text))return {kind:'agent',task:text,computer:true,hint:'Review computer action in Coven',label:'Review in Agents'};
    return {kind:'item',hint:'Save note · type / for commands'};
  }
  const el=id=>document.getElementById(id),input=()=>el('capture-input'),menu=()=>el('capture-commands'),DRAFT='open-sesame-capture-draft-v1';
  let matches=[],menuPage=0,active=0,lastQuery='',menuInputValue='',dismissedValue=null,ready=false,draftTimer=0,layoutFrame=0,pageSize=6,group='all',trail=[],manualMenu=false;
  const catalog=window.OpenSesameCaptureCatalog;
  function hide(){menu().hidden=true;input().setAttribute('aria-expanded','false');input().removeAttribute('aria-activedescendant');el('capture-command-toggle').setAttribute('aria-expanded','false')}
  function select(index){const options=[...el('capture-command-list').querySelectorAll('[role=option]')];active=Math.max(0,Math.min(index,options.length-1));options.forEach((option,i)=>option.setAttribute('aria-selected',i===active));if(options[active]){input().setAttribute('aria-activedescendant',options[active].id);options[active].scrollIntoView({block:'nearest'})}else input().removeAttribute('aria-activedescendant')}
  function moveAcrossPages(step){
    const next=(menuPage*pageSize+active+step+matches.length)%matches.length;
    menuPage=Math.floor(next/pageSize);active=next%pageSize;renderMenu();
  }
  function back(){if(trail.length){trail.pop();menuPage=active=0;show(manualMenu);input().focus({preventScroll:true});return true}return false}
  function choose(index=active,run=false){
    const command=matches[menuPage*pageSize+index];if(!command)return false;
    if(command.children){trail.push(command);menuPage=active=0;manualMenu=true;show(true);input().focus({preventScroll:true});return true}
    if(command.kind==='destination'){hide();openSesameCapture.execute(interpret(command.value));return true}
    const current=input().value,plain=!current.trimStart().startsWith('/')&&!current.trimStart().startsWith('!')?current.trim():'';
    let value=command.template||command.value;
    if(plain&&/^\/(note|task|bookmark|outline)\s/.test(command.value))value+=command.template?'\n\n## Captured thought\n\n'+plain:plain;
    input().value=value;dismissedValue=value;hide();renderDraft();input().focus({preventScroll:true});
    if(command.template){window.OpenSesameComposer?.fullscreen(true);const start=value.indexOf(command.selection);input().setSelectionRange(start,start+command.selection.length)}else input().setSelectionRange(value.length,value.length);
    if(run&&command.kind==='question')el('capture-form').requestSubmit();
    return true;
  }
  function measureMenu(){
    const panel=el('widget-panel'),footer=el('capture-form').closest('.widget-capture-footer');
    const available=window.OpenSesameLauncher?.active?Math.min(440,frameScreen()[1]-180):window.OpenSesameComposer?.full?panel.clientHeight-116:Math.max(100,panel.clientHeight-footer.offsetHeight-65);
    menu().style.setProperty('--capture-menu-space',Math.floor(available)+'px');
    const columns=window.OpenSesameLauncher?.active?1:panel.clientWidth>=760?2:1;
    pageSize=window.OpenSesameLauncher?.active?Math.max(1,Math.min(60,matches.length||1)):Math.max(columns,Math.min(6,Math.floor((available-(el('capture-settings')?.open?192:130))/46)*columns));
  }
  function renderMenu(){
    const list=el('capture-command-list');list.replaceChildren();
    let previousGroup='';
    matches.slice(menuPage*pageSize,(menuPage+1)*pageSize).forEach((command,index)=>{
      if(window.OpenSesameLauncher?.active&&command.group!==previousGroup){const heading=document.createElement('div');heading.className='launcher-result-group';heading.setAttribute('role','presentation');heading.textContent=catalog.groups.find(([id])=>id===command.group)?.[1]||'Commands';list.append(heading);previousGroup=command.group}
      const button=document.createElement('button');button.type='button';button.id='capture-suggestion-'+index;button.tabIndex=-1;button.setAttribute('role','option');button.dataset.value=command.value;
      button.dataset.actionLabel=command.children?'Show options':command.kind==='destination'?'Open':'Choose';
      const glyph=document.createElement('i'),copy=document.createElement('span'),title=document.createElement('strong'),help=document.createElement('small'),shortcut=document.createElement('kbd');
      glyph.innerHTML=icon(command.icon||'capture');glyph.dataset.group=command.group;title.textContent=command.label;help.textContent=command.description;
      if(command.children){shortcut.innerHTML=icon('chevron');button.setAttribute('aria-label',command.label+' · Show options')}else shortcut.textContent=command.kind==='question'?'/':command.value.trim();
      copy.append(title,help);button.append(glyph,copy,shortcut);button.addEventListener('pointerdown',event=>event.preventDefault());button.addEventListener('click',()=>choose(index,true));list.append(button);
    });
    if(!matches.length){const empty=document.createElement('p'),intent=interpret(input().value,el('capture-type').value);empty.textContent=liveMenu()?'Press Enter to ask this question.':window.OpenSesameLauncher?.active?(intent.hint||'Press Enter to save this as a note.'):'No matches. Try “note”, “focus”, or “outline”.';list.append(empty)}
    const pages=Math.max(1,Math.ceil(matches.length/pageSize));el('capture-command-page').textContent=matches.length?matches.length+' '+(matches.length===1?'option':'options')+(pages>1?' · '+(menuPage+1)+' / '+pages:''):'No matches';el('capture-command-prev').disabled=menuPage===0;el('capture-command-next').disabled=menuPage===pages-1;el('capture-command-prev').hidden=el('capture-command-next').hidden=pages===1;select(active);
  }
  function liveMenu(){return !window.OpenSesameLauncher?.active&&state.scenario==='audio'&&window.OpenSesameLive?.inQuestions?.()}
  function show(manual=false){
    const term=manual?'':input().value.trim().replace(/\s+/g,' ').toLowerCase(),live=liveMenu(),query=(live?'live:':'global:')+term;
    if(query!==lastQuery&&!manual){menuPage=active=0;trail=[];group='all'}lastQuery=query;manualMenu=manual;menuInputValue=input().value;
    const questions=live?window.OpenSesameQuestionShortcuts.all().map(s=>({id:s.name,value:'/'+s.name,label:s.name,description:s.prompt,kind:'question',icon:'chat',group:'questions'})):[];
    const destinations=[['focus','Focus','Music, timer, YouTube, and media','focus'],['projects','Projects','Notes, bookmarks, tasks, and recent items','items'],['console','Console','Shells, agents, and desktops','terminal'],['reader','Reader','Articles, papers, and saved reading','rss'],['live','Live','Transcribe and ask about a conversation','mic'],['widgets','Widgets','Apps, accounts, and local connections','plugins']].map(([id,label,description,icon])=>({id:'launch-'+id,value:'/'+id,label,description,icon,group:'open',kind:'destination'}));
    const entries=window.OpenSesameLauncher?.active?[...destinations,...catalog.roots.filter(row=>!['open','focus'].includes(row.id))]:[...questions,...catalog.roots],branch=trail.at(-1);
    matches=branch?branch.children:catalog.search(term,entries).filter(row=>group==='all'||row.group===group);
    measureMenu();menuPage=Math.min(menuPage,Math.max(0,Math.ceil(matches.length/pageSize)-1));
    menu().hidden=false;input().setAttribute('aria-expanded','true');el('capture-command-toggle').setAttribute('aria-expanded','true');
    el('capture-command-back').hidden=!branch;el('capture-command-title').textContent=branch?trail.map(row=>row.label).join(' / '):window.OpenSesameLauncher?.active?'Open into':live?'Questions & actions':'What would you like to do?';
    const categories=el('capture-command-groups');categories.replaceChildren();categories.hidden=!!branch||!!term.replace(/^\//,'');
    for(const [id,label] of [...catalog.groups,...(live?[['questions','Questions']]:[])]){
      const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('aria-pressed',String(group===id));button.dataset.group=id;button.tabIndex=group===id?0:-1;button.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();event.stopPropagation();cycleGroup(event.key==='ArrowLeft'?-1:1,event.key==='Home'?'first':event.key==='End'?'last':null,true)}else if(['ArrowDown','ArrowUp','Escape'].includes(event.key)){event.preventDefault();event.stopPropagation();input().focus({preventScroll:true});if(event.key==='Escape')hide();else select(event.key==='ArrowUp'?Math.min(pageSize,matches.length)-1:0)}});button.addEventListener('pointerdown',event=>event.preventDefault());button.addEventListener('click',()=>{group=id;trail=[];menuPage=active=0;show(true);input().focus({preventScroll:true})});categories.append(button);
    }
    el('capture-command-help').textContent=window.OpenSesameLauncher?.active&&!branch?'↑ ↓ browse · Enter open · Esc close':branch?'↑ ↓ browse · Enter choose · ← / Esc back':'Tab categories · ↑ ↓ browse · → options · Enter choose';renderMenu();
  }
  function cycleGroup(step,edge=null,focus=false){
    const categories=el('capture-command-groups');if(categories.hidden)return false;
    const buttons=[...categories.querySelectorAll('button')],index=buttons.findIndex(button=>button.dataset.group===group);
    const next=edge==='first'?0:edge==='last'?buttons.length-1:(index+step+buttons.length)%buttons.length;
    group=buttons[next]?.dataset.group||'all';trail=[];menuPage=active=0;show(true);
    if(focus)el('capture-command-groups').querySelector('[aria-pressed="true"]')?.focus({preventScroll:true});return true;
  }
  function resize(){cancelAnimationFrame(layoutFrame);layoutFrame=requestAnimationFrame(()=>{
    const field=input();if(!field.offsetWidth||window.OpenSesameComposer?.full)return;
    const cap=Math.min(150,Math.max(72,el('widget-panel').clientHeight*.25));
    field.style.maxHeight=cap+'px';field.style.height='0px';
    const wanted=Math.min(cap,Math.max(22,field.scrollHeight));field.style.height=wanted+'px';field.style.overflowY=field.scrollHeight>cap?'auto':'hidden';
    field.closest('.widget-capture-footer').classList.toggle('capture-multiline',wanted>34);if(!menu().hidden){const previous=pageSize;measureMenu();if(previous!==pageSize){menuPage=active=0;renderMenu()}}
  })}
  function writeDraft(){if(!ready)return;try{const value=input().value;if(!value&&!attachedUrl){localStorage.removeItem(DRAFT);return}localStorage.setItem(DRAFT,JSON.stringify({value,type:el('capture-type').value,projectId:el('capture-project').value,url:attachedUrl,ignored:ignoredInlineUrl}))}catch{}}
  function refresh(){
    const value=input().value;
    if(value!==dismissedValue)dismissedValue=null;
    const typed=value.trimStart(), live=liveMenu(), partial=live && typed.startsWith('/') && window.OpenSesameQuestionShortcuts.all().some(s=>('/'+s.name).startsWith(typed.trim().replace(/\s+/g,' ').toLowerCase()));
    if(!menu().hidden&&manualMenu&&value===menuInputValue)show(true);else if(typed.startsWith('/')&&(!/\s/.test(typed)||partial)&&value!==dismissedValue)show();else if(window.OpenSesameLauncher?.active&&!typed.startsWith('/')&&!typed.startsWith('!')&&!window.OpenSesameCalculator?.calculate(value)&&value!==dismissedValue)show();else hide();resize();
    const type=el('capture-type').value,intent=interpret(value,type,state.scenario),url=draftUrl(),kind=intent.type||type,labels={familiars:'Familiars',plugins:'Widgets',music:'Music',focus:'Focus',youtube:'YouTube',media:'Media',agents:'Agents',terminal:'Shells',items:'Items',reading:'Reading',remote:'Desktops'};
    const mode=intent.kind==='calculation'?'Calculate':intent.kind==='live'?'Live':intent.kind==='find'?'Find':intent.kind==='chat'?'Coven':intent.kind==='bash'?'Bash':intent.kind==='agent'?(intent.computer?'Computer':'Coven'):intent.kind==='view'?labels[intent.view]||'Open':kind==='task'?'Task':kind==='note'?'Note':url||kind==='bookmark'?'Bookmark':'Note';el('capture-intent').textContent=mode;el('capture-intent').hidden=!value.trim()&&!url;el('capture-intent').dataset.mode=mode.toLowerCase();el('capture-command-toggle').innerHTML=icon(intent.kind==='agent'||intent.kind==='bash'?'terminal':intent.kind==='view'&&intent.view==='reading'?'rss':mode==='Task'?'task':mode==='Bookmark'?'bookmark':'capture');
    clearTimeout(draftTimer);draftTimer=setTimeout(writeDraft,200);
  }
  window.openSesameCapture={openMenu:()=>{dismissedValue=null;group='all';trail=[];show(false)},choose:()=>choose(active,true),back,interpret,isReservedCommand,hide,refresh,resize,execute(intent){
    if(intent.kind==='tools'){window.OpenSesameTools?.open();return true}
    if(intent.kind==='tool'){window.OpenSesameTools?.open(intent.id);return true}
    if(intent.kind==='computer'){window.OpenSesameComputer?.run(intent.control);return false}
    if(intent.kind==='audio-mode'){window.OpenSesameVoiceCommand?.startAudio(intent.mode);return true}
    if(intent.kind==='calculation'){window.OpenSesameInputTools?.copyCalculation();return false}
    if(intent.kind==='screen')return window.OpenSesameScreenNotes?.open(intent.request)===true;
    if(intent.kind==='live')return window.OpenSesameLive?.ask(intent.question)===true;
    if(intent.kind==='find')return window.OpenSesameCovenChat?.search(intent.query)===true;
    if(intent.kind==='chat')return window.OpenSesameCovenChat?.send(intent.task)===true;
    if(['agent','bash'].includes(intent.kind)){if(intent.incomplete){input().focus();return false}if(!window.openSesameStartAgent){toast('Terminal is unavailable. Keep your request and reload.');return false}return window.openSesameStartAgent({launcher:intent.kind==='bash'?'bash':'coven',task:(intent.computer?'Computer use request: ':'')+intent.task,projectId:document.getElementById('capture-project').value})!==false}
    if(intent.kind==='view'){
      if(intent.view==='focus'&&intent.value&&(!/^\d+(?:\s*(?:m|min|minutes))?$/i.test(intent.value)||!OpenSesameFocusCalendarModel.validDuration(parseInt(intent.value,10)))){toast('Use /focus with 15–1440 whole minutes.');return false}
      changeScenario(intent.view);
      if(intent.view==='focus'&&intent.value){if(focusRunning){toast('Pause your timer before changing its duration.');return false}if(!setFocusDuration(parseInt(intent.value,10)))return false}
      if(intent.view==='reading'&&intent.value&&!window.openSesameReading?.addDocument(intent.value))return false;
      if(['youtube','media'].includes(intent.view)&&intent.value){document.getElementById(intent.view+'-url').value=intent.value;document.getElementById(intent.view+'-form').requestSubmit()}
      hide();return true;
    }
    if(intent.kind==='help'){show();return false}toast(intent.hint);return false;
  }};
  el('capture-command-toggle').addEventListener('pointerdown',event=>{if(event.button===0)event.preventDefault()});
  el('capture-command-toggle').addEventListener('click',()=>{if(menu().hidden){dismissedValue=null;group='all';trail=[];menuPage=active=0;show(true);input().focus({preventScroll:true})}else{dismissedValue=input().value;hide();input().focus({preventScroll:true})}});
  el('capture-command-back').addEventListener('click',back);
  el('capture-command-back').addEventListener('pointerdown',event=>event.preventDefault());
  menu().addEventListener('click',event=>event.stopPropagation());
  document.addEventListener('click',event=>{if(!window.OpenSesameLauncher?.active&&!event.target.closest('.widget-capture-footer,#capture-launcher-open'))hide()});
  for(const [id,delta] of [['capture-command-prev',-1],['capture-command-next',1]])el(id).addEventListener('click',()=>{menuPage+=delta;active=0;renderMenu();input().focus({preventScroll:true})});
  input().addEventListener('keydown',event=>{
    if(event.defaultPrevented||event.isComposing||event.keyCode===229)return;
    if(!window.OpenSesameLauncher?.active&&!menu().hidden&&event.key==='Tab'&&!event.ctrlKey&&!event.metaKey&&!el('capture-command-groups').hidden){event.preventDefault();event.stopPropagation();cycleGroup(event.shiftKey?-1:1);return}
    if(!menu().hidden&&event.shiftKey&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&matches.length){
      const step={ArrowUp:-1,ArrowLeft:-1,ArrowDown:1,ArrowRight:1}[event.key];
      if(step===1||step===-1){
        event.preventDefault();
        event.stopPropagation();
        moveAcrossPages(step);
        return;
      }
    }
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!menu().hidden&&back())return;dismissedValue=input().value;if(!menu().hidden)hide();else input().blur();return}
    if(!menu().hidden&&!event.shiftKey){
      if(['Home','End'].includes(event.key)&&!event.ctrlKey&&!event.metaKey){event.preventDefault();event.stopPropagation();menuPage=event.key==='Home'?0:Math.max(0,Math.ceil(matches.length/pageSize)-1);active=event.key==='Home'?0:Math.max(0,(matches.length-1)%pageSize);renderMenu();return}
      if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();event.stopPropagation();if(matches.length)moveAcrossPages(event.key==='ArrowUp'?-1:1);return}
      if(event.key==='ArrowRight'&&matches[menuPage*pageSize+active]?.children){event.preventDefault();event.stopPropagation();choose();return}
      if(event.key==='ArrowLeft'&&trail.length){event.preventDefault();event.stopPropagation();back();return}
      if(['PageDown','PageUp'].includes(event.key)){event.preventDefault();menuPage=Math.max(0,Math.min(Math.max(0,Math.ceil(matches.length/pageSize)-1),menuPage+(event.key==='PageDown'?1:-1)));active=0;renderMenu();return}
      if(event.key==='Enter'||event.key==='Tab'&&!window.OpenSesameLauncher?.active){if(event.key==='Enter'&&!matches.length&&(liveMenu()||window.OpenSesameLauncher?.active))hide();else{event.preventDefault();choose(active,event.key==='Enter');return}}
    }
    if(event.key==='Enter'&&!event.shiftKey&&(!window.OpenSesameComposer?.full||event.metaKey||event.ctrlKey)){event.preventDefault();const button=el('capture-form').querySelector('[type=submit]');if(!button.disabled)el('capture-form').requestSubmit();return}if(event.key==='Enter')hide();
  });
  el('capture-project').addEventListener('change',writeDraft);window.addEventListener('pagehide',writeDraft);window.addEventListener('open-sesame-layout',resize);let inputWidth=0;new ResizeObserver(()=>{const width=input().clientWidth;if(width!==inputWidth){inputWidth=width;resize()}}).observe(input());
  document.addEventListener('DOMContentLoaded',()=>{let draft;try{draft=JSON.parse(localStorage.getItem(DRAFT)||'null')}catch{}if(draft&&typeof draft.value==='string'){input().value=draft.value.slice(0,20000);el('capture-type').value=['auto','note','task','bookmark'].includes(draft.type)?draft.type:'auto';if(projectFilter==='all'&&[...el('capture-project').options].some(o=>o.value===draft.projectId))el('capture-project').value=draft.projectId;attachedUrl=pageUrl(draft.url||'');ignoredInlineUrl=pageUrl(draft.ignored||'')}ready=true;renderDraft()});
})();
