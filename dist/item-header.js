'use strict';
(()=>{
  const el=id=>document.getElementById(id),button=el('detail-project-toggle'),menu=el('detail-project-menu'),search=el('detail-project-search'),PAGE_SIZE=6;
  const colors=['#ad9bc5','#8dafa3','#b5a17f','#8fabc5','#b892a3','#9aafa0'];let page=0,openedItem='';
  function color(id){let hash=0;for(const char of id)hash=(hash*31+char.charCodeAt(0))>>>0;return id?colors[hash%colors.length]:'#8d8596'}
  function close(focus=false){menu.hidden=true;button.setAttribute('aria-expanded','false');openedItem='';if(focus)button.focus({preventScroll:true})}
  function sync(){const n=currentItem(),id=n?.projectId||'',name=projectName(id);button.disabled=!n;button.title='Project · '+name;button.setAttribute('aria-label','Project: '+name+'. Change project');button.style.setProperty('--item-project-color',color(id));button.classList.toggle('has-project',!!id);if(openedItem&&(openedItem!==n?.id||!libraryOpen||state.scenario!=='items'||!state.expanded))close()}
  function entries(){const query=search.value.trim().toLowerCase();return [{id:'',name:'Inbox'},...projects].filter(p=>p.name.toLowerCase().includes(query))}
  function position(){const pane=el('pane-items'),a=button.getBoundingClientRect(),p=pane.getBoundingClientRect(),scale=p.width/pane.clientWidth||1;menu.style.left=Math.max(0,Math.min(pane.clientWidth-198,(a.left-p.left)/scale))+'px';const height=menu.offsetHeight;menu.style.top=Math.max(0,Math.min(pane.clientHeight-height-4,(a.bottom-p.top)/scale+5))+'px'}
  function draw(){
    const selected=currentItem()?.projectId||'',list=entries(),pages=Math.max(1,Math.ceil(list.length/PAGE_SIZE));page=Math.max(0,Math.min(page,pages-1));const options=el('detail-project-options');options.replaceChildren();
    for(const project of list.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE)){const choice=document.createElement('button');choice.type='button';choice.setAttribute('role','menuitemradio');choice.setAttribute('aria-checked',project.id===selected);choice.dataset.projectId=project.id;choice.style.setProperty('--item-project-color',color(project.id));choice.innerHTML=icon('folder');const name=document.createElement('span');name.textContent=project.name;choice.append(name);if(project.id===selected)choice.insertAdjacentHTML('beforeend',icon('check'));choice.addEventListener('click',()=>{const n=currentItem();if(!n||n.id!==openedItem){close();return}el('detail-project').value=project.id;close(true);el('detail-project').dispatchEvent(new Event('change',{bubbles:true}))});options.append(choice)}
    el('detail-project-empty').hidden=list.length>0;el('detail-project-pages').hidden=pages<=1;el('detail-project-page').textContent=(page+1)+' / '+pages;el('detail-project-prev').disabled=page===0;el('detail-project-next').disabled=page>=pages-1;position();
  }
  function open(){if(!currentItem())return;el('detail-action-menu').hidden=true;el('detail-more').setAttribute('aria-expanded','false');openedItem=currentItem().id;search.value='';const selected=[{id:''},...projects].findIndex(p=>p.id===(currentItem().projectId||''));page=Math.max(0,Math.floor(selected/PAGE_SIZE));el('detail-project-search-wrap').hidden=projects.length<7;menu.hidden=false;button.setAttribute('aria-expanded','true');draw();(el('detail-project-options').querySelector('[aria-checked=true]')||el('detail-project-options').querySelector('button'))?.focus({preventScroll:true})}
  button.addEventListener('click',()=>menu.hidden?open():close(true));button.addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();open()}});
  search.addEventListener('input',()=>{page=0;draw()});
  el('detail-project-prev').addEventListener('click',()=>{page--;draw()});el('detail-project-next').addEventListener('click',()=>{page++;draw()});
  el('detail-project-new').addEventListener('click',()=>{const id=currentItem()?.id;close();if(id)showProjectForm(id)});
  menu.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(search.value){search.value='';page=0;draw();search.focus({preventScroll:true})}else close(true);return}
    if(e.target===search&&!['ArrowDown','ArrowUp'].includes(e.key))return;
    if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const options=[...el('detail-project-options').querySelectorAll('button'),el('detail-project-new')],index=options.indexOf(document.activeElement);options[e.key==='Home'?0:e.key==='End'?options.length-1:index<0?(e.key==='ArrowUp'?options.length-1:0):(index+(e.key==='ArrowUp'?-1:1)+options.length)%options.length]?.focus({preventScroll:true})}
    if(e.key==='Tab'){e.preventDefault();close(true);if(!e.shiftKey)el('detail-title').focus({preventScroll:true})}
  });
  document.addEventListener('pointerdown',e=>{if(!menu.hidden&&!menu.contains(e.target)&&!button.contains(e.target))close()});window.addEventListener('open-sesame-view-changed',()=>close());window.addEventListener('open-sesame-projects-changed',()=>{sync();if(!menu.hidden)draw()});window.addEventListener('open-sesame-layout',()=>{if(!menu.hidden)position()});window.addEventListener('resize',()=>{if(!menu.hidden)position()});
  window.OpenSesameItemHeader={sync,close};sync();
})();
