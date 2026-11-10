# OpenCoven Brand

The official source of truth for OpenCoven's visual identity, voice, and brand system.

> If it carries the Coven's name, it should look, sound, and feel like it belongs here.

## Canonical web profile

Public web surfaces consume the versioned, framework-neutral profile rather than recreating a private token era:

- [`web/profile.css`](./web/profile.css) — light/dark/system semantic tokens, type, spacing, radius, motion, and forced-colors behavior;
- [`web/profile.json`](./web/profile.json) — machine-readable version, asset, state, contrast, imagery, and voice contract;
- [`web/assets/mark.svg`](./web/assets/mark.svg) — current flat monochrome crown/lotus mark;
- [`web/specimen.html`](./web/specimen.html) — responsive identity specimens;
- [`docs/WEB-SURFACE-PROFILE.md`](./docs/WEB-SURFACE-PROFILE.md) — normative usage guidance;
- [`docs/migration/landing-vnext.md`](./docs/migration/landing-vnext.md) — consumer migration notes.

Validate the export with Node 20+:

```bash
npm run check
```

The package/profile version is `1.0.0`. Consumers must pin an immutable commit or release and run a byte/semantic canary before updating.

## Repository map

| Path | Ownership |
|---|---|
| [`DESIGN.md`](./DESIGN.md) | Broad canonical design direction and historical rationale |
| [`web/`](./web) | Stable public-web identity export |
| [`logo/`](./logo) | Historical and current source assets; use the manifest's canonical path for new work |
| [`icons/`](./icons) | System icon source files |
| [`social/`](./social) | Banners, avatars, and OG assets |
| [`docs/`](./docs) | Usage, migration, and voice guidance |
| [`ui/`](./ui) | Deprecated compatibility entrypoints forwarding to the web profile |

## Current identity rules

- Canonical mark: flat, symmetric crown/lotus, monochrome, legible at favicon size.
- Brand anchor: Coven Violet `#8E3DFF`; accessible action variants are exported per theme.
- No retired hood/crescent/trident geometry, gradients, glow, smoke, sparkles, or fake depth on the mark.
- Typography: display, reading, and mono roles exported by the profile; no commercial font may be bundled without a license.
- Voice: clear, technically grounded, emotionally resonant, never fake-mystical. Familiar language clarifies architecture rather than obscuring it.

Visual identity belongs here. Framework-neutral interaction semantics belong to `OpenCoven/ui`; production component behavior belongs to product repositories.

## Contributing

Brand evolution is deliberate:

1. Open an issue explaining the change and downstream impact.
2. Include before/after evidence for visual changes.
3. Update `profileVersion` and `CHANGELOG.md` according to the versioning policy.
4. Run `npm run check`.
5. Obtain brand-owner review before changing the canonical mark, voice, or semantic roles.

## License

Brand assets (logos, marks, icons, banners) are **© OpenCoven** and may only be used in accordance with [`docs/BRAND-USAGE.md`](./docs/BRAND-USAGE.md). Tokens, type scales, and documentation follow the terms stated by the OpenCoven ecosystem unless noted otherwise.
