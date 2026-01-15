import json
import math
import sys
from pathlib import Path


PLACE_WEIGHTS = {
    "city": 50000,
    "town": 10000,
    "village": 2000,
    "hamlet": 300,
    "suburb": 5000,
    "neighbourhood": 3000,
    "locality": 1500,
    "quarter": 800,
    "district": 1500,
    "borough": 2500,
    "settlement": 600,
    "isolated_dwelling": 150,
}


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


def read_geojson(path):
    with path.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    return data.get("features", [])


def estimate_population(properties, kind):
    if not properties:
        return PLACE_WEIGHTS.get(kind, 500)
    for key in ["population", "pop", "pob"]:
        value = properties.get(key)
        if value not in (None, ""):
            try:
                val = float(value)
                if math.isfinite(val) and val > 0:
                    return int(val)
            except Exception:
                pass
    return PLACE_WEIGHTS.get(kind, 500)


def build_pop_points(features):
    points = []
    for feature in features:
        props = feature.get("properties", {}) or {}
        geometry = feature.get("geometry", {})
        coords = geometry.get("coordinates") or []
        if not coords or len(coords) < 2:
            continue
        lon, lat = coords[:2]
        try:
            lat = float(lat)
            lon = float(lon)
        except Exception:
            continue
        kind = (props.get("place") or "").strip().lower() or "settlement"
        pop_est = estimate_population(props, kind)
        name = props.get("name") or props.get("place_name") or f"{kind} @ {lat:.3f},{lon:.3f}"
        osm_id = props.get("osm_id") or feature.get("id") or f"{lat:.4f}_{lon:.4f}"
        points.append(
            {
                "id": f"pp_{str(osm_id)}",
                "name": name,
                "lat": lat,
                "lon": lon,
                "pop_est": pop_est,
                "kind": kind,
            }
        )
    return points


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, separators=(",", ":"))


def main():
    places_path = Path("data/raw/es/places.geojson")
    if not places_path.exists():
        print("Missing source file for place points:", places_path)
        sys.exit(1)

    features = read_geojson(places_path)
    points = build_pop_points(features)
    output_path = Path(sys.argv[1]) / "pop_points_es.json" if len(sys.argv) > 1 else Path("public/data/es/pop_points_es.json")
    write_json(output_path, points)
    print(f"Pop points written: {output_path} ({human_size(output_path)}) with {len(points)} entries.")


if __name__ == "__main__":
    main()
