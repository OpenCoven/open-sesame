'use strict';
(() => {
  const el=id=>document.getElementById(id);
  const root=el('pdf-viewer'), viewport=el('pdf-viewport'), prose=el('pdf-prose'), canvas=el('pdf-canvas');
  const LIMIT=24*1024*1024, steps=[0.85,1,1.15,1.3,1.5,1.75,2], key='open-sesame-pdf-reader-v1';
  let records={};try{records=JSON.parse(localStorage.getItem(key))||{}}catch{}
  let engine, session=null, generation=0, renderId=0, painting=null, resizeFrame=0, lastWidth=0, localCopy=null;

  function script(path) {
    return new Promise((resolve,reject)=>{
      const tag=document.createElement('script');tag.src=path;tag.onload=resolve;tag.onerror=()=>reject(Error('The PDF reader could not load.'));document.head.append(tag);
    });
  }
  function library() {
    if(!engine)engine=(async()=>{
      if(location.protocol==='file:')await script('vendor/pdfjs/pdf.worker.js');
      await script('vendor/pdfjs/pdf.js');
      pdfjsLib.GlobalWorkerOptions.workerSrc=new URL('vendor/pdfjs/pdf.worker.js',document.baseURI).href;
      return pdfjsLib;
    })().catch(error=>{engine=null;throw error});
    return engine;
  }
  function remember() {
    if(!session)return;
    const {url,page,mode,size}=session;
    records=Object.fromEntries([...Object.entries(records).filter(([id])=>id!==url).slice(-79),[url,{page,mode,size}]]);
    try{localStorage.setItem(key,JSON.stringify(records))}catch{}
  }
  function message(text, fallback=false){
    el('pdf-status-row').hidden=!text;
    el('pdf-status').textContent=text;
    el('pdf-local-open').hidden=el('pdf-retry').hidden=!fallback;
  }
  function frameUrl(url) {
    const target=new URL(url);target.hash='toolbar=0&navpanes=0&view=FitH';return target.href;
  }
  function focus(value) {
    el('pane-reading').classList.toggle('pdf-expanded',value);
    const b=el('pdf-expand');b.setAttribute('aria-pressed',String(value));
    b.title=value?'Restore reading layout':'Expand reading area';b.setAttribute('aria-label',b.title);
  }
  const richText=s=>s?.mode==='text'&&s.rich;
  const pageCount=s=>richText(s)?s.rich.sections.length:s.doc?.numPages||1;
  function controls(){
    const s=session;if(!s)return;
    const loaded=!!s.doc||!!richText(s);
    el('pdf-page-number').value=String(s.page);el('pdf-page-number').disabled=!loaded;
    el('pdf-page-total').textContent=loaded?' / '+pageCount(s):'';
    el('pdf-prev').disabled=!loaded||s.page<=1;el('pdf-next').disabled=!loaded||s.page>=pageCount(s);
    el('pdf-smaller').disabled=!loaded||s.size===0;el('pdf-larger').disabled=!loaded||s.size===steps.length-1;
    el('pdf-text-mode').disabled=!s.doc&&!s.rich;el('pdf-page-mode').disabled=!s.doc;
    el('pdf-page-number').setAttribute('aria-label',richText(s)?'Paper section':'PDF page');
    for(const mode of ['text','page'])el('pdf-'+mode+'-mode').setAttribute('aria-pressed',String(s.mode===mode&&!s.fallback));
    el('pdf-original').href=s.url;
    root.classList.toggle('pdf-fallback',!!s.fallback);
  }
  function close(){
    ++generation;++renderId;cancelAnimationFrame(resizeFrame);
    painting?.cancel();painting=null;
    session?.abort.abort();session?.task?.destroy()?.catch(()=>{});session=null;
    root.hidden=true;focus(false);prose.replaceChildren();canvas.width=canvas.height=1;
    const frame=el('pdf-native');frame.removeAttribute('src');frame.hidden=true;message('');
  }
  async function bytes(url,signal) {
    if(localCopy?.url===url)return new Uint8Array(await localCopy.file.arrayBuffer());
    await openSesameBridge.ready;
    if(openSesameBridge.available && new URL(url).origin!==location.origin){
      const result=await openSesameBridge.request('reading.pdf',{url});
      if(signal.aborted)throw new DOMException('Cancelled','AbortError');
      return Uint8Array.from(atob(result.data),ch=>ch.charCodeAt(0));
    }
    const response=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer',signal});
    if(!response.ok)throw Error('PDF source returned HTTP '+response.status+'.');
    if(Number(response.headers.get('content-length'))>LIMIT){await response.body?.cancel();throw Error('PDF exceeds the 24 MB reading limit.')}
    const stream=response.body.getReader(),chunks=[];let count=0;
    while(true){const {done,value}=await stream.read();if(done)break;count+=value.length;if(count>LIMIT){await stream.cancel();throw Error('PDF exceeds the 24 MB reading limit.')}chunks.push(value)}
    const data=new Uint8Array(count);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length}
    return data;
  }

  // Only infer paragraphs from adjacent lines. Keep the source order, and start a
  // fresh paragraph on a column change, heading, indent, or extra vertical space.
  function paragraphs(items) {
    const lines=[];let line=null;
    for(const item of items){
      if(typeof item.str!=='string'||!item.transform)continue;
      const [a,b,,,x,y]=item.transform,size=Math.max(1,item.height||Math.hypot(a,b));
      if(Math.abs(b)>Math.abs(a)*2)continue;
      if(line&&(Math.abs(line.y-y)>size*.45||x<line.end-size*2||x>line.end+size*2.8)){lines.push(line);line=null}
      if(!line)line={x,y,size,end:x,text:''};
      if(line.text && x-line.end>size*.15 && !line.text.endsWith(' '))line.text+=' ';
      line.text+=item.str;line.end=x+item.width;
      if(item.hasEOL){lines.push(line);line=null}
    }
    if(line)lines.push(line);
    const clean=lines.filter(l=>l.text.trim()),sizes=clean.map(l=>l.size).sort((a,b)=>a-b),normal=sizes[Math.floor(sizes.length/2)]||12;
    const blocks=[];let last=null;
    for(const l of clean){
      const heading=l.size>normal*1.18, value=l.text.trim(), previous=blocks.at(-1);
      const split=!last||!previous||heading!==previous.heading||l.y>last.y+normal*.5||last.y-l.y>normal*1.65||Math.abs(l.x-last.x)>normal*2||l.x-last.x>normal*.55;
      if(split)blocks.push({heading,text:value,x:l.x,y:l.y,bottom:l.y-l.size,end:l.end});
      else {previous.text+=(previous.text.endsWith('-')?'':' ')+value;previous.bottom=Math.min(previous.bottom,l.y-l.size);previous.end=Math.max(previous.end,l.end)}
      last=l;
    }
    return blocks;
  }

  async function draw(scroll=true){
    const s=session;if(!s||(!s.doc&&!richText(s)))return;
    if(window.openSesameSpeech?.owner==='reading')openSesameSpeech.stop();
    const seq=++renderId;painting?.cancel();painting=null;
    controls();if(scroll){viewport.scrollTop=0;viewport.scrollLeft=0}
    try{
      if(richText(s)){
        prose.hidden=false;canvas.hidden=true;viewport.hidden=false;el('pdf-native').hidden=true;
        prose.style.fontSize=(17*steps[s.size])+'px';
        await OpenSesamePaper.render(s.rich.sections[Math.min(s.page-1,s.rich.sections.length-1)],prose);
        if(seq!==renderId)return;
        message('Scientific text · section '+s.page+' of '+s.rich.sections.length);
        el('reading-speak').disabled=!window.openSesameSpeech?.supported;
        return;
      }
      const page=await s.doc.getPage(s.page);
      if(seq!==renderId)return;
      let original=s.mode==='page';
      if(!original){
        const content=await page.getTextContent();if(seq!==renderId)return;
        const blocks=paragraphs(content.items);
        if(blocks.length){
          const base=page.getViewport({scale:1}),scale=Math.min(3,Math.sqrt(6000000/(base.width*base.height)));
          const view=page.getViewport({scale}),source=document.createElement('canvas');
          source.width=Math.ceil(view.width);source.height=Math.ceil(view.height);
          const job=page.render({canvas:source,viewport:view,background:'#ffffff'});
          painting=job;await job.promise;if(seq!==renderId)return;painting=null;
          const ops=await page.getOperatorList();if(seq!==renderId)return;
          const figures=OpenSesamePDFVisuals.regions(page,content,ops).map(region=>({region,node:OpenSesamePDFVisuals.crop(region,view,source,s.page)}));
          const outside=content.items.filter(item=>{
            if(!item.transform)return true;
            const x=item.transform[4],y=item.transform[5];
            return !figures.some(({region:{box:b}})=>x>=b[0]-2&&x+item.width<=b[2]+2&&y<=b[3]+2&&y>=b[1]-2);
          });
          const fragment=document.createDocumentFragment();
          for(const block of paragraphs(outside)){
            for(const figure of figures){
              if(!figure.inserted && figure.region.box[3]>=block.y && figure.region.box[0]<block.end && figure.region.box[2]>block.x){
                fragment.append(figure.node);figure.inserted=true;
              }
            }
            const covered=figures.some(({region:{box:b}})=>block.x>=b[0]-3&&block.end<=b[2]+3&&block.y<=b[3]+3&&block.bottom>=b[1]-3);
            if(!covered){const n=document.createElement(block.heading?'h3':'p');n.textContent=block.text;fragment.append(n)}
          }
          for(const figure of figures)if(!figure.inserted)fragment.append(figure.node);
          prose.replaceChildren(fragment);OpenSesamePaper.wireFigures(prose);
          prose.style.fontSize=(17*steps[s.size])+'px';prose.hidden=false;canvas.hidden=true;
          el('reading-speak').disabled=!window.openSesameSpeech?.supported;
          message(figures.length?'PDF text · equations and figures preserved from the source':'PDF text · original layout available in Page');
          return;
        }
        original=true;message('Image-only page · showing the original.');
      }else message('');
      if(original){
        el('reading-speak').disabled=true;
        const width=Math.max(50,viewport.clientWidth-12),base=page.getViewport({scale:1});
        const view=page.getViewport({scale:width/base.width*steps[s.size]});
        const dpr=Math.min(3,Math.max(1,window.devicePixelRatio||1)*1.2,Math.sqrt(4800000/(view.width*view.height)));
        const next=document.createElement('canvas');
        next.width=Math.max(1,Math.ceil(view.width*dpr));next.height=Math.max(1,Math.ceil(view.height*dpr));
        const job=page.render({canvas:next,viewport:view,transform:[dpr,0,0,dpr,0,0],background:'#ffffff'});
        painting=job;await job.promise;if(seq!==renderId)return;
        canvas.width=next.width;canvas.height=next.height;
        canvas.style.width=view.width+'px';canvas.style.height=view.height+'px';canvas.getContext('2d').drawImage(next,0,0);
        canvas.setAttribute('aria-label','Original PDF page '+s.page+' of '+s.doc.numPages);
        painting=null;prose.hidden=true;canvas.hidden=false;
      }
    }catch(error){
      if(seq!==renderId || error.name==='RenderingCancelledException')return;
      fallback(s,'This page could not be rendered.');
    }
  }
  function fallback(s,reason){
    s.doc=null;
    if(s.rich){s.fallback=false;s.mode='text';s.page=Math.min(s.page,s.rich.sections.length);controls();draw();return}
    s.fallback=true;controls();viewport.hidden=true;
    const f=el('pdf-native');f.hidden=false;f.src=frameUrl(s.url);
    message(reason+' Showing the original PDF.',true);
  }
  async function open(entry,onTitle){
    if(session?.url===entry.pdfUrl)return;
    close();root.hidden=false;viewport.hidden=false;prose.hidden=false;canvas.hidden=true;
    const saved=records[entry.pdfUrl]||{},s={url:entry.pdfUrl,abort:new AbortController(),page:Math.max(1,Number(saved.page)||1),mode:saved.mode==='page'?'page':'text',size:Number.isInteger(saved.size)?Math.max(0,Math.min(steps.length-1,saved.size)):1};
    session=s;const id=generation;controls();message('Opening paper…');
    const structured=OpenSesamePaper.load(entry).then(rich=>{
      if(id!==generation||!rich)return;
      s.rich=rich;
      if(s.mode==='text' || s.fallback){s.fallback=false;s.mode='text';s.page=Math.min(s.page,rich.sections.length);controls();draw()}
    }).catch(()=>{});
    const timeout=setTimeout(()=>s.abort.abort(),22000);
    try{
      const [api,data]=await Promise.all([library(),bytes(s.url,s.abort.signal)]);
      if(id!==generation)return;
      const paths=new URL('vendor/pdfjs/',document.baseURI);
      s.task=api.getDocument({data,isEvalSupported:false,useSystemFonts:true,enableXfa:false,
        cMapUrl:new URL('cmaps/',paths).href,cMapPacked:true,standardFontDataUrl:new URL('standard_fonts/',paths).href,wasmUrl:new URL('wasm/',paths).href});
      const pdf=await s.task.promise;if(id!==generation)return;s.doc=pdf;
      s.page=Math.min(pageCount(s),s.page);controls();await draw();
      pdf.getMetadata().then(m=>{if(id===generation && /^Paper [\w./-]+$/.test(entry.title) && m.info?.Title?.trim())onTitle(m.info.Title.trim().slice(0,300))}).catch(()=>{});
    }catch(error){await structured;if(id!==generation)return;
      const reason=error.name==='PasswordException'?'Password-protected file.':error.message?.includes('24 MB')?'This file exceeds 24 MB.':'Text access is unavailable from this source.';
      fallback(s,reason);
    }finally{clearTimeout(timeout)}
  }
  function go(number){const s=session;if(!s||(!s.doc&&!richText(s)))return;s.page=Math.max(1,Math.min(pageCount(s),Math.trunc(number)||s.page));remember();draw()}
  function zoom(delta){if(!session||(!session.doc&&!richText(session)))return;session.size=Math.min(steps.length-1,Math.max(0,session.size+delta));remember();draw(false)}
  const pageInput=el('pdf-page-number');pageInput.addEventListener('change',()=>go(Number(pageInput.value)));pageInput.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();go(Number(pageInput.value));viewport.focus({preventScroll:true})}});
  for(const mode of ['text','page'])el('pdf-'+mode+'-mode').addEventListener('click',()=>{if(!session||(mode==='page'&&!session.doc)||(!session.doc&&!session.rich))return;session.mode=mode;session.page=Math.min(session.page,pageCount(session));remember();draw()});
  el('pdf-prev').addEventListener('click',()=>go(session.page-1));el('pdf-next').addEventListener('click',()=>go(session.page+1));
  el('pdf-smaller').addEventListener('click',()=>zoom(-1));el('pdf-larger').addEventListener('click',()=>zoom(1));
  el('pdf-expand').addEventListener('click',()=>focus(!el('pane-reading').classList.contains('pdf-expanded')));
  root.addEventListener('keydown',e=>{if(e.target.tagName==='INPUT'||e.target.closest('.paper-figure,pre,.paper-code')||e.ctrlKey||e.metaKey||e.altKey||e.shiftKey||!session||(!session.doc&&!richText(session)))return;
    if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();e.stopPropagation();go(session.page+(e.key==='ArrowLeft'?-1:1))}});
  document.addEventListener('keydown',e=>{if(e.target.closest('.paper-figure.enlarged'))return;if(e.key==='Escape'&&el('pane-reading').classList.contains('pdf-expanded')){e.preventDefault();e.stopImmediatePropagation();focus(false);el('pdf-expand').focus()}},true);
  function retry(){if(!session)return;const entry=session.entry,callback=session.onTitle;close();show(entry,callback)}
  function show(entry,onTitle){open(entry,onTitle);if(session){session.entry=entry;session.onTitle=onTitle}}
  el('pdf-retry').addEventListener('click',retry);
  el('pdf-local-open').addEventListener('click',()=>el('pdf-local-file').click());
  el('pdf-local-file').addEventListener('change',e=>{const file=e.target.files[0];e.target.value='';if(!session||!file)return;
    if(file.size>LIMIT){message('Choose a PDF smaller than 24 MB.',true);return}
    localCopy={url:session.url,file};retry();
  });
  new ResizeObserver(()=>{const w=viewport.clientWidth;if(!w||w===lastWidth)return;lastWidth=w;
    if(session?.doc && !canvas.hidden){cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>draw(false))}}).observe(viewport);
  window.addEventListener('pagehide',close);
  window.OpenSesamePDF={show,close,get text(){return !root.hidden&&!prose.hidden&&!viewport.hidden?prose.innerText:''},get active(){return !!session}};
})();
