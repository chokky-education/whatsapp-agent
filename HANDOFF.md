# HANDOFF — current state

Hand-maintained by whichever agent or person worked last. Keep it short and current: replace stale
text instead of appending. Only the **Log** grows (newest first, one line each).

## Status (2026-11-18)

Working:
- 2026-11-18: The live bot's 18:00 Bangkok report now reads the current calendar day's stored chat plus open tasks and tasks closed that day. It attributes completions reported in chat and flags discrepancies with the task list without changing task status. The scheduler retries missed or failed daily runs while connected, every five minutes until 23:00, with a persisted per-group day marker after send. The user authorized a one-off live test. The 20:50 retry sent one updated report to the configured group at 20:50:14 Bangkok and restored today's marker. Verified successful send and the full-calendar-day report by counts and timestamps. Member receipt is unconfirmed. The next scheduled report is Nov 19 at 18:00 Bangkok.
- 2026-11-18: Replaced Baileys' non-atomic `useMultiFileAuthState` with `useAtomicAuthState` (`src/auth-state.js` + `test/auth-state.test.js`): synchronous temp-write + `flush: true` + `renameSync`, per-file `.bak` backup & recovery, startup cleanup of `.tmp` and unbacked 0-byte files, `authFlush()` before watchdog exits, and socket/reconnect-timer cleanup in `src/bot.js`.
- 2026-11-18 12:33 Bangkok: Bot reconnected via QR at 12:32:12 Bangkok and verified live inbound (12:33:08) and outbound reply (12:33:12) in the group; `data/auth/` has `creds.json` (2710 B), `creds.json.bak` (2542 B), and 833 `.bak` key files with 0 zero-byte/tmp files; telemetry flushed (`pendingEvents: 0`). Temporary QR server stopped and scratch files removed.
- 2026-11-16: Added a 10-minute serialized-job watchdog and 2-minute connection-start watchdog; launchd restarts the process on timeout. A job interrupted during restart may not reply. Prior connection errors are evidence of instability, not a confirmed root cause of the reported missing reply.
- 2026-11-16 10:47 Bangkok: restarted the existing launchd service after the user reported no WhatsApp replies. One bot process and a fresh connection event were observed; the cause and actual reply delivery remain unverified. Ask the user to try /ช่วย in the group.
- Live bot restarted with the user's authorization on 2026-11-09 01:37 via `launchctl kickstart -k` (PID 83903):
  old process gone, one instance, WhatsApp reconnected without QR, `client_renders` migrated on the live DB (3 rows kept).
  Runs the render redesign below. No test messages were sent to the group.
- Bot (`npm start`): stores group messages, describes images/PDFs, `/สรุป` and scheduled summaries.
- Phase 1 (Memory Provenance & Revisions):
  - `client_notes` tracks `current_revision_id`, `revision_count`, `updated_by`, `updated_at`.
  - Revisions table `client_note_revisions` preserves all previous versions; `client_note_sources` captures originating chat message IDs; `client_note_tombstones` prevents deleted/superseded notes from being recreated by auto-sync.
  - Commands: `/โน้ต <id>`, `/ที่มา <id>`, `/ประวัติโน้ต <id>`, `/แก้โน้ต <id> <ข้อความใหม่>` (or "บอท แก้โน้ต #N<id> เป็น..."), and `/ลบโน้ต <id>`.
  - Q&A context marks the current revision and clearly states what it superseded so outdated chat statements do not override the latest client specifications.
