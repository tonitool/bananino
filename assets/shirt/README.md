# Collaboration artwork

One PNG per brand, named by the `logo` field of its entry in
[looks.js](../../src/renderer/scene/looks.js). A collaboration is that one entry — colour,
pattern, artwork — plus this one file. The entry dresses the cap and the shirt together, so
a brand gets an outfit rather than two things that have to be kept in step.

## The two surfaces

| Surface       | Drawn at    | Shape        | Coordinates                        |
| ------------- | ----------- | ------------ | ---------------------------------- |
| **Cap front** | **30x14px** | 2.2:1 wide   | u 0.50, v 0.48, size 0.20          |
| Shirt centre  | 37x37px     | square       | u 0.50, v 0.30, size 0.16          |
| Shirt L chest | 23x23px     | square       | u 0.57, v 0.33, size 0.10          |

The cap is the surface to design for, even though the shirt's box is bigger. The crown
front stands nearly vertical and faces the camera; the chest curves away and has arms
either side of it. The cap also sits at eye level in the silhouette, and it fits the Cat,
which the shirt never will.

Its box is **2.2 times wider than tall**, which is what a cap is really printed at — so a
wordmark or a wide mark belongs on the hat, and a round mark on the chest. A square logo
still works: it is scaled to fit the height and centred.

## What a design has to be

- **PNG with a transparent background.** 1024px on the long edge.
- **Wide for the cap** — roughly 2.2:1 fills its box exactly. Square is fine and lands
  smaller.
- **Bold, two colours, high contrast.** Both garments sit against a yellow character.
- **No small text.** Fourteen pixels of height holds two or three heavy glyphs, and that is
  being generous.
- Bleed to the edges of the canvas to fill the box. Padding inside the PNG becomes padding
  on the garment.

Every size above was set by rendering a design at it rather than by taste. A square print
on the crown was tried first and wrapped the whole dome, foreshortening into a smear; on
the shirt, the original 0.10 turned a bold star into a dark blob and made a finely drawn
wordmark vanish outright.

## Designing one

The **Bananino Shirt Studio** shows a design on the character at the size it is really
drawn, next to a magnified view:

  https://claude.ai/code/artifact/f0565866-a06a-496b-9a7c-4d3fc218ce15

It previews the shirt only, and predates the cap.

## Adding one

A file here plus one entry in `LOOKS`, and nothing else — `scripts/build-renderer.mjs`
copies whatever is in this folder rather than naming files, so no build edit is needed:

```js
acme: { label: 'Acme', color: '#1d4ed8', brim: '#12328f', logo: 'acme.png' },
```

Then add the id to `LOOK_MENU` in `src/main/constants.js`; `test/looks.test.mjs` fails if
you forget, and if the PNG is missing.

## Licence

**These files are not covered by this repository's licence.** Every logo here is the
property of the brand it belongs to and is included with their permission, for use on
Bananino and nothing else. Removing a brand means deleting its PNG and its registry entry;
nothing else refers to it.

The folder is empty today. Bananino wears its clothes plain.
