// ============================================================
// 전국 병의원 현황 지도 - 메인 애플리케이션
// ============================================================

const SIDO_LIST = [
  { code: '110000', name: '서울' },
  { code: '210000', name: '부산' },
  { code: '220000', name: '대구' },
  { code: '230000', name: '인천' },
  { code: '240000', name: '광주' },
  { code: '250000', name: '대전' },
  { code: '260000', name: '울산' },
  { code: '410000', name: '세종' },
  { code: '310000', name: '경기' },
  { code: '320000', name: '강원' },
  { code: '330000', name: '충북' },
  { code: '340000', name: '충남' },
  { code: '350000', name: '전북' },
  { code: '360000', name: '전남' },
  { code: '370000', name: '경북' },
  { code: '380000', name: '경남' },
  { code: '390000', name: '제주' },
];

// HIRA 6자리 코드 → SGIS/KOSTAT 2자리 코드
const HIRA_TO_KOSTAT = {
  '110000':'11','210000':'21','220000':'22','230000':'23','240000':'24',
  '250000':'25','260000':'26','410000':'29','310000':'31','320000':'32',
  '330000':'33','340000':'34','350000':'35','360000':'36','370000':'37',
  '380000':'38','390000':'39',
};

const LAYER_CONFIG = {
  pop:  { label:'인구 분포',    gradFrom:'rgb(219,234,255)', gradTo:'rgb(30,90,160)',   stroke:'#1a73e8' },
  corp: { label:'사업체 현황',  gradFrom:'rgb(212,245,215)', gradTo:'rgb(27,120,50)',   stroke:'#2e7d32' },
  med:  { label:'의료업종 비율',gradFrom:'rgb(255,235,220)', gradTo:'rgb(190,40,40)',   stroke:'#c62828' },
};

const TYPE_GROUPS = [
  { label: '상급·종합병원', codes: ['01', '11'],             color: '#d32f2f' },
  { label: '병원',          codes: ['21', '28', '29'],        color: '#f57c00' },
  { label: '의원',          codes: ['31'],                    color: '#388e3c' },
  { label: '치과',          codes: ['41', '51'],              color: '#0288d1' },
  { label: '한방병원',      codes: ['92'],                    color: '#7b1fa2' },
  { label: '한의원',        codes: ['93'],                    color: '#9c4dcc' },
  { label: '보건소',        codes: ['71', '72', '73', '75'],  color: '#5d4037' },
];

const CLUSTER_GRID = {
  5: 2.0, 6: 1.5, 7: 1.0, 8: 0.5, 9: 0.25,
  10: 0.12, 11: 0.06, 12: 0.03, 13: 0.015,
};

const DATA_BASE_URL = './data';
const RESULTS_DISPLAY_LIMIT = 300;

// ============================================================
// 앱 상태
// ============================================================
const state = {
  map: null,
  allData: [],
  filteredData: [],
  cachedClusters: {},
  markers: [],
  activeTypes: new Set(TYPE_GROUPS.map(g => g.label)),
  activeSido: '',
  searchText: '',
  selectedId: null,
  sgisData: null,
  activeLayer: 'pop',   // 'pop' | 'corp' | 'med' | null
  sidoPolygons: [],
  sggPolygons: [],
  dongPolygons: [],
  sidoGeoData: null,
  sggGeoData: null,
  dongGeoData: null,
};

// ============================================================
// 진입점
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  initUI();
  loadAllData();
  loadSgisData();
});

// ============================================================
// 지도 초기화
// ============================================================
function initMap() {
  state.map = new naver.maps.Map('map', {
    center: new naver.maps.LatLng(36.5, 127.8),
    zoom: 7,
    mapTypeId: naver.maps.MapTypeId.NORMAL,
    zoomControl: true,
    zoomControlOptions: { position: naver.maps.Position.TOP_RIGHT },
  });

  let idleTimer = null;
  let lastZoom = state.map.getZoom();
  naver.maps.Event.addListener(state.map, 'idle', () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      const z = state.map.getZoom();
      const zoomChanged = z !== lastZoom;
      lastZoom = z;
      updateMarkers(zoomChanged);
      if (zoomChanged) updateLayer();
    }, 250);
  });
}

