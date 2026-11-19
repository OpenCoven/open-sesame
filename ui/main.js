import { CHANGED_EVENT, mountAccount } from './account.js';
import { createAttention, summary, watchFocus } from './attention.js';
import { createBridge } from './bridge.js';
import { widgets, paletteIndex, wideViews } from './manifest.js';
import { draftAction, paletteView } from './palette.js';
import { loaders, styles } from './widget-loaders.js';
import { createLifecycle } from './lifecycle.js';
import { createPreferences } from './preferences.js';
import { mountRail } from './rail.js';
import { holdDuringDrag, mountSummon } from './summon.js';
import { PANEL_SHOWN } from './widgets/view-kit.js';
import { mountContextMenu } from './context-menu.js';

const bridge = createBridge(window);
const shell = document.querySelector('.shell');
const status = shell.querySelector('[data-status]');
const notice = shell.querySelector('[data-shell-notice]');
const navigation = shell.querySelector('[data-navigation]');
const views = shell.querySelector('[data-view-host]');
const options = shell.querySelector('[data-widget-options]');
const palette = shell.querySelector('#command-palette');
const settings = shell.querySelector('#widget-settings');
const hostSettings = shell.querySelector('[data-settings]');
const query = shell.querySelector('[data-command-query]');
const results = shell.querySelector('[data-command-results]');
const paletteToggle = shell.querySelector('[data-palette-toggle]');
const widgetToggle = shell.querySelector('[data-widgets-toggle]');
const viewTitle = shell.querySelector('[data-view-title]');
const wideToggle = shell.querySelector('[data-wide-toggle]');
const attentionStatus = shell.querySelector('[data-attention-status]');
const railToggle = shell.querySelector('[data-rail-toggle]');
// How the window is drawn (src-tauri/src/rail.rs): 'material' where the system's material shows
// through the page, 'page' where the window is see-through and the page draws its own rounded
// corners, 'solid' otherwise.
document.documentElement.dataset.surface = ['material','page'].includes(window.__OPEN_SESAME_SURFACE__) ? window.__OPEN_SESAME_SURFACE__ : 'solid';
const message = error => error?.message || String(error);
const report = text => {notice.textContent = text; notice.hidden = !text;};
const prefs = createPreferences(bridge, report);
const element = (tag, text) => {const node = document.createElement(tag); if (text) node.textContent = text;return node;};
// An icon from the sprite in index.html, by the name after `icon-`.
const iconTemplate = document.querySelector('#icon-template');
const icon = name => {
  const node = iconTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector('use').setAttribute('href',`#icon-${name}`);
  return node;
};
const hiddenLabel = text => {const node = element('span',text);node.className = 'label-hidden';return node;};
const names = new Map(widgets.map(widget => [widget.id,widget.name]));
let commands = paletteIndex;
let manager;
let state;
let restoring = true;
// A palette capture that was not saved (issue #77) is kept with its draft ID: its text comes back
// each time the palette opens, and its reason stays shown, until it is saved or the person closes
// the palette with the field empty. Text typed in the field, a search included, replaces neither.
// A retry of it, edited or not, names the same draft, so the core keeps one row.
const OVERTAKEN = 'That capture was not saved because another view opened first. The palette keeps it; try again.';
let kept = null, drafts = 0;
const keep = (text, draft, error) => {kept = {text, draft, error};report(error);};
const drop = () => {if (kept && notice.textContent === kept.error) report('');kept = null;};
const navButtons = new Map();
const switches = new Map();
const run = promise => promise.catch(error => report(message(error)));
// The native context menu is never opened (issue #115); see context-menu.js. It is mounted
// before the host answers. Until this module has run, and if it fails to load, the page has
// the native one.
mountContextMenu(bridge, document, { report });

