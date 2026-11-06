'use strict';
(()=>{
  const el=id=>document.getElementById(id),KEY='open-sesame-workspace-rails-v1',known=['terminal','remote','reading','media'];let preferences={};try{const saved=JSON.parse(localStorage.getItem(KEY)||'{}');for(const id of known)if(typeof saved?.[id]==='boolean')preferences[id]=saved[id]}catch{}
  const contexts=new Map(),config={terminal:['terminal-rail','terminal-workspace','pane list'],remote:['remote-rail','remote-workspace','machine list'],reading:['reading-rail','reading-workspace','reading list'],media:['media-queue','media-workspace','media playlist']};
  const isOpen=(id,fallback=true)=>Object.hasOwn(preferences,id)?preferences[id]:fallback;
  function button(id){return ['terminal','remote'].includes(id)?el('agents-rail-toggle'):el(id==='reading'?'reading-rail-toggle':'media-queue-toggle')}
  function apply(id,options={}){
    const restoreFocus=document.activeElement===button(id);const context={available:true,defaultOpen:true,...contexts.get(id),...options};contexts.set(id,context);const [rail,workspace,label]=config[id],open=context.available&&isOpen(id,context.defaultOpen);el(rail).hidden=!open;el(workspace).classList.toggle('rail-collapsed',!open);
    const b=button(id);if(['terminal','remote'].includes(id)&&state.scenario!==id)return open;
    b.innerHTML=icon(id==='media'||id==='terminal'&&el('terminal-workspace').classList.contains('rail-right')?'rail-right':'rail-left');if(open&&['terminal','remote'].includes(id)){const label=document.createElement('span');label.textContent=id==='remote'?'Machines':'Shells';b.append(label)}b.hidden=!context.available;b.setAttribute('aria-controls',rail);b.setAttribute('aria-expanded',open);b.setAttribute('aria-label',(open?'Hide ':'Show ')+label);b.title=b.getAttribute('aria-label');b.classList.toggle('is-open',open);if(['terminal','remote'].includes(id)){const parent=open?el(id+'-rail-title'):el('agents-context');if(b.parentElement!==parent)parent.prepend(b);if(restoreFocus)b.focus({preventScroll:true})}return open;
  }
  function set(id,open){if(!known.includes(id))return;preferences[id]=!!open;try{localStorage.setItem(KEY,JSON.stringify(preferences))}catch{}apply(id);window.dispatchEvent(new Event('open-sesame-rails-changed'));window.dispatchEvent(new Event('open-sesame-layout'))}
  function toggle(id){const c=contexts.get(id);set(id,!isOpen(id,c?.defaultOpen??true))}
  function sync(){
    const remote=state.scenario==='remote',monitor=state.scenario==='agent-monitor';el('terminal-more').hidden=remote||monitor;el('remote-settings').hidden=true;
    document.querySelectorAll('[data-agents]').forEach(b=>{const active=b.dataset.agents===(monitor?'agent-monitor':remote?'remote':'terminal');b.setAttribute('aria-selected',active);b.tabIndex=active?0:-1});
    if(monitor)el('agents-rail-toggle').hidden=true;else apply(remote?'remote':'terminal');apply('reading');
  }
  el('agents-rail-toggle').addEventListener('click',()=>toggle(state.scenario==='remote'?'remote':'terminal'));el('reading-rail-toggle').addEventListener('click',()=>toggle('reading'));el('media-queue-toggle').addEventListener('click',()=>toggle('media'));
  const modeTabs=[...document.querySelectorAll('[data-agents]')];
  modeTabs.forEach((b,index)=>{b.addEventListener('click',()=>{changeScenario(b.dataset.agents);window.dispatchEvent(new CustomEvent('open-sesame-home',{detail:b.dataset.agents}));b.focus({preventScroll:true})});b.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=modeTabs[e.key==='Home'?0:e.key==='End'?modeTabs.length-1:(index+(e.key==='ArrowLeft'?-1:1)+modeTabs.length)%modeTabs.length];changeScenario(next.dataset.agents);next.focus({preventScroll:true})}})});
  window.OpenSesameRails={isOpen,apply,set,toggle};window.OpenSesameWorkspace={sync};window.addEventListener('open-sesame-view-changed',sync);window.addEventListener('open-sesame-home',e=>{if(e.detail==='reading')set('reading',true)});sync();
})();
