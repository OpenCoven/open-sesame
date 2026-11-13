'use strict';
(()=>{
  const el=id=>document.getElementById(id),input=el('capture-input'),form=el('capture-form'),menu=el('capture-commands');
  // Keep metadata available on demand, without a second row below the composer.
  const settings=document.createElement('details');settings.id='capture-settings';
  const summary=document.createElement('summary');summary.textContent='Capture settings';settings.append(summary);
  const fields=document.createElement('div');
  for(const [id,label] of [['capture-type','Type'],['capture-project','Project']]){const wrap=document.createElement('label');wrap.textContent=label;wrap.append(el(id));fields.append(wrap)}
  settings.append(fields);menu.append(settings);settings.addEventListener('toggle',()=>window.openSesameCapture?.resize());
  const hint=el('capture-hint');hint.classList.add('sr-only');form.append(hint);
  el('capture-url-row').append(el('capture-link-preview'));
  const result=document.createElement('div');result.id='capture-calculation';result.hidden=true;
  const copy=document.createElement('button');copy.type='button';copy.className='calculation-copy';copy.setAttribute('aria-label','Copy calculation result');
  const info=document.createElement('span'),expression=document.createElement('small'),output=document.createElement('output');output.setAttribute('aria-live','polite');info.append(expression,output);
  const copyIcon=document.createElement('span');copyIcon.innerHTML=icon('copy');copy.append(info,copyIcon);result.append(copy);form.querySelector('.capture-input-wrap').after(result);
  let calculation=null;
  async function copyCalculation(){updateResult();if(!calculation||calculation.error)return;try{await navigator.clipboard.writeText(calculation.result);toast('Copied '+calculation.result)}catch{toast('Select the result to copy it.')}}
  copy.addEventListener('click',copyCalculation);
  const surfaces=[];let frame=0;
  function surface(field,code){
    const overlay=document.createElement('pre'),content=document.createElement('code');overlay.className='syntax-overlay';overlay.setAttribute('aria-hidden','true');overlay.append(content);field.after(overlay);field.parentElement.classList.add('syntax-host');
    const item={field,overlay,content,code,value:null};surfaces.push(item);field.addEventListener('input',refresh);field.addEventListener('scroll',()=>{content.style.transform=`translate(${-field.scrollLeft}px,${-field.scrollTop}px)`});new ResizeObserver(refresh).observe(field);
  }
  const copied=['font','lineHeight','letterSpacing','padding','wordBreak','overflowWrap','whiteSpace','tabSize','textAlign'];
  // Read every surface before writing to any, so a refresh costs one layout rather than two per surface.
  function measure(item){
    const {field}=item;if(field.closest('[hidden]')||!field.offsetWidth)return null;
    const style=getComputedStyle(field);
    return{style:copied.map(property=>[property,style[property]]),left:field.offsetLeft,top:field.offsetTop,width:field.clientWidth,height:field.clientHeight,scrollLeft:field.scrollLeft,scrollTop:field.scrollTop};
  }
  function paint(item,box){
    const {field,overlay,content}=item;if(!box){overlay.hidden=true;return}overlay.hidden=false;
    const value=field.value,code=typeof item.code==='function'?item.code():item.code;
    const key=value+'|'+code;
    if(item.value!==key){item.value=key;content.replaceChildren(...OpenSesameSyntax.tokens(value,{code}).map(token=>{const span=document.createElement('span');span.className=token.type?'syntax-'+token.type:'';span.textContent=token.text;return span}),document.createTextNode('\n'))}
    for(const [property,setting] of box.style)overlay.style[property]=setting;
    overlay.style.left=box.left+'px';overlay.style.top=box.top+'px';overlay.style.width=box.width+'px';overlay.style.height=box.height+'px';
    field.classList.toggle('syntax-input',!!value);content.style.transform=`translate(${-box.scrollLeft}px,${-box.scrollTop}px)`;
  }
  function updateResult(){
    const intent=window.openSesameCapture?.interpret(input.value,el('capture-type').value,state.scenario);
    calculation=menu.hidden?(intent?.kind==='time'?intent.clock:intent?.kind==='calculation'?intent.calculation:null):null;
    result.hidden=!calculation;result.classList.toggle('has-error',!!calculation?.error);result.classList.toggle('is-time',intent?.kind==='time');
    output.setAttribute('aria-live',intent?.kind==='time'?'off':'polite');
    if(calculation){output.textContent=calculation.error||calculation.result;expression.textContent=calculation.expression||'Calculation';copy.title=calculation.note||'Enter or click to copy';copy.disabled=!!calculation.error;copy.setAttribute('aria-label',intent.kind==='time'?(calculation.error||'Copy local time: '+calculation.result+' · '+calculation.expression):'Copy calculation result')}
  }
  function refresh(){
    cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
      updateResult();
      const boxes=surfaces.map(measure);surfaces.forEach((item,index)=>paint(item,boxes[index]));
    });
  }
  surface(input,()=>window.OpenSesameShellInput?.interpret(input.value,state.scenario)?.kind==='shell');surface(el('terminal-task'),()=>el('terminal-task').classList.contains('is-command'));
  for(const name of ['open-sesame-layout','open-sesame-view-changed'])window.addEventListener(name,refresh);
  new MutationObserver(refresh).observe(el('terminal-connect-form'),{subtree:true,attributes:true,attributeFilter:['hidden','class']});
  new MutationObserver(refresh).observe(menu,{attributes:true,attributeFilter:['hidden']});
  // Refresh visible clocks without changing drafts, menu selection or input focus.
  setInterval(()=>{if(!result.hidden&&window.openSesameCapture?.interpret(input.value,el('capture-type').value,state.scenario)?.kind==='time')updateResult()},1000);
  window.OpenSesameInputTools={refresh,copyCalculation};refresh();
})();