- Renders (redesigned 2026-11-09 after the first live use failed; `src/render.js` + routing in `src/bot.js`):
  - Routed by code, not by the chat AI: "บอท เรนเดอร์ [สไตล์]" with an attached/quoted sketch, or the sender's
    latest image from the last 30 min; with no image the bot asks once and starts when that person sends one (10 min).
    Replying to a rendered image = edit that render (`parent_id`, `version_no` = edit depth).
  - Not tied to clients (`client_renders.client_id` now nullable; old rows kept, ids preserved by a one-time rebuild).
  - Prompt (English rules + user's words only): keep furniture, positions, sizes, proportions, camera, walls and openings;
    free materials/light/decor; no text/signage. Never text-to-image (always `images.edit`), `input_fidelity: high`
    (falls back if the model rejects it).
  - Output size = source size: `render.prepareSource` pads the source (grey) onto the closest model canvas
    (1536x1024 / 1024x1536 / 1024x1024), `render.fitToSource` crops that box back and resizes to the source pixels.
    Uses `sharp` (now a direct dependency; it was already installed via Baileys).
  - `MAX_RENDERS_PER_DAY` defaults to 0 = unlimited (user wants to watch usage first); `/เรนเดอร์` shows today/7-day counts.
  - Root causes of the bad first renders: no source image reached the model (text-to-image fallback) and the prompt
    carried client name + stage label "บรีฟ / สำรวจ" + dossier spec, so the model invented a building.
- Phase 2 Search & Deletion: Q&A adds bounded keyword search (40 newest matching messages) over this group’s stored history, including media descriptions; asks AI for sender/date evidence. /ลบข้อมูล (also "บอท ลบข้อมูลทั้งหมด") uses fresh group admin checks + same-sender 5-minute challenge; removes group chat, summaries, tasks, reminders, client data/renders and group media, retains a cutoff to prevent old history restoring it.
- Client Dossiers (`clients` + `client_notes` + `tasks.client_id`, max `config.maxClients` = 10 active clients per group): upstream-to-downstream stages (`brief|design|boq|construction|handover`) and 5 note categories (`brief|spec|change|site|link`), with Controlled Hybrid capture, `/ลูกค้า`, `/ลูกค้า <ชื่อ>`, and `/ลบโน้ต <id>`.
- Tasks and reminders (Phase 1, `src/tasks.js`): auto task capture after 3 min of quiet, "บอท …" requests,
  nagging (max 2, 3 h apart, quiet 21:00–08:00), 08:00 briefing, `/งาน` `/เสร็จ` `/ยกเลิก` `/สถิติ`.
- Bot self-introduction `/แนะนำ` and answers to questions about itself (`src/about.js`).
- Export summarizer (`npm run summarize-export`) for WhatsApp "Export chat" zips.
- Both AI providers (`AI_PROVIDER=openai|claude`).
- Agent index (`scripts/index.mjs`, `AGENTS.md`, `INDEX.md`, this file).

Tests (`npm test`, 68 passing on 2026-11-18; `npm run warroom:test`, 24 passing): `test/auth-state.test.js`, `test/export-parser.test.js`, `test/tasks.test.js`, `test/bot.test.js`, `test/serial-queue.test.js`, `warroom/test/*.test.js`.

Git: `main`, remote `origin` = https://github.com/chokky-education/whatsapp-agent (**public**). Use fake data only (see AGENTS.md).

## In progress

- 2026-11-18: Implemented the approved Horizon rail and one-group Work pilot in the release worktree. Work uses the existing Google session plus an explicit subject-bound grant, the bot's SQLite task list, and a 24-hour D1 projection. Completion is confirmed from a durable bot outcome. The Worker defaults to Work off. Synthetic browser checks passed at 360, 787, and 1440 pixels. Before real work is enabled, pair the existing verified administrator with a confirmed pilot-group member on the bot Mac. See the Work section of `warroom/README.md`.

- 2026-11-18: The Horizon health prototype at `/horizon` now has a collapsible sidebar. It defaults to compact at 1020px and narrower, keeps every navigation item available, and remembers an explicit choice in browser storage. KPI columns follow the width available to the main content. Chrome checked 360px, 787px and 1440px, including keyboard, reload, and navigation; at 787px the compact rail adds 172px of main-content width. Carry the behavior into production with the next approved design release.

- 2026-11-18: Local Warroom team-work prototype at `http://127.0.0.1:4174/work` via `node docs/prototypes/serve-warroom.mjs`. It starts on My Tasks, supports Group Tasks, a shared project filter, and a remembered table/board preference. Completion, offline snapshots, empty, and retry are simulated with synthetic data. Chrome verified 1440px desktop and 360px touch emulation including swipe, filters, permissions in the fixture, completion and retry, and two-way navigation with the health prototype. The next milestone is review of the prototype before the one-group pilot. See `docs/adr/0001-one-task-list-for-warroom-and-whatsapp.md` for the planned data ownership and completion rules.

- 2026-11-18: Applied **SOUVANNARATH ARCHITECT Digital CI v0.1** (`Concept A: Structure / Plan`) and official geometric 'S' SVG logo/lockup assets (`warroom/public/assets/{symbol_dark,symbol_light,primary_logo_dark,primary_logo_light}.svg`, `warroom/public/favicon.svg`) into production `warroom/public/` (`index.html`, `style.css`, `app.js`, `view-model.js`, `assets/flaticon-uicons.woff2` + `FLATICON-LICENSE.txt`, plus `DESIGN.md`) and synced `docs/prototypes/warroom-horizon.{html,css}` (`serve-warroom.mjs` at `127.0.0.1:4174`). Keeps `worker.js` strict CSP (`style-src 'self'` without `'unsafe-inline'`, zero HTML `style="..."` attrs), Google Identity Sign-In, CSRF `x-csrf-token`, `admin` vs `team` RBAC masking, millisecond Asia/Bangkok timestamps, 30s background polling, cursor history pagination, pause banner, and member controls wired to `/api/*`. Live Cloudflare Worker (`https://whatsapp-warroom.entrace-space.workers.dev`) NOT deployed yet — awaiting user inspection on `http://127.0.0.1:4173` and confirmation for `node warroom/deploy.mjs --apply --wrangler-auth`.
- Warroom implementation authorized after Q1–Q31; website deployed at https://whatsapp-warroom.entrace-space.workers.dev with isolated D1, static assets and minute Cron. No DNS/billing changes. Google Client ID is configured and deployed; anonymous status remains protected. User confirmed Google sign-in and the database confirms the configured initial administrator authenticated and was bootstrapped.
- Implemented privacy allowlist telemetry (30s), persisted bounded spool/restart evidence, actual send completion and ACK observations, queue metrics, configured vs response AI models per capability. Telemetry enabled in private bot `.env`; launchd restarted at user request on 2026-11-16. D1 received two consecutive heartbeats and the second reported WhatsApp connected. No chat/group IDs or content transmitted.
- Worker has Google JWT/nonce verification, server-side member/session/CSRF controls, last-admin triggers, team/admin UI, history, 5m contact alerts/hourly repeats, per-capability AI incidents, admin timed pauses, retry outbox and 30-day cleanup. No restart button, chat payloads or synthetic WhatsApp probes.
- Tests: bot 64 and Warroom 16 offline cases pass. Browser checked desktop/mobile, offline/login/team/admin, add member, pause/resume with synthetic data. Live Worker/D1 smoke passed ingest/replay, team status, admin denial and anonymous denial; synthetic records were removed. Real Google login was confirmed by the user and the administrator bootstrap was verified; User confirmed the CLI test email reached the inbox. A separate scheduled Worker/outbox test was accepted by the email provider; inbox delivery of that second test is unconfirmed.
- Rollout: user confirmed the temporary admin mailbox received the test. Email Sending uses the approved domain subdomain with a recipient-restricted binding. A synthetic scheduled Worker/outbox test was accepted and its records removed. Real bot telemetry is now enabled; first and second heartbeats arrived with the second reporting WhatsApp connected. No WhatsApp test messages sent. Isolated production-equivalent Worker/D1 test simulated AI auth failure and subsequent success; both incident and recovery emails were accepted. Cron for the newly created test had not fired yet, so test invoked the same scheduled handler via a test-only authenticated endpoint. Test Worker/D1 were deleted. User confirmed both test emails reached the inbox; actual disconnect and automatic cron timing have not been tested end to end. Mailbox may later be changed to team Gmail.
- Deployment settings/secrets are in ignored `warroom/.deployment.local.json` (0600), excluded from index. `node warroom/deploy.mjs` previews; `--apply --wrangler-auth` deploys using existing local CLI login without printing credentials. Connected Cloudflare tool disappeared during work; direct documented REST API was used. Never print or commit local deployment settings.
- Runbook: warroom/README.md. Design: docs/PLAN-warroom-status.md, PRODUCT.md, DESIGN.md. Source audit section describes **pre-instrumentation** behavior, not the new code.
- Notification acceptance is not inbox delivery; a crash after provider acceptance and before recording it can duplicate mail. Bounded spool may drop events after a long outage. Current billing/free remainder cannot be verified through the OAuth billing endpoint; do not promise zero cost or guaranteed uptime.

## Next steps / ideas

- Phase 3: Hybrid Semantic Search (Thai-aware embeddings with BM25 / keyword fallback for client dossiers and chat history).
- Phase 4: Advance Reminders & Chase Policy (differentiating event start time vs advance alert send time, per-task chase rules, and delivery uncertainty handling).
- Review and refine live evaluation on real architectural queries once user tests Sunburst image rendering in practice.

## Known issues / watch out

- Real-model check 2026-11-09 (one run on a team bedroom SketchUp view, outside WhatsApp, 64 s, 1536x1024):
  every modelled item kept in place (TV wall, side shelves, 6-drawer console, slat wall, round mirror, vanity, stool,
  cabinet, plant, door, window); `input_fidelity: high` accepted. Second run with pad-and-crop: output 1255x523 = the
  sketch, items at the same pixel positions. Only this one sketch tested; exterior sketches and PDFs (not accepted) untested.
- A crash on a dropped network stream ("TypeError: terminated", ECONNRESET/ETIMEDOUT) killed the bot twice on
  2026-11-09; a message being handled at that moment is lost (it is already saved, so the redelivery is skipped as not new).
  `main()` now logs and survives network-only uncaught exceptions; other errors still exit for launchd to restart.

- The bot tells people its own limits (`src/about.js`: `/แนะนำ` text and the facts the AI answers from; mirrored in
  README "ข้อจำกัดของบอทที่รู้อยู่"). When a limit is fixed or a new one appears, update all three or the bot will
  state something false about itself. Current limits: needs an awake computer (not on a server yet); Q&A reads client dossiers, the
  last `qaContextMessages` (60) messages of `qaContextDays` (7) days plus up to 40 keyword hits from stored history; search can miss synonyms; no
  automatic backup; active client dossiers capped at `maxClients` (10) per group; one running copy only; deletion only by group admin with confirmation; offline > ~2 weeks may
  need a QR re-scan.
- Planned, not built: weekly scorecard (/รายงาน) with event logging, semantic history search, daily backup,
  VPS migration (before running on two machines run `npm run autostart -- uninstall` on the Mac;
  on code 440 `src/bot.js` exits 1 and launchd KeepAlive would restart it, so two copies would fight).

- Baileys is unofficial; WhatsApp may ban the number. Use a dedicated bot number.
- The bot only sees messages while it is running.

## Log

- 2026-11-18 — Integrated the approved Work and Horizon views, tested permission and retry behavior, and prepared the staged release to the existing Worker.

- 2026-11-18 — Added the collapsible navigation rail to the Horizon prototype after feedback on the 787px layout. Browser checks and bot/Warroom suites passed.

- 2026-11-18 — Added the synthetic Warroom team-work prototype and recorded the pilot's shared task-list decision. Chrome desktop and mobile emulation passed. Bot 68 and Warroom 24 tests passed.

- 2026-11-18 — At the user's request, rearmed the single watched group's daily marker and used the running bot's 20:50 retry. One send and one full-day report were recorded at 20:50:14 Bangkok, with today's marker set again. No runtime code change or restart.

- 2026-11-18 — Shipped full-day evening reporting through the existing launchd bot, verified restart and WhatsApp connection, passed all 68 offline tests, and checked completion attribution using the configured AI with fictional inputs. First updated group send is due Nov 19 at 18:00 Bangkok.

- 2026-11-18 — Applied SOUVANNARATH ARCHITECT Digital CI v0.1 (Charcoal/Bone/Limestone tokens, 1px borders, architectural bars) and official geometric 'S' SVG logo/favicon into `warroom/public/`, synced `docs/prototypes/warroom-horizon.{html,css}`, rebuilt `warroom:build`, verified 68 bot + 24 Warroom tests pass, and started `warroom/dev.mjs` preview at `http://127.0.0.1:4173` prior to Cloudflare deploy.

- 2026-11-18 — Bot reconnected via QR (12:32:12 Bangkok), verified live group inbound/outbound reply (12:33:08–12:33:12), populated `creds.json`/`creds.json.bak` and 833 `.bak` files (0 zero-byte/tmp), flushed telemetry (`pendingEvents: 0`), and cleaned up temporary QR server/scratch files.

- 2026-11-18 — Replaced Baileys `useMultiFileAuthState` with atomic `.bak`-backed `useAtomicAuthState` (`src/auth-state.js`), cleaned up socket/reconnect timers and watchdog flushes in `src/bot.js`, added `test/auth-state.test.js` (68 bot + 24 Warroom tests pass), and restarted `launchd` (0 zero-byte files left; awaiting QR scan & group verification).

- 2026-11-18 — User approved Horizon UI Bento × Cozy Café as the final Warroom design; updated DESIGN.md, spec status, and HANDOFF.md, and restarted local preview servers.

- 2026-11-16 — Integrated Horizon Bento × Cozy Café frontend into production `warroom/public/` (`index.html`, `style.css`, `app.js`, `view-model.js`, assets) with strict CSP (`style-src 'self'`), Google Sign-In, CSRF/RBAC, unix ms adapters, and updated `warroom/dev.mjs` preview; browser-verified under Worker CSP (`127.0.0.1:4173`), `warroom:build`, 64 bot + 24 Warroom tests pass; awaiting user OK to run `deploy.mjs --apply`.

- 2026-11-16 — Redesigned `/horizon` charts & table to match real Warroom `worker.js`/`protocol.js` payloads & `admin`/`team` RBAC masking (removed fake `Math.sin` curve, separated connection events into `#conn-strip`, added capability filters, uncalled `0 ครั้ง` handling, 7h event histogram, `waiting/running/oldestAt` queue card, and 2-lane team timeline); browser-verified desktop/mobile + 64/16 tests pass.

- 2026-11-16 — Built Horizon UI Bento × Cozy Café Warroom prototype (`/horizon`) combining Figma Main Dashboard Bento layout with Cozy Café Light/Dark tokens, search pill, floating chart badge, capsule bars, complex table, pie stats, and 4 working views; browser-verified desktop/mobile and 64+16 tests pass, production unchanged.

- 2026-11-16 — Upgraded `/cozy` IA & User Flow: working 4-tab nav (Overview, History with filters, Alerts with timed pause + audit log, Members), Admin/Member role toggle, graph-to-capability cross-linking, category-scaled capability bars, and mobile inline capability accordion; browser-verified + 64/16 tests pass.

- 2026-11-16 — Built Cozy Café Warroom prototype (`/cozy`) with new Light/Dark/High-Contrast design tokens and 3 animated graphs (AI rhythm curve with unknown gaps, queue ring gauge, capability duration bars); browser-checked desktop/mobile, all 5 scenarios, and dialog; 64+16 tests pass, production unchanged.

- 2026-11-16 — Exported the Warroom design conversation as a curated agent handoff; corrected stale in-progress wording.

- 2026-11-16 — Refined local health prototype layout using Apple HIG; browser resizing and selection checked, production untouched.

- 2026-11-16 — Refined health prototype color by state and added licensed Flaticon Uicons, with local assets and visible attribution.

- 2026-11-16 — Built and browser-checked bot-health prototype with synthetic scenarios and capability details; awaiting feedback.

- 2026-11-16 — Researched alternate structures; user supplied Bevel reference after rejecting A/B/C. Recorded evidence/access limitations and pending bot-health direction. No new UI or production changes.

- 2026-11-16 — Built local Warroom ops variants A/B/C with five synthetic scenarios; user selection pending. No production changes.

- 2026-11-16 — User confirmed receiving both isolated simulated AI-incident and recovery emails; automatic cron timing and real outage behavior remain unverified end to end.

- 2026-11-16 — Tested AI failure and recovery using isolated Worker/D1 with a manually invoked scheduled handler; provider accepted both emails. Removed test Worker and DB; inbox confirmation and a true outage/cron timing test remain open.

- 2026-11-16 — Created warm Warroom design prototype after user selected “อบอุ่น เป็นกันเอง ลดความรู้สึกว่าเป็นหน้าระบบ”; four synthetic states, history/model details and guidance dialog checked in browser, including 390px layout and keyboard navigation. Bot 64/64 and Warroom 16/16 tests pass. Production unchanged; design feedback pending.
- 2026-11-16 — User confirmed test email arrived and authorized connection. Worker scheduled email test accepted; synthetic DB records removed. Enabled private bot telemetry and restarted launchd; two heartbeats arrived, second showed WhatsApp connected. Real incident/recovery inbox delivery not yet tested.

- 2026-11-16 — User verified temporary alert recipient and approved existing domain. Enabled Email Sending on alerts.chokhair.com, deployed restricted email binding; DNS visible on 1.1.1.1 but initial test sends rejected with 10206 sending_not_ready; a later CLI test was queued. Inbox delivery remains unverified; live bot telemetry not enabled.

- 2026-11-16 — User selected existing admin mailbox as temporary alert recipient; Cloudflare destination created and verification message sent. No sending domain onboarded; DNS read returned 403 and no DNS was changed. Await recipient verification and sender domain selection.

- 2026-11-16 — User confirmed Google sign-in succeeded; verified the configured first admin has an authenticated Google identity in D1. Alert recipient/sender and real bot telemetry remain pending.

- 2026-11-16 — Configured the supplied Google web Client ID and redeployed Warroom; login endpoint reports configured, challenge cookie issued, anonymous status remains 401, 16 Warroom tests pass. Real Google sign-in awaits user; email and bot telemetry still disabled.

- 2026-11-16 — Built and deployed locked Warroom with D1, privacy-safe telemetry, provider/model status, Google/role security and incident/email rules. Offline and live synthetic checks passed; OAuth/email and real-bot connection remain pending. No live bot restart, real messages or commit.

- 2026-11-16 — Warroom Q27–Q29 accepted; investigating existing Cloudflare account and current hosting/email costs, without creating resources.
- 2026-11-16 — Warroom Q30 accepted: provider/model visible to team per capability; call/error details restricted to administrators, still no chat content.
- 2026-11-16 — Warroom: user marked AI provider/model visibility as essential; added to phase-one overview and began source evidence audit.
- 2026-11-16 — Warroom Q24–Q26 accepted: bot remains on Mac, website/alerts hosted independently, existing/free services first, AI emails for repeated failures or administrator-action-required errors.
- 2026-11-16 — Warroom: confirmed Q21–Q23 timing and 30-day history; clarified first email after 5 minutes versus hourly repeats. Added source evidence limitations to the draft.

- 2026-11-16 — Warroom: accepted five health areas, content-free diagnostics, hourly repeat alerts and admin-only timed pauses; consolidated draft decisions and open questions.
- 2026-11-16 — Warroom: user accepted real-message evidence, no phase-one restart button, 24-hour availability target and temporary alert pauses with automatic expiry.
- 2026-11-16 — Warroom: user accepted shared Gmail for alerts, individual allowlisted Google sign-in, 5-minute disconnection alerts, recovery notifications and immediate alerts requiring human action.
- 2026-11-16 — Warroom discussion: confirmed email alerts; shared team Gmail is planned, but login and mailbox roles still need clarification.
- 2026-11-16 — Warroom discussion: individual sign-in with team/admin roles; administrators should receive alerts when the bot has a problem.
- 2026-11-16 — Warroom discussion: website accessible from anywhere and still available when the bot's Mac is off/asleep, showing lost contact and last received time.
- 2026-11-16 — Warroom discussion: website first, WhatsApp later; distinguish connected from verified ability to reply and show when checked.
- 2026-11-16 — Warroom discussion: user chose an actionable overview with drill-down history, and separate detail levels for team members and bot administrators.
- 2026-11-16 — Began Warroom design discussion; user chose both bot status and team work status, bot status first. No implementation decision yet.
- 2026-11-16 — Investigated no-reply report: historical logs show disconnects, timeouts and closed connections, but no proof of the specific cause. Added watchdogs for stuck serialized work and stalled startup, plus explicit startup failure handling; added offline queue tests.
- 2026-11-16 — Restarted the launchd bot after a report of no replies; fresh WhatsApp connection observed, one bot process, 62 offline tests passed. No test message sent; live reply not yet verified and root cause unknown.
- 2026-11-09 — User authorized restart: kickstart at 01:37, PID 83903, clean reconnect, live DB migration verified by schema/count only. Note: the old code had crashed again on a network drop before 01:28 (fixed by the new guard).
- 2026-11-09 — Redesigned renders after the user found them unusable (output ignored the sketch and invented a building): code-routed "บอท เรนเดอร์", reply-to-edit, ask-then-wait for sketch, no client binding, layout-preserving prompt without dossier data, output cropped back to the sketch's exact size (sharp pad->render->crop), input_fidelity high, no daily cap by default, /เรนเดอร์ usage counts, network-crash guard. New src/render.js; client_renders migration; removed render_client_image AI action and dossier render section. 62 tests pass. Not live. One real-model check afterwards kept the layout (see Known issues).
- 2026-11-09 — Fixed image rendering source capture & restarted launchd (PID 72449): resolved race condition where incoming image caption messages triggered `handleRequest` before background `describeLater` downloaded the media (causing `sourceMediaPath` to be null and falling back to text-to-image). Added `saveIncomingMedia` for immediate synchronous media download on incoming image messages, recent group image fallback (within 30 mins) if user says "จากภาพ/สเก็ต" without quoting, and explicit guard against text-to-image when image is missing. Added prompt steering so Sunburst strictly preserves building layout. All 54 tests pass (`npm test`).
- 2026-11-09 — User authorized live restart. Restarted launchd service (`com.whatsapp-group-summarizer.bot`, new PID 69796); verified old process exited, single instance running, and clean WhatsApp connection without QR. Phase 1 & 2 live in production.
- 2026-11-09 — Implemented Phase 1 (Memory Provenance & Revisions) and Phase 2 (Sunburst Render & Versioning): verified live OpenAI API access to `gpt-image-2.6-sunburst`; added `client_note_revisions`, `client_note_sources`, `client_note_tombstones`, `/โน้ต`, `/ที่มา`, `/ประวัติโน้ต`, `/แก้โน้ต`, and correction-aware Q&A context; added `client_renders` table, `renderImage` in `src/ai.js`, `render_client_image` action in `src/tasks.js` with client spec snapshot and parent version linkage, `/เรนเดอร์` command, background render worker queue (`enqueueRender`, `pumpRenders`, `flushRenders`) isolated from chat serialization, `sendImage` with WhatsApp image sending & architectural disclaimer, and daily quota cap (`MAX_RENDERS_PER_DAY=10`). Updated `src/about.js`, `README.md`, `.env.example`, `INDEX.md`, and second-brain. All 53 tests passing (`npm test`).
- 2026-11-08 — Planned the user's selected three-phase sequence in docs/PLAN-memory-search-reminders.md: note provenance/revisions with correction-aware Q&A; scoped hybrid retrieval with synthetic Thai quality gates; separate event/send times and bounded chase with delivery uncertainty handling. Added 7 implementation slices, migration/rollback and rollout gates; no runtime/data changes or live restart. Added index route. Checks: npm test 48 passed/1 time-window skip/0 failures; index script syntax and diff whitespace passed.
- 2026-11-08 — Investigated Abdul using REA browser captures and static analysis of 9 selected public frontend chunks (45 first-party files captured). Added a Thai feature comparison, evidence ledger, contradictory claims/unknowns, and a concrete adaptation order under docs/research; added an index route. npm test: 48 passed, 1 time-window skip, 0 failures. No bot runtime changes, live messages, AI calls, restart, login or commit. Bot self-knowledge stays unchanged because capabilities did not change.
- 2026-11-08 — Expanded `src/about.js` (`INTRO` and `ABOUT_FOR_AI`) with a detailed step-by-step explanation of how the client data recording feature works (`วิธีบันทึกข้อมูลลูกค้า` / `วิธีการทำงานฟีเจอร์บันทึกข้อมูลลูกค้า`: dossier structure, 5 stages, 5 note categories, 2 capture paths — explicit commands vs Controlled Hybrid 3-minute quiet auto-sync on registered client names/aliases — lookup, Q&A alias expansion, and `/ลบโน้ต` correction), verified all 49 offline tests pass, and restarted the live launchd service (`com.whatsapp-group-summarizer.bot`).
- 2026-11-08 — Seeded the 10 initial active clients into the local git-ignored SQLite database (`data/messages.db`) with Thai/Lao vowel-variant aliases (`ึ`/`ื` tolerance in `db.findClient` and `db.clientTerms`), and restarted the live launchd service (`com.whatsapp-group-summarizer.bot`), which reconnected to WhatsApp without QR. No real client/group names stored in tracked files or second-brain.
- 2026-11-08 — Implemented Client Dossier system (up to `MAX_CLIENTS=10` active clients per group for architecture + turnkey construction in a shared group): `clients` and `client_notes` tables (`brief|spec|change|site|link` categories, `brief|design|boq|construction|handover` stages), `tasks.client_id`, `/ลูกค้า` and `/ลบโน้ต` commands, Controlled Hybrid capture (explicit-only client creation; auto-sync notes/tasks only when a registered client name/alias is mentioned), Q&A dossier context + alias search expansion, and updated `src/about.js`, `README.md`, `.env.example`, and `INDEX.md`. All 49 offline tests pass; no real WhatsApp/AI calls, restart, or commit.

- 2026-11-08 — User authorized a live restart to load updated bot knowledge. Restarted the existing launchd service with kickstart -k; verified old process stopped, exactly one replacement bot running, and a fresh WhatsApp connected event without QR, duplicate-session or fatal startup markers. bot.js/about.js syntax checks passed. Read only sanitized log indicators (no chat/group/identity output); no manual test messages or data deletion commands sent. No source changes or project commit.
- 2026-11-08 — User requested the bot know its new abilities: expanded /แนะนำ and ABOUT_FOR_AI with Phase 2 history search, client-revision/Drive examples, evidence scope, and same-admin deletion challenge/confirm/cancel steps. Current capability facts explicitly override stale capability statements in old chat. README notes restart requirement. All 45 offline tests and about.js syntax check pass; no real AI/WhatsApp calls, restart or commit.
- 2026-11-08 — Phase 2: bounded same-group keyword retrieval for Q&A (Drive/revisions/Thai segmentation), evidence instructions; deterministic admin-only group erasure with challenge/cancel/expiry, media drain and history cutoff. Production incoming/scheduled mutations share a queue to avoid in-flight AI restoring erased records (slow AI can delay other groups). README/about facts/routes updated. 45 offline tests pass, fake socket/AI and isolated DB/media only; no WhatsApp sent, no real data erased, no restart or commit. Existing dirty working tree preserved. Live bot needs an authorized restart to load changes; real AI answer quality not evaluated.

- 2026-11-08 — Read-only status audit: verified current source and all 40 tests (fake socket/AI, temporary DB); syntax checks passed for changed JS and autostart shell. Latest feature changes remain uncommitted. Live launchd/process status could not be verified from this sandbox; do not infer the bot is stopped. Follow-up housekeeping: new config env settings are missing from .env.example, and about/autostart routes are missing from the index ROUTES table. Refreshed generated INDEX.md; no bot started or real messages sent.
- 2026-11-08 — Recorded the limitations the user asked about (offline/sleep, 60-message Q&A window, no backup, no per-project split, single copy, no chat deletion, QR re-scan after ~2 weeks) into src/about.js (INTRO + AI facts, numbers come from config) and README. Q&A window now configurable via config.qaContextMessages/qaContextDays.
- 2026-11-08 — Restart safety: offline-delivered ("append", < OFFLINE_REPLY_HOURS) commands/requests answered with a "ตอบช้า" note; late reminders say their original time; catchUp() on connect sends missed briefing (until 12:00) / evening summary (until 23:00, per-day markers in group_state), retries cut-off media descriptions (media_msg column), schedules task sync for unread rows; one-copy lock data/bot.pid; exit on 440 connectionReplaced; scripts/autostart.sh (launchd + caffeinate), installed on this Mac 2026-11-08 — the bot now runs from launchd, not a terminal; logs in logs/bot.log.
- 2026-11-08 — Phase 1 hardening: bot message ids chosen before sending (own echo can't trigger replies), task sync tracks message rows and skips requests to the bot, Buddhist-era years, nickname -> real name, "เสร็จแล้ว" on task-less reminders, "บอทนี้…" (about) vs "บอท …" (to). Added /แนะนำ + about.js. Real-AI eval `eval/phase1-eval.local.mjs` (git-ignored, uses real chat): requests 22/23, auto task finding 8/8.
- 2026-11-08 — git init; replaced real names/WhatsApp IDs with fake ones and squashed history before publishing to a public GitHub repo. AGENTS.md: check git log at start; fake data only.
- 2026-11-08 — Narrowed agent setup to the user's tools (Codex, Antigravity, Claude Code): removed GEMINI.md, Copilot and Cursor pointer files.
- 2026-11-08 — Added agent index system: AGENTS.md, generated INDEX.md, HANDOFF.md, scripts/index.mjs, CLAUDE.md pointer.
