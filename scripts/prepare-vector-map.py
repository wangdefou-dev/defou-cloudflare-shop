"""Prepare local province paths from licensed SVG and a separate sea inset.

Run only when changing sources. No online dependency, geometry library, customer
data or charting runtime is needed by a normal site build.
"""
from pathlib import Path
import hashlib
import json
import math
import re
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[1]
folder = root / 'assets/maps'
source = folder / 'china-provinces-amcharts.svg'
inset = folder / 'nanhai-echarts-6.0.0.ts.txt'
number = r'-?\d+(?:\.\d+)?'
# Projection calibration belongs to these exact source bytes. A replacement
# source must be independently re-fitted, not silently assigned this audit.
assert hashlib.sha256(source.read_bytes()).hexdigest() == '0ba1feb2c0d0075eb081ffbe4ce0f82863b8bcc5fb9f81ac65c566ea3aa0ea7f', 'Province source changed: re-fit and audit the projection first'
assert hashlib.sha256(inset.read_bytes()).hexdigest() == 'f26827848ed3caf96a7ba80886f0b5868e76178f26413c58938d0249be6c1f8a', 'Inset source changed: re-audit the screen transform first'

# ISO province IDs in the source SVG mapped to our existing administrative codes.
regions = {
 'BJ': ('110000', '北京', 116.2, 41.2),
 'TJ': ('120000', '天津', 119.6, 39.2),
 'HE': ('130000', '河北', 115.3, 38.8),
 'SX': ('140000', '山西', 112.0, 37.7),
 'NM': ('150000', '内蒙古', 111.0, 43.1),
 'LN': ('210000', '辽宁', 122.8, 41.5),
 'JL': ('220000', '吉林', 126.1, 43.8),
 'HL': ('230000', '黑龙江', 128.0, 47.9),
 'SH': ('310000', '上海', 123.5, 31.1),
 'JS': ('320000', '江苏', 119.5, 33.3),
 'ZJ': ('330000', '浙江', 120.3, 29.1),
 'AH': ('340000', '安徽', 117.0, 32.0),
 'FJ': ('350000', '福建', 118.2, 26.0),
 'JX': ('360000', '江西', 115.3, 27.5),
 'SD': ('370000', '山东', 118.6, 36.3),
 'HA': ('410000', '河南', 113.5, 33.8),
 'HB': ('420000', '湖北', 112.5, 30.8),
 'HN': ('430000', '湖南', 111.5, 27.5),
 'GD': ('440000', '广东', 113.4, 24.1),
 'GX': ('450000', '广西', 108.3, 23.7),
 'HI': ('460000', '海南', 109.6, 19.2),
 'CQ': ('500000', '重庆', 107.4, 29.5),
 'SC': ('510000', '四川', 102.9, 30.5),
 'GZ': ('520000', '贵州', 106.6, 26.7),
 'YN': ('530000', '云南', 101.7, 24.4),
 'XZ': ('540000', '西藏', 88.5, 31.2),
 'SN': ('610000', '陕西', 108.5, 35.6),
 'GS': ('620000', '甘肃', 103.0, 38.0),
 'QH': ('630000', '青海', 96.0, 35.8),
 'NX': ('640000', '宁夏', 106.1, 37.5),
 'XJ': ('650000', '新疆', 85.0, 41.3),
 'TW': ('710000', '台湾', 121.3, 23.5),
 'HK': ('810000', '香港', 116.0, 21.5),
 'MO': ('820000', '澳门', 111.5, 21.5),
}

# The SVG is a Mercator export. These affine parameters were fitted to all
# 4,137 matching source SVG/GeoJSON vertices (max residual <0.007 SVG pixels).
# Transforming SVG and city references by the same offset avoids image-based
# calibration or fitting customer destinations to guessed province centres.
projection = {
 'kind': 'mercator', 'x_scale': 15.682741023224601,
 'x_offset': -1133.5864005025646, 'y_scale': -898.5548146353059,
 'y_offset': 1024.4719037583016,
}

