// Entry point of the new shell (issue #70). It proves the path from page to host and back, and
// nothing more: views, the widget manifest and lazy loading arrive with issue #76.
import { mountAccount } from './account.js';
import { createBridge } from './bridge.js';
import { holdDuringDrag, mountSummon } from './summon.js';

const SYSTEMS = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };

const bridge = createBridge(window);
const shell = document.querySelector('.shell');
const status = shell.querySelector('[data-status]');
const facts = shell.querySelector('[data-facts]');

bridge.ready.then(info => {
  if (!info.available) {
    shell.dataset.state = 'unavailable';
    status.textContent = info.error || 'Open this page in the Open Sesame app to connect to this machine.';
    return;
  }
  shell.dataset.state = 'connected';
  status.textContent = 'Connected to this machine.';
  facts.querySelector('[data-fact="platform"]').textContent = SYSTEMS[info.platform] || info.platform;
  facts.querySelector('[data-fact="version"]').textContent = window.__OPEN_SESAME_VERSION__ || 'Unknown';
  facts.hidden = false;
  const account = shell.querySelector('[data-account]');
  mountAccount(bridge, {
    section: account,
    title: account.querySelector('[data-account-title]'),
    detail: account.querySelector('[data-account-detail]'),
    signIn: account.querySelector('[data-account-sign-in]'),
    cancel: account.querySelector('[data-account-cancel]'),
    signOut: account.querySelector('[data-account-sign-out]'),
  });
  const section = shell.querySelector('[data-summon]');
  mountSummon(bridge, {
    section,
    hint: section.querySelector('[data-summon-hint]'),
    form: section.querySelector('[data-summon-form]'),
    input: section.querySelector('#summon-shortcut'),
    message: section.querySelector('[data-summon-message]'),
    blur: section.querySelector('[data-summon-blur]'),
  });
  holdDuringDrag(bridge, document);
});
