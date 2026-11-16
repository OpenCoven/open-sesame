// Persistence belongs to the core. No prototype localStorage keys are read or migrated.
// The existing storage wire uses active/inactive; the shell exposes only on/off.
export function createPreferences(bridge, report) {
  let queue = Promise.resolve();
  let writable = false;
  let catalog = [];
  let saved = {on:{},lastView:null};
  const failed = error => report(`Widget preferences could not be saved or restored. ${error.message || error}`);
  return Object.freeze({
    get catalog() { return catalog; },
    async read() {
      writable = false;
      try {
        const [settings, states] = await Promise.all([bridge.request('settings.all',{}),bridge.request('widgets.list',{})]);
        if (!settings?.settings || !states?.widgets || Array.isArray(settings.settings) || Array.isArray(states.widgets) || typeof settings.settings !== 'object' || typeof states.widgets !== 'object') throw Error('Unexpected saved preferences.');
        const on = {};
        for (const [id,value] of Object.entries(states.widgets)) {
          if (!['active','inactive','uninstalled'].includes(value)) throw Error('Saved widget state needs recovery.');
          on[id] = value === 'active';
        }
        const instances = settings.settings['shell.jsonWidgets'];
        catalog = Array.isArray(instances) ? instances.filter(x => typeof x?.id === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(x.id) && typeof x?.definition?.name === 'string').map(x => ({id:x.id,name:x.definition.name.slice(0,500)})) : [];
        const lastView = Object.hasOwn(settings.settings,'shell.lastView') ? settings.settings['shell.lastView'] : null;
        if (lastView !== null && (typeof lastView !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(lastView))) throw Error('Saved navigation needs recovery. Original data is preserved.');
        writable = true;
        saved = {on,lastView};
        return saved;
      } catch(error) {failed(error);return {on:{},lastView:null};}
    },
    save(state) {
      // Serialise writes so fast navigation cannot save an older last view after a newer one.
      const next = {on:{...state.on},lastView:state.lastView};
      queue = queue.then(async () => {
        if (!writable) throw Error('Original preferences are preserved; restart after storage is available.');
        for (const [id,on] of Object.entries(next.on)) if (saved.on[id] !== on) {
          await bridge.request('widgets.set',{id,state:on?'active':'inactive'});
          saved.on[id] = on;
        }
        if (saved.lastView !== next.lastView) {
          await bridge.request('settings.set',{key:'shell.lastView',value:next.lastView});
          saved.lastView = next.lastView;
        }
      }).catch(failed);
      return queue;
    },
  });
}
