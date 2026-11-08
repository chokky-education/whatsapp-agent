# AGENTS.md — WhatsApp group summarizer bot

Shared instruction file for the agents used on this project: **Codex**, **Antigravity** and **Claude Code**.
Codex and Antigravity read this file directly; Claude Code reads `CLAUDE.md`, which imports this file.
Keep every rule here. Don't add `GEMINI.md` (Antigravity would load it as well, duplicating or contradicting this file).

Agents take turns on this project and don't share memory. Anything the next agent needs (decisions,
progress, the user's preferences) must be written into the repo (`HANDOFF.md`), not left in a
tool-specific place such as Claude memory, Codex session history or Antigravity's global rules.

Node ≥ 22.5 ESM app. Logs into WhatsApp as a linked device (Baileys), stores group messages in
SQLite (`data/messages.db`), has AI describe images/PDFs, posts Thai summaries, and tracks tasks and
reminders. AI provider is `AI_PROVIDER=claude|openai` (`src/ai.js`). User-facing docs are in Thai (`README.md`).

## Starting a session (do this first)

1. Read `HANDOFF.md` — current state, what's in progress, what's next, known problems.
   Then `git status` and `git log --oneline -10` to see uncommitted work and what the last agent did.
2. Read `INDEX.md` — generated map: task → file, every file's purpose and exported symbols with line numbers, DB schema.
3. Find things with the index instead of scanning the tree:
   ```bash
   node scripts/index.mjs files "tasks"                 # file names + symbols
   node scripts/index.mjs search "snooze reminder"      # content; every word must match; Thai works
   node scripts/index.mjs search "cron" --path src/ --brief
   node scripts/index.mjs show <id> --around nag --context 4
   ```
   Every command refreshes changed files first. Output is capped (`--max-chars`). `--json` gives
   machine-readable output. Source files are the truth; the index is only a way to find them.
   If nothing matches, try other words, then `grep -rn` inside `src/`.

## Rules

- **Privacy.** `data/` holds real group chats, phone-number JIDs and WhatsApp login keys (`data/auth/`);
  `output/` holds summaries of real chats; `.env` holds API keys. Don't print, copy, commit, upload or
  paste their contents into prompts, logs or docs. Inspect the DB with schema queries or counts, not row dumps.
  Never delete `data/auth/` unless the user asks (it logs the bot out).
- **This repo is public** (github.com/chokky-education/whatsapp-agent). Tests, evals, examples and comments must use
  made-up data only: fake JIDs like `100000000000001@lid`, phone `66800000000`, names like Nok/Somchai, group
  `EXAMPLE STUDIO`. Never paste real phone numbers, JIDs, member names, group names or chat lines from `data/`
  or an export. Check `git diff --cached` for them before every commit.
- **Don't send WhatsApp messages** (don't start `npm start` against real groups) without the user's OK.
  Test logic with `npm test` or with the export path: `npm run summarize-export -- <zip> --transcript` (no AI calls).
- AI calls go through `src/ai.js` (`ask`, `askJSON`) so both providers keep working. Don't call an SDK directly elsewhere.
- In `src/tasks.js` the AI only proposes structured actions; code applies them and writes the confirmation text.
  Keep it that way so the bot never claims something it didn't do.
- Times are Asia/Bangkok via a fixed offset (`config.utcOffsetHours`), stored as unix seconds.
- New config goes in `src/config.js` **and** `.env.example` (with a Thai comment), and in `README.md` if users set it.
- Bot replies and README are Thai; code, comments and these agent docs are English.

## Checks

```bash
npm test                              # node --test test/*.test.js
node --check src/<file>.js            # syntax check for files without tests
```

## Before you finish (handoff)

1. Run the checks above; report failures honestly.
2. Update `HANDOFF.md`: what changed, current status, next steps, open questions. Add one line to its log.
3. If you added/moved/renamed a file or a feature area, add a row to `ROUTES` in `scripts/index.mjs`.
4. Run `node scripts/index.mjs refresh` (regenerates `INDEX.md`) and confirm your change is findable
   with a `files` or `search` command. Never edit `INDEX.md` by hand.
5. Update `README.md` if user-visible behavior or commands changed.
6. Commit only when the user asks. Use a message that says what changed and why, so the next agent can read
   `git log`. Never commit `.env`, `data/`, `output/` or `.local-index/` (they are in `.gitignore`).
