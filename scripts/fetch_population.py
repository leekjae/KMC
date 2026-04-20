"""
법정동별 주민등록 인구 및 세대현황 수집 스크립트
행정안전부 API (data.go.kr 서비스ID: 15108071)
엔드포인트: https://apis.data.go.kr/1741000/stdgPpltnHhStus/selectStdgPpltnHhStus

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
BASE_URL = 'https://apis.data.go.kr/1741000/stdgPpltnHhStus/selectStdgPpltnHhStus'
DATA_DIR = Path(__file__).parent.parent / 'data'

# 법정동 시도코드(10자리) → HIRA sidoCd(6자리) 매핑
# 출처: KIKcd_B.20260325.xlsx (행정안전부 법정동코드 목록)
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


def fetch_all_sido(ym: str) -> dict:
    """lv=1로 한 번 호출하면 전체 17개 시도 데이터가 반환됨"""
    params = {
        'serviceKey': API_KEY,
        'stdgCd':     '1100000000',   # 아무 시도 코드나 OK, lv=1이면 전체 반환
        'srchFrYm':   ym,
        'srchToYm':   ym,
        'lv':         '1',            # 시도 수준 집계
        'regSeCd':    '1',            # 전체 (거주자+거주불명+재외국민)
        'type':       'json',
        'numOfRows':  '20',
        'pageNo':     '1',
    }
    resp = requests.get(BASE_URL, params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    rc  = data.get('Response', {}).get('head', {}).get('resultCode', '')
    msg = data.get('Response', {}).get('head', {}).get('resultMsg', '')
    if rc not in ('0', '00', '0000'):
        raise RuntimeError(f'API 오류 [{rc}]: {msg}')

    items = data['Response']['items']['item']
    if isinstance(items, dict):
        items = [items]
    return items


def main():
    if not API_KEY:
        print('오류: MOIS_API_KEY 환경변수가 설정되지 않았습니다.')
        print('  .env 파일에 MOIS_API_KEY=디코딩키 를 저장하거나')
        print('  MOIS_API_KEY=디코딩키 python scripts/fetch_population.py 로 실행하세요.')
        sys.exit(1)

    # 최근 확정 월: 전월 사용 (당월은 미확정)
    now   = datetime.now()
    month = now.month - 1 if now.month > 1 else 12
    year  = now.year  if now.month > 1 else now.year - 1
    ym    = f'{year}{month:02d}'
    print(f'기준: {year}년 {month}월 (ym={ym})\n')

    print('전체 시도 데이터 수집 중...', flush=True)
    try:
        items = fetch_all_sido(ym)
    except Exception as e:
        print(f'오류: {e}')
        sys.exit(1)

    regions = {}
    for it in items:
        stdg_cd = str(it.get('stdgCd', ''))
        hira_cd = STDG_TO_HIRA.get(stdg_cd)
        if not hira_cd:
            print(f'  매핑 없음: stdgCd={stdg_cd}')
            continue

        total     = int(it.get('totNmprCnt', 0) or 0)
        male      = int(it.get('maleNmprCnt', 0) or 0)
        female    = int(it.get('femlNmprCnt', 0) or 0)
        households = int(it.get('hhCnt', 0) or 0)
        hh_size   = float(it.get('hhNmpr', 0) or 0)
        mf_ratio  = float(it.get('maleFemlRate', 0) or 0)
        sido_nm   = it.get('ctpvNm', '')

        regions[hira_cd] = {
            'name':       sido_nm,
            'total':      total,
            'male':       male,
            'female':     female,
            'households': households,
            'hhSize':     hh_size,
            'mfRatio':    mf_ratio,
        }
        pct_m = male / total * 100 if total else 0
        print(f'  [{sido_nm}] 총 {total:,}명  남 {pct_m:.1f}%  세대 {households:,}')

    output_path = DATA_DIR / 'population.json'
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump({'updated': ym, 'regions': regions}, f,
                  ensure_ascii=False, separators=(',', ':'))

    print(f'\n완료: {output_path} ({len(regions)}개 지역)')


if __name__ == '__main__':
    main()
