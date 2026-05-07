"""
한의원 입지 분석용 SGIS 데이터 수집 스크립트

수집 대상(읍면동 단위):
- 총조사 주요지표: 총인구, 평균연령, 노령화지수, 총가구, 총주택
- 사업체통계: 사업체수, 종사자수
- 생활업종 후보지 정보: 아파트 비율, 1인가구 비율, 65세 이상 비율,
  거주/직장 인구 성격
- 성별인구비율 요약정보: 여성 비율, 여성 인구

출력:
- data/sgis_haniwon.json

사용법:
  python scripts/fetch_sgis.py
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import requests

BASE = "https://sgisapi.mods.go.kr/OpenAPI3"
ROOT_DIR = Path(__file__).parent.parent
DATA_DIR = ROOT_DIR / "data"
DONG_GEO_PATH = DATA_DIR / "dong_geo.json"
SGG_GEO_PATH = DATA_DIR / "sgg_geo.json"
OUTPUT_PATH = DATA_DIR / "sgis_haniwon.json"
REQUEST_TIMEOUT = 30
RETRY_COUNT = 4
REQUEST_DELAY = 0.03

HIRA_TO_KOSTAT = {
    "110000": "11",
    "210000": "21",
    "220000": "22",
    "230000": "23",
    "240000": "24",
    "250000": "25",
    "260000": "26",
    "410000": "29",
    "310000": "31",
    "320000": "32",
    "330000": "33",
    "340000": "34",
    "350000": "35",
    "360000": "36",
    "370000": "37",
    "380000": "38",
    "390000": "39",
}

HIRA_TO_SIDO_NAME = {
    "110000": "서울",
    "210000": "부산",
    "220000": "대구",
    "230000": "인천",
    "240000": "광주",
    "250000": "대전",
    "260000": "울산",
    "410000": "세종",
    "310000": "경기",
    "320000": "강원",
    "330000": "충북",
    "340000": "충남",
    "350000": "전북",
    "360000": "전남",
    "370000": "경북",
    "380000": "경남",
    "390000": "제주",
}


def load_env_file() -> None:
    env_path = ROOT_DIR / ".env"
    if not env_path.exists():
        return

    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


load_env_file()

SGIS_KEY = os.environ.get("SGIS_KEY", "").strip()
SGIS_SECRET = os.environ.get("SGIS_SECRET", "").strip()


def to_int(value) -> int | None:
    try:
        if value in (None, "", "N/A"):
            return None
        return int(float(value))
    except (TypeError, ValueError):
        return None


def to_float(value) -> float | None:
    try:
        if value in (None, "", "N/A"):
            return None
        return round(float(value), 2)
    except (TypeError, ValueError):
        return None


def ensure_list(value) -> list:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return [value]
    return []


def normalize_area_name(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    text = text.split()[-1]
    return text.replace(" ", "")


class SgisClient:
    def __init__(self, key: str, secret: str) -> None:
        self.key = key
        self.secret = secret
        self.session = requests.Session()
        self.token = ""

    def authenticate(self) -> None:
        response = self.session.get(
            f"{BASE}/auth/authentication.json",
            params={"consumer_key": self.key, "consumer_secret": self.secret},
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        data = response.json()
        if data.get("errCd") != 0:
            raise RuntimeError(f"SGIS 인증 실패: {data.get('errMsg')}")
        self.token = data["result"]["accessToken"]

    def get(self, path: str, extra: dict | None = None, allow_empty: bool = False):
        if not self.token:
            self.authenticate()

        params = {"accessToken": self.token}
        if extra:
            params.update(extra)

        last_error = None
        for attempt in range(RETRY_COUNT):
            try:
                response = self.session.get(
                    f"{BASE}/{path}",
                    params=params,
                    timeout=REQUEST_TIMEOUT,
                )
                response.raise_for_status()
                data = response.json()

                if data.get("errCd") == 0:
                    return data.get("result")

                if allow_empty and data.get("errCd") == -100:
                    return []

                # 만료 토큰 등 재인증이 필요한 경우
                if attempt < RETRY_COUNT - 1:
                    self.authenticate()
                    params["accessToken"] = self.token
                    time.sleep(0.5 + attempt * 0.5)
                    continue

                last_error = RuntimeError(
                    f"{path} 호출 실패: {data.get('errCd')} {data.get('errMsg')}"
                )
            except (requests.RequestException, ValueError) as exc:
                last_error = exc
                if attempt < RETRY_COUNT - 1:
                    time.sleep(0.7 + attempt * 0.7)
                    continue
            break

        if last_error:
            raise last_error
        raise RuntimeError(f"{path} 호출 실패")


def load_geo_indexes() -> tuple[dict[str, dict], dict[str, str]]:
    if not DONG_GEO_PATH.exists():
        raise FileNotFoundError(f"{DONG_GEO_PATH} 파일이 없습니다.")
    if not SGG_GEO_PATH.exists():
        raise FileNotFoundError(f"{SGG_GEO_PATH} 파일이 없습니다.")

    dong_geo = json.loads(DONG_GEO_PATH.read_text(encoding="utf-8"))
    sgg_geo = json.loads(SGG_GEO_PATH.read_text(encoding="utf-8"))

    sgg_name_map = {
        str(feature["properties"]["code"]): str(feature["properties"]["name"])
        for feature in sgg_geo.get("features", [])
        if feature.get("properties", {}).get("code")
    }

    dong_map: dict[str, dict] = {}
    for feature in dong_geo.get("features", []):
        props = feature.get("properties", {})
        sgis_adm_cd = str(props.get("sgisAdmCd", "") or "")
        if len(sgis_adm_cd) != 8:
            continue
        code = str(props.get("code", "") or sgis_adm_cd)
        code7 = str(props.get("code7", "") or sgis_adm_cd[:7])

        sido_cd = str(props.get("sidoCd", "") or "")
        sgg_code = str(props.get("sggCode", "") or "")
        dong_map[sgis_adm_cd] = {
            "code": code,
            "code7": code7,
            "sgisAdmCd": sgis_adm_cd,
            "name": str(props.get("name", "") or ""),
            "sidoCd": sido_cd,
            "sidoName": HIRA_TO_SIDO_NAME.get(sido_cd, sido_cd),
            "sggCode": sgg_code,
            "sggName": str(props.get("sggName", "") or sgg_name_map.get(sgg_code, "")),
            "kostatSidoCd": HIRA_TO_KOSTAT.get(sido_cd, ""),
        }

    return dong_map, sgg_name_map


def pick_exact_row(result, adm_cd: str) -> dict | None:
    rows = ensure_list(result)
    for row in rows:
        if str(row.get("adm_cd", "")) == adm_cd:
            return row
    return None


def fetch_years(client: SgisClient) -> dict:
    result = client.get("year/data.json")
    if not isinstance(result, dict):
        raise RuntimeError("기준년도 정보를 가져오지 못했습니다.")
    return result


def collect_population_and_company(
    client: SgisClient,
    dong_map: dict[str, dict],
    population_year: str,
    company_year: str,
) -> dict[str, dict]:
    data_map = {code: dict(meta) for code, meta in dong_map.items()}
    sgg_codes = sorted({meta["sggCode"] for meta in dong_map.values() if meta["sggCode"]})

    print(f"시군구 {len(sgg_codes)}개에 대해 총조사 주요지표 수집 중...")
    for idx, sgg_code in enumerate(sgg_codes, start=1):
        scoped_codes = [key for key, meta in data_map.items() if meta["sggCode"] == sgg_code]

        population_rows = ensure_list(
            client.get(
                "stats/population.json",
                {"year": population_year, "adm_cd": sgg_code, "low_search": 1},
                allow_empty=True,
            )
        )
        population_by_code = {
            str(row.get("adm_cd", "") or ""): row for row in population_rows
        }
        population_by_name = {
            normalize_area_name(row.get("adm_nm")): row for row in population_rows
            if normalize_area_name(row.get("adm_nm"))
        }
        for sgis_adm_cd in scoped_codes:
            entry = data_map[sgis_adm_cd]
            row = population_by_code.get(sgis_adm_cd)
            if row is None:
                row = population_by_name.get(normalize_area_name(entry.get("name", "")))
            if row is None:
                continue
            matched_adm_cd = str(row.get("adm_cd", "") or "")
            if matched_adm_cd:
                entry["statsAdmCd"] = matched_adm_cd
            entry.update(
                {
                    "totalPopulation": to_int(row.get("tot_ppltn")),
                    "averageAge": to_float(row.get("avg_age")),
                    "agingIndex": to_float(row.get("aged_child_idx")),
                    "populationDensity": to_float(row.get("ppltn_dnsty")),
                    "totalFamilies": to_int(row.get("tot_family")),
                    "averageFamilyMembers": to_float(row.get("avg_fmember_cnt")),
                    "totalHouses": to_int(row.get("tot_house")),
                }
            )

        company_rows = ensure_list(
            client.get(
                "stats/company.json",
                {"year": company_year, "adm_cd": sgg_code, "low_search": 1},
                allow_empty=True,
            )
        )
        company_by_code = {
            str(row.get("adm_cd", "") or ""): row for row in company_rows
        }
        company_by_name = {
            normalize_area_name(row.get("adm_nm")): row for row in company_rows
            if normalize_area_name(row.get("adm_nm"))
        }
        for sgis_adm_cd in scoped_codes:
            entry = data_map[sgis_adm_cd]
            row = company_by_code.get(sgis_adm_cd)
            if row is None:
                row = company_by_name.get(normalize_area_name(entry.get("name", "")))
            if row is None:
                continue
            matched_adm_cd = str(row.get("adm_cd", "") or "")
            if matched_adm_cd:
                entry["statsAdmCd"] = matched_adm_cd
            entry.update(
                {
                    "businessCount": to_int(row.get("corp_cnt")),
                    "workerCount": to_int(row.get("tot_worker")),
                }
            )

        if idx % 25 == 0 or idx == len(sgg_codes):
            print(f"  {idx}/{len(sgg_codes)} 시군구 완료")
        time.sleep(REQUEST_DELAY)

    return data_map


def collect_region_summaries(client: SgisClient, data_map: dict[str, dict]) -> None:
    items = list(sorted(data_map.items()))
    total = len(items)

    print(f"읍면동 {total}개에 대해 생활업종 후보지 정보 수집 중...")
    for idx, (code7, entry) in enumerate(items, start=1):
        row = pick_exact_row(
            client.get(
                "startupbiz/regiontotal.json",
                {"adm_cd": entry["sgisAdmCd"]},
                allow_empty=True,
            ),
            entry["sgisAdmCd"],
        )
        if row:
            entry.update(
                {
                    "apartmentRate": to_float(row.get("apart_per")),
                    "residentialPopulationLevel": to_float(row.get("resid_ppltn_per")),
                    "jobPopulationLevel": to_float(row.get("job_ppltn_per")),
                    "onePersonHouseholdRate": to_float(row.get("one_person_family_per")),
                    "senior65Rate": to_float(row.get("sixty_five_more_ppltn_per")),
                    "twentyRate": to_float(row.get("twenty_ppltn_per")),
                }
            )

        row = pick_exact_row(
            client.get(
                "startupbiz/mfratiosummary.json",
                {"adm_cd": entry["sgisAdmCd"]},
                allow_empty=True,
            ),
            entry["sgisAdmCd"],
        )
        if row:
            entry.update(
                {
                    "femaleRate": to_float(row.get("f_per")),
                    "maleRate": to_float(row.get("m_per")),
                    "femalePopulation": to_int(row.get("f_ppl")),
                    "malePopulation": to_int(row.get("m_ppl")),
                }
            )

        if idx % 100 == 0 or idx == total:
            print(f"  {idx}/{total} 읍면동 완료")
        time.sleep(REQUEST_DELAY)


def build_payload(years: dict, data_map: dict[str, dict]) -> dict:
    return {
        "focus": "haniwon",
        "updated": {
            "populationYear": str(years.get("lin_yr", "")),
            "companyYear": str(years.get("lcorp_yr", "")),
            "boundaryYear": str(years.get("lboudary_yr", "")),
            "smallAreaBoundaryYear": str(years.get("loa_yr", "")),
        },
        "layers": [
            "totalPopulation",
            "averageAge",
            "senior65Rate",
            "workerCount",
            "apartmentRate",
        ],
        "dong": data_map,
    }


def main() -> None:
    if not SGIS_KEY or not SGIS_SECRET:
        print("오류: SGIS_KEY, SGIS_SECRET 환경변수가 필요합니다.")
        sys.exit(1)

    dong_map, _ = load_geo_indexes()
    print(f"읍면동 메타데이터 {len(dong_map)}개 로드")

    client = SgisClient(SGIS_KEY, SGIS_SECRET)
    print("SGIS 인증 중...")
    client.authenticate()
    print("인증 성공")

    years = fetch_years(client)
    population_year = str(years.get("lin_yr", "") or "")
    company_year = str(years.get("lcorp_yr", "") or "")
    print(f"기준년도: 인구/주택 {population_year}, 사업체 {company_year}")

    data_map = collect_population_and_company(client, dong_map, population_year, company_year)
    collect_region_summaries(client, data_map)

    payload = build_payload(years, data_map)
    OUTPUT_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    complete = sum(1 for item in data_map.values() if item.get("totalPopulation") is not None)
    print(f"\n완료: {OUTPUT_PATH}")
    print(f"  읍면동 {len(data_map)}개 중 인구 데이터 보유 {complete}개")


if __name__ == "__main__":
    main()
