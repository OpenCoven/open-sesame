'use strict';
// Keep each real select as the form control and accessible trigger. One listbox serves
// static settings, project filters, and selects created later by the workspace.
(() => {
  const menu = document.createElement('div');
  menu.id = 'open-sesame-select-menu';
  menu.className = 'open-sesame-select-menu';
  menu.setAttribute('role','listbox');
  menu.hidden = true;
  let control = null, options = [], active = -1, prefix = '', lastTyped = 0, naturalWidth = 0;
  const supported = node => node instanceof HTMLSelectElement && !node.disabled && !node.multiple && node.size <= 1;
  const disabled = option => option.disabled || option.parentElement?.tagName === 'OPTGROUP' && option.parentElement.disabled;

  function close() {
    if (!control) return;
    mutations.disconnect();
    control.removeAttribute('aria-controls');
    control.removeAttribute('aria-activedescendant');
    control.removeAttribute('aria-expanded');
    control = null; options = []; active = -1; prefix = '';
    menu.hidden = true;
    menu.remove();
  }

  function position() {
    if (!control) return;
    if (!supported(control) || !control.isConnected || !control.getClientRects().length) { close(); return }
    const box = control.getBoundingClientRect();
    const host = control.closest('#widget-panel,dialog[open]');
    const area = host?.getBoundingClientRect();
    const left = Math.max(5,area ? area.left + 4 : 5), right = Math.min(innerWidth-5,area ? area.right-4 : innerWidth-5);
    const top = Math.max(5,area ? area.top+3 : 5), bottom = Math.min(innerHeight-5,area ? area.bottom-3 : innerHeight-5);
    const width = Math.min(Math.max(box.width,naturalWidth,control.id==='focus-duration'?179:146),Math.max(0,right-left));
    const below = bottom-box.bottom-4, above = box.top-top-4;
    const up = below < Math.min(menu.scrollHeight,230) && above > below;
    menu.style.width = width+'px';
    menu.style.maxHeight = Math.max(36,Math.min(310,up?above:below))+'px';
    menu.style.left = Math.max(left,Math.min(box.left,right-width))+'px';
    menu.style.top = (up?Math.max(top,box.top-menu.offsetHeight-4):Math.max(top,Math.min(bottom-menu.offsetHeight,box.bottom+4)))+'px';
  }

  function highlight(index,scroll=true) {
    active=index;
    for (const row of menu.children) row.classList.toggle('is-active',Number(row.dataset.index)===active);
    if (!menu.children[active]) {control.removeAttribute('aria-activedescendant');return}
    const row=menu.children[active];
    control.setAttribute('aria-activedescendant',row.id);
    if (scroll) {
      const delta=row.offsetTop-menu.scrollTop;
      if(delta<0)menu.scrollTop=row.offsetTop;
      else if(delta+row.offsetHeight>menu.clientHeight)menu.scrollTop=row.offsetTop+row.offsetHeight-menu.clientHeight;
    }
  }

  function refresh() {
    if(!control)return;
    if(!supported(control)||!control.isConnected||!control.getClientRects().length){close();return}
    const last=options[active];
    options=Array.from(control.options).filter(o=>!o.hidden&&!o.closest('optgroup[hidden]'));
    menu.style.width='max-content';menu.style.maxHeight='none';menu.replaceChildren();
    for(const [index,option] of options.entries()){
      const row=document.createElement('div'),text=document.createElement('span'),mark=document.createElement('span');
      row.id='open-sesame-select-option-'+index;row.dataset.index=index;row.setAttribute('role','option');
      row.setAttribute('aria-selected',String(option.selected));row.setAttribute('aria-disabled',String(disabled(option)));
      row.title=option.label;
      const parts=control.id==='focus-duration'?option.label.split(/\s*·\s*/):[option.label];
      text.textContent=parts[0];text.className='open-sesame-select-label';row.append(text);
      if(parts.length>1){const detail=document.createElement('small');detail.textContent=parts.slice(1).join(' · ');row.append(detail)}
      mark.className='open-sesame-select-check';mark.setAttribute('aria-hidden','true');mark.textContent=option.selected?'✓':'';row.append(mark);menu.append(row);
    }
    if(!options.length){close();return}
    naturalWidth=Math.ceil(menu.getBoundingClientRect().width);
    position();
    if(!control)return;
    const next=last && !disabled(last)?options.indexOf(last):-1;
    const selected=options.findIndex(o=>o.selected&&!disabled(o));
    highlight(next>=0?next:selected>=0?selected:options.findIndex(o=>!disabled(o)));
  }

  const mutations=new MutationObserver(refresh);
  function open(select) {
    close();control=select;menu.dataset.control=select.id;
    const label=select.labels?.[0]?.cloneNode(true);
    label?.querySelectorAll('select').forEach(n=>n.remove());
    const name=select.getAttribute('aria-label')||label?.textContent.trim()||select.title||'Choose an option';
    menu.setAttribute('aria-label',name+' options');
    (select.closest('dialog[open]')||document.body).append(menu);
    menu.hidden=false;select.setAttribute('aria-expanded','true');select.setAttribute('aria-controls',menu.id);
    select.focus({preventScroll:true});refresh();
    if(control)mutations.observe(select,{subtree:true,childList:true,attributes:true,characterData:true,attributeFilter:['disabled','hidden','selected','label','value']});
  }
  function choose(index){
    const target=control,option=options[index];
    if(!target||!option||disabled(option))return;
    const changed=!option.selected;close();
    if(changed){target.selectedIndex=option.index;target.dispatchEvent(new Event('input',{bubbles:true}));target.dispatchEvent(new Event('change',{bubbles:true}))}
  }
  function step(direction){
    for(let n=1;n<=options.length;n++){
      const next=(active+n*direction+options.length*2)%options.length;
      if(!disabled(options[next])){highlight(next);return}
    }
  }

  document.addEventListener('pointerdown',e=>{
    if(menu.contains(e.target)){e.preventDefault();return}
    if(supported(e.target)&&e.pointerType!=='touch'&&e.button===0){
      e.preventDefault();if(control===e.target)close();else open(e.target);return;
    }
    close();
  },true);
  document.addEventListener('mousedown',e=>{if(control===e.target)e.preventDefault()},true);
  menu.addEventListener('pointermove',e=>{const row=e.target.closest('[role=option]');if(row&&row.getAttribute('aria-disabled')==='false')highlight(Number(row.dataset.index),false)});
  menu.addEventListener('click',e=>{e.stopPropagation();const row=e.target.closest('[role=option]');if(row)choose(Number(row.dataset.index))});
  document.addEventListener('keydown',e=>{
    const target=e.target;
    if(!supported(target)||e.isComposing||e.metaKey||e.ctrlKey)return;
    if(!control){
      if(!['ArrowUp','ArrowDown',' ','Enter','F4'].includes(e.key))return;
      e.preventDefault();e.stopImmediatePropagation();open(target);return;
    }
    if(target!==control)return;
    if(e.key==='Tab'){close();return}
    if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();return}
    if(e.altKey && e.key!=='ArrowUp')return;
    e.preventDefault();e.stopImmediatePropagation();
    switch(e.key){
      case 'Home':highlight(options.findIndex(o=>!disabled(o)));break;
      case 'End':for(let i=options.length-1;i>=0;i--)if(!disabled(options[i])){highlight(i);break}break;
      case 'ArrowDown':step(1);break;
      case 'ArrowUp':if(e.altKey)close();else step(-1);break;
      case 'Enter':case ' ':choose(active);break;
      default:
        if(e.key.length===1){
          const now=performance.now(),letter=e.key.toLocaleLowerCase();prefix=now-lastTyped>650?letter:prefix+letter;lastTyped=now;
          const query=[...prefix].every(c=>c===letter)?letter:prefix;
          for(let n=1;n<=options.length;n++){
            const index=(active+n+options.length)%options.length;
            if(!disabled(options[index])&&options[index].label.toLocaleLowerCase().startsWith(query)){highlight(index);break}
          }
        }
    }
  },true);
  document.addEventListener('focusin',e=>{if(control&&e.target!==control&&!menu.contains(e.target))close()});
  window.addEventListener('blur',close);window.addEventListener('resize',position);
  window.addEventListener('scroll',e=>{if(control&&!menu.contains(e.target))position()},true);
  window.addEventListener('open-sesame-view-changed',close);window.addEventListener('open-sesame-layout',position);
})();
