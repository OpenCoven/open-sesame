# Processes and Media Cleanup Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task in this session.

**Goal:** Apply the approved simplification to Processes and Local media.

**Architecture:** Keep the existing process renderer and native action boundaries. Add a small media transport using the current HTML video element and shared volume adapter; retain a native fullscreen fallback.

**Tech Stack:** Plain JavaScript, CSS, Node checks, Playwright fixture, Python unified Mac verifier.

**Spec:** [Approved design](../specs/2026-11-08-processes-media-cleanup.md).

## Global Constraints

Preserve existing functionality, task/process safety, playback state and user data. Publication follows the session authority; installed-app replacement remains separate.

## Review Focus

Keyboard access to disclosures and Escape; stale process tokens and stop confirmation; unknown media duration; paused/live seek and volume; file-import and queue state during resize.

### Task 1: Compact Processes

- [x] Add regression assertions to the existing process fixture for one layout selector and reachable secondary actions; run red.
- [x] Modify `dist/agent-monitor.js` to expose layout as a select, group filters/history into a disclosure, and move pause/stop/details into a per-row Actions disclosure with Escape handling. Keep terminal action direct.
- [x] Add compact list/table styling in `dist/process-workspace.css` and verify all five existing layouts and action safety checks.

### Task 2: One Local media transport

- [x] Write `scripts/check-media-transport.mjs` to check play/pause, seek, live-duration refusal, fullscreen fallback, clear, and shared volume updates; run red.
- [x] Add `dist/media-transport.js`, update `dist/media-drop.js` and `dist/media-gallery.css`: one bottom playback bar; native video controls only in fullscreen; header file access and an empty/drag-only hint. Preserve all existing imports and playlist controls.
- [x] Run model/controller checks and actual authored UI fixtures with synthetic media and provider data at compact/full sizes.

### Task 3: Qualification

- [x] Refresh changed asset hashes and navigation docs, run `npm run check` and `npm run verify`.
- [x] Review the full diff and rendered screenshots, preserve first failures and task receipts, and leave a durable handoff.

## Qualification boundaries

Keep source checks, generated-media browser fixtures, Mac compilation and installed-app acceptance distinct. Real native fullscreen, live process signals, provider access and user media require their corresponding runtime evidence. Store exact source fingerprints, original failures and task handoffs in common-Git receipts.
