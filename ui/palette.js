// Palette discovery is a pure metadata query, including widgets that are off or not ported.
export function searchCommands(index, query) {
  const terms = String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return index.filter(command => terms.every(term => `${command.label} ${command.group}`.toLocaleLowerCase().includes(term)));
}
