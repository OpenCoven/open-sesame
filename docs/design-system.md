# Design system and cascade budget

Open Sesame's look is a flat charcoal surface with one violet accent and a warm gold counter-accent. This page is the contract for how that look is expressed in source, how it is measured, and how a surface is changed without the cascade growing again. It describes source and automated evidence; installed native appearance, physical displays and device acceptance remain separate gates in the [capability matrix](capabilities.md).

## Why this exists

Before this system the interface was styled by stacking stylesheets. Each polish pass added a later sheet that overrode earlier ones, so weight and inconsistency only went up. Measured on main at `cbb8e9f`: 57 stylesheets, 2,249 distinct color values against 81 custom properties, 81 distinct font sizes with 840 declarations below 11px, 45 distinct corner radii and 19 transition durations. In WebKit one surface switch cost about 23 to 30 ms, more than a 60 Hz frame.

## Tokens

[design-tokens.css](../dist/design-tokens.css) is the only place a color, text size, radius, duration, space or shadow value is written. It loads before every other stylesheet. It has two tiers.

Primitive ramps hold every permitted value: `ash` (the charcoal neutral, 18 steps), `mauve` (the neutral warmed toward the accent, 12 steps), `violet` (the accent, 7 steps), `gold`, `rose`, `green` and `blue` (3 steps each), and translucent veils (`tint`, `shade`, `veil-violet`, and two-step veils per status hue) for overlays whose backdrop varies. The ramps were fitted in OKLab to the colors the interface already used, and the existing palette values are steps of the ramps, so adopting them moved colors by a median OKLab distance of 0.011.

Semantic tokens name the job a value does: `--surface-*`, `--line-*`, `--ink-*`, `--accent*`, `--positive`, `--caution`, `--critical`, `--info`, `--text-*`, `--space-*`, `--radius-*`, `--motion-*`, `--ease-standard` and `--shadow-*`. New and migrated rules use semantic tokens. A primitive reference in a surface stylesheet marks a value that was snapped mechanically and has not yet been given a role.

The smallest text the interface sets is `--text-caption`, 11px. `--radius-window` is 18px because the native window layer clips at 18px in [OpenSesame.swift](../desktop/OpenSesame.swift); surfaces that meet the window edge use it.

To change the look, change a token. Do not add a stylesheet that overrides an earlier one, and do not write a literal value in a surface stylesheet.

## Rules for selectors

Do not anchor `:has()` on `html`, `body`, `#widget-anchor` or `#widget-panel`. WebKit re-evaluates such a rule for unrelated mutations beneath the root, and a descendant combinator after it restyles the whole widget. One such rule, watching `[hidden]` on the media pane, accounted for more than half of WebKit's surface-switch time. Express the state as a class that [render](../dist/app.js) or the owning module sets on the root, as `media-active` now does. The budget counts root-anchored `:has()` selectors and none may be added.

A class or inherited custom property on `#widget-anchor` restyles every descendant when it changes. Write the settled value once per render. `render()` carries the classes that other modules derive on every render (`frame-full`, `items-overview`, `has-compact-media` and the three `compact-*` indicator classes) instead of dropping and restoring them, and writes the `--expanded-scale` that `OpenSesameWindow.sync` settles on.

Work for a hidden surface should not measure layout. A global rule gives every `[hidden]` element `display:none`, so `node.closest('[hidden]')` is a layout-free test that an element is not rendered.

## Measurement

