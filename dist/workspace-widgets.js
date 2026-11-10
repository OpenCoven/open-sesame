'use strict';
(() => {
  const el = id => document.getElementById(id), lifecycle = window.OpenSesameWidgetLifecycle;
  const active = id => lifecycle.isActive(id);
  const inactive=document.createElement('section');inactive.id='transcribe-inactive';inactive.hidden=true;
  const inactiveTitle=document.createElement('strong'),inactiveCopy=document.createElement('p'),activate=document.createElement('button');
  inactiveTitle.textContent='Start a live transcript';inactiveCopy.textContent='Activate Transcribe to choose an audio source. Recording starts only when you press Start.';
  activate.type='button';activate.textContent='Activate Transcribe';activate.addEventListener('click',()=>{try{lifecycle.set('transcribe','active');el('audio-source').focus({preventScroll:true})}catch(error){toast(error.message)}});
  inactive.append(inactiveTitle,inactiveCopy,activate);el('pane-audio').prepend(inactive);
  const surfaces = {
    focus:()=>active('agenda'), media:()=>active('local-media'),
    music:()=>['spotify','apple','youtube'].some(active), youtube:()=>active('youtube'),
    items:()=>['notes','bookmarks','task-manager','github'].some(active),
    terminal:()=>active('shells'), remote:()=>active('desktops'),
    familiars:()=>active('coven'), 'agent-monitor':()=>active('processes'), 'computer-agent':()=>active('computer'),
    reading:()=>active('reader')||active('rss'), audio:()=>['transcribe','claude','codex'].some(active), plugins:()=>true
  };
  const pages = {focus:['focus'],media:['media','music','youtube'],projects:['items'],console:['terminal','familiars','agent-monitor','computer-agent','remote'],reader:['reading'],live:['audio'],widgets:['plugins']};
  const imported = page => (window.OpenSesamePageWidgets?.list?.()||window.OpenSesameTools?.list()||[]).some(widget=>widget.page===page);
  const available = scenario => !!surfaces[scenario]?.() || Object.entries(pages).some(([page,views])=>views.includes(scenario)&&imported(page));
  function resolve(scenario) {
    if (available(scenario)) return scenario;
    const samePage = Object.values(pages).find(views=>views.includes(scenario)) || [];
    return [...samePage,'focus','media','items','terminal','plugins'].find(available) || 'plugins';
  }
  function commandAvailable(row) {
    if(row.children)return row.children.some(commandAvailable);
    const id=row.id.replace(/^launch-/,'');
    const widget={notes:'notes',note:'notes',outline:'notes',meeting:'notes',checklist:'notes',bookmark:'bookmarks',task:'task-manager',record:'transcribe',transcribe:'transcribe',screenshot:'notes',familiars:'coven',agent:'coven',find:'coven',computer:'computer',bash:'shells'}[id];
    if(widget)return active(widget);
    const scenario={reader:'reading',live:'audio',console:'terminal',entertainment:'media',projects:'items','local-media':'media'}[id]||id;
    return surfaces[scenario]?available(scenario):true;
  }
  let syncing = false;
  function sync() {
    if (syncing) return; syncing = true;
    try {
      const map = {lockin:'focus',entertainment:'media',items:'projects',agents:'console',reading:'reader',audio:'live',plugins:'widgets'};
      for (const node of document.querySelectorAll('#activity-menu>[data-tab]')) {
        const page = map[node.dataset.tab]; node.hidden = !pages[page].some(available) && !imported(page);
      }
      const agenda = el('tab-lockin'); agenda.setAttribute('aria-label','Agenda'); agenda.title = 'Agenda'; agenda.querySelector('span').textContent = 'Agenda';
      for (const node of document.querySelectorAll('[data-lockin]')) node.hidden = !surfaces[node.dataset.lockin]?.();
      for (const node of document.querySelectorAll('[data-agents]')) node.hidden = !surfaces[node.dataset.agents]?.();
      el('projects-note').hidden = !active('notes'); el('projects-bookmark').hidden = !active('bookmarks');
      // The shared Tasks widget replaces the duplicate legacy Tasks tab.
      el('projects-task').hidden = true;
      for (const option of el('music-service-select').options) option.hidden = !active(option.value);
      if (!active(el('music-service-select').value)) {
        const next = [...el('music-service-select').options].find(option=>!option.hidden);
        if (next) {el('music-service-select').value=next.value;el('music-service-select').dispatchEvent(new Event('change',{bubbles:true}))}
      }
      for(const option of el('live-agent').options)option.hidden=option.value!=='local'&&!active(option.value);
      if(el('live-agent').selectedOptions[0]?.hidden){el('live-agent').value='local';el('live-agent').dispatchEvent(new Event('change',{bubbles:true}))}
      el('plugins-desktop-action').hidden=openSesameBridge.available&&!active('processes');
      const capture = el('live-capture');
      if (capture) capture.hidden = !active('transcribe');
      inactive.hidden=active('transcribe');el('live-workspace').hidden=!active('transcribe');
      if(!active('transcribe')){el('live-options').hidden=true;el('live-settings').setAttribute('aria-expanded','false')}
      const page = Object.entries(pages).find(([,views])=>views.includes(state.scenario))?.[0];
      if (!surfaces[state.scenario]?.() && !window.OpenSesamePageWidgets?.active) {
        const widget = (window.OpenSesamePageWidgets?.list?.()||window.OpenSesameTools?.list()||[]).find(widget=>widget.page===page);
        if (widget) window.OpenSesamePageWidgets.open(widget.id);
      }
      const next = resolve(state.scenario);
      if (next !== state.scenario) changeScenario(next);
      if (state.scenario === 'items' && !window.OpenSesamePageWidgets?.active) {
        if (active('task-manager') && !active('notes') && !active('bookmarks')) window.OpenSesamePageWidgets.open('builtin-task-manager');
        else if (!active('notes') && active('bookmarks') && el('projects-note').getAttribute('aria-selected')==='true') el('projects-bookmark').click();
      }
    } finally {syncing=false}
  }
  window.OpenSesameWorkspaceWidgets = {available,resolve,sync,commandAvailable};
  for (const name of ['open-sesame-layout','open-sesame-view-changed','open-sesame-widgets-changed','open-sesame-tools-changed']) window.addEventListener(name,sync);
  window.addEventListener('open-sesame-widgets-changed',event=>{
    if(event.detail?.id==='local-media'&&!active('local-media'))el('local-media').pause();
    if(event.detail?.id==='reader'&&!active('reader')&&!active('rss')&&window.openSesameSpeech?.owner==='reading')window.openSesameSpeech.stop();
    if (event.detail?.id==='transcribe' && !active('transcribe') && !el('audio-stop').disabled) el('audio-stop').click();
  });
  sync();
})();
