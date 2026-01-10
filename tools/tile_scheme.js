#!/usr/bin/env node
/* global process */

const DIRECTION_OFFSETS = [
  { direction: "north", dx: 0, dy: -1 },
  { direction: "south", dx: 0, dy: 1 },
  { direction: "east", dx: 1, dy: 0 },
  { direction: "west", dx: -1, dy: 0 },
  { direction: "north-east", dx: 1, dy: -1 },
  { direction: "north-west", dx: -1, dy: -1 },
  { direction: "south-east", dx: 1, dy: 1 },
  { direction: "south-west", dx: -1, dy: 1 }
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function wrap(value, modulus) {
  const v = value % modulus;
  return (v + modulus) % modulus;
}

export function latLonToTile(lat, lon, zoom) {
  const normalizedZoom = clamp(Math.round(Number(zoom) || 0), 0, 24);
  const latRad = (clamp(Number(lat) || 0, -85, 85) * Math.PI) / 180;
  const n = 2 ** normalizedZoom;
  const x = Math.floor(((Number(lon) || 0) + 180) / 360 * n);
  const y = Math.floor(
    (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n
  );
  return {
    z: normalizedZoom,
    x: clamp(x, 0, n - 1),
    y: clamp(y, 0, n - 1)
  };
}

export function formatTileId(tile) {
  return `tile-${tile.z}-${tile.x}-${tile.y}`;
}

export function parseTileId(id) {
  const match = /^tile-(\d+)-(\d+)-(\d+)$/.exec(id?.trim() || "");
  if (!match) throw new Error(`Invalid tile id: ${id}`);
  return {
    z: Number(match[1]),
    x: Number(match[2]),
    y: Number(match[3])
  };
}

export function tileNeighbors(tile) {
  const n = 2 ** tile.z;
  return DIRECTION_OFFSETS.map(({ direction, dx, dy }) => {
    const neighborX = wrap(tile.x + dx, n);
    const neighborY = clamp(tile.y + dy, 0, n - 1);
    return {
      direction,
      tile: { z: tile.z, x: neighborX, y: neighborY },
      id: formatTileId({ z: tile.z, x: neighborX, y: neighborY })
    };
  });
}

function usage() {
  console.log(`
Tile ID scheme helper

Usage:
  node tools/tile_scheme.js --lat <deg> --lon <deg> --zoom <z>
  node tools/tile_scheme.js --tile tile-<z>-<x>-<y>
  node tools/tile_scheme.js --help

Tiles follow the “tile-zoom-x-y” format (Web Mercator / Slippy map). When zoom is provided,
coordinates are converted and all 8 neighboring tiles are shown (north/east/south/west plus diagonals).
`);
}

function parseArgs(argv) {
  const options = { help: false, lat: null, lon: null, zoom: null, tile: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "--lat" && i + 1 < argv.length) {
      options.lat = Number(argv[++i]);
      continue;
    }
    if (arg === "--lon" && i + 1 < argv.length) {
      options.lon = Number(argv[++i]);
      continue;
    }
    if (arg === "--zoom" && i + 1 < argv.length) {
      options.zoom = Number(argv[++i]);
      continue;
    }
    if (arg === "--tile" && i + 1 < argv.length) {
      options.tile = argv[++i];
      continue;
    }
    console.warn("Ignoring unknown argument:", arg);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    process.exit(0);
  }
  let tile;
  try {
    if (options.tile) {
      tile = parseTileId(options.tile);
    } else if (options.lat !== null && options.lon !== null && options.zoom !== null) {
      tile = latLonToTile(options.lat, options.lon, options.zoom);
    } else {
      usage();
      process.exit(1);
    }
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }

  console.log("Tile ID:", formatTileId(tile));
  console.log(`Zoom: ${tile.z}  X: ${tile.x}  Y: ${tile.y}`);
  console.log("Neighbors:");
  tileNeighbors(tile).forEach((neighbor) => {
    console.log(`  ${neighbor.direction}: ${neighbor.id}`);
  });
}

if (process.argv[1].endsWith("tile_scheme.js")) {
  main();
}
