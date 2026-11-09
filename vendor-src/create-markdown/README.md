# Pinned @create-markdown packages

This snapshot contains the TypeScript implementation of `@create-markdown/core` and the HTML renderer/theme from `@create-markdown/preview`, version **2.0.3**, from the official repository [BunsDev/create-markdown](https://github.com/BunsDev/create-markdown/tree/c5c291c9801078674069fd30eea8203777e6f7d8).

Source commit: `c5c291c9801078674069fd30eea8203777e6f7d8`. License: MIT, retained in `LICENSE` and in `dist/vendor/create-markdown-LICENSE`.

The npm registry returned a network-policy 403 in this environment. Source was retrieved using the connected GitHub file API instead of bypassing the blocked registry. These are the upstream package sources, not an independently reimplemented parser. The upstream package manifests record the package names and versions. No successful npm installation or npm tarball parity is claimed.

Run `node scripts/build-markdown.mjs` with Node 24 to rebuild `dist/vendor/create-markdown.js`. The small bundler strips TypeScript using Node's built-in API and rejects unsupported imports/exports. Open Sesame uses the core parser/serializer, block factories for editor formatting, and the preview HTML serializer. The app keeps raw Markdown as its editing source and uses separate Write and Preview surfaces with pagination. DOMPurify sanitizes rendered HTML before insertion.

## Local security patch

The pinned upstream tokenizer is locally patched for CodeQL alerts #13–16 (`js/polynomial-redos`). Heading and list matchers consume their whitespace prefix once, then match content separately at a single anchored position. This removes quadratic backtracking across whitespace partitions while preserving the original content/line-terminator behavior, token metadata and Markdown syntax. The upstream commit and MIT license above still identify the base source; the generated bundle banner identifies this local modification.

Run `node scripts/check-markdown-redos.mjs` from the repository root. The check exercises the TypeScript source and shipped bundle in bounded workers against long tab runs followed by CR, U+2028 and U+2029 rejection cases, checks normal syntax and rendering, and rebuilds into a temporary file to require exact source/bundle parity. It joins `npm run check` and both hosted verification platforms automatically. `node scripts/build-markdown.mjs [output-file]` can target a temporary output; omitting the argument refreshes the committed runtime.
