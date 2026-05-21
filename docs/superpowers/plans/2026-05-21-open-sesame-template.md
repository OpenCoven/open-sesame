# Open Sesame Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a stripped-down native macOS app shell template from the durable previewer concept.

**Architecture:** Use Swift Package Manager with a testable `OpenSesameCore` target and a native `OpenSesameApp` executable target. Keep the app generic: catalog, sidebar, browser chrome, `WKWebView`, reload, and open-in-browser.

**Tech Stack:** Swift 6, SwiftUI, AppKit, WebKit, Swift Testing.

---

### Task 1: Package and Core Tests

**Files:**
- Create: `Package.swift`
- Create: `Tests/OpenSesameCoreTests/SiteCatalogTests.swift`

- [x] **Step 1: Write failing tests for site validation and catalog behavior**
- [x] **Step 2: Run `swift test` and verify target/model failure**

### Task 2: Core Model

**Files:**
- Create: `Sources/OpenSesameCore/PortalSite.swift`
- Create: `Sources/OpenSesameCore/SiteCatalog.swift`

- [x] **Step 1: Add `PortalSite` with name/label trimming and HTTP(S) URL validation**
- [x] **Step 2: Add `SiteCatalog` with default site and selection behavior**
- [x] **Step 3: Run `swift test` and verify tests pass**

### Task 3: macOS Shell

**Files:**
- Create: `Sources/OpenSesameApp/OpenSesameApp.swift`
- Create: `Sources/OpenSesameApp/ShellView.swift`
- Create: `Sources/OpenSesameApp/BrowserWebView.swift`

- [x] **Step 1: Add SwiftUI app entry point**
- [x] **Step 2: Add sidebar and browser chrome**
- [x] **Step 3: Add `WKWebView` wrapper**
- [x] **Step 4: Run `swift build` and verify app target compiles**

### Task 4: Template Documentation

**Files:**
- Create: `README.md`
- Create: `.gitignore`
- Create: `docs/superpowers/specs/2026-05-21-open-sesame-template-design.md`
- Create: `docs/superpowers/plans/2026-05-21-open-sesame-template.md`

- [x] **Step 1: Document source review and intentional omissions**
- [x] **Step 2: Document run/test commands and template extension points**
