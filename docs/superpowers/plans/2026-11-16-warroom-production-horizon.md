# Warroom Horizon UI Production Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the user-approved Horizon Bento + Cozy Café design (`http://127.0.0.1:4174/horizon`) and its 4 backend-real, RBAC-aware charts into production `warroom/public/` connected to live Worker APIs under strict Content-Security-Policy.

**Architecture:** Extract pure data-adaptation helpers into `warroom/public/view-model.js` (so unit tests verify exact millisecond timestamp math, `snapshot.connection`/`activity`/`queues`/`models`, `status.calls`, and `admin` vs `team` masking offline without a browser), replace `warroom/public/index.html`, `style.css`, and `app.js` with the Cozy Café Horizon Bento UI + Google Sign-In shell while applying dynamic bar/ring styles strictly via CSS classes and DOM CSSOM properties (no HTML `style="..."` attributes under strict `style-src 'self'`), and verify end-to-end against real `worker.fetch` security headers via `node warroom/dev.mjs`. Production backend logic (`worker.js`, `monitor.js`, `auth.js`, `protocol.js`) and `src/` bot runtime remain untouched.

**Tech Stack:** Native ESM browser JS, vanilla CSS custom properties (Light/Dark/High-Contrast), inline SVG charts, Google Identity Services, Node.js `node:test` + SQLite Worker test harness (`warroom/test/`), Cloudflare Workers Direct Asset Upload (`warroom/build.mjs`, `warroom/deploy.mjs`).

