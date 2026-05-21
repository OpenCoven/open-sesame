# open-sesame

Generic macOS application shell template for OpenCoven projects.

This is a stripped-down native translation of the durable shape from `BunsDev/previewer`:

- a small site catalog
- selectable preview targets
- browser-style chrome
- embedded `WKWebView`
- reload and open-in-browser controls

It intentionally does not include the Next.js/v0 stack, share-link compression, Radix UI, Tailwind, or generated asset bundle. Those belong to the web preview app, not the native template shell.

## Run

```bash
swift run open-sesame
```

## Test

```bash
swift test
```

## Template Notes

The reusable model lives in `Sources/OpenSesameCore`. The macOS shell lives in `Sources/OpenSesameApp`.

Start new variants by replacing `SiteCatalog.defaultCatalog`, adding persistence, or swapping the `BrowserWebView` pane for a project-specific surface.
