"""
SGIS(통계지리정보서비스) 데이터 수집
- 센서스 인구통계 (시도/시군구/읍면동)
- 사업체 통계 (시도/시군구)
- 생활업종 분포 - 의료업종 비율 (시군구)

출력: data/sgis_stats.json

사용법:
  python scripts/fetch_sgis.py
로컬 개발: .env 파일에 SGIS_KEY, SGIS_SECRET 저장
GitHub Actions: Secrets에 SGIS_KEY, SGIS_SECRET 등록
"""
import requests, json, os, sys, time, urllib.request
from pathlib import Path

_env_path = Path(__file__).parent.parent / '.env'
if _env_path.exists():
    for line in _env_path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

SGIS_KEY    = os.environ.get('SGIS_KEY', '').strip()
SGIS_SECRET = os.environ.get('SGIS_SECRET', '').strip()
BASE        = 'https://sgisapi.mods.go.kr/OpenAPI3'
DATA_DIR    = Path(__file__).parent.parent / 'data'

SUBMUNICIPALITIES_URL = (
    'https://raw.githubusercontent.com/southkorea/southkorea-maps/'
    'master/kostat/2013/json/skorea_submunicipalities_geo.json'
)

# 의료업종 코드: 병원, 약국, 한방병원
MEDICAL_CODES = {'9003', 'J002', 'J003'}

# SGIS 시도 코드 목록 (KOSTAT)
SIDO_CODES = ['11','21','22','23','24','25','26','29',
              '31','32','33','34','35','36','37','38','39']


def get_token() -> str:
    r = requests.get(f'{BASE}/auth/authentication.json',
        params={'consumer_key': SGIS_KEY, 'consumer_secret': SGIS_SECRET}, timeout=15)
    d = r.json()
    if d.get('errCd') != 0:
        raise RuntimeError(f'인증 실패: {d.get("errMsg")}')
    return d['result']['accessToken']


def call(token: str, path: str, extra: dict = None) -> list:
    params = {'accessToken': token}
    if extra:
        params.update(extra)
    r = requests.get(f'{BASE}/{path}', params=params, timeout=20)
    try:
        d = r.json()
    except Exception:
        return []
    if d.get('errCd') != 0:
        return []
    items = d.get('result', [])
    return items if isinstance(items, list) else ([items] if items else [])


def med_per_from_result(result: list, adm_cd: str) -> float:
    """corpdistsummary 결과에서 의료업종 비율 합산"""
    target = next((it for it in result if str(it.get('adm_cd', '')) == adm_cd), None)
    if target is None and result:
        target = result[0]
    if not target:
        return 0.0
    return round(sum(
        float(t.get('dist_per', 0) or 0)
        for t in target.get('theme_list', [])
        if str(t.get('theme_cd', '')) in MEDICAL_CODES
    ), 3)


def main():
    if not SGIS_KEY or not SGIS_SECRET:
        print('오류: SGIS_KEY, SGIS_SECRET 환경변수가 필요합니다.')
        sys.exit(1)

    print('SGIS 인증 중...')
    token = get_token()
    print('인증 성공\n')

    # ── 시도 레벨 ─────────────────────────────────────
    print('시도 인구 수집...')
    sido_pop = {it['adm_cd']: it for it in call(token, 'stats/searchpopulation.json',
                                                 {'year': '2020', 'gender': '0'})}
    print(f'  {len(sido_pop)}개')

    print('시도 사업체 수집...')
    sido_corp = {it['adm_cd']: it for it in call(token, 'stats/company.json',
                                                  {'year': '2021'})}
    print(f'  {len(sido_corp)}개')

    sido = {}
    all_codes = set(sido_pop) | set(sido_corp)
    for cd in all_codes:
        p = sido_pop.get(cd, {})
        c = sido_corp.get(cd, {})
        sido[cd] = {
            'name':       p.get('adm_nm') or c.get('adm_nm', cd),
            'population': int(p.get('population', 0) or 0),
            'corp_cnt':   int(c.get('corp_cnt', 0) or 0),
            'tot_worker': int(c.get('tot_worker', 0) or 0),
        }
    for cd in sorted(sido):
        d = sido[cd]
        print(f'  [{d["name"]}] 인구 {d["population"]:,}  사업체 {d["corp_cnt"]:,}')

    # ── 시군구 레벨 ───────────────────────────────────
    print('\n시군구 데이터 수집...')
    sgg = {}

    for sido_cd in SIDO_CODES:
        corp_items = call(token, 'stats/company.json', {'year': '2021', 'adm_cd': sido_cd})
        time.sleep(0.05)

        for it in corp_items:
            sgg_cd = str(it['adm_cd'])
            sgg[sgg_cd] = {
                'name':       it.get('adm_nm', ''),
                'sido':       sido_cd,
                'corp_cnt':   int(it.get('corp_cnt', 0) or 0),
                'tot_worker': int(it.get('tot_worker', 0) or 0),
            }

        for sgg_cd in [k for k in sgg if k.startswith(sido_cd)]:
            pop = call(token, 'stats/searchpopulation.json',
                       {'year': '2020', 'gender': '0', 'adm_cd': sgg_cd})
            if pop:
                sgg[sgg_cd]['population'] = int(pop[0].get('population', 0) or 0)
            time.sleep(0.05)

        print(f'  {sido[sido_cd]["name"]}: {len(corp_items)}개 시군구', flush=True)

    # ── 시군구 의료업종 분포 ──────────────────────────
    print('\n시군구 의료업종 분포 수집...')
    med_ok = 0
    for sgg_cd in sorted(sgg.keys()):
        result = call(token, 'startupbiz/corpdistsummary.json', {'adm_cd': sgg_cd})
        if result:
            sgg[sgg_cd]['med_per'] = med_per_from_result(result, sgg_cd)
            med_ok += 1
        time.sleep(0.05)
    print(f'  {med_ok}개 시군구 완료')

    # ── 읍면동 인구 (사업체 데이터는 시군구까지만 제공) ──
    print('\n읍면동 코드 목록 다운로드...')
    with urllib.request.urlopen(SUBMUNICIPALITIES_URL, timeout=120) as r:
        geo_raw = json.loads(r.read())
    dong_codes = [
        str(f['properties']['code'])
        for f in geo_raw['features']
        if f.get('properties', {}).get('code')
    ]
    print(f'  총 {len(dong_codes)}개 읍면동')

    print('읍면동 인구 수집 중...')
    dong = {}
    for i, code in enumerate(dong_codes):
        adm_cd = code + '0'  # 7자리 → 8자리 SGIS 코드
        pop = call(token, 'stats/searchpopulation.json',
                   {'year': '2020', 'gender': '0', 'adm_cd': adm_cd})
        if pop:
            p = pop[0]
            dong[code] = {
                'name':       p.get('adm_nm', ''),
                'population': int(p.get('population', 0) or 0),
            }
        time.sleep(0.05)
        if (i + 1) % 200 == 0:
            print(f'  {i+1}/{len(dong_codes)} 완료', flush=True)
            # 토큰 갱신 (4시간 유효, 200개마다 ~10초 경과)
            # 장시간 실행 시 필요 시 재인증
    print(f'  {len(dong)}개 읍면동 수집 완료')

    # ── 저장 ─────────────────────────────────────────
    out_path = DATA_DIR / 'sgis_stats.json'
    payload = {'updated': '2021', 'sido': sido, 'sgg': sgg, 'dong': dong}
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))

    print(f'\n완료: {out_path}')
    print(f'  시도: {len(sido)}개, 시군구: {len(sgg)}개, 읍면동: {len(dong)}개')


if __name__ == '__main__':
    main()
