# HANDOFF — current state

Hand-maintained by whichever agent or person worked last. Keep it short and current: replace stale
text instead of appending. Only the **Log** grows (newest first, one line each).

## Status (2026-11-08)

Working:
- Bot (`npm start`): stores group messages, describes images/PDFs, `/สรุป` and scheduled summaries.
- Tasks and reminders (Phase 1, `src/tasks.js`): auto task capture after 3 min of quiet, "บอท …" requests,
  nagging (max 2, 3 h apart, quiet 21:00–08:00), 08:00 briefing, `/งาน` `/เสร็จ` `/ยกเลิก` `/สถิติ`.
- Export summarizer (`npm run summarize-export`) for WhatsApp "Export chat" zips.
- Both AI providers (`AI_PROVIDER=openai|claude`).
- Agent index (`scripts/index.mjs`, `AGENTS.md`, `INDEX.md`, this file).

Tests (`npm test`, 34 passing on 2026-11-08): `test/export-parser.test.js`, `test/tasks.test.js` (parsing, time helpers)
and `test/bot.test.js` (end-to-end message handling with a fake WhatsApp socket and canned AI — nothing is sent).

Git: `main`, remote `origin` = https://github.com/chokky-education/whatsapp-agent (**public**). Use fake data only (see AGENTS.md).

## In progress

- (nothing recorded)

## Next steps / ideas

- (none recorded — ask the user)

## Known issues / watch out

- Baileys is unofficial; WhatsApp may ban the number. Use a dedicated bot number.
- The bot only sees messages while it is running.

## Log

- 2026-11-08 — git init; replaced real names/WhatsApp IDs with fake ones and squashed history before publishing to a public GitHub repo. AGENTS.md: check git log at start; fake data only.
- 2026-11-08 — Narrowed agent setup to the user's tools (Codex, Antigravity, Claude Code): removed GEMINI.md, Copilot and Cursor pointer files.
- 2026-11-08 — Added agent index system: AGENTS.md, generated INDEX.md, HANDOFF.md, scripts/index.mjs, CLAUDE.md pointer.