// The rail (src-tauri/src/rail.rs). `looking` is whether the person can see a view now: it is
// the one shown, the panel is open and the window is on screen.
const attention = createAttention();
const looking = id => state?.lastView === id && rail.status().expanded && document.visibilityState === 'visible';
const focusWatch = watchFocus({bridge, attention, showing: () => looking('focus')});
// Shells opens at the wide width until the person narrows it; the choice lasts until the
// application quits.
let widePreferred = true;
const wideFor = view => wideViews.includes(view) && widePreferred;
function drawWide() {
  const status = rail.status();
  wideToggle.hidden = !(status.presentation === 'rail' && wideViews.includes(state?.lastView));
  wideToggle.setAttribute('aria-pressed',String(status.wide));
}
function sawView() {
  const view = state?.lastView;
  if (!view || !looking(view)) return;
  attention.seen(view);
  if (view === 'focus') focusWatch.refresh();
}
const section = shell.querySelector('[data-rail-settings]');
const rail = mountRail(bridge, {
  shell, panel: shell.querySelector('[data-panel]'), toggle: railToggle,
  toggleLabel: shell.querySelector('[data-rail-toggle-label]'),
  collapse: shell.querySelector('[data-collapse]'),
  section, edge: section.querySelector('[data-rail-edge]'), hover: section.querySelector('[data-rail-hover]'),
  message: section.querySelector('[data-rail-message]'),
  blurLabel: shell.querySelector('[data-summon-blur-label]'),
}, (status, previous) => {
  drawWide();
  if (previous.expanded && !status.expanded) {
    // The strip shows no sheet. What the palette keeps, it keeps.
    if (!palette.hidden) {palette.hidden = true;paletteToggle.setAttribute('aria-expanded','false');}
    showSettings(false);
    focusWatch.refresh();
  }
  if (!previous.expanded && status.expanded) {
    document.dispatchEvent(new Event(PANEL_SHOWN));
    sawView();
  }
});
function showSettings(open) {
  settings.hidden = !open;
  widgetToggle.setAttribute('aria-expanded',String(open));
  drawTitle();
}
// The bar names what the panel shows: a sheet while one is open, otherwise the view.
function drawTitle() {
  viewTitle.textContent = !palette.hidden ? 'Commands' : !settings.hidden ? 'Settings' : names.get(state?.lastView) ?? 'Open Sesame';
}
attention.subscribe(marks => {
  for (const [id,button] of navButtons) {
    const mark = marks.get(id);
    if (mark) button.dataset.mark = mark.tone;else delete button.dataset.mark;
    button.title = mark ? `${names.get(id)}: ${mark.label}` : names.get(id);
  }
  const all = summary(marks,names);
  if (all.tone) railToggle.dataset.mark = all.tone;else delete railToggle.dataset.mark;
  attentionStatus.textContent = all.label;
});

