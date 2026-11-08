'use strict';
(()=>{
  const el=id=>document.getElementById(id),pane=el('pane-items'),workspace=pane.querySelector('.items-workspace');
  const toolbar=document.createElement('div'),tabs=document.createElement('div');
  toolbar.className='console-toolbar projects-toolbar';tabs.className='console-mode-tabs projects-mode-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Project collections');
  workspace.id='projects-collection';workspace.setAttribute('role','tabpanel');
  const groups=[['note','Notes','capture'],['bookmark','Bookmarks','bookmark'],['task','Tasks','check'],['all','Recent','items']];
  let lastKind='note';
  function collection(kind){
    if(window.OpenSesameNotes?.finish(false)===false)return false;
    lastKind=kind;libraryOpen=true;detailFullWidth=false;itemsArchive=false;libraryQuery='';itemsSearchOpen=false;el('library-search').value='';expandedCategories.clear();
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
  toolbar.append(tabs);pane.prepend(toolbar);pane.classList.add('projects-tabbed');
  function sync(){
    const kind=groups.some(group=>group[0]===categoryFilter)?categoryFilter:'all';if(!itemsArchive)lastKind=kind;
    for(const button of buttons){const selected=button.dataset.kind===kind&&!itemsArchive;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;}
    workspace.setAttribute('aria-labelledby','projects-'+kind);el('collection-title').textContent=itemsArchive?'Archived':groups.find(group=>group[0]===kind)[1];
  }
  function show(){collection(lastKind)}
  window.addEventListener('open-sesame-home',event=>{if(event.detail==='items')show()});
  window.OpenSesameProjects={sync,show,leave(){},flatCollections:true,get selected(){return lastKind}};collection('note');
})();