**Spec:** [2026-11-16-warroom-horizon-cozy-design.md](file:///Users/chalisa/Whatsapp%20agent/docs/superpowers/specs/2026-11-16-warroom-horizon-cozy-design.md)

## Global Constraints

- **Backend schema fidelity:** All API timestamps are **unix milliseconds (`Date.now()`)**, NOT seconds; `snapshot.connection.state` uses `"starting" | "connected" | "disconnected" | "pairing" | "logged_out" | "replaced"`; message evidence uses `snapshot.activity.{inbound,sent,delivered}`; error keys use `ERRORS`; user role uses `"admin" | "team"`.
- **Strict CSP (`warroom/src/worker.js:29`):** `"content-security-policy"` sets `script-src 'self' https://accounts.google.com/gsi/client; style-src 'self' https://accounts.google.com/gsi/style; font-src 'self'; img-src 'self' data:`. Do NOT weaken CSP in `worker.js` and do NOT emit `style="..."` HTML attributes or inline `<script>` tags anywhere in `warroom/public/`.
- **CSRF & auth safety:** Keep existing `/api/login`, `/api/logout`, `/api/session`, `x-csrf-token` header on all mutating calls, `#demo-banner` when `user.demo === true`, and `.admin-only` UI gating (`hidden = user.role !== "admin"`).
- **Zero external assets:** Self-hosted `WarroomThai` (`/fonts/thai-*.woff2`) and Flaticon Uicons (`/assets/flaticon-uicons.woff2` + visible attribution + `FLATICON-LICENSE.txt`).
- **Public repo privacy (`AGENTS.md`):** Use synthetic data (`Nok`, `Somchai`, `nok@example.com`, `100000000000001@lid`) only in tests/docs; never print or commit `warroom/.deployment.local.json`, `data/`, `.env`, or Cloudflare tokens.
- **Explicit deploy gate:** Run `npm run warroom:build`, `npm test`, `npm run warroom:test`, and local `node warroom/dev.mjs` verification; only run `node warroom/deploy.mjs --apply --wrangler-auth` if explicitly approved by the user.

## Review Focus

- **Strict CSP blocking HTML `style="..."` attributes:** In Chromium/Safari under `style-src 'self'`, `innerHTML` fragments containing `style="height:40%"`, `style="width:65%"`, `style="color:..."`, or `style="--ring-offset:..."` fail silently even though `serve-warroom.mjs` allowed them. *Pinned by static assertion in Task 4 + live `worker.fetch` CSP check in Task 5.*
- **Millisecond vs second timestamp conversion & schema keys:** Mixing up prototype unix seconds (`13:20` helper) or mock `whatsapp`/`lastSend` fields with production epoch ms (`Date.now()`), `snapshot.connection`, and `snapshot.activity` would show `1970` dates or blank cards. *Pinned by unit tests against `warroom/test/support.js` `snapshot(Date.now())` in Task 2.*
- **History pagination & 7-hour bucket accuracy under shared timestamps:** Overview uses the newest batch from `/api/history` while History tab must paginate via `?before=...&cursor=...` without dropping events or resetting filters. *Pinned by pagination state tests in Task 2 & browser verification in Task 5.*
- **Auto-refresh 401 session expiry & transient network failure handling:** 30-second background polling hitting `401` must halt polling cleanly and show `#login`, while network failures keep `lastStatus` visible with `stale` styling and show `#feedback` cleanly. *Pinned by controller error-state test / local server demo verification in Task 4–5.*
- **Admin vs Team RBAC masking & last-admin 409 guard:** `team` role receives `calls: undefined`, masked `history.events`, and `403` on `/api/members` or `/api/audit`; admin UI disables buttons during `member_set`/`member_remove`/`pause` mutations and translates `last_admin` (`409`) to Thai without leaving broken spinners. *Pinned by Task 2 RBAC viewmodel tests + Task 5 `demo_role=team` browser run.*

---

### Task 1: Bundle Self-Hosted Icon Font, Attribution, and Cozy Favicon

**Files:**
- Create: `warroom/public/assets/flaticon-uicons.woff2` (copied from `docs/prototypes/assets/flaticon-uicons-regular-rounded-3.3.1.woff2`)
- Create: `warroom/public/assets/FLATICON-LICENSE.txt` (copied from `docs/prototypes/assets/FLATICON-LICENSE.txt`)
- Modify: `warroom/public/favicon.svg` (update fill from `#175e4f` to Cozy Café `--accent` `#00704A`)

**Interfaces:**
- Produces: Static URLs `/assets/flaticon-uicons.woff2`, `/assets/FLATICON-LICENSE.txt`, `/favicon.svg`, and existing `/fonts/thai-0..8.woff2`.

- [ ] **Step 1: Verify `deploy.mjs` and `dev.mjs` support `.woff2` and `.txt` static assets**

Inspect `warroom/deploy.mjs:94-101` (already maps `.woff2` -> `font/woff2` and `.txt` -> `text/plain; charset=utf-8`) and `warroom/dev.mjs:65-73` (falls back to `text/plain` for `.txt` and `font/woff2` for `.woff2`). Ensure `deploy.mjs` requires zero edits.

- [ ] **Step 2: Copy licensed Flaticon Uicons font + license into `warroom/public/assets/`**

```bash
mkdir -p warroom/public/assets
cp docs/prototypes/assets/flaticon-uicons-regular-rounded-3.3.1.woff2 warroom/public/assets/flaticon-uicons.woff2
cp docs/prototypes/assets/FLATICON-LICENSE.txt warroom/public/assets/FLATICON-LICENSE.txt
```

- [ ] **Step 3: Update `warroom/public/favicon.svg` to Cozy Café espresso-green accent**

Update `fill="#175e4f"` -> `fill="#00704A"` in `warroom/public/favicon.svg` to match `<meta name="theme-color" content="#00704A" />`.

- [ ] **Step 4: Verify all asset files exist on disk cleanly**

Run: `ls -lh warroom/public/assets/ warroom/public/favicon.svg`
Expected: `flaticon-uicons.woff2` (~385 KB), `FLATICON-LICENSE.txt`, and `favicon.svg` present cleanly.

---

### Task 2: Backend View-Model Adapters with TDD (`warroom/public/view-model.js`)

**Files:**
- Create: `warroom/public/view-model.js`
- Create: `warroom/test/ui-model.test.js`

**Interfaces:**
- Consumes: Real backend JSON from `GET /api/status` and `GET /api/history` (`warroom/src/worker.js:115-156, 248-266`), plus `CAPABILITIES`, `QUEUES`, `CONNECTIONS`, `ERRORS` semantics (`warroom/src/protocol.js`).
- Produces: Pure browser+Node-importable ES module exporting:
  - `CAPABILITY_META` (ordered 5 capabilities with Thai `name`, `short`, `queueKey`, `queueLabel`, `icon`)
  - `formatBkkHm(ms)`, `formatBkkTime(ms)`, `formatBkkDateTime(ms)`, `formatSec(ms)`, `formatAge(ageMs)`, `formatShortAge(ageMs)`
  - `translateIncident(incident)`, `translateEvent(ev, isAdmin)`
  - `aggregateCapabilities(status)` (derives per-capability counts, `avgMs`, `latestDurationMs`, `lastAt`, `lastResult`, `provider`, `requestedModel`, `responseModel`, marking uncalled as `count: 0`)
  - `bucketHourlyEvents(events, nowMs, hours = 7)` (7 hourly Bangkok slots stacking `ok` vs `err` from real events)
  - `summarizeQueues(queues, nowMs)` (`waitingTotal`, `runningTotal`, `inFlightTotal`, `oldestAt`, `byName`)

- [ ] **Step 1: Write failing unit tests in `warroom/test/ui-model.test.js`**

Import `snapshot` from `./support.js` and functions from `../public/view-model.js` to assert:
1. `formatBkkHm(Date.UTC(2026, 10, 16, 6, 20, 0))` returns `"13:20"` (Bangkok +7h on unix **ms**, catching 1000x unit mismatch).
2. `aggregateCapabilities(adminStatus)` computes per-capability call average from `calls` (`durationMs` in ms) and marks capabilities absent in `calls` as `count: 0, avgMs: null` (never inventing ms or cross-capability average).
3. `aggregateCapabilities(teamStatus)` (where `calls === undefined`) never fabricates `avgMs` or `latestDurationMs` and preserves `snapshot.models[].{lastAt, lastResult, provider, requestedModel, responseModel}`.
4. `bucketHourlyEvents(events, nowMs, 7)` buckets unix ms events accurately across 7 Bangkok clock hours, separating `ai_error` / `send_error` / `render_error` / `job_interrupted` / `connection(disconnected|logged_out|pairing|replaced)` as `err` and masking unknown connection state in `team` mode honestly.
5. `summarizeQueues(s.queues, nowMs)` computes `waitingTotal`, `runningTotal`, `inFlightTotal`, and minimum non-null `oldestAt` across `main`, `media`, `render`.

- [ ] **Step 2: Run test to verify it fails cleanly**

Run: `node --test warroom/test/ui-model.test.js`
Expected: FAIL (`ERR_MODULE_NOT_FOUND` for `../public/view-model.js`).

- [ ] **Step 3: Implement `warroom/public/view-model.js`**

Implement pure exported functions with explicit fixed Bangkok timezone formatting (`UTC_OFFSET_MS = 7 * 3600_000`) matching `src/config.js` / `AGENTS.md` rule and handling `null`/empty/stale/team-masked edge cases cleanly without touching DOM or global `window`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test warroom/test/ui-model.test.js`
Expected: PASS (5+ assertions, 0 failures).

---

### Task 3: Cozy Café Horizon CSS & Semantic Production HTML (`warroom/public/style.css`, `warroom/public/index.html`)

**Files:**
- Modify: `warroom/public/style.css`
- Modify: `warroom/public/index.html`

**Interfaces:**
- Consumes: CSS class contract from `docs/prototypes/warroom-horizon.css` + `/fonts/thai-0..8.woff2` (`WarroomThai`) + `/assets/flaticon-uicons.woff2` (`Flaticon`), plus CSP-safe SVG ring & login view styles.
- Produces: Semantic HTML containers preserved/aligned for live Auth & Bento views:
  - `#login`, `#google-button`, `#login-message` (Cozy Café login screen shown when unauthenticated)
  - `#shell` with 290px sidebar (`nav` buttons `[data-view]` + `.admin-only` attributes on `members` and `settings`), sidebar footer (`#user-email`, `#user-role`, `#logout`)
  - `#demo-banner`, `#feedback`, top utility pill (`#search-input`, `#quick-alerts` + `#alerts-dot`, `#quick-theme`, `#quick-help`, `#refresh`, `#avatar-badge`)
  - `#pause-banner` (`#pause-banner-title`, `#pause-banner-desc`, `#pause-resume-quick`)
  - View panels (`#view-overview`, `#view-history`, `#view-settings`, `#view-members`)
  - Overview Bento grids (`#kpi-grid`, `#rhythm-card` with `#rhythm-cap-filters`, `#conn-strip`, `#rhythm-summary`, `#rhythm-chart`, `#rhythm-foot`, `#capsule-card`, `#complex-table-body`, `#traffic-card`, `#pie-card`, `#detail-card`, `#recent-events`, `#team-preview`)
  - Footer with live fetch timestamp (`#fetch-time`), privacy reminder, and visible Flaticon Uicons license attribution link (`/assets/FLATICON-LICENSE.txt`)
  - Action guidance dialog (`#dialog`)

- [ ] **Step 1: Update `warroom/public/style.css`**

Adapt `docs/prototypes/warroom-horizon.css` tokens, typography, Bento grid, 4 chart styles, floating utility pill, Light/Dark (`[data-theme="dark"]` & `prefers-color-scheme: dark`), High-Contrast (`prefers-contrast: more`), Reduced Motion, and responsive breakpoints (`1360px`, `1180px`, `1020px`, `780px`, `420px`) cleanly into `warroom/public/style.css`:
1. Keep `WarroomThai` `@font-face` rules pointing to `/fonts/thai-0.woff2`..`thai-8.woff2` (with clean `woff2` format) + `Flaticon` pointing to `/assets/flaticon-uicons.woff2`.
2. Add Cozy Café `#login` layout styles (2-column warm bento card with `#google-button`, `#login-message`, `border-radius: 20px`), `#demo-banner`, `#feedback` (success & error tones), `.admin-only[hidden] { display: none; }`, and `.t-col` / `.capsule-fill` CSP-friendly helper classes (`.is-warn`, `.is-stale`, `.is-empty`, `.is-accent`).
3. Ensure zero external font/CSS URLs anywhere in `style.css`.

- [ ] **Step 2: Update `warroom/public/index.html`**

Replace `warroom/public/index.html` cleanly with the production HTML shell:
- `<meta name="theme-color" content="#00704A" />`, `<link rel="icon" href="/favicon.svg" type="image/svg+xml" />`, `<link rel="stylesheet" href="/style.css" />`, `<script type="module" src="/app.js"></script>`.
- Include `#login`, `#shell`, `#demo-banner`, `#feedback`, `.admin-only` navigation items, Theme toggle (`<select>` / `#quick-theme`), Refresh button (`#refresh`), Search (`#search-input`), Overview Bento grid (`#kpi-grid`, 4 charts, table, detail/events/team), History/Settings/Members sections, Guidance `#dialog`, and footer with `#fetch-time` + Flaticon attribution (`FLATICON-LICENSE.txt`). Zero inline `<script>` or `style="..."` attributes.

- [ ] **Step 3: Verify HTML/CSS contain no inline style attrs or forbidden script patterns**

Inspect via command: `grep -nE 'style=|https?://' warroom/public/index.html warroom/public/style.css` (expect zero matches!).

---

### Task 4: Wire Production Controller & CSP-Safe Rendering (`warroom/public/app.js`)

**Files:**
- Modify: `warroom/public/app.js`
- Create: `warroom/test/ui-csp.test.js`

**Interfaces:**
- Consumes: `warroom/public/view-model.js` helpers + Worker REST endpoints (`/api/login`, `/api/session`, `/api/logout`, `/api/status`, `/api/history`, `/api/members`, `/api/pause`, `/api/audit`).
- Produces: Full live SPA controller with CSP-safe DOM manipulation (never writing `style="..."` attributes into HTML strings).

- [ ] **Step 1: Write failing CSP-safety and wiring check in `warroom/test/ui-csp.test.js`**

Write a Node test reading `warroom/public/index.html`, `warroom/public/style.css`, `warroom/public/app.js`, and `warroom/public/view-model.js` asserting:
1. None of the HTML/JS files embed HTML `style=` attribute strings (`/style\s*=/` or ``style="``), inline `<script>` blocks, or `http://`/`https://` URLs other than `https://accounts.google.com/gsi/client`.
2. `warroom/public/app.js` parses cleanly as an ES module (`node --check`) and does not hardcode prototype mock scenario constants.

- [ ] **Step 2: Run test to verify it fails on legacy/unported files or incomplete checks**

Run: `node --test warroom/test/ui-csp.test.js`
Expected: FAIL before `app.js` & `index.html` updates are finished (or pass only after port cleanly).

- [ ] **Step 3: Implement live `warroom/public/app.js`**

Port all rendering functions cleanly from `docs/prototypes/warroom-horizon.js` + `view-model.js` onto the real API layer preserved from legacy `app.js`:
1. `api(path, options)` with `x-csrf-token: user.csrf`, 12s `AbortSignal.timeout(12000)`, `401 -> login()` handling + clear Thai `errorText(err)`.
2. `boot()` + `login()` using Google Identity Services (`nonce`, `clientId`, `POST /api/login`).
3. `refresh()` (`busy` lock, `#refresh` disabled toggle, parallel `api("/api/status")` + initial `api("/api/history")` for overview so hourly histogram, admin connection strip, and team 2-lane timeline stay live; 30s background poll `if (!document.hidden && activeView === "overview")`). On transient fetch failure, set `apiFailed = true`, display `#feedback`, and re-render `lastStatus` flagged stale.
4. Render KPI cards (`host`, `snapshot.connection`, `snapshot.activity.{sent,delivered,inbound}`, `queues` `waiting`/`running`, `models` summary), incident alert banner when `status.incidents.length > 0`, and pause banner (`data.pause.until > data.now`).
5. Render all 4 backend-real charts + capability table using DOM `el(...)` / SVG creation where dynamic heights, widths, animation delays, and `stroke-dasharray` / `--ring-offset` are set via JS DOM `.style.*` / SVG attributes (zero HTML `style="..."` strings!).
6. Implement `History` tab (filter chips `ทั้งหมด` / `งาน AI` / `การส่งข้อความ` / `การเชื่อมต่อ`, search query filter, and `"โหลดเหตุการณ์ก่อนหน้า"` cursor pagination via `?before=...&cursor=...`), `Settings` tab (real `POST /api/pause`, notification config/outbox counts, `GET /api/audit` table), and `Members` tab (`GET`/`POST`/`DELETE /api/members` with confirmation + `last_admin` `409` handling).
7. Cleanly toggle Light/Dark theme persistence (`localStorage.getItem('warroom_theme')` safely wrapped in try/catch).

- [ ] **Step 4: Run syntax & unit/CSP test suites**

Run: `node --check warroom/public/app.js warroom/public/view-model.js && npm run warroom:test`
Expected: ALL tests in `warroom/test/*.test.js` (16 existing Worker/monitor/telemetry tests + new `ui-model.test.js` + `ui-csp.test.js`) PASS cleanly with 0 failures!

---

### Task 5: Worker Bundle Build, Local Dev Server & Real-CSP Browser Verification

**Files:**
- Modify: `HANDOFF.md`
- Regenerate: `INDEX.md` (via `node scripts/index.mjs refresh`, adding `warroom/public/view-model.js` if needed — verify index routes)

**Interfaces:**
- Consumes: `npm run warroom:build`, `node warroom/dev.mjs` (`http://127.0.0.1:4173`), `npm test`, `npm run warroom:test`.

- [ ] **Step 1: Run build and full automated suites**

Run: `npm run warroom:build && npm test && npm run warroom:test`
Expected: `esbuild` builds `warroom/dist/worker.js` cleanly; all bot tests (64) and Warroom tests (16 + new UI tests) PASS cleanly.

- [ ] **Step 2: Verify live Worker + CSP + `/__demo` flows in built-in browser (`http://127.0.0.1:4173`)**

Start `node warroom/dev.mjs` temporarily as background daemon (stop before concluding unless requested) and inspect `http://127.0.0.1:4173` using the browser subagent:
1. `/__demo?login=1`: verify Cozy Café Google Sign-In screen renders cleanly with no CSP/runtime console errors.
2. `/__demo?state=healthy&role=admin`: verify 5 KPIs, `#conn-strip`, capability filter pills, `#rhythm-chart`, `#capsule-chart`, `#complex-table`, `#traffic-bars`, `#pie-card`, Pause/Audit/Members tabs, Light & Dark themes, and interactive `POST /api/pause` + `POST /api/members` roundtrips against in-memory D1!
3. `/__demo?state=problem&role=admin`: verify disconnected `#conn-strip`, queue backlog (`waiting`/`running`/`oldestAt`), stacked error bars, and guidance dialog.
4. `/__demo?state=problem&role=team`: verify `.admin-only` nav items hidden, `#rhythm-chart` shows 2-lane team timeline without ms, `#capsule-chart` shows status/relative age, table Col 4 shows timestamp + relative age, and `/api/members` cannot be invoked from UI.
5. `/__demo?state=offline&role=admin` & `/__demo?state=empty&role=admin`: verify stale (`ข้อมูลเก่า`) styling and empty onboarding states.
6. Verify desktop `1440x900` & mobile `390x844` have zero horizontal overflow (`scrollWidth <= innerWidth`), zero blocked styles under strict `worker.js` CSP, and inspect captured screenshots via `read_file`.

- [ ] **Step 3: Sync handoff docs and index, verify clean diff, ask before live Cloudflare deploy**

Run: `node scripts/index.mjs refresh && git diff --check`
Update `HANDOFF.md` + `warroom/README.md` (mention new dark/light toggle & Horizon Bento chart views if user-visible behavior changed) + save a `second-brain` entry. Run `node warroom/deploy.mjs` (dry-run preview ONLY without `--apply`) and confirm with the user before executing live Cloudflare deployment (`npm run warroom:build && node warroom/deploy.mjs --apply --wrangler-auth`).
