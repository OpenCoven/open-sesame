'use strict';
// Share Projects' existing item IDs, workflow, limits and storage; no parallel task database.
(()=>{
  const M=OpenSesameTaskManagerModel;
  function active(){if(window.OpenSesameWidgetLifecycle?.isActive('task-manager')!==true)throw Error('Activate Task Manager in Widgets first.')}
  function commit(next){const before=items;items=next;if(!saveItems()){items=before;throw Error('Could not save. Your task draft is kept; try again.')}renderItems()}
  function create(input){
    active();const values=M.fields(input,projects);
    if(activeItems().length>=30)throw Error('You have 30 active items. Complete or archive an item to make room.');
    if(items.length>=300)throw Error('Your archive is full. Remove an archived item in Projects to make room.');
    const now=Date.now(),item={id:newId(),kind:'task',url:'',body:'',done:false,stage:'inbox',createdAt:now,updatedAt:now,...values};commit([...items,item]);return item.id;
  }
  function update(id,input){
    active();const item=items.find(item=>item.id===id&&itemKind(item)==='task');if(!item)throw Error('This task changed or was removed. Reopen it from the list.');
    const next={...item};
    if(Object.hasOwn(input,'completed')){
      if(typeof input.completed!=='boolean')throw Error('Choose a valid task state.');
      if(!input.completed&&OpenSesameItemWorkflow.isArchived(item)&&activeItems().length>=30)throw Error('Complete or archive an item before restoring this task.');
      Object.assign(next,OpenSesameItemWorkflow.patch(item,input.completed?'done':'restore'));
    }else Object.assign(next,M.fields(input,projects),{updatedAt:Date.now()});
    commit(items.map(item=>item.id===id?next:item));
  }
  function addList(value){
    active();const name=typeof value==='string'?value.trim():'';if(!name||name.length>40)throw Error('Enter a list name of 1–40 characters.');
    const existing=projects.find(p=>p.name.toLowerCase()===name.toLowerCase());if(existing)return existing.id;
    if(projects.length>=30)throw Error('You have 30 lists/projects. Use an existing list.');
    const project={id:newId(),name},next=[...projects,project];
    try{localStorage.setItem('open-sesame-projects-v1',JSON.stringify(next))}catch{throw Error('Could not save the list. Your draft is kept; try again.')}
    projects=next;renderProjectSelectors();window.dispatchEvent(new Event('open-sesame-projects-changed'));return project.id;
  }
  window.OpenSesameTaskStore={snapshot:()=>({tasks:items.filter(n=>itemKind(n)==='task').map(M.task),lists:projects.map(p=>({id:p.id,name:p.name}))}),create,update,addList};
})();