// ============================================================
// UI 초기화
// ============================================================
function initUI() {
  buildTypeFilters();
  buildSidoSelect();
  bindSearchEvents();
  initLayerToggles();
  document.getElementById('info-close').addEventListener('click', closeInfoPanel);
}

function buildTypeFilters() {
  const container = document.getElementById('type-filters');
  TYPE_GROUPS.forEach(group => {
    const btn = document.createElement('button');
    btn.className = 'filter-btn active';
    btn.textContent = group.label;
    btn.dataset.type = group.label;
    btn.style.background = group.color;
    btn.style.borderColor = group.color;
    btn.style.color = '#fff';
    btn.addEventListener('click', () => toggleTypeFilter(group.label, btn, group.color));
    container.appendChild(btn);
  });
}

function toggleTypeFilter(label, btn, color) {
  if (state.activeTypes.has(label)) {
    state.activeTypes.delete(label);
    btn.classList.remove('active');
    btn.style.background = '';
    btn.style.borderColor = '#dadce0';
    btn.style.color = '#5f6368';
  } else {
    state.activeTypes.add(label);
    btn.classList.add('active');
    btn.style.background = color;
    btn.style.borderColor = color;
    btn.style.color = '#fff';
  }
  applyFilters();
}

function buildSidoSelect() {
  const select = document.getElementById('sido-select');
  SIDO_LIST.forEach(sido => {
    const opt = document.createElement('option');
    opt.value = sido.code;
    opt.textContent = sido.name;
    select.appendChild(opt);
  });
  select.addEventListener('change', e => {
    state.activeSido = e.target.value;
    applyFilters();
    updateLayer();
  });
}

function bindSearchEvents() {
  const input = document.getElementById('search-input');
  const clearBtn = document.getElementById('search-clear');
  let debounceTimer;
  input.addEventListener('input', e => {
    state.searchText = e.target.value.trim();
    clearBtn.classList.toggle('visible', state.searchText.length > 0);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(applyFilters, 200);
  });
  clearBtn.addEventListener('click', () => {
    input.value = '';
    state.searchText = '';
    clearBtn.classList.remove('visible');
    applyFilters();
    input.focus();
  });
}

// ============================================================
// SGIS 레이어 토글
// ============================================================
function initLayerToggles() {
  document.querySelectorAll('.layer-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const layer = btn.dataset.layer;
      if (state.activeLayer === layer) {
        state.activeLayer = null;
        btn.classList.remove('active');
        document.getElementById('choropleth-legend').classList.remove('visible');
        clearPolygons(state.sidoPolygons);
        clearPolygons(state.sggPolygons);
      } else {
        state.activeLayer = layer;
        document.querySelectorAll('.layer-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('choropleth-legend').classList.add('visible');
        updateLayer();
      }
    });
  });
}

// ============================================================
// 데이터 로드
// ============================================================
async function loadAllData() {
  showLoading(true);
  try {
    const results = await Promise.allSettled(
      SIDO_LIST.map(sido =>
        fetch(`${DATA_BASE_URL}/hospitals_${sido.code}.json`)
          .then(r => r.ok ? r.json() : [])
          .catch(() => [])
      )
    );
    state.allData = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
    if (state.allData.length === 0) { renderNoData(); return; }
    applyFilters();
  } catch (err) {
    console.error('데이터 로드 오류:', err);
    renderNoData();
  } finally {
    showLoading(false);
  }
}

async function loadSgisData() {
  try {
    const resp = await fetch(`${DATA_BASE_URL}/sgis_stats.json`);
    if (!resp.ok) return;
    const data = await resp.json();
    state.sgisData = data;
    const yr = data.updated || '';
    document.getElementById('legend-updated').textContent = yr ? `${yr}년 기준` : '';
    updateLayer();
  } catch (e) { /* 무시 */ }
}

function showLoading(show) {
  document.getElementById('loading-overlay').style.display = show ? 'flex' : 'none';
}

function renderNoData() {
  document.getElementById('results-list').innerHTML = `
    <div class="no-results">
      데이터가 없습니다.<br><br>
      GitHub Actions의<br>
      <strong>병의원 데이터 업데이트</strong> 워크플로를<br>
      실행해 데이터를 수집하세요.
    </div>
  `;
  document.getElementById('visible-count').textContent = '0';
}

