'use strict';
(() => {
  const el=id=>document.getElementById(id),sheet=el('screen-notes-sheet');
  const note=el('screen-notes-body'),status=el('screen-notes-status'),save=el('screen-notes-save');
  let timer=null,projectId='',returnFocus=null;
  function close(){
    clearTimeout(timer);timer=null;sheet.hidden=true;
    if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});
  }
  function open(request=''){
    clearTimeout(timer);
    returnFocus=document.activeElement;
    projectId=['all','inbox'].includes(projectFilter)?'':projectFilter;
    el('screen-notes-project').textContent=projectName(projectId);
    note.value='';note.disabled=true;save.disabled=true;
    el('screen-notes-error').hidden=true;
    sheet.hidden=false;status.textContent='Preparing demo screen…';
    window.openSesameCapture?.hide();el('screen-notes-close').focus({preventScroll:true});
    timer=setTimeout(()=>{
      status.textContent='Drafting sample notes…';
      timer=setTimeout(()=>{
        timer=null;note.disabled=false;save.disabled=false;status.textContent='Ready to review';
        note.value='# Screen review\n\nDemo screen · placeholder analysis. No screen was captured.\n\n![Demo workspace](assets/screen-notes-demo.svg)\n\n## On the sample screen\n- A research draft is open alongside a short project checklist.\n- The next tasks are to review the paper and organize the notes.\n\n## Suggested next steps\n- Record the main finding and any unanswered questions.\n- Save relevant references to the project.\n'+(request.trim()?'\n## Your request\n'+request.trim().slice(0,2000)+'\n':'');
      },600);
    },400);
    return true;
  }
  save.addEventListener('click',()=>{
    const body=note.value.trim();if(!body||save.disabled)return;
    if(activeItems().length>=30||items.length>=300){el('screen-notes-error').textContent='Make room in Projects to save these notes.';el('screen-notes-error').hidden=false;return}
    if(projectId&&!projects.some(p=>p.id===projectId)){el('screen-notes-error').textContent='This project is unavailable. Reopen Screen notes in another project.';el('screen-notes-error').hidden=false;return}
    const title='Screen notes · demo',item={id:newId(),kind:'note',title,text:title,body,url:'',projectId,done:false,createdAt:Date.now()};
    items.push(item);if(!saveItems()){items.pop();el('screen-notes-error').textContent='Could not save. Your draft is still here.';el('screen-notes-error').hidden=false;return}
    close();switchProject(projectId||'inbox');categoryFilter='note';expandedCategories.clear();expandedCategories.add('note');changeScenario('items');openItem(item.id);toast('Demo screen notes saved.');
  });
  el('screen-notes-close').addEventListener('click',close);
  el('screen-notes-cancel').addEventListener('click',close);
  el('capture-screen-context').addEventListener('click',()=>open());
  sheet.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close()}
  });
  window.addEventListener('pagehide',close);
  window.OpenSesameScreenNotes={open};
})();
