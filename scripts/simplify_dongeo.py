"""
SGIS 최신 읍면동 경계를 내려받아 data/dong_geo.json으로 저장한다.

- boundary/hadmarea.geojson 을 시도별(low_search=2)로 호출
- 최신 경계코드(8자리)와 화면용 코드(7자리)를 함께 보관
- 지도 성능을 위해 shapely simplify 적용

사용법:
  python scripts/simplify_dongeo.py
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import requests
from shapely.geometry import mapping, shape

BASE = "https://sgisapi.mods.go.kr/OpenAPI3"
ROOT_DIR = Path(__file__).parent.parent
OUT = ROOT_DIR / "data" / "dong_geo.json"
DONG_SPLIT_DIR = ROOT_DIR / "data" / "dong_geo_sido"
REQUEST_TIMEOUT = 60
SIMPLIFY_TOLERANCE = 0.008
COORD_PRECISION = 5

KOSTAT_TO_HIRA = {
    "11": "110000",
    "21": "210000",
    "22": "220000",
    "23": "230000",
    "24": "240000",
    "25": "250000",
    "26": "260000",
    "29": "410000",
    "31": "310000",
    "32": "320000",
    "33": "330000",
    "34": "340000",
    "35": "350000",
    "36": "360000",
    "37": "370000",
    "38": "380000",
    "39": "390000",
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


def normalize_stats_adm_cd(value: str) -> str:
    text = str(value or "").strip()
    if len(text) >= 8:
        return text[:7]
    return text[:7]


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
        payload = response.json()
        if payload.get("errCd") != 0:
            raise RuntimeError(f"SGIS 인증 실패: {payload.get('errMsg')}")
        self.token = payload["result"]["accessToken"]

    def get_json(self, path: str, params: dict) -> dict:
        if not self.token:
            self.authenticate()

        request_params = {"accessToken": self.token, **params}
        response = self.session.get(
            f"{BASE}/{path}",
            params=request_params,
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        payload = response.json()
        if payload.get("errCd") not in (None, 0):
            raise RuntimeError(f"{path} 호출 실패: {payload.get('errCd')} {payload.get('errMsg')}")
        return payload


def fetch_boundary_year(client: SgisClient) -> str:
    payload = client.get_json("year/data.json", {})
    result = payload.get("result") or {}
    year = str(result.get("lboudary_yr", "") or "")
    if not year:
        raise RuntimeError("최신 경계 연도를 찾지 못했습니다.")
    return year


def build_feature(raw_feature: dict) -> dict | None:
    props = raw_feature.get("properties", {})
    adm_cd8 = str(props.get("adm_cd", "") or "")
    code7 = normalize_stats_adm_cd(adm_cd8)
    if len(code7) != 7:
        return None

    full_name = str(props.get("adm_nm", "") or "").strip()
    name_parts = full_name.split()
    short_name = name_parts[-1] if name_parts else full_name
    sgg_name = name_parts[-2] if len(name_parts) >= 2 else ""

    sido_hira = KOSTAT_TO_HIRA.get(code7[:2], "")
    if not sido_hira:
        return None

    try:
        geom = shape(raw_feature["geometry"]).simplify(
            SIMPLIFY_TOLERANCE,
            preserve_topology=True,
        )
    except Exception:
        return None

    if geom.is_empty:
        return None

    return {
        "type": "Feature",
        "geometry": round_geometry(mapping(geom)),
        "properties": {
            "code": code7,
            "sgisAdmCd": adm_cd8,
            "name": short_name,
            "fullName": full_name,
            "sggCode": code7[:5],
            "sggName": sgg_name,
            "sidoCd": sido_hira,
        },
    }


def round_geometry(value):
    if isinstance(value, float):
        return round(value, COORD_PRECISION)
    if isinstance(value, list):
        return [round_geometry(item) for item in value]
    if isinstance(value, tuple):
        return [round_geometry(item) for item in value]
    if isinstance(value, dict):
        return {key: round_geometry(item) for key, item in value.items()}
    return value


def main() -> None:
    load_env_file()
    sgis_key = os.environ.get("SGIS_KEY", "").strip()
    sgis_secret = os.environ.get("SGIS_SECRET", "").strip()
    if not sgis_key or not sgis_secret:
        print("오류: SGIS_KEY, SGIS_SECRET 환경변수가 필요합니다.")
        sys.exit(1)

    client = SgisClient(sgis_key, sgis_secret)
    boundary_year = fetch_boundary_year(client)
    print(f"최신 읍면동 경계 연도: {boundary_year}")

    features: list[dict] = []
    seen_codes: set[str] = set()

    for idx, sido_cd in enumerate(sorted(KOSTAT_TO_HIRA.keys()), start=1):
        print(f"[{idx}/17] 시도 {sido_cd} 경계 수집 중...")
        payload = client.get_json(
            "boundary/hadmarea.geojson",
            {"year": boundary_year, "adm_cd": sido_cd, "low_search": 2},
        )
        raw_features = payload.get("features", [])
        added = 0

        for raw_feature in raw_features:
            feature = build_feature(raw_feature)
            if feature is None:
                continue
            code7 = feature["properties"]["code"]
            if code7 in seen_codes:
                continue
            seen_codes.add(code7)
            features.append(feature)
            added += 1

        print(f"  추가 {added}개, 누적 {len(features)}개")
        time.sleep(0.2)

    result = {"type": "FeatureCollection", "features": features}
    OUT.write_text(
        json.dumps(result, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    DONG_SPLIT_DIR.mkdir(parents=True, exist_ok=True)
    grouped: dict[str, list[dict]] = {}
    for feature in features:
        sido_hira = feature["properties"]["sidoCd"]
        grouped.setdefault(sido_hira, []).append(feature)

    for sido_hira, sido_features in grouped.items():
        split_path = DONG_SPLIT_DIR / f"{sido_hira}.json"
        split_path.write_text(
            json.dumps({"type": "FeatureCollection", "features": sido_features}, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )

    print(f"완료: {OUT}")
    print(f"  읍면동 {len(features)}개, 용량 {OUT.stat().st_size / 1024 / 1024:.2f} MB")
    print(f"  시도별 분할 파일 {len(grouped)}개 생성: {DONG_SPLIT_DIR}")


if __name__ == "__main__":
    main()
