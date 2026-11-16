// Development-only #105 qualification through the actual page's bridge, enabled by the host's
// existing OPEN_SESAME_SELFTEST object. Results remain visible for native observation.
export async function run({ bridge, config }) {
  const panel = document.createElement('section');
  panel.setAttribute('aria-label', 'Runtime qualification');
  const heading = document.createElement('h2');
  heading.textContent = 'Runtime qualification';
  const output = document.createElement('pre');
  output.setAttribute('data-runtime-result', 'pending');
  output.textContent = 'Checking saved data…';
  panel.append(heading, output);
  document.querySelector('.shell').append(panel);
  if (config.delayMs) await new Promise(resolve => setTimeout(resolve, Math.min(12000, Math.max(0, Number(config.delayMs) || 0))));
  const text = String(config.text || 'Issue 105 disposable native qualification');
  try {
    if (config.phase === 'save') await bridge.request('items.save', { item: { kind: 'note', text } });
    const listed = await bridge.request('items.list', {});
    const items = listed.items.filter(item => item.text === text);
    if (!items.length) throw new Error('The qualification item was not returned by storage.');
    output.textContent = JSON.stringify({ phase: config.phase, saved: true, items }, null, 2);
    output.setAttribute('data-runtime-result', 'passed');
  } catch (error) {
    output.textContent = JSON.stringify({ phase: config.phase, saved: false, error: String(error?.message || error) }, null, 2);
    output.setAttribute('data-runtime-result', 'error');
  }
}
