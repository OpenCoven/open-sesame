# Mobile design and delivery

Mobile support is proposed, not shipped. [Issue #33](https://github.com/OpenCoven/open-sesame/issues/33) tracks the complete experience; its child issues separate reference, architecture, implementation, device qualification and packaging. Responsive desktop CSS, a prototype, a signed-in account or portable tests do not establish a mobile host or a companion connection.

Read [ADR 001: mobile host](adr-001-mobile-host.md), the [source and transport inventory](source-inventory.md) and the [capability/state contract](capabilities.md) before implementing mobile features. The ADR selects a recommendation for review; only an explicit recorded ratification changes its approval status. Existing [macOS capabilities](../capabilities.md) and [development/authority rules](../development-workflow.md) continue to apply.

[Issue #34](https://github.com/OpenCoven/open-sesame/issues/34) is the design-reference dependency. At the ADR's source baseline, neither `examples/mobile-reference` nor `docs/mobile` existed on main, and #34 remained open. The exact v0.3 reference, editable theme, offline checks and asset/license provenance must be delivered and reviewed under #34 before presentation fidelity can be accepted. These documents do not reconstruct or substitute for that missing artifact.