function closePalette() {
  if (palette.hidden) return;
  if (kept && !query.value.trim()) drop();
  palette.hidden = true;
  paletteToggle.setAttribute('aria-expanded','false');
  drawTitle();
  paletteToggle.focus();
}
function openPalette() {
  showSettings(false);
  run(rail.open());
  palette.hidden = false;
  paletteToggle.setAttribute('aria-expanded','true');
  drawTitle();
  query.value = kept?.text ?? '';
  renderCommands();
  query.focus();
}
// A calculator or world-clock answer (issue #77) comes first. It invokes no command: choosing it
// copies the result, or says why it could not.
function renderAnswer(found) {
  if (found.error) {
    const line = element('p',found.error);
    line.dataset.commandAnswer = 'error';
    return line;
  }
  const button = element('button');
  button.type = 'button';
  button.dataset.commandAnswer = found.kind;
  button.append(element('strong',found.result),element('span',` ${found.expression} · Copy`));
  button.addEventListener('click',() => {
    const copied = navigator.clipboard?.writeText(found.result) ?? Promise.reject(Error('unavailable'));
    copied.then(() => {button.lastChild.textContent = ` ${found.expression} · Copied`;},
      () => {button.lastChild.textContent = ` ${found.expression} · Could not copy. Select the result to copy it.`;});
  });
  return button;
}
function renderCommands() {
  results.replaceChildren();
  const view = paletteView(commands,query.value);
  if (view.answer) results.append(renderAnswer(view.answer));
  for (const command of view.commands) {
    const button = element('button',`${command.label}${state?.on[command.widget] === false ? ' · Off' : ''}`);
    button.type = 'button';
    button.dataset.command = command.id;
    button.disabled = !manager;
    if (command.capture && !view.captureOnEnter) button.dataset.notOnEnter = '';
    button.addEventListener('click',() => {
      // A capture counts as saved only when Today says so. One that failed goes back to the
      // palette with the reason; one that never ran, because another view opened before Today
      // was ready, is kept for the next time the palette opens.
      const typed = query.value, draft = command.capture ? kept?.draft ?? `palette-${++drafts}` : null;
      closePalette();
      run(manager.show(command.widget,command.capture ? draftAction(command.action,draft) : command.action).then(result => {
        if (!command.capture) return;
        if (result?.saved === true) {if (kept?.draft === draft) drop();}
        else keep(typed,draft,OVERTAKEN);
      },error => {
        if (!command.capture) throw error;
        keep(typed,draft,message(error));
        openPalette();
      }));
    });
    results.append(button);
  }
  if (!results.childElementCount) results.append(element('p','No commands found.'));
}
function changed(next) {
  const before = state?.lastView;
  state = next;
  drawTitle();
  drawWide();
  if (before !== next.lastView) {
    // The panel takes the width the view asks for; the host is told only when that changes.
    if (manager) run(rail.setWide(wideFor(next.lastView)));
    if (before === 'focus') focusWatch.refresh();
    sawView();
  }
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
  const button = element('button');
  // tabIndex: WebKit leaves a button out of Tab unless it asks to be in it.
  button.type = 'button';button.className = 'rail-button';button.tabIndex = 0;button.dataset.view = widget.id;button.disabled = true;
  button.title = widget.name;
  button.append(icon(widget.id),hiddenLabel(widget.name));
  // A click on the strip opens the panel to stay on that view, with no sheet over it.
  button.addEventListener('click',() => {
    closePalette();showSettings(false);
    run(rail.open());
    run(manager.show(widget.id));
  });
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

paletteToggle.addEventListener('click',() => palette.hidden || !rail.status().expanded ? openPalette() : closePalette());
shell.querySelector('[data-palette-close]').addEventListener('click',closePalette);
widgetToggle.addEventListener('click',() => {
  const open = settings.hidden || !rail.status().expanded;
  if (open) {closePalette();run(rail.open());}
  showSettings(open);
  if (open) settings.querySelector('h2')?.scrollIntoView?.({block:'nearest'});
});
wideToggle.addEventListener('click',() => {
  widePreferred = !rail.status().wide;
  run(rail.setWide(wideFor(state?.lastView)));
});
query.addEventListener('input',renderCommands);
query.addEventListener('keydown',event => {
  if (event.key === 'ArrowDown') {event.preventDefault();results.querySelector('button')?.focus();}
  if (event.key === 'Enter') {event.preventDefault();results.querySelector('button:not([data-not-on-enter])')?.click();}
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
  else if (event.key==='Escape'&&!settings.hidden) {showSettings(false);widgetToggle.focus();}
  // Escape closes the panel when nothing else took it. A terminal needs the key for itself.
  else if (event.key==='Escape'&&!event.defaultPrevented&&!event.target?.closest?.('.xterm')) run(rail.collapse());
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

// The account (issue #72) and the shortcut (issue #71) belong to the host, not to a widget, so
// they mount once the host answers, whatever widgets are on.
const connected = signedIn => signedIn ? 'Connected · Signed in' : 'Connected · Local workspace';
function mountHostSettings() {
  hostSettings.hidden = false;
  const account = hostSettings.querySelector('[data-account]');
  mountAccount(bridge, {
    section: account,
    title: account.querySelector('[data-account-title]'),
    detail: account.querySelector('[data-account-detail]'),
    signIn: account.querySelector('[data-account-sign-in]'),
    cancel: account.querySelector('[data-account-cancel]'),
    signOut: account.querySelector('[data-account-sign-out]'),
  });
  const section = hostSettings.querySelector('[data-summon]');
  mountSummon(bridge, {
    section,
    hint: section.querySelector('[data-summon-hint]'),
    form: section.querySelector('[data-summon-form]'),
    input: section.querySelector('#summon-shortcut'),
    message: section.querySelector('[data-summon-message]'),
    blur: section.querySelector('[data-summon-blur]'),
  });
  holdDuringDrag(bridge, document);
  // The bar names the account state too, so it follows the host's changes as the account does.
  bridge.subscribe(message => {
    if (message.event === CHANGED_EVENT && message.status && typeof message.status === 'object') status.textContent = connected(message.status.authenticated === true);
  });
}
document.addEventListener('visibilitychange',() => {if (document.visibilityState === 'visible') {focusWatch.refresh();sawView();}});
async function start() {
  const info = await bridge.ready;
  await rail.ready;
  shell.dataset.state = info.available?'connected':'unavailable';
  status.textContent = info.available ? connected(info.authenticated === true) : 'Desktop connection unavailable';
  if (info.available) mountHostSettings();
  // Development self-tests (ui/dev), set only by a development build started with
  // OPEN_SESAME_SELFTEST. The storage qualification of #105 needs only the bridge: it starts as
  // soon as the host answers, as it did before the views, opens no widget and changes no
  // preference, and does not wait for the first view.
  const selftest = window.__OPEN_SESAME_SELFTEST__;
  if (info.available && selftest?.kind === 'runtime') run(import('./dev/selftest.js').then(module => module.run({bridge, config: selftest})));
  const saved = info.available ? await prefs.read() : {on:{},lastView:null};
  if (!info.available) report('Open this page in the Open Sesame app to connect to this machine.');
  catalogChanged(prefs.catalog);
  manager = createLifecycle({widgets,loaders,styles,loadStyle,
    createSurface: id => {
      const surface = element('section');surface.className='widget-view';surface.dataset.widgetView=id;
      surface.setAttribute('aria-label',widgets.find(widget=>widget.id===id).panel.title);
      views.append(surface);return surface;
    },
    context:{bridge,host:window,info,navigate:id=>manager.show(id),report,catalogChanged,
      attention:Object.freeze({set:attention.set,showing:looking})},onChange:changed,
  });
  const initial = manager.restore(saved);
  changed(manager.snapshot());
  for (const button of navButtons.values()) button.disabled=false;
  for (const input of switches.values()) input.disabled=false;
  if (info.available) focusWatch.refresh();
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
  // The terminal self-test uses the product's own pane launcher.
  if (selftest && selftest.kind !== 'runtime') {
    await manager.show('shells');
    // The self-test is a development-only first-party widget command, not a public global.
    await manager.show('shells','selftest');
  }
}
run(start());
