import zipfile 
from pathlib import Path 
import shapefile 
import json 
import shutil 
 
zip_path = Path('data/raw/2026-01-06/natural_earth/admin_0_countries_10m.zip') 
if not zip_path.exists(): 
    raise SystemExit('Missing zip file: ' + str(zip_path)) 
extract_dir = Path('tmp_admin0') 
if extract_dir.exists(): 
    shutil.rmtree(extract_dir) 
extract_dir.mkdir(parents=True) 
with zipfile.ZipFile(zip_path, 'r') as zf: 
    zf.extractall(extract_dir) 
shp_file = next(p for p in extract_dir.rglob('*.shp')) 
reader = shapefile.Reader(str(shp_file)) 
fields = reader.fields[1:] 
field_names = [f[0] for f in fields] 
features = [] 
for rec in reader.iterShapeRecords(): 
    geom = rec.shape.__geo_interface__ 
    props = {name: rec.record[i] for i, name in enumerate(field_names)} 
    features.append({'type': 'Feature', 'geometry': geom, 'properties': props}) 
out_path = Path('public/data/world/countries.geojson') 
out_path.parent.mkdir(parents=True, exist_ok=True) 
with out_path.open('w', encoding='utf-8') as fh: 
    json.dump({'type': 'FeatureCollection', 'features': features}, fh, separators=(',', ':')) 
print('wrote', out_path, 'with', len(features), 'features') 