| Evidence | Command | What it establishes |
| --- | --- | --- |
| Cascade budget | `npm run check` (runs [check-design-budget.mjs](../scripts/check-design-budget.mjs)) | No static measure in [design-budget.json](../scripts/design-budget.json) rose: stylesheet and script counts, bytes, `!important`, literal and distinct colors, font sizes and sizes below the floor, radii, durations, and `:has()` use |
| Rendered baseline | `node scripts/review-design-baseline.mjs --label NAME --compare DIR [--strict] [--browser webkit]` | Pixel comparison of 66 captures (13 surfaces at three window sizes, the sign-in page, and 26 states each in its own fresh profile: widget, dialog and open-menu states, the Projects board and card views and the Processes grid with seeded data, and hover and focus states of the shared button and field rules) in Chromium or WebKit, and a list of text newly cut off by a clipping ancestor |
| Interaction budget | `node scripts/review-switch-cost.mjs --budget` | Mean wall time of one surface switch, including forced style and layout, in headless WebKit and Chromium against the ceilings in the budget file |
| Selector cost | `node scripts/review-selector-cost.mjs` | Chromium's per-selector matching time over a loop of switches, for finding expensive selectors |
| Startup cost | `node scripts/review-startup-cost.mjs` | Wall time to a usable workspace in WebKit and Chromium, and Chromium's compile and evaluation time per script and parse time per stylesheet |
| Rendered audit | `node scripts/review-design-audit.mjs` | The distinct computed values controls and text actually render with across the matrix: heights, radii, sizes, weights, padding, line-height, colors, and small text set tighter than 1.2 |
| Rendered cascade | `node scripts/review-cascade-depth.mjs --budget [--hot]` | How many declarations match a visible element and lose to another, against the ceiling in the budget file; `--hot` ranks the rules most involved, which is the worklist for folding |
| Primitive conformance | `node scripts/review-primitives.mjs --strict` | Across every surface, size and state, no stylesheet but the theme decides a property that a primitive rule declares on an element it matches |
| Provenance | `node scripts/review-design-why.mjs --enter SURFACE --props height,padding '#selector'` | Every rule that sets the named properties on an element, weakest first with specificity and stylesheet, so an override can be folded into its owner |

The budget is a ratchet. Lower a ceiling whenever its measure falls. Raise one only in the same reviewed change, with the reason recorded under `reasons` in the budget file.

The rendered baseline, interaction budget, rendered cascade, conformance, selector cost, startup cost, audit and provenance tools use Playwright with synthetic native replies from the [isolated fixture](../scripts/fixtures/widget-fit.html); no shell, provider, account or capture is reached and external requests are blocked. They need the pinned development dependencies (`npm ci`) and are not part of `npm run check`. Captures and measurements are written under `build/design-baseline/`. They are fixture evidence, not installed-app, device or provider acceptance. Capture noise between identical runs was at most 0.005 percent of pixels in Chromium and zero in WebKit; the default tolerance is 0.05 percent.

Add a surface or state to [design-baseline-matrix.mjs](../scripts/design-baseline-matrix.mjs) before changing its styling, so the change is compared against a capture taken first. A state can carry a `seed` that saves data before the page loads and a `hover` selector the pointer rests on, so views that need saved items or a pointer state are captured the same way.

## Primitives

A primitive is one rule that owns the box, type and states of a control everywhere it appears. Surface stylesheets may place a primitive (margin, flex, width, overflow) and must not restate its box or color. Primitives live in [flat-theme.css](../dist/flat-theme.css), the existing owner of the shared interaction vocabulary, and use the control heights `--control-xs` 24px, `--control-sm` 28px, `--control-md` 32px and `--control-lg` 36px.

Segmented tabs are the first primitive. Every horizontal `[role=tablist]` and the Live view switch are one 32px strip with a 1px line, 3px padding, a 10px outer and 6px inner radius, 24px tabs, and one hover and one selected state. Vertical rails are rows, not tabs. Before this, the provenance tool showed a single tab shaped by about twenty rules in eight stylesheets written across nine generations of tab styling, including `!important` heights that contradicted each other; the strips rendered five different geometries. Those rules were deleted or narrowed, not overridden. Agenda tabs gained the selected fill the other strips already had, and every strip now sits on the inset surface. One older rule for repository tabs stays in `style.css` because a Reader review fixture uses that stylesheet without the workspace.

