# HANDOFF — current state

Hand-maintained by whichever agent or person worked last. Keep it short and current: replace stale
text instead of appending. Only the **Log** grows (newest first, one line each).

## Status (2026-11-09)

Working:
- Live bot restarted with the user's authorization on 2026-11-09 through the existing launchd job (PID 72449).
  The previous process exited, one replacement process is running, and WhatsApp reconnected without a QR code.
  This loads Phase 1 (memory provenance/revisions), Phase 2 (Sunburst render & versioning), and Bugfix for immediate media download on direct caption messages & recent image fallback; no manual probe messages sent.
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

Tests (`npm test`, 62 passing on 2026-11-09): `test/export-parser.test.js`, `test/tasks.test.js`, `test/bot.test.js`.

Git: `main`, remote `origin` = https://github.com/chokky-education/whatsapp-agent (**public**). Use fake data only (see AGENTS.md).

## In progress

- Render redesign committed and fast-forwarded into `main` (not pushed). The live bot still runs the old code until an
  authorized restart; on restart `client_renders` is rebuilt once (rows and ids kept).

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
