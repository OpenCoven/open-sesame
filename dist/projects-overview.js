'use strict';
(()=>{
  const el=id=>document.getElementById(id),pane=el('pane-items'),workspace=pane.querySelector('.items-workspace');
  const toolbar=document.createElement('div'),tabs=document.createElement('div');
  toolbar.className='console-toolbar projects-toolbar';tabs.className='console-mode-tabs projects-mode-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Project collections');
  workspace.id='projects-collection';workspace.setAttribute('role','tabpanel');
  const groups=[['note','Notes','capture'],['bookmark','Bookmarks','bookmark'],['task','Tasks','check']];
  let lastKind='note';
  function collection(kind){
    if(window.OpenSesameNotes?.finish(false)===false)return false;
    lastKind=kind;libraryOpen=!(window.OpenSesameMobile?.active&&innerWidth<=600);detailFullWidth=false;itemsArchive=false;libraryQuery='';itemsSearchOpen=false;el('library-search').value='';expandedCategories.clear();
    selectCollection(kind);render();return true;
  }
  const buttons=groups.map(([kind,title,symbol])=>{
    const button=document.createElement('button');button.type='button';button.id='projects-'+kind;button.setAttribute('role','tab');button.setAttribute('aria-controls',workspace.id);button.dataset.kind=kind;button.innerHTML=icon(symbol);
    const label=document.createElement('span');label.textContent=title;button.append(label);button.addEventListener('click',()=>collection(kind));tabs.append(button);return button;
  });
  tabs.addEventListener('keydown',event=>{
    const index=buttons.indexOf(document.activeElement);if(index<0)return;
    const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:event.key==='ArrowRight'?(index+1)%buttons.length:event.key==='ArrowLeft'?(index+buttons.length-1)%buttons.length:null;
    if(next===null)return;event.preventDefault();if(collection(buttons[next].dataset.kind))buttons[next].focus({preventScroll:true});
  });
  const actions=document.createElement('div'),count=document.createElement('span');
  actions.id='projects-rail-actions';actions.setAttribute('role','group');actions.setAttribute('aria-label','Collection sidebar controls');count.id='projects-item-count';
  actions.append(el('item-search-toggle'),el('detail-width-toggle'));el('items-rail-heading').append(count,actions);
  toolbar.append(tabs,pane.querySelector('.global-project'),pane.querySelector('.library-tools'));pane.prepend(toolbar);pane.classList.add('projects-tabbed');
  function normalize(){if(!itemsArchive&&!groups.some(group=>group[0]===categoryFilter))categoryFilter=lastKind}
  function sync(){
    const kind=groups.some(group=>group[0]===categoryFilter)?categoryFilter:lastKind;if(!itemsArchive)lastKind=kind;
    for(const button of buttons){const selected=button.dataset.kind===kind&&!itemsArchive;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;}
    const title=itemsArchive?'Archived':groups.find(group=>group[0]===kind)[1],total=filteredItems().length;
    workspace.setAttribute('aria-labelledby','projects-'+kind);el('collection-title').textContent=title;el('capture-list').setAttribute('aria-label',title);
    count.textContent=String(total);count.setAttribute('aria-label',title+': '+total);
  }
  function show(){collection(lastKind)}
  function closeDetails(){
    if(window.OpenSesameNotes?.finish(false)===false)return false;
    libraryOpen=false;detailFullWidth=false;selectedItemId='';render();return true;
  }
  window.addEventListener('open-sesame-home',event=>{if(event.detail==='items')show()});
  window.OpenSesameProjects={sync,show,closeDetails,normalize,leave(){},flatCollections:true,get selected(){return lastKind}};collection('note');
})();
