# Use one task list for Warroom and WhatsApp

For the planned pilot, the bot's SQLite task list is authoritative for Warroom and WhatsApp because the existing commands, reminders, and scheduled reports already use it. Warroom will show the last synchronized task list when the bot is offline, and will confirm a web completion only after the bot records it in that same list.

Group access comes from an administrator-approved mapping between the member's Google account and WhatsApp identity. Members can view tasks in their authorized groups and complete only tasks assigned to them. Completions appear in the existing WhatsApp task commands and scheduled reports.
