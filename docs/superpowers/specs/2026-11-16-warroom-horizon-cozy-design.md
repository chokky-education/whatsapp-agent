# Warroom Horizon UI Bento Layout + Cozy Café Tokens Design

Date: 2026-11-16 (Approved 2026-11-18) · Status: Approved by user & integrated into warroom/public/

## Intent & Why

Combine the **Horizon UI Main Dashboard** Bento layout structure inspected from Figma (`201:1804` Light & `201:2947` Dark) with the **Cozy Café** design token palette (`#F7F3EC`, `#FFFDF9`, `#EFE9DF`, `#2C241E`, `#6B5E54`, `#00704A`, `#9B6436`, `#9A541C`, plus Evening Roast dark mode `#1B1613`, `#251F1B`, `#4CA882`, `#D49B6A`).

This gives the dashboard Horizon UI's crisp visual hierarchy (290px sidebar with right-edge active indicator, floating top utility pill, rounded-20px Bento cards, capsule bar charts, floating pill tooltip on smooth line charts, complex status table with progress bars, pie/stats card, and team card) while preserving warm, calm Cozy Café colors and strict `protocol.js` evidence honesty.

## Scope, Non-Goals & Anti-Goals

- **Scope:** New standalone prototype served at `http://127.0.0.1:4174/horizon` (`docs/prototypes/warroom-horizon.html`, `warroom-horizon.css`, `warroom-horizon.js`) added to `docs/prototypes/serve-warroom.mjs`. Existing `/cozy`, `/health`, `/ops`, and `/` remain intact for side-by-side comparison.
- **Non-goals:** No modifications to production `warroom/`, `src/` bot runtime, database, or deployments. No external CDNs, fonts, or npm packages.
- **Anti-goals:**
  - Strip non-relevant Figma demo blocks (`Upgrade to PRO`, promotional `Starbucks` cashback card, financial currency/country dropdowns) and replace with real Warroom capabilities.
  - Never use Horizon UI's `#4318FF`/`#7551FF` purple-indigo tokens (Cozy Café palette only).
  - Never fabricate continuous 24h uptime percentages or link send completion with delivery ACK.
  - Never retain temporary Figma asset URLs in code; use self-hosted `Room` Thai fonts and Flaticon Uicons (with attribution) plus custom inline SVG icons/charts.

## Approaches Considered

- **Option A — Full Horizon UI (Layout + Indigo/Navy Palette):** Faithful to Horizon UI colors, but loses the Cozy brand vibe the user requested earlier.
- **Option B — Horizon UI Bento Layout + Cozy Café Palette (Selected by user):** Adopts Horizon UI's Bento card architecture, floating top pill, 290px sidebar, capsule bar charts, and table/pie/team cards, dressed entirely in Oat & Café Linen (Light) and Evening Roast (Dark) Cozy tokens.

## Architecture & Layout Mapping

1. **Cozy Café Design Tokens (`warroom-horizon.css`):**
   - Light Mode: `--bg: #F7F3EC`, `--surface: #FFFDF9`, `--surface-soft: #EFE9DF`, `--surface-tint: #F5EBDD`, `--text: #2C241E`, `--secondary: #6B5E54`, `--accent: #00704A`, `--wood: #9B6436`, `--warning: #9A541C`, `--shadow-bento: 14px 17px 40px 4px rgba(44, 36, 30, 0.06)`, `--radius-card: 20px`.
   - Dark Mode (`prefers-color-scheme: dark` & `[data-theme="dark"]`): `--bg: #1B1613`, `--surface: #251F1B`, `--surface-soft: #312924`, `--text: #F5EFE6`, `--secondary: #C4B7AA`, `--accent: #4CA882`, `--wood: #D49B6A`, `--warning: #E8A86B`.
   - High-contrast rules (`prefers-contrast: more`) and `prefers-reduced-motion: reduce` support.
