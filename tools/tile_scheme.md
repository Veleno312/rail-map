# Tile ID Scheme

This helper documents the **tile ID scheme** used by the offline pipeline and tiles loader (Project State `[3.1]`).

## Format

- **ID template**: `tile-{zoom}-{x}-{y}` (e.g., `tile-06-039-052`).
- Zoom is the Web Mercator zoom level (0..24).  
- `x` is the column (wraps horizontally).  
- `y` is the row (clamped between 0 and `2^zoom - 1`).  
- Tiles are always square (256 px) but only the identifiers and metadata are tracked offline.

## Neighbors

Each tile has eight neighbors: the four cardinal directions plus diagonals. The CLI `tools/tile_scheme.js` prints them, using the same format:

| Direction | Offset       |
|-----------|--------------|
| north     | `dx=0, dy=-1` |
| south     | `dx=0, dy=+1` |
| east      | `dx=+1, dy=0` |
| west      | `dx=-1, dy=0` |
| north-east | `dx=+1, dy=-1` |
| north-west | `dx=-1, dy=-1` |
| south-east | `dx=+1, dy=+1` |
| south-west | `dx=-1, dy=+1` |

Horizontal wrapping keeps `x` within `[0, 2^zoom - 1]`. Vertical neighbors are clamped at the poles.

## CLI usage

```sh
node tools/tile_scheme.js --lat 40.4 --lon -3.7 --zoom 6
node tools/tile_scheme.js --tile tile-6-35-20
```

The script prints the canonical tile ID, its X/Y/Z coordinates, and every neighbor direction so downstream tools can reason about adjacency during import/export.
