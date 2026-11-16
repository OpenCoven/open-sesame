// Data only: reading the palette never imports a widget. Availability names a pending port,
// independently of the two user states (on/off). Each port replaces its pending renderer.
const entry = (id, name, defaultOn, issue, commands = []) => Object.freeze({
  id, name, defaultOn, issue,
  panel: Object.freeze({ title: name }),
  settings: Object.freeze({ label: `Turn ${name} on or off` }),
  commands: Object.freeze([
    Object.freeze({ id: `${id}.open`, label: `Open ${name}`, action: 'open' }),
    ...commands.map(command => Object.freeze(command)),
  ]),
});
export const widgets = Object.freeze([
  entry('today', 'Today', true, 77, [
    {id: 'today.capture-note', label: 'Capture a note', action: 'capture-note'},
    {id: 'today.capture-task', label: 'Capture a task', action: 'capture-task'},
  ]),
  entry('projects', 'Projects', true, 77),
  entry('focus', 'Focus', true, 77),
  entry('shells', 'Shells', true, null, [{id: 'shells.new', label: 'New shell', action: 'new'}]),
  entry('agents', 'Agents', true, 79),
  entry('reader', 'Reader and feeds', false, 82),
  entry('github', 'GitHub monitor', false, 83),
  entry('familiars', 'Coven Familiars', false, 84),
  entry('local-media', 'Local media', false, 58),
  entry('desktops', 'Remote desktops', false, 58),
  entry('transcription', 'Local transcription', false, 85),
  entry('declarative', 'JSON widgets', false, null),
]);
export const paletteIndex = Object.freeze(widgets.flatMap(widget => widget.commands.map(command =>
  Object.freeze({...command, widget: widget.id, group: widget.name}),
)));
