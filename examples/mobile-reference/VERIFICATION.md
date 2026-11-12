# Prototype verification — 9 November 2026

## Automated checks

Command: `npm run check` in `open-sesame-mobile`.

Result: 12 checks passed; exit code 0. Node's VM compiled the application script and exercised all five renderers, text escaping, invalid/credential-bearing URL rejection, latest-note display, saved-state reload, absolute-deadline timer recovery, completion exactly once, paused recovery, blocked/malformed storage, unsafe persisted links, and familiar-history separation. The DOM is stubbed for these checks; this does not establish browser behavior. npm printed a non-fatal environment `http-proxy` configuration warning.

## Browser observations

The actual app was served with `sites-preview start /workspace/scratch/a9065b8d8140/open-sesame-mobile` and exercised in the connected Chromium browser. The temporary layout fixture used same-origin frames sized 390 × 844 and 320 × 640; these are CSS viewport checks, not physical devices.

| Scenario | Observation |
| --- | --- |
| Initial launch and navigation | All five destinations rendered and were reachable |
| Capture | Created a note titled “Mobile flow check”; it appeared in Projects |
| Search and reopen | Search returned that note; opening it showed the captured body |
| Edit and reload | Edited its text, saved, refreshed, and found the edited body again |
| Latest-note regression | Corrected the initial pinned fixture behavior; Today then displayed the newly captured note |
| Task completion | Completing the sample Open Sesame task changed the displayed completed count from 1/3 to 2/3 |
| Widget installation | Adding World clock changed the installed count and made its card appear on Today |
| Widget removal | Removing World clock through the corrected semantic switch showed it as off and restored the installed count to four |
| Focus | Selected 15 minutes, started, reloaded, and observed a running timer with Pause session; pause restored Resume focus |
| Console | Explicit demo/disconnected labels rendered; a suggestion produced a scripted response and no tool execution |
| Narrow layout | Both frame bodies had `scrollWidth === clientWidth`: 390 and 320 respectively |
| Compact capture | Capture sheet fit the compact viewport and remained scrollable; corrected duplicate sheet scrollbars |
| Compact focus | Reduced the ring/spacing at short viewport heights; Begin focus and reset were visible above bottom navigation at 320 × 640 |
| Reset | Confirmation appeared; resetting restored sample content, four widgets, a 25-minute idle timer, and an empty demo conversation |
| Export | Implemented but download completion remains unverified: browser download-event observation timed out. No downloaded-file success is claimed |

Browser diagnostic output contained extension-origin metadata errors; those were not attributed to app code. No native GUI, actual mobile keyboard, VoiceOver/TalkBack, installed iOS/Android app, live WorkOS sign-in, provider playback, Coven daemon connection, pairing, network transport, or background notification was tested.

The final app was left at its clean Today screen. The inspection-only responsive fixture is excluded from the source package. Source code, README, and this report are included. No production repository, release, or deployment was changed.


## Version 0.2 visual refinement

The typography and visual layer were refined without changing application state, storage keys, task actions, timer logic, or familiar behavior. Embedded EB Garamond regular/italic and Inter 300/400/500/600 replace the prior system-font-only treatment. The new presentation covers all five destinations, dialogs, collection rows, task rows, buttons, and navigation.

The final `npm run check` command passed all 12 existing checks. These are regression checks for the existing behavior, not a complete visual or accessibility audit. Current Chromium observations covered Today, Projects, Widgets, Console, Focus, and the capture sheet. At 390 × 844 and 320 × 640, body scroll widths equaled viewport widths. The compact Focus action remained visible above the navigation. No real iPhone/Android hardware or mobile screen reader was tested in this pass.

The design source and font licenses are included in the updated package. The previously recorded export-download limitation remains unverified. Existing demo data and local storage are preserved when replacing the HTML at the same browser origin.


## Version 0.3 OpenCoven identity pass

`npm run theme` embedded the pinned crown/lotus asset; `npm run check` passed all 12 existing checks (exit 0). Subsequent edits only adjusted CSS and documentation. The source mark's path/transform were compared with the embedded symbol and matched. Its source commit and checksum are recorded in `design/brand/PROVENANCE.md`.

Chromium review covered the updated Today, Projects, Focus, and Console surfaces. The 320 px header's wordmark and search control did not overlap; body width was 320 px. At 390 × 844, the Focus action ended at 712.36 px with navigation starting at 768 px; at 320 × 640 it ended at 532.88 px with navigation starting at 564 px. The doorway illustration remained clear of the home heading. At compact width, selecting Cody and Nova updated the selected state and heading; Cody's large seal rendered C. The sample selection was restored to Kitty. Demo/disconnected wording remained explicit.

The final Today/Console capture shows the canonical mark, doorway motif, note detail, violet markers, and familiar seals. Test fixtures are excluded from the source package. This was a visual refinement of the existing prototype; native mobile devices and screen readers were not tested, and the earlier export-download verification limitation remains.
