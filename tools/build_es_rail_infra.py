import json
import math
import sys
from pathlib import Path


def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return r * c


def read_geojson(path):
    with path.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    return data.get("features", [])


def iter_line_coords(geometry):
    if not geometry:
        return
    geom_type = geometry.get("type")
    coords = geometry.get("coordinates")
    if geom_type == "LineString" and isinstance(coords, list):
        yield coords
    elif geom_type == "MultiLineString" and isinstance(coords, list):
        for segment in coords:
            if isinstance(segment, list):
                yield segment


class NodeRegistry:
    def __init__(self, precision=6):
        self.precision = precision
        self.map = {}
        self.nodes = []
        self.coord_for_id = {}
        self.counter = 0

    def key(self, lat, lon):
        return (round(lat, self.precision), round(lon, self.precision))

    def get_or_create(self, lat, lon):
        k = self.key(lat, lon)
        node_id = self.map.get(k)
        if node_id:
            return node_id
        self.counter += 1
        node_id = f"rn_es_{self.counter:06d}"
        self.map[k] = node_id
        lat_f = float(k[0])
        lon_f = float(k[1])
        self.nodes.append({"id": node_id, "lat": lat_f, "lon": lon_f})
        self.coord_for_id[node_id] = (lat_f, lon_f)
        return node_id


class LinkCollector:
    def __init__(self):
        self.links = []
        self.link_keys = set()
        self.counter = 0

    def add(self, a, b, distance, max_speed):
        if a == b:
            return
        key = tuple(sorted((a, b)))
        if key in self.link_keys:
            return
        self.link_keys.add(key)
        self.counter += 1
        link_id = f"rl_es_{self.counter:06d}"
        self.links.append(
            {
                "id": link_id,
                "a": a,
                "b": b,
                "distance_km": distance,
                "max_speed_kmh": max_speed,
            }
        )


def max_speed_for_feature(properties):
    rail_tag = properties.get("railway", "")
    if rail_tag == "highspeed":
        return 250
    if rail_tag == "rail":
        return 120
    if rail_tag == "light_rail":
        return 80
    return 100


def build_spatial_index(nodes, bucket_size=0.01):
    grid = {}
    for node in nodes:
        lat = node["lat"]
        lon = node["lon"]
        key = (int(lat / bucket_size), int(lon / bucket_size))
        grid.setdefault(key, []).append(node)
    return grid, bucket_size


def find_nearest(lat, lon, grid, bucket_size, max_km=0.5):
    base_x = int(lat / bucket_size)
    base_y = int(lon / bucket_size)
    best = None
    best_dist = None
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            bucket = grid.get((base_x + dx, base_y + dy))
            if not bucket:
                continue
            for node in bucket:
                dist = haversine_km(lat, lon, node["lat"], node["lon"])
                if dist <= max_km and (best_dist is None or dist < best_dist):
                    best = node
                    best_dist = dist
    return best


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, separators=(",", ":"))


def build_link_adjacency(link_collector, node_coords):
    adjacency = {}
    max_edge = 0.0
    for link in link_collector.links:
        a = link["a"]
        b = link["b"]
        adjacency.setdefault(a, set()).add(b)
        adjacency.setdefault(b, set()).add(a)
        a_coord = node_coords.get(a)
        b_coord = node_coords.get(b)
        if a_coord and b_coord:
            dist = haversine_km(a_coord[0], a_coord[1], b_coord[0], b_coord[1])
            max_edge = max(max_edge, dist)
    return adjacency, max_edge


def compute_components(adjacency):
    visited = set()
    components = 0
    for node in adjacency:
        if node in visited:
            continue
        components += 1
        stack = [node]
        while stack:
            current = stack.pop()
            if current in visited:
                continue
            visited.add(current)
            for neighbor in adjacency.get(current, []):
                if neighbor not in visited:
                    stack.append(neighbor)
    return components


def main():
    stations_path = Path("data/raw/es/stations.geojson")
    tracks_path = Path("data/raw/es/tracks.geojson")
    missing = [p for p in (stations_path, tracks_path) if not p.exists()]
    if missing:
        print("Missing input files needed for build_es_rail_infra.py:")
        for path in missing:
            print(f" - {path}")
        print("")
        print("Run `npm run data:es:geojson` to generate them.")
        sys.exit(1)

    station_features = read_geojson(stations_path)
    track_features = read_geojson(tracks_path)

    node_registry = NodeRegistry()
    link_collector = LinkCollector()

    station_records = []
    for feature in station_features:
        geometry = feature.get("geometry")
        if not geometry:
            continue
        coords = geometry.get("coordinates")
        if not coords or len(coords) < 2:
            continue
        lon, lat = coords
        station_id = f"st_es_{feature.get('id') or len(station_records)+1}"
        name = feature.get("properties", {}).get("name") or f"Station {station_id}"
    station_records.append(
        {
            "id": station_id,
            "name": name,
            "lat": float(lat),
            "lon": float(lon),
                "country": "ES",
                "rail_node_id": None,
            }
        )

    for feature in track_features:
        geometry = feature.get("geometry") or {}
        properties = feature.get("properties", {})
        max_speed = max_speed_for_feature(properties)
        for segment in iter_line_coords(geometry):
            prev_node = None
            for coord in segment:
                if not coord or len(coord) < 2:
                    continue
                lon, lat = coord
                this_node = node_registry.get_or_create(float(lat), float(lon))
                if prev_node:
                    coord_a = node_registry.coord_for_id.get(prev_node)
                    coord_b = node_registry.coord_for_id.get(this_node)
                    if coord_a and coord_b:
                        distance = haversine_km(coord_a[0], coord_a[1], coord_b[0], coord_b[1])
                        link_collector.add(prev_node, this_node, distance, max_speed)
                prev_node = this_node

    station_nodes_grid, bucket_size = build_spatial_index(node_registry.nodes)
    assigned = []
    skipped = []
    for station in station_records:
        nearest = find_nearest(station["lat"], station["lon"], station_nodes_grid, bucket_size)
        if nearest:
            station["rail_node_id"] = nearest["id"]
            assigned.append(station)
        else:
            skipped.append(station)

    output_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("public/data/es")
    adjacency, max_edge = build_link_adjacency(link_collector, node_registry.coord_for_id)
    components = compute_components(adjacency)
    write_json(output_dir / "stations_es.json", assigned)
    write_json(output_dir / "rail_nodes_es.json", node_registry.nodes)
    write_json(output_dir / "rail_links_es.json", link_collector.links)

    print(f"Rail graph components: {components}")
    print(f"Maximum edge length: {max_edge:.3f} km")

    print(f"Stations processed: {len(station_records)}")
    print(f"Stations assigned to nodes: {len(assigned)}")
    print(f"Stations skipped: {len(skipped)}")
    print(f"Rail nodes: {len(node_registry.nodes)}")
    print(f"Rail links: {len(link_collector.links)}")
    print(f"Output written to {output_dir}")


if __name__ == "__main__":
    main()
