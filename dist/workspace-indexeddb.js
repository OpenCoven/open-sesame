'use strict';
// Browser implementation of the persistence contract. This is not the future iOS native adapter.
(()=>{
 function create(indexedDB,{name='open-sesame-workspace-v1'}={}){
  let database=null;
  const failure=(code,message)=>Object.assign(Error(message),{code,committed:false});
  async function open(){
   if(database)return database;
   database=await new Promise((resolve,reject)=>{
    if(!indexedDB){reject(failure('unavailable','Persistent browser storage is unavailable.'));return}
    const request=indexedDB.open(name,1);let rejected=false;
    request.onupgradeneeded=()=>request.result.createObjectStore('workspace');
    request.onerror=()=>reject(failure('unavailable','Could not open persistent workspace storage.'));
    request.onblocked=()=>{rejected=true;reject(failure('blocked','Close the other Open Sesame view before updating storage.'))};
    request.onsuccess=()=>{if(rejected){request.result.close();return}const db=request.result;db.onversionchange=()=>{db.close();database=null};resolve(db)};
   });return database;
  }
  return {
   async read(){const db=await open();return new Promise((resolve,reject)=>{
    const tx=db.transaction('workspace','readonly'),store=tx.objectStore('workspace');let current=null,previous=null,recovery=null;
    store.get('current').onsuccess=e=>current=e.target.result??null;store.get('previous').onsuccess=e=>previous=e.target.result??null;store.get('recovery').onsuccess=e=>recovery=e.target.result??null;
    tx.oncomplete=()=>resolve({current,previous,recovery});tx.onabort=()=>reject(failure('unavailable','Could not read the workspace.'));
   })},
   async commit(expected,next,{preserveRecovery=false,expectedDigest,expectedValues}={}){const db=await open();return new Promise((resolve,reject)=>{
    let tx;try{tx=db.transaction('workspace','readwrite',{durability:'strict'})}catch{reject(failure('unavailable','This browser cannot provide the required atomic workspace transaction.'));return}
    const store=tx.objectStore('workspace');let conflict=false,corrupt=false;
    const request=store.get('current');request.onsuccess=()=>{
     const before=request.result??null;
     if((before?.revision??0)!==expected){conflict=true;tx.abort();return}
     if(expectedValues&&JSON.stringify(before?.values)!==JSON.stringify(expectedValues)){corrupt=true;tx.abort();return}if(expectedDigest&&before?.digest!==expectedDigest){corrupt=true;tx.abort();return}
     if(before)store.put(before,preserveRecovery?'recovery':'previous');store.put(next,'current');
    };
    tx.oncomplete=()=>resolve(structuredClone(next));
    tx.onabort=()=>reject(failure(corrupt?'corrupt':conflict?'conflict':tx.error?.name==='QuotaExceededError'?'quota':'unavailable',corrupt?'Stored workspace content changed without a valid generation. Recover before saving.':conflict?'This workspace changed in another scene. Reconcile before saving.':'Workspace write failed. Your original data is preserved.'));
   })},
   close(){database?.close();database=null}
  };
 }
 globalThis.OpenSesameWorkspaceIndexedDB={create};
})();
