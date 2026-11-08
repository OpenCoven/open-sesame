'use strict';
const icons={plugins:'<path d="M9 3v4H5a2 2 0 0 0-2 2v3h3a2 2 0 0 1 0 4H3v3a2 2 0 0 0 2 2h4v-3a2 2 0 0 1 4 0v3h4a2 2 0 0 0 2-2v-4h-3a2 2 0 0 1 0-4h3V9a2 2 0 0 0-2-2h-4V3Z"/>','open-view':'<path d="M14 3h7v7m0-7-9 9M10 4H6a3 3 0 0 0-3 3v11a3 3 0 0 0 3 3h11a3 3 0 0 0 3-3v-4"/>',collection:'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',agents:'<rect x="5" y="6" width="14" height="14" rx="4"/><path d="M12 3v3M2 11v4m20-4v4M8 16h8"/><circle cx="9" cy="11" r=".7"/><circle cx="15" cy="11" r=".7"/>',flame:'<path d="M12 2c2 5-3 6-2 10 2 0 3-2 3-4 4 3 6 5 6 8a7 7 0 0 1-14 0c0-5 5-7 7-14Z"/>',popout:'<rect x="3" y="3" width="18" height="18" rx="4"/><rect x="11" y="11" width="8" height="8" rx="2"/><path d="m6 6 4 4M6 10V6h4"/>',rss:'<circle cx="5" cy="19" r="1"/><path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16"/>',more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',terminal:'<path d="m4 6 5 6-5 6m8 0h8"/>','rail-right':'<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M16 4v16"/>','rail-left':'<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 4v16"/>',items:'<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8m-8 4h8m-8 4h4"/>',task:'<rect x="4" y="4" width="16" height="16" rx="4"/><path d="m8 12 3 3 5-6"/>',mic:'<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>',stop:'<rect x="5" y="5" width="14" height="14" rx="2"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>','eye-off':'<path d="m3 3 18 18M10 5a12 12 0 0 1 11 7 14 14 0 0 1-4 5M6 6a14 14 0 0 0-5 6 12 12 0 0 0 14 6M10 10a3 3 0 0 0 4 4"/>',bookmark:'<path d="M6 3h12v18l-6-4-6 4V3Z"/>',folder:'<path d="M3 6h7l2 3h9v11H3V6Z"/>',trash:'<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',chat:'<path d="M21 11a8 8 0 0 1-8 8H7l-5 3 2-6a8 8 0 1 1 17-5Z"/><path d="M8 10h8m-8 4h5"/>',copy:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',link:'<path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 2 1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0"/>',lock:'<rect x="5" y="9" width="14" height="12" rx="3"/><path d="M8 9V6a4 4 0 0 1 8 0v3"/>',help:'<circle cx="12" cy="12" r="9"/><path d="M9.3 9a2.8 2.8 0 0 1 5.4 1c0 2-2.7 2-2.7 4m0 3h.01"/>',expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',collapse:'<path d="M5 5h14M7 15l5-5 5 5"/>',reset:'<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',music:'<path d="M9 17V5l11-2v12M9 9l11-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="17" cy="16" rx="3" ry="3"/>',focus:'<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2M10 1h4M19 4l2 2"/>',capture:'<path d="M14 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9M8 16l1-4L19 2l3 3-10 10-4 1Z"/>',chevron:'<path d="m9 6 6 6-6 6"/>',bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M9 21h6"/>',plus:'<path d="M12 5.5v13M5.5 12h13" stroke-linecap="round" stroke-width="1.75"/>',monitor:'<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M12 16v5m-4 0h8"/>',zoom:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M10 7v6m-3-3h6"/>',wifi:'<path d="M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0m-11 4a6 6 0 0 1 8 0m-4 4h.01"/>',battery:'<rect x="2" y="6" width="17" height="12" rx="3"/><path d="M22 10v4M5 9h10v6H5z" fill="currentColor"/>',search:'<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',sliders:'<path d="M5 3v4m0 4v10M12 3v10m0 4v4M19 3v2m0 4v12M2 7h6m1 6h6m1-8h6"/>',compass:'<circle cx="12" cy="12" r="10"/><path d="m16 8-2 6-6 2 2-6 6-2Z"/>',heart:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',previous:'<path d="M5 5v14m14-14v14L7 12 19 5Z"/>',next:'<path d="M19 5v14M5 5v14l12-7L5 5Z"/>',play:'<path d="m7 4 14 8-14 8V4Z"/>',pause:'<path d="M6 4h4v16H6zm8 0h4v16h-4z"/>',volume:'<path d="M3 9h4l5-4v14l-5-4H3V9Zm13-1a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',headphones:'<path d="M4 14v-3a8 8 0 0 1 16 0v3M4 12h3v9H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Zm16 0h-3v9h3a2 2 0 0 0 2-2v-5a2 2 0 0 0-2-2Z"/>',ruler:'<path d="m3 16 13-13 5 5L8 21l-5-5Zm8-8 2 2m1-5 2 2m-8 4 2 2m-5 1 2 2"/>',check:'<path d="m5 12 4 4L20 5"/>','arrow-up':'<path d="m6 10 6-6 6 6M12 4v16"/>','arrow-up-right':'<path d="M6 18 18 6M6 6h12v12"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',cursor:'<path d="m4 3 16 10-8 1-4 7L4 3Z"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>'};
const $=id=>document.getElementById(id);
const newId=()=>crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
const icon=(name)=>`<svg viewBox="0 0 24 24" data-glyph="${name}" aria-hidden="true">${icons[name]||icons.info}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
const defaults={layout:'notch',expanded:false,pinned:false,width:280,ratio:8,hover:false,playful:false,scenario:'focus',lockinView:'focus',agentsView:'familiars',resolution:'1512,982',volume:65,size:'medium',speakNotifications:true};
let saved={};try{saved=JSON.parse(localStorage.getItem('open-sesame-settings-v1')||'{}')}catch{}
const state={...defaults,...saved};
state.pinned=state.pinned===true;
state.layout=['notch','menu'].includes(state.layout)?state.layout:'notch';state.scenario=['capture','bookmarks'].includes(state.scenario)?'items':state.scenario;if(state.scenario==='chat')state.scenario='familiars';state.scenario=['music','focus','youtube','media','items','audio','terminal','remote','agent-monitor','familiars','reading','plugins'].includes(state.scenario)?state.scenario:'music';
const lockinViews=['music','focus','youtube','media'];
state.lockinView=lockinViews.includes(state.scenario)?state.scenario:lockinViews.includes(state.lockinView)?state.lockinView:'music';
const agentsViews=['terminal','remote','agent-monitor','familiars'];
state.agentsView=agentsViews.includes(state.scenario)?state.scenario:agentsViews.includes(state.agentsView)?state.agentsView:'terminal';
const activityFor=scenario=>lockinViews.includes(scenario)?'lockin':agentsViews.includes(scenario)?'agents':scenario;
delete state.focusOverview;state.playful=state.playful===true;state.size=OpenSesameFrameModel.keys.includes(state.size)?state.size:'medium';state.speakNotifications=state.speakNotifications!==false;
state.width=Math.max(180,Math.min(440,Number(state.width)||280));state.ratio=Math.max(5,Math.min(12,Number(state.ratio)||8));state.volume=Math.max(0,Math.min(100,Number(state.volume)||0));
state.resolution=['1280,800','1512,982','1728,1117','1920,1080'].includes(state.resolution)?state.resolution:defaults.resolution;
let inspecting=false,presenting=false,hoverTimer,toastTimer,notificationTimer,focusMinutes=25,focusRemaining=1500,focusRunning=false,focusEnd=0,items=[];
function pageUrl(raw){
  if(typeof raw!=='string'||!raw.trim())return '';
  const value=raw.trim(),explicitHttp=/^https?:\/\//i.test(value),hostPort=/^(?:localhost|[a-z0-9-]+(?:\.[a-z0-9-]+)+):\d+(?:[/?#]|$)/i.test(value);
  if(/[\s<>"'\\]/.test(value)||(!explicitHttp&&!hostPort&&/^[a-z][a-z0-9+.-]*:/i.test(value)))return '';
  try{const u=new URL(explicitHttp?value:value.startsWith('//')?'https:'+value:'https://'+value);const host=u.hostname;
    if(!explicitHttp&&host!=='localhost'&&!host.includes('.')&&!host.startsWith('['))return '';
    return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';
  }catch{return ''}
}
function inlineUrl(text){const match=text.match(/(?:https?:\/\/|www\.)[^\s<>"']+/i);return match?pageUrl(match[0].replace(/[.,!;]+$/,'')):''}
let itemsNeedMigration=false;
try{let n;const stored=localStorage.getItem('open-sesame-items-v1');try{n=stored===null?null:JSON.parse(stored)}catch{}if(!Array.isArray(n)){n=JSON.parse(localStorage.getItem('open-sesame-notes-v1')||'[]');itemsNeedMigration=true}if(Array.isArray(n))items=n.filter(n=>n&&typeof n.text==='string'&&typeof n.id==='string').slice(0,300).map(n=>{const url=typeof n.url==='string'?pageUrl(n.url):inlineUrl(n.text);return{...n,done:!!n.done,url,kind:['note','bookmark','task'].includes(n.kind)?(n.kind==='bookmark'&&!url?'note':n.kind):url?'bookmark':'note'}})}catch{}
let attachedUrl='',ignoredInlineUrl='';
let projects=[],libraryOpen=false,detailFullWidth=false,selectedItemId='',projectFilter='all',libraryQuery='',projectCreateForItem='',categoryFilter='all',itemsArchive=false;
const expandedCategories=new Set(['note']);
let itemsSearchOpen=false,itemsView='list';try{const view=localStorage.getItem('open-sesame-items-view-v1');if(['list','table','board','cards'].includes(view))itemsView=view}catch{}
let itemsPage=0,revealItem=false,bookmarkViewId='',bookmarkPreview=true;
const detailEditor=createPagedEditor('detail-body','Notes',text=>{const n=currentItem();if(n){n.body=text;saveDetail();window.OpenSesameNotes?.update(n.id,text)}}),transcriptEditor=createPagedEditor('audio-transcript','Transcript');
const itemCategories=[{kind:'note',label:'Notes',icon:'capture'},{kind:'bookmark',label:'Bookmarks',icon:'bookmark'},{kind:'task',label:'Tasks',icon:'task'}];
try{const p=JSON.parse(localStorage.getItem('open-sesame-projects-v1')||'[]');if(Array.isArray(p))projects=p.filter(p=>p&&typeof p.id==='string'&&typeof p.name==='string').slice(0,30)}catch{}
try {
  const savedProject = localStorage.getItem('open-sesame-current-project');
  if (savedProject === 'inbox' || projects.some(p=>p.id===savedProject)) projectFilter=savedProject;
} catch {}
let renderedProjectScope='';
function syncProjectScope() {
  const select=$('global-project-select'), name=projectFilter==='all'?'All projects':projectName(projectFilter);
  const choices=[['all','All projects'],['inbox','Inbox'],...projects.map(p=>[p.id,p.name]),['__new','New project…']];
  if(select.options.length!==choices.length || choices.some(([id,label],i)=>select.options[i]?.value!==id || select.options[i]?.textContent!==label))
    select.replaceChildren(...choices.map(([id,label])=>option(id,label)));
  select.value=projectFilter;
  $('global-project-name').textContent=name;
  select.parentElement.title='Switch project · '+name;
  if(renderedProjectScope===projectFilter)return;
  renderedProjectScope=projectFilter;
  $('capture-project').value=projects.some(p=>p.id===projectFilter)?projectFilter:'';
  try{localStorage.setItem('open-sesame-current-project',projectFilter)}catch{}
  window.dispatchEvent(new CustomEvent('open-sesame-project-scope',{detail:projectFilter}));
}
function switchProject(id) {
  if(id==='__new'){$('global-project-select').value=projectFilter;showProjectForm();return}
  if(!['all','inbox'].includes(id)&&!projects.some(p=>p.id===id))return;
  projectFilter=id;selectedItemId='';itemsPage=0;libraryQuery='';$('library-search').value='';
  itemsArchive=false;categoryFilter=window.OpenSesameProjects?.selected||'all';expandedCategories.clear();
  const first=activeItems().find(item=>inProject(item));
  expandedCategories.add(first?itemKind(first):'note');
  renderItems(); window.openSesameReading?.refreshView();
}
$('global-project-select').addEventListener('change',()=>switchProject($('global-project-select').value));
items=items.map(n=>({...n,title:typeof n.title==='string'?n.title:'',body:typeof n.body==='string'?n.body:'',projectId:projects.some(p=>p.id===n.projectId)?n.projectId:''}));
let focusTopics=[{id:'intention',name:'Set your intention',minutes:5},{id:'deep-work',name:'Deep work',minutes:15},{id:'wrap-up',name:'Wrap up',minutes:5}],lastFocusTopic='',focusElapsedMs=0,focusStartedAt=0,focusPage=0,focusPerPage=5;
try{const a=JSON.parse(localStorage.getItem('open-sesame-focus-agenda-v1')||'null');if(Array.isArray(a)&&a.length&&a.every(t=>t&&typeof t.name==='string'&&typeof t.id==='string'&&Number.isFinite(t.minutes)&&t.minutes>0))focusTopics=a}catch{}
{
  const total=focusTopics.reduce((sum,t)=>sum+t.minutes,0);let stored=0;try{stored=Number(localStorage.getItem('open-sesame-focus-duration-v1'))}catch{}
  focusMinutes=OpenSesameFocusCalendarModel.validDuration(stored)?stored:([15,20,25,30,45,60,90].find(m=>m>=total)||Math.min(1440,Math.ceil(total)));
  if(focusTopics.length>topicLimit(focusMinutes))focusMinutes=focusTopics.length<=10?30:Math.max(61,focusMinutes);
  allocateTopics(focusMinutes);focusRemaining=focusMinutes*60;
}


const persist=()=>{try{localStorage.setItem('open-sesame-settings-v1',JSON.stringify(state))}catch{toast('Settings could not be saved in this browser.')}};
const mark='<svg viewBox="0 0 36 24" aria-hidden="true"><use href="#open-sesame-mark"/></svg>';
const time=value=>{const n=Math.max(0,Math.ceil(value));return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`};
function fillRange(el){const value=100*(Number(el.value)-Number(el.min))/(Number(el.max)-Number(el.min));el.style.setProperty('--fill',value+'%')}
function toast(message){$('app-toast').textContent=message;$('app-toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('app-toast').hidden=true,2800)}
function frameScreen(){if(!window.__OPEN_SESAME_NATIVE__)return state.resolution.split(',').map(Number);const native=window.__OPEN_SESAME_SCREEN__;return Number.isFinite(native?.width)&&native.width>0&&Number.isFinite(native?.height)&&native.height>0?[native.width,native.height]:[window.screen.width||1512,window.screen.height||982]}
function expandedFrame(){if(window.OpenSesameWindow?.detached||(!window.__OPEN_SESAME_NATIVE__&&state.size==='full'))return {key:'full',name:'Full',width:window.innerWidth,height:window.innerHeight};return OpenSesameFrameModel.presets(...frameScreen()).find(size=>size.key===state.size)}
function renderCompact(){
  const width=state.width;
  if(state.scenario==='music'){$('compact-left').innerHTML=mark;$('compact-right').textContent=window.OpenSesameMusic?.summary()||'Music'}
  if(state.scenario==='focus'){$('compact-left').innerHTML=icon('focus');$('compact-right').textContent=time(focusRemaining)}
  if(['youtube','media'].includes(state.scenario)){$('compact-left').innerHTML=icon(state.scenario==='youtube'?'play':'music');$('compact-right').textContent=state.scenario==='youtube'?'YouTube':'Media'}
  if(state.scenario==='items'){$('compact-left').innerHTML=icon('items');$('compact-right').textContent=`${scopedItemCount()} items`}
  if(state.scenario==='audio'){$('compact-left').innerHTML=icon('mic');$('compact-right').textContent=document.body.classList.contains('audio-active')?($('audio-record').checked?'Recording':'Transcribing'):'Live'}
  if(state.scenario==='terminal'){$('compact-left').innerHTML=icon('terminal');$('compact-right').textContent=(window.openSesameTerminalCount?.()??1)+' panes'}
  if(state.scenario==='plugins'){$('compact-left').innerHTML=icon('plugins');$('compact-right').textContent='Plugins'}
  if(state.scenario==='reading'){$('compact-left').innerHTML=icon('rss');$('compact-right').textContent='Reading'}
  if(state.scenario==='familiars'){$('compact-left').innerHTML=icon('chat');$('compact-right').textContent=window.OpenSesameFamiliars?.summary()||'Familiars'}
  if(state.scenario==='agent-monitor'){$('compact-left').innerHTML=icon('agents');$('compact-right').textContent=window.OpenSesameAgentMonitor?.summary()||'Agents'}
  if(state.scenario==='remote'){$('compact-left').innerHTML=icon('monitor');$('compact-right').textContent='Remote'}
  $('compact-widget').setAttribute('aria-label',`${state.expanded?'Collapse':'Expand'} ${state.scenario} widget`);window.OpenSesameCompact?.sync();
}
function render(){
  document.querySelectorAll('[data-layout]').forEach(b=>{let yes=b.dataset.layout===state.layout;b.classList.toggle('selected',yes);b.setAttribute('aria-pressed',yes)});
  document.querySelectorAll('[data-state]').forEach(b=>{let yes=(b.dataset.state==='expanded')===state.expanded;b.classList.toggle('selected',yes);b.setAttribute('aria-pressed',yes)});
  document.querySelectorAll('[data-scenario]').forEach(b=>{let yes=b.dataset.scenario===activityFor(state.scenario);b.classList.toggle('selected',yes);b.setAttribute('aria-pressed',yes)});
  document.querySelectorAll('[data-tab]').forEach(b=>{let yes=b.dataset.tab===activityFor(state.scenario);b.setAttribute('aria-selected',yes);b.tabIndex=yes?0:-1});
  ['music','focus','youtube','media','items','audio','terminal','remote','agent-monitor','familiars','reading','plugins'].forEach(name=>$('pane-'+name).hidden=name!==state.scenario);
  $('agents-workspace').hidden=!agentsViews.includes(state.scenario);window.OpenSesameWorkspace?.sync();$('lockin-workspace').hidden=!lockinViews.includes(state.scenario);document.querySelectorAll('[data-lockin]').forEach(b=>{const active=b.dataset.lockin===state.scenario;b.setAttribute('aria-selected',active);b.tabIndex=active?0:-1});
  const wide=libraryOpen&&state.scenario==='items',terminalWide=['music','items','terminal','remote','agent-monitor','familiars','reading','youtube','media'].includes(state.scenario);
  const height=Math.round(state.width/state.ratio);
  const expandedScale=1.2;
  const {width:panelWidth,height:panelHeight}=expandedFrame();
  $('widget-anchor').className=`widget-anchor ${state.layout==='notch'?'notch-mode':'menu-mode'}${state.expanded?' expanded':''}${wide?' library-open':''}${state.playful?' playful-shape':''}${['focus','audio','terminal','remote','agent-monitor','familiars','reading','youtube','media'].includes(state.scenario)?' tall-panel':''}${state.scenario==='audio'?' audio-panel':''}${state.scenario==='focus'?' focus-panel':''}${terminalWide?' terminal-panel':''}${state.scenario==='terminal'?' terminal-active':''}${state.scenario==='familiars'?' familiars-active':''}${state.scenario==='reading'?' reading-active':''}${['youtube','media'].includes(state.scenario)?' lockin-player-active':''}`;
  $('widget-anchor').style.setProperty('--notch-width',state.width+'px');$('widget-anchor').style.setProperty('--notch-height',height+'px');$('widget-anchor').style.setProperty('--panel-width',panelWidth+'px');$('widget-anchor').style.setProperty('--panel-height',panelHeight+'px');$('widget-anchor').style.setProperty('--expanded-scale',expandedScale);
  $('widget-panel').hidden=!state.expanded;if(!state.expanded)closeUrlEditor();$('compact-widget').setAttribute('aria-expanded',state.expanded);$('compact-widget').tabIndex=state.expanded?-1:0;
  $('menu-trigger').hidden=state.layout!=='menu';$('menu-trigger').setAttribute('aria-expanded',state.expanded);
  $('notch-settings').hidden=state.layout!=='notch';$('menu-settings').hidden=state.layout!=='menu';$('geometry-tag').textContent=state.layout==='notch'?'NOTCH':'POPOVER';
  $('menu-settings').querySelector('.dimension-note span').textContent=`Panel · ${panelWidth} × ${panelHeight} px`;
  $('width').value=state.width;$('ratio').value=state.ratio;$('hover').checked=state.hover;$('speak-notifications').checked=state.speakNotifications;document.querySelectorAll('[data-widget-size]').forEach(b=>{const active=b.dataset.widgetSize===state.size;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',active)});$('playful-shape').checked=state.playful;$('desktop-size').value=state.resolution;
  $('width-value').innerHTML=`${state.width} <span>px</span>`;$('ratio-value').textContent=state.ratio.toFixed(1)+' : 1';$('dimension-note').textContent=`Compact footprint · ${state.width} × ${height} px`;
  $('footprint').textContent=state.expanded?`${panelWidth} × ${panelHeight} px`:state.layout==='notch'?`${state.width} × ${height} px`:'30 × 27 px';
  $('preview-hint').textContent=state.expanded?'Hold the widget to speak. Drag an edge to resize; shrink past Small to collapse.':state.layout==='notch'?'Click the notch to open your widget.':'Click the eyes in the menu bar to open your widget.';
  document.querySelectorAll('input[type=range]').forEach(fillRange);renderItems();renderCompact();fit();persist();detailEditor.layout();transcriptEditor.layout();syncNativeWindow();window.openSesameReading?.refreshView();window.OpenSesameFrame?.sync();window.OpenSesameWindow?.sync();window.dispatchEvent(new Event('open-sesame-layout'));renderDraft();
}
function compactFrame(){return window.OpenSesameCompact?.geometry?.()||{width:state.width,height:Math.round(state.width/state.ratio)}}
function syncNativeWindow(){if(!window.__OPEN_SESAME_NATIVE__||window.OpenSesameWindow?.detached)return;if(window.OpenSesameLauncher?.active){openSesameBridge.request('window.size',{...OpenSesameLauncher.nativeFrame(),expanded:true,layout:'capture',full:false}).catch(()=>{});return}const expanded=state.expanded;openSesameBridge.request('window.size',{width:expanded?parseFloat($('widget-anchor').style.getPropertyValue('--panel-width')):state.layout==='notch'?compactFrame().width:40,height:expanded?parseFloat($('widget-anchor').style.getPropertyValue('--panel-height')):state.layout==='notch'?compactFrame().height:32,expanded,layout:state.layout,full:expanded&&state.size==='full'}).catch(()=>{})}
function setExpanded(value,{focus=false}={}){clearTimeout(hoverTimer);state.expanded=window.OpenSesameWindow?.detached?true:value;render();if(focus&&value)$('tab-'+activityFor(state.scenario)).focus({preventScroll:true});if(focus&&!value)(state.layout==='notch'?$('compact-widget'):$('menu-trigger')).focus({preventScroll:true})}
function changeScenario(scenario,expand=true){state.scenario=scenario==='lockin'?state.lockinView:scenario==='agents'?state.agentsView:scenario;if(lockinViews.includes(state.scenario))state.lockinView=state.scenario;if(agentsViews.includes(state.scenario))state.agentsView=state.scenario;if(expand)state.expanded=true;render();window.dispatchEvent(new CustomEvent('open-sesame-view-changed'))}
function fit(){
  if(window.__OPEN_SESAME_NATIVE__||window.OpenSesameWindow?.detached||state.size==='full'||window.OpenSesameFrame?.dragging)return;
  const [w,h]=state.resolution.split(',').map(Number),well=$('preview-well'),frame=$('desktop-frame'),viewport=$('desktop-viewport'),desktop=$('desktop');
  desktop.style.width=w+'px';desktop.style.height=h+'px';desktop.classList.toggle('small-desktop',w<=1280);
  const frameStyle=getComputedStyle(frame),insetX=parseFloat(frameStyle.paddingLeft)+parseFloat(frameStyle.paddingRight),insetY=parseFloat(frameStyle.paddingTop)+parseFloat(frameStyle.paddingBottom),availableWidth=Math.max(0,well.clientWidth-insetX),availableHeight=Math.max(0,well.clientHeight-insetY);
  let scale;
  if(inspecting&&window.OpenSesameLauncher?.active){const anchor=$('widget-anchor');scale=Math.min(1,availableWidth/(anchor.offsetWidth+24),availableHeight/(anchor.offsetHeight+24));frame.style.width='100%';viewport.style.height=availableHeight+'px';desktop.style.transform=`translate(${availableWidth/2-w*scale/2}px,${availableHeight/2-h*scale/2}px) scale(${scale})`;$('scale-label').textContent=`Inspect · ${Math.round(scale*100)}%`;return}
  if(inspecting){frame.style.width='100%';viewport.style.height=availableHeight+'px';const pw=parseFloat($('widget-anchor').style.getPropertyValue('--panel-width')),ph=parseFloat($('widget-anchor').style.getPropertyValue('--panel-height'));scale=Math.min(1,(well.clientWidth-16)/(pw+16),availableHeight/(ph+(state.layout==='menu'?45:5)));const target=state.size==='full'||state.layout==='notch'?w/2:w-183-pw/2;let x=well.clientWidth/2-target*scale;x=w*scale<=well.clientWidth?(well.clientWidth-w*scale)/2:Math.max(well.clientWidth-w*scale,Math.min(0,x));desktop.style.transform=`translate(${x}px,0) scale(${scale})`;$('scale-label').textContent=`Inspect · ${Math.round(scale*100)}%`;}
  else{scale=presenting?Math.min(availableWidth/w,availableHeight/h):availableWidth/w;frame.style.width=presenting?(w*scale+insetX)+'px':'100%';viewport.style.height=(h*scale)+'px';desktop.style.transform=`scale(${scale})`;$('scale-label').textContent=`Fit · ${Math.round(scale*100)}%`;}
}
new ResizeObserver(fit).observe($('preview-well'));
document.querySelectorAll('[data-layout]').forEach(b=>b.addEventListener('click',()=>{state.layout=b.dataset.layout;render()}));
document.querySelectorAll('[data-state]').forEach(b=>b.addEventListener('click',()=>setExpanded(b.dataset.state==='expanded')));
document.querySelectorAll('[data-scenario]').forEach(b=>b.addEventListener('click',()=>changeScenario(b.dataset.scenario)));
function tabHome(tab){if(state.scenario==='items'&&window.OpenSesameNotes?.finish(false)===false)return;if(tab==='items'){itemsArchive=false;$('project-form').hidden=true;libraryOpen=false;detailFullWidth=false;selectedItemId='';categoryFilter=window.OpenSesameProjects?.selected||'note';libraryQuery='';itemsSearchOpen=false;itemsPage=0;expandedCategories.clear();expandedCategories.add(categoryFilter);$('library-search').value='';closeBookmarkUrl()}if(tab==='agents')state.agentsView='familiars';changeScenario(tab);window.dispatchEvent(new CustomEvent('open-sesame-home',{detail:tab}))}
document.querySelectorAll('[data-tab]').forEach(b=>{b.addEventListener('click',()=>tabHome(b.dataset.tab));b.addEventListener('keydown',e=>{const tabs=[...document.querySelectorAll('[data-tab]')],i=tabs.indexOf(b);let n;if(e.key==='ArrowDown')n=(i+1)%tabs.length;if(e.key==='ArrowUp')n=(i+tabs.length-1)%tabs.length;if(e.key==='Home')n=0;if(e.key==='End')n=tabs.length-1;if(n!==undefined){e.preventDefault();changeScenario(tabs[n].dataset.tab);tabs[n].focus()}})});
document.querySelectorAll('[data-widget-size]').forEach(b=>b.addEventListener('click',()=>{state.size=b.dataset.widgetSize;render()}));
$('speak-notifications').addEventListener('change',()=>{state.speakNotifications=$('speak-notifications').checked;persist();if(state.speakNotifications)window.openSesameSpeech?.speak('Spoken notifications enabled.','notification')});
$('playful-shape').addEventListener('change',()=>{state.playful=$('playful-shape').checked;render()});
$('width').addEventListener('input',e=>{state.width=Number(e.target.value);render()});$('ratio').addEventListener('input',e=>{state.ratio=Number(e.target.value);render()});$('hover').addEventListener('change',e=>{state.hover=e.target.checked;persist()});$('desktop-size').addEventListener('change',e=>{state.resolution=e.target.value;render()});
$('compact-widget').addEventListener('click',()=>setExpanded(true,{focus:true}));$('menu-trigger').addEventListener('click',()=>setExpanded(!state.expanded,{focus:true}));$('panel-close').addEventListener('click',()=>setExpanded(false,{focus:true}));
const hoverOpen=()=>{clearTimeout(hoverTimer);if(state.hover&&!state.expanded&&$('compact-media-controls').hidden)hoverTimer=setTimeout(()=>setExpanded(true),220)};
$('widget-anchor').addEventListener('pointerenter',hoverOpen);$('menu-trigger').addEventListener('pointerenter',hoverOpen);
$('widget-anchor').addEventListener('pointerleave',()=>{clearTimeout(hoverTimer);if(!state.pinned&&!window.OpenSesameFrame?.dragging&&state.hover&&!$('widget-anchor').contains(document.activeElement))hoverTimer=setTimeout(()=>setExpanded(false),600)});
$('menu-trigger').addEventListener('pointerleave',()=>clearTimeout(hoverTimer));
$('zoom').addEventListener('click',()=>{inspecting=!inspecting;document.body.classList.toggle('inspecting',inspecting);$('zoom').setAttribute('aria-pressed',inspecting);$('zoom').querySelector('span').textContent=inspecting?'Fit desktop':'Inspect';fit()});
function present(value){presenting=value;document.body.classList.toggle('presenting',value);$('exit-present').hidden=!value;requestAnimationFrame(fit)}
$('present').addEventListener('click',()=>present(true));$('exit-present').addEventListener('click',()=>present(false));
function renderMusic(){renderCompact()}
function topicLimit(minutes=focusMinutes){return minutes<=25?5:minutes<=60?10:Infinity}
function allocateTopics(minutes,lockedId='',lockedMinutes=0){
  const total=minutes*60,min=Math.min(1,total/focusTopics.length),others=focusTopics.filter(t=>t.id!==lockedId);let remaining=total;
  if(lockedId){const locked=focusTopics.find(t=>t.id===lockedId);if(locked){const seconds=Math.max(min,Math.min(total-min*others.length,Number(lockedMinutes)*60||min));locked.minutes=seconds/60;remaining-=seconds}}
  const entries=lockedId?others:focusTopics;let weight=entries.reduce((s,t)=>s+t.minutes,0);
  entries.forEach((t,i)=>{const seconds=i===entries.length-1?remaining:Math.max(min,Math.min(remaining-min*(entries.length-i-1),Math.round(remaining*t.minutes/weight)));weight-=t.minutes;t.minutes=seconds/60;remaining-=seconds});
}
function renderAgendaList(){
  const list=$('focus-topic-list'),timeline=$('agenda-timeline');list.replaceChildren();timeline.replaceChildren();focusPage=Math.max(0,Math.min(focusPage,Math.ceil(focusTopics.length/focusPerPage)-1));
  focusTopics.slice(focusPage*focusPerPage,focusPage*focusPerPage+focusPerPage).forEach((t,offset)=>{
    const i=focusPage*focusPerPage+offset,row=document.createElement('div');row.className='focus-topic';row.dataset.topicId=t.id;row.dataset.topicIndex=i;
    const index=document.createElement('span');index.className='topic-index';index.textContent=String(i+1).padStart(2,'0');
    const name=document.createElement('input');name.value=t.name;name.maxLength=60;name.setAttribute('aria-label','Focus topic '+(i+1));name.addEventListener('change',()=>{t.name=name.value.trim()||'Untitled topic';saveAgenda()});
    const duration=document.createElement('input');duration.type='number';duration.min=.01;duration.step='any';duration.value=Number(t.minutes.toFixed(3));duration.setAttribute('aria-label','Minutes for topic '+(i+1));duration.addEventListener('change',()=>saveAgenda(t.id,Number(duration.value)));
    const unit=document.createElement('small');unit.textContent='min';
    const remove=document.createElement('button');remove.innerHTML=icon('close');remove.setAttribute('aria-label','Remove focus topic '+(i+1));remove.addEventListener('click',()=>{if(focusRunning||focusTopics.length<=1)return;focusTopics=focusTopics.filter(x=>x.id!==t.id);saveAgenda()});
    row.append(index,name,duration,unit,remove);list.append(row);
  });
  focusTopics.forEach(t=>{const segment=document.createElement('span');segment.style.flex=t.minutes;segment.title=t.name+' · '+time(t.minutes*60);segment.dataset.topicId=t.id;segment.append(document.createElement('b'));timeline.append(segment)});
}
function saveAgenda(lockedId='',lockedMinutes=0){
  window.dispatchEvent(new Event('open-sesame-focus-reset'));
  allocateTopics(focusMinutes,lockedId,lockedMinutes);
  try{localStorage.setItem('open-sesame-focus-agenda-v1',JSON.stringify(focusTopics));localStorage.setItem('open-sesame-focus-duration-v1',String(focusMinutes))}catch{toast('The focus plan could not be saved on this device.')}
  focusRunning=false;focusElapsedMs=0;focusRemaining=focusMinutes*60;lastFocusTopic='';renderAgendaList();renderFocus();
}
function setFocusDuration(minutes){
  if(focusRunning)return false;if(!OpenSesameFocusCalendarModel.validDuration(minutes)){renderFocus();return false}
  const max=topicLimit(minutes);if(focusTopics.length>max){toast('This plan has '+focusTopics.length+' topics. Remove '+(focusTopics.length-max)+' before choosing '+minutes+' minutes.');renderFocus();return false}
  focusMinutes=minutes;focusPage=0;saveAgenda();return true;
}
function agendaPosition(){
  const elapsed=Math.max(0,focusMinutes*60-focusRemaining);let before=0,index=focusTopics.length-1;
  for(let i=0;i<focusTopics.length;i++){if(elapsed<before+focusTopics[i].minutes*60-.001){index=i;break}before+=focusTopics[i].minutes*60}
  const start=focusTopics.slice(0,index).reduce((s,t)=>s+t.minutes*60,0);return{elapsed,index,start,end:start+focusTopics[index].minutes*60};
}
function renderFocus(){
  $('focus-topic-list').style.height=(Math.min(focusPerPage,focusTopics.length-focusPage*focusPerPage)*26)+'px';
  const str=time(focusRemaining).split(':'),p=agendaPosition(),topic=focusTopics[p.index],limit=topicLimit(),capped=focusTopics.length>=limit;
  if(focusRunning&&lastFocusTopic!==topic.id&&Math.floor(p.index/focusPerPage)!==focusPage){focusPage=Math.floor(p.index/focusPerPage);renderAgendaList();$('focus-topic-list').style.height=(Math.min(focusPerPage,focusTopics.length-focusPage*focusPerPage)*26)+'px'}
  // Size for the longest time in this session so the clock stays steady across minute boundaries.
  const minuteDigits=Math.max(2,String(focusMinutes).length);
  $('timer-value').style.setProperty('--timer-em-width',String((minuteDigits+2)*0.64+0.30));
  $('timer-value').innerHTML=`${str[0].padStart(2,'0')}<span>:</span>${str[1]}`;
  $('focus-start').innerHTML=icon(focusRunning?'pause':'play')+`<span>${focusRunning?'Pause':focusRemaining===0?'Start again':focusRemaining<focusMinutes*60?'Resume':'Start focus'}</span>`;
  $('focus-start').setAttribute('aria-label',$('focus-start').textContent.trim());$('focus-start').title=$('focus-start').textContent.trim();
  $('focus-status').textContent=focusRunning?'One topic at a time':focusRemaining===0?'A moment well spent':'Your focus plan';
  $('focus-current-label').textContent=focusRemaining===0?'COMPLETE':focusRunning?'NOW':p.elapsed?'PAUSED':'UP FIRST';$('focus-current-topic').textContent=focusRemaining===0?'You made room for it.':topic.name;
  $('focus-topic-remaining').textContent=focusRemaining===0?'Take a well-earned break.':time(Math.max(0,p.end-p.elapsed))+' on this topic';
  $('agenda-elapsed').textContent=time(Math.floor((focusElapsedMs+(focusRunning?Date.now()-focusStartedAt:0))/1000))+' elapsed';$('agenda-total').textContent=time(focusMinutes*60)+' total';
  $('focus-description').textContent=focusRunning?(focusTopics[p.index+1]?'Next: '+focusTopics[p.index+1].name:'Your last topic. You’ve got this.'):capped?'Topic limit reached for this period.':'Topic minutes share this focus period.';
  $('focus-progress').style.width=(100-100*focusRemaining/(focusMinutes*60))+'%';
  window.OpenSesameFocusControls?.sync();
  document.querySelectorAll('.focus-topic').forEach(row=>{const i=Number(row.dataset.topicIndex);row.classList.toggle('current',focusRemaining>0&&i===p.index&&(focusRunning||p.elapsed>0));row.classList.toggle('finished',focusRemaining===0||i<p.index);row.querySelectorAll('input,button').forEach(c=>c.disabled=focusRunning||(c.tagName==='BUTTON'&&focusTopics.length<=1))});
  let before=0;[...$('agenda-timeline').children].forEach((segment,i)=>{const duration=focusTopics[i].minutes*60;segment.firstElementChild.style.width=Math.max(0,Math.min(100,100*(p.elapsed-before)/duration))+'%';segment.classList.toggle('current',focusRemaining>0&&i===p.index);before+=duration});
  $('topic-name').disabled=focusRunning||capped;$('topic-minutes').disabled=focusRunning||capped;$('topic-form').querySelector('button').disabled=focusRunning||capped;$('focus-next').disabled=focusRemaining===0;
  const pages=Math.ceil(focusTopics.length/focusPerPage);$('focus-topic-count').textContent=focusTopics.length+(limit===Infinity?' topics · no limit':' / '+limit+' topics');$('focus-page-label').textContent=(focusPage+1)+' / '+pages;$('focus-page-prev').disabled=focusPage===0;$('focus-page-next').disabled=focusPage>=pages-1;
  if(focusRunning&&lastFocusTopic&&lastFocusTopic!==topic.id)notification('Time to move on',topic.name+' · '+time(topic.minutes*60));lastFocusTopic=topic.id;if(state.scenario==='focus')renderCompact();window.OpenSesameFocusCalendar?.sync();
}
$('topic-form').addEventListener('submit',e=>{e.preventDefault();if(focusRunning||focusTopics.length>=topicLimit())return;const name=$('topic-name').value.trim();if(!name)return;const t={id:newId(),name,minutes:Math.max(1/60,Number($('topic-minutes').value)||5)};focusTopics.push(t);focusPage=Math.floor((focusTopics.length-1)/focusPerPage);$('topic-name').value='';saveAgenda(t.id,t.minutes)});
$('focus-page-prev').addEventListener('click',()=>{if(focusPage>0){focusPage--;renderAgendaList();renderFocus()}});$('focus-page-next').addEventListener('click',()=>{if((focusPage+1)*focusPerPage<focusTopics.length){focusPage++;renderAgendaList();renderFocus()}});
$('focus-next').addEventListener('click',()=>{const p=agendaPosition();focusRemaining=Math.max(0,Math.round(focusMinutes*60-p.end));if(focusRemaining===0){if(focusRunning)focusElapsedMs+=Date.now()-focusStartedAt;focusRunning=false;notification('Focus plan complete','A little progress on every topic. Take a breath.')}else if(focusRunning)focusEnd=Date.now()+focusRemaining*1000;focusPage=Math.floor(agendaPosition().index/focusPerPage);renderAgendaList();renderFocus()});
$('focus-start').addEventListener('click',()=>{if(!focusRunning){if(focusRemaining===0){focusRemaining=focusMinutes*60;focusElapsedMs=0}focusEnd=Date.now()+focusRemaining*1000;focusStartedAt=Date.now();focusRunning=true;focusPage=Math.floor(agendaPosition().index/focusPerPage);renderAgendaList()}else{focusRemaining=Math.max(0,Math.ceil((focusEnd-Date.now())/1000));focusElapsedMs+=Date.now()-focusStartedAt;focusRunning=false}renderFocus()});
function fitFocusTopics(){
  const pane=$('pane-focus');if(pane.dataset?.focusView==='calendar')return;if(!state.expanded||state.scenario!=='focus'||!pane.clientHeight)return;
  const css=getComputedStyle(pane);
  const topics=$('focus-topic-list'),clock=$('focus-clock-row');
  const fixedChildren=[...pane.children].filter(child=>child!==topics&&child!==clock&&getComputedStyle(child).display!=='none');
  const fixedHeight=fixedChildren.reduce((sum,child)=>{
    const style=getComputedStyle(child);
    return sum+child.offsetHeight+(parseFloat(style.marginTop)||0)+(parseFloat(style.marginBottom)||0);
  },0);
  const gaps=(parseFloat(css.rowGap)||0)*(fixedChildren.length+1);
  const padding=(parseFloat(css.paddingTop)||0)+(parseFloat(css.paddingBottom)||0);
  // Reserve a readable clock independently of its current flex height. Measuring the
  // expanded clock would prevent additional rows from appearing when the widget grows.
  const clockBudget=Math.max(112,pane.clientHeight*0.32);
  const reserved=fixedHeight+gaps+padding+clockBudget;
  const capacity=OpenSesameFrameModel.capacity(pane.clientHeight,reserved);
  if(capacity!==focusPerPage){const index=focusRunning?agendaPosition().index:focusPage*focusPerPage;focusPerPage=capacity;focusPage=Math.floor(index/capacity);renderAgendaList();renderFocus()}
}
new ResizeObserver(fitFocusTopics).observe($('pane-focus'));window.addEventListener('open-sesame-layout',()=>requestAnimationFrame(fitFocusTopics));
function resetFocus(){window.dispatchEvent(new Event('open-sesame-focus-reset'));focusElapsedMs=0;focusRunning=false;focusRemaining=focusMinutes*60;lastFocusTopic='';focusPage=0;renderAgendaList();renderFocus()}
$('timer-reset').addEventListener('click',resetFocus);
function saveItems(){
  try{localStorage.setItem('open-sesame-items-v1',JSON.stringify(items));return true}catch{toast('Couldn’t save on this device. Your draft is still here.');return false}
}
function itemKind(n){return n.kind|| (n.url?'bookmark':'note')}
function thoughtTitle(n){
  if(n.title)return n.title;if(!n.url)return n.text||'Untitled '+itemKind(n);
  const cleaned=n.text.replace(/https?:\/\/[^\s<>"']+/ig,'').trim();if(cleaned)return cleaned;
  const u=new URL(n.url);return u.hostname.replace(/^www\./,'')+(u.pathname==='/'?'':u.pathname);
}
function inProject(n,id=projectFilter){return id==='all'||(id==='inbox'?!n.projectId:n.projectId===id)}
function activeItems(){return items.filter(n=>!OpenSesameItemWorkflow.isArchived(n))}
function scopedItemCount(){return activeItems().filter(n=>inProject(n)).length}
function collectionItems(){return items.filter(n=>OpenSesameItemWorkflow.isArchived(n)===itemsArchive)}
function setItemStatus(n,value){const patch=OpenSesameItemWorkflow.patch(n,value);if(!patch)return false;const previous={...n};Object.assign(n,patch);if(!saveItems()){for(const key of Object.keys(n))if(!Object.hasOwn(previous,key))delete n[key];Object.assign(n,previous);return false}renderItems();if(value==='done')toast('Archived. Recover it from View → Archived items.');else if(value==='restore')toast('Item restored to '+OpenSesameItemWorkflow.label(n)+'.');return true}
function filteredItems(){const q=libraryQuery.trim().toLowerCase();return collectionItems().filter(n=>(categoryFilter==='all'||itemKind(n)===categoryFilter)&&inProject(n)&&(!q||(thoughtTitle(n)+' '+n.body+' '+n.url).toLowerCase().includes(q))).slice().reverse()}
function projectName(id){return projects.find(p=>p.id===id)?.name||'Inbox'}
function option(value,label){const o=document.createElement('option');o.value=value;o.textContent=label;return o}
function renderProjectSelectors(){
  const value=$('capture-project').value;
  $('category-filter').value=categoryFilter;
  $('project-filter').replaceChildren(option('all','All projects'),option('inbox','Inbox'),...projects.map(p=>option(p.id,p.name)));$('project-filter').value=projectFilter;
  $('capture-project').replaceChildren(option('','Inbox'),...projects.map(p=>option(p.id,p.name)),option('__new','+ New project'));$('capture-project').value=projects.some(p=>p.id===value)?value:(!['all','inbox'].includes(projectFilter)?projectFilter:'');
  $('detail-project').replaceChildren(option('','Inbox'),...projects.map(p=>option(p.id,p.name)),option('__new','+ New project'));$('detail-project').value=currentItem()?.projectId||'';window.OpenSesameItemHeader?.sync();
}
function selectCollection(kind,project=projectFilter){categoryFilter=kind;projectFilter=project;selectedItemId='';itemsPage=0;$('capture-project').value=['all','inbox'].includes(project)?'':project;if(kind!=='all')expandedCategories.add(kind);renderItems()}
function renderProjectRail(){
  const all=categoryFilter==='all';$('rail-all-count').textContent=collectionItems().filter(n=>inProject(n)).length;$('rail-all').classList.toggle('selected',all);$('rail-all').setAttribute('aria-pressed',all);
}
function itemRow(n){
  const row=document.createElement('div'),kind=itemKind(n),task=kind==='task',title=thoughtTitle(n);row.className='capture-item'+(task&&OpenSesameItemWorkflow.isArchived(n)?' done':'')+(libraryOpen&&n.id===selectedItemId?' active':'');row.dataset.itemId=n.id;row.dataset.kind=kind;row.setAttribute('role','listitem');
  const control=document.createElement('button');control.type='button';control.className=task?'item-check':'item-kind';control.innerHTML=task?(OpenSesameItemWorkflow.isArchived(n)?icon('check'):''):icon(kind==='bookmark'?'bookmark':'capture');
  control.setAttribute('aria-label',task?(OpenSesameItemWorkflow.isArchived(n)?'Restore task: ':'Complete and archive task: ')+title:'Open '+kind+': '+title);if(task)control.setAttribute('aria-pressed',OpenSesameItemWorkflow.isArchived(n));
  control.addEventListener('click',()=>{if(!task){openItem(n.id);return}setItemStatus(n,OpenSesameItemWorkflow.isArchived(n)?'restore':'done');[...$('capture-list').querySelectorAll('[data-item-id]')].find(el=>el.dataset.itemId===n.id)?.querySelector('button')?.focus({preventScroll:true})});
  const content=document.createElement('button');content.type='button';content.className='thought-content';content.title=title;content.setAttribute('aria-label',(kind==='bookmark'?'Preview bookmark: ':'Open '+kind+': ')+title);if(libraryOpen&&n.id===selectedItemId)content.setAttribute('aria-current','true');content.addEventListener('click',()=>openItem(n.id));const label=document.createElement('span');label.className='thought-text';label.textContent=title;const meta=document.createElement('small');meta.className='thought-url';
  const project=projectFilter==='all'?projectName(n.projectId):'',domain=kind==='bookmark'?new URL(n.url).hostname.replace(/^www\./,''):'';
  meta.textContent=kind==='bookmark'?[title.toLowerCase()===domain.toLowerCase()?'':domain,project].filter(Boolean).join(' · '):task?[OpenSesameItemWorkflow.label(n),project].filter(Boolean).join(' · '):n.body?OpenSesameItemWorkflow.excerpt(n.body):project;
  meta.hidden=!meta.textContent;content.title=[title,meta.textContent].filter(Boolean).join(' · ');content.append(label,meta);
  const remove=document.createElement('button');remove.className='delete-thought';remove.innerHTML=icon('trash');remove.setAttribute('aria-label','Delete '+kind+': '+title);remove.addEventListener('click',()=>deleteItem(n.id));row.append(control,content,remove);return row;
}
function renderItemsPage(visible=filteredItems()){
  const list=$('capture-list');if(!list.clientHeight)return;list.classList.remove('category-overview');window.OpenSesameItemViews?.sync();if(!libraryOpen&&itemsView!=='list'&&window.OpenSesameItemViews){OpenSesameItemViews.render(visible);return}list.dataset.view='list';list.setAttribute('role','list');list.replaceChildren();
  if(!libraryOpen&&categoryFilter==='all'&&!libraryQuery&&!expandedCategories.size&&!window.OpenSesameProjects?.flatCollections){
    list.classList.add('category-overview');
    for(const category of itemCategories){
      const entries=visible.filter(n=>itemKind(n)===category.kind),button=document.createElement('button');
      button.id='item-group-'+category.kind;button.className='category-overview-card';button.dataset.kind=category.kind;button.setAttribute('aria-expanded','false');button.setAttribute('aria-label',category.label+' · '+entries.length+' items');
      const symbol=document.createElement('i'),body=document.createElement('span'),title=document.createElement('strong'),preview=document.createElement('small'),count=document.createElement('b'),arrow=document.createElement('i');
      symbol.className='category-overview-icon';symbol.innerHTML=icon(category.icon);title.textContent=category.label;preview.textContent=entries.slice(0,3).map(thoughtTitle).join(' · ')||({note:'A place for your next idea.',bookmark:'Keep useful links close.',task:'Ready for what comes next.'}[category.kind]);
      body.className='category-overview-copy';body.append(title,preview);count.textContent=entries.length;count.className='category-overview-count';arrow.innerHTML=icon('chevron');button.append(symbol,body,count,arrow);button.addEventListener('click',()=>toggleItemCategory(category.kind));list.append(button);
    }
    $('items-page-summary').textContent=visible.length+' items · 3 categories';$('items-page-label').textContent='1 / 1';$('items-page-prev').disabled=true;$('items-page-next').disabled=true;return;
  }
  const sizes=getComputedStyle(list),height=list.clientHeight-2, rowHeight=libraryOpen?railRowHeight(list):parseFloat(sizes.getPropertyValue('--project-row-height'))||38;
  const headerHeight=libraryOpen?(parseFloat(sizes.getPropertyValue('--rail-header-height'))||rowHeight):parseFloat(sizes.getPropertyValue('--project-header-height'))||24, pages=[[]];
  let used=0,activeCategory=null;
  const nextPage=()=>{pages.push([]);used=0};
  function add(entry,size) {
    if(used+size>height && pages.at(-1).length){
      nextPage();
      if(activeCategory && entry.type==='item' && height>=headerHeight+size){
        pages.at(-1).push({type:'category',category:activeCategory});used+=headerHeight;
      }
    }
    pages.at(-1).push(entry); used+=size;
  }
  if(categoryFilter==='all'&&!libraryQuery&&!window.OpenSesameProjects?.flatCollections){
    for(const category of itemCategories){
      activeCategory=category;
      const entries=visible.filter(n=>itemKind(n)===category.kind),open=expandedCategories.has(category.kind);
      if(pages.at(-1).length && used+headerHeight+(open?rowHeight:0)>height)nextPage();
      add({type:'category',category},headerHeight);
      if(open){
        for(const item of entries)add({type:'item',item},rowHeight);
        if(!entries.length)add({type:'empty'},24);
      }
    }
  }else for(const item of visible)add({type:'item',item},rowHeight);
  if(revealItem){const target=pages.findIndex(page=>page.some(e=>e.item?.id===selectedItemId));if(target>=0)itemsPage=target;revealItem=false}itemsPage=Math.max(0,Math.min(itemsPage,pages.length-1));
  pages[itemsPage].forEach(entry=>{if(entry.type==='item'){list.append(itemRow(entry.item));return}if(entry.type==='empty'){const e=document.createElement('span');e.className='category-empty';e.textContent='Nothing here yet.';list.append(e);return}const category=entry.category,open=expandedCategories.has(category.kind),entries=visible.filter(n=>itemKind(n)===category.kind);const header=document.createElement('button');header.id='item-group-'+category.kind;header.className='item-group-toggle';header.dataset.kind=category.kind;header.setAttribute('aria-expanded',open);header.setAttribute('aria-label',category.label+' · '+entries.length+' item'+(entries.length===1?'':'s'));header.innerHTML=icon('chevron')+icon(category.icon);const label=document.createElement('span');label.textContent=category.label;const count=document.createElement('small');count.textContent=entries.length;header.append(label,count);header.addEventListener('click',()=>toggleItemCategory(category.kind));list.append(header)});
  if(!visible.length&&categoryFilter!=='all'){const empty=document.createElement('div');empty.className='capture-empty';const title=document.createElement('strong');title.textContent=libraryQuery?'No matching items.':'A little room for something new.';const hint=document.createElement('span');hint.textContent=libraryQuery?'Try another word, category, or project.':'Capture an item below.';empty.append(title,hint);list.append(empty)}
  const displayed=pages[itemsPage].filter(e=>e.type==='item'),pageItems=pages.flat().filter(e=>e.type==='item').length,before=pages.slice(0,itemsPage).flat().filter(e=>e.type==='item').length;$('items-page-summary').textContent=displayed.length?(before+1)+'–'+(before+displayed.length)+' of '+pageItems:'0 visible';$('items-page-summary').title=pageItems+' visible in expanded categories · '+visible.length+' total';$('items-page-label').textContent=(itemsPage+1)+' / '+pages.length;$('items-page-prev').disabled=itemsPage===0;$('items-page-next').disabled=itemsPage>=pages.length-1;list.scrollTop=0;
}
$('items-page-prev').addEventListener('click',()=>{itemsPage--;renderItemsPage()});$('items-page-next').addEventListener('click',()=>{itemsPage++;renderItemsPage()});
new ResizeObserver(()=>{if(state.scenario==='items'&&state.expanded)renderItemsPage()}).observe($('capture-list'));

function toggleItemCategory(kind){
  const open=expandedCategories.has(kind);
  if(libraryOpen){expandedCategories.clear();if(!open)expandedCategories.add(kind);itemsPage=0;selectedItemId=open?'':filteredItems().find(n=>itemKind(n)===kind)?.id||'';renderItems()}
  else{open?expandedCategories.delete(kind):expandedCategories.add(kind);renderItems({detail:false})}
  $('item-group-'+kind)?.focus({preventScroll:true});
}
function renderItems({detail=true}={}){
  syncProjectScope();
  window.OpenSesameBookmarks?.sync();
  const visible=filteredItems(),list=$('capture-list');list.replaceChildren();
  if(libraryOpen&&categoryFilter==='all'&&expandedCategories.size>1){const selected=visible.find(n=>n.id===selectedItemId),kind=selected&&expandedCategories.has(itemKind(selected))?itemKind(selected):expandedCategories.values().next().value;expandedCategories.clear();expandedCategories.add(kind)}
  const selectable=categoryFilter==='all'&&!libraryQuery&&!window.OpenSesameProjects?.flatCollections?visible.filter(n=>expandedCategories.has(itemKind(n))):visible;
  if(libraryOpen&&detail&&!selectable.some(n=>n.id===selectedItemId))selectedItemId=selectable[0]?.id||'';
  renderProjectSelectors();renderProjectRail();
  $('collection-title').textContent=itemsArchive?'Archived':'Items';$('items-archive-back').hidden=!itemsArchive;$('capture-list-summary').textContent=visible.length+' '+(categoryFilter==='all'?'item'+(visible.length===1?'':'s'):visible.length===1?categoryFilter:itemCategories.find(c=>c.kind===categoryFilter).label.toLowerCase());
  window.OpenSesameItemViews?.sync();$('capture-list').setAttribute('aria-label',itemsArchive?'Archived items':'Saved items');$('library-toggle').setAttribute('aria-label','Collapse to Projects overview');$('library-toggle').title='Collapse to Projects overview';$('library-toggle').innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 5h14M7 15l5-5 5 5"/></svg>';
  $('project-rail').hidden=!libraryOpen;$('note-detail').hidden=!libraryOpen;syncDetailWidth();
  renderItemsPage(visible);
  const count=scopedItemCount();$('capture-count').textContent=count+' item'+(count===1?'':'s');list.scrollTop=0;
  if(libraryOpen&&detail)renderDetail();if(state.scenario==='items')renderCompact();window.OpenSesameProjects?.sync();
}
function openItem(id){if(window.OpenSesameNotes?.finish(false)===false)return;selectedItemId=id;revealItem=true;const item=currentItem();if(item){itemsArchive=OpenSesameItemWorkflow.isArchived(item);expandedCategories.clear();expandedCategories.add(itemKind(item));}libraryOpen=true;render();$('detail-title').focus({preventScroll:true})}
function deleteItem(id){items=items.filter(n=>n.id!==id);if(selectedItemId===id)selectedItemId='';saveItems();renderItems();toast('Item removed.')}
function currentItem(){return items.find(n=>n.id===selectedItemId)}
function syncDetailWidth(){
  if(!libraryOpen||!currentItem())detailFullWidth=false;
  const full=libraryOpen&&state.scenario==='items'&&detailFullWidth,button=$('detail-width-toggle');
  $('widget-anchor').classList.toggle('details-full-width',full);$('capture-list').parentElement.hidden=full;$('library-search-row').hidden=full||!itemsSearchOpen;$('item-search-toggle').hidden=full;$('item-search-toggle').setAttribute('aria-expanded',itemsSearchOpen);
  const buttonHome=full?$('items-rail-reopen'):($('projects-rail-actions')||$('items-rail-heading'));if(button.parentElement!==buttonHome)buttonHome.append(button);
  button.hidden=!libraryOpen||!currentItem();button.setAttribute('aria-pressed',full);button.setAttribute('aria-label',full?'Show items sidebar':'Hide items sidebar');button.title=full?'Show items sidebar':'Hide items sidebar · Esc to restore';button.setAttribute('aria-expanded',!full);button.innerHTML=icon('rail-left');
  detailEditor.layout();
}
function setDetailFullWidth(value){detailFullWidth=value;syncDetailWidth();if(!detailFullWidth)renderItemsPage();$('detail-width-toggle').focus({preventScroll:true})}
$('detail-width-toggle').addEventListener('click',()=>setDetailFullWidth(!detailFullWidth));
function renderBookmarkMeta(n){
  const u=new URL(n.url),domain=u.hostname.replace(/^www\./,'');$('bookmark-open').href=n.url;$('bookmark-open').title='Open '+domain+' in a new tab';$('bookmark-embed').title=thoughtTitle(n)+' — page preview';$('detail-url').value=n.url;
}
function setBookmarkPreview(open){
  const n=currentItem(),show=!!(n?.url&&open);bookmarkPreview=show;
  $('detail-content').classList.toggle('previewing-bookmark',show);$('bookmark-detail').hidden=!n?.url;$('bookmark-embed-wrap').hidden=!n?.url;$('bookmark-detail').setAttribute('aria-hidden',!show);$('bookmark-detail').inert=!show;
  const tabs=[$('bookmark-preview-toggle'),$('bookmark-notes-tab')];tabs.forEach((tab,i)=>{const active=i===0?show:!show;tab.setAttribute('aria-selected',active);tab.tabIndex=active?0:-1});$('bookmark-notes-panel').hidden=show;
  const visible=state.scenario==='items'&&state.expanded&&libraryOpen,frame=$('bookmark-embed');
  const native=window.__OPEN_SESAME_NATIVE__===true,github=!native&&window.OpenSesameGitHub?.isRepo(n?.url);window.OpenSesameGitHub?.render(native?null:n?.url,!native&&visible&&show);$('bookmark-embed-wrap').hidden=!!github||!show;const hosted=window.OpenSesameNativeSurfaces?.bookmark(n?.url,visible&&show);frame.hidden=!!hosted;const src=!hosted&&visible&&n?.url&&!github&&show?n.url:'about:blank';if(frame.getAttribute('src')!==src)frame.src=src;detailEditor.layout();
}
function closeBookmarkUrl(){ $('bookmark-url-editor').hidden=true;$('bookmark-edit-url').setAttribute('aria-expanded','false'); }
function renderDetail(){
  const n=currentItem();$('detail-empty').hidden=!!n;$('detail-content').hidden=!n;
  if(!n){setBookmarkPreview(false);bookmarkViewId='';return}
  const kind=itemKind(n),task=kind==='task',changed=bookmarkViewId!==n.id;
  if(changed){bookmarkViewId=n.id;bookmarkPreview=kind==='bookmark';closeBookmarkUrl();$('detail-url-error').hidden=true}
  $('detail-kind').textContent=kind.toUpperCase();$('detail-title').value=thoughtTitle(n);$('detail-title').setAttribute('aria-label',kind[0].toUpperCase()+kind.slice(1)+' title');$('detail-title').title=thoughtTitle(n);
  detailEditor.set(n.body||'',{identity:n.id});$('detail-body').placeholder=kind==='bookmark'?'Why did you save this page?':task?'What needs to happen?':'Give this thought a little room…';$('detail-body-label').textContent=kind==='bookmark'?'Your notes':task?'Task details':'Note';$('detail-project').value=n.projectId||'';
  if(n.url){$('bookmark-notes-panel').setAttribute('role','tabpanel');$('bookmark-notes-panel').setAttribute('aria-labelledby','bookmark-notes-tab')}else{$('bookmark-notes-panel').removeAttribute('role');$('bookmark-notes-panel').removeAttribute('aria-labelledby')}
  $('task-details').hidden=!task;$('detail-task-done').checked=task&&OpenSesameItemWorkflow.isArchived(n);$('detail-task-status').textContent=OpenSesameItemWorkflow.isArchived(n)?'Archived · uncheck to restore':'Complete & archive';
  const convert=$('detail-convert');convert.hidden=kind==='bookmark';convert.setAttribute('aria-label',task?'Make a note':'Make a task');convert.title=task?'Make a note':'Make a task';convert.innerHTML=icon(task?'capture':'task')+'<span>'+(task?'Make a note':'Make a task')+'</span>';$('detail-save-status').textContent='Saved on this device';
  ['bookmark-edit-url','bookmark-content-tabs','bookmark-open','bookmark-read-later'].forEach(id=>$(id).hidden=!n.url);if(n.url){renderBookmarkMeta(n);window.openSesameReading?.syncBookmark(n);}setBookmarkPreview(bookmarkPreview&&!!n.url);window.OpenSesameNotes?.update(n.id,n.body||'');
}
function saveDetail(){const n=currentItem();if(!n)return;n.updatedAt=Date.now();$('detail-save-status').textContent=saveItems()?'Saved on this device':'Could not save';renderItems({detail:false})}
$('detail-title').addEventListener('input',()=>{const n=currentItem();if(!n)return;n.title=$('detail-title').value;n.text=n.title;saveDetail()});
$('detail-task-done').addEventListener('change',()=>{const n=currentItem();if(itemKind(n||{})!=='task')return;setItemStatus(n,$('detail-task-done').checked?'done':'restore')});
$('detail-convert').addEventListener('click',()=>{const n=currentItem();if(!n||itemKind(n)==='bookmark')return;n.kind=itemKind(n)==='task'?'note':'task';if(categoryFilter!=='all')categoryFilter=n.kind;expandedCategories.add(n.kind);saveItems();renderItems()});
$('detail-project').addEventListener('change',()=>{const n=currentItem();if(!n)return;const id=$('detail-project').value;if(id==='__new'){showProjectForm(n.id);return}const previous=n.projectId;n.projectId=id;if(!saveItems()){n.projectId=previous;renderProjectSelectors();return}if(projectFilter!=='all')projectFilter=id||'inbox';renderItems();toast('Moved to '+projectName(id)+'.')});
$('detail-delete').addEventListener('click',()=>{if(selectedItemId)deleteItem(selectedItemId)});
let bookmarkUrlTimer;
function applyBookmarkUrl(showError=true){
  clearTimeout(bookmarkUrlTimer);const n=currentItem();if(!n?.url)return false;const url=pageUrl($('detail-url').value);
  if(!url){$('detail-url-error').textContent='Enter a valid HTTP or HTTPS page URL.';$('detail-url-error').hidden=!showError;$('detail-url').setAttribute('aria-invalid','true');return false}
  if(OpenSesameBookmarkModel.duplicate(items,url,n.projectId,n.id)){if(showError)toast('This bookmark is already saved in this project.');$('detail-url').setAttribute('aria-invalid','true');return false}
  $('detail-url-error').hidden=true;$('detail-url').removeAttribute('aria-invalid');
  if(n.url!==url){const before={url:n.url,text:n.text,title:n.title,updatedAt:n.updatedAt};n.url=url;n.updatedAt=Date.now();if(n.text===before.url)n.text=url;if(n.title===before.url)n.title=url;if(!saveItems()){Object.assign(n,before);$('detail-url-error').textContent='Could not save this address. Try again.';$('detail-url-error').hidden=false;return false}renderBookmarkMeta(n);renderItems({detail:false});setBookmarkPreview(bookmarkPreview)}return true;
}
$('bookmark-edit-url').addEventListener('click',()=>{const open=$('bookmark-url-editor').hidden;$('bookmark-url-editor').hidden=!open;$('bookmark-edit-url').setAttribute('aria-expanded',open);if(open)$('detail-url').focus({preventScroll:true})});
$('bookmark-url-done').addEventListener('click',()=>{if(applyBookmarkUrl()){closeBookmarkUrl();$('detail-more').focus({preventScroll:true})}});
$('detail-url').addEventListener('change',()=>applyBookmarkUrl());$('detail-url').addEventListener('input',()=>{clearTimeout(bookmarkUrlTimer);$('detail-url-error').hidden=true;$('detail-url').removeAttribute('aria-invalid')});
$('detail-url').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();if(applyBookmarkUrl()){closeBookmarkUrl();$('detail-more').focus({preventScroll:true})}}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();const n=currentItem();if(n)$('detail-url').value=n.url;closeBookmarkUrl();$('detail-more').focus({preventScroll:true})}});
[$('bookmark-preview-toggle'),$('bookmark-notes-tab')].forEach((tab,index)=>{tab.addEventListener('click',()=>setBookmarkPreview(index===0));tab.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const preview=e.key==='Home'||e.key!=='End'&&index===1;setBookmarkPreview(preview);$(preview?'bookmark-preview-toggle':'bookmark-notes-tab').focus({preventScroll:true})}})});
$('item-search-toggle').addEventListener('click',()=>{itemsSearchOpen=!itemsSearchOpen;syncDetailWidth();if(itemsSearchOpen)$('library-search').focus({preventScroll:true})});
$('library-toggle').addEventListener('click',()=>window.OpenSesameProjects?.show());$('library-search').addEventListener('input',()=>{libraryQuery=$('library-search').value;selectedItemId='';itemsPage=0;renderItems()});$('project-filter').addEventListener('change',()=>selectCollection(categoryFilter,$('project-filter').value));$('category-filter').addEventListener('change',()=>selectCollection($('category-filter').value));$('rail-all').addEventListener('click',()=>selectCollection('all'));
function showProjectForm(forItem=''){projectCreateForItem=forItem;libraryOpen=true;detailFullWidth=false;state.scenario='items';state.expanded=true;render();$('project-form').hidden=false;$('project-create').disabled=!$('project-name').value.trim();$('project-name').focus()}
function closeProjectForm(){ $('project-form').hidden=true;projectCreateForItem='';$('project-name').value='';$('project-create').disabled=true;$('global-project-select').focus({preventScroll:true}) }
$('project-name').addEventListener('input',()=>{$('project-create').disabled=!$('project-name').value.trim()});
$('project-form').addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeProjectForm()}});
$('new-project').addEventListener('click',()=>showProjectForm());$('project-cancel').addEventListener('click',closeProjectForm);$('capture-project').addEventListener('change',()=>{if($('capture-project').value==='__new')showProjectForm()});
$('project-form').addEventListener('submit',e=>{e.preventDefault();const name=$('project-name').value.trim();if(!name)return;let project=projects.find(p=>p.name.toLowerCase()===name.toLowerCase());if(!project){if(projects.length>=30){toast('You have 30 projects.');return}project={id:newId(),name};projects.push(project)}try{localStorage.setItem('open-sesame-projects-v1',JSON.stringify(projects))}catch{toast('Could not save the project.');return}if(projectCreateForItem){const n=items.find(n=>n.id===projectCreateForItem);if(n){n.projectId=project.id;saveItems();selectedItemId=n.id}}else selectedItemId='';projectFilter=project.id;if(categoryFilter!=='all')expandedCategories.add(categoryFilter);$('project-form').hidden=true;$('project-name').value='';projectCreateForItem='';renderItems();$('capture-project').value=project.id;window.dispatchEvent(new Event('open-sesame-projects-changed'));toast('Project ready: '+name)});
function draftUrl(){const fromText=inlineUrl($('capture-input').value)||pageUrl($('capture-input').value.trim());return attachedUrl||(fromText!==ignoredInlineUrl?fromText:'')}
function bookmarkBatchDraft(raw,intent){
  const type=intent.type||$('capture-type').value;if(intent.kind!=='item'||['note','task'].includes(type))return null;
  const parsed=OpenSesameBookmarkModel.parse(intent.text??raw);return parsed.urls.length&&parsed.attempts>=2?parsed:null;
}
function saveBookmarkBatch(urls,projectId){
  if(projectId&&!projects.some(p=>p.id===projectId))return {ok:false,error:'Choose an existing project.'};
  const normalized=[...new Set(urls.map(OpenSesameBookmarkModel.canonical).filter(Boolean))],plan=OpenSesameBookmarkModel.plan(normalized,items,projectId);
  if(!plan.fresh.length)return {ok:false,error:'These bookmarks are already saved in this project.'};
  if(activeItems().length+plan.fresh.length>30||items.length+plan.fresh.length>300)return {ok:false,error:'Not enough room for this batch. Archive active items or remove archived items first.'};
  const before=items.length,added=plan.fresh.map(url=>({id:newId(),kind:'bookmark',text:url,url,done:false,title:'',body:'',projectId}));items.push(...added);
  if(!saveItems()){items.length=before;return {ok:false,error:'Could not save. Your links are still in capture; try again.'}}
  $('capture-input').value='';$('capture-url').value='';attachedUrl='';ignoredInlineUrl='';closeUrlEditor();itemsArchive=false;selectedItemId=added[0].id;revealItem=true;itemsPage=0;categoryFilter='bookmark';expandedCategories.clear();expandedCategories.add('bookmark');libraryOpen=true;if(projectFilter!=='all')projectFilter=projectId||'inbox';$('capture-project').value=projectId;changeScenario('items');toast(added.length+' bookmark'+(added.length===1?'':'s')+' saved · '+projectName(projectId));return {ok:true,count:added.length};
}
function stagePastedBookmarks(raw){
  const parsed=OpenSesameBookmarkModel.parse(raw);if(parsed.error){toast(parsed.error);return true}if(parsed.attempts<2||!parsed.urls.length)return false;
  $('capture-input').value=raw;$('capture-type').value='bookmark';attachedUrl='';ignoredInlineUrl='';closeUrlEditor();renderDraft();$('capture-input').focus({preventScroll:true});return true;
}
function renderDraft(){
  document.querySelector('.widget-capture-footer').classList.toggle('has-draft',!!($('capture-input').value.trim()||draftUrl()));
  const url=draftUrl(),type=$('capture-type').value,intent=openSesameCapture.interpret($('capture-input').value,type,state.scenario),item=intent.kind==='item',button=$('capture-form').querySelector('[type=submit]');button.disabled=!($('capture-input').value.trim()||url)||!!intent.incomplete||intent.kind==='error';button.setAttribute('aria-label',item?'Save item':intent.label||'Show capture commands');button.title=(item?'Save item':intent.label||intent.hint)+' · Enter';button.innerHTML=icon(intent.kind==='agent'?'terminal':intent.kind==='calculation'?'copy':item?'arrow-up':'arrow-up-right');
  $('capture-link-preview').hidden=!item||!url;$('capture-hint').hidden=item&&!!url;$('capture-hint').textContent=intent.kind==='item'?(intent.incomplete?intent.hint:'Enter to save · Shift Enter for a new line'):intent.hint;$('capture-input').placeholder=intent.kind==='chat'||type==='auto'&&window.OpenSesameCovenChat?.isActive()?'Message Coven · preview…':type==='task'?'Add a task…':item&&url?'Add a title for this bookmark…':type==='bookmark'?'Name this bookmark…':state.scenario==='reading'?'Paste an article, paper, or type /…':'Capture a thought, paste a link, or type /…';
  $('capture-link-domain').textContent=url?new URL(url).hostname.replace(/^www\./,''):'';
  $('attach-link').classList.toggle('has-link',!!url);$('attach-link').title=url?'Edit attached page URL':'Attach a page URL';document.querySelector('.capture-input-wrap').dataset.intent=intent.kind;openSesameCapture.refresh();window.openSesameSpeech?.refresh();
  window.OpenSesameComposer?.sync();window.OpenSesameInputTools?.refresh();const batch=bookmarkBatchDraft($('capture-input').value,intent);$('remove-url').hidden=!!batch;
  if(batch){button.setAttribute('aria-label','Review '+batch.urls.length+' bookmarks');button.title='Review '+batch.urls.length+' bookmarks · Enter';$('capture-link-preview').hidden=true;$('capture-hint').hidden=false;$('capture-hint').textContent=batch.urls.length+' links · Enter to review'+(batch.duplicates?' · '+batch.duplicates+' repeated':'');$('capture-intent').textContent='Bookmarks';$('capture-intent').hidden=false}

}
function closeUrlEditor(){
  $('capture-url-row').hidden=true;$('attach-link').setAttribute('aria-expanded','false');$('capture-url-error').hidden=true;$('capture-url').removeAttribute('aria-invalid');
}
function applyUrl(){
  const raw=$('capture-url').value.trim(),url=pageUrl(raw);
  if(!url){$('capture-url-error').textContent='Enter a valid http or https page URL.';$('capture-url-error').hidden=false;$('capture-url').setAttribute('aria-invalid','true');$('capture-url').focus();return false}
  attachedUrl=url;ignoredInlineUrl='';closeUrlEditor();renderDraft();$('capture-input').focus({preventScroll:true});return true;
}
// Keep the attach trigger still while pointer focus would disclose footer metadata.
$('attach-link').addEventListener('pointerdown',e=>{if(e.button===0)e.preventDefault()});
$('attach-link').addEventListener('click',()=>{
  const open=$('capture-url-row').hidden;
  if(!open){closeUrlEditor();return}
  $('capture-url-row').hidden=false;$('attach-link').setAttribute('aria-expanded','true');$('capture-url').value=draftUrl();$('capture-url').focus();
});
$('capture-from-clipboard').addEventListener('click',async()=>{
  const error=$('capture-url-error');
  if(!navigator.clipboard?.readText){error.textContent='Paste a copied page link here.';error.hidden=false;$('capture-url').focus();return}
  try{
    const copied=await navigator.clipboard.readText();if(stagePastedBookmarks(copied))return;const url=pageUrl(copied)||inlineUrl(copied);
    if(!url){error.textContent='No link in the clipboard. Copy a page address from your browser.';error.hidden=false;return}
    $('capture-url').value=url;applyUrl();
  }catch{error.textContent='Clipboard access is unavailable. Paste a page link here.';error.hidden=false;$('capture-url').focus()}
});
$('capture-url').addEventListener('paste',e=>{const raw=e.clipboardData?.getData('text/plain')||'';if(stagePastedBookmarks(raw)){e.preventDefault();return}const url=pageUrl(raw)||inlineUrl(raw);if(url){e.preventDefault();$('capture-url').value=url;$('capture-url-error').hidden=true;$('capture-url').removeAttribute('aria-invalid')}});
$('apply-url').addEventListener('click',applyUrl);
$('capture-url').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();applyUrl()}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeUrlEditor();$('attach-link').focus()}});
$('capture-url').addEventListener('input',()=>{$('capture-url-error').hidden=true;$('capture-url').removeAttribute('aria-invalid')});
$('capture-input').addEventListener('input',renderDraft);
$('capture-input').addEventListener('paste',e=>{if((e.clipboardData?.getData('text/plain')||'').length>20000){e.preventDefault();toast('Paste up to 20,000 characters at a time.')}});
$('remove-url').addEventListener('click',()=>{attachedUrl='';ignoredInlineUrl=inlineUrl($('capture-input').value)||pageUrl($('capture-input').value.trim());$('capture-url').value='';closeUrlEditor();renderDraft();$('capture-input').focus()});
$('view-thoughts').addEventListener('click',()=>{libraryOpen=true;categoryFilter='all';changeScenario('items');$('capture-list').focus({preventScroll:true})});
$('capture-type').addEventListener('change',renderDraft);
$('new-item').addEventListener('click',()=>{$('capture-type').value=categoryFilter==='task'?'task':categoryFilter==='bookmark'?'bookmark':'auto';renderDraft();$('capture-input').focus({preventScroll:true})});
$('capture-form').addEventListener('submit',e=>{
  e.preventDefault();if(!$('capture-url-row').hidden&&$('capture-url').value.trim()&&!applyUrl())return;
  const raw=$('capture-input').value.trim(),intent=openSesameCapture.interpret(raw,$('capture-type').value,state.scenario);if(intent.kind!=='item'){if(openSesameCapture.execute(intent)){$('capture-input').value='';attachedUrl='';ignoredInlineUrl='';closeUrlEditor();renderDraft()}return}
  const batch=bookmarkBatchDraft(raw,intent);if(batch){window.OpenSesameBookmarks.open(batch);return}
  const text=intent.text??raw,type=intent.type||$('capture-type').value,url=type==='note'||type==='task'?'':intent.type==='bookmark'?pageUrl(text)||inlineUrl(text)||draftUrl():draftUrl();
  if(!text&&!url){$('capture-input').focus();return}
  if(type==='bookmark'&&!url){$('capture-url-row').hidden=false;$('attach-link').setAttribute('aria-expanded','true');$('capture-url').focus();toast('Add a page URL for this bookmark.');return}
  if(activeItems().length>=30){toast('You have 30 active items. Archive one to make room.');return}if(items.length>=300){toast('Your archive is full. Remove an archived item to make room.');return}
  const kind=type==='task'?'task':type==='note'?'note':url?'bookmark':'note';
  if(kind==='bookmark'){
    const existing=OpenSesameBookmarkModel.duplicate(items,url,$('capture-project').value);
    if(existing){
      selectedItemId=existing.id;itemsArchive=OpenSesameItemWorkflow.isArchived(existing);revealItem=true;itemsPage=0;categoryFilter='bookmark';expandedCategories.add('bookmark');libraryOpen=true;
      if(projectFilter!=='all')projectFilter=existing.projectId||'inbox';
      toast('Already saved in '+projectName(existing.projectId)+'. No duplicate added.');
      window.OpenSesameComposer?.fullscreen(false);changeScenario('items');return;
    }
  }
  const lines=text.split(/\r?\n/),multiline=kind==='note'&&lines.length>1;const item={id:newId(),kind,text:multiline?lines[0].trim()||'Untitled note':text||url,url,done:false,title:multiline?lines[0].trim()||'Untitled note':'',body:multiline?lines.slice(1).join('\n').trim():'',projectId:$('capture-project').value==='__new'?'':$('capture-project').value};items.push(item);
  if(!saveItems()){items.pop();return}
  $('capture-input').value='';$('capture-url').value='';attachedUrl='';ignoredInlineUrl='';closeUrlEditor();renderDraft();itemsArchive=false;selectedItemId=item.id;revealItem=true;itemsPage=0;categoryFilter=kind;expandedCategories.add(kind);if(kind!=='note')libraryOpen=true;if(projectFilter!=='all')projectFilter=item.projectId||'inbox';changeScenario('items');$('capture-list').scrollTop=0;toast(kind==='task'?'Task added to Items.':kind==='bookmark'?'Bookmark saved to Items.':'Note saved to Items.');
});
function notification(title='A gentle nudge',body='Take a breath. Your next good idea can wait a second.'){$('notification-title').textContent=title;$('notification-body').textContent=body;$('desktop-notification').hidden=false;if(state.speakNotifications)window.openSesameSpeech?.speak(title+'. '+body,'notification');clearTimeout(notificationTimer);notificationTimer=setTimeout(()=>$('desktop-notification').hidden=true,6500)}
$('notify').addEventListener('click',()=>notification());$('dismiss-notification').addEventListener('click',()=>{$('desktop-notification').hidden=true;clearTimeout(notificationTimer)});
const guide=$('guide');['guide-open','guide-bottom'].forEach(id=>$(id).addEventListener('click',()=>guide.showModal()));['guide-close','guide-done'].forEach(id=>$(id).addEventListener('click',()=>guide.close()));guide.addEventListener('click',e=>{if(e.target===guide){const r=guide.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)guide.close()}});
$('reset').addEventListener('click',()=>{Object.assign(state,defaults);inspecting=false;document.body.classList.remove('inspecting');$('zoom').setAttribute('aria-pressed','false');$('zoom').querySelector('span').textContent='Inspect';libraryOpen=false;resetFocus();$('desktop-notification').hidden=true;renderMusic();render();toast('Playground reset. Your saved items are still here.')});
document.addEventListener('keydown',e=>{if(guide.open||$('share-privacy').open||e.target.closest('.terminal-native'))return;if(e.key==='Escape'){if(!$('capture-url-row').hidden){closeUrlEditor();$('attach-link').focus();return}if(detailFullWidth&&libraryOpen&&state.scenario==='items'){setDetailFullWidth(false);return}if(presenting){present(false);return}if(libraryOpen&&state.scenario==='items'){libraryOpen=false;render();return}if(state.expanded)setExpanded(false,{focus:true});return}if(e.target.closest('input,textarea,select,[contenteditable]')||e.metaKey||e.ctrlKey||e.altKey)return;if(e.key.toLowerCase()==='m'){state.layout=state.layout==='notch'?'menu':'notch';render()}if(e.key.toLowerCase()==='e')setExpanded(!state.expanded,{focus:true});});
setInterval(()=>{if(focusRunning){focusRemaining=Math.max(0,Math.ceil((focusEnd-Date.now())/1000));if(focusRemaining===0){focusElapsedMs+=Date.now()-focusStartedAt;focusRunning=false;notification('Your focus session is complete','Nice work. Stretch, breathe, and enjoy a moment away.')}renderFocus()}},1000);
if(itemsNeedMigration)saveItems();renderAgendaList();renderMusic();renderFocus();renderItems();renderDraft();render();

openSesameBridge.ready.then(()=>{if(window.__OPEN_SESAME_NATIVE__)syncNativeWindow()});
window.addEventListener('open-sesame-display-changed',()=>{if(window.__OPEN_SESAME_NATIVE__)render()});
