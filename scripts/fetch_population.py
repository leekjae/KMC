"""
법정동별 주민등록 인구 및 세대현황 수집 스크립트
행정안전부 API (data.go.kr 서비스ID: 15108071)

사용법:
  MOIS_API_KEY=디코딩키 python scripts/fetch_population.py

로컬 개발: 프로젝트 루트의 .env 파일에 MOIS_API_KEY=... 저장 후 실행
GitHub Actions: 저장소 Secrets에 MOIS_API_KEY 등록
"""

import requests
import json
import os
import sys
from pathlib import Path
from datetime import datetime

_env_path = Path(__file__).parent.parent / '.env'
if _env_path.exists():
    for line in _env_path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

API_KEY  = os.environ.get('MOIS_API_KEY', '').strip()
BASE_URL = 'https://apis.data.go.kr/1741000/stdgPpltnHhStus/selectStdgPpltnHhStus'
DATA_DIR = Path(__file__).parent.parent / 'data'

# 법정동 시도코드(10자리) → HIRA sidoCd(6자리)
STDG_TO_HIRA = {
    '1100000000': '110000',  # 서울특별시
    '2600000000': '210000',  # 부산광역시
    '2700000000': '220000',  # 대구광역시
    '2800000000': '230000',  # 인천광역시
    '2900000000': '240000',  # 광주광역시
    '3000000000': '250000',  # 대전광역시
    '3100000000': '260000',  # 울산광역시
    '3600000000': '410000',  # 세종특별자치시
    '4100000000': '310000',  # 경기도
    '5100000000': '320000',  # 강원특별자치도
    '4300000000': '330000',  # 충청북도
    '4400000000': '340000',  # 충청남도
    '5200000000': '350000',  # 전북특별자치도
    '4600000000': '360000',  # 전라남도
    '4700000000': '370000',  # 경상북도
    '4800000000': '380000',  # 경상남도
    '5000000000': '390000',  # 제주특별자치도
}

# 법정동 시도 앞 2자리 → HIRA sidoCd (응답 stdgCd 파싱용)
SIDO2_TO_HIRA = {
    '11': '110000', '26': '210000', '27': '220000',
    '28': '230000', '29': '240000', '30': '250000',
    '31': '260000', '36': '410000', '41': '310000',
    '51': '320000', '43': '330000', '44': '340000',
    '52': '350000', '46': '360000', '47': '370000',
    '48': '380000', '50': '390000',
}


