// Honest landing surfaces for separately owned ports; no fixture data or provider requests.
export async function mount({surface, widget}) {
  const title = surface.ownerDocument.createElement('h2');
  title.textContent = widget.name;
  const note = surface.ownerDocument.createElement('p');
  // A pending widget is on (it is in the strip), so the next step is to turn it off (#201).
  note.textContent = `${widget.name} is coming in a later version. Turn it off in Settings to hide it from the rail.`;
  surface.append(title,note);
  return {};
}
