'use strict';
(()=>{
  const el=id=>document.getElementById(id),model=window.OpenSesameSpeakerModel;
  let ready=false,id='',ticket=0,through=0,segments=[],words=[],finished=[],prefix='',names={},plain=false,renderedIDs='',ending=false,lastExport='',speakerOrder=[],complete=false;
  const controls=document.createElement('div');controls.className='speaker-controls';
  const label=document.createElement('label'),enabled=document.createElement('input');enabled.type='checkbox';enabled.id='speaker-enabled';label.append(enabled,document.createTextNode('Speakers'));
  label.title='Local NeMo model · up to four anonymous speakers. Temporary local audio is deleted after labeling.';
  const setup=document.createElement('button');setup.type='button';setup.id='speaker-setup';setup.textContent='Set up speakers';
  const status=document.createElement('span');status.id='speaker-status';status.setAttribute('role','status');
  controls.append(label,setup);el('live-capture').querySelector('.live-capture-summary').append(controls);el('live-transcript-view').querySelector('.transcript-heading').append(status);
  const toolbar=document.createElement('div');toolbar.className='speaker-transcript-tools';toolbar.hidden=true;
  const mode=document.createElement('button');mode.type='button';mode.textContent='Plain text';mode.setAttribute('aria-pressed','false');
  mode.addEventListener('click',()=>{plain=!plain;mode.setAttribute('aria-pressed',String(plain));mode.textContent=plain?'By speaker':'Plain text';paint()});
  const rename=document.createElement('details'),summary=document.createElement('summary'),nameFields=document.createElement('div');summary.textContent='Speaker names';rename.append(summary,nameFields);toolbar.append(mode,rename);
  const view=document.createElement('div');view.id='speaker-transcript';view.hidden=true;view.setAttribute('aria-label','Speaker-attributed transcript');
  const pane=el('live-transcript-view');pane.prepend(toolbar,view);
  const baseName=s=>'Speaker '+(speakerOrder.indexOf(s)+1),display=s=>names[s]||baseName(s),stamp=s=>time(Math.floor(s));
  function exportText(){const rows=model.turns(words,segments,through,!complete);return enabled.checked&&rows.length?[prefix,...rows.map(t=>'['+stamp(t.start)+'] '+(t.speakers.length?t.speakers.map(display).join(' + '):t.pending?'Identifying speaker':'Unknown speaker')+': '+t.text)].filter(Boolean).join('\n\n'):audioSession.final}
  function paint(){
    const exported=exportText();if(exported!==lastExport){lastExport=exported;if(audioSession.textUrl)URL.revokeObjectURL(audioSession.textUrl);audioSession.textUrl=exported.trim()?URL.createObjectURL(new Blob([exported],{type:'text/plain;charset=utf-8'})):'';if(audioSession.textUrl)el('transcript-download').href=audioSession.textUrl}
    const busy=audioSession.active||audioSession.starting||audioSession.stopping;
    enabled.disabled=busy||!ready&&!enabled.checked||el('audio-record').checked;setup.hidden=ready;setup.disabled=busy;controls.hidden=el('audio-record').checked;
    const rows=model.turns(words,segments,through,!complete),show=enabled.checked&&rows.length>0;
    toolbar.hidden=!show;view.hidden=!show||plain;
    pane.classList.toggle('speaker-attributed',show&&!plain);status.hidden=!enabled.checked;
    if(!show||plain)return;
    const follow=view.scrollHeight-view.scrollTop-view.clientHeight<60;
    view.replaceChildren();if(prefix){const previous=document.createElement('p');previous.className='speaker-previous';previous.textContent=prefix;view.append(previous)}
    for(const row of rows){const item=document.createElement('article'),head=document.createElement('header'),who=document.createElement('strong'),when=document.createElement('time'),text=document.createElement('p');
      item.className='speaker-turn';item.dataset.speaker=row.speakers[0]??'unknown';who.textContent=row.speakers.length?row.speakers.map(display).join(' + '):row.pending?'Identifying speaker…':'Unknown speaker';when.textContent=stamp(row.start);text.textContent=row.text;head.append(who,when);item.append(head,text);view.append(item)}
    const ids=[...speakerOrder],signature=ids.join(',');if(signature!==renderedIDs){renderedIDs=signature;nameFields.replaceChildren();for(const speaker of ids){const row=document.createElement('label'),input=document.createElement('input');row.textContent=baseName(speaker);input.value=names[speaker]||'';input.placeholder='Name (optional)';input.maxLength=40;input.setAttribute('aria-label','Name for '+baseName(speaker).toLowerCase());input.addEventListener('input',()=>{names[speaker]=input.value.trim();paint()});row.append(input);nameFields.append(row)}}
    if(follow)view.scrollTop=view.scrollHeight;
  }
  async function refresh(){
    if(!window.__OPEN_SESAME_NATIVE__){status.textContent='Speaker labels need the Mac app';enabled.disabled=true;setup.hidden=true;return}
    try{const value=await openSesameBridge.request('diarization.status');ready=value?.ready===true;status.textContent=ready?'Local · up to 4 speakers':'Optional local model · no audio uploads';paint()}catch{ready=false;status.textContent='Speaker setup unavailable';paint()}
  }
  setup.addEventListener('click',async()=>{if(window.OpenSesameWidgetLifecycle?.isActive('shells')===false){toast('Activate Shells in Widgets to set up speakers.');return}try{const value=await openSesameBridge.request('diarization.setup');if(typeof value?.command!=='string')throw Error('Update the Mac app to set up speaker labels.');await window.openSesameAttachTerminal(value.command)}catch(error){toast(error.message)}});
  enabled.addEventListener('change',()=>{paint();window.OpenSesameLiveCapture?.sync()});
  async function begin(generation){
    if(window.OpenSesameWidgetLifecycle?.isActive('transcribe')===false)throw Error('Activate Transcribe in Widgets first.');
    const own=++ticket;if(id)await openSesameBridge.request('diarization.cancel',{id}).catch(()=>{});id='';ending=false;complete=false;prefix=audioSession.final;words=[];finished=[];segments=[];through=0;names={};speakerOrder=[];renderedIDs='';
    if(!enabled.checked){paint();return}
    id='speakers-'+newId();const next=id;status.textContent='Loading local speaker model…';
    try{await openSesameBridge.request('diarization.start',{id:next});if(own!==ticket||generation!==audioGeneration){await openSesameBridge.request('diarization.cancel',{id:next}).catch(()=>{});return}status.textContent='Listening · identifying speakers';paint()}
    catch(error){if(own===ticket){id='';ready=false;status.textContent=error.message;enabled.checked=false;paint()}throw error}
  }
  function accept(rows,offset,final){const current=model.validWords(rows).map(w=>({...w,start:w.start+offset,end:w.end+offset}));words=[...finished,...current];if(final)finished=[...words];paint()}
  function stop(immediate=false){if(!id||ending&&!immediate)return;ending=true;if(immediate){++ticket;openSesameBridge.request('diarization.cancel',{id}).catch(()=>{});id='';status.textContent='Speaker labeling stopped; transcript kept'}else{openSesameBridge.request('diarization.finish',{id}).catch(()=>{status.textContent='Speaker labels could not finish; transcript kept'});status.textContent='Input stopped · finishing speaker labels'}}
  window.addEventListener('open-sesame-desktop-event',event=>{const data=event.detail;if(!id||data?.id!==id)return;
    if(data.event==='diarization.result'){try{segments=model.validSegments(data.segments);for(const segment of [...segments].sort((a,b)=>a.start-b.start))if(!speakerOrder.includes(segment.speaker))speakerOrder.push(segment.speaker);through=Number.isFinite(data.through)?data.through:through;complete=data.final===true;status.textContent=(data.final?'Speaker labels ready':'Labels through '+stamp(through))+' · NeMo';paint()}catch{status.textContent='Invalid speaker result ignored'}}
    else if(data.event==='diarization.error'){status.textContent=data.message||'Speaker labels unavailable; transcript kept';id='';complete=true;paint()}
    else if(data.event==='diarization.ended'){id='';complete=true;paint();status.textContent=segments.length?'Speaker labels ready · local':'No speaker labels found'}
  });
  for(const event of ['open-sesame-layout','open-sesame-view-changed'])window.addEventListener(event,paint);
  window.addEventListener('open-sesame-view-changed',()=>{if(state.scenario==='audio'&&!id)refresh()});
  window.addEventListener('open-sesame-widgets-changed',event=>{if(event.detail?.id==='transcribe'){if(window.OpenSesameWidgetLifecycle.isActive('transcribe'))refresh();else stop(true)}});
  window.addEventListener('open-sesame-desktop-disconnected',()=>stop(true));
  window.OpenSesameSpeakers={begin,accept,stop,paint,exportText,get id(){return id}};refresh();
})();
