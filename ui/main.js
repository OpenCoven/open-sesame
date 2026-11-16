import { createBridge } from './bridge.js';
import { widgets, paletteIndex } from './manifest.js';
import { searchCommands } from './palette.js';
import { loaders, styles } from './widget-loaders.js';
import { createLifecycle } from './lifecycle.js';
import { createPreferences } from './preferences.js';

const bridge = createBridge(window);
const shell = document.querySelector('.shell');
const status = shell.querySelector('[data-status]');
const notice = shell.querySelector('[data-shell-notice]');
const navigation = shell.querySelector('[data-navigation]');
const views = shell.querySelector('[data-view-host]');
const options = shell.querySelector('[data-widget-options]');
const palette = shell.querySelector('#command-palette');
const settings = shell.querySelector('#widget-settings');
const query = shell.querySelector('[data-command-query]');
const results = shell.querySelector('[data-command-results]');
const paletteToggle = shell.querySelector('[data-palette-toggle]');
const widgetToggle = shell.querySelector('[data-widgets-toggle]');
const message = error => error?.message || String(error);
const report = text => {notice.textContent = text; notice.hidden = !text;};
const prefs = createPreferences(bridge, report);
const element = (tag, text) => {const node = document.createElement(tag); if (text) node.textContent = text;return node;};
let commands = paletteIndex;
let manager;
let state;
let restoring = true;
const navButtons = new Map();
const switches = new Map();
const run = promise => promise.catch(error => report(message(error)));

function closePalette() {
  palette.hidden = true;
  paletteToggle.setAttribute('aria-expanded','false');
  paletteToggle.focus();
}
function openPalette() {
  palette.hidden = false;
  paletteToggle.setAttribute('aria-expanded','true');
  query.value = '';
  renderCommands();
  query.focus();
}
function renderCommands() {
  results.replaceChildren();
  for (const command of searchCommands(commands,query.value)) {
    const button = element('button',`${command.label}${state?.on[command.widget] === false ? ' · Off' : ''}`);
    button.type = 'button';
    button.dataset.command = command.id;
    button.disabled = !manager;
    button.addEventListener('click',() => {
      closePalette();
      run(manager.show(command.widget,command.action));
    });
    results.append(button);
  }
  if (!results.childElementCount) results.append(element('p','No commands found.'));
}
function changed(next) {
  state = next;
  for (const [id,button] of navButtons) {
    button.hidden = !next.on[id];
    if (id === next.lastView) button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
  }
  for (const [id,input] of switches) input.checked = next.on[id];
  shell.querySelector('[data-empty]').hidden = Boolean(next.lastView);
  if (!palette.hidden) renderCommands();
  if (!restoring) prefs.save(next);
}

// Resource paths come only from widget-loaders.js. Removing a widget while its stylesheet is
// still loading removes that link immediately; the late load cannot reattach it.
function loadStyle(href, signal) {
  return new Promise((resolve,reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';link.href = href;link.dataset.widgetStyle = href;
    const remove = () => link.remove();
    const abort = () => {remove();resolve(remove);};
    signal.addEventListener('abort',abort,{once:true});
    link.onload = () => {signal.removeEventListener('abort',abort);resolve(remove);};
    link.onerror = () => {signal.removeEventListener('abort',abort);remove();reject(Error('This widget could not load its style. Try opening it again.'));};
    if (signal.aborted) abort();else document.head.append(link);
  });
}

for (const widget of widgets) {
  const button = element('button',widget.name);
  button.type = 'button';button.dataset.view = widget.id;button.disabled = true;
  button.addEventListener('click',() => run(manager.show(widget.id)));
  navigation.append(button);navButtons.set(widget.id,button);
  const label = element('label');
  const input = element('input');
  input.type='checkbox';input.dataset.widget=widget.id;input.disabled=true;
  input.setAttribute('aria-label',widget.settings.label);
  input.addEventListener('change',() => {
    const on = input.checked;
    run((async () => {
      if (on) await manager.show(widget.id);
      else {
        await manager.setEnabled(widget.id,false);
        if (!manager.snapshot().lastView) {
          const next=widgets.find(entry=>manager.snapshot().on[entry.id]);
          if (next) await manager.show(next.id);
        }
      }
    })());
  });
  label.append(input,element('span',widget.name));options.append(label);switches.set(widget.id,input);
}

