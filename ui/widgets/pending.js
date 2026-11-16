// Honest landing surfaces for separately owned ports; no fixture data or provider requests.
export async function mount({surface, widget}) {
  const title = surface.ownerDocument.createElement('h2');
  title.textContent = widget.name;
  const note = surface.ownerDocument.createElement('p');
  note.textContent = 'This widget is not available in this version.';
  surface.append(title,note);
  return {};
}
