// The account control (issue #72): whether a person is signed in, and the three things they can
// do about it. Sign-in is not a door (issue #60): the shell is usable signed out, and this
// control sits in it like any other setting.
//
// The host owns all of it (src-tauri/src/auth.rs). The page asks `auth.status`, sends
// `auth.signIn`, `auth.cancel` and `auth.signOut`, and is told of every change by an
// `auth.changed` host message carrying the same status. The page never sees an address, a code
// or a credential: the host opens the browser and receives the callback. Everything the control
// touches is passed in, so scripts/check-tauri-sign-in.mjs can run it in Node against stand-ins.

export const CHANGED_EVENT = 'auth.changed';
export const LOCAL = 'Everything on this computer works without an account.';

const text = error => (error && typeof error.message === 'string' && error.message) || String(error);
const words = value => (typeof value === 'string' ? value : '');

// What the control says for a status from the host:
// {state, title, detail, warn, signIn, cancel, signOut}. Anything that is not plainly a signed-in
// status is shown as signed out.
export function describe(status) {
  const known = status && typeof status === 'object' ? status : {};
  const message = words(known.message);
  if (known.authenticated === true) {
    const who = words(known.email) || words(known.name);
    return { state: 'signed-in', title: who ? `Signed in as ${who}` : 'Signed in', detail: message, warn: false, signIn: false, cancel: false, signOut: true };
  }
  if (known.busy === true) {
    return { state: 'signing-in', title: 'Signing in', detail: message, warn: false, signIn: false, cancel: true, signOut: false };
  }
  return { state: 'signed-out', title: 'Not signed in', detail: message ? `${message} ${LOCAL}` : LOCAL, warn: false, signIn: true, cancel: false, signOut: false };
}

/**
 * Runs the control.
 *
 * bridge: the object from createBridge
 * parts: { section, title, detail, signIn, cancel, signOut } - the control's elements
 */
export function mountAccount(bridge, parts) {
  const { section, title, detail, signIn, cancel, signOut } = parts;
  let busy = false;

  const say = (sentence, warn) => {
    detail.textContent = sentence;
    detail.dataset.warn = warn ? 'true' : 'false';
  };

  const show = status => {
    const view = describe(status);
    section.dataset.state = view.state;
    title.textContent = view.title;
    say(view.detail, view.warn);
    signIn.hidden = !view.signIn;
    cancel.hidden = !view.cancel;
    signOut.hidden = !view.signOut;
    section.hidden = false;
  };

  const refresh = () => bridge.request('auth.status').then(show);

  // One request at a time. Whatever the host answers, the control then shows the host's status,
  // with the host's own sentence on top when it refused.
  const act = async method => {
    if (busy) return;
    busy = true;
    for (const button of [signIn, cancel, signOut]) button.disabled = true;
    let refusal = '';
    try {
      await bridge.request(method);
    } catch (error) {
      refusal = text(error);
    }
    await refresh().catch(() => {});
    if (refusal) say(refusal, true);
    for (const button of [signIn, cancel, signOut]) button.disabled = false;
    busy = false;
  };

  signIn.addEventListener('click', () => { act('auth.signIn'); });
  cancel.addEventListener('click', () => { act('auth.cancel'); });
  signOut.addEventListener('click', () => { act('auth.signOut'); });

  // The host says when the session changes: the browser came back, a refresh failed, a session
  // lapsed. The status in the message is shown as it arrives.
  bridge.subscribe(message => {
    if (message.event === CHANGED_EVENT && message.status && typeof message.status === 'object') show(message.status);
  });

  // The control stays hidden if the host has no sign-in methods.
  return refresh().catch(() => {});
}
