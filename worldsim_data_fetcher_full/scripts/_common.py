from __future__ import annotations

import hashlib
import json
import platform
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

import requests
from tqdm import tqdm

USER_AGENT = "worldsim-data-fetcher/0.2 (+https://example.invalid)"

def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)

def http_get_stream(url: str, out_path: Path, *, timeout: int = 120) -> None:
    headers = {"User-Agent": USER_AGENT}
    with requests.get(url, headers=headers, stream=True, timeout=timeout) as r:
        r.raise_for_status()
        total = int(r.headers.get("Content-Length", "0") or 0)
        ensure_dir(out_path.parent)
        tmp = out_path.with_suffix(out_path.suffix + ".part")
        with tmp.open("wb") as f, tqdm(total=total, unit="B", unit_scale=True, desc=out_path.name) as bar:
            for chunk in r.iter_content(chunk_size=1024 * 1024):
                if not chunk:
                    continue
                f.write(chunk)
                bar.update(len(chunk))
        tmp.replace(out_path)

def write_json(path: Path, obj: Any) -> None:
    ensure_dir(path.parent)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

def append_text(path: Path, text: str) -> None:
    ensure_dir(path.parent)
    with path.open("a", encoding="utf-8") as f:
        f.write(text)

def tool_env() -> Dict[str, Any]:
    return {
        "python": sys.version,
        "platform": platform.platform(),
        "requests": getattr(requests, "__version__", None),
    }

@dataclass(frozen=True)
class DatasetContext:
    dataset_version: str
    out_root: Path

    @property
    def sources_path(self) -> Path:
        return self.out_root / "sources.json"

    @property
    def checksums_path(self) -> Path:
        return self.out_root / "checksums.sha256"

    @property
    def manifest_path(self) -> Path:
        return self.out_root / "manifest.json"

def load_yaml(path: Path) -> Dict[str, Any]:
    import yaml
    return yaml.safe_load(path.read_text(encoding="utf-8"))

def save_manifest(ctx: DatasetContext, files: Iterable[Path]) -> None:
    rel_files = [str(p.relative_to(ctx.out_root)) for p in files if p.exists()]
    write_json(ctx.manifest_path, {
        "datasetVersion": ctx.dataset_version,
        "createdAtUtc": utc_now_iso(),
        "toolEnv": tool_env(),
        "files": sorted(set(rel_files)),
    })
