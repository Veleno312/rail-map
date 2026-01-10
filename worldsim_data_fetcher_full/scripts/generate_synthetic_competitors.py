from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any, Dict

def run(seed: int, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    rnd = random.Random(seed)

    rivals = []
    for i in range(6):
        rivals.append({
            "company": f"RivalRail_{i}",
            "frequency_per_day": rnd.randint(4, 18),
            "price_index": round(rnd.uniform(0.8, 1.2), 2),
            "quality_index": round(rnd.uniform(0.8, 1.2), 2),
        })

    out_path = out_dir / "synthetic_competitors.json"
    out_path.write_text(json.dumps({
        "synthetic": True,
        "seed": seed,
        "rivals": rivals,
        "units": {
            "frequency_per_day": "1/day",
            "price_index": "dimensionless",
            "quality_index": "dimensionless",
        }
    }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return out_path
