'use strict';
// Recover unsent local text through the existing editors; never restore an execution/session authority.
(()=>{
 const store=window.OpenSesameWorkspaceData;if(!store)return;
 const el=id=>document.getElementById(id),editKey='open-sesame-edit-drafts-v1',taskKey='open-sesame-task-draft-v1',toolKey='open-sesame-tool-drafts-v1';let restoring=false;
 function textDrafts(){const n=currentItem();return {capture:{value:el('capture-input').value,type:el('capture-type').value,projectId:el('capture-project').value},note:n?{id:n.id,title:el('detail-title').value,body:detailEditor.get()}:null,task:window.OpenSesameTaskManager?.handoff(),tools:window.OpenSesameTools?.handoff()||[]}}
 async function checkpoint(event){if(restoring||store.status!=='ready')return;const id=event.target?.id||'';try{
  if(['detail-title','detail-body'].includes(id)||event.target?.closest?.('#md-source-panel')){const n=currentItem();if(n)await store.setItem(editKey,JSON.stringify({id:n.id,title:el('detail-title').value,body:detailEditor.get()}))}
  if(id.startsWith('task-manager-'))await store.setItem(taskKey,JSON.stringify(window.OpenSesameTaskManager.handoff()));
  if(event.target?.closest?.('.tools-dialog,.page-widget-view'))await store.setItem(toolKey,JSON.stringify({entries:window.OpenSesameTools.handoff()}));
 }catch{toast('Draft recovery could not be saved. Keep this window open or export open drafts before reloading.')}}
 document.addEventListener('input',checkpoint);document.addEventListener('change',checkpoint);
 window.OpenSesameWorkspaceBoot.onReady(()=>{restoring=true;try{
  const edit=JSON.parse(store.getItem(editKey)||'null');if(edit&&typeof edit.id==='string'&&typeof edit.body==='string'&&typeof edit.title==='string'&&items.some(n=>n.id===edit.id)){const n=items.find(n=>n.id===edit.id);if((n.body||'')!==edit.body||(n.title||n.text)!==edit.title){selectedItemId=edit.id;window.OpenSesameNotes.recover(edit)}}
  const task=JSON.parse(store.getItem(taskKey)||'null');if(task)window.OpenSesameTaskManager.handoff(task);
  const tools=JSON.parse(store.getItem(toolKey)||'null');if(tools?.entries)window.OpenSesameTools.handoff(tools.entries);
 }catch{toast('Saved drafts need recovery. Their original data is preserved.')}finally{restoring=false}});
 async function checkpointForSignOut(){
  await store.flush();
  const {note,task,tools}=textDrafts(),changes=window.OpenSesameCaptureDraft.checkpoint();
  if(note)changes[editKey]=JSON.stringify(note);
  if(task)changes[taskKey]=JSON.stringify(task);
  changes[toolKey]=JSON.stringify({entries:tools});
  await store.patch(changes);
 }
 window.OpenSesameWorkspaceDrafts={snapshot:textDrafts,checkpointForSignOut};
})();