Control heights are the second step. Buttons, selects and fields that rendered at 30, 34, 25, 26 and 40px now use the control tokens in the rule that already owned their height: toolbar and dialog controls 32px, primary actions 36px, compact toggles 24px. Controls off the scale across the matrix fell from 40 to 18; those left are bare inputs inside composite fields, row-driven handles, and four buttons whose height comes from padding.

Fields are the third. Every text input, textarea and select is an inset surface with the control line and a 6px radius, and shows focus by its line turning to the accent line, not by a ring. A composite field (the Processes, Widgets and playlist search boxes and the two Media link forms) is a wrapper that draws that same box, with the input inside it bare; the wrapper shows focus the same way. Before this the three search boxes rendered three surfaces beside plain fields that rendered a fourth, three composite fields showed a darker rectangle around the inner input, and text fields had no focus indication because a later sheet removed the ring without replacing it. New markup uses `ui-field` and `ui-field-group`.

Stage empty states are the fourth. The Media, Shells and Desktops empty states already shared one title and body style; Projects, Reader, Processes and Computer each had their own, with titles from 12px to 18px in four colors. All now use the shared rule. The Familiars welcome is left to its redesign.

Buttons are the fifth. The matrix rendered 68 buttons outside tab strips in 53 combinations of height, radius, line, surface, ink and padding, with eight icon colors. Four variants now own surface, line, ink, radius and states: quiet (no surface until hovered or pressed; toolbar icons and low-emphasis actions), secondary (raised surface with a line; the default action), primary (accent fill; one per surface) and accent (accent line and ink; the add action of a list or rail). States are written once: hover, pressed or expanded, and disabled set `--button-ink`, `--button-fill` and `--button-line`, and each variant reads them with its own resting value as the fallback. A button with a state of its own sets those properties instead of restating colors; dictation in progress and a connected music account do this. A button's own stylesheet keeps its size (a control token) and placement. Labelled secondary and primary buttons share one inline padding.

Buttons are styled by element id and have no shared class, so each variant is a selector list of the ids that have joined it plus a class for new markup: `ui-button-quiet`, `ui-button`, `ui-button-primary` and `ui-button-accent`. A button joins a list in the same change that removes the declarations the list replaces, after a capture shows it. Navigation, the record button, the launcher buttons, add buttons that no capture shows and Familiars chat have not joined. The two disclosure labels in the Processes toolbar are `summary` elements and are in the secondary list. The conformance check enforces the rule: it found seven rules still deciding a button's surface and ten deciding a field's after the theme rules were written, and they were removed. Three named exceptions with reasons are recorded under `rendered.primitiveExceptions` in the budget file: the composer's syntax overlay, the Familiars search and the launcher's command list.

Rail rows, stage panels, cards and popovers already had one theme rule each for surface, line and shadow. They are now under the same conformance check (`ui-row`, `ui-panel`, `ui-card`, `ui-popover` for new markup) and no other stylesheet decides those properties in any captured state. Their radii stay with each surface because several members are not in the capture matrix; the Widgets cards and the Live transcript panel were aligned in their own rules.

To add a primitive: audit what renders, list the rules with the provenance tool, write one rule, delete the competing declarations from every other rule, and compare captures. A selector list that also serves other controls is narrowed to those controls.

## Changing a surface

1. Capture a reference from the tree you are starting from: `node scripts/review-design-baseline.mjs --label before`. `--root DIR` captures another checkout read-only.
2. Change one surface. Use semantic tokens. Edit the rule that owns the declaration instead of adding a later rule that overrides it.
3. Run `npm run check`, then `node scripts/review-design-baseline.mjs --label after --compare build/design-baseline/before`. A change meant to leave rendering alone is run with `--strict` and must report no changed capture. An intended visual change is reviewed from the listed captures and `.diff.png` files. Newly clipped text fails either way.
4. Run `node scripts/review-switch-cost.mjs --budget` after touching selectors, root classes or render code.
5. Lower any ceiling that fell.