2. **Horizon Shell & Floating Top Utility Pill:**
   - **Sidebar (`290px` desktop, collapsible/2-col nav mobile):** Brand (`WARROOM · สถานะบอท`), hairline divider, 4 interactive tabs (`ภาพรวม`, `ประวัติ`, `การแจ้งเตือน`, `สมาชิก`) with Horizon's `4px` right-edge active indicator pill, and account footer.
   - **Top Header + Floating Pill (`Misc` `201:2093`):** Left breadcrumb (`Warroom / ...`) + H1 title; right floating pill (`border-radius: 30px`) with live search filter (`#search-input` filtering capability rows & history events), notification bell button (jumps to `การแจ้งเตือน`, shows dot when paused/alerting), theme moon/sun toggle button, info/help button (opens guidance `#dialog`), and avatar badge (`N` / `S` for Admin/Member).
3. **Overview Bento Rows (Synthetic `protocol.js` evidence):**
   - **Row 1 — 5 KPI Bento Cards:** Host Contact, WhatsApp Connection, Latest Send Evidence, Active Queue Count, AI Capabilities Ready Count (`56px` circular soft icon well + label + `tabular-nums` value).
   - **Row 2 — 2 Bento Chart Cards (aligned 1-to-1 with `GET /api/status` & `GET /api/history` schemas and RBAC):**
     - *Left (`#rhythm-card`):* Capability filter pills (`ทั้งหมด` + 5 capabilities), `#conn-strip` isolating WhatsApp `connection` events above the plot, and zero fabricated baselines. **Admin (`status.calls`):** vertical stem+dot latency chart with real seconds Y-axis (`ทั้งหมด` draws discrete stems + call count without averaging disparate capabilities; single-capability view shows per-capability mean and connects points `≤ 30m` apart while hatching gaps `> 30m`). **Team (`status.calls === undefined`):** honest 2-lane event timeline (`AI สำเร็จ` / `พลาด/เชื่อมต่อ`) from masked `/api/history` with zero invented latency ms. Floating selection pill sits in a dedicated top band with a vertical dashed guide line so it never collides with dots.
     - *Right (`#capsule-card`):* 5 vertical capsule bars (`--surface-soft` track + `--accent`/`--warning` rounded fill). **Admin:** aggregated directly from `status.calls` (showing `0 ครั้ง / ยังไม่เรียก` if a capability has no calls). **Team:** shows latest reported status (`พร้อม` / `พลาด` / `เก่า`) and relative age from `snapshot.models`.
   - **Row 3 — 3 Bento Cards:**
     - *Left (`#complex-table`):* Interactive 5-capability table (`งาน`, `สถานะ`, `ผู้ให้บริการ / โมเดล`, dynamic Col 4). **Admin:** `เวลาตอบล่าสุด` latency bar from `status.calls` (`ยังไม่ถูกเรียก` if absent). **Team:** `เรียกใช้ล่าสุด` clock time + relative age from `snapshot.models.lastAt`.
     - *Middle (`#traffic-card`):* 7-hour hourly event histogram (`07:00`–`13:00`) bucketed from `history.events`, stacking `ok` and error/close counts cleanly for both Admin and Team.
     - *Right (`#pie-card`):* Queue donut + divided stats footer built directly from `snapshot.queues` (`รอทำ` `waiting`, `กำลังทำ` `running`, and `งานค้างนานสุด` from `oldestAt`).
   - **Row 4 — 3 Bento Cards:**
     - *Left:* Selected Capability Detail & Guidance card (provider, requested/response model, queue, admin error hint, `"สิ่งที่ควรตรวจ →"` button).
     - *Middle (`Tasks` style):* Recent Event Log preview + `"ดูประวัติ 30 วัน →"`.
     - *Right (`Team members` style):* Team Members preview (`Nok`, `Somchai`, `Ploy`) with `+` button jumping to `สมาชิก` view.
4. **Full Working Sub-Views & Prototype Controls:**
   - Demo bar (`สถานการณ์`, `มุมมองสิทธิ์`, `โทนสี`) + working `ประวัติ` (filterable), `การแจ้งเตือน` (timed pause + audit log + email status), and `สมาชิก` (add/toggle/remove with last-admin protection).
   - Browser verification across `1440px` desktop & `390px` mobile, Light & Dark modes, all 5 scenarios, search filter, interactive charts/table rows, pause banner, and `npm test` + `npm run warroom:test`.
