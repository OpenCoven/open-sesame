'use strict';
// Measure the shared Console heading and reserve a pagination row at every size.
window.OpenSesameAgentsLayout={capacity:rail=>{
  const style=getComputedStyle(rail),row=railRowHeight(rail),gap=parseFloat(style.rowGap)||6;
  const header=rail.querySelector('.console-rail-heading')?.offsetHeight||80;
  const height=rail.clientHeight||240;
  return Math.max(1,Math.floor((height-header-32-gap*2+3)/(row+3)));
}};
