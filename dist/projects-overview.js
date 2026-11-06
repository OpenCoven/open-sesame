'use strict';
(()=>{
  const el=id=>document.getElementById(id),pane=el('pane-items'),heading=pane.querySelector('.capture-list-heading');
  const home=document.createElement('section');home.id='projects-overview';home.className='projects-overview';home.setAttribute('aria-label','Projects overview');heading.after(home);
  const back=document.createElement('button');back.id='projects-overview-return';back.type='button';back.title='Projects overview';back.setAttribute('aria-label','Back to Projects overview');back.innerHTML=icon('items');heading.prepend(back);
  const browse=document.createElement('button');browse.id='projects-browse-all';browse.type='button';browse.innerHTML=icon('collection');browse.title='All items';browse.setAttribute('aria-label','All items');heading.append(browse);
  const groups=[{kind:'note',title:'Notes',icon:'capture',hint:'Ideas, notes, and little discoveries.'},{kind:'bookmark',title:'Bookmarks',icon:'bookmark',hint:'Keep a useful link close.'},{kind:'task',title:'Tasks',icon:'check',hint:'Make room for your next step.'},{kind:'all',title:'Recent items',icon:'items',hint:'Your latest captures appear here.'}];
  let overview=true,signature='';
  function leave(){overview=false;sync()}
  function show(){if(window.OpenSesameNotes?.finish(false)===false)return;overview=true;libraryOpen=false;detailFullWidth=false;selectedItemId='';itemsArchive=false;libraryQuery='';itemsSearchOpen=false;categoryFilter='all';itemsPage=0;el('library-search').value='';render();back.hidden=true;home.querySelector('button')?.focus({preventScroll:true})}
  function collection(kind){leave();libraryOpen=false;detailFullWidth=false;itemsArchive=false;libraryQuery='';itemsSearchOpen=false;el('library-search').value='';selectCollection(kind);render();el('capture-list').focus({preventScroll:true})}
  function capture(kind){el('capture-type').value=kind==='all'?'auto':kind;el('capture-project').value=['all','inbox'].includes(projectFilter)?'':projectFilter;renderDraft();el('capture-input').focus({preventScroll:true})}
  function sync(){
    if(libraryOpen||itemsArchive||libraryQuery)overview=false;
    pane.classList.toggle('projects-home-active',overview);home.hidden=!overview;back.hidden=overview;browse.hidden=!overview;
    if(!overview)return;
    const entries=activeItems().filter(n=>inProject(n)).slice().reverse(),next=JSON.stringify([projectFilter,entries.map(n=>[n.id,n.title,n.text,n.body,n.url,n.projectId,n.stage,n.done])]);
    if(signature===next)return;signature=next;home.replaceChildren();
    for(const group of groups){
      const records=group.kind==='all'?entries:entries.filter(n=>itemKind(n)===group.kind),tile=document.createElement('article');tile.className='focus-tile project-tile';tile.dataset.kind=group.kind;tile.setAttribute('aria-label',group.title+' preview');
      const header=document.createElement('header'),label=document.createElement('span'),title=document.createElement('strong'),count=document.createElement('small'),open=document.createElement('button');
      label.innerHTML=icon(group.icon);title.textContent=group.title;count.className='project-tile-count';count.textContent=records.length;label.append(title,count);open.type='button';open.innerHTML=icon('open-view');open.setAttribute('aria-label','Browse '+group.title.toLowerCase());open.title='Browse '+group.title.toLowerCase();open.addEventListener('click',()=>collection(group.kind));header.append(label,open);tile.append(header);
      const list=document.createElement('div');list.className='project-preview-list';
      for(const item of records.slice(0,3)){
        const button=document.createElement('button'),copy=document.createElement('span'),name=document.createElement('strong'),meta=document.createElement('small');button.type='button';button.className='project-preview-item';button.innerHTML=icon(itemKind(item)==='bookmark'?'bookmark':itemKind(item)==='task'?'check':'capture');name.textContent=thoughtTitle(item);meta.textContent=item.url?new URL(item.url).hostname.replace(/^www\./,''):itemKind(item)==='task'?OpenSesameItemWorkflow.label(item):item.body?OpenSesameItemWorkflow.excerpt(item.body):projectName(item.projectId);copy.append(name,meta);button.append(copy);button.title=thoughtTitle(item);button.addEventListener('click',()=>{leave();categoryFilter='all';libraryQuery='';openItem(item.id)});list.append(button);
      }
      if(!records.length){const empty=document.createElement('p');empty.className='project-preview-empty';empty.textContent=group.hint;list.append(empty)}tile.append(list);
      const footer=document.createElement('footer'),add=document.createElement('button');add.type='button';add.className='project-capture-action';add.innerHTML=icon('plus');const addLabel=document.createElement('span');addLabel.textContent=group.kind==='all'?'New item':group.kind==='bookmark'?'New link':group.kind==='task'?'New task':'New note';add.append(addLabel);add.addEventListener('click',()=>capture(group.kind));footer.append(add);tile.append(footer);home.append(tile);
    }
  }
  back.addEventListener('click',show);browse.addEventListener('click',()=>collection('all'));
  window.addEventListener('open-sesame-home',e=>{if(e.detail==='items')show()});document.querySelector('[data-scenario="items"]').addEventListener('click',show);
  window.OpenSesameProjects={sync,leave,show};sync();
})();
