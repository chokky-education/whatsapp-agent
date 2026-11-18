# Warroom Horizon UI Bento + Cozy Café Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an isolated Warroom prototype at `http://127.0.0.1:4174/horizon` pairing Horizon UI's Bento Admin Dashboard layout (`201:1804` / `201:2947`) with Cozy Café Light/Dark/High-Contrast design tokens and animated evidence-honest charts.

**Architecture:** Three focused files (`docs/prototypes/warroom-horizon.html`, `warroom-horizon.css`, `warroom-horizon.js`) registered in `docs/prototypes/serve-warroom.mjs`. Reuses synthetic `protocol.js`-shaped scenarios, self-hosted `Room` Thai fonts, Flaticon Uicons, and inline SVG charts/icons without touching `warroom/` production or `src/` bot code.

**Tech Stack:** Vanilla HTML5, CSS Custom Properties + Bento Grid/Flex + SVG/CSS animations, Vanilla browser JS, Node.js preview allowlist server.

**Spec:** [docs/superpowers/specs/2026-11-16-warroom-horizon-cozy-design.md](../specs/2026-11-16-warroom-horizon-cozy-design.md)

## Global Constraints

- Serve only from `docs/prototypes/serve-warroom.mjs` explicit allowlist (`127.0.0.1:4174`); never alter `warroom/`, `src/`, `data/`, `.env`, `/health`, or `/cozy`.
- Self-hosted assets only: `/fonts/thai-{3,5,6}.woff2`, `/assets/flaticon-uicons.woff2` (with Flaticon attribution), and inline SVGs. Zero temporary Figma URLs or external CDNs.
- Cozy Café tokens only (`#F7F3EC`, `#FFFDF9`, `#EFE9DF`, `#2C241E`, `#6B5E54`, `#00704A`, `#9B6436`, `#9A541C` and Evening Roast dark `#1B1613`, `#251F1B`, `#4CA882`, `#D49B6A`). Never use Horizon UI's `#4318FF`/`#7551FF` purples or `Upgrade to PRO` / `Starbucks` cards.
- Preserve evidence separation (`protocol.js`) and `AGENTS.md` fake-data rules (`Nok`, `Somchai`, `Ploy`).
- Support `prefers-reduced-motion: reduce`, `prefers-contrast: more`, safe-area insets, and keyboard navigation.

## Review Focus

1. **`empty` and `stale` scenarios across all 5 Bento charts/cards:** Must never fabricate uptime lines, traffic bars, or active percentages; `empty` renders clean awaiting-telemetry placeholders and `stale` clearly labels aged snapshots.
2. **Search filter (`#search-input` in floating top pill):** Typing a keyword (e.g. `สรุป` or `image`) must live-filter rows in the Complex Table and History view, and show a friendly no-match row when empty without crashing selection state.
3. **Dark Mode (`[data-theme="dark"]` & top-pill moon toggle):** All Horizon Bento shadows, soft icon wells, floating pill inputs, capsule tracks, and pie/line contrasts remain legible against `#1B1613` / `#251F1B`.
4. **Responsive collapse (`1440px` → `1050px` → `390px`):** Top 5 KPI cards, 2-col/3-col Bento rows, floating utility pill, and Complex Table must adapt/scroll inside `.table-wrap` with zero page-level horizontal overflow (`scrollWidth <= innerWidth`).
5. **Cross-linking & Admin/Member role flows:** Clicking a Complex Table row or Rhythm dot updates the selected capability detail card; clicking Bell/`+` jumps to Alerts/Members; Timed Pause banner and last-admin protection work identically to `/cozy`.

---

### Task 1: Register `/horizon` assets in `docs/prototypes/serve-warroom.mjs`

**Files:**
- Modify: `docs/prototypes/serve-warroom.mjs:6-12`

- [ ] **Step 1: Add `/horizon`, `/warroom-horizon.css`, and `/warroom-horizon.js` to the `assets` `Map` in `docs/prototypes/serve-warroom.mjs`**
- [ ] **Step 2: Run `node --check docs/prototypes/serve-warroom.mjs`**
Expected: exit code 0.

---

### Task 2: Author Horizon Bento + Cozy Café Stylesheet (`docs/prototypes/warroom-horizon.css`)

**Files:**
- Create: `docs/prototypes/warroom-horizon.css`

