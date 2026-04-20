"""
행정동별 주민등록 인구 및 세대현황 수집 스크립트
행정안전부 API (data.go.kr 서비스ID: 15108065)

사용법:
  MOIS_API_KEY=디코딩키 python scripts/fetch_population.py

로컬 개발: 프로젝트 루트의 .env 파일에 MOIS_API_KEY=... 저장 후 실행
GitHub Actions: 저장소 Secrets에 MOIS_API_KEY 등록
"""

import requests
import json
import os
import time
import sys
from pathlib import Path
from datetime import datetime

# ============================================================
# .env 로드 (로컬 개발용, git에 커밋되지 않음)
# ============================================================
_env_path = Path(__file__).parent.parent / '.env'
if _env_path.exists():
    for line in _env_path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

API_KEY  = os.environ.get('MOIS_API_KEY', '').strip()
BASE_URL = 'https://apis.data.go.kr/1741000/admmPpltnHhStus/selectAdmmPpltnHhStus'
DATA_DIR = Path(__file__).parent.parent / 'data'

# HIRA sidoCd → 행정안전부 시도코드 매핑
SIDO_MAP = [
    {'sidoCd': '110000', 'name': '서울',   'ctpvCd': '11'},
    {'sidoCd': '210000', 'name': '부산',   'ctpvCd': '26'},
    {'sidoCd': '220000', 'name': '대구',   'ctpvCd': '27'},
    {'sidoCd': '230000', 'name': '인천',   'ctpvCd': '28'},
    {'sidoCd': '240000', 'name': '광주',   'ctpvCd': '29'},
    {'sidoCd': '250000', 'name': '대전',   'ctpvCd': '30'},
    {'sidoCd': '260000', 'name': '울산',   'ctpvCd': '31'},
    {'sidoCd': '410000', 'name': '세종',   'ctpvCd': '36'},
    {'sidoCd': '310000', 'name': '경기',   'ctpvCd': '41'},
    {'sidoCd': '320000', 'name': '강원',   'ctpvCd': '42'},
    {'sidoCd': '330000', 'name': '충북',   'ctpvCd': '43'},
    {'sidoCd': '340000', 'name': '충남',   'ctpvCd': '44'},
    {'sidoCd': '350000', 'name': '전북',   'ctpvCd': '45'},
    {'sidoCd': '360000', 'name': '전남',   'ctpvCd': '46'},
    {'sidoCd': '370000', 'name': '경북',   'ctpvCd': '47'},
    {'sidoCd': '380000', 'name': '경남',   'ctpvCd': '48'},
    {'sidoCd': '390000', 'name': '제주',   'ctpvCd': '50'},
]

AGE_GROUP_LABELS = ['0-9', '10-19', '20-29', '30-39', '40-49', '50-59', '60-69', '70-79', '80+']


def age_to_group(age_str: str) -> str | None:
    s = str(age_str).strip().replace('세 이상', '').replace('세', '').replace(' ', '')
    try:
        age = int(s.split('-')[0].split('~')[0])
        return '80+' if age >= 80 else f'{(age // 10) * 10}-{(age // 10) * 10 + 9}'
    except (ValueError, IndexError):
        return None


def _get_field(item, *names, default=0):
    for name in names:
        v = item.get(name)
        if v is not None:
            try:
                return int(str(v).replace(',', ''))
            except (ValueError, TypeError):
                pass
    return default


