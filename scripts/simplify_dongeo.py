"""
읍면동(submunicipalities) GeoJSON 다운로드 + 단순화 → data/dong_geo.json
southkorea-maps code(7자리) → SGIS adm_cd: code + '0' = 8자리
"""
import json, sys, urllib.request
from pathlib import Path

try:
    from shapely.geometry import shape, mapping
except ImportError:
    print('pip install shapely 필요')
    sys.exit(1)

URL = ('https://raw.githubusercontent.com/southkorea/southkorea-maps/'
       'master/kostat/2013/json/skorea_submunicipalities_geo.json')
OUT = Path(__file__).parent.parent / 'data' / 'dong_geo.json'
TOLERANCE = 0.003

KOSTAT_TO_HIRA = {
    '11': '110000', '21': '210000', '22': '220000',
    '23': '230000', '24': '240000', '25': '250000',
    '26': '260000', '29': '410000', '31': '310000',
    '32': '320000', '33': '330000', '34': '340000',
    '35': '350000', '36': '360000', '37': '370000',
    '38': '380000', '39': '390000',
}

def main():
    print('다운로드 중...')
    with urllib.request.urlopen(URL, timeout=120) as r:
        raw = json.loads(r.read())

    feats = raw['features']
    print(f'총 피처 수: {len(feats)}')

    out_feats, skipped = [], 0
    for feat in feats:
        props = feat.get('properties', {})
        code = str(props.get('code', '') or '')
        name = str(props.get('name', '') or '')

        sido_kostat = code[:2] if len(code) >= 2 else ''
        sido_hira   = KOSTAT_TO_HIRA.get(sido_kostat, '')
        if not sido_hira:
            skipped += 1
            continue

        try:
            geom = shape(feat['geometry']).simplify(TOLERANCE, preserve_topology=True)
            if geom.is_empty:
                skipped += 1
                continue
        except Exception:
            skipped += 1
            continue

        out_feats.append({
            'type': 'Feature',
            'geometry': mapping(geom),
            'properties': {
                'code':    code,                       # 7자리 (SGIS: code+'0')
                'name':    name,
                'sggCode': code[:5] if len(code)>=5 else '',  # 시군구 코드
                'sidoCd':  sido_hira,                  # HIRA 시도코드
            },
        })

    result = {'type': 'FeatureCollection', 'features': out_feats}
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, separators=(',', ':'))

    size_mb = OUT.stat().st_size / 1024 / 1024
    print(f'저장: {OUT} ({size_mb:.1f} MB), 피처: {len(out_feats)}, 스킵: {skipped}')

if __name__ == '__main__':
    main()
