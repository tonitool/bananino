# Bananino

A 3D banana buddy that lives in the corner of your Mac. Brush the corner with your cursor
and it slides in; click it and it hands you a panel for **notes**, **fast time tracking**,
and **clipboard history**. Everything is stored as plain files on your own disk.

![the character](resources/icon.png)

## Install on a Mac (no build needed)

1. Download `Bananino-*-arm64.dmg` from
   [**Releases**](https://github.com/tonitool/bananino/releases).
2. Open the DMG and drag **Bananino** into **Applications**.
3. The app is unsigned, so macOS blocks the first launch. Clear the browser's
   quarantine flag once in Terminal, then it launches normally for good:

   ```bash
   xattr -dr com.apple.quarantine /Applications/Bananino.app
   ```

   If you already double-clicked and got **"damaged"** or **"Apple could not
   verify…malware"**, press **Done** (never Move to Bin), then either run the
   command above or go to **System Settings → Privacy & Security**, scroll to
   the Security section, and click **Open Anyway** next to Bananino.
4. Optional: add it under **System Settings → General → Login Items** so it
   starts with your Mac.

First meeting transcription downloads the Whisper model (~490 MB) from
HuggingFace on demand — nothing else to install. Meeting summaries use a local
[Ollama](https://ollama.com) model if one is running, which is optional.

Apple Silicon (arm64) only.

## Run from source

```bash
npm install
npm start
```

## Build a real app

```bash
npm run optimise-model   # first time only: generates the characters from their source models
npm run dist
```

Produces `release/mac-arm64/Bananino.app`. Drag it to `/Applications`, then add it under
**System Settings → General → Login Items** to have it there at startup.

It is unsigned, so the first launch needs a right-click → **Open** (or
`xattr -dr com.apple.quarantine /Applications/Bananino.app`).

## Cutting a release

Releases are built on a macOS runner, because the build needs `swiftc`, `codesign` and
`hdiutil` — so it does not depend on which machine is to hand:

```bash
npm version 1.2.0 -m 'Release %s'   # or edit package.json and commit
git push origin main --follow-tags
```

Pushing a `v*` tag runs [.github/workflows/release.yml](.github/workflows/release.yml),
which tests, generates the models, packages, and publishes the DMG and ZIP to the GitHub
release for that version. The tag has to match `package.json`, or the run stops before
publishing anything — electron-builder publishes to the version, not the tag, and the two
disagreeing means the download does not say what the tag says.

`npm run release` does the same thing locally, on a Mac.

## Waking it up

By default the buddy is hidden. It appears when your cursor rests in the **bottom-right
corner** for a moment, and tucks itself away again once you have been elsewhere for about
a second. The corner is configurable in the menu bar icon, as is **Always visible** if you
would rather it just stayed out.

> **macOS Quick Note uses the bottom-right hot corner too.** Turn it off under
> **System Settings → Desktop & Dock → Hot Corners** so only one of them fires, or move
> Bananino to a different corner.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| `⌃⌥Space` | Open / close the panel |
| `⌃⌥N` | Open the panel on a fresh note |
| `⌃⌥T` | Start or stop the timer on your last task |
| `⌃⌥V` | Open clipboard history |

If another app already owns one of these, it is skipped and a line is logged — nothing
breaks. They are listed in the menu bar icon's menu too.

## The panel

One view at a time — **Time · Note · Clips · Meet · Cal** — because a single screen holding
all of them left every part too small, and overlapping whenever one grew. A running timer is
the one thing shown on every view, as a slim strip you can click to jump back to Time.
**Settings** is a sixth view without a tab: right-click the character → **Settings…**, and
**Done** puts you back on the view you came from.

**Time** is the timer and its MOCO status. Recent tasks are one-tap chips; typing at least
two letters searches your MOCO projects. While a timer runs there is a **description**
field — MOCO records *what you did* separately from which task it books to.

**Note** is a text box. `⌘↵` saves. Notes land in today's Markdown file, stamped with the
time, and the last few show underneath.

**Clips** is your clipboard history: click a row to copy it back, `★` to pin it so it
never ages out, `×` to forget it.

The panel always opens *away* from the anchored corner — upwards from the bottom corners,
downwards from the top ones — and the window's width never changes. Both are so that the
character stays at exactly the same place on screen when the panel opens, instead of
sliding out from under your cursor mid-click.

## Interacting with the character

| Gesture | What happens |
| --- | --- |
| Move the cursor anywhere | It turns to follow you |
| Click | Opens / closes the panel |
| Double-click | Full spin |
| Drag | Carried around (in **Always visible** mode) |
| Right-click | The full menu |
| Leave it alone | It fidgets and mutters to itself |

Everywhere the character is *not* drawn, clicks pass straight through to whatever is
underneath — including the empty air inside the character's own square, so clicking beside
it never starts a phantom drag.

Two of those only apply in **Always visible** mode. Dragging is pointless while docked
(the corner is its home, so it returns there), and the idle fidget never gets a chance
because the character hides about a second after your cursor leaves.

## Who lives in your corner

Right-click the character (or click the menu bar icon) → **Settings…** and pick one:
**Bananino** or the **Cat**. The choice is remembered, and the app boots straight into it —
the model is handed to the window at launch, so a restart never flashes the character you
left behind.

Switching swaps the mesh inside the existing rig, which is why nothing else has to move:
the pose, the costume, the radio and the clock all belong to the rig rather than to the
body. Everything measured off the body — where a hat sits, how far out the props stand —
is re-measured against the new one, so a cat does not wear a banana's hat. The model is a
few megabytes, so the card you pressed shows a spinner until it is on stage.

Adding another character is [three lines in
characters.js](src/renderer/scene/characters.js), one entry in `CHARACTER_MENU` in
[constants.js](src/main/constants.js), and a `.source.glb` in `assets/characters/`.

## Dress up

**Settings…**, the menu bar icon and right-click on the character all have **Costume** —
party hat, Santa hat, headphones, shades, crown, beanie — and **Dance**: bounce, sway,
twist, shimmy, headbang, spin, samba. The costume is remembered between launches; dancing
stops when you quit.

The model is a single static mesh with no skeleton, so there is nothing to rig clothing
onto — every costume is built from primitives (cones, tori, cylinders) at runtime. Because
the animation moves the whole rig, anything parented to it follows through hops and dances
for free.

Nothing is positioned by hard-coded numbers. The mesh is probed with raycasts at load to
build a profile of the head, and each accessory seats itself at the height where the head
is as wide as the accessory is. A hat placed at one fixed height either floats above a
dome or sinks into it — and a swapped-in model would put its hat somewhere absurd.

## The shirt

Bananino also has a **Shirt**, in the same three places. It is a separate slot from the
costume, so a crown does not take the shirt off. Only Bananino wears one — the shirt is
modelled for that body, so the row is not offered while the Cat is on stage.

The point of a blank shirt is collaborations. A brand hands over a logo, and it lands on
the chest without anybody touching 3D code: one entry in
[shirts.js](src/renderer/scene/shirts.js) — label, fabric colour, logo filename, print area
— and one PNG in [`assets/shirt/`](assets/shirt/), which the build copies by folder contents
rather than by name.

```js
acme: { label: 'Acme', color: '#1d4ed8', logo: 'acme.png', placement: 'centre' },
```

The shirt itself is a modelled tee, and getting it wearable took a bake and a fit.

**The bake** ([bake-garment.mjs](scripts/bake-garment.mjs)) opens the sealed hem, cuts
982,850 triangles down to ~4,500, throws away the model's own 4K atlas, and projects fresh
cylindrical texture coordinates: `u` around the body with 0.5 at the middle of the chest,
`v` from hem to collar. The original UVs could never have carried a design — the chest alone
sprayed across 83% of the atlas in 83 separate islands, which is what photogrammetry
produces and what a print area cannot be described against.

```bash
npm run bake-garment   # assets/costumes/polo.source.glb -> assets/costumes/polo.glb
```

**The fit** is six numbers on the character in
[characters.js](src/renderer/scene/characters.js), and it is the one place in the app where
placement is hand-tuned rather than measured — because this body defeats measuring. The
banana is a *curve*: its belly juts forward at the hem and its shoulder leans back, so no
axis runs down it and radii at one height vary by nearly three to one. Every attempt to fit
the shirt to a measured surface fought that. So the shirt declares where its hem sits, how
tall, how wide and how deep it is, how far forward it stands and how far back it leans, all
tuned against renders. Width and depth are separate for a reason worth knowing: a shirt's
shoulders taper front-to-back and this character's do not taper at all, so on a single scale
the yoke sinks inside the body and the sleeves read as two loose puffs.

The neckline is not placed. The modelled neck hole is far narrower than a body that is the
same width all the way up, so the collar ends up buried inside the character and what shows
is the yoke running into it — which is what a neckline looks like anyway. An earlier bake cut
the top off to make room for a head that never emerges, and all that achieved was a
strapless tube.

## The samba

Six of the seven dances are formulas — a few sines at different frequencies, in
[dances.js](src/renderer/animation/dances.js). The **samba** is not: it is a real
motion-captured performance, baked down to something a body with no skeleton can play.

A character here is a single static mesh, and the whole per-frame animation surface is
position and rotation on the body plus a scale on the pivot. A 34-joint Mixamo clip cannot
be played on that. But the part of it that reads at a few hundred pixels can:
[bake-dance.mjs](scripts/bake-dance.mjs) samples the clip's hips and spine into the five
numbers a dance may write — sway, bob, lean, tilt, twist — and writes them out as a table
at 15 fps, which costs about 3% error against the ~35 fps source and 13 KB in the bundle.

```bash
npm run bake-dance   # assets/dances/samba.source.glb -> src/renderer/animation/curves/samba.js
```

It prints its own error against the source, which is the only thing that says whether the
baked dance is still the dance that was recorded.

Three things do not survive, and the script says so too: every limb, because there is
nothing to attach one to; fore/aft travel, because the rig pins z to 0; and the hips' yaw,
which in this clip turns the dancer right round as staging. The twist that reads as
*dancing* is the spine's yaw relative to the hips, so that is what is baked. Filtering the
hips' yaw was tried and measured first — it does not work, because the turns are fast
rather than a slow drift, and a one-second high-pass still leaves 330° of them.

Amplitudes are applied at playback, not baked in, because the raw performance is two to
three times bigger than anything else in the app: it travels half a body height and would
walk the banana out of its own canvas.

## MOCO time sync

Connect from the **Time** tab: your MOCO subdomain and a personal API key from
**MOCO → Profile → Integrations**. The key is encrypted with `safeStorage`, which on macOS
is the login Keychain — never written in plain text, never logged.

Typing searches your assigned projects, shown **project first, then your role** — the order
MOCO asks for, and the only way to tell apart two projects that share a role name. Each
entry is dated from when the timer *started*, so today's work books to today.

Stopping a timer **queues** the entry; it is never sent automatically. The bar shows
`3 entries queued · Push`, with **Review** to see them and **×** to discard. These become
billable records, so they are shown before they are submitted.

## Calendar (Outlook / Teams)

The **Cal** tab watches a **published** calendar — Outlook's own share mechanism, no OAuth,
no admin consent, no third-party account:

1. In Outlook: **Settings → Calendar → Shared calendars → Publish a calendar**, pick your
   calendar, choose **full details** (that's what carries Teams join links), copy the
   **ICS** link.
2. Paste it into the **Cal** tab → **Connect**. The link lives Keychain-encrypted on this
   Mac; anyone holding it can read that calendar, so treat it like a password. Outlook can
   revoke it anytime by unpublishing.

Once connected, the buddy keeps an eye on the next ~26 hours: a desk clock turns up beside
it 15 minutes before a meeting, it pops out and says so 5 minutes before and again at
start, and the panel shows a strip with **Join** (the Teams link) and **Record** (starts
meeting transcription straight from there).

The feed is **read-only** with a few minutes' propagation lag — that is the one trade-off;
meeting creation would need write access (OAuth) and returns if that lands later. Any
ICS-serving calendar works, not just Outlook.

## Where your data goes

Everything is plain files in `~/Documents/bananino` (changeable via **Change folder…** —
point it at iCloud Drive, a Dropbox folder, or an Obsidian vault):

```
bananino/
├── notes/2026-09-01.md     one Markdown file per day, newest entry at the bottom
└── time/2026-09.csv        date,start,end,minutes,task
```

The CSV is properly quoted, so tasks containing commas or quotes survive a round trip into
Excel or Numbers.

**Clipboard history** is the exception: it lives in
`~/Library/Application Support/Bananino/clips.json`, capped at 100 entries, because it is a
cache rather than a document. It is **not encrypted**. Clips that a password manager marks
as concealed, transient, or auto-generated are never recorded, and if the pasteboard
cannot be inspected the entry is dropped rather than risked. You can pause capture
entirely from the menu (**Remember clipboard**).

## How it works

The supplied model is a single static mesh — no skeleton, no glTF animations — so every
bit of movement is procedural. Pose layers (idle breathing, float, gaze, hover, drag
momentum, reactions) each produce a small transform delta; they are summed each frame and
applied to a rig whose scale pivot sits at the character's feet, so squash and stretch
push into the floor instead of shrinking towards the middle.

```
src/
├── main/            Electron: window, hot corner, click-through, tray, shortcuts
│   └── storage/     Markdown notes, CSV time log, clip cache, date + CSV helpers
├── preload/         The contextBridge surface the renderer is allowed to use
└── renderer/
    ├── scene/       three.js renderer, camera, lighting, model loading
    ├── animation/   Pose layers, easing, the reaction library
    ├── interaction/ Pixel-accurate hit testing, pointer intent
    ├── state/       Immutable pet state
    └── ui/panel/    Timer strip, note tab, clips tab
```

### Click-through

The window is a transparent rectangle, but only the character should be clickable. The
main process samples the global cursor at 30 Hz and forwards it to the renderer, which
raycasts against the mesh. On a hit, the window stops ignoring mouse events; the moment
the cursor leaves the silhouette it becomes transparent to clicks again. The main process
independently restores click-through if the cursor leaves the window bounds, so a fast
flick cannot leave the window stuck swallowing input. With the panel open the whole window
is a target instead.

### Dismissing the panel

Clicking away closes the panel — but only once focus has actually landed *and settled*.
Claiming focus from another app is not instantaneous, and without both checks the flicker
during activation slams the panel shut the instant it opens.

## Development

```bash
npm run dev      # renderer console + window events mirrored to the terminal
npm run watch    # rebuild the renderer on change
npm test         # geometry and cursor-tracking unit tests
```

Flags that help when tuning. All of them render for a moment and write a PNG of the
composited window, transparency included:

```bash
npx electron . --open-panel=clips --pin-panel --snapshot=/tmp/panel.png:4000
npx electron . --demo=hop --snapshot=/tmp/hop.png:2000
```

| Flag | Purpose |
| --- | --- |
| `--reveal` | Bring the character out without waiting for the hot corner |
| `--open-panel[=note\|clips]` | Start with the panel open on a given tab |
| `--pin-panel` | Stop the panel dismissing itself while a screenshot is taken |
| `--demo=<reaction>` | Play one reaction on launch |
| `--tap[=1\|2]` | Inject a click or double-click on the character |
| `--click=<selector>` | Click the centre of a live element, measured from the layout |
| `--costume=<name>` / `--dance=<name>` | Set the dress-up state |
| `--probe=<expression>` | Evaluate JavaScript in the page and log the result |
| `--meeting-test=<seconds>` | Record for a period, then run the whole meeting pipeline |
| `--snapshot=<path>[:ms]` | Write a PNG of the composited window, then quit |

`--tap` is how the pointer gestures get verified without a human hand:

```bash
npx electron . --dev --tap=2 --pin-panel --snapshot=/tmp/tap.png:5000
```

Reaction names live in [reactions.js](src/renderer/animation/reactions.js): `hop`, `spin`,
`wobble`, `squish`, `stretch`.

## Swapping in your own model

Drop a `.glb` at `assets/characters/<id>.source.glb`, add `<id>` to `CHARACTERS` in
[characters.js](src/renderer/scene/characters.js) and to `CHARACTER_MENU` in
[constants.js](src/main/constants.js), then:

```bash
npm run optimise-model <id>   # ~950k triangles down to ~76k, 28MB down to ~3MB
npm run build
```

The model is normalised to one unit tall and stood on the floor automatically. If it does
not face the camera, try a yaw against whoever is on stage:

```bash
BANANINO_YAW=1.5707963 npm start
```

Once you know the value, set `yaw` on the character in
[characters.js](src/renderer/scene/characters.js). Its `eyeRatio` is the other measurement
worth getting right — how far up the model its face is painted, which is where glasses and
headphones hang. Then regenerate the app icon from the model itself with `npm run icon`.

## Credits

The samba is baked from **"Stickman Samba Dancing (aka the Toothless Dance)"** by
[adu2763](https://sketchfab.com/adu2763), used under
[CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/) —
[original model](https://sketchfab.com/3d-models/stickman-samba-dancing-aka-the-toothless-dance-329a2840e54e4ad59452cfcb4e53c9a8).
No mesh or texture from it ships; the app carries a table of body motion derived from its
animation, which is a derivative work all the same.
