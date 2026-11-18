# Warroom Cozy Design Tokens & Animated Graphs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an isolated synthetic Warroom prototype at `http://127.0.0.1:4174/cozy` featuring a Cozy Café design token system (Light, Dark, High Contrast) and three evidence-honest animated SVG/CSS graphs.

**Architecture:** Split the `/cozy` prototype into three focused files (`warroom-cozy.html`, `warroom-cozy.css`, `warroom-cozy.js`) served through the explicit allowlist in `docs/prototypes/serve-warroom.mjs`. All data stays strictly synthetic and shaped like `warroom/src/protocol.js`, reusing self-hosted `Room` Thai fonts and Flaticon Uicons without touching production `warroom/` or bot `src/` files.

**Tech Stack:** Vanilla HTML5, CSS Custom Properties + SVG keyframe/transition animations, Vanilla ESM/browser JS, Node.js `serve-warroom.mjs` preview server.

**Spec:** [docs/superpowers/specs/2026-11-16-warroom-cozy-design.md](../specs/2026-11-16-warroom-cozy-design.md)

## Global Constraints

- Serve only from `docs/prototypes/serve-warroom.mjs` explicit `assets` allowlist on `127.0.0.1:4174`; never modify `warroom/` production code, `src/`, `data/`, `.env`, or `/health`.
- Use zero third-party CDNs or external fonts: load `/fonts/thai-{3,5,6}.woff2` and `/assets/flaticon-uicons.woff2` locally, preserving Flaticon attribution in the footer.
- Zero Starbucks logos, Siren artwork, or trademarks; use only the Cozy Café color/material/editorial palette (`#00704A`, `#F7F3EC`, `#FFFDF9`, `#EFE9DF`, `#2C241E`, `#6B5E54`, `#A67246`).
- Preserve evidence honesty: distinguish machine contact, WhatsApp connection, send completion, and delivery ACK; show unobserved intervals as dashed/hatched gaps; never fabricate continuous uptime percentages.
- Public repo rule: synthetic names/models/times only (`Nok`, `example-text-model`, `example-response-model`).
- Honor `prefers-reduced-motion: reduce` (disable path draw, bar transitions, and heartbeat pulse), `prefers-contrast: more`, safe-area insets, and keyboard navigation.

## Review Focus

1. **`empty` and `stale` scenarios on animated graphs:** Must not draw solid connected uptime curves or fake queue percentages; `empty` shows an explicit awaiting-first-telemetry placeholder and `stale` renders muted/dashed older points with stale labels.
2. **Dark mode (`data-theme="dark"` and `prefers-color-scheme: dark`) contrast:** Café green `#00704A` is too dark on `#251F1B`; must switch cleanly to `#4CA882` / `#5AC095` and preserve ≥ 4.5:1 text contrast and ≥ 3:1 chart stroke contrast.
3. **Narrow mobile viewport (`390px` and `360px`) & SVG responsiveness:** Graphs and sticky detail panel must stack cleanly without horizontal page overflow (`scrollWidth <= innerWidth`), and chart tooltips must stay inside card bounds.
4. **Keyboard & screen-reader parity on animated charts:** Rhythm chart event dots and 5-capability bars/cards must be reachable via Tab/Enter/Space with `aria-pressed`, visible focus rings, and `aria-live` updates.
5. **`prefers-reduced-motion: reduce`:** All SVG `stroke-dashoffset` animations, bar width transitions, and live pulse rings must settle immediately in their final readable state without motion.

---

### Task 1: Expose `/cozy` assets in `serve-warroom.mjs`

**Files:**
- Modify: `docs/prototypes/serve-warroom.mjs:4-13`

**Interfaces:**
- Produces HTTP GET routes `/cozy`, `/warroom-cozy.css`, `/warroom-cozy.js` in the `assets` `Map`.

- [ ] **Step 1: Add `/cozy`, `/warroom-cozy.css`, and `/warroom-cozy.js` entries to the `assets` map in `docs/prototypes/serve-warroom.mjs`**

Map `/cozy` → `./warroom-cozy.html` (`text/html; charset=utf-8`), `/warroom-cozy.css` → `./warroom-cozy.css` (`text/css; charset=utf-8`), and `/warroom-cozy.js` → `./warroom-cozy.js` (`text/javascript; charset=utf-8`). Leave all existing routes untouched.

