# Warroom Cozy Design Tokens & Animated Graphs Prototype

Date: 2026-11-16 · Status: Pending user approval

## Intent & Why

Redesign the Warroom health prototype with a completely new **Cozy Café** design token system and **Animated Graphs**, giving the team a warm, calm, inviting interface to check bot health while preserving strict evidence honesty from `warroom/src/protocol.js`.

Visual vibe reference: user-supplied *We Proudly Serve* guideline PDF (warm oak/caramel wood, steamed-milk cream, stone linen, espresso text, muted taupe, deep café green `#00704A`, and calm editorial spacing). **No Starbucks logos, Siren artwork, or trademarks are used.**

## Scope, Non-Goals & Anti-Goals

- **Scope:** New standalone prototype served at `http://127.0.0.1:4174/cozy` (`docs/prototypes/warroom-cozy.html`, `docs/prototypes/warroom-cozy.css`, `docs/prototypes/warroom-cozy.js`) added to the allowlist in `docs/prototypes/serve-warroom.mjs`. Existing `/health`, `/`, and `/ops` prototypes remain untouched for side-by-side comparison.
- **Non-goals:** No changes to production `warroom/`, `src/` bot runtime, database, live telemetry, or deployments. No external CDNs, fonts, or new npm packages.
- **Anti-goals:**
  - Never copy third-party logos/trademarks or invent continuous uptime percentages / synthetic readiness scores.
  - Never conflate heartbeat receipt, WhatsApp connection, send completion, and delivery acknowledgement.
  - Never sacrifice WCAG text/graphic contrast or ignore `prefers-reduced-motion`.

## Approaches Considered

1. **Warm Morning Journal (Recommended originally):** Cream & terracotta editorial layout with 3 moderate animated graphs. Balanced and honest, though slightly muted without the café green contrast.
2. **Cozy Café Telemetry:** Richer earth tones with 4 dense dashboard charts. High visual activity, but risks feeling crowded and implying continuous 24h uptime.
3. **Soft Hearth Companion:** Ultra-minimal sand/honey layout with 2 charts. Very airy, but fewer live graph interactions.

**Selected approach:** **Cozy Café Blend** — combines Approach 1's calm, evidence-honest editorial layout with the **Cozy Café** palette from the user's PDF reference (`#00704A` deep café green, `#796C64` warm taupe, `#A67246` oak/caramel, `#F7F3EC` oat cream) and 3 purposeful animated graphs.

## Design Decisions

### 1. Cozy Café Design Tokens (`warroom-cozy.css`)

- **Light Mode (Oat & Café Linen):**
  - `--bg: #F7F3EC`, `--surface: #FFFDF9`, `--surface-stone: #EFE9DF`, `--surface-wood: #F5EBDD`
  - `--text: #2C241E`, `--secondary: #6B5E54`, `--border: #DED6CA`
  - `--accent: #00704A`, `--accent-soft: #E5F0EA`, `--wood: #A67246`
  - `--ok: #00704A`, `--ok-bg: #E5F0EA`
  - `--warning: #9A541C`, `--warning-bg: #FBF0E4`
  - `--unknown: #6B5E54`, `--unknown-bg: #ECE6DE`
  - `--focus: #005A3B`, `--shadow-warm: 0 8px 24px rgba(44, 36, 30, 0.06)`
- **Dark Mode (`prefers-color-scheme: dark`, Evening Roastery):**
  - `--bg: #1B1613`, `--surface: #251F1B`, `--surface-stone: #312924`, `--surface-wood: #2E241C`
  - `--text: #F5EFE6`, `--secondary: #BFB3A6`, `--border: #443931`
  - `--accent: #4CA882`, `--accent-soft: #213D31`, `--wood: #D49B6A`
  - `--ok: #5AC095`, `--ok-bg: #1E382D`
  - `--warning: #E8A86B`, `--warning-bg: #412C18`
  - `--unknown: #BFB3A6`, `--unknown-bg: #322B26`
  - `--focus: #86D9B6`
- **Increased Contrast (`prefers-contrast: more`):** Strengthened borders and darker/brighter foregrounds for light and dark themes.
- **Typography & Surfaces:** Self-hosted `Room` Thai font (`/fonts/thai-3.woff2`, `thai-5.woff2`, `thai-6.woff2`), `tabular-nums`, Flaticon Uicons (`/assets/flaticon-uicons.woff2` with attribution), rounded corners (`12px–24px`), warm hairline dividers.

### 2. Three Animated Graphs (Synthetic data shaped like `protocol.js`)

1. **AI Response Rhythm Curve (SVG smooth line + gradient area + event dots):**
   - Plots recent observed `durationMs` samples (`ai_ok`, `ai_error`, `send_ok`) with explicit dashed/hatched gap segments for unobserved intervals (never interpolating fake uptime).
   - Animates path draw (`stroke-dashoffset` ~650ms `cubic-bezier(0.22, 1, 0.36, 1)`) and staggered dot pop-in on load and scenario change.
   - Interactive hover/focus tooltip showing exact timestamp, capability, and `durationMs`.
2. **5-Capability Speed & Queue Bars (Animated horizontal pill bars):**
   - Displays latest response duration + queue load (`waiting` / `running`) across the 5 bot capabilities (`requests`, `task_sync`, `summary`, `media`, `render`).
   - Bars smoothly animate width/scale on scenario changes; clicking a capability updates the sticky detail panel and highlights its bar.
3. **Queue Distribution Ring & Live Heartbeat Pulse (SVG stroke-dasharray ring + soft CSS pulse):**
   - Ring gauge smoothly animates arc segments for `main`, `media`, and `render` queue counts (or empty/stale state ring).
   - Gentle breathing pulse dot next to the latest snapshot timestamp (`รับสถานะล่าสุด ...`), active only when telemetry is fresh and disabled automatically under `prefers-reduced-motion: reduce`.

### 3. Scenarios, Accessibility & Verification

- Supports all 5 synthetic scenarios (`problem`, `healthy`, `stale`, `empty`, `ai`) plus Light/Dark theme preview toggle in the demo bar (respecting system preference by default).
- Preserves safe-area insets, 256px desktop sidebar / 2-column mobile nav, sticky capability detail panel on wide screens, native `<dialog>` guidance steps, and zero private/real data.
- After building: verify visually in browser at desktop (`1440px`) and mobile (`390px`) in light & dark mode, check console/overflow/scenarios, and run `npm test` + `npm run warroom:test`.
