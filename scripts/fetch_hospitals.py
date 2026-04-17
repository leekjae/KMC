"""
전국 병의원 데이터 수집 스크립트
건강보험심사평가원 요양기관 현황조회 API (data.go.kr)

사용법:
  HIRA_API_KEY=your_key python scripts/fetch_hospitals.py

GitHub Actions에서는 HIRA_API_KEY secrets를 사용합니다.
"""

import requests
import json
import os
import time
import sys
import hashlib
from pathlib import Path

# ============================================================
# 설정
# ============================================================
API_KEY = os.environ.get('HIRA_API_KEY', '').strip()
BASE_URL = 'https://apis.data.go.kr/B551182/hospInfoServicev2/getHospBasisList'
DATA_DIR = Path(__file__).parent.parent / 'data'
NUM_ROWS = 100   # 1회 요청당 최대 행 수 (API 허용 최대: 100)
REQUEST_DELAY = 0.15  # 요청 간격 (초) - API 부하 방지

SIDO_LIST = [
    {'code': '110000', 'name': '서울'},
    {'code': '210000', 'name': '부산'},
    {'code': '220000', 'name': '대구'},
    {'code': '230000', 'name': '인천'},
    {'code': '240000', 'name': '광주'},
    {'code': '250000', 'name': '대전'},
    {'code': '260000', 'name': '울산'},
    {'code': '290000', 'name': '세종'},
    {'code': '310000', 'name': '경기'},
    {'code': '320000', 'name': '강원'},
    {'code': '330000', 'name': '충북'},
    {'code': '340000', 'name': '충남'},
    {'code': '350000', 'name': '전북'},
    {'code': '360000', 'name': '전남'},
    {'code': '370000', 'name': '경북'},
    {'code': '380000', 'name': '경남'},
    {'code': '390000', 'name': '제주'},
]


# ============================================================
# API 호출
# ============================================================
def fetch_page(sido_code: str, page_no: int) -> tuple[list, int]:
    """단일 페이지 조회. (items, total_count) 반환"""
    params = {
        'serviceKey': API_KEY,
        'pageNo': page_no,
        'numOfRows': NUM_ROWS,
        'sidoCd': sido_code,
        '_type': 'json',
    }
    for attempt in range(3):
        try:
            resp = requests.get(BASE_URL, params=params, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            body = data.get('response', {}).get('body', {})

            # API 오류 코드 확인
            result_code = data.get('response', {}).get('header', {}).get('resultCode', '')
            if result_code not in ('00', ''):
                result_msg = data.get('response', {}).get('header', {}).get('resultMsg', '')
                print(f'    API 오류: {result_code} {result_msg}')
                return [], 0

            total = int(body.get('totalCount', 0))
            items_raw = body.get('items', {})

            if not items_raw or total == 0:
                return [], total

            item_list = items_raw.get('item', [])
            # 결과가 1건이면 dict로 반환되는 경우 처리
            if isinstance(item_list, dict):
                item_list = [item_list]

            return item_list, total

        except requests.exceptions.RequestException as e:
            wait = 2 ** attempt
            print(f'    요청 오류 (시도 {attempt + 1}/3): {e} → {wait}초 후 재시도')
            time.sleep(wait)
        except (KeyError, ValueError, json.JSONDecodeError) as e:
            print(f'    응답 파싱 오류: {e}')
            return [], 0

    return [], 0


# ============================================================
# 데이터 정규화
# ============================================================
def normalize(item: dict) -> dict:
    """API 원본 필드를 프론트엔드 형식으로 변환 (경량화)"""
    lat = _to_float(item.get('YPos'))
    lng = _to_float(item.get('XPos'))

    # 좌표 정밀도 5자리로 제한 (약 1.1m 오차, 지도 표시에 충분)
    if lat: lat = round(lat, 5)
    if lng: lng = round(lng, 5)

    # ykiho(80~100자)를 MD5 해시 12자리로 단축 (전국 79k건 충돌 0건 검증)
    raw_id = str(item.get('ykiho', ''))
    short_id = hashlib.md5(raw_id.encode()).hexdigest()[:12] if raw_id else ''

    return {
        'id':        short_id,
        'name':      str(item.get('yadmNm', '')).strip(),
        'clCd':      str(item.get('clCd', '')),
        'clCdNm':    str(item.get('clCdNm', '')).strip(),
        'sidoCd':    str(item.get('sidoCd', '')),
        'sidoCdNm':  str(item.get('sidoCdNm', '')).strip(),
        'sgguCdNm':  str(item.get('sgguCdNm', '')).strip(),
        'addr':      str(item.get('addr', '')).strip(),
        'phone':     str(item.get('telno', '')).strip(),
        'hospUrl':   str(item.get('hospUrl', '')).strip(),
        'estbDd':    str(item.get('estbDd', '')),
        'drTotCnt':  item.get('drTotCnt') or '',
        'mdeptSdrCnt': item.get('mdeptSdrCnt') or '',
        'lat':       lat,
        'lng':       lng,
    }


def _to_float(value) -> float | None:
    try:
        v = float(value)
        return v if v != 0.0 else None
    except (TypeError, ValueError):
        return None


# ============================================================
# 시도별 수집
# ============================================================
def fetch_sido(sido: dict) -> list:
    print(f'\n[{sido["name"]}] 수집 중...')

    first_items, total = fetch_page(sido['code'], 1)
    if total == 0:
        print(f'  → 데이터 없음')
        return []

    print(f'  → 총 {total:,}건')
    collected = list(first_items)

    page_no = 2
    while len(collected) < total:
        items, _ = fetch_page(sido['code'], page_no)
        if not items:
            print(f'  → 페이지 {page_no} 응답 없음, 수집 중단')
            break
        collected.extend(items)
        print(f'  → {len(collected):,} / {total:,}', end='\r', flush=True)
        page_no += 1
        time.sleep(REQUEST_DELAY)

    result = [normalize(item) for item in collected]
    print(f'  → {len(result):,}건 완료' + ' ' * 20)
    return result


# ============================================================
# 메인
# ============================================================
def main():
    if not API_KEY:
        print('오류: HIRA_API_KEY 환경변수가 설정되지 않았습니다.')
        print('  사용법: HIRA_API_KEY=your_key python scripts/fetch_hospitals.py')
        sys.exit(1)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    print(f'저장 경로: {DATA_DIR.resolve()}')

    total_count = 0
    for sido in SIDO_LIST:
        data = fetch_sido(sido)
        output_path = DATA_DIR / f'hospitals_{sido["code"]}.json'
        with open(output_path, 'w', encoding='utf-8') as f:
            # separators로 공백 제거 → 파일 크기 최소화
            json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
        total_count += len(data)

    print(f'\n✅ 수집 완료: 전국 총 {total_count:,}건')


if __name__ == '__main__':
    main()