- [ ] **Step 2: Run syntax check on `docs/prototypes/serve-warroom.mjs`**

Run: `node --check docs/prototypes/serve-warroom.mjs`
Expected: exit code 0, no output.

---

### Task 2: Author Cozy Café Design Tokens & Layout Stylesheet (`warroom-cozy.css`)

**Files:**
- Create: `docs/prototypes/warroom-cozy.css`

**Interfaces:**
- Consumes `/fonts/thai-{3,5,6}.woff2`, `/assets/flaticon-uicons.woff2`.
- Produces CSS custom properties (`--bg`, `--surface`, `--surface-stone`, `--surface-wood`, `--text`, `--secondary`, `--border`, `--accent`, `--accent-soft`, `--wood`, `--ok`, `--ok-bg`, `--warning`, `--warning-bg`, `--unknown`, `--unknown-bg`, `--focus`, `--shadow-warm`), layout classes (`.demo`, `.shell`, `.overview`, `.evidence`, `.guidance`, `.graphs-grid`, `.rhythm-card`, `.queue-card`, `.capability-workspace`, `.capabilities`, `.cap`, `.details`, `.facts`, `.history`, `.footer`, `dialog`), state rules (`body[data-state=healthy|problem|ai|stale|empty]`), theme selectors (`:root`, `@media(prefers-color-scheme:dark)`, `:root[data-theme=dark]`, `:root[data-theme=light]`, `@media(prefers-contrast:more)`), and graph keyframe animations (`@keyframes drawLine`, `@keyframes growBar`, `@keyframes pulseDot`, `@keyframes drawRing`) gated by `@media(prefers-reduced-motion:reduce)`.

- [ ] **Step 1: Define font-faces, Flaticon Uicons glyph classes, and Light/Dark/High-Contrast Cozy Café token variables in `docs/prototypes/warroom-cozy.css`**

Include `:root` (Light Oat & Café Linen), `:root[data-theme="dark"]` and `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` (Evening Roastery), plus `@media (prefers-contrast: more)` overrides for both light and dark.

- [ ] **Step 2: Implement responsive shell, cozy card geometry, evidence grid, capability workspace, and dialog styles**

Keep 256px sidebar on desktop, 2-column compact nav on mobile (`max-width: 700px`), safe-area insets (`env(safe-area-inset-*)`), `tabular-nums`, sticky `.details` panel on desktop, and `44px` minimum touch targets on interactive buttons.

- [ ] **Step 3: Implement graph container styles and CSS/SVG animation keyframes with `prefers-reduced-motion: reduce`**

Style the 2-column `.graphs-grid` (wide AI rhythm curve + compact queue ring card on desktop; single column under `1000px`), interactive tooltip box `.chart-tooltip`, hatched unknown-interval pattern fill, animated horizontal `.cap-bar-fill` inside capability rows, and `.pulse-dot` next to timestamp. Ensure `prefers-reduced-motion: reduce` disables all animations/transitions.

---

### Task 3: Author Semantic HTML Shell (`warroom-cozy.html`)

**Files:**
- Create: `docs/prototypes/warroom-cozy.html`

**Interfaces:**
- Consumes `/warroom-cozy.css` and `/warroom-cozy.js`.
- Produces DOM hooks: `#scenario`, `#theme`, `#updated`, `#pulse`, `#overview-title`, `#overview-description`, `#symbol`, `#evidence`, `#advice-title`, `#advice-description`, `#advice-button`, `#rhythm-chart`, `#rhythm-legend`, `#rhythm-tooltip`, `#queue-ring`, `#queue-legend`, `#capabilities`, `#details`, `#dialog`, `#dialog-description`, `#steps`, `#close`.

- [ ] **Step 1: Write `docs/prototypes/warroom-cozy.html` with Thai semantic landmarks, demo controls (`#scenario`, `#theme`), 256px sidebar, overview section, 2-card Animated Graphs section, capability workspace, history `<details>`, Flaticon footer, and guidance `<dialog>`**

