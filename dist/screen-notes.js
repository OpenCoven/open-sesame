'use strict';
(()=>{
  const el=id=>document.getElementById(id),dialog=el('screen-notes-dialog'),sheet=el('screen-notes-sheet'),note=el('screen-notes-body'),status=el('screen-notes-status'),save=el('screen-notes-save');
  const native=()=>window.__OPEN_SESAME_NATIVE__===true;
  let generation=0,busy=false,projectId='',returnFocus=null,source='',requestContext='',dirty=false,pendingKind='';
  function error(message=''){el('screen-notes-error').textContent=message;el('screen-notes-error').hidden=!message}
  function controls(){save.disabled=busy||!note.value.trim();el('screen-notes-capture').disabled=busy||!native();el('screen-notes-import').disabled=busy;note.disabled=busy;el('screen-notes-title').disabled=busy}
  function close(){
    el('screen-notes-replace-prompt').hidden=true;pendingKind='';generation++;if(busy&&native())openSesameBridge.request('screen.notes.cancel').catch(()=>{});busy=false;controls();sheet.hidden=true;if(dialog.open)dialog.close();
    if(returnFocus?.isConnected&&state.expanded)returnFocus.focus({preventScroll:true});
  }
  function open(request=''){
    if(dialog.open){note.focus();return true}
    window.OpenSesameLauncher?.close(true);if(!state.expanded)setExpanded(true);
    returnFocus=document.activeElement;
    if(!note.value.trim()){projectId=['all','inbox'].includes(projectFilter)?'':projectFilter;source='';dirty=false;requestContext=request.trim().slice(0,1500);if(requestContext)note.value='## Context\n\n'+requestContext+'\n\n';}
    el('screen-notes-project').textContent=projectName(projectId);el('screen-notes-capture').hidden=!native();
    status.textContent=source?'Draft kept for review':native()?'Capture a screen or choose a screenshot.':'Choose an image and add your notes. Text recognition is available in the Mac app.';
    error();sheet.hidden=false;controls();dialog.showModal();(native()?el('screen-notes-capture'):el('screen-notes-import')).focus();return true;
  }
  function apply(result){
    if(!result||typeof result.preview!=='string'||!/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(result.preview)||result.preview.length>5500000)throw Error('The captured image could not be previewed.');
    source=String(result.source||'Screen').replace(/[\r\n]/g,' ').slice(0,100);el('screen-notes-image').src=result.preview;el('screen-notes-preview').hidden=false;el('screen-notes-image-label').textContent=source;
    const text=String(result.text||'').slice(0,10000),context=requestContext?'## Context\n\n'+requestContext:'';dirty=false;
    el('screen-notes-title').value='Screen notes · '+source;
    note.value='# Screen notes\n\n'+source+' · '+new Date().toLocaleString()+'\n\n'+(text?'## Visible text\n\n'+text+'\n\n':'## Notes\n\n')+(context?'\n'+context+'\n':'');
    status.textContent=text?'Text extracted on this Mac. Review before saving.':'No text extracted. Add your notes below.';
  }
  async function acquire(kind,confirmed=false){
    if(busy)return;
    if(!confirmed&&(source||dirty)&&note.value.trim()){pendingKind=kind;el('screen-notes-replace-prompt').hidden=false;return}
    pendingKind='';el('screen-notes-replace-prompt').hidden=true;
    if(!native()){el('screen-notes-file').click();return}
    const ticket=++generation;busy=true;controls();error();status.textContent=kind==='capture'?'Choose a screen in the confirmation…':'Choose a screenshot…';
    try{const result=await openSesameBridge.request('screen.notes.'+kind);if(ticket!==generation)return;if(result?.cancelled){status.textContent='Cancelled. Your draft is kept.';return}apply(result)}
    catch(e){if(ticket===generation){error(e.message||'Screen notes unavailable.');status.textContent='Your draft is kept.'}}
    finally{if(ticket===generation){busy=false;controls()}}
  }
  el('screen-notes-file').addEventListener('change',async event=>{
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>20000000){error('Choose a PNG, JPEG or WebP image under 20 MB.');return}
    const ticket=++generation;busy=true;controls();error();status.textContent='Reading image…';let bitmap;
    try{
      bitmap=await createImageBitmap(file);if(ticket!==generation)return;
      if(!bitmap.width||!bitmap.height||bitmap.width>16000||bitmap.height>16000||bitmap.width*bitmap.height>40000000)throw Error('Choose an image under 40 megapixels.');
      const canvas=document.createElement('canvas'),scale=Math.min(1,1280/Math.max(bitmap.width,bitmap.height));canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      const context=canvas.getContext('2d');if(!context)throw Error('Image preview is unavailable.');context.drawImage(bitmap,0,0,canvas.width,canvas.height);
      // Re-encode decoded pixels; never mount an arbitrary selected file as an active URL.
      el('screen-notes-image').src=canvas.toDataURL('image/jpeg',0.75);source='Imported image';el('screen-notes-preview').hidden=false;el('screen-notes-image-label').textContent=source;
      status.textContent='Image opened locally. Add your notes; automatic text recognition needs the Mac app.';
    }catch(e){if(ticket===generation)error(e.message||'Choose a readable image.');}
    finally{bitmap?.close();if(ticket===generation){busy=false;controls()}}

  });
  save.addEventListener('click',async ()=>{
    const body=note.value.trim();if(!body||busy)return;
    if(activeItems().length>=30||items.length>=300){error('Make room in Projects to save these notes.');return}
    if(projectId&&!projects.some(p=>p.id===projectId)){error('This project is unavailable. Your draft is kept.');return}
    const title=el('screen-notes-title').value.trim()||'Screen notes',item={id:newId(),kind:'note',title,text:title,body,url:'',projectId,done:false,createdAt:Date.now()};
    items.push(item);if(!(await saveItems())){const index=items.indexOf(item);if(index>=0)items.splice(index,1);error('Could not save. Your draft is kept.');return}
    close();note.value='';source='';requestContext='';dirty=false;el('screen-notes-title').value='Screen notes';el('screen-notes-preview').hidden=true;el('screen-notes-image').removeAttribute('src');
    switchProject(projectId||'inbox');categoryFilter='note';expandedCategories.clear();expandedCategories.add('note');changeScenario('items');openItem(item.id);toast('Screen notes saved.');
  });
  el('screen-notes-capture').addEventListener('click',async ()=>acquire('capture'));el('screen-notes-import').addEventListener('click',async ()=>acquire('import'));
  el('screen-notes-close').addEventListener('click',close);el('screen-notes-cancel').addEventListener('click',close);el('capture-screen-context').addEventListener('click',async ()=>open());note.addEventListener('input',async ()=>{dirty=true;controls()});
  el('screen-notes-replace').addEventListener('click',async ()=>{if(pendingKind)acquire(pendingKind,true)});el('screen-notes-keep').addEventListener('click',async ()=>{pendingKind='';el('screen-notes-replace-prompt').hidden=true});
  dialog.addEventListener('cancel',async event=>{event.preventDefault();close()});
  window.addEventListener('open-sesame-layout',async ()=>{if(!state.expanded&&dialog.open)close()});
  window.addEventListener('pagehide',close);
  window.OpenSesameScreenNotes={open,close};
})();
