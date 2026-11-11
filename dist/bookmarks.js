'use strict';
(()=>{
  const el=id=>document.getElementById(id),model=window.OpenSesameBookmarkModel,dialog=el('bookmark-batch');let parsed=null,page=0,returnFocus=null,copying=false,background=[];
  const scopeName=()=>projectFilter==='all'?'All projects':projectFilter==='inbox'?'Inbox':projectName(projectFilter);
  // Keep the embedded page's wheel, touch and keyboard scrolling handles intact.
  // Independent sandboxed pages paint their own scrollbar. Mask only the platform gutter.
  const viewport=el('bookmark-embed-wrap');
  function matchScrollbar(){
    const probe=document.createElement('div');
    probe.style.cssText='position:absolute;visibility:hidden;pointer-events:none;width:100px;height:30px;overflow:scroll;border:0;padding:0';
    document.body.append(probe);
    const width=probe.offsetWidth-probe.clientWidth;
    probe.remove();
    viewport.style.setProperty('--bookmark-gutter',width+'px');
    viewport.classList.toggle('has-gutter',width>0&&!window.__OPEN_SESAME_NATIVE__);
  }
  matchScrollbar();window.addEventListener('resize',matchScrollbar);
  function sync(){const urls=model.exportUrls(items,projectFilter),button=el('copy-project-bookmarks');button.disabled=!urls.length;button.title=button.getAttribute('aria-label')||'';const label=`Copy ${urls.length} saved bookmark${urls.length===1?'':'s'} · ${scopeName()}`;button.title=label;button.setAttribute('aria-label',label)}
  function close(){dialog.hidden=true;parsed=null;background.forEach(([node,inert])=>node.inert=inert);background=[];const target=returnFocus?.isConnected?returnFocus:el('capture-input');target.focus({preventScroll:true})}
  function show(){returnFocus=document.activeElement;dialog.hidden=false;background=[...el('widget-panel').children].filter(node=>node!==dialog).map(node=>[node,node.inert]);background.forEach(([node])=>node.inert=true);window.openSesameCapture?.hide()}
  function review(){
    if(dialog.hidden||!parsed)return;const id=el('bookmark-batch-project').value,plan=model.plan(parsed.urls,items,id),active=activeItems().length;
    const limit=active+plan.fresh.length>30?'Not enough space: '+Math.max(0,30-active)+' active slots available. Archive items first.':items.length+plan.fresh.length>300?'Your archive is full. Remove archived items first.':'';
    el('bookmark-batch-title').textContent='Save '+plan.fresh.length+' bookmark'+(plan.fresh.length===1?'':'s');
    el('bookmark-batch-note').textContent=[parsed.duplicates?parsed.duplicates+' repeated links removed':'',plan.existing?plan.existing+' already saved in this project (including archived)':'',parsed.skipped?parsed.skipped+' non-link parts will be skipped':''].filter(Boolean).join(' · ')||'One bookmark per link. HTTPS is assumed unless specified.';
    el('bookmark-batch-error').textContent=limit;el('bookmark-batch-error').hidden=!limit;el('bookmark-batch-save').disabled=!!limit||!plan.fresh.length;el('bookmark-batch-save').textContent='Save '+plan.fresh.length;
    const capacity=Math.max(1,Math.floor((el('bookmark-batch-list').clientHeight||120)/28)),pages=Math.max(1,Math.ceil(parsed.urls.length/capacity));page=Math.min(page,pages-1);
    const list=el('bookmark-batch-list');list.replaceChildren();parsed.urls.slice(page*capacity,(page+1)*capacity).forEach(url=>{const row=document.createElement('li'),mark=document.createElement('i'),copy=document.createElement('span');mark.innerHTML=icon(plan.fresh.includes(url)?'bookmark':'check');copy.textContent=url;row.title=url;row.append(mark,copy);list.append(row)});
    el('bookmark-batch-page').textContent=(page+1)+' / '+pages;el('bookmark-batch-prev').disabled=!page;el('bookmark-batch-next').disabled=page>=pages-1;el('bookmark-batch-pages').hidden=pages===1;
  }
  function open(batch){parsed=batch;page=0;el('bookmark-batch-review').hidden=false;el('bookmark-export').hidden=true;el('bookmark-batch-save').hidden=false;el('bookmark-batch-project-label').hidden=false;
    el('bookmark-batch-project').replaceChildren(option('','Inbox'),...projects.map(p=>option(p.id,p.name)));const id=el('capture-project').value;el('bookmark-batch-project').value=projects.some(p=>p.id===id)?id:'';show();review();el('bookmark-batch-project').focus({preventScroll:true})}
  el('copy-project-bookmarks').addEventListener('click',async()=>{
    if(copying)return;const urls=model.exportUrls(items,projectFilter);if(!urls.length)return;copying=true;const name=scopeName(),text=urls.join('\n');
    try{if(!navigator.clipboard?.writeText)throw new Error('Clipboard unavailable');await navigator.clipboard.writeText(text);toast(urls.length+' bookmark'+(urls.length===1?'':'s')+' copied · '+name)}catch{
      if(!dialog.hidden){toast('Clipboard access is unavailable. Close this preview and try copying again.');return}
      parsed=null;el('bookmark-batch-title').textContent='Copy bookmarks · '+name;el('bookmark-batch-review').hidden=true;el('bookmark-export').hidden=false;el('bookmark-batch-save').hidden=true;el('bookmark-batch-project-label').hidden=true;el('bookmark-batch-error').hidden=true;el('bookmark-batch-note').textContent='Clipboard access is unavailable. Your links are selected; press ⌘C or Ctrl+C.';el('bookmark-export').value=text;show();el('bookmark-export').focus();el('bookmark-export').select();
    }finally{copying=false}
  });
  el('bookmark-batch-save').addEventListener('click',async ()=>{if(!parsed||el('bookmark-batch-save').disabled)return;const result=await saveBookmarkBatch(parsed.urls,el('bookmark-batch-project').value);if(result.ok){close();el('capture-input').focus({preventScroll:true})}else{review();el('bookmark-batch-error').textContent=result.error;el('bookmark-batch-error').hidden=false}});
  el('bookmark-batch-project').addEventListener('change',async ()=>{page=0;review()});el('bookmark-batch-close').addEventListener('click',close);el('bookmark-batch-cancel').addEventListener('click',close);
  el('bookmark-batch-prev').addEventListener('click',async ()=>{page=Math.max(0,page-1);review()});el('bookmark-batch-next').addEventListener('click',async ()=>{page++;review()});
  dialog.addEventListener('keydown',async event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close()}if(event.key==='Tab'){const nodes=[...dialog.querySelectorAll('button,select,textarea')].filter(n=>!n.disabled&&!n.hidden&&n.getClientRects().length);const first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}});
  new ResizeObserver(review).observe(el('bookmark-batch-list'));window.OpenSesameBookmarks={open,sync};sync();
})();