def _call(params: dict) -> dict:
    resp = requests.get(BASE_URL, params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()


def fetch_all_sido(ym: str) -> list:
    """lv=1 한 번 호출로 전체 17개 시도 집계 반환"""
    data = _call({
        'serviceKey': API_KEY, 'stdgCd': '1100000000',
        'srchFrYm': ym, 'srchToYm': ym,
        'lv': '1', 'regSeCd': '1', 'type': 'json',
        'numOfRows': '20', 'pageNo': '1',
    })
    rc  = data.get('Response', {}).get('head', {}).get('resultCode', '')
    msg = data.get('Response', {}).get('head', {}).get('resultMsg', '')
    if rc not in ('0', '00', '0000'):
        raise RuntimeError(f'API 오류 [{rc}]: {msg}')
    items = data['Response']['items']['item']
    return [items] if isinstance(items, dict) else items


def fetch_sgg_for_sido(sido_cd: str, ym: str) -> list:
    """lv=2: 시도 하위 시군구 목록"""
    data = _call({
        'serviceKey': API_KEY, 'stdgCd': sido_cd,
        'srchFrYm': ym, 'srchToYm': ym,
        'lv': '2', 'regSeCd': '1', 'type': 'json',
        'numOfRows': '100', 'pageNo': '1',
    })
    rc = data.get('Response', {}).get('head', {}).get('resultCode', '')
    if rc not in ('0', '00', '0000'):
        return []
    items = data['Response']['items'].get('item', [])
    return [items] if isinstance(items, dict) else items


def fetch_dong_for_sgg(sgg_cd: str, ym: str) -> list:
    """lv=3: 시군구 하위 읍면동 목록 (페이지네이션)"""
    all_items, page = [], 1
    while True:
        data = _call({
            'serviceKey': API_KEY, 'stdgCd': sgg_cd,
            'srchFrYm': ym, 'srchToYm': ym,
            'lv': '3', 'regSeCd': '1', 'type': 'json',
            'numOfRows': '500', 'pageNo': str(page),
        })
        rc = data.get('Response', {}).get('head', {}).get('resultCode', '')
        if rc not in ('0', '00', '0000'):
            break
        items = data['Response']['items'].get('item', [])
        if isinstance(items, dict):
            items = [items]
        if not items:
            break
        all_items.extend(items)
        total = int(data['Response']['head'].get('totalCount', 0) or 0)
        if len(all_items) >= total or len(items) < 500:
            break
        page += 1
    return all_items


def main():
    if not API_KEY:
        print('오류: MOIS_API_KEY 환경변수가 설정되지 않았습니다.')
        sys.exit(1)

    now   = datetime.now()
    month = now.month - 1 if now.month > 1 else 12
    year  = now.year  if now.month > 1 else now.year - 1
    ym    = f'{year}{month:02d}'
    print(f'기준: {year}년 {month}월 (ym={ym})\n')

    # ── 시도 수준 (lv=5) ─────────────────────────────────────
    print('시도 데이터 수집 중...', flush=True)
    sido_items = fetch_all_sido(ym)

    regions = {}
    for it in sido_items:
        stdg_cd = str(it.get('stdgCd', ''))
        hira_cd = STDG_TO_HIRA.get(stdg_cd)
        if not hira_cd:
            continue
        total      = int(it.get('totNmprCnt', 0) or 0)
        male       = int(it.get('maleNmprCnt', 0) or 0)
        female     = int(it.get('femlNmprCnt', 0) or 0)
        households = int(it.get('hhCnt', 0) or 0)
        regions[hira_cd] = {
            'name':       it.get('ctpvNm', ''),
            'total':      total,
            'male':       male,
            'female':     female,
            'households': households,
            'hhSize':     float(it.get('hhNmpr', 0) or 0),
            'mfRatio':    float(it.get('maleFemlRate', 0) or 0),
        }
        pct_m = male / total * 100 if total else 0
        print(f'  [{it.get("ctpvNm","")}] 총 {total:,}명  남 {pct_m:.1f}%')

    # ── 읍면동 수준 (lv=2 → lv=3) ───────────────────────────
    print('\n읍면동 데이터 수집 중...')
    dongs = {}

    for sido_stdg_cd, hira_cd in STDG_TO_HIRA.items():
        sido_name = regions.get(hira_cd, {}).get('name', hira_cd)
        print(f'  {sido_name}...', flush=True)

        sgg_items = fetch_sgg_for_sido(sido_stdg_cd, ym)
        dong_count = 0

        for sgg_item in sgg_items:
            sgg_cd = str(sgg_item.get('stdgCd', ''))
            if not sgg_cd:
                continue
            dong_items = fetch_dong_for_sgg(sgg_cd, ym)
            for it in dong_items:
                dong_nm = (it.get('stdgNm') or '').strip()
                if not dong_nm:
                    continue
                item_stdg = str(it.get('stdgCd', ''))
                item_hira = SIDO2_TO_HIRA.get(item_stdg[:2], hira_cd)
                key = item_hira + '_' + dong_nm
                dongs[key] = {
                    'total':      int(it.get('totNmprCnt', 0) or 0),
                    'male':       int(it.get('maleNmprCnt', 0) or 0),
                    'female':     int(it.get('femlNmprCnt', 0) or 0),
                    'households': int(it.get('hhCnt', 0) or 0),
                }
                dong_count += 1

        print(f'    {len(sgg_items)}개 시군구 → {dong_count}개 읍면동')

    output_path = DATA_DIR / 'population.json'
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(
            {'updated': ym, 'regions': regions, 'dongs': dongs},
            f, ensure_ascii=False, separators=(',', ':')
        )

    print(f'\n완료: {output_path}')
    print(f'  시도: {len(regions)}개, 읍면동: {len(dongs)}개')


if __name__ == '__main__':
    main()
