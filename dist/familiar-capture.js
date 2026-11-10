'use strict';
(() => {
  const input = document.getElementById('capture-input');
  let routing = false;
  const hint=()=>{if(window.OpenSesameWidgetLifecycle?.isActive('coven')===false){input.title='Activate Coven Familiars in Widgets to route a question with Tab or @name.';return}const name=window.OpenSesameFamiliars?.defaultRecipient?.()?.displayName||'your default familiar';input.title='Tab opens this question with '+name+'. Use @name to choose another familiar.'};
  input.addEventListener('focus',hint);window.addEventListener('open-sesame-view-changed',hint);hint();
  input.addEventListener('keydown', async event => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey || window.OpenSesameLauncher?.active) return;
    const text = input.value;
    if (!text.trim() || /^[!/]/.test(text.trimStart())) return;
    // Shell completion and its input draft remain owned by the shell, including Tab.
    if (state.scenario === 'terminal' && !window.OpenSesamePageWidgets?.active) return;
    if (event.key !== 'Tab' && !(event.key === 'Enter' && /(^|\s)@[a-z0-9_-]+\b/i.test(text))) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (routing) return;
    routing = true;
    try {
      window.openSesameCapture?.hide();
      const opened = await window.OpenSesameFamiliars.routeDraft(text);
      // A concurrent edit in capture must never be cleared by a completed route.
      if (opened && input.value === text) {
        input.value = ''; input.dispatchEvent(new Event('input', {bubbles:true}));
      }
    } finally {routing = false}
  }, true);
})();