## Dead declarations

`node scripts/design-cascade.mjs [--apply] [--explain]` removes declarations that can never apply. A declaration is removed only when, for every selector of its rule, another declaration of the same property, or of a shorthand that resets it, is proven to win wherever that selector matches, in the same or no conditional context, with at least the same importance. Rules repeated within one stylesheet and values the tool cannot compare are left alone.

Four proofs are used. An identical selector later in load order wins. A selector inside an `:is()` list stands for the same elements as that list's expansion, so the two are compared by specificity as written, then order. A leading `#ancestor ` adds specificity without changing what a selector matches when the next compound names an element that [index.html](../dist/index.html) always nests inside that ancestor, and `button#save` matches what `#save` matches when index.html makes that id a button. A selector whose last compound names an id matches at most that element, so a rule for the bare id that outranks it decides the property.

The last two rest on facts about index.html: nesting, element type and unique ids. They are used only for stylesheets no other page links, and every fact relied on is written to [design-ancestry.json](../scripts/design-ancestry.json). The rendered baseline checks each fact on every surface and state and fails if one stops holding. `--identical-only` restricts the tool to the first proof.

This is what retires an override layer. Writing a primitive at theme specificity makes the declarations it replaces provably dead, and the tool deletes them. Overrides the tool cannot prove are found with the rendered cascade tool and folded by hand.

## The token codemod

`node scripts/design-tokens.mjs [--apply] [--colors] [--radii] [--motion] [--type] [file.css ...]` snaps literals onto the token sheet. Without `--apply` it only reports. Colors move to the nearest primitive within a perceptual limit and are otherwise kept; a hued overlay may become a veil of its own hue or a neutral veil, never another hue. Radii and durations move to the nearest step. `--type` raises text below the floor and moves other pixel sizes to the nearest step within 2px; it changes geometry, so review it with the rendered baseline.

The codemod is deterministic and repeatable. After integrating another branch that still carries literal values, accept that branch's rule and run the codemod again rather than merging values by hand. It refreshes the content hashes in [index.html](../dist/index.html) for the files it rewrites; [refresh-asset-cache.mjs](../scripts/refresh-asset-cache.mjs) does the same after a manual edit.

Two stylesheets are held out of the codemod. [mobile-shell.css](../dist/mobile-shell.css) has reference-derived values checked value-for-value by the [mobile visual fixture](../scripts/fixtures/mobile-visual.mjs) and migrates with its owner. [sign-in.css](../dist/sign-in.css) styles the sign-in page, which migrates under its own review.

Every page must link the token sheet before any stylesheet that uses it. [sign-in.html](../dist/sign-in.html) and the two Reader review fixtures link subsets of the stylesheets, so they link `design-tokens.css` first; the codemod also holds any stylesheet that some page links without the token sheet, and the budget check fails if a page's stylesheets use a token that none of them defines. The sign-in page shares `app-version.css` with the workspace and rendered identically to main after this change.

## State on this branch

Measured on `task/design-system-20261111` against main at `cbb8e9f`. The static figures come from the budget tool. The timings are means from the switch-cost tool on one development Mac; absolute values moved with machine load between sessions, so each range pairs main and this branch measured in the same session.

