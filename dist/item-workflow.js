'use strict';
(()=>{
  const stages=[['inbox','Inbox'],['active','Started'],['review','Review']],known=value=>stages.some(([id])=>id===value);
  const isArchived=n=>n?.stage==='done'||(n?.kind==='task'&&n.done===true),stage=n=>isArchived(n)?'done':known(n?.stage)?n.stage:'inbox',label=n=>isArchived(n)?'Archived':stages.find(([id])=>id===stage(n))[1];
  function patch(n,value,now=Date.now()){
    if(value==='restore')value=known(n.previousStage)?n.previousStage:'inbox';
    if(value!=='done'&&!known(value))return null;
    return {stage:value,done:value==='done'&&n.kind==='task',previousStage:value==='done'?(known(n.stage)?n.stage:known(n.previousStage)?n.previousStage:'inbox'):value,updatedAt:now};
  }
  function excerpt(body){
    const text=String(body||'').replace(/```[^\n]*\n?|~~~[^\n]*\n?/g,' ')
      .replace(/!\[([^\]]*)\]\([^\n]*?\)/g,'$1').replace(/\[([^\]]+)\]\([^\n]*?\)/g,'$1')
      .replace(/<\/?[a-z][^>]*>/gi,'').replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)/gm,'')
      .replace(/\*\*|__|~~|`/g,'').replace(/\s+/g,' ').trim();
    return text.length>180?text.slice(0,177).trimEnd()+'…':text;
  }
  window.OpenSesameItemWorkflow={stages,isArchived,stage,label,patch,excerpt};
})();
