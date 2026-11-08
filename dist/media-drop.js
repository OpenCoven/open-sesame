'use strict';
(()=>{
  const el=id=>document.getElementById(id),pane=el('pane-media'),zone=document.createElement('div'),label=document.createElement('span');
  zone.id='media-dropzone';zone.setAttribute('role','region');zone.setAttribute('aria-label','Media drop zone');label.id='media-drop-label';label.textContent='Drop audio or video files or a folder here';zone.append(label,el('media-choose'));pane.insertBefore(zone,el('media-workspace'));el('media-choose').title='Choose audio or video files';
  let depth=0,loading=false;
  const fileDrag=event=>Array.from(event.dataTransfer?.types||[]).includes('Files');
  function highlight(active){pane.classList.toggle('media-drop-active',active);label.textContent=active?'Release to add media to your playlist':'Drop audio or video files or a folder here'}
  async function dropped(transfer){
    const direct=Array.from(transfer.files||[]),roots=Array.from(transfer.items||[]).map(item=>item.webkitGetAsEntry?.()).filter(Boolean),files=[];let folder=false;
    async function visit(entry,prefix='',level=0){
      if(files.length>=2000||level>12)throw Error('Drop fewer than 2,000 files with a shallower folder structure.');
      if(entry.isFile){const file=await new Promise((resolve,reject)=>entry.file(resolve,reject));if(prefix)try{Object.defineProperty(file,'webkitRelativePath',{value:prefix+file.name})}catch{}files.push(file)}
      else if(entry.isDirectory){folder=true;const reader=entry.createReader();for(;;){const entries=await new Promise((resolve,reject)=>reader.readEntries(resolve,reject));if(!entries.length)break;for(const child of entries)await visit(child,prefix+entry.name+'/',level+1)}}
    }
    if(roots.length)for(const entry of roots)await visit(entry);else files.push(...direct);
    return {files,folder};
  }
  pane.addEventListener('dragenter',event=>{if(!fileDrag(event))return;event.preventDefault();depth++;highlight(true)});
  pane.addEventListener('dragover',event=>{if(!fileDrag(event))return;event.preventDefault();event.dataTransfer.dropEffect='copy';highlight(true)});
  pane.addEventListener('dragleave',event=>{if(!fileDrag(event))return;depth=Math.max(0,depth-1);if(!depth)highlight(false)});
  pane.addEventListener('drop',async event=>{
    if(!fileDrag(event))return;event.preventDefault();event.stopPropagation();depth=0;highlight(false);if(loading)return;loading=true;zone.setAttribute('aria-busy','true');
    try{const {files,folder}=await dropped(event.dataTransfer);if(!files.length){toast('No readable media files were dropped.');return}window.OpenSesameLocalMedia.addFiles(files,{folder,append:true})}
    catch(error){toast(error.message||'Could not open the dropped files. Choose them with the file picker instead.')}
    finally{loading=false;zone.setAttribute('aria-busy','false')}
  });
  const close=document.createElement('button');close.type='button';close.className='media-overlay-close';close.setAttribute('aria-label','Close playlist');close.title='Close playlist';close.innerHTML=icon('close');close.addEventListener('click',()=>{window.OpenSesameRails.set('media',false);el('media-queue-toggle').focus({preventScroll:true})});el('media-queue').append(close);
  pane.addEventListener('keydown',event=>{if(event.key==='Escape'&&el('media-workspace').classList.contains('rail-overlay')&&!el('media-queue').hidden){event.preventDefault();window.OpenSesameRails.set('media',false);el('media-queue-toggle').focus({preventScroll:true})}});
  window.OpenSesameMediaDrop={dropped};
})();