Keep all copy in Thai matching `AGENTS.md`, mark prototype/synthetic nature clearly in `.demo` and footer, and verify every interactive element has accessible labels (`aria-label`, `aria-live="polite"`, `aria-describedby`).

---

### Task 4: Implement Synthetic Scenarios & Animated SVG/CSS Graph Rendering (`warroom-cozy.js`)

**Files:**
- Create: `docs/prototypes/warroom-cozy.js`

**Interfaces:**
- Consumes DOM hooks defined in `warroom-cozy.html`.
- Produces `render()`, `renderRhythmChart(state)`, `renderQueueRing(state)`, `renderCapabilities(state)`, `renderDetails(state, item)`, `applyTheme(mode)`, and event listeners for `#scenario`, `#theme`, `#advice-button`, `#close`, plus SVG point focus/hover tooltips.

- [ ] **Step 1: Define synthetic `SCENARIOS` (`problem`, `healthy`, `stale`, `empty`, `ai`), `CAPABILITIES` (5 items matching `protocol.js`), and `buildRhythmPoints(key)` with explicit gap intervals**

Include realistic synthetic `durationMs`, queue counts (`main`, `media`, `render`), provider (`OpenAI`), requested/response model (`example-text-model` / `example-image-model`, `example-response-model` or unconfirmed for image render), and gap markers (`gap: true`) so unobserved periods render dashed/hatched.

- [ ] **Step 2: Implement SVG path smoothing, animated `stroke-dashoffset` calculation, interactive point buttons for keyboard/mouse tooltip inspection, animated queue donut ring, and capability bar transitions**

Use `requestAnimationFrame` / forced reflow cleanly to replay graph draw animations whenever `#scenario` changes (skipped automatically if `window.matchMedia('(prefers-reduced-motion: reduce)').matches`). Escape or avoid innerHTML injection for any dynamic text where `textContent` suffices.

- [ ] **Step 3: Implement theme switcher (`auto` / `light` / `dark`), capability selection focus preservation, and guidance `<dialog>` steps**

Run: `node --check docs/prototypes/warroom-cozy.js`
Expected: exit code 0, no syntax errors.

---

### Task 5: Live Preview Restart/Check, Visual & Interactive Verification, Test Suite & Handoff

**Files:**
- Modify: `HANDOFF.md`
- Regenerate: `INDEX.md` (via `node scripts/index.mjs refresh`)
- Update: `scripts/index.mjs` (`ROUTES` already covers `docs/prototypes/`, verify `/cozy` files appear in `INDEX.md`)

- [ ] **Step 1: Check existing preview listener on port 4174 and restart cleanly if needed so `/cozy` assets are served**

Verify HTTP 200 on `/cozy`, `/warroom-cozy.css`, `/warroom-cozy.js`, `/fonts/thai-3.woff2`, `/assets/flaticon-uicons.woff2` from `http://127.0.0.1:4174`.

- [ ] **Step 2: Verify `/cozy` in headless/webview browser across all Review Focus cases**

Check:
1. Desktop (`1440x900`) and mobile (`390x844`) in Light and Dark themes — zero horizontal overflow (`scrollWidth <= innerWidth`), zero console/page errors.
2. All 5 scenarios (`problem`, `healthy`, `stale`, `empty`, `ai`) render distinct status, evidence, rhythm chart curves/gaps, queue ring, and capability bars.
3. Clicking/focusing rhythm chart event dots updates the tooltip; clicking each of the 5 capabilities updates `#details`; clicking `#advice-button` opens `<dialog>` and `#close` / Escape closes it.
4. `prefers-reduced-motion: reduce` settles charts visibly without motion.

- [ ] **Step 3: Run repository test suites and index refresh**

Run:
- `npm test`
- `npm run warroom:test`
- `node scripts/index.mjs refresh`
- `git diff --check`

Expected: all existing tests pass (64 bot + 16 warroom), index refreshed with `warroom-cozy.*`, zero whitespace errors.

- [ ] **Step 4: Update `HANDOFF.md` and `second-brain` entry (when work is complete)**

Update `HANDOFF.md` Status/In progress/Log with verified facts only; record a concise Thai `decision` entry in `~/second-brain`. Do not commit unless user asks.
