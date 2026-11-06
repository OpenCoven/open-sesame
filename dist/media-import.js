'use strict';
(function(root){
  async function collect(transfer,{limit=1000}={}){
    const fallback=Array.from(transfer.files||[]),entries=Array.from(transfer.items||[]).filter(item=>item.kind==='file').map(item=>item.webkitGetAsEntry?.()).filter(Boolean),files=[];let truncated=false;
    async function visit(entry,path=''){
      if(files.length>=limit){truncated=true;return}
      if(entry.isFile){const file=await new Promise((resolve,reject)=>entry.file(resolve,reject));if(path)Object.defineProperty(file,'webkitRelativePath',{value:path+file.name,configurable:true});files.push(file)}
      else if(entry.isDirectory){const reader=entry.createReader();for(;;){const batch=await new Promise((resolve,reject)=>reader.readEntries(resolve,reject));if(!batch.length)break;for(const child of batch){await visit(child,path+entry.name+'/');if(files.length>=limit){truncated=true;return}}}}
    }
    if(entries.length)for(const entry of entries)await visit(entry);else files.push(...fallback.slice(0,limit));
    return {files,folder:entries.some(entry=>entry.isDirectory),truncated:truncated||fallback.length>limit};
  }
  root.OpenSesameMediaImport={collect};
  if(typeof document==='undefined')return;
  const card=document.querySelector('#focus-overview .media-tile'),pane=document.getElementById('pane-media'),status=document.getElementById('bento-drop-status');
  for(const zone of [card,pane]){
    let depth=0,busy=false;const isFiles=event=>Array.from(event.dataTransfer?.types||[]).includes('Files');
    zone.addEventListener('dragenter',event=>{if(!isFiles(event))return;event.preventDefault();depth++;zone.classList.add('media-drop-active');zone.dataset.dropLabel='Drop to add to your playlist'});
    zone.addEventListener('dragover',event=>{if(!isFiles(event))return;event.preventDefault();event.dataTransfer.dropEffect=busy?'none':'copy'});
    zone.addEventListener('dragleave',()=>{depth=Math.max(0,depth-1);if(!depth)zone.classList.remove('media-drop-active')});
    zone.addEventListener('drop',async event=>{
      if(!isFiles(event))return;event.preventDefault();event.stopPropagation();depth=0;zone.classList.remove('media-drop-active');if(busy)return;busy=true;zone.setAttribute('aria-busy','true');status.textContent='Reading your files…';
      try{const result=await collect(event.dataTransfer),playable=result.files.filter(file=>OpenSesameMediaModel.kind(file));if(!playable.length)throw Error('No supported audio or video files found.');OpenSesameLocalMedia.addFiles(playable,{folder:result.folder,append:true});status.textContent=playable.length+' media files ready'+(result.truncated?' · first 1,000 files inspected':'');toast(status.textContent)}catch(error){status.textContent=error.message||'Could not read these files. Try Choose files.';toast(status.textContent)}finally{busy=false;zone.removeAttribute('aria-busy')}
    });
  }
})(typeof window==='undefined'?globalThis:window);
