# Garment sources

`polo.source.glb` is the shirt as it was generated — a Tripo export like the characters,
28 MB and 982,850 triangles, with a sealed hem and photogrammetry UVs scattered across the
whole of a 4K atlas. It is kept so the bake can be re-run at a different triangle budget or
with a different cut.

`npm run bake-garment` turns it into `polo.glb`: hem opened, simplified to ~4,500 triangles,
its own texture dropped, and fresh cylindrical UVs projected on so a design can be painted
where it was drawn. See [bake-garment.mjs](../../scripts/bake-garment.mjs).

Unlike the characters, the baked output is committed rather than gitignored — at ~100 KB it
costs nothing, and it keeps `npm run build` working on a fresh clone without another bake
step. `assets/characters/*.glb` are megabytes each, which is why those are not.
