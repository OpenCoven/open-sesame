'use strict';
(() => {
  const panel = document.getElementById('widget-panel');
  const controls = panel.querySelector('.workspace-window-controls');
  let active = false, returnTo = null;
  const triggers = [];
  function button(id, label, glyph) {
    const node = document.createElement('button');
    node.id = id; node.type = 'button'; node.className = 'content-focus-trigger';
    node.title = label; node.setAttribute('aria-label', label);
    node.setAttribute('aria-pressed', 'false'); node.innerHTML = icon(glyph);
    node.addEventListener('click', () => enter(node));
    triggers.push(node); return node;
  }
  const toggle = button('window-content-focus', 'Focus content', 'open-view');
  controls.prepend(toggle);
  const bar = document.createElement('header');
  bar.className = 'content-focus-bar'; bar.hidden = true;
  const title = document.createElement('span');
  const back = document.createElement('button');
  back.id = 'content-focus-exit'; back.type = 'button'; back.innerHTML = icon('rail-left');
  back.title = 'Restore workspace · Escape'; back.setAttribute('aria-label', 'Restore workspace');
  back.setAttribute('aria-keyshortcuts', 'Escape');
  back.addEventListener('click', () => exit());
  bar.append(title, back); panel.prepend(bar);
  for (const [selector, id, label] of [
    ['.reading-article-actions', 'reading-content-focus', 'Focus article'],
    ['#detail-actions', 'item-content-focus', 'Focus item']
  ]) panel.querySelector(selector)?.prepend(button(id, label, 'open-view'));

  const articleMenu = document.getElementById('reading-export-menu');
  const articleOptions = document.getElementById('reading-export-toggle');
  for (const id of ['reading-later','reading-read','reading-speak','reading-pdf-toggle']) {
    const action = document.getElementById(id);
    action.querySelector('span')?.classList.remove('sr-only');
    articleMenu.prepend(action);
    action.addEventListener('click', () => {
      articleMenu.hidden = true; articleOptions.setAttribute('aria-expanded', 'false');
      articleOptions.focus({preventScroll:true});
    });
  }

  function layout() {
    // Refit existing editors, terminals and native child views; never remount content.
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('open-sesame-layout'));
    window.OpenSesameNativeSurfaces?.sync();
  }
  function updateTitle() {
    const selected = state.scenario === 'reading' ? document.getElementById('reading-title')?.textContent :
      state.scenario === 'items' ? document.getElementById('detail-title')?.value : '';
    const label = selected || panel.querySelector('.application-page')?.textContent || 'Content';
    if (title.textContent !== label) title.textContent = label;
    title.title = label;
  }
  function enter(source = toggle) {
    if (active || !state.expanded || window.OpenSesameLauncher?.active) return false;
    returnTo = source; active = true;
    panel.dataset.contentView = state.scenario;
    panel.classList.add('content-focused'); bar.hidden = false;
    triggers.forEach(node => node.setAttribute('aria-pressed', 'true'));
    updateTitle(); layout(); back.focus({preventScroll:true}); return true;
  }
  function exit({restoreFocus = true} = {}) {
    if (!active) return false;
    active = false; panel.classList.remove('content-focused'); bar.hidden = true;
    delete panel.dataset.contentView;
    triggers.forEach(node => node.setAttribute('aria-pressed', 'false'));
    layout();
    if (restoreFocus) {
      const target = returnTo?.isConnected && returnTo.getClientRects().length ? returnTo : toggle;
      if (target.getClientRects().length) target.focus({preventScroll:true});
    }
    returnTo = null; return true;
  }
  window.OpenSesameContentFocus = {enter, exit, get active() {return active}};
  window.addEventListener('open-sesame-layout', () => {
    if (!active) return;
    if (!state.expanded || window.OpenSesameLauncher?.active) exit({restoreFocus:false});
    else updateTitle();
  });
  window.addEventListener('open-sesame-view-changed', () => exit({restoreFocus:false}));
})();
