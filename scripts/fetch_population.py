"""
연령별/성별 주민등록인구 수집 스크립트
행정안전부 주민등록인구통계 API (data.go.kr)

사용법:
  MOIS_API_KEY=your_key python scripts/fetch_population.py

API 키 발급: https://www.data.go.kr → '주민등록 연령별 인구 및 세대현황' 검색 후 활용신청
"""

import requests
import json
import os
import time
import sys
from pathlib import Path
from datetime import datetime

API_KEY  = os.environ.get('MOIS_API_KEY', '').strip()
BASE_URL = 'https://apis.data.go.kr/1741000/StatsOfAgeGenderInfoService2/getStatsOfAgeGenderInfo'
DATA_DIR = Path(__file__).parent.parent / 'data'

# HIRA sidoCd → 행정안전부 localCode (10자리) 매핑
SIDO_MAP = [
    {'sidoCd': '110000', 'name': '서울',   'localCode': '1100000000'},
    {'sidoCd': '210000', 'name': '부산',   'localCode': '2600000000'},
    {'sidoCd': '220000', 'name': '대구',   'localCode': '2700000000'},
    {'sidoCd': '230000', 'name': '인천',   'localCode': '2800000000'},
    {'sidoCd': '240000', 'name': '광주',   'localCode': '2900000000'},
    {'sidoCd': '250000', 'name': '대전',   'localCode': '3000000000'},
    {'sidoCd': '260000', 'name': '울산',   'localCode': '3100000000'},
    {'sidoCd': '410000', 'name': '세종',   'localCode': '3600000000'},
    {'sidoCd': '310000', 'name': '경기',   'localCode': '4100000000'},
    {'sidoCd': '320000', 'name': '강원',   'localCode': '4200000000'},
    {'sidoCd': '330000', 'name': '충북',   'localCode': '4300000000'},
    {'sidoCd': '340000', 'name': '충남',   'localCode': '4400000000'},
    {'sidoCd': '350000', 'name': '전북',   'localCode': '4500000000'},
    {'sidoCd': '360000', 'name': '전남',   'localCode': '4600000000'},
    {'sidoCd': '370000', 'name': '경북',   'localCode': '4700000000'},
    {'sidoCd': '380000', 'name': '경남',   'localCode': '4800000000'},
    {'sidoCd': '390000', 'name': '제주',   'localCode': '5000000000'},
]

# 10년 단위 연령 그룹 레이블 (표시 순서)
AGE_GROUP_LABELS = ['0-9', '10-19', '20-29', '30-39', '40-49', '50-59', '60-69', '70-79', '80+']


def age_to_group(age_str: str) -> str | None:
    """API 연령 문자열 → 10년 단위 그룹 레이블 변환"""
    s = str(age_str).strip()
    # '0 - 4세', '10 - 14세', '100세 이상' 등의 형식 처리
    s = s.replace('세 이상', '').replace('세', '').replace(' ', '')
    try:
        age = int(s.split('-')[0].split('~')[0])
        if age >= 80:
            return '80+'
        return f'{(age // 10) * 10}-{(age // 10) * 10 + 9}'
    except (ValueError, IndexError):
        return None


def fetch_sido_population(sido: dict, yyyymm: str) -> dict | None:
    all_items = []
    page = 1
    while True:
        params = {
            'serviceKey': API_KEY,
            'pageNo': page,
            'numOfRows': 200,
            'localCode': sido['localCode'],
            'yyyymmdd': yyyymm + '01',
            '_type': 'json',
        }
        try:
            resp = requests.get(BASE_URL, params=params, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            body  = data.get('response', {}).get('body', {})
            total = int(body.get('totalCount', 0))
            items_raw = body.get('items') or {}
            items = items_raw.get('item', []) if items_raw else []
            if isinstance(items, dict):
                items = [items]
            if not items:
                break
            all_items.extend(items)
            if len(all_items) >= total:
                break
            page += 1
            time.sleep(0.1)
        except Exception as e:
            print(f'  오류: {e}')
            return None

    if not all_items:
        return None

    # 10년 단위 집계
    buckets: dict[str, dict] = {lbl: {'male': 0, 'female': 0} for lbl in AGE_GROUP_LABELS}
    for item in all_items:
        # 필드명 다양성 대응
        age_str = item.get('ageGroup') or item.get('ageCd') or item.get('age') or ''
        male    = int(item.get('male') or item.get('maleCount') or item.get('manlCo') or 0)
        female  = int(item.get('female') or item.get('femaleCount') or item.get('womanCo') or 0)
        grp = age_to_group(str(age_str))
        if grp and grp in buckets:
            buckets[grp]['male']   += male
            buckets[grp]['female'] += female

    age_groups = [
        {'label': lbl, 'male': buckets[lbl]['male'], 'female': buckets[lbl]['female']}
        for lbl in AGE_GROUP_LABELS
    ]
    total_male   = sum(g['male']   for g in age_groups)
    total_female = sum(g['female'] for g in age_groups)

    return {
        'name':       sido['name'],
        'total':      total_male + total_female,
        'male':       total_male,
        'female':     total_female,
        'ageGroups':  age_groups,
    }


def main():
    if not API_KEY:
        print('오류: MOIS_API_KEY 환경변수가 설정되지 않았습니다.')
        print('  행정안전부 주민등록인구통계 API 키를 data.go.kr에서 발급받으세요.')
        print('  서비스명: 주민등록 연령별 인구 및 세대현황 (StatsOfAgeGenderInfoService2)')
        sys.exit(1)

    now = datetime.now()
    # 전월 확정 데이터 사용
    month = now.month - 1 if now.month > 1 else 12
    year  = now.year if now.month > 1 else now.year - 1
    yyyymm = f'{year}{month:02d}'
    print(f'기준: {year}년 {month}월\n')

    regions = {}
    for sido in SIDO_MAP:
        print(f'[{sido["name"]}] 수집 중...', end=' ', flush=True)
        data = fetch_sido_population(sido, yyyymm)
        if data:
            regions[sido['sidoCd']] = data
            print(f'총 {data["total"]:,}명')
        else:
            print('데이터 없음')
        time.sleep(0.2)

    output = {'updated': yyyymm, 'regions': regions}
    output_path = DATA_DIR / 'population.json'
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, separators=(',', ':'))

    print(f'\n✅ 완료: {output_path} ({len(regions)}개 지역)')


if __name__ == '__main__':
    main()