// ============================================================
// 필터 적용
// ============================================================
function applyFilters() {
  const activeTypeCodes = new Set(
    TYPE_GROUPS.filter(g => state.activeTypes.has(g.label)).flatMap(g => g.codes)
  );
  const query = state.searchText.toLowerCase();

  state.filteredData = state.allData.filter(item => {
    if (!activeTypeCodes.has(item.clCd)) return false;
    if (state.activeSido && item.sidoCd !== state.activeSido) return false;
    if (query) {
      const nameMatch = item.name && item.name.toLowerCase().includes(query);
      const addrMatch = item.addr && item.addr.toLowerCase().includes(query);
      if (!nameMatch && !addrMatch) return false;
    }
    return true;
  });

  document.getElementById('visible-count').textContent =
    state.filteredData.length.toLocaleString();

  state.cachedClusters = {};
  updateMarkers();
  renderResultsList();
}

// ============================================================
// 클러스터링
// ============================================================
function buildClusters(items, zoom) {
  if (zoom >= 14) {
    return items.filter(d => d.lat && d.lng)
      .map(d => ({ lat: d.lat, lng: d.lng, count: 1, item: d }));
  }
  const gridSize = CLUSTER_GRID[Math.max(5, Math.min(zoom, 13))] || 2.0;
  const grid = {};
  items.forEach(item => {
    if (!item.lat || !item.lng) return;
    const gx = Math.floor(item.lng / gridSize);
    const gy = Math.floor(item.lat / gridSize);
    const key = `${gx}:${gy}`;
    if (!grid[key]) grid[key] = { latSum: 0, lngSum: 0, count: 0, item };
    grid[key].latSum += item.lat;
    grid[key].lngSum += item.lng;
    grid[key].count++;
  });
  return Object.values(grid).map(c => ({
    lat: c.latSum / c.count, lng: c.lngSum / c.count,
    count: c.count, item: c.item,
  }));
}

// ============================================================
// 마커 업데이트
// ============================================================
function updateMarkers(zoomChanged) {
  if (state.filteredData.length === 0) {
    state.markers.forEach(m => m.setMap(null));
    state.markers = [];
    return;
  }
  const zoom = state.map.getZoom();
  const bounds = state.map.getBounds();
  let clusters;

  if (zoom >= 14) {
    clusters = state.filteredData
      .filter(d => d.lat && d.lng && bounds.hasLatLng(new naver.maps.LatLng(d.lat, d.lng)))
      .slice(0, 500)
      .map(d => ({ lat: d.lat, lng: d.lng, count: 1, item: d }));
  } else {
    const z = Math.max(5, Math.min(zoom, 13));
    if (!state.cachedClusters[z]) state.cachedClusters[z] = buildClusters(state.filteredData, z);
    clusters = state.cachedClusters[z].filter(c =>
      bounds.hasLatLng(new naver.maps.LatLng(c.lat, c.lng))
    );
  }

  const newMarkers = [];
  clusters.forEach(cluster => {
    const color = getGroupByCode(cluster.item.clCd)?.color || '#666';
    const icon = cluster.count === 1
      ? buildMarkerIcon(color)
      : buildClusterIcon(cluster.count);

    const marker = new naver.maps.Marker({
      position: new naver.maps.LatLng(cluster.lat, cluster.lng),
      map: state.map,
      icon,
      title: cluster.count === 1 ? cluster.item.name : `${cluster.count}개 기관`,
    });

    if (cluster.count === 1) {
      naver.maps.Event.addListener(marker, 'click', () => selectFacility(cluster.item));
    } else {
      naver.maps.Event.addListener(marker, 'click', () => {
        state.map.setCenter(new naver.maps.LatLng(cluster.lat, cluster.lng));
        state.map.setZoom(zoom + 2);
      });
    }
    newMarkers.push(marker);
  });

  const oldMarkers = state.markers;
  state.markers = newMarkers;
  oldMarkers.forEach(m => m.setMap(null));
}

