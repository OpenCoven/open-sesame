'use strict';
/* Installed widgets live inside their declared page. Native panes stay mounted. */
(()=>{
  const M=OpenSesameToolsModel,el=id=>document.getElementById(id),panel=el('widget-panel');
  const adapters={
    focus:['pane-focus','.focus-top','.focus-view-tabs','focus'],
    media:['lockin-workspace','.console-toolbar','#lockin-tabs','entertainment'],
    projects:['pane-items','.projects-toolbar','.projects-mode-tabs','items'],
    console:['agents-workspace','.console-toolbar','.agents-mode-tabs','agents'],
    reader:['pane-reading','#reading-toolbar','#reading-collections','reading'],
    live:['pane-audio',null,null,'audio'],widgets:['pane-plugins',null,null,'plugins']
  };
  const githubHost=el('github-monitor'),githubHome=githubHost.parentElement;
  const contexts=new Map();let selected={},builtins=[],syncing=false,serial=0;
  try{const saved=JSON.parse(localStorage.getItem('open-sesame-page-tabs-v1')||'{}');for(const page of Object.keys(adapters))if(typeof saved[page]==='string')selected[page]=saved[page]}catch{}
  try{if(JSON.parse(localStorage.getItem('open-sesame-builtin-widgets-v1')||'[]').includes('github'))builtins=['github']}catch{}
  const make=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n};
  const currentPage=()=>({focus:'focus',music:'media',youtube:'media',media:'media',items:'projects',familiars:'console','agent-monitor':'console',terminal:'console',remote:'console',reading:'reader',audio:'live',plugins:'widgets'})[state.scenario];
  function list(){return [...window.OpenSesameTools.list(),...(builtins.includes('github')?[{id:'builtin-github',name:'GitHub',page:'projects',builtin:true}]:[])]}
  function save(){try{localStorage.setItem('open-sesame-page-tabs-v1',JSON.stringify(selected))}catch{}}
  function context(page){
    if(contexts.has(page))return contexts.get(page);
    const [id,toolbarSelector,tabsSelector]=adapters[page],root=el(id);let toolbar=toolbarSelector&&root.querySelector(toolbarSelector),tabs=tabsSelector&&root.querySelector(tabsSelector);
    if(!tabs){toolbar=make('div','page-widget-toolbar console-toolbar');tabs=make('div','console-mode-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label',M.pages[page]+' views');const base=make('button','',page==='widgets'?'Discover':'Live');base.type='button';base.setAttribute('role','tab');base.setAttribute('aria-selected','true');toolbar.append(tabs);tabs.append(base);root.prepend(toolbar)}
    const view=make('section','page-widget-view');view.id='page-widget-view-'+page;view.hidden=true;view.setAttribute('role','tabpanel');view.tabIndex=0;root.append(view);
    for(const child of toolbar.children)if(child===tabs||child.contains(tabs))child.classList.add('page-widget-tab-holder');
    const c={root,toolbar,tabs,view,id:null,definition:null,dispose:null};contexts.set(page,c);
    tabs.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||!tabs.contains(b)||b.dataset.pageWidget)return;deactivate(page);sync()},true);
    tabs.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)||e.altKey||e.ctrlKey||e.metaKey)return;const buttons=[...tabs.querySelectorAll('[role="tab"]')].filter(b=>!b.hidden&&!b.disabled),index=buttons.indexOf(document.activeElement);if(index<0)return;e.preventDefault();e.stopImmediatePropagation();const next=buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowLeft'?-1:1)+buttons.length)%buttons.length];next.click();next.focus({preventScroll:true})},true);
    return c;
  }
  function release(c){if(c.id==='builtin-github'){window.OpenSesameGitHubMonitor.pause();githubHome.append(githubHost);githubHost.hidden=true}c.dispose?.();c.dispose=null}
  function deactivate(page){delete selected[page];save();window.OpenSesameTools.invalidate();const c=contexts.get(page);if(c?.id==='builtin-github')window.OpenSesameGitHubMonitor?.pause();}
  function choose(page,id){
    if(!list().some(x=>x.id===id&&x.page===page))return;
    if(window.OpenSesameNotes?.finish(false)===false)return;
    selected[page]=id;save();sync();changeScenario(adapters[page][3]);sync();
    context(page).tabs.querySelector('[aria-selected="true"]')?.focus({preventScroll:true});
  }
  function sync(){
    if(syncing)return;syncing=true;
    try{
      const widgets=list(),pageNow=currentPage();
      for(const page of Object.keys(adapters)){
        const entries=widgets.filter(x=>x.page===page);
        if(!entries.length&&!contexts.has(page))continue;
        const c=context(page),signature=JSON.stringify(entries.map(x=>[x.id,x.name]));
        if(c.signature!==signature){
          for(const b of c.tabs.querySelectorAll('[data-page-widget]'))b.remove();
          for(const x of entries){const b=make('button','page-widget-tab',x.name);b.type='button';b.title=x.name;b.id='installed-widget-tab-'+(++serial);b.dataset.pageWidget=x.id;b.setAttribute('role','tab');b.setAttribute('aria-controls',c.view.id);b.addEventListener('click',()=>choose(page,x.id));c.tabs.append(b)}c.signature=signature;
        }
        const x=entries.find(x=>x.id===selected[page]);if(!x&&selected[page]){delete selected[page];save()}
        const show=!!x;c.root.classList.toggle('page-widget-open',show);c.toolbar.classList.toggle('page-widget-host-toolbar',show);c.view.hidden=!show;
        if(show){
          for(const b of c.tabs.querySelectorAll('[role="tab"]')){const yes=b.dataset.pageWidget===x.id;b.setAttribute('aria-selected',String(yes));b.tabIndex=yes?0:-1;if(yes)c.view.setAttribute('aria-labelledby',b.id)}
          if(c.id!==x.id||c.definition!==x.definition){
            release(c);c.id=x.id;c.definition=x.definition;c.view.replaceChildren();
            if(x.builtin){c.view.append(githubHost);window.OpenSesameGitHubMonitor.mount(()=>currentPage()===page&&selected[page]===x.id&&state.expanded&&!window.OpenSesameLauncher?.active)}
            else{
              const actions=make('header','page-widget-actions'),manage=make('button','','Manage widget'),body=make('article','installed-widget-content'),status=make('p','page-widget-status');manage.type='button';manage.onclick=()=>window.OpenSesameTools.open();status.setAttribute('role','status');actions.append(make('small','',M.pages[page]+' / '+x.name),manage);c.view.append(actions,body,status);
              c.dispose=window.OpenSesameTools.mount(x.id,body,()=>currentPage()===page&&selected[page]===x.id&&state.expanded&&!c.view.hidden&&!window.OpenSesameTools.active);
            }
          }
        }else{
          release(c);c.id=null;c.definition=null;
          for(const b of c.tabs.querySelectorAll('[data-page-widget]')){b.setAttribute('aria-selected','false');b.tabIndex=-1}
          if(!c.tabs.querySelector('[aria-selected="true"]')){const first=c.tabs.querySelector('[role="tab"]');first?.setAttribute('aria-selected','true');if(first)first.tabIndex=0}
        }
      }
      const active=!!selected[pageNow]&&widgets.some(x=>x.id===selected[pageNow]&&x.page===pageNow);panel.classList.toggle('page-widget-active',active);
      window.OpenSesameShellInput?.sync();window.OpenSesameFocusControls?.sync();
    }finally{syncing=false}
  }
  function open(id){const x=list().find(x=>x.id===id);if(x)choose(x.page,id)}
  function github(){
    if(!builtins.includes('github')){try{localStorage.setItem('open-sesame-builtin-widgets-v1',JSON.stringify(['github']))}catch{toast('Could not save the installed widget.');return}builtins.push('github')}
    choose('projects','builtin-github');window.OpenSesameGitHubMonitor.activate();
  }
  window.OpenSesamePageWidgets={open,github,sync,list,get active(){return !!selected[currentPage()]},close(){deactivate(currentPage());sync()},removeGithub(){try{localStorage.setItem('open-sesame-builtin-widgets-v1','[]')}catch{toast('Could not save the change.');return}builtins=[];deactivate('projects');sync()}};
  window.addEventListener('open-sesame-tools-changed',sync);window.addEventListener('open-sesame-layout',sync);
  window.addEventListener('open-sesame-view-changed',()=>{window.OpenSesameTools.invalidate();sync();if(selected[currentPage()]==='builtin-github')window.OpenSesameGitHubMonitor.activate()});
  window.addEventListener('open-sesame-tool-status',e=>{const c=contexts.get(currentPage());const status=c?.view.querySelector('.page-widget-status');if(status)status.textContent=e.detail});
  sync();
})();
