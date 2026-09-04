# Collaboration artwork

One PNG per brand, named by the `logo` field of its entry in
[shirts.js](../../src/renderer/scene/shirts.js).

## What a design has to be

- **Square PNG, transparent background.** 1024x1024 ideal, 512 minimum.
- **Bold, two colours, high contrast.** The shirt is off-white by default and the character
  behind it is yellow.
- **No small text.** A wordmark needs the centre panel and even there barely reads.
- Bleed to the edges of the canvas to fill the panel: padding inside the PNG becomes
  padding on the shirt.

The reason for all of that is the one number that matters:

| Placement    | Drawn at   | Coordinates                 |
| ------------ | ---------- | --------------------------- |
| `centre`     | **37px**   | u 0.50, v 0.30, size 0.16   |
| `left-chest` | **23px**   | u 0.57, v 0.33, size 0.10   |

Thirty-seven pixels. Those sizes were set by rendering a design at each of several sizes
and looking: at the original 0.10 a bold star came out as a dark blob and a finely drawn
wordmark was invisible, and at 0.22 the print ran off the front of the shirt into the hem
and the collar.

## Designing one

The **Bananino Shirt Studio** shows a design on the character at the size it is really
drawn, next to a magnified view, and will send the finished PNG back:

  https://claude.ai/code/artifact/f0565866-a06a-496b-9a7c-4d3fc218ce15

Otherwise design a square PNG to the rules above and hand it over however you like.

## Adding one

A file here plus one entry in `SHIRTS`, and nothing else — `scripts/build-renderer.mjs`
copies whatever is in this folder rather than naming files, so no build edit is needed:

```js
acme: { label: 'Acme', color: '#1d4ed8', logo: 'acme.png', placement: 'centre' },
```

## Licence

**These files are not covered by this repository's licence.** Every logo here is the
property of the brand it belongs to and is included with their permission, for use on
Bananino's shirt and nothing else. Removing a brand means deleting its PNG and its
registry entry; nothing else refers to it.

The folder is empty today. The shirt ships blank.
