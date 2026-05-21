# Open Sesame Template Design

## Goal

Create a new native macOS shell template at `OpenCoven/open-sesame`, based on the durable ideas in `BunsDev/previewer` while removing the web-only implementation stack.

## Source Review

`BunsDev/previewer` is a Next.js iframe portal. Its durable pieces are the site catalog, selected preview target, browser-style chrome, embedded web preview, reload/open controls, and URL validation. Its web-specific pieces are intentionally omitted: v0 metadata, Next.js routing, Tailwind/Radix UI, hash-based share-link compression, and generated public assets.

## Architecture

The template uses a Swift Package with two targets:

- `OpenSesameCore`: reusable catalog and site validation model.
- `OpenSesameApp`: SwiftUI/AppKit macOS shell with a sidebar, browser chrome, and `WKWebView`.

This keeps template logic testable without loading the native UI.

## Testing

Core tests verify URL validation, default catalog behavior, and stable site selection.
