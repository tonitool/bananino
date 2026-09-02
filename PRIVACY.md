# Privacy

lualala runs entirely on your Mac. There is no account, no telemetry, no analytics, and no
server belonging to this app.

## What it stores, and where

**Notes and time entries** — plain files in the folder you choose, by default
`~/Documents/lualala`:

- `notes/YYYY-MM-DD.md` — one Markdown file per day
- `time/YYYY-MM.csv` — one CSV per month

**Clipboard history** — `~/Library/Application Support/lualala/clips.json`, capped at 100
entries. This is **not encrypted**. Anything you copy while the feature is on may be
recorded, so it is worth knowing:

- Text a password manager marks as concealed, transient, or auto-generated is never
  recorded. If the pasteboard cannot be inspected, the entry is dropped rather than risked.
- You can turn capture off entirely: menu bar icon → **Remember clipboard**.
- **Clear unpinned** in the Clips tab empties the history.

**Settings** — `~/Library/Application Support/lualala/pet-state.json`.

**Your MOCO API key** — encrypted with macOS `safeStorage`, which is backed by your login
Keychain. It is never written in plain text and never logged.

## What leaves your Mac

Only these, and only when you ask:

- **MOCO** — pushing queued time sends the date, duration, description, and project and
  task ids to your own MOCO account. Nothing is sent until you press **Push**.
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
rm -rf ~/Library/Application\ Support/lualala
```
