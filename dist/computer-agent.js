'use strict';
// Task text/progress only. Native approval, screenshots, keys and input stay in the host.
(()=>{
  const el=id=>document.getElementById(id),form=el('computer-task-form'),input=el('computer-task'),provider=el('computer-provider'),log=el('computer-messages'),status=el('computer-task-status'),start=el('computer-start'),stop=el('computer-stop');
  let connection=null,checking=false,pending=false,runId=null,generation=0,buffer=[],history=[],reply=null,label='Ready',statusTicket=0;
  function bounded(text,bytes){let count=0,out='';for(const character of text){const size=new TextEncoder().encode(character).length;if(count+size>bytes)break;out+=character;count+=size}return out}
  function active(){return state.expanded&&state.scenario==='computer-agent'&&!window.OpenSesamePageWidgets?.active}
  function update(){
    const busy=pending||!!runId;start.disabled=busy||!input.value.trim()||!connection?.configured||!connection?.permissions?.supported||!connection?.permissions?.screen||!connection?.permissions?.accessibility;stop.hidden=!busy;provider.disabled=busy;el('computer-account').disabled=busy;el('computer-remove-account').disabled=busy;el('computer-refresh').disabled=checking||busy;
    for(const kind of ['screen','accessibility']){const button=el('computer-permission-'+kind),allowed=connection?.permissions?.[kind]===true;button.textContent=(kind==='screen'?'Screen Recording':'Accessibility')+(allowed?' · Enabled':' · Enable');button.disabled=busy||allowed;button.setAttribute('aria-pressed',String(allowed))}
    const ready=connection?.configured,permissions=connection?.permissions;el('computer-connection').textContent=checking?'Checking account…':!connection?'Open the installed Mac app to connect.':!permissions?.supported?'Computer use requires macOS 14 or later.':ready?(connection.provider+' · '+connection.model):'Choose a connected Coven account or connect an Anthropic API account.';
    el('computer-setup').hidden=!!(ready&&permissions?.screen&&permissions?.accessibility);el('computer-remove-account').hidden=!connection?.savedAccount;
    status.textContent=label;input.disabled=busy;form.setAttribute('aria-busy',String(busy));window.dispatchEvent(new Event('open-sesame-computer-status'));
  }
  function message(role,text){const row=document.createElement('article');row.className='computer-message computer-message-'+role;const name=document.createElement('small');name.textContent=role==='user'?'You':role==='assistant'?'Coven':'Activity';const body=document.createElement('div');body.className='computer-message-body';body.textContent=text;row.append(name,body);log.append(row);el('computer-empty').hidden=true;while(log.children.length>80)log.firstElementChild.remove();return body}
  function renderReply(){if(!reply)return;const renderer=window.OpenSesameContent?.answerMarkdown;if(renderer)reply.node.replaceChildren(renderer(reply.text,location.href));else reply.node.textContent=reply.text;}
  async function refresh(){if(checking||pending||runId)return;checking=true;const ticket=++statusTicket,chosen=provider.value;update();try{await openSesameBridge.ready;const result=await openSesameBridge.request('computer.status',{provider:chosen});if(ticket!==statusTicket||chosen!==provider.value)return;connection=result;label=connection.configured?'Ready':'Connect an account'}catch(error){if(ticket===statusTicket){connection=null;label=error.message}}finally{if(ticket===statusTicket){checking=false;update()}}}
  function complete(kind,text){if(reply?.text){renderReply();history.push({role:'assistant',text:bounded(reply.text,16000)})}reply=null;runId=null;pending=false;label=text||({result:'Task finished',paused:'Paused · Review the screen',error:'Task interrupted'})[kind];update()}
  function receiveEvent(value){
    if(!value||!['computer.progress','computer.question'].includes(value.event))return;
    if(pending&&!runId){if(buffer.length<120)buffer.push(value);return}
    if(!runId||value.runId!==runId)return;
    if(value.event==='computer.question'){message('assistant',String(value.text||'Please review the screen.').slice(0,4000));label='Your input is needed';update();return}
    const text=typeof value.text==='string'?value.text:'';
    if(value.type==='delta'){if(!reply)reply={text:'',node:message('assistant','')};reply.text=(reply.text+text).slice(0,131072);reply.node.textContent=reply.text;return}
    if(value.type==='action'){if(reply){renderReply();history.push({role:'assistant',text:bounded(reply.text,16000)});reply=null}label='Step '+(value.step||'')+' · '+String(value.action||'Observing').replaceAll('_',' ');message('activity',label)}
    else if(value.type==='status')label=text||'Thinking';
    else if(['result','paused','error'].includes(value.type)){complete(value.type,text);return}
    update();
  }
  async function submit(event){event?.preventDefault();if(start.disabled)return;const prompt=input.value.trim();if(new TextEncoder().encode(prompt).length>32768){label='Use a task under 32 KB.';update();return}const ticket=++generation;pending=true;buffer=[];label='Review the native confirmation';update();try{
    const result=await openSesameBridge.request('computer.start',{prompt,history:history.slice(-20),provider:provider.value});if(ticket!==generation)return;
    if(result?.cancelled){pending=false;label='Task kept · Start when ready';update();return}
    if(!result?.runId)throw new Error('The task could not start. Your request is kept.');runId=result.runId;pending=false;message('user',prompt);history.push({role:'user',text:bounded(prompt,16000)});input.value='';label='Working · Use the mouse or keyboard to pause';const events=buffer;buffer=[];events.forEach(receiveEvent);update();
  }catch(error){if(ticket===generation){pending=false;runId=null;label=error.message;update()}}}
  async function cancel(){++generation;pending=false;runId=null;buffer=[];reply=null;label='Stopped · Completed actions remain';update();try{await openSesameBridge.request('computer.cancel')}catch(error){label=error.message;update()}}
  form.addEventListener('submit',submit);input.addEventListener('input',update);input.addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)){event.preventDefault();submit()}});stop.addEventListener('click',cancel);provider.addEventListener('change',()=>{++statusTicket;checking=false;connection=null;refresh()});el('computer-refresh').addEventListener('click',refresh);
  for(const kind of ['screen','accessibility'])el('computer-permission-'+kind).addEventListener('click',async()=>{try{await openSesameBridge.request('computer.permission.request',{kind});await refresh()}catch(error){label=error.message;update()}});
  for(const [id,action] of [['computer-account','connect'],['computer-remove-account','disconnect']])el(id).addEventListener('click',async()=>{try{const result=await openSesameBridge.request('computer.account',{action});if(result?.saved)await refresh()}catch(error){label=error.message;update()}});
  window.addEventListener('open-sesame-desktop-event',e=>receiveEvent(e.detail));window.addEventListener('open-sesame-view-changed',()=>{if(active()&&!connection)refresh()});window.addEventListener('focus',()=>{if(active())refresh()});window.addEventListener('open-sesame-desktop-disconnected',()=>{++generation;buffer=[];complete('error','Desktop connection closed');connection=null;update()});
  window.OpenSesameComputerAgent=Object.freeze({review(text=''){changeScenario('computer-agent');if(text)input.value=String(text).slice(0,32768);update();refresh();input.focus({preventScroll:true});return true},summary(){return runId?'Computer · Working':pending?'Computer · Review':label},snapshot(){return {pending,running:!!runId,status:label,configured:connection?.configured===true}}});update();
})();
