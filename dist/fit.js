'use strict';
function railRowHeight(element,detailed=false){
  return parseFloat(getComputedStyle(element).getPropertyValue(detailed?'--rail-detail-height':'--rail-row-height')) || (detailed?44:36);
}
// Keep the full document separate from the fitted page shown in the editor.
function createPagedEditor(id,label,onChange=()=>{}){
  const field=document.getElementById(id),bar=document.createElement('div');bar.className='text-pages';bar.setAttribute('aria-label',label+' pages');
  const caption=document.createElement('span'),controls=document.createElement('div'),previous=document.createElement('button'),count=document.createElement('span'),next=document.createElement('button');
  previous.type=next.type='button';previous.className='page-previous';previous.innerHTML=next.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';previous.setAttribute('aria-label','Previous '+label.toLowerCase()+' page');next.setAttribute('aria-label','Next '+label.toLowerCase()+' page');count.setAttribute('aria-live','polite');controls.append(previous,count,next);bar.append(caption,controls);field.after(bar);
  const measure=document.createElement('textarea');measure.tabIndex=-1;measure.setAttribute('aria-hidden','true');measure.className='page-measure';document.body.append(measure);
  let text=field.value,page=0,pages=[{start:0,end:text.length}],key='',pending=0;const undo=[],redo=[];const remember=()=>{undo.push(text);if(undo.length>60)undo.shift();redo.length=0};function restore(from,to){if(!from.length)return;to.push(text);text=from.pop();split();show();onChange(text)}
  const limit=field.maxLength>0?field.maxLength:Infinity;
  function split(){
    if(!field.offsetWidth||!field.offsetHeight)return false;
    const style=getComputedStyle(field);measure.style.cssText='position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;resize:none;box-sizing:border-box;';
    ['font','lineHeight','letterSpacing','padding','border','wordBreak','overflowWrap','whiteSpace','tabSize'].forEach(k=>measure.style[k]=style[k]);measure.style.width=field.offsetWidth+'px';measure.style.height=field.offsetHeight+'px';
    const fits=value=>{measure.value=value;return measure.scrollHeight<=measure.clientHeight&&measure.scrollWidth<=measure.clientWidth};
    pages=[];let start=0;
    while(start<text.length){let low=1,high=text.length-start,best=1;while(low<=high){const mid=Math.floor((low+high)/2);if(fits(text.slice(start,start+mid))){best=mid;low=mid+1}else high=mid-1}
      let end=start+best;if(end<text.length){const chunk=text.slice(start,end),space=Math.max(chunk.lastIndexOf(' '),chunk.lastIndexOf('\n'));if(space>best*.6)end=start+space+1;if(/[\uD800-\uDBFF]/.test(text[end-1]))end--}
      end=Math.max(start+1,end);pages.push({start,end});start=end;
    }
    if(!pages.length)pages=[{start:0,end:0}];return true;
  }
  function show(caret){page=Math.max(0,Math.min(page,pages.length-1));const current=pages[page];field.value=text.slice(current.start,current.end);caption.textContent=label;count.textContent=(page+1)+' / '+pages.length;previous.disabled=page===0;next.disabled=page===pages.length-1;field.setAttribute('aria-describedby',id+'-pages');bar.id=id+'-pages';
    if(caret!==undefined){const pos=Math.max(0,Math.min(field.value.length,caret-current.start));field.setSelectionRange(pos,pos)}field.scrollTop=0;field.scrollLeft=0;
  }
  function layout(){if(!field.offsetWidth||!field.offsetHeight)return;const focused=document.activeElement===field,caret=focused?pages[page].start+field.selectionStart:undefined,anchor=pages[page]?.start||0;if(!split())return;if(caret!==undefined)page=pages.findIndex(p=>caret<p.end);else page=pages.findIndex(p=>anchor<p.end);if(page<0)page=pages.length-1;show(caret)}
  function schedule(){cancelAnimationFrame(pending);pending=requestAnimationFrame(layout)}
  field.addEventListener('input',()=>{remember();const old=pages[page],room=limit-(text.length-(old.end-old.start)),insert=field.value.slice(0,Math.max(0,room)),caret=old.start+Math.min(insert.length,field.selectionStart);text=text.slice(0,old.start)+insert+text.slice(old.end);split();page=pages.findIndex(p=>caret<p.end);if(page<0)page=pages.length-1;show(caret);onChange(text)});
  field.addEventListener('keydown',e=>{if(!field.readOnly&&(e.metaKey||e.ctrlKey)&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault();(e.shiftKey||e.key.toLowerCase()==='y')?restore(redo,undo):restore(undo,redo);return}if(e.altKey&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();page+=e.key==='ArrowLeft'?-1:1;show();field.setSelectionRange(0,0)}});
  previous.addEventListener('click',()=>{page--;show()});next.addEventListener('click',()=>{page++;show()});new ResizeObserver(schedule).observe(field);
  return {get:()=>text,selection:()=>field.value.slice(field.selectionStart,field.selectionEnd),replaceSelection(value){const start=field.selectionStart,end=field.selectionEnd;field.setRangeText(value,start,end,'end');field.dispatchEvent(new Event('input',{bubbles:true}));field.focus({preventScroll:true})},set(value,{identity=key,follow=false}={}){const changedKey=identity!==key;if(changedKey){page=0;undo.length=0;redo.length=0}key=identity;text=String(value).slice(0,limit);if(split()){if(follow)page=pages.length-1;show()}else{page=0;pages=[{start:0,end:text.length}];field.value=text;caption.textContent=label;count.textContent='1 / 1'}schedule()},layoutNow:layout,layout:schedule};
}
