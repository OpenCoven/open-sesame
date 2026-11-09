'use strict';
(()=>{
  const el=id=>document.getElementById(id);
  function handle(event){
    if(event.key!=='Escape'||event.defaultPrevented||event.isComposing||event.keyCode===229||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey)return false;
    if(document.querySelector('dialog[open]')||window.OpenSesameFrame?.dragging)return false;
    if(!el('capture-url-row').hidden){event.preventDefault();event.stopImmediatePropagation();closeUrlEditor();el('attach-link').focus({preventScroll:true});return true}
    // Local menus/dialogs receive Escape before this final window-level fallback.
    if([...document.querySelectorAll('[role=dialog],[role=menu],[role=listbox]')].some(node=>!node.hidden&&node.getClientRects().length))return false;
    if(!state.expanded&&!window.OpenSesameLauncher?.active)return false;
    event.preventDefault();event.stopImmediatePropagation();void window.OpenSesameWindow?.collapse({focus:true});return true;
  }
  function native(){
    const dialog=document.querySelector('dialog[open]');
    if(dialog){const cancel=new Event('cancel',{cancelable:true});if(dialog.dispatchEvent(cancel))dialog.close();return}
    (document.activeElement||document).dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true,cancelable:true}));
  }
  window.addEventListener('keydown',handle);
  window.OpenSesameEscape={handle,native};
})();
