import {readFileSync,writeFileSync} from 'node:fs';

const root=new URL('../',import.meta.url);
const htmlPath=new URL('dist/index.html',root);
let html=readFileSync(htmlPath,'utf8');
const fonts=JSON.parse(readFileSync(new URL('design/fonts/sources.json',root),'utf8'));
const faces=fonts.map(font=>{
  const bytes=readFileSync(new URL('design/fonts/'+font.file,root)).toString('base64');
  return `@font-face{font-family:'${font.family}';font-style:${font.style};font-weight:${font.weight};font-display:swap;src:url(data:font/woff;base64,${bytes}) format('woff');}`;
}).join('\n');
const theme=readFileSync(new URL('design/luxe.css',root),'utf8');
const mark=readFileSync(new URL('design/brand/mark.svg',root),'utf8');
const markPath=mark.match(/<svg[^>]*>([\s\S]*?)<\/svg>/)[1];
html=html.replace(/<symbol id="i-coven-mark"[\s\S]*?<\/symbol>\s*/,'');
html=html.replace('</defs>',`<symbol id="i-coven-mark" viewBox="0 0 212 212">${markPath}</symbol>\n</defs>`);
const licenses=['ebgaramond-OFL.txt','inter-OFL.txt'].map(file=>readFileSync(new URL('design/fonts/'+file,root),'utf8')).join('\n\n');
const safeLicense=licenses.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
html=html.replace(/<style id="embedded-fonts">[\s\S]*?<\/style>\s*/,'').replace(/<style id="luxe-theme">[\s\S]*?<\/style>\s*/,'').replace(/<template id="font-licenses">[\s\S]*?<\/template>\s*/,'');
html=html.replace('</head>',`<style id="embedded-fonts">\n${faces}\n</style>\n<style id="luxe-theme">\n${theme}\n</style>\n</head>`);
html=html.replace('</body>',`<template id="font-licenses"><pre>${safeLicense}</pre></template>\n</body>`);
writeFileSync(htmlPath,html);
console.log(`Applied the theme with ${fonts.length} embedded font faces. No runtime font requests.`);
