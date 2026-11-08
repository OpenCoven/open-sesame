'use strict';
// Browser media stays in memory. Nothing is uploaded by this app.
const SpeechEngine=window.SpeechRecognition||window.webkitSpeechRecognition;
const chromiumVersion=Number(navigator.userAgent.match(/(?:Chrome|Chromium|Edg)\/(\d+)/)?.[1]||0);
const trackRecognition=chromiumVersion>=135&&!/Android|Mobile/.test(navigator.userAgent);
const audioSession={active:false,starting:false,stopping:false,streams:[],context:null,mixed:null,recognizer:null,recorder:null,chunks:[],recordUrl:'',textUrl:'',startedAt:0,timer:null,meterFrame:null,restartTimer:null,final:'',interim:'',speechFailed:false};
let audioGeneration=0,recordingGeneration=0;
const nativeSpeechCapture=()=>Boolean(window.__OPEN_SESAME_NATIVE__ && !$('audio-record').checked);
const nativeSpeechMic=()=>Boolean(window.__OPEN_SESAME_NATIVE__ && $('audio-source').value==='mic' && !$('audio-record').checked);
let nativeSpeechID='', nativeStopPending=false;
let nativeRecordingID='';
audioSession.sourceLabel='';
function audioCapability(mode=$('audio-record').checked?'record':'transcribe',source=$('audio-source').value){
  return window.OpenSesameLiveCaptureModel?.capability({native:!!window.__OPEN_SESAME_NATIVE__,speech:!!SpeechEngine,track:trackRecognition,microphone:!!navigator.mediaDevices?.getUserMedia,shared:!!navigator.mediaDevices?.getDisplayMedia,recorder:!!window.MediaRecorder,mixing:!!(window.AudioContext||window.webkitAudioContext)},mode,source)||{available:true,reason:''};
}
function audioSourceHelp(){
  const source=$('audio-source').value;
  $('audio-source-help').textContent=window.__OPEN_SESAME_NATIVE__&&source!=='mic'?(source==='both'?'Captures your microphone and audio from this Mac.':'Captures audio from this Mac; your microphone stays off.')+' Allow Screen & System Audio Recording in macOS Privacy settings when asked.':source==='mic'?'Your mic stays off until you start.':(source==='both'?'Capture your mic too. ':'')+'Choose a tab or screen and enable “Share audio” in the picker. If no audio is offered, try a Chrome tab.';
  $('audio-transcribe').disabled=!nativeSpeechCapture()&&(!SpeechEngine||(source!=='mic'&&!trackRecognition));
  if(!SpeechEngine&&!nativeSpeechCapture())$('transcript-status').textContent='Live transcription unavailable in this browser.';
  else if(!window.__OPEN_SESAME_NATIVE__&&source!=='mic'&&!trackRecognition)$('transcript-status').textContent='Shared-audio transcription needs desktop Chrome 135+.';
  else if(!audioSession.active)$('transcript-status').textContent='Live transcript';
}
$('audio-source').addEventListener('change',audioSourceHelp);
$('audio-record').addEventListener('change',audioSourceHelp);
let renderedTranscript;
function renderTranscript(){
  const text=audioSession.final, has=!!text.trim();
  $('audio-interim').textContent=audioSession.interim;
  $('transcript-note').disabled=!has;$('transcript-copy').disabled=!has;
  $('transcript-clear').disabled=!has||audioSession.active||audioSession.starting||audioSession.stopping;
  if(text!==renderedTranscript){
    renderedTranscript=text;
    transcriptEditor.set(text,{follow:audioSession.active});
    if(audioSession.textUrl)URL.revokeObjectURL(audioSession.textUrl);
    audioSession.textUrl=has?URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})):'';
    $('transcript-download').hidden=!has;
    if(has)$('transcript-download').href=audioSession.textUrl;
    else $('transcript-download').removeAttribute('href');
  }
  window.OpenSesameLive?.update();
}
function setAudioControls(){
  const busy=audioSession.active||audioSession.starting||audioSession.stopping;
  ['audio-source','audio-transcribe','audio-record','audio-language'].forEach(id=>$(id).disabled=busy);
  if(!busy)audioSourceHelp();
  $('audio-start').disabled=busy;$('audio-stop').disabled=!busy||audioSession.stopping;
  $('audio-live-dot').hidden=!audioSession.active;document.body.classList.toggle('audio-active',audioSession.active);
  $('panel-caption').textContent=audioSession.active?($('audio-record').checked?'RECORDING':'TRANSCRIBING')+' · '+time(Math.floor((Date.now()-audioSession.startedAt)/1000)):'A MOMENT FOR YOU';
  $('panel-privacy').title='Screen-share privacy · Option Shift P';
  renderCompact();renderTranscript();
}
function beginSpeech(track){
  if(!SpeechEngine||!$('audio-transcribe').checked)return;
  const shared=$('audio-source').value!=='mic';
  if(shared&&!trackRecognition){$('transcript-status').textContent='Shared-audio transcription needs desktop Chrome 135+.';return}
  const base=audioSession.final.trimEnd();
  const recognition=OpenSesameRecognition.create({Engine:SpeechEngine,lang:$('audio-language').value,track:shared?track:null,
    onText({final,interim}){if(audioSession.recognizer!==recognition)return;audioSession.final=[base,final].filter(Boolean).join('\n\n');audioSession.interim=interim;renderTranscript()},
    onStatus(status){if(audioSession.recognizer!==recognition)return;$('transcript-status').textContent=({listening:'Transcribing live',reconnecting:'Reconnecting speech service…',finishing:'Finishing transcript…',ready:'Transcript ready'})[status]||$('transcript-status').textContent},
    onError(error){if(audioSession.recognizer!==recognition)return;audioSession.speechFailed=true;$('transcript-status').textContent=OpenSesameRecognition.message(error)+' Captured text is preserved.';$('transcript-retry').hidden=!audioSession.active},
    onEnd(){if(audioSession.recognizer!==recognition)return;if(audioSession.stopping)finishAudioStop()}
  });
  audioSession.recognizer=recognition;audioSession.speechFailed=false;$('transcript-retry').hidden=true;recognition.start();
}
$('transcript-retry').addEventListener('click',()=>{if(!audioSession.active||audioSession.stopping)return;audioSession.recognizer?.abort();audioSession.recognizer=null;const interim=audioSession.interim.trim();if(interim)audioSession.final+=(audioSession.final?'\n':'')+interim;audioSession.interim='';beginSpeech(audioSession.mixed?.getAudioTracks()[0])});
function startMeter(analyser){
  const samples=new Uint8Array(analyser.fftSize);
  const tick=()=>{if(!audioSession.active)return;analyser.getByteTimeDomainData(samples);let sum=0;for(const v of samples)sum+=((v-128)/128)**2;const level=Math.min(100,Math.round(Math.sqrt(sum/samples.length)*300));$('audio-meter-fill').style.width=level+'%';$('audio-meter').setAttribute('aria-valuenow',level);audioSession.meterFrame=requestAnimationFrame(tick)};tick();
}
function releaseAudio(){
  clearTimeout(audioSession.restartTimer);clearInterval(audioSession.timer);audioSession.timer=null;cancelAnimationFrame(audioSession.meterFrame);
  audioSession.streams.forEach(s=>s.getTracks().forEach(t=>t.stop()));audioSession.streams=[];
  audioSession.mixed?.getTracks().forEach(t=>t.stop());audioSession.mixed=null;
  if(audioSession.context)audioSession.context.close().catch(()=>{});audioSession.context=null;
  $('audio-meter-fill').style.width='0%';$('audio-meter').setAttribute('aria-valuenow','0');
}
async function startNativeSegment(generation){
  const id = 'live-'+newId();
  nativeSpeechID = id;
  try {
    const result=await openSesameBridge.request('speech.start',{id,locale:$('audio-language').value,source:$('audio-source').value});
    if(generation!==audioGeneration || id!==nativeSpeechID)return;
    audioSession.starting=false; audioSession.active=true;
    audioSession.sourceLabel=result?.sourceLabel||'System microphone';
    if(!audioSession.timer)audioSession.startedAt=Date.now();
    $('audio-status').textContent='Transcribing';
    setAudioControls(); $('transcript-status').textContent='Transcribing live';
    if(!audioSession.timer){
      audioSession.startedAt=Date.now();
      audioSession.timer=setInterval(()=>{
        const seconds=Math.floor((Date.now()-audioSession.startedAt)/1000);
        $('audio-elapsed').textContent=time(seconds);
        $('panel-caption').textContent='TRANSCRIBING · '+time(seconds);
        if(seconds>=1800)stopAudio('30-minute capture complete.');
      },1000);
    }
  } catch(error) {
    if(generation===audioGeneration && id===nativeSpeechID)stopAudio(error.message || 'Microphone unavailable.',true);
  }
}
window.addEventListener('open-sesame-desktop-event',event=>{
  const data=event.detail;
  if(nativeRecordingID && data.id===nativeRecordingID){
    if(data.event==='record.error'||data.event==='record.ended')stopAudio(data.message||'Recording stopped.');
    if(data.event==='record.level'&&audioSession.active){const level=Math.max(0,Math.min(100,Number(data.level)||0));$('audio-meter-fill').style.width=level+'%';$('audio-meter').setAttribute('aria-valuenow',level)}
  }
  if(!nativeSpeechID || data.id!==nativeSpeechID)return;
  if(data.event==='voice.level'&&audioSession.active){const level=Math.max(0,Math.min(100,Number(data.level)||0));$('audio-meter-fill').style.width=level+'%';$('audio-meter').setAttribute('aria-valuenow',level);return}
  if(data.event==='voice.error'){stopAudio(data.message || 'Transcription stopped.',true);return}
  if(data.event!=='voice.result')return;
  audioSession.interim=String(data.text||'').trim();
  if(data.final){
    if(audioSession.interim)audioSession.final+=(audioSession.final?'\n':'')+audioSession.interim;
    audioSession.interim=''; nativeSpeechID='';
    if(nativeStopPending){finishAudioStop();return}if(audioSession.active || audioSession.starting)startNativeSegment(audioGeneration);
  }
  renderTranscript();
});
async function startAudio(){
  if(audioSession.active||audioSession.starting||audioSession.stopping)return;
  const supported=audioCapability();
  if(!supported.available){$('audio-status').textContent=supported.reason;return}
  window.OpenSesameLive?.beforeListen();
  window.OpenSesameVoice?.cancel();
  audioSession.sourceLabel='';
  const wantsTranscript=$('audio-transcribe').checked;
  if(wantsTranscript && $('audio-transcribe').disabled && !$('audio-record').checked){
    $('audio-status').textContent='Transcription unavailable for this source. Try the demo or change the source.';
    return;
  }
  if(nativeSpeechCapture() && wantsTranscript){
    nativeStopPending=false;
    audioSession.starting=true;
    $('audio-elapsed').textContent='0:00';
    $('audio-status').textContent=$('audio-source').value==='mic'?'Allow microphone access…':'Allow system audio recording…';
    setAudioControls(); startNativeSegment(++audioGeneration); return;
  }
  if(window.__OPEN_SESAME_NATIVE__ && $('audio-record').checked){
    const request=++audioGeneration,id='record-'+newId();nativeRecordingID=id;audioSession.starting=true;
    $('audio-elapsed').textContent='0:00';$('audio-status').textContent=$('audio-source').value==='mic'?'Allow microphone access…':'Allow system audio recording…';setAudioControls();
    try{
      const result=await openSesameBridge.request('record.start',{id,source:$('audio-source').value});
      if(request!==audioGeneration||nativeRecordingID!==id)return;
      if(audioSession.recordUrl.startsWith('blob:'))URL.revokeObjectURL(audioSession.recordUrl);
      audioSession.recordUrl='';audioSession.nativeRecording='';$('audio-download').hidden=true;
      audioSession.sourceLabel=result?.sourceLabel||'System microphone';audioSession.startedAt=Date.now();audioSession.starting=false;audioSession.active=true;
      $('audio-status').textContent='Recording';setAudioControls();
      audioSession.timer=setInterval(()=>{const seconds=Math.floor((Date.now()-audioSession.startedAt)/1000);$('audio-elapsed').textContent=time(seconds);$('panel-caption').textContent='RECORDING · '+time(seconds);if(seconds>=1800)stopAudio('30-minute recording complete. Save your audio.');},1000);
    }catch(error){if(request===audioGeneration&&nativeRecordingID===id)stopAudio(error.message||'Could not start recording.',true)}
    return;
  }
  $('audio-elapsed').textContent='0:00';
  const request=++audioGeneration;
  const retain=stream=>{if(request!==audioGeneration){stream.getTracks().forEach(t=>t.stop());throw new DOMException('Capture cancelled','AbortError')}audioSession.streams.push(stream);return stream};
  const mode=$('audio-source').value,keepAudio=$('audio-record').checked,wantSpeech=$('audio-transcribe').checked&&!$('audio-transcribe').disabled;
  audioSession.starting=true;audioSession.speechFailed=false;$('audio-status').textContent='Waiting for access…';setAudioControls();
  try{
    // The share picker must be requested directly from this user click.
    if(mode!=='mic'){
      if(!navigator.mediaDevices.getDisplayMedia)throw new Error('Shared audio is unavailable. Try desktop Chrome.');
      const shared=await navigator.mediaDevices.getDisplayMedia({video:{displaySurface:'browser'},audio:{suppressLocalAudioPlayback:false},systemAudio:'include',selfBrowserSurface:'exclude',surfaceSwitching:'include'});
      retain(shared);
      if(!shared.getAudioTracks().length)throw new Error('No shared audio was supplied. Start again, select a tab, and enable “Share audio”.');
    }
    if(mode!=='system')retain(await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false}));
    if(request!==audioGeneration)return;
    const AudioEngine=window.AudioContext||window.webkitAudioContext;if(!AudioEngine)throw new Error('Audio mixing is unavailable in this browser.');
    const context=new AudioEngine();audioSession.context=context;await context.resume();if(request!==audioGeneration)return;
    const destination=context.createMediaStreamDestination(),analyser=context.createAnalyser();analyser.fftSize=512;
    const gain=context.createGain();gain.gain.value=mode==='both'?.65:1;gain.connect(destination);gain.connect(analyser);
    audioSession.streams.forEach(stream=>context.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(gain));
    audioSession.mixed=destination.stream;audioSession.active=true;audioSession.starting=false;audioSession.startedAt=Date.now();
    audioSession.sourceLabel=audioSession.streams.map(stream=>stream.getAudioTracks()[0]?.label).filter(Boolean).join(' + ')||window.OpenSesameLiveCaptureModel?.sources[mode]||'Selected audio';
    audioSession.interim='';
    const recordingId=++recordingGeneration;
    if(keepAudio){
      if(!window.MediaRecorder)throw new Error('Audio recording is unsupported here.');
      const chunks=[];const types=['audio/webm;codecs=opus','audio/mp4','audio/webm'];const mime=types.find(t=>MediaRecorder.isTypeSupported(t));
      const recorder=new MediaRecorder(destination.stream,mime?{mimeType:mime}:undefined);audioSession.recorder=recorder;
      recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
      recorder.onstop=()=>{const blob=new Blob(chunks,{type:recorder.mimeType||'audio/webm'});if(recordingId!==recordingGeneration||!blob.size)return;if(audioSession.recordUrl)URL.revokeObjectURL(audioSession.recordUrl);audioSession.recordUrl=URL.createObjectURL(blob);$('audio-download').href=audioSession.recordUrl;$('audio-download').download='open-sesame-audio.'+(blob.type.includes('mp4')?'m4a':'webm');$('audio-download').hidden=false;window.OpenSesameLive?.update()};recorder.start(1000);
    }
    audioSession.streams.forEach(s=>s.getTracks().forEach(t=>t.addEventListener('ended',()=>{if(audioSession.active)stopAudio('Audio source disconnected. Capture stopped.')})));
    $('audio-status').textContent=keepAudio?'Recording':'Transcribing';
    setAudioControls();startMeter(analyser);
    if(wantSpeech)beginSpeech(destination.stream.getAudioTracks()[0]);else $('transcript-status').textContent=SpeechEngine?'Live transcription is off':'Live transcription unavailable in this browser.';
    audioSession.timer=setInterval(()=>{const seconds=Math.floor((Date.now()-audioSession.startedAt)/1000);$('audio-elapsed').textContent=time(seconds);$('panel-caption').textContent=(keepAudio?'RECORDING':'TRANSCRIBING')+' · '+time(seconds);if(seconds>=1800)stopAudio('30-minute capture complete. Save your transcript or audio.');},1000);
  }catch(error){
    if(request!==audioGeneration)return;
    const message=error.name==='NotAllowedError'?'Microphone or sharing permission declined. Try the demo.':error.name==='NotFoundError'?'No microphone was found. Try shared audio.':error.name==='NotReadableError'?'This audio source is busy or unavailable.':error.message||'Could not start audio. Try again.';
    stopAudio(message);
  }
}
let audioStopMessage='',audioFinishTimer=null;
function finishAudioStop(){
  clearTimeout(audioFinishTimer);audioFinishTimer=null;
  if(nativeSpeechID)openSesameBridge.request('speech.stop',{id:nativeSpeechID,cancel:true}).catch(()=>{});
  nativeSpeechID='';nativeStopPending=false;
  const recognition=audioSession.recognizer;audioSession.recognizer=null;recognition?.abort();
  if(audioSession.interim.trim())audioSession.final+=(audioSession.final?'\n':'')+audioSession.interim.trim();
  audioSession.interim='';audioSession.stopping=false;releaseAudio();
  $('audio-status').textContent=audioStopMessage||'Transcript ready';setAudioControls();
  if(audioSession.speechFailed)$('transcript-status').textContent='Speech service unavailable. Captured text is preserved; start again to retry.';
  else if(audioSession.final.trim())$('transcript-status').textContent='Transcript ready';
}
function stopAudio(message=$('audio-record').checked?'Recording ready · save your audio':'Transcript ready',immediate=false){
  if(audioSession.stopping&&!immediate)return;
  audioStopMessage=message;audioGeneration++;audioSession.active=false;audioSession.starting=false;clearTimeout(audioSession.restartTimer);clearInterval(audioSession.timer);audioSession.timer=null;
  $('transcript-retry').hidden=true;
  if(audioSession.recorder&&audioSession.recorder.state!=='inactive')audioSession.recorder.stop();audioSession.recorder=null;
  if(nativeRecordingID){
    const id=nativeRecordingID;nativeRecordingID='';audioSession.stopping=true;setAudioControls();
    openSesameBridge.request('record.stop',{id}).then(result=>{if(!result?.ready&&audioStopMessage==='Recording ready · save your audio')audioStopMessage='No audio was captured. Start again and play audio before stopping.';if(result?.ready){audioSession.nativeRecording=id;audioSession.recordUrl='native-recording:'+id;$('audio-download').href='#';$('audio-download').hidden=false}}).catch(error=>{audioStopMessage=error.message||'Could not finish recording.'}).finally(finishAudioStop);
    return;
  }
  if(!immediate&&(nativeSpeechID||audioSession.recognizer)&&!audioSession.speechFailed){
    audioSession.stopping=true;$('audio-status').textContent='Finishing transcript…';setAudioControls();
    audioFinishTimer=setTimeout(finishAudioStop,2200);
    if(nativeSpeechID){nativeStopPending=true;openSesameBridge.request('speech.stop',{id:nativeSpeechID,cancel:false}).catch(finishAudioStop)}else audioSession.recognizer.stop();
  }else finishAudioStop();
}
$('audio-start').addEventListener('click',startAudio);$('audio-stop').addEventListener('click',()=>window.OpenSesameLive?.demoRunning?window.OpenSesameLive.endDemo():stopAudio());
$('audio-download').addEventListener('click',async event=>{if(!audioSession.nativeRecording)return;event.preventDefault();try{if(await openSesameBridge.request('record.save',{id:audioSession.nativeRecording}))toast('Audio saved.')}catch(error){toast(error.message||'Could not save audio.')}});
$('transcript-clear').addEventListener('click',()=>{if(audioSession.active||audioSession.starting||audioSession.stopping)return;audioSession.final='';audioSession.interim='';renderTranscript()});
$('transcript-copy').addEventListener('click',async()=>{const text=audioSession.final.trim();if(!text)return;try{await navigator.clipboard.writeText(text);toast('Transcript copied.')}catch{toast('Use Export .txt to save the complete transcript.')}});
$('transcript-note').addEventListener('click',()=>{
  if(!audioSession.final.trim())return;if(activeItems().length>=30||items.length>=300){toast('Make room in Projects to save this transcript.');return}
  const title=(window.OpenSesameLive?.isDemo()?'Demo transcript · ':'Transcript · ')+new Date().toLocaleDateString(undefined,{month:'short',day:'numeric'});
  const note={id:newId(),text:title,title,kind:'note',url:'',done:false,body:audioSession.final.trim().slice(0,12000),projectId:$('capture-project').value==='__new'?'':$('capture-project').value};items.push(note);
  if(!saveItems()){items.pop();return}selectedItemId=note.id;revealItem=true;if(projectFilter!=='all')projectFilter=note.projectId||'inbox';libraryOpen=true;categoryFilter='note';expandedCategories.add('note');changeScenario('items');toast('Transcript saved as a note.');
});
const sharePrivacy=$('share-privacy');
function showSharePrivacy(){if(guide.open)guide.close();if(!sharePrivacy.open)sharePrivacy.showModal()}
['privacy-hide','panel-privacy'].forEach(id=>$(id).addEventListener('click',showSharePrivacy));
['share-privacy-close','share-privacy-done'].forEach(id=>$(id).addEventListener('click',()=>sharePrivacy.close()));
document.addEventListener('keydown',e=>{if(e.altKey&&e.shiftKey&&e.code==='KeyP'){e.preventDefault();sharePrivacy.open?sharePrivacy.close():showSharePrivacy()}});
window.addEventListener('pagehide',()=>{stopAudio('Stopped.',true);if(audioSession.recordUrl)URL.revokeObjectURL(audioSession.recordUrl);if(audioSession.textUrl)URL.revokeObjectURL(audioSession.textUrl)});
audioSourceHelp();renderTranscript();