paletteToggle.addEventListener('click',() => palette.hidden ? openPalette() : closePalette());
shell.querySelector('[data-palette-close]').addEventListener('click',closePalette);
widgetToggle.addEventListener('click',() => {
  settings.hidden=!settings.hidden;
  widgetToggle.setAttribute('aria-expanded',String(!settings.hidden));
});
query.addEventListener('input',renderCommands);
query.addEventListener('keydown',event => {
  if (event.key === 'ArrowDown') {event.preventDefault();results.querySelector('button')?.focus();}
  if (event.key === 'Enter') {event.preventDefault();results.querySelector('button')?.click();}
});
results.addEventListener('keydown',event => {
  if (!['ArrowDown','ArrowUp'].includes(event.key)) return;
  event.preventDefault();
  const buttons=[...results.querySelectorAll('button')];
  const index=buttons.indexOf(document.activeElement);
  buttons[(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();
});
document.addEventListener('keydown',event => {
  if ((event.metaKey||event.ctrlKey)&&!event.altKey&&event.key.toLowerCase()==='k') {event.preventDefault();openPalette();}
  if (event.key==='Escape'&&!palette.hidden) {event.preventDefault();event.stopPropagation();closePalette();}
  else if (event.key==='Escape'&&!settings.hidden) {settings.hidden=true;widgetToggle.setAttribute('aria-expanded','false');widgetToggle.focus();}
  if (event.key==='Tab'&&!palette.hidden) {
    const controls=[...palette.querySelectorAll('input,button')].filter(node=>!node.disabled);
    const first=controls[0],last=controls.at(-1);
    if (event.shiftKey&&document.activeElement===first) {event.preventDefault();last.focus();}
    else if (!event.shiftKey&&document.activeElement===last) {event.preventDefault();first.focus();}
  }
});
renderCommands();

function catalogChanged(catalog) {
  commands = [...paletteIndex,...catalog.map(item=>({id:`json.${item.id}.open`,label:`Open ${item.name}`,widget:'declarative',group:'JSON widgets',action:`instance:${item.id}`}))];
  if (!palette.hidden) renderCommands();
}

async function start() {
  const info = await bridge.ready;
  shell.dataset.state = info.available?'connected':'unavailable';
  status.textContent = info.available ? (info.authenticated ? 'Connected · Signed in' : 'Connected · Local workspace') : 'Desktop connection unavailable';
  const saved = info.available ? await prefs.read() : {on:{},lastView:null};
  if (!info.available) report('Open this page in the Open Sesame app to connect to this machine.');
  catalogChanged(prefs.catalog);
  manager = createLifecycle({widgets,loaders,styles,loadStyle,
    createSurface: id => {
      const surface = element('section');surface.className='widget-view';surface.dataset.widgetView=id;
      surface.setAttribute('aria-label',widgets.find(widget=>widget.id===id).panel.title);
      views.append(surface);return surface;
    },
    context:{bridge,host:window,info,navigate:id=>manager.show(id),report,catalogChanged},onChange:changed,
  });
  const initial = manager.restore(saved);
  changed(manager.snapshot());
  for (const button of navButtons.values()) button.disabled=false;
  for (const input of switches.values()) input.disabled=false;
  // show() records the restored view before its first await; only that record is skipped. A
  // switch or view the person changes while the first view is still loading is saved.
  try {
    const first = initial ? manager.show(initial) : null;
    restoring = false;
    await first;
  }
  catch (error) { report(message(error)); }
  finally {
    restoring=false;
    shell.setAttribute('aria-busy','false');
    shell.dataset.ready='true';
  }
  // The existing native terminal self-test keeps using the product's own pane launcher.
  const selftest = window.__OPEN_SESAME_SELFTEST__;
  if (selftest) {
    await manager.show('shells');
    // The self-test is a development-only first-party widget command, not a public global.
    await manager.show('shells','selftest');
  }
}
run(start());