| Measure | Main | This branch |
| --- | --- | --- |
| Literal color values in stylesheets | 3,530 | 140 |
| Distinct colors outside the token sheet | 2,249 | 120 |
| Distinct font sizes | 81 | 53 |
| Font-size declarations below 11px | 840 | 6 |
| Smallest rendered text across the 13 surfaces | 6px | 11px |
| Distinct corner radii | 45 | 23 |
| Distinct transition and animation durations | 19 | 8 |
| Stylesheets linked | 57 | 58 |
| Authored CSS bytes | 671,727 | 661,803 |
| Declarations | 22,545 | 20,162 |
| `!important` declarations | 511 | 402 |
| Geometries rendered by horizontal tab strips | 5 | 1 |
| Controls off the 24/28/32/36px height scale | 40 | 18 |
| Distinct title styles across stage empty states | 5 | 2 |
| Icon button colors across the matrix | 8 | 4 |
| Surfaces rendered by single-line fields and search boxes | 4 | 1 |
| Declarations that match a visible element and lose, 13 surfaces | 71,976 | 27,485 |
| Mean declarations per rendered element and property | 2.18 | 1.64 |
| Surface switch, WebKit, mean | 23 to 38 ms | 8 to 13 ms |
| Surface switch, WebKit, slowest surface | 40 to 61 ms | 15 to 25 ms |
| Surface switch, Chromium, mean | 7.7 to 15 ms | 6.9 to 9.6 ms |

Most of the remaining literals and all the sub-floor sizes are in the two held stylesheets. Authored CSS is now smaller than on main although a token reference is longer than the literal it replaces, and the stylesheet count rose by the token sheet itself.

The button rules were measured against the same tree without them in three interleaved WebKit runs of the switch-cost tool: 9.5 to 10.1 ms with the rules and 10.5 to 10.8 ms without, so the selector lists and the three state rules add no measurable cost.

Startup was measured and is not a bottleneck in the fixture: about 190 ms to a usable workspace in Chromium and 260 ms in WebKit with every script and stylesheet loaded. Chromium attributed about 85 ms to compiling and evaluating all 119 scripts, the largest single file about 10 ms, and about 2 ms to parsing all stylesheets. Loading surfaces on demand could recover only part of that 85 ms and would add a loading lifecycle to every surface, so it is not planned. This is fixture evidence; installed-app launch time was not measured.

Nineteen line-heights that left 11px text on a 12px or 13px line after the text floor were raised to 14px.

## Not done yet

The six polish stylesheets still exist as files: `refinement.css`, `console-polish.css`, `session-polish.css`, `interface-polish.css`, `familiar-chat-polish.css` and `application-polish.css`. What they override has been cut (declarations that lose on a rendered element fell from 71,976 to 27,485, and 402 `!important` declarations remain of 511), but dissolving the files means moving their remaining rules into the stylesheets that own each surface. Six other worktrees have work in those six files and 31 have work in some stylesheet, so moving rules between files now would turn their changes into conflicts. That step waits until this candidate and theirs are integrated.

The rendered cascade tool attributes the overrides that remain mostly to the base button and input resets in `style.css`, the widget and application layouts of the navigation, and the composer. Most of those are a base rule and one specific rule, which is the cascade working as intended.

The generic `:has()` rule for plus-only buttons still lays out add buttons that scripts create, so it stays; the three add buttons the matrix shows take their surface from the accent variant. The composer and the Computer task form are single components with launcher and full-screen modes and keep their own boxes. The `focus-tile` and `project-tile` classes named by the card rule are no longer created by any markup or script. The rendered audit still shows nine distinct inline paddings on icon buttons.

Markup classes for buttons would replace the id lists. That edits index.html and scripts other tasks have open, so it waits for an owner decision.

Snapped values reference primitives of the ramps. Giving each a semantic role is per-surface work.

Three root-anchored `:has()` rules remain: the PDF reader footer, the launcher background and the mobile reader footer. Measured individually each was within run-to-run noise, so they were left.

The Familiars chat surface is being redesigned under `familiars-modern-chat-20261111` and mobile presentation is owned by the mobile tasks. Their stylesheets received only the mechanical token pass, except `mobile-shell.css`, which was not touched.

Hover and focus of the shared button and field rules are captured; the first hover capture found one stylesheet still overriding the quiet hover state, and it was removed. Error and drag states, and hover on controls outside the shared rules, are not in the matrix, and no installed-app or physical-display review of this branch has been done.
