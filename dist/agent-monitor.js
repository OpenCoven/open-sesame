'use strict';
(()=>{
  const el=id=>document.getElementById(id),pane=el('pane-agent-monitor');
  pane.querySelector('.agent-filter-row').append(el('agent-refresh'));
  const labels={running:'Running',sleeping:'Sleeping',stopped:'Stopped',blocked:'Blocked',exited:'Exited',unknown:'Unknown'};
  let data=null,error='',busy=false,lastSuccess=0,timer=0,stale=false,filter='all',connection=0,acting=0,confirmStop=null,actionMessage='';
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
  const activityLabels={working:'Working',waiting:'Needs you',ready:'Ready',completed:'Completed',exited:'Exited',unknown:'Unknown'};
  let layout='table',attentionOnly=false,selectedAgent='',sortBy='attention',providerFilter='all',projectOnly='all',terminalFilter='all';
  try{layout=window.localStorage?.getItem('open-sesame-process-view')||'table'}catch{}
  if(!['table','list','grid','board','gantt'].includes(layout))layout='table';
  const tools=element('div','agent-workspace-tools'),views=element('div','agent-view-switch');views.setAttribute('aria-label','Process layout');
  const viewButtons=['table','list','grid','board','gantt'].map(value=>{const b=element('button','',value[0].toUpperCase()+value.slice(1));b.type='button';b.addEventListener('click',()=>{layout=value;try{window.localStorage?.setItem('open-sesame-process-view',layout)}catch{}render()});views.append(b);return b});
  const needs=element('button','','Needs you · 0');needs.type='button';needs.addEventListener('click',()=>{attentionOnly=!attentionOnly;render()});const sort=element('select');sort.setAttribute('aria-label','Sort processes');for(const [value,label] of [['attention','Needs you first'],['name','Agent name'],['repo','Repository'],['cpu','CPU'],['memory','Memory'],['uptime','Uptime']]){const o=element('option','',label);o.value=value;sort.append(o)}sort.addEventListener('change',()=>{sortBy=sort.value;render()});
    const providers=element('select');providers.setAttribute('aria-label','Filter provider');for(const name of ['all','codex','claude','coven','gemini','aider','opencode']){const o=element('option','',name);o.value=name;providers.append(o)}providers.addEventListener('change',()=>{providerFilter=providers.value;render()});
    const clearHistory=element('button','','Clear activity history');clearHistory.type='button';clearHistory.addEventListener('click',async()=>{try{await openSesameBridge.request('agents.history.clear');await refresh()}catch(e){actionMessage=e.message;render()}});
    const projectSelect=element('select');projectSelect.setAttribute('aria-label','Filter project');const allProjects=element('option','','All projects');allProjects.value='all';projectSelect.append(allProjects);if(typeof projects!=='undefined')for(const p of projects){const o=element('option','',p.name);o.value=p.id;projectSelect.append(o)}projectSelect.addEventListener('change',()=>{projectOnly=projectSelect.value;render()});
    const terminals=element('select');terminals.setAttribute('aria-label','Filter terminal availability');for(const [v,l] of [['all','All terminals'],['linked','Linked terminals'],['unlinked','Unlinked terminals']]){const o=element('option','',l);o.value=v;terminals.append(o)}terminals.addEventListener('change',()=>{terminalFilter=terminals.value;render()});tools.append(views,needs,sort,providers,projectSelect,terminals,clearHistory);pane.querySelector('.agent-filter-row').append(tools);
  const inspector=element('aside','agent-inspector');inspector.hidden=true;inspector.setAttribute('aria-label','Agent details');pane.append(inspector);
  const seen=new Set();try{for(const k of JSON.parse(window.localStorage?.getItem('open-sesame-agent-seen')||'[]'))seen.add(k)}catch{}
  const completionKey=a=>(a.id||a.pid)+':'+(a.activity?.since||'');
  const activity=a=>a.state==='exited'?'exited':activityLabels[a.activity?.state]?a.activity.state:'unknown';
  function projectFor(a){if(typeof projects==='undefined')return null;const path=a.cwd||a.repository?.root||'';return projects.filter(p=>p.rootPath&&(path===p.rootPath||path.startsWith(p.rootPath+'/'))).sort((a,b)=>b.rootPath.length-a.rootPath.length)[0]}
  function inspect(a){selectedAgent=a.id||String(a.pid);inspector.hidden=false;inspector.replaceChildren(element('strong','',a.name+' · PID '+a.pid));for(const [k,v] of Object.entries({Project:projectFor(a)?.name||'Unregistered',Repository:a.repository?.root||'Unknown',Branch:a.repository?.branch||'Unknown',Directory:a.cwd||'Unavailable',Activity:activityLabels[activity(a)],Evidence:a.activity?.source||'none',Reason:a.activity?.reason||'No integration',Terminal:a.terminal?.kind||'unavailable'}))inspector.append(element('p','',k+': '+v));const project=projectFor(a);if(project){const open=element('button','','Open project');open.type='button';open.addEventListener('click',()=>{switchProject(project.id);changeScenario('items')});inspector.append(open)}
    if(a.cwd){const reveal=element('button','','Reveal folder');reveal.type='button';reveal.addEventListener('click',async()=>{try{await openSesameBridge.request('project.reveal',{path:a.cwd})}catch(e){actionMessage=e.message;render()}});inspector.append(reveal);const copy=element('button','','Copy path');copy.type='button';copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(a.cwd)}catch{actionMessage='Clipboard unavailable. Select the path in Details to copy it.';render()}});inspector.append(copy)}
    const close=element('button','','Close details');close.type='button';close.addEventListener('click',()=>{selectedAgent='';inspector.hidden=true});inspector.append(close)}
  function workspaceRender(shown){
    needs.textContent='Needs you · '+(data?.agents||[]).filter(a=>activity(a)==='waiting').length;needs.setAttribute('aria-pressed',String(attentionOnly));viewButtons.forEach((b,i)=>b.setAttribute('aria-pressed',String(['table','list','grid','board','gantt'][i]===layout)));
    const list=el('agent-cards');list.dataset.layout=layout;
    if(layout==='board'){
      list.replaceChildren(...Object.entries(activityLabels).map(([value,label])=>{const column=element('section','agent-board-column');column.append(element('h3','',label+' · '+shown.filter(a=>activity(a)===value).length),...shown.filter(a=>activity(a)===value).map(card));return column}));
    }else if(layout==='gantt'){
      const history=(data?.history||[]).filter(h=>!el('agent-search').value.trim()||[h.name,h.repository?.root].join(' ').toLowerCase().includes(el('agent-search').value.trim().toLowerCase()));
      list.replaceChildren(element('p','','Observed activity · past seven days · gaps are unobserved'),...history.map(h=>{const row=element('article','agent-timeline-row');const name=element('button','',h.name);name.type='button';name.addEventListener('click',()=>inspect({...h,activity:{state:h.intervals?.at(-1)?.state||'unknown'},terminal:{kind:'unavailable',reason:'Historical session'},state:'unknown'}));row.append(name);for(const interval of h.intervals||[]){const bar=element('span','agent-interval',new Date(interval.start).toLocaleTimeString()+' – '+new Date(interval.end).toLocaleTimeString()+' · '+(activityLabels[interval.state]||'Unknown'));bar.dataset.state=interval.state;bar.title=bar.textContent;const start=Date.now()-7*86400000;bar.style=bar.style||{};bar.style.left=Math.max(0,(interval.start-start)/(7*86400000)*100)+'%';bar.style.width=Math.min(100,Math.max(.5,(interval.end-interval.start)/(7*86400000)*100))+'%';row.append(bar)}return row}),...shown.map(card));
    }
    if(selectedAgent){const a=shown.find(a=>(a.id||String(a.pid))===selectedAgent);if(a)inspect(a);else inspector.hidden=true}
  }
  function duration(seconds){const mins=Math.floor(seconds/60);return mins>=1440?Math.floor(mins/1440)+'d '+Math.floor(mins%1440/60)+'h':mins>=60?Math.floor(mins/60)+'h '+mins%60+'m':mins?mins+'m':Math.floor(seconds)+'s'}
  function element(tag,cls,text){const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node}
  async function control(agent,action){
    if(busy||acting||stale||error||!openSesameBridge.available||!agent.controlToken)return;clearTimeout(timer);
    const ticket=connection;acting=agent.pid;confirmStop=null;actionMessage='';render();
    try{await openSesameBridge.request('agents.control',{pid:agent.pid,token:agent.controlToken,action});if(ticket===connection)actionMessage=({pause:'Pause',resume:'Resume',stop:'Stop'}[action])+' signal sent to '+agent.name+'.'}
    catch(error){if(ticket===connection)actionMessage=error.message||'The process could not be changed. Refresh to try again.'}
    finally{if(ticket===connection){acting=0;await refresh();render()}}
  }
  function card(agent){
    const node=element('article','agent-card');node.setAttribute('role','listitem');
    const head=element('header'),mark=element('span','agent-avatar');mark.dataset.provider=agent.provider;mark.innerHTML=icon('agents');
    const name=element('div','agent-identity');name.append(element('strong','',agent.name),element('small','','PID '+agent.pid));
    const badge=element('span','agent-state',labels[agent.state]||'Unknown');badge.dataset.state=agent.state;badge.title='OS process state · not task or approval status';head.append(mark,name,badge);
    const metrics=element('dl','agent-metrics');for(const [label,value] of [['CPU',agent.cpuPercent+'%'],['Memory',agent.memoryMB+' MB'],['Uptime',duration(agent.uptimeSeconds)]]){const item=element('div');item.append(element('dt','',label),element('dd','',value));metrics.append(item)}
    const actions=element('footer','agent-actions'),enabled=!!agent.controlToken&&!stale&&!error&&!busy&&!acting&&openSesameBridge.available&&!['exited','unknown'].includes(agent.state);
    const button=(label,action)=>{const b=element('button','',label);b.type='button';b.disabled=!enabled;b.setAttribute('aria-label',label+' · '+agent.name+' · PID '+agent.pid);b.addEventListener('click',action);actions.append(b);return b};
    if(confirmStop?.pid===agent.pid&&confirmStop.token===agent.controlToken){
      actions.append(element('small','','End this process? Unsaved work may be lost.'));
      button('Cancel',()=>{confirmStop=null;render()});button('Stop process',()=>control(agent,'stop')).className='agent-stop-confirm';
    }else{
      const paused=agent.state==='stopped';button(paused?'Resume process':'Pause process',()=>control(agent,paused?'resume':'pause'));
      button('Stop…',()=>{confirmStop={pid:agent.pid,token:agent.controlToken};render()});
    }
    if(!agent.controlToken)actions.title='Refresh in the current desktop app to manage this process.';
    if(acting===agent.pid)actions.append(element('small','','Applying…'));
    const context=element('div','agent-repo-context');context.append(element('strong','',projectFor(agent)?.name||agent.repository?.name||'Unknown project'),element('small','',agent.repository?.branch||''),element('small','',agent.cwd||'Directory unavailable'));
    const task=element('span','agent-activity',activityLabels[activity(agent)]+(activity(agent)==='waiting'&&agent.activity?.since?' · '+duration(Math.max(0,(Date.now()-agent.activity.since)/1000)):''));task.dataset.state=activity(agent);task.title=(agent.activity?.source||'none')+' · '+(agent.activity?.reason||'No activity integration');context.append(task);if(activity(agent)==='completed'&&!seen.has(completionKey(agent))){const ack=element('button','','New completion · mark seen');ack.type='button';ack.addEventListener('click',()=>{seen.add(completionKey(agent));try{window.localStorage?.setItem('open-sesame-agent-seen',JSON.stringify([...seen].slice(-1000)))}catch{}render()});context.append(ack)}
    const details=element('button','','Details');details.type='button';details.addEventListener('click',()=>inspect(agent));actions.append(details);
    const terminal=element('button','','Open terminal');terminal.type='button';terminal.disabled=stale||!!error||!agent.controlToken;terminal.title=agent.terminal?.reason||'Open the associated live session';terminal.addEventListener('click',async()=>{if(agent.terminal?.kind!=='owned'){try{const target=await openSesameBridge.request('agents.terminal',{pid:agent.pid,token:agent.controlToken});if(target.kind==='tmux')await window.openSesameAttachTerminal(target.command)}catch(e){actionMessage=e.message;render()}return}if(!window.openSesameFocusTerminal?.(agent.terminal.id)){actionMessage='Session changed or closed. Refresh before opening.';render()}});actions.append(terminal);
    node.append(head,context,metrics,actions);return node;
  }
  function announce(){window.dispatchEvent(new CustomEvent('open-sesame-agents-updated',{detail:{agents:data?.agents||[],fresh:!error&&!stale&&!!data}}))}
  function render(){
    const available=!!window.openSesameBridge?.available,agents=data?.agents||[],hasSnapshot=!!data;
    pane.dataset.stale=String(stale||!!error);
    el('agent-refresh').disabled=busy||!available;el('agent-refresh').classList.toggle('is-refreshing',busy);
    el('agent-connection').textContent=error|| (data?'Connected to '+data.machine+' · '+agents.length+' process'+(agents.length===1?'':'es'):available?'Discovering local agents…':'Open the desktop app to see local agent processes.');el('agent-connection').title=el('agent-connection').textContent;
    el('agent-action-status').textContent=actionMessage;
    const query=el('agent-search').value.trim().toLowerCase();
    const matching=agents.filter(a=>(terminalFilter==='all'||(['owned','tmux'].includes(a.terminal?.kind)?'linked':'unlinked')===terminalFilter)&&(projectOnly==='all'||projectFor(a)?.id===projectOnly)&&(providerFilter==='all'||a.provider===providerFilter)&&(!attentionOnly||activity(a)==='waiting')&&(!query||[a.name,a.pid,a.cwd,a.repository?.name,a.repository?.branch,projectFor(a)?.name].join(' ').toLowerCase().includes(query))).sort((a,b)=>sortBy==='name'?a.name.localeCompare(b.name):sortBy==='repo'?(a.repository?.name||'').localeCompare(b.repository?.name||''):sortBy==='cpu'?b.cpuPercent-a.cpuPercent:sortBy==='memory'?b.memoryMB-a.memoryMB:sortBy==='uptime'?b.uptimeSeconds-a.uptimeSeconds:(activity(b)==='waiting')-(activity(a)==='waiting')||(a.activity?.since||0)-(b.activity?.since||0));
    const processState=agent=>labels[agent.state]?agent.state:'unknown';
    for(const button of stateButtons){
      const value=button.dataset.state,count=value==='all'?matching.length:matching.filter(a=>processState(a)===value).length,active=filter===value;
      button.hidden=!['all','running','sleeping'].includes(value)&&!active&&!agents.some(a=>processState(a)===value);
      button.setAttribute('aria-pressed',String(active));button.tabIndex=active?0:-1;
      button.querySelector('.agent-filter-count').textContent=hasSnapshot?count:'—';
      button.title=hasSnapshot?(query?'Matching agents':'Agents')+' · '+(value==='all'?'all states':labels[value]):'Connect the desktop companion to see counts';
    }
    const shown=matching.filter(a=>filter==='all'||processState(a)===filter);
    const list=el('agent-cards'),scroll=list.scrollTop;list.replaceChildren(...shown.map(card));list.scrollTop=scroll;workspaceRender(shown);const historical=layout==='gantt'&&data?.history?.length;list.hidden=!shown.length&&!historical;el('agent-empty').hidden=!!shown.length||!!historical;
    const filtered=hasSnapshot&&agents.length>0&&!shown.length;
    el('agent-empty-title').textContent=filtered?'No matching processes':error?'Discovery is unavailable':hasSnapshot?'Ready when your agents are':'Your local agents, at a glance';
    el('agent-empty-description').textContent=filtered?'Clear the filters or try another name or PID.':error?'Refresh to try again. Your last snapshot stays visible while the connection recovers.':hasSnapshot?'Start an agent in your terminal to see it here. Pause, resume or stop a discovered process; use Familiars for conversations.':'Open Open Sesame Desktop to see CPU, memory and process state for agents running on this Mac.';
    el('agent-clear-filters').hidden=!query&&filter==='all';
    el('agent-desktop-download').hidden=available||filtered||hasSnapshot;
    el('agent-freshness').textContent=busy?'Refreshing…':(error||stale)&&data?'Last snapshot · '+new Date(lastSuccess).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):data?'Updated '+new Date(lastSuccess).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})+' · every 5s':error?'Discovery unavailable':'No machine connected';
  }
  async function refresh(){
    clearTimeout(timer);if(busy||document.hidden)return;
    if(!window.openSesameBridge?.available){if(data){error='Desktop companion disconnected.';stale=true}render();announce();return}
    const ticket=connection;busy=true;render();
    try{const result=await openSesameBridge.request('agents.snapshot',{screens:window.openSesameTerminalScreens?.()||{}});if(ticket!==connection||!openSesameBridge.available)return;if(!result||!Array.isArray(result.agents))throw new Error('Update your desktop companion to enable agent discovery.');data=result;if(confirmStop&&!result.agents.some(a=>a.pid===confirmStop.pid&&a.controlToken===confirmStop.token))confirmStop=null;lastSuccess=Date.now();error='';stale=false}
    catch(e){if(ticket===connection){error=e.message==='Invalid pane ID.'?'Update your desktop companion to enable agent discovery.':e.message||'Could not refresh agents.';stale=true}}
    finally{busy=false;render();announce();if(!document.hidden&&openSesameBridge.available)timer=setTimeout(refresh,5000)}
  }
  const status=element('p','agent-action-status');status.id='agent-action-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');pane.append(status);
  el('agent-refresh').addEventListener('click',refresh);el('agent-search').addEventListener('input',render);
  el('agent-clear-filters').addEventListener('click',()=>{el('agent-search').value='';filter='all';attentionOnly=false;providerFilter='all';providers.value='all';projectOnly='all';projectSelect.value='all';terminalFilter='all';terminals.value='all';render();el('agent-search').focus({preventScroll:true})});
  window.addEventListener('open-sesame-desktop-ready',refresh);
  window.addEventListener('open-sesame-desktop-disconnected',()=>{connection++;acting=0;confirmStop=null;clearTimeout(timer);error='Desktop connection closed. Reopen the app to reconnect.';stale=true;render();announce()});
  window.addEventListener('open-sesame-view-changed',()=>{if(state.scenario==='agent-monitor'){render();if(!data||Date.now()-lastSuccess>5000)refresh()}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(timer);stale=true;announce()}else refresh()});
  window.OpenSesameAgentMonitor={refresh,summary:()=>data&&!error?data.agents.length+' processes':'Processes'};
  render();window.openSesameBridge?.ready.then(refresh);
})();
