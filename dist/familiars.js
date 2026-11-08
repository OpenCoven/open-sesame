'use strict';
(()=>{
  const el=id=>document.getElementById(id),client=window.OpenSesameCovenClient,records=new Map(),jobs=new Map(),drafts=new Map(),harnessChoices=new Map(),messageNodes=new WeakMap();
  let rosterVersion=0,lastRosterKey='',connection=0;
  let avatarBusy=false,avatarTarget='';
  let roster=[],connected=false,connecting=false,selected='',generation=0,loading=false,error='',incoming='',frame=0;
  try{incoming=(localStorage.getItem('open-sesame-familiar-queued-draft-v1')||'').slice(0,20000)}catch{}
  try{const saved=JSON.parse(localStorage.getItem('open-sesame-familiar-drafts-v1')||'{}');for(const [id,text]of Object.entries(saved))if(typeof text==='string'&&text.length<=20000)drafts.set(id,text)}catch{}
  try{for(const [id,value]of Object.entries(JSON.parse(localStorage.getItem('open-sesame-familiar-harnesses-v1')||'{}')))if(['coven-code','codex','claude'].includes(value))harnessChoices.set(id,value)}catch{}
  function make(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n}
  const familiar=()=>roster.find(f=>f.id===selected),current=()=>records.get(selected),draft=()=>drafts.get(selected)||'';
  function saveDraft(){if(selected)drafts.set(selected,el('familiar-message').value);try{localStorage.setItem('open-sesame-familiar-queued-draft-v1',incoming);localStorage.setItem('open-sesame-familiar-drafts-v1',JSON.stringify(Object.fromEntries([...drafts].slice(-1024))))}catch{}}
  function validConversation(value,fid){if(!value||value.familiarId!==fid||typeof value.conversationId!=='string'||!Number.isInteger(value.revision)||!Array.isArray(value.messages)||value.messages.length>120||!['coven-code','codex','claude'].includes(value.harness)||value.messages.some(m=>!m||!['user','assistant'].includes(m.role)||typeof m.text!=='string'))throw Error('Coven returned an invalid conversation. Reconnect to refresh.');return value}
  const avatarButton=make('button','familiar-avatar','');avatarButton.id='familiar-avatar-edit';avatarButton.type='button';avatarButton.setAttribute('aria-label','Set familiar avatar');el('familiar-thread-header').prepend(avatarButton);
  const avatarInput=make('input');avatarInput.type='file';avatarInput.accept='image/png,image/jpeg,image/webp,image/gif,image/avif';avatarInput.hidden=true;avatarInput.setAttribute('aria-label','Choose familiar avatar');el('pane-familiars').append(avatarInput);
  avatarButton.addEventListener('click',()=>{if(avatarBusy||!connected||!selected)return;avatarTarget=selected;avatarInput.value='';avatarInput.click()});
  avatarInput.addEventListener('change',async()=>{
    const file=avatarInput.files?.[0],id=avatarTarget,ticket=connection;if(!file||!id||avatarBusy)return;
    if(file.size>32*1024*1024){toast('Choose an avatar smaller than 32 MB.');return}
    avatarBusy=true;avatarButton.disabled=true;avatarButton.setAttribute('aria-busy','true');toast('Saving avatar…');let url='';
    try{
      const image=new Image();url=URL.createObjectURL(file);await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('Choose a readable image.'));image.src=url});
      if(!image.naturalWidth||!image.naturalHeight)throw Error('Choose a readable image.');
      const canvas=document.createElement('canvas');canvas.width=canvas.height=512;const crop=Math.min(image.naturalWidth,image.naturalHeight);
      canvas.getContext('2d').drawImage(image,(image.naturalWidth-crop)/2,(image.naturalHeight-crop)/2,crop,crop,0,0,512,512);
      if(ticket!==connection||!connected)return;
      const value=await client.setAvatar(id,canvas.toDataURL('image/png'));
      if(ticket!==connection||!connected)return;
      if(value?.familiarId!==id||typeof value.avatarUrl!=='string')throw Error('The avatar could not be verified. Refresh and try again.');
      const record=roster.find(f=>f.id===id);if(record)record.avatarUrl=value.avatarUrl;rosterVersion++;lastRosterKey='';render();toast('Avatar saved to '+value.location+'.');
    }catch(error){if(ticket===connection)toast(error.message||'Could not save the avatar. Try again.')}finally{if(url)URL.revokeObjectURL(url);avatarBusy=false;avatarButton.setAttribute('aria-busy','false');avatarInput.value='';render()}
  });
  function announceConnection(){window.dispatchEvent(new CustomEvent('open-sesame-familiars-changed',{detail:{connected,count:roster.length,error}}))}
  function paintAvatar(mark,f){
    const emoji=f?.emoji&&!/^[a-z][a-z0-9-]*:/i.test(f.emoji)?f.emoji:'';mark.textContent=emoji;if(!emoji)mark.innerHTML=icon('chat');
    if(typeof f?.avatarUrl==='string'&&f.avatarUrl.length<=256*1024&&/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(f.avatarUrl)){
      const image=make('img');image.alt='';image.src=f.avatarUrl;image.addEventListener('error',()=>{mark.textContent=emoji;if(!emoji)mark.innerHTML=icon('chat')},{once:true});mark.replaceChildren(image);
    }
  }
  function paintRoster(){
    const focused=document.activeElement?.dataset.familiar;const query=el('familiar-search').value.trim().toLowerCase(),shown=roster.filter(f=>(f.displayName+' '+f.name+' '+f.description).toLowerCase().includes(query)),list=el('familiar-list'),key=JSON.stringify([rosterVersion,selected,query,connected,[...jobs.keys()]]);
    if(key===lastRosterKey)return;lastRosterKey=key;const oldScroll=list.scrollTop;list.replaceChildren();for(const f of shown){const b=make('button','familiar-row');b.type='button';b.id='familiar-tab-'+f.id;b.dataset.familiar=f.id;b.setAttribute('role','tab');b.setAttribute('aria-controls','familiar-thread');b.setAttribute('aria-selected',String(selected===f.id));b.tabIndex=selected===f.id||!shown.some(row=>row.id===selected)&&shown[0]===f?0:-1;b.title=f.description||f.displayName;
      const emoji=f.emoji&&!/^[a-z][a-z0-9-]*:/i.test(f.emoji)?f.emoji:'',mark=make('span','familiar-avatar',emoji),copy=make('span','familiar-row-copy');paintAvatar(mark,f);mark.setAttribute('aria-hidden','true');b.dataset.busy=String(jobs.has(f.id));b.title=[f.displayName,f.description,jobs.has(f.id)?'Replying…':f.name].filter(Boolean).join(' · ');copy.append(make('strong','',f.displayName),make('small','',jobs.has(f.id)?'Replying…':f.name));b.append(mark,copy);b.addEventListener('click',()=>choose(f.id));
      b.addEventListener('keydown',event=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;event.preventDefault();const i=shown.indexOf(f),next=shown[event.key==='Home'?0:event.key==='End'?shown.length-1:(i+(event.key==='ArrowDown'?1:-1)+shown.length)%shown.length];choose(next.id,false);el('familiar-tab-'+next.id)?.focus({preventScroll:true})});list.append(b)}
    list.scrollTop=oldScroll;if(focused)el('familiar-tab-'+focused)?.focus({preventScroll:true});
    el('familiar-roster-count').textContent=shown.length===roster.length?String(roster.length):shown.length+' / '+roster.length;
    el('familiar-roster-empty').hidden=shown.length>0;el('familiar-roster-empty').textContent=!connected?'Connect Coven to see your familiars.':roster.length?'No familiar matches this search.':'No familiars are configured in Coven yet. Create one with the setup guide.';
  }
  function messageNode(message){
    let cached=messageNodes.get(message);
    if(!cached){const row=make('article','familiar-message '+message.role),head=make('header'),copy=make('button','','Copy'),body=make('div','familiar-message-body');copy.type='button';copy.setAttribute('aria-label','Copy '+(message.role==='user'?'your message':'reply'));copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(message.text);toast('Copied.')}catch{toast('Copy is unavailable here.')}});head.append(make('small','',message.role==='user'?'You':familiar()?.displayName||'Familiar'),copy);row.append(head,body);cached={row,body,text:null};messageNodes.set(message,cached)}
    if(cached.text!==message.text){cached.text=message.text;if(message.role==='assistant')cached.body.replaceChildren(OpenSesameContent.clean(OpenSesameGFM.parse(message.text),location.href));else cached.body.textContent=message.text}
    return cached.row;
  }
  function paintMessages(){
    const record=current(),log=el('familiar-messages'),follow=log.scrollHeight-log.scrollTop-log.clientHeight<70,scroll=log.scrollTop,query=el('familiar-history-search').value.trim().toLowerCase();
    const rows=(record?.messages||[]).filter(message=>message.text&&(!query||message.text.toLowerCase().includes(query))).map(messageNode),existing=Array.from(log.children);
    if(rows.length!==existing.length||rows.some((row,i)=>row!==existing[i]))log.replaceChildren(...rows);
    const empty=el('familiar-chat-empty');empty.hidden=!record?.conversationId||rows.length>0||jobs.has(selected);
    empty.querySelector('strong').textContent=query?'No matching messages':'Ready for '+(familiar()?.displayName||'your familiar');
    empty.querySelector('p').textContent=query?'Try another phrase, or press Escape in search to return to the conversation.':'Send a message below to begin. This conversation stays with this familiar.';
    log.hidden=!record?.conversationId||!rows.length;
    log.setAttribute('aria-busy',String(jobs.has(selected)));log.scrollTop=follow?log.scrollHeight:scroll;
  }
  function paint(){
    frame=0;const f=familiar(),record=current(),job=jobs.get(selected),available=!!openSesameBridge.available;
    el('familiar-connect').disabled=connecting||!available;el('familiar-connect').innerHTML=connecting?'Connecting…':connected?icon('reset'):'Connect Coven';el('familiar-connect').setAttribute('aria-label',connected?'Refresh familiars':'Connect Coven');el('familiar-connect').title=connected?'Refresh familiars':'Connect Coven';
    el('familiar-connection-status').textContent=connecting?'Checking Coven and your familiars…':error||(!available?'Open the Mac app or local dev preview to connect.':connected?'Connected to Coven · '+roster.length+' familiar'+(roster.length===1?'':'s'):'Connect Coven to find your familiars.');
    el('familiar-setup-guide').hidden=connected&&roster.length>0&&!error;el('familiar-welcome').hidden=!!record?.conversationId;el('familiar-welcome').querySelector('strong').textContent=loading?'Opening conversation…':f?'Let’s reconnect this conversation':connected?'Choose your familiar':'A familiar place to begin';
    el('familiar-welcome-copy').textContent=incoming?'Your message is ready. Choose a familiar to review and send it.':f?'Try opening this conversation again. Your saved messages and draft are kept.':connected?'Select a familiar on the left. Each brings its own identity, workspace and conversation.':'Connect Coven to bring your familiars here, then choose one and send your first message.';
    el('familiar-welcome-action').hidden=loading||connected&&!f&&!roster.length;el('familiar-welcome-action').disabled=connecting||!available;
    el('familiar-welcome-action').textContent=f&&connected?'Try again':connected?'Choose a familiar':'Connect Coven';
    el('familiar-thread-header').hidden=!f;el('familiar-compose').hidden=!f||!record?.conversationId;el('familiar-harness-row').hidden=!f||!record?.conversationId;
    avatarButton.hidden=!f;avatarButton.disabled=avatarBusy||!connected||connecting;if(f){paintAvatar(avatarButton,f);avatarButton.title='Change avatar · avatars/'+f.id+'.png';avatarButton.setAttribute('aria-label','Set avatar for '+f.displayName)}
    if(f){el('familiar-name').textContent=f.displayName;el('familiar-workspace').title=f.workspace||'';el('familiar-thread').setAttribute('aria-label','Conversation with '+f.displayName);el('familiar-message').placeholder='Message '+f.displayName+'…';el('familiar-message').setAttribute('aria-label','Message '+f.displayName)}else el('familiar-thread').removeAttribute('aria-labelledby');
    el('familiar-new').disabled=!!job||loading||!record?.conversationId;el('familiar-harness').disabled=!!job||loading||!!record?.sessionId;if(record?.harness)el('familiar-harness').value=record.sessionId?record.harness:harnessChoices.get(selected)||record.harness;
    el('familiar-search-open').disabled=loading||!record?.conversationId;
    el('familiar-message').disabled=!!job||loading||!connected;
    el('familiar-send').hidden=!!job;el('familiar-send').disabled=!connected||loading||!record?.conversationId||record?.status==='responding'&&!job||!draft().trim()||new TextEncoder().encode(draft()).length>32768;
    el('familiar-dictate').disabled=!!job||loading||!record?.conversationId;el('familiar-stop').hidden=!job;el('familiar-stop').disabled=!!job?.stopping;el('familiar-stop').textContent=job?.stopping?'Stopping…':'Stop';
    el('familiar-chat-status').textContent=new TextEncoder().encode(draft()).length>32768?'Shorten this message before sending.':loading?'Opening conversation…':job?.status|| (record?.status==='responding'?'A reply is running or was interrupted. Refresh, or start a new chat.':record?.status==='stopped'?'Reply stopped. You can send another message.':record?.sessionId?'Conversation saved on this Mac.':'Send when you’re ready.');
    const issue=record?.status==='stopped'?'':record?.error||'';el('familiar-chat-error').hidden=!issue;el('familiar-chat-error').textContent=issue;
    el('familiar-history-notice').hidden=!record?.historyTruncated&&!(record?.sessionId&&record?.harness==='coven-code');el('familiar-history-notice').textContent=record?.historyTruncated?'Showing recent saved messages. Start a new chat when you need a fresh context.':'Coven Code uses recent conversation text for context.';
    paintRoster();paintMessages();
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(paint)}
  async function choose(fid,focus=true){
    if(!roster.some(f=>f.id===fid))return;saveDraft();selected=fid;el('familiar-message').value=draft();el('familiar-history-search').value='';el('familiar-history-search').hidden=true;
    try{localStorage.setItem('open-sesame-selected-familiar-v1',fid)}catch{}
    const ticket=++generation;loading=true;paint();
    try{if(!jobs.has(fid)){const record=validConversation(await client.openConversation(fid),fid);if(ticket!==generation)return;records.set(fid,record)}if(ticket!==generation)return;if(incoming&&!draft()){drafts.set(fid,incoming);incoming='';el('familiar-message').value=draft();saveDraft()}}
    catch(e){if(ticket===generation){records.set(fid,{familiarId:fid,messages:[],error:e.message});toast(e.message)}}
    finally{if(ticket===generation){loading=false;paint();if(focus&&current()?.conversationId)el('familiar-message').focus({preventScroll:true})}}
  }
  async function connect(){
    if(connecting||!openSesameBridge.available)return;const ticket=++connection;connecting=true;error='';paint();
    try{const status=await client.status();if(ticket!==connection)return;if(!status.available)throw Error(status.error||'Coven is not ready. Use the setup guide, then reconnect.');const found=await client.listFamiliars();if(ticket!==connection)return;roster=found;rosterVersion++;connected=true;try{localStorage.setItem('open-sesame-coven-connected-v1','true')}catch{}let previous=selected;try{previous=previous||localStorage.getItem('open-sesame-selected-familiar-v1')}catch{}if(previous&&roster.some(f=>f.id===previous))await choose(previous,false);else{selected='';el('familiar-message').value='';generation++}}
    catch(e){if(ticket===connection){connected=false;error=e.message||'Could not connect to Coven.'}}
    finally{if(ticket===connection){connecting=false;paint();announceConnection()}}
  }
  async function send(event){
    event?.preventDefault();const f=familiar(),record=current(),prompt=draft().trim();if(!f||!record?.conversationId||!prompt||jobs.has(f.id)||record.status==='responding'||!connected||loading)return;
    if(new TextEncoder().encode(prompt).length>32768){toast('Keep messages under 32768 UTF-8 bytes.');return}
    const runId=newId(),answer={role:'assistant',text:''},input={runId,prompt,familiarId:f.id,conversationId:record.conversationId,revision:record.revision,sessionId:record.sessionId,harness:el('familiar-harness').value};
    record.messages.push({role:'user',text:prompt},answer);record.error='';const job={runId,status:'Connecting to '+f.displayName+'…',stopping:false};jobs.set(f.id,job);drafts.set(f.id,'');el('familiar-message').value='';saveDraft();paint();
    try{await client.sendMessage(input,payload=>{if(jobs.get(f.id)!==job)return;if(payload.type==='assistant'){answer.text=(payload.message?.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');job.status=f.displayName+' is replying…'}else if(payload.type==='notice')job.status=payload.message;else if(payload.type==='system')job.status=f.displayName+' is thinking…';schedule()})}
    catch(e){record.error=e.message||'The reply could not finish. Captured text is preserved.';job.error=record.error}
    finally{try{const refreshed=validConversation(await client.openConversation(f.id),f.id);if(job.error&&!refreshed.error)refreshed.error=job.error;if(job.error&&refreshed.revision===input.revision&&!drafts.get(f.id)){drafts.set(f.id,prompt);if(selected===f.id){el('familiar-message').value=prompt;saveDraft()}}records.set(f.id,refreshed)}catch(e){record.error=job.error||e.message}jobs.delete(f.id);paint();if(selected===f.id)el('familiar-message').focus({preventScroll:true})}
  }
  el('familiar-connect').addEventListener('click',connect);el('familiar-search').addEventListener('input',paintRoster);el('familiar-compose').addEventListener('submit',send);el('familiar-message').addEventListener('input',()=>{saveDraft();schedule()});
  el('familiar-welcome-action').addEventListener('click',()=>{if(!connected)connect();else if(selected)choose(selected);else el('familiar-list').querySelector('button')?.focus({preventScroll:true})});
  el('familiar-message').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();send()}});
  el('familiar-stop').addEventListener('click',async()=>{const job=jobs.get(selected);if(!job||job.stopping)return;job.stopping=true;job.status='Stopping…';paint();try{await client.cancel(job.runId)}catch(e){job.stopping=false;job.status=e.message;paint()}});
  el('familiar-new').addEventListener('click',async()=>{const fid=selected,record=current();if(!record?.conversationId||jobs.has(fid)||loading)return;const ticket=++generation;loading=true;paint();try{const result=validConversation(await client.newConversation(fid,record.conversationId),fid);records.set(fid,result);if(ticket===generation){el('familiar-history-search').value='';el('familiar-history-search').hidden=true}}catch(e){record.error=e.message}finally{if(ticket===generation){loading=false;paint();if(current()?.conversationId)el('familiar-message').focus({preventScroll:true})}}});
  el('familiar-harness').addEventListener('change',()=>{if(!selected||current()?.sessionId||jobs.has(selected))return;harnessChoices.set(selected,el('familiar-harness').value);try{localStorage.setItem('open-sesame-familiar-harnesses-v1',JSON.stringify(Object.fromEntries(harnessChoices)))}catch{}});
  el('familiar-dictate').addEventListener('click',()=>window.OpenSesameVoice?.start({target:el('familiar-message'),button:el('familiar-dictate')}));
  function search(query=''){if(state.scenario!=='familiars'||!selected)return false;el('familiar-history-search').hidden=false;el('familiar-history-search').value=query;el('familiar-history-search').focus({preventScroll:true});paintMessages();return true}
  el('familiar-search-open').addEventListener('click',()=>search());el('familiar-history-search').addEventListener('input',paintMessages);el('familiar-history-search').addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();event.target.value='';event.target.hidden=true;paintMessages();el('familiar-search-open').focus()}});
  document.addEventListener('keydown',event=>{if(state.scenario==='familiars'&&(event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='f'){event.preventDefault();search()}});
  window.addEventListener('open-sesame-view-changed',()=>{if(state.scenario==='familiars')paint()});window.addEventListener('open-sesame-desktop-disconnected',()=>{connection++;generation++;connected=false;connecting=false;loading=false;error='Desktop connection closed. Reconnect before sending.';for(const record of records.values())record.error=error;paint();announceConnection()});window.addEventListener('open-sesame-desktop-ready',paint);openSesameBridge.ready.then(()=>{let remembered=false;try{remembered=localStorage.getItem('open-sesame-coven-connected-v1')==='true'}catch{}if(remembered)connect();else paint()});
  window.OpenSesameFamiliars={connect,search,summary:()=>familiar()?.displayName||'Familiars',snapshot:()=>({connected,count:roster.length,error}),prepareDraft(text=''){if(text){if(selected&&draft().trim()){toast('Your existing familiar draft is kept. Save or clear it before preparing another message.');return false}incoming=text.slice(0,20000);if(selected&&current()?.conversationId){drafts.set(selected,incoming);incoming='';el('familiar-message').value=draft();saveDraft()}try{localStorage.setItem('open-sesame-familiar-queued-draft-v1',incoming)}catch{}}paint();return true}};
  paint();
})();
