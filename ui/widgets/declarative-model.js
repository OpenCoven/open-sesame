import {restore} from '../definitions.js';

export const KEY = 'shell.jsonWidgets';
export function createDefinitionStore(bridge) {
  let writable = false;
  return Object.freeze({
    async read() {
      writable=false;
      const result = await bridge.request('settings.all',{});
      try {
        if (!result?.settings || Array.isArray(result.settings) || typeof result.settings !== 'object') throw Error();
        const entries=restore(Object.hasOwn(result.settings,KEY) ? result.settings[KEY] : []);
        writable=true;
        return entries;
      } catch {throw Error('Saved JSON widgets need recovery. Original data is preserved.');}
    },
    async save(entries) {
      if (!writable) throw Error('Original JSON widgets are preserved until storage can be read.');
      restore(entries);
      const result=await bridge.request('settings.set',{key:KEY,value:entries});
      if (result?.saved !== true) throw Error('JSON widgets could not be saved.');
    },
  });
}
const destinations=Object.freeze({items:'projects',reading:'reader',plugins:'declarative',focus:'focus',familiars:'familiars'});
export async function performAction(definition,action,config,{bridge,navigate,signal},id) {
  if (signal.aborted) throw Error('This widget is off.');
  if (!definition.actions.includes(action) || !definition.capabilities.includes(action.operation)) throw Error('This action is not approved.');
  if (action.operation==='navigate') return navigate(destinations[action.value]);
  if (action.operation==='note.save') {
    const text=Object.hasOwn(config,action.value)?config[action.value]:action.value;
    if (!String(text).trim()) throw Error('Enter a note before saving.');
    return bridge.request('items.save',{item:{id,kind:'note',text}});
  }
  // No URL opener is admitted by the restart's host yet. Never escape its navigation policy.
  if (action.operation==='link.open') throw Error('Opening web links is not available in this version.');
  throw Error('This action is not approved.');
}
