'use strict';
// Copy legacy browser data before feature scripts read the renamed keys.
// Keep originals and newer values intact, including pending OAuth state.
(()=>{
  for(const name of ['localStorage','sessionStorage']){
    try{
      const storage=window[name],keys=[];
      for(let index=0;index<storage.length;index++)keys.push(storage.key(index));
      for(const key of keys){
        if(!key?.startsWith('perch-'))continue;
        const next='open-sesame-'+key.slice(6);
        if(storage.getItem(next)===null){
          const value=storage.getItem(key);
          if(value!==null)storage.setItem(next,value);
        }
      }
    }catch{ /* Original keys are never removed if device storage is restricted. */ }
  }
})();
