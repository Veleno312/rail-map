import os
import shutil
import subprocess
import sys
from pathlib import Path


INSTALL_HINTS = [
    "Windows (Chocolatey): choco install osmium-tool",
    "WSL/Ubuntu: sudo apt update && sudo apt install osmium-tool",
]


def check_osmium():
    return shutil.which("osmium")


PLACE_TYPES = [
    "city",
    "town",
    "village",
    "hamlet",
    "suburb",
    "neighbourhood",
    "locality",
    "quarter",
    "district",
    "borough",
    "settlement",
    "isolated_dwelling",
]


def human_size(path):
    try:
        size = path.stat().st_size
    except OSError:
        return "N/A"
    for unit in ["B", "KiB", "MiB", "GiB"]:
        if size < 1024.0:
            return f"{size:.1f} {unit}"
        size /= 1024.0
    return f"{size:.1f} TiB"


def run_osmium(parts):
    print("Running:", " ".join(parts))
    try:
        subprocess.run(parts, check=True)
    except subprocess.CalledProcessError as exc:
        print(f"Command failed: {' '.join(parts)}")
        sys.exit(exc.returncode)


def main():
    if len(sys.argv) < 2:
        print("Usage: python tools/gen_es_geojson.py <path/to/data/raw/es/spain-latest.osm.pbf>")
        sys.exit(1)

    input_pbf = Path(sys.argv[1])
    raw_dir = input_pbf.parent
    if input_pbf.name != "spain-latest.osm.pbf":
        print("Expected input file named 'spain-latest.osm.pbf'.")
        sys.exit(1)

    if not input_pbf.exists():
        print(f"Input file not found: {input_pbf}")
        sys.exit(1)

    osmium_bin = check_osmium()
    if not osmium_bin:
        print("`osmium` CLI tool is required but not found on PATH.")
        print("Install it with one of the following commands:")
        for hint in INSTALL_HINTS:
            print("  -", hint)
        sys.exit(1)

    raw_dir.mkdir(parents=True, exist_ok=True)
    stations_osm = raw_dir / "stations.osm.pbf"
    tracks_osm = raw_dir / "tracks.osm.pbf"
    stations_geojson = raw_dir / "stations.geojson"
    tracks_geojson = raw_dir / "tracks.geojson"
    places_osm = raw_dir / "places.osm.pbf"
    places_geojson = raw_dir / "places.geojson"

    run_osmium([osmium_bin, "tags-filter", str(input_pbf), "n/railway=station,n/railway=halt", "-o", str(stations_osm)])
    run_osmium([osmium_bin, "tags-filter", str(input_pbf), "w/railway=rail,w/railway=light_rail,w/railway=highspeed", "-o", str(tracks_osm)])
    run_osmium([osmium_bin, "tags-filter", str(input_pbf), f"n/place={','.join(PLACE_TYPES)}", "-o", str(places_osm)])
    run_osmium([osmium_bin, "export", str(stations_osm), "-o", str(stations_geojson)])
    run_osmium([osmium_bin, "export", str(tracks_osm), "-o", str(tracks_geojson)])
    run_osmium([osmium_bin, "export", str(places_osm), "-o", str(places_geojson)])

    print("\nGeoJSON generation complete:")
    for path in [stations_geojson, tracks_geojson, places_geojson]:
        print(f" - {path}: {human_size(path)}")


if __name__ == "__main__":
    main()
