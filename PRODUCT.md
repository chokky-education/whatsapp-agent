# Product

<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
Cloudflare Workers with Static Assets, D1, scheduled checks and Google sign-in, approved after Q31. Existing Node ESM WhatsApp bot remains on Mac. Plain HTML/CSS/JavaScript for this focused app.

## Users
Thai-speaking team members check bot health and AI provider/model by capability. Administrators investigate failures, manage members and pause alerts.

## Product Purpose
Show what is known about the bot's ability to work, when that evidence was received, and what needs attention. Continue to show last known information when the bot's Mac is unavailable.

## Operating Context
Desktop and mobile browsers, individual Google accounts, shared Gmail for alerts. The private dashboard receives aggregate metadata only. See docs/PLAN-warroom-status.md for Q1–Q31 decisions.

## Capabilities and Constraints
Six overview areas: host contact, WhatsApp, real-message activity, queues, incidents/recovery guidance, AI provider/models. No raw chats, group names, client names, phone numbers, restart controls or synthetic WhatsApp probes. Admin-only membership and timed pauses. Status every30s, stale2m, first alert5m, hourly repeats, history30d. The initial administrator is configured privately. Google OAuth and verified email delivery setup remain outstanding.

## Evidence on Hand
Approved interview/design in docs/PLAN-warroom-status.md and source audits. No existing web design or branding assets. Any demonstration data must be clearly labelled synthetic.

## Product Principles
- Evidence and its age travel together.
- Connected, sent and delivered are different facts.
- Quiet conversations are not failures.
- Monitoring must not block the bot.
- Provider/model visibility is first-class.
