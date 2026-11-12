// OKLab helpers for the token tools. Dependency-free.
const linear=v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4};
export function parseHex(hex){const h=hex.replace('#','');const full=h.length<=4?[...h].map(c=>c+c).join(''):h;return{r:parseInt(full.slice(0,2),16),g:parseInt(full.slice(2,4),16),b:parseInt(full.slice(4,6),16),a:full.length===8?parseInt(full.slice(6,8),16)/255:1}}
export function oklab({r,g,b}){
  const R=linear(r),G=linear(g),B=linear(b);
  const l=Math.cbrt(.4122214708*R+.5363325363*G+.0514459929*B),m=Math.cbrt(.2119034982*R+.6806995451*G+.1073969566*B),s=Math.cbrt(.0883024619*R+.2817188376*G+.6299787005*B);
  return{L:.2104542553*l+.793617785*m-.0040720468*s,a:1.9779984951*l-2.428592205*m+.4505937099*s,b:.0259040371*l+.7827717662*m-.808675766*s};
}
export const chroma=lab=>Math.hypot(lab.a,lab.b);
export const hue=lab=>(Math.atan2(lab.b,lab.a)*180/Math.PI+360)%360;
export const distance=(x,y)=>Math.hypot(x.L-y.L,x.a-y.a,x.b-y.b);
export const over=(top,base)=>({r:top.r*top.a+base.r*(1-top.a),g:top.g*top.a+base.g*(1-top.a),b:top.b*top.a+base.b*(1-top.a),a:1});
const gamma=v=>{v=Math.min(1,Math.max(0,v));return Math.round(255*(v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055))};
export function fromOklch(L,C,H){
  const a=C*Math.cos(H*Math.PI/180),b=C*Math.sin(H*Math.PI/180);
  const l=(L+.3963377774*a+.2158037573*b)**3,m=(L-.1055613458*a-.0638541728*b)**3,s=(L-.0894841775*a-1.291485548*b)**3;
  return{r:gamma(4.0767416621*l-3.3077115913*m+.2309699292*s),g:gamma(-1.2684380046*l+2.6097574011*m-.3413193965*s),b:gamma(-.0041960863*l-.7034186147*m+1.707614701*s),a:1};
}
export const toHex=({r,g,b})=>'#'+[r,g,b].map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');
