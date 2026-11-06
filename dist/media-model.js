'use strict';
(()=>{
  const audio=/\.(mp3|m4a|aac|wav|wave|ogg|oga|opus|flac|aif|aiff|weba)$/i,video=/\.(mp4|m4v|webm|mov|ogv|mpeg|mpg)$/i;
  const kind=file=>/^audio\//.test(file.type||'')||audio.test(file.name||'')?'audio':/^video\//.test(file.type||'')||video.test(file.name||'')?'video':'';
  function build(files,folder=false){const seen=new Set(),entries=[];let skipped=0;for(const file of files){const path=file.webkitRelativePath||file.name||'',type=kind(file);if(!type||path.split('/').some(p=>p.startsWith('.'))){skipped++;continue}const key=path+'\0'+file.size+'\0'+file.lastModified;if(seen.has(key)){skipped++;continue}seen.add(key);entries.push({file,path,title:file.name,kind:type,key})}if(folder)entries.sort((a,b)=>a.path.localeCompare(b.path,undefined,{numeric:true,sensitivity:'base'}));return {entries,skipped,name:folder?entries[0]?.path.split('/')[0]||'Folder':'Selected files'}}
  function next(index,count,{direction=1,repeat='off',ended=false}={}){if(!count)return -1;if(ended&&repeat==='one')return index;const target=index+direction;if(target>=0&&target<count)return target;return repeat==='all'?(target+count)%count:-1}
  const filter=(entries,query)=>{const terms=String(query||'').toLowerCase().trim().split(/\s+/).filter(Boolean);return entries.map((entry,index)=>({entry,index})).filter(({entry})=>terms.every(term=>(entry.title+' '+entry.path).toLowerCase().includes(term)))};
  window.OpenSesameMediaModel={kind,build,next,filter};
})();
