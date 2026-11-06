'use strict';
(()=>{
  const $=id=>document.getElementById(id),md=window.OpenSesameMarkdown;
  let identity='',mode='preview',page=0,pageCount=1,revision=null,frame=0;
  function layout(){
    cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
      if(mode!=='preview'||!$('md-preview-stage').getClientRects().length)return;
      const stage=$('md-preview-stage'),content=$('md-preview-content'),width=stage.clientWidth,height=stage.clientHeight;if(width<30||height<30)return;
      content.style.columnWidth=width+'px';content.style.width=width+'px';content.style.height=height+'px';
      pageCount=Math.max(1,Math.round((content.scrollWidth+24)/(width+24)));page=Math.max(0,Math.min(page,pageCount-1));content.style.transform='translateX('+(-page*(width+24))+'px)';$('md-page-count').textContent=(page+1)+' / '+pageCount;$('md-page-prev').disabled=page===0;$('md-page-next').disabled=page===pageCount-1;
    });
  }
  function renderPreview(){
    const source=detailEditor.get();if(source!==revision){
      try{const html=md.blocksToHTML(md.parse(source));$('md-preview-content').innerHTML=DOMPurify.sanitize(html,{ALLOWED_TAGS:['div','p','br','h1','h2','h3','h4','h5','h6','strong','em','del','u','mark','a','code','pre','blockquote','ul','ol','li','table','thead','tbody','tr','th','td','hr','figure','figcaption','img','input','span'],ALLOWED_ATTR:['class','href','title','src','alt','type','checked','disabled','target','rel'],ALLOW_DATA_ATTR:false});
        $('md-preview-content').querySelectorAll('a').forEach(a=>{a.target='_blank';a.rel='noopener noreferrer'});$('md-preview-content').querySelectorAll('input').forEach(i=>i.disabled=true);$('md-preview-empty').hidden=!!source.trim();revision=source;
      }catch{$('md-preview-content').textContent=source;$('md-preview-empty').hidden=!!source.trim();revision=null}
    }layout();
  }
  function view(value,focus=false){
    mode=value;
    const preview=mode==='preview';
    $('md-source-panel').hidden=preview;$('md-preview-panel').hidden=!preview;
    $('md-formatting').parentElement.hidden=preview;
    if(preview)renderPreview();else detailEditor.layoutNow();
    if(focus)$(preview?'md-preview-stage':'detail-body').focus({preventScroll:true});
  }
  function finish(focus=true){
    if(mode==='source'){
      const item=currentItem();
      if(item && item.id===identity){
        item.body=detailEditor.get();
        if(!saveItems()){toast('Could not save this note. Your edits are still open.');return false}
      }
    }
    view('preview',focus);return true;
  }
  $('md-edit').addEventListener('click',()=>view('source',true));
  $('md-save').addEventListener('click',()=>finish());
  $('md-preview-stage').addEventListener('dblclick',e=>{
    if(!e.target.closest('a,button,input')){e.preventDefault();view('source',true)}
  });
  $('md-preview-stage').addEventListener('keydown',e=>{
    if(e.target===e.currentTarget && (e.key==='Enter'||e.key==='F2')){e.preventDefault();view('source',true)}
  });
  $('md-source-panel').addEventListener('keydown',e=>{
    if(((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s')||e.key==='Escape'){
      e.preventDefault();e.stopPropagation();finish();
    }
  });
  function format(kind){
    const selected=detailEditor.selection?.()||'',text=selected||({bold:'bold text',italic:'italic text',heading:'Heading',list:'List item',code:'code',link:'link text'}[kind]);let result;
    if(kind==='bold'||kind==='italic')result=md.stringify([md.paragraph([md[kind](text)])]).trim();
    else if(kind==='heading')result=md.stringify([md.h2(text)]).trim();
    else if(kind==='list')result=md.stringify([md.bulletList(text.split('\n'))]).trim();
    else if(kind==='code')result=md.stringify([md.codeBlock(text)]).trim();
    else result='['+text.replace(/\]/g,'\\]')+'](https://example.com)';
    if(['heading','list','code'].includes(kind))result='\n'+result+'\n';detailEditor.replaceSelection(result);renderPreview();
  }
  document.querySelectorAll('[data-md-format]').forEach(b=>{b.addEventListener('pointerdown',e=>e.preventDefault());b.addEventListener('click',()=>format(b.dataset.mdFormat))});
  $('detail-body').addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&['b','i'].includes(e.key.toLowerCase())){e.preventDefault();format(e.key.toLowerCase()==='b'?'bold':'italic')}});
  $('md-page-prev').addEventListener('click',()=>{page--;layout()});$('md-page-next').addEventListener('click',()=>{page++;layout()});
  $('md-preview-stage').addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();page+=e.key==='ArrowLeft'?-1:1;layout()}});
  new ResizeObserver(layout).observe($('md-preview-stage'));window.addEventListener('open-sesame-layout',layout);
  window.OpenSesameNotes={update(id){if(identity!==id){identity=id;revision=null;page=0;mode='preview'}view(mode)},finish,layout};const initial=currentItem();if(initial)window.OpenSesameNotes.update(initial.id,initial.body||'');
})();
