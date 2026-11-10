'use strict';
(() => {
  const el = id => document.getElementById(id);
  const providerNames = {local:'Transcript search', claude:'Claude Code', codex:'Codex'};
  const demoLines = [
    'Maya: The private beta opens Thursday. We’ll invite twelve designers for the first round.',
    'Sam: I’ll send the onboarding draft to Maya by Wednesday afternoon.',
    'Maya: Let’s review feedback on Friday before deciding whether to widen the beta.'
  ];
  let available = {}, checking = false, checkNumber = 0, sample = false;
  let entries = [], pending = null, generation = 0, conversationView = 'transcript';
  let demoTimer = null, demoStart = 0, demoLine = 0;
  let recapThrough = '';
  const shortcuts = window.OpenSesameQuestionShortcuts;
  const selector = el('live-agent');
  let preferred;
  try { preferred = localStorage.getItem('open-sesame-live-provider') } catch {}
  if (Object.hasOwn(providerNames, preferred)) selector.value = preferred;

  function placeholder() { return $('audio-record').checked?'Capture a note, or type / for commands…':'Ask about the transcript, or type /…'; }

  function action() {
    return selector.value === 'local' ? 'Search transcript' : 'Ask ' + providerNames[selector.value];
  }

  function settings(open) {
    el('live-options').hidden = !open;
    el('live-settings').setAttribute('aria-expanded', String(open));
  }

  function showView(view) {
    conversationView = view;
    closeEditor();
    window.openSesameCapture?.hide();
    settings(false);
    el('live-transcript-view').hidden=false;
    el('live-questions-view').hidden=false;
    transcriptEditor.layout();
    if(view==='questions')drawEntries();
    update();
  }

  function update() {
    const text = Boolean((window.OpenSesameSpeakers?.exportText()||audioSession.final).trim());
    const busy = audioSession.active || audioSession.starting || audioSession.stopping || demoTimer !== null;
    const compact = true;
    el('live-station').classList.toggle('compact',compact);
    el('live-station').classList.toggle('running',busy);
    el('live-transcript-view').hidden = false;
    el('live-questions-view').hidden = !text && !audioSession.interim.trim();
    el('audio-transcript').placeholder=busy?'Listening for speech…':'Choose what to transcribe above, then Start transcription.';
    el('live-text').hidden = !compact;
    el('live-exports').hidden = !text && !audioSession.recordUrl;
    el('live-source-badge').hidden = !sample;
    el('live-sample').hidden = busy || text || !!audioSession.recordUrl;
    el('audio-start').hidden = busy;
    el('audio-stop').hidden = !busy;
    const canFinish=audioSession.stopping&&((typeof nativeStopPending!=='undefined'&&nativeStopPending)||audioSession.recognizer);
    el('audio-stop').disabled = !busy || audioSession.stopping&&!canFinish;el('audio-stop').textContent=canFinish?'Finish now':audioSession.stopping?'Finishing…':'Stop';
    el('audio-start').disabled = busy || Boolean(pending);
    el('audio-start').setAttribute('aria-label',$('audio-record').checked?'Start recording':'Start transcription');
    el('audio-start').title = el('audio-start').getAttribute('aria-label');
    el('audio-stop').setAttribute('aria-label',demoTimer !== null ? 'Stop demo' : $('audio-record').checked?'Stop recording':'Stop transcription');
    el('audio-stop').title=el('audio-stop').getAttribute('aria-label');
    el('transcript-clear').disabled = !text || busy || Boolean(pending);
    el('tab-audio').title = demoTimer !== null ? 'Live · demo' : busy ? 'Live · listening' : 'Live conversation';
    el('live-answer-label').textContent = providerNames[selector.value];
    const cli = selector.value !== 'local';
    const installed = available[selector.value];
    el('live-agent-status').textContent = checking ? 'Checking installed agents…' :
      !cli ? 'Find matching passages on this device.' :
      !openSesameBridge.available ? 'Open the macOS companion to use '+providerNames[selector.value]+'.' :
      installed ? 'CLI detected. Uses the sign-in from your terminal.' :
      'Install and sign in to '+providerNames[selector.value]+', then check again.';
    el('live-recheck').hidden = !openSesameBridge.available;
    el('live-recheck').disabled = checking;
    el('live-question-hint').textContent = pending ? 'Waiting for '+providerNames[pending.agent]+'…' :
      !text ? 'Start transcription or try the demo.' :
      !cli ? 'Type / for question shortcuts. Answers here use transcript excerpts.' :
      installed ? 'Ask sends your question, recent transcript, and recent Q&A to '+providerNames[selector.value]+'.' : el('live-agent-status').textContent;
    el('live-question-hint').title=el('live-question-hint').textContent;
    if (state.scenario==='audio') window.OpenSesameComposer?.sync();
    window.OpenSesameLiveCapture?.sync();
  }

  async function checkProviders() {
    const version = ++checkNumber;
    checking = openSesameBridge.available;
    update();
    let result = {};
    if (checking) try { result = await openSesameBridge.request('live.agents') } catch {}
    if (version !== checkNumber) return;
    available = result || {};
    checking = false;
    update();
  }

  function drawEntries() {
    const log = el('live-answers');
    log.replaceChildren();
    if (!entries.length) {
      const prompt = document.createElement('p');
      prompt.className = 'live-no-questions';
      prompt.textContent = 'Ask about this conversation';
      log.append(prompt);
      const group=document.createElement('div');group.className='live-question-examples';
      for(const shortcut of shortcuts.all().slice(0,2)){
        const button=document.createElement('button');button.type='button';button.textContent='/'+shortcut.name;
        button.title=shortcut.prompt;
        button.addEventListener('click',()=>{
          const field=el('capture-input');
          if(!ask('/'+shortcut.name) && !field.value){field.value='/'+shortcut.name;renderDraft()}
        });
        group.append(button);
      }
      log.append(group);
    }
    for (const entry of entries) {
      const card = document.createElement('article');
      const question = document.createElement('strong'), meta = document.createElement('small'), answer = document.createElement('div');
      question.textContent = entry.question;
      meta.textContent = providerNames[entry.agent]+' · '+entry.at;
      answer.className='live-answer-body';
      if(entry.answer&&!entry.error&&window.OpenSesameContent?.answerMarkdown){answer.replaceChildren(OpenSesameContent.answerMarkdown(entry.answer,location.href))}
      else answer.textContent=entry.answer||'Waiting for an answer…';
      card.append(question,meta,answer);
      log.append(card);
    }
    log.scrollTop = log.scrollHeight;
  }

  function search(text, query) {
    const stop = new Set(['what','who','will','the','is','was','are','did','does','and','you','can','that','about','this','from','for','were','how','when','where','with']);
    const words = value => value.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    const terms = [...new Set(words(query).filter(word => !stop.has(word)))];
    const ranked = text.split(/\n+/).filter(Boolean).map((line,index) => {
      const tokens = new Set(words(line));
      return {line,index,score:terms.filter(term=>tokens.has(term)).length};
    }).filter(result=>result.score).sort((a,b)=>b.score-a.score || a.index-b.index);
    return ranked.length ? ranked.slice(0,3).sort((a,b)=>a.index-b.index).map(result=>'“'+result.line.trim()+'”').join('\n\n') :
      'No matching passage. Try a word from the conversation, or choose a CLI agent for an AI answer.';
  }

  function ask(raw) {
    const typed=raw.trim(), slash=typed.startsWith('/'), shortcut=slash?shortcuts.find(typed):null;
    const question=slash?(shortcut?.prompt || typed.slice(1).trim()):typed, agent=selector.value;
    if(agent!=='local'&&window.OpenSesameWidgetLifecycle?.isActive(agent)===false){toast('Activate this agent widget in Widgets first.');return false}
    const full = window.OpenSesameSpeakers?.exportText() || [audioSession.final,audioSession.interim].filter(Boolean).join('\n').trim();
    if (!full) { toast('Record or try the demo before asking.'); showView('transcript'); return false }
    if (pending || !question || question.length > 2000) { toast(pending?'Wait for the current answer.':'Use a question under 2,001 characters.'); return false }
    if (agent !== 'local' && (!openSesameBridge.available || !available[agent])) {
      showView('questions'); settings(true); selector.focus(); return false;
    }
    const recap=shortcut?.kind==='recap';
    const source=recap?shortcuts.since(full,recapThrough):full;
    const excerpt=source.slice(-24000);
    const history = entries.filter(entry=>entry.agent===agent && entry.answer && !entry.error).slice(-3)
      .map(entry=>(entry.prompt||entry.question)+'\n'+entry.answer).join('\n\n').slice(-6000);
    const entry = {question:slash?typed:question,prompt:question,agent,at:(sample?'Demo':el('audio-elapsed').textContent)+(source.length>24000?' · latest excerpt':'')};
    entries = [...entries.slice(-19),entry];
    showView('questions');
    if(recap && !excerpt)entry.answer='You’re caught up. No new transcript since your last recap.';
    else if (agent === 'local') {
      entry.answer=shortcut?.kind?shortcuts.local(shortcut.kind,excerpt):search(excerpt,question);
      if(recap)recapThrough=full;
    }
    else {
      const version = generation;
      pending = entry;
      openSesameBridge.request('live.ask',{agent,question,transcript:excerpt,history}).then(result => {
        if (version !== generation) return;
        if (result?.agent !== agent || typeof result?.answer !== 'string') throw Error('The agent returned an unreadable answer.');
        entry.answer = result.answer;
        if(recap)recapThrough=full;
      }).catch(error => {
        if (version !== generation) return;
        entry.error = true;
        entry.answer = error.message || 'The agent could not answer.';
      }).finally(() => {
        if (version !== generation) return;
        pending = null; drawEntries(); update();
      });
    }
    drawEntries(); update(); return true;
  }

  function reset() {
    generation++; pending = null; entries = []; sample = false; recapThrough='';
    drawEntries(); update();
  }
  function beforeListen() {
    endDemo();
    if (sample) {
      audioSession.final = ''; audioSession.interim = ''; reset(); renderTranscript();
    }
    settings(false);
    showView('transcript');
  }
  function endDemo(completed=false) {
    if (demoTimer === null) return;
    clearInterval(demoTimer); demoTimer = null;
    if(audioSession.interim.trim())audioSession.final+=(audioSession.final?'\n\n':'')+audioSession.interim.trim();
    audioSession.interim = '';
    el('audio-status').textContent = completed ? 'Demo complete' : 'Demo stopped';
    el('transcript-status').textContent = 'Simulated transcript · microphone off';
    renderTranscript();
  }
  function startDemo() {
    if (demoTimer !== null || audioSession.active || audioSession.starting || pending ||
        !sample && ((window.OpenSesameSpeakers?.exportText()||audioSession.final).trim() || audioSession.recordUrl)) return;
    reset(); sample = true; demoLine = 0; demoStart = Date.now();
    audioSession.final = ''; audioSession.interim = '';
    el('audio-status').textContent = 'Demo';
    el('transcript-status').textContent = 'Simulated transcript · microphone off';
    const tick = () => {
      if(demoTimer === null)return;
      const elapsed = Math.floor((Date.now()-demoStart)/1000);
      el('audio-elapsed').textContent = time(elapsed);
      if(demoLine >= demoLines.length) { endDemo(true); return }
      const words = demoLines[demoLine].split(' ');
      const visible = Math.min(words.length,2 + (elapsed % 5)*4);
      audioSession.interim = words.slice(0,visible).join(' ');
      if(visible === words.length || elapsed % 5 === 4) {
        audioSession.final += (audioSession.final ? '\n\n' : '') + demoLines[demoLine++];
        audioSession.interim = '';
      }
      renderTranscript();
    };
    demoTimer = setInterval(tick,1000);
    showView('transcript'); tick();
  }
  const editor=el('live-shortcut-editor'), choice=el('live-shortcut-choice'), shortcutDialog=el('live-shortcut-dialog');
  const nameField=el('live-shortcut-name'), promptField=el('live-shortcut-prompt');
  let confirmDelete=false;
  function closeEditor(focus=false){
    editor.hidden=true;el('live-customize').setAttribute('aria-expanded','false');
    if(shortcutDialog.open)shortcutDialog.close();
    if(focus)el('live-customize').focus({preventScroll:true});
  }
  function shortcutDraft(){
    const name=nameField.value.trim().replace(/^\//,'').replace(/\s+/g,' ').toLowerCase();
    el('live-shortcut-preview').textContent='/'+(name||'your shortcut');
    el('live-shortcut-count').textContent=promptField.value.length.toLocaleString()+' / 2,000';
    el('live-shortcut-save').disabled=!name||!promptField.value.trim();
    el('live-shortcut-error').hidden=true;confirmDelete=false;el('live-shortcut-delete').textContent='Delete';
  }
  function editSelected(){
    const current=shortcuts.saved().find(row=>row.name===choice.value);
    nameField.value=current?.name||'';promptField.value=current?.prompt||'';
    confirmDelete=false;el('live-shortcut-delete').hidden=!current;
    el('live-shortcut-delete').textContent='Delete';el('live-shortcut-error').hidden=true;
    el('live-shortcut-title').textContent=current?'Edit shortcut':'Create a shortcut';
    el('live-shortcut-save').textContent=current?'Save changes':'Create shortcut';shortcutDraft();
  }
  function openEditor(){
    if(!editor.hidden){closeEditor(true);return}
    settings(false);
    const options=[['','Create new…'],...shortcuts.saved().map(row=>[row.name,'/'+row.name])];
    choice.replaceChildren(...options.map(([value,label])=>{const o=document.createElement('option');o.value=value;o.textContent=label;return o}));
    choice.value='';editSelected();
    el('live-shortcut-saved').hidden=!shortcuts.saved().length;
    editor.hidden=false;shortcutDialog.showModal();el('live-customize').setAttribute('aria-expanded','true');nameField.focus();
  }
  function reportError(error){el('live-shortcut-error').hidden=false;el('live-shortcut-error').textContent=error.message}
  el('live-customize').addEventListener('click',openEditor);
  el('live-shortcut-close').addEventListener('click',()=>closeEditor(true));
  el('live-shortcut-cancel').addEventListener('click',()=>closeEditor(true));
  shortcutDialog.addEventListener('cancel',event=>{event.preventDefault();closeEditor(true)});
  nameField.addEventListener('input',shortcutDraft);promptField.addEventListener('input',shortcutDraft);
  choice.addEventListener('change',editSelected);
  editor.addEventListener('submit',event=>{
    event.preventDefault();
    try{const name=shortcuts.save(choice.value,nameField.value,promptField.value);closeEditor(true);renderDraft();toast('/'+name+' saved.')}
    catch(error){reportError(error)}
  });
  el('live-shortcut-delete').addEventListener('click',()=>{
    if(!confirmDelete){confirmDelete=true;el('live-shortcut-delete').textContent='Confirm delete';return}
    try{shortcuts.remove(choice.value);closeEditor(true);renderDraft();toast('Shortcut deleted.')}
    catch(error){reportError(error)}
  });
  el('live-sample').addEventListener('click',startDemo);
  window.addEventListener('pagehide',()=>endDemo());
  el('live-transcript-tab').addEventListener('click',()=>showView('transcript'));
  el('live-questions-tab').addEventListener('click',()=>showView('questions'));
  el('live-settings').addEventListener('click',()=>settings(el('live-options').hidden));
  el('live-choose-agent').addEventListener('click',()=>{settings(true);selector.focus()});
  el('live-recheck').addEventListener('click',checkProviders);
  selector.addEventListener('change',()=>{preferred=selector.value;try{localStorage.setItem('open-sesame-live-provider',preferred)}catch{}update();renderDraft()});
  el('transcript-clear').addEventListener('click',()=>{reset();el('audio-status').textContent='Ready';el('audio-elapsed').textContent='0:00';audioSourceHelp()});
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape' && !editor.hidden && state.scenario==='audio' && el('open-sesame-select-menu')?.getAttribute?.('role')!=='listbox'){
      event.preventDefault();event.stopImmediatePropagation();closeEditor(true);return;
    }
    if(event.key==='Escape' && !el('live-options').hidden && state.scenario==='audio'){
      event.preventDefault();event.stopImmediatePropagation();settings(false);el('live-settings').focus();
    }
  },true);
  document.addEventListener('pointerdown',event=>{
    if(!editor.hidden && !event.target.closest('#live-shortcut-editor,#live-customize,#open-sesame-select-menu'))closeEditor();
    if(!el('live-options').hidden && !event.target.closest('#live-options,#live-settings,#live-choose-agent,.open-sesame-select-menu,#open-sesame-select-menu'))settings(false);
  });
  window.addEventListener('open-sesame-home',event=>{if(event.detail==='audio')showView('transcript')});
  window.addEventListener('open-sesame-view-changed',()=>{if(state.scenario!=='audio'){settings(false);closeEditor()}else {update();drawEntries()}});
  window.addEventListener('open-sesame-layout',()=>{if(!state.expanded||window.OpenSesameLauncher?.active)closeEditor()});
  window.addEventListener('open-sesame-desktop-disconnected',()=>{checkNumber++;available={};checking=false;update()});
  function syncWidgetState(){if(pending&&window.OpenSesameWidgetLifecycle.isActive(pending.agent)===false){generation++;pending.error=true;pending.answer='Widget deactivated; answer discarded.';pending=null}if(selector.value!=='local'&&window.OpenSesameWidgetLifecycle.isActive(selector.value)===false)selector.value='local';for(const option of selector.options)if(option.value!=='local')option.disabled=!window.OpenSesameWidgetLifecycle.isActive(option.value);drawEntries();update()}
  window.addEventListener('open-sesame-widgets-changed',syncWidgetState);
  if(window.OpenSesameWidgetLifecycle)syncWidgetState();
  window.OpenSesameLive = {handoff(data){if(data){entries=data.entries;sample=data.sample;recapThrough=data.recapThrough;drawEntries();showView(data.view)}return JSON.parse(JSON.stringify({entries,sample,recapThrough,view:conversationView}))},get busy(){return !!pending},get demoRunning(){return demoTimer!==null},ask,update,placeholder,action,inQuestions:()=>state.scenario==='audio'&&!$('audio-record').checked,beforeListen,isDemo:()=>sample,startDemo,endDemo,stopForHide(){endDemo();if(audioSession.active||audioSession.starting)stopAudio()}};
  drawEntries(); update(); openSesameBridge.ready.then(checkProviders);
})();
