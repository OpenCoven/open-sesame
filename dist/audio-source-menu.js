'use strict';
// One capture setup owns source, output, and Start/Stop. Legacy checkboxes remain backend state only.
(()=>{
  const el=id=>document.getElementById(id),pane=el('pane-audio'),source=el('audio-source'),language=el('audio-language');
  const setup=document.createElement('section');setup.id='live-capture';setup.setAttribute('aria-label','Live audio capture');
  setup.innerHTML='<div class="live-capture-toolbar"><div class="live-capture-fields"><label for="live-capture-mode"><span class="sr-only">Output</span><select id="live-capture-mode" title="Capture output"><option value="transcribe">Transcribe</option><option value="record">Record audio</option></select></label><label id="live-capture-source-label" for="audio-source"><span class="sr-only">Audio source</span></label><label id="live-capture-language-label" for="audio-language"><span class="sr-only">Transcription language</span></label></div><div class="live-capture-actions"></div></div><div class="live-capture-summary"><small id="live-capture-output-hint"></small><div id="live-capture-state"></div><button id="live-capture-help-toggle" type="button" aria-label="Capture details" title="Capture details" aria-expanded="false" aria-controls="live-capture-help"></button></div><p id="live-capture-help" hidden></p>';
  pane.insertBefore(setup,el('live-workspace'));
  el('live-capture-source-label').append(source);el('live-capture-language-label').append(language);
  el('audio-source-help').hidden=true;el('live-options').querySelector('.audio-source-row').remove();
  el('live-options').querySelector('.audio-options').hidden=true;
  const mode=el('live-capture-mode'),actions=setup.querySelector('.live-capture-actions'),status=el('live-capture-state');
  actions.prepend(el('live-input-controls'));status.append(pane.querySelector('.live-status'),pane.querySelector('.live-clock'),el('audio-meter'));
  el('live-input-controls').setAttribute('aria-label','Capture controls');
  actions.append(el('live-settings'));setup.querySelector('.live-capture-summary').append(el('live-customize'),el('live-sample'));pane.querySelector('.live-bar').hidden=true;
  const helpToggle=el('live-capture-help-toggle');helpToggle.innerHTML=icon('info');let detailsOpen=false;
  helpToggle.addEventListener('click',()=>{detailsOpen=!detailsOpen;sync()});
  const result=document.createElement('section');result.id='live-recording-result';result.setAttribute('aria-label','Audio recording');
  result.innerHTML='<strong id="live-recording-heading">Your audio file</strong><p id="live-recording-help">Start recording, then Stop to save an audio file.</p><div><button type="button" id="live-recording-clear">Clear recording</button></div>';
  el('live-workspace').append(result);result.querySelector('div').prepend(el('audio-download'));
  el('audio-download').innerHTML=icon('download')+'<span>Save audio</span>';el('audio-download').setAttribute('aria-label','Save audio');
  const settings=el('live-settings');settings.title='Questions & privacy';settings.setAttribute('aria-label','Questions and privacy settings');el('live-options').setAttribute('aria-label','Questions and privacy settings');
  const sourceNames=window.OpenSesameLiveCaptureModel.sources;
  for(const option of source.options)option.textContent=sourceNames[option.value];
  let chosenMode=el('audio-record').checked?'record':'transcribe';mode.value=chosenMode;
  const busy=()=>audioSession.active||audioSession.starting||audioSession.stopping||!!window.OpenSesameLive?.demoRunning;
  function selectMode(value){
    if(busy()||!['transcribe','record'].includes(value))return false;
    chosenMode=value;mode.value=value;el('audio-record').checked=value==='record';el('audio-transcribe').checked=value==='transcribe';
    el('audio-record').dispatchEvent(new Event('change',{bubbles:true}));window.OpenSesameLive?.update();renderDraft();sync();return true;
  }
  function sync(){
    const running=busy(),record=chosenMode==='record',live=state.scenario==='audio'&&!window.OpenSesameLauncher?.active;
    mode.disabled=source.disabled=language.disabled=running;
    for(const option of source.options)option.disabled=!audioCapability(chosenMode,option.value).available;
    const supported=audioCapability(chosenMode,source.value);
    const output=record?'Save an audio file. No transcript is created.':'Turn speech into text. No audio file is saved.';
    const help=window.__OPEN_SESAME_NATIVE__&&source.value!=='mic'?(source.value==='both'?'Includes your microphone and audio from this Mac.':'Captures audio from this Mac; microphone stays off.')+' Allow Screen & System Audio Recording in macOS Privacy settings when asked.':source.value==='mic'?'Uses your Mac or browser’s selected microphone.':(source.value==='both'?'Includes your microphone. ':'')+'Choose a tab or screen and enable Share audio in the picker.';
    el('live-capture-help').textContent=!supported.available?supported.reason:output+' '+help;
    el('live-capture-help').hidden=!detailsOpen&&supported.available;
    helpToggle.setAttribute('aria-expanded',String(!el('live-capture-help').hidden));
    el('live-capture-output-hint').textContent=record?'Audio file only':'Text only · audio not saved';
    el('live-capture-language-label').hidden=record;
    el('audio-start').disabled=running||!supported.available||!!window.OpenSesameLive?.busy;
    el('audio-start').textContent='Start';el('audio-start').title=record?'Start recording':'Start transcription';
    el('audio-stop').textContent=audioSession.stopping?'Finishing…':window.OpenSesameLive?.demoRunning?'Stop demo':'Stop';
    el('audio-start').setAttribute('aria-describedby','live-capture-help');
    el('live-transcript-view').hidden=record;el('live-questions-view').hidden=record||!audioSession.final.trim()&&!audioSession.interim.trim();result.hidden=!record;
    el('live-recording-heading').textContent=audioSession.active?'Recording audio…':audioSession.recordUrl?'Recording ready':'Your audio file';
    el('live-recording-help').textContent=audioSession.starting?'Waiting for microphone or sharing permission…':audioSession.active?'Press Stop when you’re finished.':audioSession.stopping?'Finishing your audio file…':audioSession.recordUrl?'Save audio before quitting or starting another recording.':'Start recording, then Stop to save an audio file.';
    el('live-recording-clear').disabled=running||!audioSession.recordUrl;
    el('live-recording-clear').hidden=!audioSession.recordUrl;
    el('live-exports').hidden=!audioSession.final.trim();
    const label=audioSession.sourceLabel||sourceNames[source.value];
    status.title=(running?'Capturing: ':'Last source: ')+label;
    let activeSource=el('live-active-source');
    if(!activeSource){activeSource=document.createElement('small');activeSource.id='live-active-source';status.append(activeSource)}
    activeSource.textContent=window.OpenSesameLive?.demoRunning?'Sample conversation · microphone off':running?label:'';activeSource.hidden=!running;
    el('audio-meter').hidden=!audioSession.active||nativeSpeechMic();
    el('live-sample').hidden=record||running||!!audioSession.final.trim();
    el('capture-voice').hidden=live;el('widget-voice-open').hidden=live;
  }
  mode.addEventListener('change',()=>selectMode(mode.value));source.addEventListener('change',sync);
  el('live-recording-clear').addEventListener('click',()=>{if(busy())return;recordingGeneration++;if(audioSession.recordUrl.startsWith('blob:'))URL.revokeObjectURL(audioSession.recordUrl);audioSession.recordUrl='';audioSession.nativeRecording='';el('audio-download').hidden=true;el('audio-download').removeAttribute('href');if(window.__OPEN_SESAME_NATIVE__)openSesameBridge.request('record.clear').catch(()=>{});el('audio-status').textContent='Ready';window.OpenSesameLive?.update();sync()});
  for(const event of ['open-sesame-view-changed','open-sesame-layout'])window.addEventListener(event,sync);
  window.OpenSesameLiveCapture={sync,selectMode};selectMode(chosenMode);
})();
