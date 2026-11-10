'use strict';
(() => {
  const el = id => document.getElementById(id);
  const bindings = [
    ['#terminal-rail-heading', 'agents-rail-toggle'],
    ['#remote-rail-heading', 'agents-rail-toggle'],
    ['#familiar-rail>.workspace-rail-heading', 'agents-rail-toggle'],
    ['#reading-rail>.workspace-rail-heading', 'reading-rail-toggle'],
    ['#media-queue>.playlist-rail-heading', 'media-queue-toggle'],
    ['#youtube-queue>.playlist-rail-heading', 'youtube-queue-toggle'],
    ['#items-rail-heading', 'detail-width-toggle']
  ];
  for (const [selector, target] of bindings) {
    const row = document.querySelector(selector), control = el(target);
    if (!row || !control) continue;
    const button = document.createElement('button'); button.type = 'button';
    button.className = 'rail-heading-toggle'; row.classList.add('clickable-rail-heading');
    const sync = () => {
      button.setAttribute('aria-label', control.getAttribute('aria-label') || control.title || 'Toggle sidebar');
      button.setAttribute('aria-expanded', control.getAttribute('aria-expanded') || 'true');
      if (control.getAttribute('aria-controls')) button.setAttribute('aria-controls', control.getAttribute('aria-controls'));
      button.disabled = control.disabled;
    };
    button.addEventListener('click', () => {control.click();if(!row.getClientRects().length&&control.getClientRects().length)control.focus({preventScroll:true})}); row.prepend(button);
    new MutationObserver(sync).observe(control, {attributes:true,attributeFilter:['aria-label','aria-expanded','aria-controls','disabled']});
    sync();
  }
})();
