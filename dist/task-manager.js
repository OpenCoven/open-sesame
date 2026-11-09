'use strict';
(()=>{
  const el=id=>document.getElementById(id),host=el('task-manager'),M=OpenSesameTaskManagerModel,S=window.OpenSesameTaskStore;
  let scope=()=>false,visible=false,editing='',page=0;
  const active=()=>scope()&&window.OpenSesameWidgetLifecycle?.isActive('task-manager')===true;
  const make=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n};
  const filters=()=>({query:el('task-manager-search').value,list:el('task-manager-list').value,status:el('task-manager-status-filter').value,priority:el('task-manager-priority-filter').value,sort:el('task-manager-sort').value});
  function error(message=''){el('task-manager-error').textContent=message;el('task-manager-error').hidden=!message}
  function fillLists(lists){
    for(const [id,all] of [['task-manager-list',true],['task-manager-project',false]]){const select=el(id),value=select.value;select.replaceChildren();for(const [key,title] of [...(all?[['all','All lists']]:[]),['','Inbox'],...lists.map(p=>[p.id,p.name])]){const option=make('option',title);option.value=key;select.append(option)}select.value=[...select.options].some(o=>o.value===value)?value:all?'all':''}
  }
  function render(){
    host.hidden=!visible;if(!visible)return;
    const focus=host.contains(document.activeElement)?document.activeElement.dataset.taskFocus:null,{tasks,lists}=S.snapshot();fillLists(lists);
    const options=filters(),selected=M.select(tasks,options),scoped=tasks.filter(t=>options.list==='all'||t.projectId===options.list),today=M.today(),open=scoped.filter(t=>!t.completed),pages=Math.max(1,Math.ceil(selected.length/25));page=Math.min(page,pages-1);
    el('task-manager-open-count').textContent=String(open.length);el('task-manager-due-count').textContent=String(open.filter(t=>t.dueDate&&t.dueDate<=today).length);el('task-manager-completed-count').textContent=String(scoped.length-open.length);
    const list=el('task-manager-items');list.replaceChildren();
    for(const task of selected.slice(page*25,(page+1)*25)){
      const row=make('li');row.className='task-manager-row'+(task.completed?' is-completed':'');row.dataset.taskId=task.id;
      const check=make('input');check.type='checkbox';check.checked=task.completed;check.dataset.taskFocus='check:'+task.id;check.setAttribute('aria-label',(task.completed?'Restore ':'Complete ')+task.title);check.addEventListener('change',()=>{if(!active())return;try{S.update(task.id,{completed:check.checked});error();render()}catch(e){check.checked=task.completed;error(e.message)}});
      const copy=make('div'),title=make('button',task.title),meta=make('div');copy.className='task-manager-copy';title.type='button';title.className='task-manager-title';title.dataset.taskFocus='edit:'+task.id;title.setAttribute('aria-label','Edit '+task.title);title.addEventListener('click',()=>edit(task));meta.className='task-manager-meta';
      const priority=make('span',task.priority[0].toUpperCase()+task.priority.slice(1)+' priority');priority.className='task-priority '+task.priority;meta.append(priority,make('span',lists.find(p=>p.id===task.projectId)?.name||'Inbox'));
      if(task.dueDate){const due=make('time',task.dueDate===today?'Due today':task.dueDate<today&&!task.completed?'Overdue · '+task.dueDate:'Due '+task.dueDate);due.dateTime=task.dueDate;if(task.dueDate<today&&!task.completed)due.className='is-overdue';meta.append(due)}
      copy.append(title,meta);row.append(check,copy);list.append(row);
    }
    el('task-manager-empty').hidden=!!selected.length;el('task-manager-empty').textContent=!tasks.length?'No tasks yet. Add your first task above.':options.status==='completed'&&!scoped.some(t=>t.completed)?'No completed tasks yet.':'No tasks match these filters.';
    el('task-manager-pages').hidden=pages===1;el('task-manager-page').textContent=(page+1)+' / '+pages+' · '+selected.length+' tasks';el('task-manager-prev').disabled=page===0;el('task-manager-next').disabled=page===pages-1;
    if(focus)[...host.querySelectorAll('[data-task-focus]')].find(n=>n.dataset.taskFocus===focus)?.focus({preventScroll:true});
  }
  function reset(){editing='';el('task-manager-form').reset();el('task-manager-project').value=el('task-manager-list').value==='all'?'':el('task-manager-list').value;el('task-manager-submit').textContent='Add task';el('task-manager-cancel').hidden=true;error()}
  function edit(task){if(!active())return;editing=task.id;el('task-manager-title').value=task.title;el('task-manager-priority').value=task.priority;el('task-manager-due').value=task.dueDate;el('task-manager-project').value=task.projectId||'';el('task-manager-submit').textContent='Save task';el('task-manager-cancel').hidden=false;error();el('task-manager-title').focus({preventScroll:true})}
  el('task-manager-form').addEventListener('submit',event=>{event.preventDefault();if(!active())return;try{const input={title:el('task-manager-title').value,priority:el('task-manager-priority').value,dueDate:el('task-manager-due').value,projectId:el('task-manager-project').value};editing?S.update(editing,input):S.create(input);reset();page=0;render();el('task-manager-title').focus({preventScroll:true})}catch(e){error(e.message)}});
  el('task-manager-cancel').addEventListener('click',()=>{reset();el('task-manager-title').focus({preventScroll:true})});
  for(const [id,event] of [['task-manager-search','input'],['task-manager-list','change'],['task-manager-status-filter','change'],['task-manager-priority-filter','change'],['task-manager-sort','change']])el(id).addEventListener(event,()=>{if(id==='task-manager-list'&&!editing)el('task-manager-project').value=el(id).value==='all'?'':el(id).value;page=0;render()});
  el('task-manager-new-list').addEventListener('click',()=>{el('task-manager-list-form').hidden=false;el('task-manager-list-name').focus({preventScroll:true})});
  el('task-manager-list-cancel').addEventListener('click',()=>{el('task-manager-list-form').hidden=true;el('task-manager-new-list').focus({preventScroll:true})});
  el('task-manager-list-form').addEventListener('submit',event=>{event.preventDefault();if(!active())return;try{const id=S.addList(el('task-manager-list-name').value);fillLists(S.snapshot().lists);el('task-manager-list').value=id;el('task-manager-project').value=id;el('task-manager-list-name').value='';el('task-manager-list-form').hidden=true;error();render();el('task-manager-title').focus({preventScroll:true})}catch(e){error(e.message)}});
  el('task-manager-prev').addEventListener('click',()=>{page--;render()});el('task-manager-next').addEventListener('click',()=>{page++;render()});
  host.addEventListener('keydown',event=>{if(event.key!=='Escape')return;if(!el('task-manager-list-form').hidden){event.preventDefault();event.stopPropagation();el('task-manager-list-cancel').click()}else if(editing){event.preventDefault();event.stopPropagation();el('task-manager-cancel').click()}else if(event.target===el('task-manager-search')&&event.target.value){event.preventDefault();event.stopPropagation();event.target.value='';page=0;render()}});
  function sync(){visible=active();render()}
  function pause(){visible=false;host.hidden=true}
  window.OpenSesameTaskManager={mount(predicate){scope=predicate;sync()},pause,handoff(value){if(value){fillLists(S.snapshot().lists);for(const [id,text] of Object.entries(value.values||{}))if(['title','priority','due','project','search','list','status-filter','priority-filter','sort','list-name'].includes(id))el('task-manager-'+id).value=text;editing=typeof value.editing==='string'?value.editing:'';el('task-manager-submit').textContent=editing?'Save task':'Add task';el('task-manager-cancel').hidden=!editing;el('task-manager-list-form').hidden=value.listHidden!==false;page=Number.isInteger(value.page)?Math.max(0,value.page):0;sync();return}return {editing,page,listHidden:el('task-manager-list-form').hidden,values:Object.fromEntries(['title','priority','due','project','search','list','status-filter','priority-filter','sort','list-name'].map(id=>[id,el('task-manager-'+id).value]))}}};
  for(const event of ['open-sesame-layout','open-sesame-view-changed','open-sesame-widgets-changed','open-sesame-items-changed','open-sesame-projects-changed'])window.addEventListener(event,sync);
})();
