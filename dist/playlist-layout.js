'use strict';
(()=>{
  // Read the actual flex list space and reserve a stable footer before choosing a page size.
  // This remains correct when header controls, fonts, or the shared row size change.
  function capacity(list,pager,max=Infinity){
    const rail=list.parentElement,style=getComputedStyle(rail),listStyle=getComputedStyle(list),row=parseFloat(style.getPropertyValue('--playlist-row-height'))||44,gap=parseFloat(listStyle.rowGap)||0,footer=parseFloat(style.getPropertyValue('--playlist-pager-height'))||32;
    const available=Math.max(0,list.clientHeight-(pager.hidden?footer+(parseFloat(style.rowGap)||0):0));
    return Math.max(1,Math.min(max,Math.floor((available+gap)/(row+gap))));
  }
  window.OpenSesamePlaylistLayout={capacity};
})();
