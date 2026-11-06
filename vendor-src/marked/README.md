# Marked for GitHub views

Official source: https://github.com/markedjs/marked
Pinned source commit: `ba50aa95636ac8f97f46446bbfeb04592ed22216`.
The upstream manifest identifies this snapshot as 18.1.3; this is a pinned source build, not an npm installation.

`src/*.ts`, `package.json`, and `LICENSE` are unchanged upstream files retrieved from the official repository. `scripts/build-gfm.mjs` strips TypeScript types and bundles the dependency-free parser for the browser using Node 24. Rebuild from the repository root:

```sh
node scripts/build-gfm.mjs
```

The generated `dist/vendor/marked.js` exposes `window.OpenSesameGFM`. GitHub README and Markdown file views enable GFM tables, strikethrough, task lists, autolinks, and embedded HTML. `dist/content.js` resolves repository-relative images and links, then sanitizes the result with DOMPurify before inserting it into the widget. Notes continue to use @create-markdown.

MIT license: `LICENSE`, also distributed as `dist/vendor/marked-LICENSE`.
