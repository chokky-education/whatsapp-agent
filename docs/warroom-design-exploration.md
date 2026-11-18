# Warroom structural exploration — 2026-11-16

## Current decision

The user rejected all three ops prototypes and requested fresh exploration. The user supplied Bevel on Mobbin as a preferred reference: https://mobbin.com/apps/bevel-ios-4e7bb614-26f2-4464-a26b-9314adeef824 . This is the primary direction reference; the previous A/B/C variants are not approved. Production remains unchanged.

## Evidence and limits

- Linear Triage: https://linear.app/docs/triage — documentation and published image inspected. The actionable unit is an incoming issue; list entries can lead into detailed review. Useful for a problem-first alternative, not the user's visual preference.
- incident.io UI refresh (June 2024): https://incident.io/changelog/ui-refresh-new-design-and-enhanced-user-experience — historical published before/after image inspected. Severity and incident title lead; secondary data recedes. Do not claim this is the complete current app.
- Better Stack: https://betterstack.com/uptime — published overview image inspected. Monitoring evidence and incident investigation are distinct views. Rich historical charts require actual collected history.
- Basecamp: https://basecamp.com/hill-charts — text research only. Its progress visualization is explicitly human-generated; do not reuse this as an automatic bot health score.
- Bevel: https://www.bevel.health/ and https://help.bevel.health/en/articles/10436737 — official page descriptions expose recovery/strain/sleep summaries and drill-down metrics. Mobbin redirected to its public home/login. A direct official image CDN navigation was blocked by browser site-safety policy; no bypass attempted. Exact Mobbin screens, visual typography, and interaction details have NOT been verified.

## Proposed new structure, pending approval

Use a bot-health overview: current-day context, compact evidence-backed status strip (machine contact, WhatsApp, latest send evidence), a plain-language explanation with the next useful action, and a capability-oriented detail workspace. Keep provider/model visible for each capability. Clicking a capability opens its result, age, queue and relevant history. Audit records remain available separately.

This differs structurally from the rejected large-timeline variants: the primary object is a bot capability or problem, not a historical chart. The previous requirement for a dominant first-viewport chart would need an explicit exception if adopting this direction. Retain the prior sidebar/token/accessibility/privacy constraints until the user changes them. No fabricated readiness percentages, message linkage, availability percentages or continuous history.

Need to inspect the user's actual Bevel screen selection before locking visual treatment. Request an accessible logged-in Mobbin tab or selected screenshots; do not infer exact preferred colors, rounded surfaces or type from the app name alone. No new UI implemented in this exploration.

## Bot-health prototype

User authorized trying this direction. Start `node docs/prototypes/serve-warroom.mjs` and visit `http://127.0.0.1:4174/health`. Five scenarios and capability details use synthetic data; history is a fixed labeled example. Inspected desktop and 390px, checked scenarios, details and dialog. This is an exploration based on public descriptions, not a verified copy of Mobbin screens. Production remains unchanged; user feedback pending.

## Color and icon pass

User requested Apple HIG color and Flaticon. Health prototype uses semantic color for confirmed, attention and unknown states, text labels, light/dark and increased-contrast CSS. The main text/state combinations were checked mathematically (minimum 5.93:1 in tested pairs); dark mode and increased contrast were not visually inspected. Uicons regular rounded 3.3.1 from the official npm package are served locally; visible attribution links to Flaticon, and the package license is kept in `docs/prototypes/assets/`. Production is unchanged.

## Layout pass

User requested Apple HIG layout: https://developer.apple.com/design/human-interface-guidelines/layout . The local health prototype groups capability selection and details side by side when width permits and stacks them at narrower widths; aligns information, retains labels on mobile and accounts for safe-area insets. Browser resizing and selection were checked; actual device, orientation, and enlarged-text visual checks remain outstanding. Production remains unchanged.