function buildMarkerIcon(color) {
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="28" viewBox="0 0 22 28">`,
    `<path d="M11 0C4.925 0 0 4.925 0 11c0 8.25 11 17 11 17s11-8.75 11-17C22 4.925 17.075 0 11 0z"`,
    ` fill="${color}" stroke="white" stroke-width="1.5"/>`,
    `<circle cx="11" cy="11" r="4.5" fill="white" opacity="0.9"/>`,
    `</svg>`,
  ].join('');
  return {
    content: svg,
    size: new naver.maps.Size(22, 28),
    anchor: new naver.maps.Point(11, 28),
  };
}

function buildClusterIcon(count) {
  const size = count >= 1000 ? 56 : count >= 500 ? 52 : count >= 100 ? 46 : count >= 10 ? 40 : 34;
  const color = count >= 1000 ? '#9c27b0' : count >= 500 ? '#db4437' : count >= 100 ? '#f4b400' : count >= 10 ? '#0f9d58' : '#1a73e8';
  const label = count >= 1000 ? Math.floor(count / 1000) + 'k' : String(count);
  const fontSize = Math.round(size * 0.3);
  return {
    content: `<div style="width:${size}px;height:${size}px;background:${color};border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:${fontSize}px;box-shadow:0 2px 8px rgba(0,0,0,0.3);border:2px solid rgba(255,255,255,0.7);cursor:pointer;">${label}</div>`,
    size: new naver.maps.Size(size, size),
    anchor: new naver.maps.Point(size / 2, size / 2),
  };
}

// ============================================================
// SGIS 코로플레스 레이어
// ============================================================
function clearPolygons(arr) {
  arr.forEach(p => p.setMap(null));
  arr.length = 0;
}

function getLayerValue(d, layer) {
  if (!d) return null;
  if (layer === 'pop')  return d.population || null;
  if (layer === 'corp') return d.corp_cnt || null;
  if (layer === 'med')  return (d.med_per != null && d.med_per > 0) ? d.med_per : null;
  return null;
}

function getLayerColor(value, min, max, layer) {
  if (value == null) return 'rgb(230,230,230)';
  const t = max > min ? (value - min) / (max - min) : 0;
  if (layer === 'pop') {
    return `rgb(${Math.round(219 - t*189)},${Math.round(234 - t*144)},${Math.round(255 - t*95)})`;
  }
  if (layer === 'corp') {
    return `rgb(${Math.round(212 - t*185)},${Math.round(245 - t*125)},${Math.round(215 - t*165)})`;
  }
  if (layer === 'med') {
    return `rgb(${Math.round(255 - t*65)},${Math.round(235 - t*195)},${Math.round(220 - t*180)})`;
  }
  return 'rgb(200,200,200)';
}

function updateLegend(layer, levelLabel) {
  const cfg = LAYER_CONFIG[layer];
  if (!cfg) return;
  const title = levelLabel ? `${cfg.label} (${levelLabel})` : cfg.label;
  document.getElementById('legend-title').textContent = title;
  document.getElementById('legend-gradient').style.background =
    `linear-gradient(to right, ${cfg.gradFrom}, ${cfg.gradTo})`;
}

async function updateLayer() {
  if (!state.activeLayer || !state.sgisData) return;
  const zoom = state.map.getZoom();
  try {
    if (state.activeLayer === 'med') {
      // 의료현황: 시군구 고정 (읍면동 데이터 없음)
      clearPolygons(state.sidoPolygons);
      clearPolygons(state.dongPolygons);
      await drawSggLayer('med', state.activeSido || null);
    } else if (state.activeLayer === 'corp') {
      // 사업체: 시군구까지만 (읍면동 데이터 없음)
      clearPolygons(state.dongPolygons);
      if (state.activeSido) {
        clearPolygons(state.sidoPolygons);
        await drawSggLayer('corp', state.activeSido);
      } else {
        clearPolygons(state.sggPolygons);
        await drawSidoLayer('corp');
      }
    } else if (state.activeLayer === 'pop') {
      // 인구: 시도 선택 + zoom≥12 이면 읍면동
      if (state.activeSido && zoom >= 12 && state.sgisData.dong) {
        clearPolygons(state.sidoPolygons);
        clearPolygons(state.sggPolygons);
        await drawDongLayer(state.activeSido);
      } else if (state.activeSido) {
        clearPolygons(state.sidoPolygons);
        clearPolygons(state.dongPolygons);
        await drawSggLayer('pop', state.activeSido);
      } else {
        clearPolygons(state.sggPolygons);
        clearPolygons(state.dongPolygons);
        await drawSidoLayer('pop');
      }
    }
  } catch (e) {
    console.warn('레이어 오류:', e);
  }
}

async function loadSidoGeo() {
  if (state.sidoGeoData) return state.sidoGeoData;
  const resp = await fetch(`${DATA_BASE_URL}/sido_geo.json`);
  state.sidoGeoData = await resp.json();
  return state.sidoGeoData;
}

async function loadSggGeo() {
  if (state.sggGeoData) return state.sggGeoData;
  const resp = await fetch(`${DATA_BASE_URL}/sgg_geo.json`);
  state.sggGeoData = await resp.json();
  return state.sggGeoData;
}

async function loadDongGeo() {
  if (state.dongGeoData) return state.dongGeoData;
  const resp = await fetch(`${DATA_BASE_URL}/dong_geo.json`);
  state.dongGeoData = await resp.json();
  return state.dongGeoData;
}

// 단일 공유 InfoWindow (호버 툴팁)
let _choroplethInfo = null;
function getChoroplethInfo() {
  if (!_choroplethInfo) {
    _choroplethInfo = new naver.maps.InfoWindow({
      borderWidth: 0,
      backgroundColor: 'transparent',
      disableAnchor: true,
    });
  }
  return _choroplethInfo;
}

function makeTipContent(name, d, layer, isDong) {
  if (!d) return `<div class="map-tooltip">${escapeHtml(name)}<br><span class="tip-sub">데이터 없음</span></div>`;
  let rows = '';
  if (layer === 'pop') {
    const pop = isDong ? (d.population || 0) : (d.population || 0);
    rows = `<div class="tip-row">인구 <span>${pop.toLocaleString()}명</span></div>`;
  } else if (layer === 'corp') {
    rows = `<div class="tip-row">사업체 <span>${(d.corp_cnt || 0).toLocaleString()}개</span></div>
            <div class="tip-row">종사자 <span>${(d.tot_worker || 0).toLocaleString()}명</span></div>`;
  } else if (layer === 'med') {
    rows = `<div class="tip-row">의료업종 비율 <span>${(d.med_per || 0).toFixed(2)}%</span></div>`;
  }
  return `<div class="map-tooltip"><strong>${escapeHtml(name)}</strong>${rows}</div>`;
}

async function drawSidoLayer(layer) {
  const geo = await loadSidoGeo();
  const sidoStats = state.sgisData.sido;

  const values = Object.values(sidoStats).map(d => getLayerValue(d, layer)).filter(v => v != null);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);

  updateLegend(layer, '시도');
  clearPolygons(state.sidoPolygons);
  const info = getChoroplethInfo();

  geo.features.forEach(feat => {
    const sidoCd = feat.properties.sidoCd;
    const kostatCd = HIRA_TO_KOSTAT[sidoCd];
    const d = kostatCd ? sidoStats[kostatCd] : null;
    const val = getLayerValue(d, layer);
    const color = getLayerColor(val, minVal, maxVal, layer);
    const name = feat.properties.name || sidoCd;

    geoJsonToPolygons(feat.geometry, {
      fillColor: color, fillOpacity: 0.6,
      strokeColor: '#fff', strokeWeight: 1.5, strokeOpacity: 0.8,
      zIndex: 10,
    }).forEach(poly => {
      poly.setMap(state.map);
      naver.maps.Event.addListener(poly, 'mouseover', e => {
        poly.setOptions({ strokeWeight: 3, strokeColor: LAYER_CONFIG[layer].stroke });
        info.setContent(makeTipContent(name, d, layer));
        info.open(state.map, e.coord);
      });
      naver.maps.Event.addListener(poly, 'mouseout', () => {
        poly.setOptions({ strokeWeight: 1.5, strokeColor: '#fff' });
        info.close();
      });
      state.sidoPolygons.push(poly);
    });
  });
}

async function drawSggLayer(layer, sidoCd) {
  const geo = await loadSggGeo();
  const sggStats = state.sgisData.sgg;

  const feats = sidoCd
    ? geo.features.filter(f => f.properties.sidoCd === sidoCd)
    : geo.features;

  const values = feats.map(f => getLayerValue(sggStats[f.properties.code], layer)).filter(v => v != null);
  const minVal = values.length > 0 ? Math.min(...values) : 0;
  const maxVal = values.length > 0 ? Math.max(...values) : 1;

  updateLegend(layer, '시군구');
  clearPolygons(state.sggPolygons);
  const info = getChoroplethInfo();

  feats.forEach(feat => {
    const code = feat.properties.code;
    const d = sggStats[code];
    const val = getLayerValue(d, layer);
    const color = getLayerColor(val, minVal, maxVal, layer);
    const name = feat.properties.name;

    geoJsonToPolygons(feat.geometry, {
      fillColor: color, fillOpacity: 0.65,
      strokeColor: '#fff', strokeWeight: 0.8, strokeOpacity: 0.7,
      zIndex: 10,
    }).forEach(poly => {
      poly.setMap(state.map);
      naver.maps.Event.addListener(poly, 'mouseover', e => {
        poly.setOptions({ strokeWeight: 2, strokeColor: LAYER_CONFIG[layer].stroke });
        info.setContent(makeTipContent(name, d, layer));
        info.open(state.map, e.coord);
      });
      naver.maps.Event.addListener(poly, 'mouseout', () => {
        poly.setOptions({ strokeWeight: 0.8, strokeColor: '#fff' });
        info.close();
      });
      state.sggPolygons.push(poly);
    });
  });
}

async function drawDongLayer(sidoCd) {
  const geo = await loadDongGeo();
  const dongStats = state.sgisData.dong || {};

  const feats = sidoCd
    ? geo.features.filter(f => f.properties.sidoCd === sidoCd)
    : geo.features;

  const values = feats.map(f => {
    const d = dongStats[f.properties.code];
    return d ? (d.population || null) : null;
  }).filter(v => v != null);
  const minVal = values.length > 0 ? Math.min(...values) : 0;
  const maxVal = values.length > 0 ? Math.max(...values) : 1;

  updateLegend('pop', '읍면동');
  clearPolygons(state.dongPolygons);
  const info = getChoroplethInfo();

  feats.forEach(feat => {
    const code = feat.properties.code;
    const d = dongStats[code];
    const val = d ? (d.population || null) : null;
    const color = getLayerColor(val, minVal, maxVal, 'pop');
    const name = feat.properties.name;

    geoJsonToPolygons(feat.geometry, {
      fillColor: color, fillOpacity: 0.65,
      strokeColor: '#fff', strokeWeight: 0.5, strokeOpacity: 0.6,
      zIndex: 10,
    }).forEach(poly => {
      poly.setMap(state.map);
      naver.maps.Event.addListener(poly, 'mouseover', e => {
        poly.setOptions({ strokeWeight: 2, strokeColor: LAYER_CONFIG['pop'].stroke });
        info.setContent(makeTipContent(name, d, 'pop', true));
        info.open(state.map, e.coord);
      });
      naver.maps.Event.addListener(poly, 'mouseout', () => {
        poly.setOptions({ strokeWeight: 0.5, strokeColor: '#fff' });
        info.close();
      });
      state.dongPolygons.push(poly);
    });
  });
}

// GeoJSON geometry → Naver Maps Polygon 배열
function geoJsonToPolygons(geometry, opts) {
  const polys = [];
  const makeNaverPaths = rings =>
    rings.map(ring => ring.map(([lng, lat]) => new naver.maps.LatLng(lat, lng)));

  if (geometry.type === 'Polygon') {
    polys.push(new naver.maps.Polygon({
      paths: makeNaverPaths(geometry.coordinates),
      ...opts,
    }));
  } else if (geometry.type === 'MultiPolygon') {
    geometry.coordinates.forEach(polyCords => {
      polys.push(new naver.maps.Polygon({
        paths: makeNaverPaths(polyCords),
        ...opts,
      }));
    });
  }
  return polys;
}

// ============================================================
// 검색결과 목록
// ============================================================
function renderResultsList() {
  const list = document.getElementById('results-list');
  if (state.filteredData.length === 0) {
    list.innerHTML = `<div class="no-results">검색 결과가 없습니다.<br>검색어나 필터를 변경해보세요.</div>`;
    return;
  }

  const displayItems = state.filteredData.slice(0, RESULTS_DISPLAY_LIMIT);
  const exceeded = state.filteredData.length > RESULTS_DISPLAY_LIMIT;

  list.innerHTML = displayItems.map(item => {
    const group = getGroupByCode(item.clCd);
    const color = group ? group.color : '#888';
    const isActive = item.id === state.selectedId;
    return `
      <div class="result-item${isActive ? ' active' : ''}" role="listitem" data-id="${escapeHtml(item.id)}">
        <span class="result-type-badge" style="background:${color}20;color:${color}">${escapeHtml(item.clCdNm || '')}</span>
        <div class="result-name">${escapeHtml(item.name)}</div>
        <div class="result-addr">${escapeHtml(item.addr || '')}</div>
      </div>
    `;
  }).join('');

  if (exceeded) {
    list.innerHTML += `
      <div class="results-limit-notice">
        상위 ${RESULTS_DISPLAY_LIMIT}건만 표시됩니다. 검색어로 범위를 좁혀보세요.
      </div>
    `;
  }

  list.querySelectorAll('.result-item').forEach(el => {
    el.addEventListener('click', () => {
      const item = state.filteredData.find(d => d.id === el.dataset.id);
      if (item) selectFacility(item);
    });
  });
}

// ============================================================
// 기관 선택
// ============================================================
function selectFacility(item) {
  state.selectedId = item.id;
  if (item.lat && item.lng) {
    state.map.setCenter(new naver.maps.LatLng(item.lat, item.lng));
    if (state.map.getZoom() < 15) state.map.setZoom(15);
  }
  showInfoPanel(item);
  highlightListItem(item.id);
}

function highlightListItem(id) {
  document.querySelectorAll('.result-item').forEach(el => {
    const isActive = el.dataset.id === id;
    el.classList.toggle('active', isActive);
    if (isActive) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

// ============================================================
// 상세 정보 패널
// ============================================================
function showInfoPanel(item) {
  const group = getGroupByCode(item.clCd);
  const color = group ? group.color : '#666';
  const rows = buildInfoRows(item);

  document.getElementById('info-content').innerHTML = `
    <div class="info-type-badge" style="background:${color}">${escapeHtml(item.clCdNm || '병의원')}</div>
    <div class="info-name">${escapeHtml(item.name)}</div>
    <div class="info-divider"></div>
    ${rows.map(r => `
      <div class="info-row">
        <div class="info-row-icon">${r.icon}</div>
        <div class="info-row-text">${r.html}</div>
      </div>
    `).join('')}
  `;
  document.getElementById('info-panel').removeAttribute('hidden');
}

function buildInfoRows(item) {
  const rows = [];
  if (item.addr) rows.push({ icon: '📍', html: escapeHtml(item.addr) });
  if (item.phone) rows.push({ icon: '📞', html: `<a href="tel:${escapeHtml(item.phone)}">${escapeHtml(item.phone)}</a>` });
  if (item.hospUrl) {
    const url = item.hospUrl.startsWith('http') ? item.hospUrl : 'http://' + item.hospUrl;
    rows.push({ icon: '🌐', html: `<a href="${encodeURI(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.hospUrl)}</a>` });
  }
  if (item.estbDd) rows.push({ icon: '📅', html: `개설일 ${formatDate(item.estbDd)}` });
  if (item.drTotCnt) {
    const doctorText = `의사 ${item.drTotCnt}명` + (item.mdeptSdrCnt ? ` (전문의 ${item.mdeptSdrCnt}명)` : '');
    rows.push({ icon: '👨‍⚕️', html: escapeHtml(doctorText) });
  }
  if (item.sgguCdNm) rows.push({ icon: '🗺️', html: escapeHtml(`${item.sidoCdNm || ''} ${item.sgguCdNm}`.trim()) });
  return rows;
}

function closeInfoPanel() {
  document.getElementById('info-panel').setAttribute('hidden', '');
  state.selectedId = null;
  document.querySelectorAll('.result-item').forEach(el => el.classList.remove('active'));
}

// ============================================================
// 유틸리티
// ============================================================
function getGroupByCode(code) {
  return TYPE_GROUPS.find(g => g.codes.includes(code));
}

function formatDate(d) {
  if (!d || String(d).length < 8) return String(d);
  const s = String(d);
  return `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6, 8)}`;
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
