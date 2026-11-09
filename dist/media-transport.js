'use strict';
// One app transport; native video controls are reserved for the fullscreen surface.
(()=>{
 const el=id=>document.getElementById(id),player=el('local-media'),bar=document.querySelector('.media-now-playing');
 const full=el('media-video-fullscreen');
 const volume=window.OpenSesameVolume.attach(el('media-transport-volume'),()=>window.OpenSesameLocalMedia,'Local media');
 function nativeControls(){player.controls=document.fullscreenElement===player||!!player.webkitDisplayingFullscreen}
 function sync(){
  const loaded=!!player.getAttribute('src');
  full.disabled=!loaded;full.hidden=!player.requestFullscreen&&!player.webkitEnterFullscreen;
  el('media-dropzone').hidden=loaded&&!el('pane-media').classList.contains('media-drop-active');bar.hidden=!loaded;volume.sync();
 }
 full.addEventListener('click',async()=>{if(full.disabled)return;try{if(player.webkitEnterFullscreen&&(!player.requestFullscreen||document.fullscreenEnabled===false)){player.controls=true;player.webkitEnterFullscreen()}else if(player.requestFullscreen)await player.requestFullscreen()}catch{nativeControls();toast('Fullscreen is unavailable for this media.')}});
 for(const name of ['loadedmetadata','durationchange','timeupdate','play','pause','ended','emptied','error','volumechange'])player.addEventListener(name,sync);
 document.addEventListener('fullscreenchange',nativeControls);player.addEventListener('webkitbeginfullscreen',()=>{player.controls=true});player.addEventListener('webkitendfullscreen',()=>{player.controls=false});
 window.addEventListener('open-sesame-view-changed',sync);nativeControls();sync();
})();
