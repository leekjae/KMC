"""
세종 sidoCd 진단 스크립트
사용법: HIRA_API_KEY=your_key python scripts/diagnose_sejong.py
"""
import requests
import json
import os

API_KEY = os.environ.get('HIRA_API_KEY', '').strip()
BASE_URL = 'https://apis.data.go.kr/B551182/hospInfoServicev2/getHospBasisList'

if not API_KEY:
    print('오류: HIRA_API_KEY 환경변수를 설정하세요.')
    exit(1)

# 시도할 코드 목록
candidates = [
    ('290000', '현재 사용 중'),
    ('36',     '표준 행정구역코드 2자리'),
    ('360000', '표준 행정구역코드 6자리'),
    ('3600000','표준 행정구역코드 7자리'),
    ('',       '전체 조회 (sidoCd 파라미터 없음 + 세종 주소 필터)'),
]

for code, desc in candidates:
    params = {
        'serviceKey': API_KEY,
        'pageNo': 1,
        'numOfRows': 5,
        '_type': 'json',
    }
    if code:
        params['sidoCd'] = code

    try:
        resp = requests.get(BASE_URL, params=params, timeout=15)
        data = resp.json()
        body = data.get('response', {}).get('body', {})
        total = body.get('totalCount', 0)
        items = body.get('items') or {}
        item_list = items.get('item', []) if items else []
        if isinstance(item_list, dict):
            item_list = [item_list]

        # 세종 관련 항목 확인
        sejong_items = [i for i in item_list if '세종' in str(i.get('sidoCdNm','')) or '세종특별자치시' in str(i.get('addr',''))]

        print(f'\n[sidoCd={code!r}] {desc}')
        print(f'  totalCount={total}')
        if item_list:
            first = item_list[0]
            print(f'  첫번째 항목 sidoCd={first.get("sidoCd")} sidoCdNm={first.get("sidoCdNm")} addr={str(first.get("addr",""))[:40]}')
        if sejong_items:
            print(f'  ★ 세종 항목 발견: {len(sejong_items)}건')
    except Exception as e:
        print(f'\n[sidoCd={code!r}] 오류: {e}')