- [ ] **Step 1: Define `@font-face` (`Room` + `Flaticon`) and Cozy Café Light/Dark/High-Contrast tokens with Horizon Bento radii (`20px` cards, `30px` top pill) and warm shadows (`14px 17px 40px 4px rgba(44, 36, 30, 0.06)`)**
- [ ] **Step 2: Style Horizon `290px` sidebar with hairline divider, icon nav buttons, and `4px` right-edge active indicator pill (`inset` / `right: 0`), plus header breadcrumb + floating top utility pill (`#search-input`, icon buttons, avatar)**
- [ ] **Step 3: Style 5-card KPI Bento row, 2-col chart row (smooth line + floating pill badge `#rhythm-float-badge` + vertical capsule bars), 3-col mid row (Complex Table with progress bars, Daily Traffic vertical capsule bars, Pie/Donut + divided 2-stat footer), bottom row (Detail+Guidance, Recent Events checklist, Team Members card), sub-views, dialog, responsive breakpoints (`1200px`, `1050px`, `700px`, `360px`), and `prefers-reduced-motion: reduce`**

---

### Task 3: Author Semantic HTML Shell (`docs/prototypes/warroom-horizon.html`)

**Files:**
- Create: `docs/prototypes/warroom-horizon.html`

- [ ] **Step 1: Build semantic layout with `.demo` bar (`#scenario`, `#role`, `#theme`), `290px` `<aside>` (`4` working nav tabs + account foot), top `<header>` with breadcrumb (`#breadcrumb`), `<h1>` (`#page-title`), and Horizon floating `.misc-pill` (`#search-input`, `#quick-alerts`, `#quick-theme`, `#quick-help`, `#avatar-badge`)**
- [ ] **Step 2: Populate `#view-overview` Bento rows (`#kpi-grid`, `#rhythm-card`, `#capsule-card`, `#complex-table-body`, `#traffic-card`, `#pie-card`, `#detail-card`, `#recent-card`, `#team-card`), plus `#view-history`, `#view-settings`, `#view-members`, `#pause-banner`, Flaticon footer, and actionable `#dialog`**

---

### Task 4: Implement Interactive Horizon Bento Logic & Animated Charts (`docs/prototypes/warroom-horizon.js`)

**Files:**
- Create: `docs/prototypes/warroom-horizon.js`

- [ ] **Step 1: Define synthetic `ITEMS`, `SCENARIOS` (`problem`, `healthy`, `stale`, `empty`, `ai`), `membersList`, and `auditLog` shaped like `protocol.js`**
- [ ] **Step 2: Implement animated renderers: `renderKpis`, `renderRhythmCard` (smooth SVG line + floating pill tooltip badge + hatched gaps + dot click cross-link), `renderCapsuleBars` (5 vertical animated capsule bars), `renderComplexTable` (filterable by `#search-input` + clickable rows), `renderDailyTraffic` (vertical pill bars), `renderPieCard` (donut/pie + 2-stat divider box)**
- [ ] **Step 3: Implement `renderDetailCard`, `renderRecentCard`, `renderTeamCard`, `renderHistoryView` (also respects `#search-input`), `renderSettingsView` (timed pause + audit log), `renderMembersView` (last-admin guard), top-pill quick buttons, and guidance `#dialog`**
- [ ] **Step 4: Run `node --check docs/prototypes/warroom-horizon.js`**
Expected: exit code 0.

---

### Task 5: Browser Verification, Test Suite, Index Refresh & Handoff

**Files:**
- Modify: `HANDOFF.md`, `scripts/index.mjs` (`ROUTES`)
- Regenerate: `INDEX.md`

- [ ] **Step 1: Verify HTTP 200 on `/horizon`, `/warroom-horizon.css`, `/warroom-horizon.js` from `http://127.0.0.1:4174`**
- [ ] **Step 2: Verify `/horizon` in browser at `1440x900` Light & Dark and `390x844` Mobile: all 5 scenarios, `#search-input` live filtering, Complex Table row selection, Rhythm floating badge click, Quick Theme/Alerts/Help buttons, Timed Pause banner, Members last-admin guard, and zero horizontal overflow / console errors**
- [ ] **Step 3: Run `npm test`, `npm run warroom:test`, `node scripts/index.mjs refresh`, `git diff --check`, and update `HANDOFF.md` + `second-brain`**
