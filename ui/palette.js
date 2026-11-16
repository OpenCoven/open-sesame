import { answer } from './palette-answers.js';

// Palette discovery is a pure metadata query, including widgets that are off or not ported.
export function searchCommands(index, query) {
  const terms = String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return index.filter(command => terms.every(term => `${command.label} ${command.group}`.toLocaleLowerCase().includes(term)));
}

// Typed text the palette can capture into Today (issue #77), as the prototype's capture bar
// read it: "note:", "task:" or "todo:" choose the kind, and other text offers both. Text that
// starts with / or ! is a command, never a draft. The action carries the whole draft; the label
// shortens it.
const PREFIX = /^(note|task|todo):\s*([\s\S]*)$/i;
const shorten = text => text.length > 60 ? `${text.slice(0, 59).trimEnd()}…` : text;
export function captureCommands(query) {
  const text = String(query).trim();
  if (!text || /^[!/]/.test(text)) return [];
  const prefixed = text.match(PREFIX);
  const body = (prefixed ? prefixed[2] : text).trim();
  if (!body) return [];
  const kinds = prefixed ? [prefixed[1].toLowerCase() === 'note' ? 'note' : 'task'] : ['note', 'task'];
  return kinds.map(kind => Object.freeze({
    id: `today.capture-${kind}.text`, label: `Capture ${kind}: ${shorten(body.replace(/\s+/g, ' '))}`,
    widget: 'today', group: 'Today', action: `capture-${kind}:${body}`, capture: true,
  }));
}

// What the palette shows for a query: a calculator or world-clock answer, which is shown and
// invokes nothing, and the commands, matching ones first. An answer replaces the captures, so
// Enter never saves a sum or a time question as a note.
export function paletteView(index, query, options) {
  const found = answer(String(query), options);
  return {answer: found, commands: [...searchCommands(index, query), ...(found ? [] : captureCommands(query))]};
}
