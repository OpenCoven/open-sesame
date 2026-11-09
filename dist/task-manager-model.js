'use strict';
(()=>{
  const priorities=['high','normal','low'],rank={high:0,normal:1,low:2};
  function validDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&value.slice(0,4)!=='0000'&&new Date(value+'T00:00:00Z').toISOString?.()===value+'T00:00:00.000Z'}
  function date(value){try{return validDate(value)?value:''}catch{return ''}}
  function fields(input,lists){
    const title=typeof input.title==='string'?input.title.trim():'';
    if(!title||title.length>200)throw Error('Enter a task title of 1–200 characters.');
    if(!priorities.includes(input.priority))throw Error('Choose a task priority.');
    if(input.dueDate!==''&&!date(input.dueDate))throw Error('Choose a valid due date.');
    if(input.projectId!==''&&!lists.some(list=>list.id===input.projectId))throw Error('Choose an existing list or Inbox.');
    return {title,text:title,priority:input.priority,dueDate:input.dueDate,projectId:input.projectId};
  }
  const task=item=>({...item,title:item.title||item.text||'Untitled task',priority:priorities.includes(item.priority)?item.priority:'normal',dueDate:date(item.dueDate),completed:OpenSesameItemWorkflow.isArchived(item)});
  function select(tasks,{query='',list='all',status='open',priority='all',sort='due'}={}){
    const q=query.trim().toLowerCase();return tasks.filter(t=>(list==='all'||(list==='inbox'?!t.projectId:t.projectId===list))&&(status==='all'||t.completed===(status==='completed'))&&(priority==='all'||t.priority===priority)&&(!q||t.title.toLowerCase().includes(q))).sort((a,b)=>{
      const byDue=(a.dueDate||'9999-99-99').localeCompare(b.dueDate||'9999-99-99'),byPriority=rank[a.priority]-rank[b.priority];
      return (sort==='priority'?byPriority||byDue:sort==='title'?a.title.localeCompare(b.title):sort==='newest'?(b.createdAt||b.updatedAt||0)-(a.createdAt||a.updatedAt||0):byDue||byPriority)||a.title.localeCompare(b.title)||String(a.id).localeCompare(String(b.id));
    });
  }
  function today(now=new Date()){return now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0')}
  window.OpenSesameTaskManagerModel={priorities,date,fields,task,select,today};
})();
