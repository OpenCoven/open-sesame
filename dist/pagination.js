'use strict';
(()=>{
  const root=document.getElementById('widget-anchor'),selector='.workspace-pagination,.items-pagination,.text-pages,.focus-pagination,.reading-pages,.terminal-rail-pages,.youtube-queue-pages,.capture-command-pages,.detail-project-pages,.focus-calendar-nav';let hovered=null;
  const visible=node=>!!node?.getClientRects().length&&!node.closest('[hidden],[inert]');
  function controls(pager){const buttons=[...pager.querySelectorAll('button')];return {previous:buttons.find(b=>/previous/i.test(b.getAttribute('aria-label')||'')),next:buttons.find(b=>/next/i.test(b.getAttribute('aria-label')||''))}}
  function candidates(container){return [...container.querySelectorAll(selector)].filter(p=>visible(p)&&controls(p).previous&&controls(p).next)}
  function prepare(){for(const pager of root.querySelectorAll(selector)){if(!pager.hasAttribute('tabindex'))pager.tabIndex=0;if(!pager.hasAttribute('aria-label'))pager.setAttribute('aria-label','Pages · use left and right arrow keys');pager.title='← Previous · Next →';const {previous,next}=controls(pager);if(!previous||!next)continue;const group=previous.parentElement;if(group===next.parentElement){group.classList.add('open-sesame-pager');previous.classList.add('pager-previous');next.classList.add('pager-next');const label=[...group.children].find(node=>node.tagName==='SPAN');if(label){label.classList.add('pager-label');label.setAttribute('aria-live','polite');label.setAttribute('aria-atomic','true')}}}}
  root.addEventListener('pointerover',event=>hovered=event.target);root.addEventListener('pointerleave',()=>hovered=null);root.addEventListener('focusin',prepare);
  function nearest(node){if(!node||!root.contains(node))return null;const day=node.closest('#focus-calendar-day');if(day){const pages=document.getElementById('focus-calendar-pages');if(visible(pages))return pages}const direct=node.closest(selector);if(direct&&visible(direct))return direct;let parent=node;while(parent&&parent!==root){const options=candidates(parent);if(options.length===1)return options[0];if(options.length>1)return null;parent=parent.parentElement}const all=candidates(root);return all.length===1?all[0]:null}
  document.addEventListener('keydown',event=>{
    if(event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||!['ArrowLeft','ArrowRight'].includes(event.key)||!state.expanded)return;
    const target=event.target;if(target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role=tab],[role=slider],[role=listbox],[role=menu],.xterm,.terminal-native,iframe,video,audio,canvas'))return;
    const pager=nearest(target)||((target===document.body||target===root||target===document.getElementById('widget-panel'))?nearest(hovered):null);if(!pager)return;
    const button=controls(pager)[event.key==='ArrowLeft'?'previous':'next'];if(!button||button.disabled||!visible(button))return;event.preventDefault();event.stopPropagation();button.click();
  });
  window.addEventListener('open-sesame-layout',prepare);window.addEventListener('open-sesame-view-changed',prepare);new MutationObserver(prepare).observe(root,{childList:true,subtree:true});prepare();
})();
