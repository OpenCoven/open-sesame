# Coven engine source

The archive is an unmodified source snapshot of OpenCoven/coven-code at `d23b1eab22a89641d9f9ef03e07941f5941e722e`, retrieved through the GitHub REST tarball endpoint. SHA-256: `e2883ebb9fb69bc5fdeb664fcb8535c8469e448f45c2a5085b3600c254a6930c`. Preserve its GPL-3.0 license, original authorship and dependency provenance. No dirty local Coven checkout is copied, modified or used as build input.

Open Sesame’s native computer agent uses the pinned Coven core and provider libraries through their typed Rust API. Its application-owned orchestration and tools live under `desktop/engine/`. It does not launch an installed Coven/Claude/Codex terminal agent or inherit their filesystem/tool registries. The application build bundles the standalone engine, this license and corresponding source information. The original source archive is included for reproducible builds and license compliance.
