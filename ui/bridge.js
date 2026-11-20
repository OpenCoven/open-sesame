// Bridge client for the Tauri host (issue #70). An ES module with no dependency: it uses the
// global Tauri object the host injects and defines nothing on window.
//
// The envelope is the wire protocol in crates/core/src/protocol.rs. A request is
// {requestId, method, params} sent through the single `bridge_request` command, whose answer is
// {requestId, result} or {requestId, error}. Host messages that are not replies arrive as
// `open-sesame-message` events whose payload is an object with an `event` key. Events are for
// low-volume messages; high-volume terminal output uses channels (issue #74).
//
// The host decides what a request may do (crates/core/src/gate.rs). Nothing here is a security
// check: any script in the main document can call the command directly, which is why the shell
// loads only its own files.

export const COMMAND = 'bridge_request';
export const MESSAGE_EVENT = 'open-sesame-message';
export const UNAVAILABLE = 'Open Open Sesame on your desktop to connect to this machine.';
export const NO_RESPONSE = 'The desktop connection did not respond.';

const DEFAULT_LIMIT = 15000;
// Methods that wait for the person rather than the machine.
const LIMITS = { 'project.chooseFolder': 180000 };

const sentence = error => (typeof error === 'string' && error) || (error && typeof error.message === 'string' && error.message) || NO_RESPONSE;

export function createBridge(host) {
  const tauri = host.__OPEN_SESAME_NATIVE__ === true ? host.__TAURI__ : undefined;
  const invoke = tauri?.core?.invoke;
  const listen = tauri?.event?.listen;
  const native = typeof invoke === 'function' && typeof listen === 'function';
  const page = host.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const subscribers = new Set();
  let next = 0;
  let available = false;

  const request = (method, params = {}) => {
    if (!native) return Promise.reject(new Error(UNAVAILABLE));
    const requestId = `request-${page}-${++next}`;
    return new Promise((resolve, reject) => {
      // A late answer after the limit settles nothing: a promise settles once.
      const timer = host.setTimeout(() => reject(new Error(NO_RESPONSE)), LIMITS[method] ?? DEFAULT_LIMIT);
      new Promise(send => send(invoke(COMMAND, { message: { requestId, method, params } }))).then(reply => {
        host.clearTimeout(timer);
        // The host drops a request it will not serve; an answer for another request is not ours.
        if (!reply || reply.requestId !== requestId) reject(new Error(NO_RESPONSE));
        else if (typeof reply.error === 'string') reject(new Error(reply.error));
        else resolve(reply.result);
      }, error => {
        host.clearTimeout(timer);
        reject(new Error(sentence(error)));
      });
    });
  };

  const deliver = message => {
    if (!message || typeof message !== 'object' || typeof message.event !== 'string') return;
    for (const subscriber of [...subscribers]) {
      try { subscriber(message); } catch (error) { console.error('A bridge subscriber failed.', error); }
    }
  };

  const subscribe = subscriber => {
    if (typeof subscriber !== 'function') throw new TypeError('subscribe needs a function.');
    subscribers.add(subscriber);
    return () => { subscribers.delete(subscriber); };
  };

  // Listen before the first request so no host message is missed, then ask the host who it is.
  const ready = native
    ? Promise.resolve()
      .then(() => listen(MESSAGE_EVENT, event => deliver(event?.payload)))
      .then(() => request('system.info'))
      .then(info => { available = true; return { available: true, ...info }; })
      .catch(error => ({ available: false, error: sentence(error) }))
    : Promise.resolve({ available: false });

  return Object.freeze({ request, subscribe, ready, get available() { return available; } });
}
