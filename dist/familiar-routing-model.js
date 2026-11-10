'use strict';
(() => {
  function resolve(raw, roster, defaultId = '') {
    const text = String(raw).trim();
    if (text.length > 20000) return {error:'Keep the question under 20,000 characters.'};
    const mentions = [...text.matchAll(/(^|\s)@([a-z0-9_-]+)\b/gi)];
    let recipient = roster.find(row => row.id === defaultId) || roster[0];
    const destinations = new Set();
    for (const match of mentions) {
      const name = match[2].toLowerCase();
      const found = roster.filter(row => [row.id,row.name,row.displayName].some(value => String(value).toLowerCase() === name));
      if (found.length !== 1) return {error:'Choose a known familiar for @' + match[2] + '.'};
      destinations.add(found[0].id); recipient = found[0];
    }
    if (destinations.size > 1) return {error:'Choose one familiar for this question.'};
    if (!recipient) return {error:'Connect Coven to choose a default familiar.'};
    const question = mentions.length ? text.replace(/(^|\s)@([a-z0-9_-]+)\b/gi, '$1').trim() : text;
    return {familiarId:recipient.id,question};
  }
  const api = Object.freeze({resolve});
  if (typeof window !== 'undefined') window.OpenSesameFamiliarRoutingModel = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
