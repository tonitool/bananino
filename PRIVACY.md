# Privacy

Bananino runs entirely on your Mac. There is no account, no telemetry, no analytics, and no
server belonging to this app.

## What it stores, and where

**Notes and time entries** — plain files in the folder you choose, by default
`~/Documents/bananino`:

- `notes/YYYY-MM-DD.md` — one Markdown file per day
- `time/YYYY-MM.csv` — one CSV per month

**Clipboard history** — `~/Library/Application Support/Bananino/clips.json`, capped at 100
entries. This is **not encrypted**. Anything you copy while the feature is on may be
recorded, so it is worth knowing:

- Text a password manager marks as concealed, transient, or auto-generated is never
  recorded. If the pasteboard cannot be inspected, the entry is dropped rather than risked.
- You can turn capture off entirely: menu bar icon → **Remember clipboard**.
- **Clear unpinned** in the Clips tab empties the history.

**Settings** — `~/Library/Application Support/Bananino/pet-state.json`.

**Your MOCO API key** — encrypted with macOS `safeStorage`, which is backed by your login
Keychain. It is never written in plain text and never logged.

**Your Composio API key** — same treatment as the MOCO key: encrypted with `safeStorage`,
never plain text, never logged, sent only to Composio. Connection identifiers (the auth
config and account IDs) are not secrets and live in `pet-state.json`.

## What leaves your Mac

Only these, and only when you ask:

- **MOCO** — pushing queued time sends the date, duration, description, and project and
  task ids to your own MOCO account. Nothing is sent until you press **Push**.
- **Calendar via Composio** — if you connect the Calendar tab, Bananino asks Composio
  (who hold the Microsoft sign-in for your account) for your upcoming events, roughly
  once a minute while linked. Event titles, times and join links pass through Composio's
  servers to reach your Mac; meeting creation goes the same way in the other direction.
  Microsoft and Composio's own privacy policies apply to that pipe. Disconnecting forgets
  the key and the link.
- **Update checks** — if a repository is configured, the app asks the GitHub Releases API
  whether a newer version exists. It sends no information about you.
- **Ask an assistant** — right-clicking a note and choosing ChatGPT, Claude or Gemini opens
  that service in your browser with the note's text. That text then reaches a third party,
  under their privacy policy, and only for the note you picked.

Nothing else is transmitted. There is no crash reporting and no usage tracking.

## Deleting your data

Notes and time entries are your files; delete them like any other. To remove everything the
app keeps for itself:

```bash
rm -rf ~/Library/Application\ Support/bananino
```
