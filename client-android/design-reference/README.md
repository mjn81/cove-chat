# Mobile design reference (anchor: `client-web`)

Screenshots of the web client at a phone viewport (390x844 CSS px, DPR 2, dark theme unless noted),
captured against a local backend. The Android client must reproduce these screens pixel-for-pixel
in layout, spacing, colour and typography.

| File | Screen |
|---|---|
| 01-connect | Server selection (first step; user types the server domain) |
| 02-login / 03-register | Auth |
| 04 / 11 | Conversation list (tabs: all / DMs / channels, search, `+`, user footer) |
| 05 / 06 / 07 | New conversation dialog (Direct Message / Channel tabs) |
| 08 / 09 | Chat view (topbar, welcome header, day separator, message rows, input bar) |
| 10 | Members panel |
| 12 / 13 | Conversation-list tabs (DMs, Explore) |
| 14 | Channel settings |
| 15-17 | Settings (menu, Appearance, Account) |
| 18-20 | Light theme |

## Design tokens (from `client-web/src/index.css`, HSL)
Dark (default): background `#313338`, card/secondary/muted `#2b2d31`, popover/border/input `#1e1f22`,
foreground `#F2F3F5`, muted-foreground `#949BA4`, accent `#3f4147`, primary `#5865F2`,
destructive `#FA777C`, radius 8dp. Light: background `#FFFFFF`, card/secondary/muted `#F2F3F5`,
accent/border `#E3E5E8`, muted-foreground `#4E5058`, foreground `#060607`.
Font: Vazirmatn (variable, `client-web/public/Vazirmatn-VariableFont_wght.ttf`). Icons: lucide.
Layout on mobile: one pane at a time (list -> chat via back arrow; settings is a full-screen menu then sub-pages).