def project(lng, lat):
 return {
  'x': round(projection['x_scale'] * lng + projection['x_offset'], 2),
  'y': round(projection['y_scale'] * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) + projection['y_offset'], 2),
 }

def fmt(value):
 return f'{value:.2f}'.rstrip('0').rstrip('.')

def translate_path(path):
 # Trusted source uses absolute M/L/Z only. Parse and serialize plain geometry;
 # no SVG scripts, links, styles or arbitrary markup are copied into components.
 assert re.fullmatch(r'[MLZ\d.,\s-]+', path)
 def move(match):
  return match[1] + fmt(float(match[2]) + 20) + ',' + fmt(float(match[3]) - 100)
 return re.sub(r'([ML])(' + number + r'),(' + number + r')', move, path)

provinces = []
for element in ET.parse(source).getroot():
 if element.tag.rsplit('}', 1)[-1] != 'path':
  continue
 key = element.attrib['id'].removeprefix('CN-')
 code, name, lng, lat = regions[key]
 provinces.append({'code': code, 'name': name, 'path': translate_path(element.attrib['d']), 'label': project(lng, lat)})
assert len(provinces) == len(regions) == 34
provinces.sort(key=lambda r: r['code'])

# Apache ECharts' small illustrative inset is source code geometry, not a set
# of true island longitude/latitude points. Keep it in a separate screen box;
# it must never be fed to cityPoint or used to invent a delivery destination.
match = re.search(r'const points = (\[[\s\S]*?\n\]);', inset.read_text())
assert match
polygons = json.loads(match[1])
assert len(polygons) == 12
decorations = []
for i, polygon in enumerate(polygons):
 path = ''.join(('M' if j == 0 else 'L') + fmt(846 + x * 1.22) + ',' + fmt(552 + y * 1.22) for j, (x, y) in enumerate(polygon)) + 'Z'
 decorations.append({'id': f'south-sea-{i}', 'path': path, 'kind': 'outline' if i == 11 else 'islands' if i == 0 else 'sea-lines'})

data = {'provinces': provinces, 'decorations': decorations}
target = root / 'src/lib/map-provinces.json'
target.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
base = {
 'kind': 'vector', 'width': 1024, 'height': 780,
 'source_label': 'amCharts', 'source_url': 'https://www.amcharts.com/svg-maps/china/',
 'license_url': '/images/maps/licenses.txt', 'projection': projection,
 'overlay': {'bounds': [0, 0, 1024, 780], 'exclusions': [[830, 530, 950, 700]]},
}
(root / 'src/lib/map-base.json').write_text(json.dumps(base, ensure_ascii=False, indent=2) + '\n')
audit = {
 'province_source': 'https://www.amcharts.com/static/svg-maps/chinaLow.svg',
 'province_source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
 'province_license': 'CC-BY-4.0',
 'inset_source': 'https://raw.githubusercontent.com/apache/echarts/6.0.0/src/coord/geo/fix/nanhai.ts',
 'inset_source_sha256': hashlib.sha256(inset.read_bytes()).hexdigest(),
 'inset_license': 'Apache-2.0', 'inset_is_illustrative_screen_coordinates': True,
 'generated_sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
 'province_count': len(provinces), 'decoration_count': len(decorations),
 'projection_matching_vertices': 4137, 'projection_max_residual_svg_pixels': 0.007,
 'projection_reference_source': 'https://cdn.amcharts.com/lib/5/geodata/json/chinaLow.json',
 'changes': 'Absolute province path translation (+20,-100), Chinese labels, codes, per-province data colours; independent illustrative sea inset scaled into screen box.',
}
(folder / 'vector-source.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'provinces':len(provinces),'inset_polygons':len(decorations),'path_data_bytes':target.stat().st_size}))
