// The surfaces and states the rendered baseline covers. Functions run inside the isolated fixture frame.
// Add a surface here when one is introduced, so it is captured before its styling changes.
// A state may carry `seed`, run before the page loads in that state's own profile, and `hover`, a selector the pointer
// rests on for the capture. Each function is serialized into the page, so it must not use anything outside itself, and
// a seed also runs in sandboxed frames that have no storage, so it catches that.
const scenario=id=>changeScenario(id);

export const windowSizes=[[1180,740],[800,500],[560,360]];

export const surfaces=[
  {id:'focus',enter:scenario},
  {id:'music',enter:scenario},
  {id:'youtube',enter:scenario},
  {id:'media',enter:scenario},
  {id:'items',enter:scenario},
  {id:'reading',enter:scenario,ready:()=>!!document.getElementById('reading-article')},
  {id:'audio',enter:scenario},
  {id:'terminal',enter:scenario},
  {id:'remote',enter:scenario},
  {id:'familiars',enter:scenario},
  {id:'agent-monitor',enter:scenario},
  {id:'computer-agent',enter:scenario},
  {id:'plugins',enter:scenario},
];

export const widgetStates=[
  {id:'collapsed',enter:()=>{}},
  {id:'launcher',enter:()=>__fitCheck('launcher')},
  {id:'launcher-commands',enter:()=>{__fitCheck('launcher');__fitCheck('slash')}},
  {id:'launcher-calculation',enter:()=>{__fitCheck('launcher');__fitCheck('math')}},
  {id:'expanded-focus',enter:()=>__fitCheck('focus')},
  {id:'expanded-calendar',enter:()=>{__fitCheck('focus');document.querySelector('.focus-view-tabs>button:nth-child(2)').click()}},
  {id:'expanded-live',enter:()=>__fitCheck('live')},
  {id:'expanded-shell',enter:()=>__fitCheck('shell')},
  {id:'expanded-playlist',enter:()=>__fitCheck('playlist')},
  {id:'expanded-familiars',enter:()=>__fitCheck('familiars')},
  {id:'expanded-computer',enter:()=>__fitCheck('computer')},
  {id:'expanded-github',enter:()=>__fitCheck('app-github')},
  {id:'dialog-reader-add',enter:()=>__fitCheck('reader-add')},
  {id:'dialog-tools',enter:()=>__fitCheck('tools')},
  {id:'dialog-screen-notes',enter:()=>__fitCheck('screen-notes')},
  {id:'menu-options',enter:()=>{__fitCheck('focus');document.getElementById('widget-options-toggle').click()}},
  // The menu is placed from the control's box when it opens, so it opens once the pane has settled.
  {id:'menu-select',enter:()=>{__fitCheck('live');setTimeout(()=>document.getElementById('audio-language').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse'})),250)}},
  // Saved items, so the board lanes and item cards render.
  {id:'items-board',seed:()=>{try{localStorage.setItem('open-sesame-items-view-v1','board');localStorage.setItem('open-sesame-items-v1',JSON.stringify(['Draft the release notes','Review the capture matrix','Call the print shop','Sketch the onboarding flow','Renew the certificate','Read the accessibility report'].map((text,n)=>({id:'baseline-item-'+n,text,kind:n%2?'task':'note',done:n===4,created:1762250000000+n}))))}catch{}},enter:()=>{OpenSesameLauncher.close(true);state.size='max';changeScenario('items');document.querySelector('#items-view-switch button[data-view=board]').click()}},
  {id:'items-cards',seed:()=>{try{localStorage.setItem('open-sesame-items-view-v1','cards');localStorage.setItem('open-sesame-items-v1',JSON.stringify(['Draft the release notes','Review the capture matrix','Call the print shop','Sketch the onboarding flow','Renew the certificate','Read the accessibility report'].map((text,n)=>({id:'baseline-item-'+n,text,kind:n%2?'task':'note',done:n===4,created:1762250000000+n}))))}catch{}},enter:()=>{OpenSesameLauncher.close(true);state.size='max';changeScenario('items');document.querySelector('#items-view-switch button[data-view=cards]').click()}},
  // Two synthetic agent processes in the grid layout, so agent cards render. The reply replaces the fixture's empty one.
  {id:'processes-grid',seed:()=>{try{localStorage.setItem('open-sesame-process-view','grid')}catch{}},enter:()=>{
    const since=Date.now()-120000,agents=[{id:'one',pid:101,name:'Claude Code',provider:'claude',state:'sleeping',cpuPercent:0,memoryMB:123,uptimeSeconds:400,cwd:'/fixture/api',repository:{name:'api',root:'/fixture/api',branch:'feature/api'},activity:{state:'waiting',source:'fixture',since},terminal:{kind:'unavailable'}},{id:'two',pid:102,name:'Codex',provider:'codex',parentAgentPid:101,relationshipSource:'process-ancestry',state:'running',cpuPercent:15,memoryMB:200,uptimeSeconds:600,cwd:'/fixture/web',repository:{name:'web',root:'/fixture/web',branch:'main'},activity:{state:'working',source:'fixture'},terminal:{kind:'unavailable'}}];
    const handler=window.webkit.messageHandlers.openSesame,original=handler.postMessage;
    handler.postMessage=function(message){if(message.method!=='agents.snapshot')return original.call(this,message);queueMicrotask(()=>window.__openSesameReceive({requestId:message.requestId,result:{machine:'Fixture Mac',available:true,agents,history:[]}}))};
    OpenSesameLauncher.close(true);state.size='max';changeScenario('agent-monitor');document.getElementById('agent-refresh').click()}},
  // Pointer and keyboard states of the shared button and field rules.
  {id:'hover-quiet',enter:()=>__fitCheck('live'),hover:'#live-settings'},
  {id:'hover-secondary',enter:()=>__fitCheck('live'),hover:'#live-customize'},
  {id:'hover-primary',enter:()=>__fitCheck('focus'),hover:'#focus-start'},
  {id:'focus-field',enter:()=>{__fitCheck('app-github');setTimeout(()=>document.getElementById('github-monitor-search').focus(),300)}},
  {id:'focus-search',enter:()=>{OpenSesameLauncher.close(true);state.size='max';changeScenario('agent-monitor');setTimeout(()=>document.getElementById('agent-search').focus(),300)}},
  {id:'constrained-display',enter:()=>{__fitCheck('focus');__fitCheck('small')}},
];
