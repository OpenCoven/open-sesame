// Entry point of the new shell (issue #70). It proves the path from page to host and back, and
// nothing more: views, the widget manifest and lazy loading arrive with issue #76.
import { createBridge } from './bridge.js';

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
});
