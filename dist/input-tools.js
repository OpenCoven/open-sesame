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
  async function copyCalculation(){if(!calculation||calculation.error)return;try{await navigator.clipboard.writeText(calculation.result);toast('Copied '+calculation.result)}catch{toast('Select the result to copy it.')}}
  copy.addEventListener('click',copyCalculation);
  const surfaces=[];let frame=0;
  function surface(field,code){
    const overlay=document.createElement('pre'),content=document.createElement('code');overlay.className='syntax-overlay';overlay.setAttribute('aria-hidden','true');overlay.append(content);field.after(overlay);field.parentElement.classList.add('syntax-host');
    const item={field,overlay,content,code,value:null};surfaces.push(item);field.addEventListener('input',refresh);field.addEventListener('scroll',()=>{content.style.transform=`translate(${-field.scrollLeft}px,${-field.scrollTop}px)`});new ResizeObserver(refresh).observe(field);
  }
  function paint(item){
    const {field,overlay,content}=item;if(!field.offsetWidth){overlay.hidden=true;return}overlay.hidden=false;
    const style=getComputedStyle(field),value=field.value,code=typeof item.code==='function'?item.code():item.code;
    const key=value+'|'+code;
    if(item.value!==key){item.value=key;content.replaceChildren(...OpenSesameSyntax.tokens(value,{code}).map(token=>{const span=document.createElement('span');span.className=token.type?'syntax-'+token.type:'';span.textContent=token.text;return span}),document.createTextNode('\n'))}
    for(const property of ['font','lineHeight','letterSpacing','padding','wordBreak','overflowWrap','whiteSpace','tabSize','textAlign'])overlay.style[property]=style[property];
    overlay.style.left=field.offsetLeft+'px';overlay.style.top=field.offsetTop+'px';overlay.style.width=field.clientWidth+'px';overlay.style.height=field.clientHeight+'px';
    field.classList.toggle('syntax-input',!!value);content.style.transform=`translate(${-field.scrollLeft}px,${-field.scrollTop}px)`;
  }
  function refresh(){
    cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
      const intent=window.openSesameCapture?.interpret(input.value,el('capture-type').value,state.scenario);calculation=menu.hidden&&intent?.kind==='calculation'?intent.calculation:null;
      result.hidden=!calculation;result.classList.toggle('has-error',!!calculation?.error);
      if(calculation){output.textContent=calculation.error||calculation.result;expression.textContent=calculation.error?'Calculation':calculation.expression;copy.title=calculation.note||'Enter or click to copy';copy.disabled=!!calculation.error}
      surfaces.forEach(paint);
    });
  }
  surface(input,()=>window.OpenSesameShellInput?.interpret(input.value,state.scenario)?.kind==='shell');surface(el('terminal-task'),()=>el('terminal-task').classList.contains('is-command'));
  for(const name of ['open-sesame-layout','open-sesame-view-changed'])window.addEventListener(name,refresh);
  new MutationObserver(refresh).observe(el('terminal-connect-form'),{subtree:true,attributes:true,attributeFilter:['hidden','class']});
  new MutationObserver(refresh).observe(menu,{attributes:true,attributeFilter:['hidden']});
  window.OpenSesameInputTools={refresh,copyCalculation};refresh();
})();
