'use strict';
// Dedicated iOS storage transport. Renderer flags select presentation, never authorization.
(()=>{
 const documentID=window.__OPEN_SESAME_DOCUMENT__;
 const call=async(method,params={})=>{let reply;try{reply=await window.webkit.messageHandlers.workspace.postMessage({documentID,method,params})}catch{throw Object.assign(Error('Native storage did not acknowledge. Preserve drafts and reconcile.'),{code:'uncertain'})}if(reply?.ok!==true)throw Object.assign(Error(reply?.error?.message||'Native workspace is unavailable.'),reply?.error||{code:'uncertain'});return reply.result};
 window.OpenSesameWorkspaceNative={create(){return {read:()=>call('workspace.read'),commit:(expectedRevision,next,options={})=>call('workspace.commit',{expectedRevision,next,options})}}};
})();
