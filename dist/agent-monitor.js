'use strict';
(()=>{
  const el=id=>document.getElementById(id),pane=el('pane-agent-monitor');
  pane.querySelector('.agent-filter-row').append(el('agent-refresh'));
  const labels={running:'Running',sleeping:'Sleeping',stopped:'Stopped',blocked:'Blocked',exited:'Exited',unknown:'Unknown'};
  let data=null,error='',busy=false,lastSuccess=0,timer=0,stale=false,filter='all',connection=0;
  const stateButtons=Object.entries({all:'All',...labels}).map(([value,label])=>{
    const button=element('button','agent-state-filter');button.type='button';button.dataset.state=value;
    button.append(element('span','',label),element('span','agent-filter-count','—'));button.setAttribute('aria-controls','agent-cards');
    button.addEventListener('click',()=>{filter=value;render()});el('agent-state-filters').append(button);return button;
  });
  el('agent-state-filters').addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const buttons=stateButtons.filter(button=>!button.hidden),index=buttons.indexOf(document.activeElement);if(index<0)return;
    event.preventDefault();const next=buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowLeft'?-1:1)+buttons.length)%buttons.length];
    filter=next.dataset.state;render();next.focus({preventScroll:true});
  });
  function duration(seconds){const mins=Math.floor(seconds/60);return mins>=1440?Math.floor(mins/1440)+'d '+Math.floor(mins%1440/60)+'h':mins>=60?Math.floor(mins/60)+'h '+mins%60+'m':mins?mins+'m':Math.floor(seconds)+'s'}
  function element(tag,cls,text){const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node}
  function card(agent){
    const node=element('article','agent-card');node.setAttribute('role','listitem');
    const head=element('header'),mark=element('span','agent-avatar');mark.dataset.provider=agent.provider;mark.innerHTML=icon('agents');
    const name=element('div','agent-identity');name.append(element('strong','',agent.name),element('small','','PID '+agent.pid));
    const badge=element('span','agent-state',labels[agent.state]||'Unknown');badge.dataset.state=agent.state;badge.title='OS process state · not task or approval status';head.append(mark,name,badge);
    const metrics=element('dl','agent-metrics');for(const [label,value] of [['CPU',agent.cpuPercent+'%'],['Memory',agent.memoryMB+' MB'],['Uptime',duration(agent.uptimeSeconds)]]){const item=element('div');item.append(element('dt','',label),element('dd','',value));metrics.append(item)}
    node.append(head,metrics);return node;
  }
  function announce(){window.dispatchEvent(new CustomEvent('open-sesame-agents-updated',{detail:{agents:data?.agents||[],fresh:!error&&!stale&&!!data}}))}
  function render(){
    const available=!!window.openSesameBridge?.available,agents=data?.agents||[],hasSnapshot=!!data;
    pane.dataset.stale=String(stale||!!error);
    el('agent-refresh').disabled=busy||!available;el('agent-refresh').classList.toggle('is-refreshing',busy);
    el('agent-connection').textContent=error|| (data?'Connected to '+data.machine+' · '+agents.length+' process'+(agents.length===1?'':'es'):available?'Discovering local agents…':'Open the desktop app to see local agent processes.');el('agent-connection').title=el('agent-connection').textContent;
    const query=el('agent-search').value.trim().toLowerCase();
    const matching=agents.filter(a=>!query||(a.name+' '+a.pid).toLowerCase().includes(query));
    const processState=agent=>labels[agent.state]?agent.state:'unknown';
    for(const button of stateButtons){
      const value=button.dataset.state,count=value==='all'?matching.length:matching.filter(a=>processState(a)===value).length,active=filter===value;
      button.hidden=!['all','running','sleeping'].includes(value)&&!active&&!agents.some(a=>processState(a)===value);
      button.setAttribute('aria-pressed',String(active));button.tabIndex=active?0:-1;
      button.querySelector('.agent-filter-count').textContent=hasSnapshot?count:'—';
      button.title=hasSnapshot?(query?'Matching agents':'Agents')+' · '+(value==='all'?'all states':labels[value]):'Connect the desktop companion to see counts';
    }
    const shown=matching.filter(a=>filter==='all'||processState(a)===filter);
    const list=el('agent-cards'),scroll=list.scrollTop;list.replaceChildren(...shown.map(card));list.scrollTop=scroll;list.hidden=!shown.length;el('agent-empty').hidden=!!shown.length;
    const filtered=hasSnapshot&&agents.length>0&&!shown.length;
    el('agent-empty-title').textContent=filtered?'No matching processes':error?'Discovery is unavailable':hasSnapshot?'Ready when your agents are':'Your local agents, at a glance';
    el('agent-empty-description').textContent=filtered?'Clear the filters or try another name or PID.':error?'Refresh to try again. Your last snapshot stays visible while the connection recovers.':hasSnapshot?'Start an agent in your terminal. Its process will appear here automatically. To talk with a familiar, open Familiars.':'Open Open Sesame Desktop to see CPU, memory and process state for agents running on this Mac.';
    el('agent-clear-filters').hidden=!query&&filter==='all';
    el('agent-desktop-download').hidden=available||filtered||hasSnapshot;
    el('agent-freshness').textContent=busy?'Refreshing…':(error||stale)&&data?'Last snapshot · '+new Date(lastSuccess).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):data?'Updated '+new Date(lastSuccess).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})+' · every 5s':error?'Discovery unavailable':'No machine connected';
  }
  async function refresh(){
    clearTimeout(timer);if(busy||document.hidden)return;
    if(!window.openSesameBridge?.available){if(data){error='Desktop companion disconnected.';stale=true}render();announce();return}
    const ticket=connection;busy=true;render();
    try{const result=await openSesameBridge.request('agents.snapshot');if(ticket!==connection||!openSesameBridge.available)return;if(!result||!Array.isArray(result.agents))throw new Error('Update your desktop companion to enable agent discovery.');data=result;lastSuccess=Date.now();error='';stale=false}
    catch(e){if(ticket===connection){error=e.message==='Invalid pane ID.'?'Update your desktop companion to enable agent discovery.':e.message||'Could not refresh agents.';stale=true}}
    finally{busy=false;render();announce();if(!document.hidden&&openSesameBridge.available)timer=setTimeout(refresh,5000)}
  }
  el('agent-refresh').addEventListener('click',refresh);el('agent-search').addEventListener('input',render);
  el('agent-clear-filters').addEventListener('click',()=>{el('agent-search').value='';filter='all';render();el('agent-search').focus({preventScroll:true})});
  window.addEventListener('open-sesame-desktop-ready',refresh);
  window.addEventListener('open-sesame-desktop-disconnected',()=>{connection++;clearTimeout(timer);error='Desktop connection closed. Reopen the app to reconnect.';stale=true;render();announce()});
  window.addEventListener('open-sesame-view-changed',()=>{if(state.scenario==='agent-monitor'){render();if(!data||Date.now()-lastSuccess>5000)refresh()}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(timer);stale=true;announce()}else refresh()});
  window.OpenSesameAgentMonitor={refresh,summary:()=>data&&!error?data.agents.length+' processes':'Processes'};
  render();window.openSesameBridge?.ready.then(refresh);
})();
