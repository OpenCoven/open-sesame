'use strict';
(()=>{
  const el=id=>document.getElementById(id),cache=new Map();let active='',generation=0,currentRepo=null,view='overview',path='';
  function repoUrl(raw){try{const u=new URL(raw),parts=u.pathname.replace(/\/$/,'').split('/').filter(Boolean);if(u.protocol!=='https:'||u.hostname.toLowerCase()!=='github.com'||u.username||u.password||u.port||parts.length!==2)return null;const owner=parts[0],repo=parts[1].replace(/\.git$/,'');if(!/^[A-Za-z0-9-]{1,39}$/.test(owner)||!/^[A-Za-z0-9_.-]{1,100}$/.test(repo)||repo==='.'||repo==='..')return null;return {owner,repo,key:owner+'/'+repo,base:'https://github.com/'+owner+'/'+repo}}catch{return null}}
  const api=async(repo,suffix='')=>{const url='https://api.github.com/repos/'+encodeURIComponent(repo.owner)+'/'+encodeURIComponent(repo.repo)+suffix;if(!cache.has(url)){const promise=OpenSesameContent.fetchText(url).then(r=>JSON.parse(r.text));cache.set(url,promise);promise.catch(()=>cache.delete(url))}return cache.get(url)};
  function message(text,error=false){const p=document.createElement('p');p.className='github-message'+(error?' error':'');p.textContent=text;el('github-body').replaceChildren(p)}
  function decode(file){if(file.encoding!=='base64'||typeof file.content!=='string')throw new Error('This file is not available as text. Open it on GitHub.');if(file.size>262144)throw new Error('Files over 256 KB open on GitHub.');return new TextDecoder().decode(Uint8Array.from(atob(file.content.replace(/\s/g,'')),c=>c.charCodeAt(0)))}
  function errorText(error){const m=String(error.message||error);return /403|429/.test(m)?'GitHub’s public API limit was reached. Try again later or open the repository.':/404/.test(m)?'This repository or file is unavailable through GitHub’s public API. Private repositories open on GitHub.':m}
  function tabs(){document.querySelectorAll('[data-github-view]').forEach(b=>{const yes=b.dataset.githubView===view;b.setAttribute('aria-selected',yes);b.tabIndex=yes?0:-1});el('github-path').hidden=view!=='files';el('github-path').textContent=path||'Repository';el('github-back').hidden=view!=='files'||!path}
  let imageView=null,imageTrigger=null;
  function closeImage(){if(!imageView)return;imageView.remove();imageView=null;if(imageTrigger?.isConnected)imageTrigger.focus({preventScroll:true});imageTrigger=null}
  function openImage(image,trigger){
    closeImage();imageTrigger=trigger;
    const panel=document.createElement('div');panel.className='github-image-view';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label',image.alt||'Repository image');
    const tools=document.createElement('div'),label=document.createElement('span'),zoom=document.createElement('button'),original=document.createElement('a'),close=document.createElement('button'),stage=document.createElement('div'),copy=document.createElement('img');
    tools.className='github-image-tools';label.textContent=image.alt||'Image';zoom.type=close.type='button';zoom.textContent='Actual size';zoom.setAttribute('aria-pressed','false');original.href=image.currentSrc||image.src;original.target='_blank';original.rel='noopener noreferrer';original.innerHTML=icon('arrow-up-right');original.ariaLabel=original.title='Open original image';close.innerHTML=icon('close');close.ariaLabel=close.title='Close image';
    copy.src=image.currentSrc||image.src;copy.alt=image.alt;copy.referrerPolicy='no-referrer';stage.className='github-image-stage';stage.tabIndex=0;stage.ariaLabel='Image, scroll to pan';stage.append(copy);tools.append(label,zoom,original,close);panel.append(tools,stage);el('github-viewer').append(panel);imageView=panel;
    zoom.addEventListener('click',()=>{const actual=panel.classList.toggle('actual');zoom.textContent=actual?'Fit image':'Actual size';zoom.setAttribute('aria-pressed',String(actual))});close.addEventListener('click',closeImage);
    close.focus({preventScroll:true});
  }
  function polish(){
    const host=el('github-body');
    for(const table of host.querySelectorAll('table')){if(table.parentElement.classList.contains('github-table-scroll'))continue;const wrap=document.createElement('div');wrap.className='github-table-scroll';wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.ariaLabel='Repository table, scroll horizontally';table.before(wrap);wrap.append(table)}
    for(const pre of host.querySelectorAll('pre')){pre.tabIndex=0;pre.setAttribute('role','region');pre.ariaLabel='Code, scroll horizontally'}
    for(const image of host.querySelectorAll('img')){
      image.decoding='async';
      const ready=()=>{
        const badge=image.naturalHeight<=40||/shields\.io|badge|badgen\.net/.test(image.src);
        if(badge){image.classList.add('github-badge');return}
        const target=image.closest('a')||image;
        target.tabIndex=0;target.setAttribute('role','button');target.setAttribute('aria-haspopup','dialog');target.setAttribute('aria-label','Enlarge '+(image.alt||'repository image'));target.classList.add('github-zoomable');
        target.addEventListener('click',event=>{event.preventDefault();openImage(image,target)});
        target.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();openImage(image,target)}});
      };
      if(image.complete&&image.naturalWidth)ready();else image.addEventListener('load',ready,{once:true});
      const failed=()=>{const link=document.createElement('a');link.href=image.src;link.target='_blank';link.rel='noopener noreferrer';link.className='github-image-failed';link.textContent=(image.alt||'Image')+' · Open image';const existing=image.closest('a');if(existing)existing.replaceWith(link);else image.replaceWith(link)};
      if(image.complete&&!image.naturalWidth)failed();else image.addEventListener('error',failed,{once:true});
    }
  }
  document.addEventListener('keydown',event=>{
    if(!imageView)return;
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeImage()}
    if(event.key==='Tab'){const targets=[...imageView.querySelectorAll('button,a,[tabindex="0"]')],i=targets.indexOf(document.activeElement);event.preventDefault();targets[(i+(event.shiftKey?-1:1)+targets.length)%targets.length].focus()}
  },true);
  async function show(){
    if(!currentRepo)return;closeImage();const repo=currentRepo,token=++generation;tabs();message(view==='overview'?'Loading README…':'Loading files…');
    try{if(view==='overview'){let file;try{file=await api(repo,'/readme')}catch(error){if(/404/.test(error.message)){if(token===generation)message('This repository has no README. Explore its files.');return}throw error}if(token!==generation)return;el('github-body').replaceChildren(OpenSesameContent.githubMarkdown(decode(file),repo.key,repo.branch||'HEAD',file.path||'README.md'));}
      else{const data=await api(repo,'/contents/'+path.split('/').map(encodeURIComponent).join('/')+'?ref='+encodeURIComponent(repo.branch||'HEAD'));if(token!==generation)return;el('github-body').replaceChildren();if(Array.isArray(data)){const list=document.createElement('div');list.className='github-files';for(const file of data.sort((a,b)=>(a.type==='dir'?0:1)-(b.type==='dir'?0:1)||a.name.localeCompare(b.name))){const button=document.createElement('button');button.type='button';button.innerHTML=icon(file.type==='dir'?'folder':'items');const name=document.createElement('span');name.textContent=file.name;button.append(name);button.title=file.path;button.addEventListener('click',()=>{path=file.path;show()});list.append(button)}el('github-body').append(list)}else{if(data.type!=='file')throw new Error('This entry opens on GitHub.');if(/\.(?:png|jpe?g|gif|webp|avif|svg|bmp)$/i.test(data.name)){const image=document.createElement('img');image.src=OpenSesameContent.githubAsset(data.download_url||('/'+path),repo.key,repo.branch||'HEAD',path);image.alt=data.name;image.referrerPolicy='no-referrer';el('github-body').append(image)}else{const text=decode(data);if(/\.(?:md|markdown)$/i.test(data.name)){el('github-body').append(OpenSesameContent.githubMarkdown(text,repo.key,repo.branch||'HEAD',path))}else{if(text.includes('\u0000'))throw new Error('Binary files open on GitHub.');const pre=document.createElement('pre'),code=document.createElement('code');code.textContent=text;pre.append(code);el('github-body').append(pre)}}}}polish();el('github-body').scrollTop=0;
    }catch(error){if(token===generation)message(errorText(error),true)}
  }
  async function render(url,visible){
    const repo=repoUrl(url);el('github-viewer').hidden=!repo;if(!repo||!visible){closeImage();if(active){generation++;active=''}return !!repo}if(active===repo.key)return true;active=repo.key;currentRepo=repo;view='overview';path='';el('github-repo-name').textContent=repo.key;el('github-repo-meta').textContent='Public repository';el('github-repo-description').hidden=true;message('Loading repository…');
    try{const data=await api(repo);if(active!==repo.key)return true;currentRepo.branch=data.default_branch||'HEAD';el('github-repo-meta').textContent=[data.language,data.stargazers_count!=null?'★ '+Intl.NumberFormat(undefined,{notation:'compact'}).format(data.stargazers_count):''].filter(Boolean).join(' · ')||'Repository';el('github-repo-description').textContent=data.description||'';el('github-repo-description').hidden=!data.description}catch{}if(active===repo.key)show();return true;
  }
  document.querySelectorAll('[data-github-view]').forEach(b=>b.addEventListener('click',()=>{view=b.dataset.githubView;path='';show()}));el('github-back').addEventListener('click',()=>{path=path.split('/').slice(0,-1).join('/');show()});el('github-retry').addEventListener('click',()=>{if(currentRepo){for(const key of cache.keys())if(key.includes('/'+currentRepo.key))cache.delete(key);show()}});
  window.OpenSesameGitHub={render,isRepo:raw=>!!repoUrl(raw)};
})();