def fetch_sido(sido: dict, stdr_ym: str) -> dict | None:
    """시도 전체 행정동 데이터를 수집해서 집계"""
    all_items = []
    page = 1

    while True:
        params = {
            'serviceKey': API_KEY,
            'pageNo': page,
            'numOfRows': 500,
            'stdrYm': stdr_ym,
            'ctpvCd': sido['ctpvCd'],
            '_type': 'json',
        }
        try:
            resp = requests.get(BASE_URL, params=params, timeout=30)
            resp.raise_for_status()

            ct = resp.headers.get('Content-Type', '')
            if 'xml' in ct or resp.text.strip().startswith('<'):
                # XML 응답 처리
                import xml.etree.ElementTree as ET
                root = ET.fromstring(resp.text)
                rc = root.findtext('.//resultCode', '')
                if rc != '00':
                    msg = root.findtext('.//resultMsg', '')
                    print(f'  API 오류 [{rc}]: {msg}')
                    return None
                total = int(root.findtext('.//totalCount', '0'))
                items = [
                    {child.tag: child.text for child in item}
                    for item in root.findall('.//item')
                ]
            else:
                data  = resp.json()
                body  = data.get('response', {}).get('body', {})
                rc    = data.get('response', {}).get('header', {}).get('resultCode', '')
                if rc not in ('00', '', '0000'):
                    msg = data.get('response', {}).get('header', {}).get('resultMsg', '')
                    print(f'  API 오류 [{rc}]: {msg}')
                    return None
                total = int(body.get('totalCount', 0))
                raw   = body.get('items') or {}
                items = raw.get('item', []) if raw else []
                if isinstance(items, dict):
                    items = [items]

            if not items:
                break
            all_items.extend(items)
            if len(all_items) >= total:
                break
            page += 1
            time.sleep(0.1)

        except requests.RequestException as e:
            print(f'  요청 오류: {e}')
            return None

    if not all_items:
        return None

    # 행정동 데이터 집계 → 시도 전체 합산
    # 응답 필드명이 다양할 수 있어 여러 이름을 시도
    total_male = total_female = 0
    age_buckets = {lbl: {'male': 0, 'female': 0} for lbl in AGE_GROUP_LABELS}

    for item in all_items:
        male   = _get_field(item, 'maleCount', 'male', 'manlCo', 'mnPpltn', 'mnCnt')
        female = _get_field(item, 'femaleCount', 'female', 'womanCo', 'wmPpltn', 'wmCnt')
        total_male   += male
        total_female += female

        age_str = str(item.get('ageGroup') or item.get('ageCd') or item.get('age') or '')
        grp = age_to_group(age_str)
        if grp and grp in age_buckets:
            age_buckets[grp]['male']   += male
            age_buckets[grp]['female'] += female

    age_groups = [
        {'label': lbl, 'male': age_buckets[lbl]['male'], 'female': age_buckets[lbl]['female']}
        for lbl in AGE_GROUP_LABELS
    ]

    return {
        'name':      sido['name'],
        'total':     total_male + total_female,
        'male':      total_male,
        'female':    total_female,
        'ageGroups': age_groups,
    }


def main():
    if not API_KEY:
        print('오류: MOIS_API_KEY 환경변수가 설정되지 않았습니다.')
        print('  .env 파일에 MOIS_API_KEY=디코딩키 를 저장하거나')
        print('  MOIS_API_KEY=디코딩키 python scripts/fetch_population.py 로 실행하세요.')
        sys.exit(1)

    now    = datetime.now()
    month  = now.month - 1 if now.month > 1 else 12
    year   = now.year  if now.month > 1 else now.year - 1
    stdr_ym = f'{year}{month:02d}'
    print(f'기준: {year}년 {month}월 (stdrYm={stdr_ym})\n')

    regions = {}
    for sido in SIDO_MAP:
        print(f'[{sido["name"]}] 수집 중...', end=' ', flush=True)
        data = fetch_sido(sido, stdr_ym)
        if data:
            regions[sido['sidoCd']] = data
            print(f'총 {data["total"]:,}명')
        else:
            print('데이터 없음')
        time.sleep(0.3)

    output_path = DATA_DIR / 'population.json'
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump({'updated': stdr_ym, 'regions': regions}, f,
                  ensure_ascii=False, separators=(',', ':'))

    print(f'\n✅ 완료: {output_path} ({len(regions)}개 지역)')


if __name__ == '__main__':
    main()
