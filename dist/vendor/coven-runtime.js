/*! OpenCoven Chat runtime interface | MIT | pinned a8c76390ff946389224b86e5ff91b8b6c11bf413 */
(()=>{class Channel {onmessage=null}const canUseTauriCommands=()=>false,invoke=()=>Promise.reject(new Error("Native Coven transport is not configured."));
const UNAVAILABLE = 'Local Coven requires the desktop app. Install Coven CLI and open OpenCoven Chat.';
function record(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function session(value) {
    return record(value) && (value.archived === undefined || typeof value.archived === 'boolean') && [
        'id',
        'title',
        'harness',
        'status',
        'updatedAt',
        'projectRoot'
    ].every((key)=>typeof value[key] === 'string');
}
function event(value) {
    return record(value) && typeof value.type === 'string';
}
function optionalText(value, limit = 4096) {
    return value === undefined || typeof value === 'string' && value.length <= limit;
}
function oneOf(value, allowed) {
    return value === undefined || typeof value === 'string' && allowed.includes(value);
}
function status(value) {
    return record(value) && typeof value.available === 'boolean' && optionalText(value.version, 256) && optionalText(value.error, 2048) && oneOf(value.sdkHealth, [
        'ok',
        'unavailable'
    ]) && oneOf(value.transport, [
        'cli'
    ]) && oneOf(value.setup, [
        'install-cli',
        'install-engine'
    ]);
}
function familiar(value) {
    return record(value) && typeof value.id === 'string' && typeof value.name === 'string' && typeof value.displayName === 'string' && optionalText(value.description) && optionalText(value.emoji, 32) && optionalText(value.workspace) && (value.projectAccess === undefined || Array.isArray(value.projectAccess) && value.projectAccess.length <= 1024 && value.projectAccess.every((project)=>record(project) && typeof project.name === 'string' && project.name.length > 0 && project.name.length <= 4096 && typeof project.path === 'string' && project.path.length > 0 && project.path.length <= 4096 && (project.access === 'read' || project.access === 'write'))) && (value.projectAccessUnavailable === undefined || value.projectAccessUnavailable === true) && (value.avatarUrl === undefined || typeof value.avatarUrl === 'string' && value.avatarUrl.length <= 256 * 1024 && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.avatarUrl));
}
function checked(value, guard) {
    if (!guard(value)) throw new Error('Coven returned an invalid native result.');
    return value;
}
function events(value) {
    return Array.isArray(value) && value.every(event);
}
function createCovenRuntime(options = {}) {
    const available = options.available ?? canUseTauriCommands;
    const invokeCommand = options.invoke ?? invoke;
    async function call(command, args) {
        if (!available()) throw new Error(UNAVAILABLE);
        try {
            return args ? await invokeCommand(command, args) : await invokeCommand(command);
        } catch (error) {
            const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
            throw new Error(message.slice(0, 2048) || 'Local Coven operation failed.');
        }
    }
    return {
        async status () {
            if (!available()) return {
                available: false,
                error: UNAVAILABLE
            };
            return checked(await call('coven_runtime_status'), status);
        },
        async listFamiliars () {
            return checked(await call('coven_runtime_familiars'), (v)=>Array.isArray(v) && v.every(familiar));
        },
        async listSessions () {
            return checked(await call('coven_runtime_sessions'), (v)=>Array.isArray(v) && v.every((item)=>session(item) && typeof item.familiarId === 'string' && item.familiarId.length > 0) && new Set(v.map((item)=>item.familiarId)).size === v.length);
        },
        async readSession (id, depth = 1) {
            return checked(await call('coven_runtime_read', depth > 1 ? {
                id,
                depth
            } : {
                id
            }), (v)=>record(v) && session(v.session) && v.session.id === id && events(v.events));
        },
        async send (input, onEvent) {
            if (!available()) throw new Error(UNAVAILABLE);
            const channel = new Channel();
            channel.onmessage = (value)=>onEvent?.(checked(value, event));
            const result = checked(await call('coven_runtime_send', {
                input,
                onEvent: channel
            }), (v)=>record(v) && typeof v.runId === 'string' && events(v.events));
            const initialization = result.events.find((event)=>event.type === 'system' && event.subtype === 'init');
            const sessionId = initialization?.session_id;
            return typeof sessionId === 'string' && sessionId.length > 0 ? {
                ...result,
                sessionId
            } : result;
        },
        async cancel (runId) {
            await call('coven_runtime_cancel', {
                runId
            });
        },
        async changeChatLifecycle (id, lifecycle) {
            const result = await call('coven_runtime_chat_lifecycle', {
                id,
                lifecycle
            });
            if (result !== null && result !== undefined) throw new Error('Coven returned an invalid native result.');
        }
    };
}

window.OpenSesameCovenRuntime={create:createCovenRuntime};})();
