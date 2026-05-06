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

const HIRA_TO_KOSTAT = {
  '110000': '11',
  '210000': '21',
  '220000': '22',
  '230000': '23',
  '240000': '24',
  '250000': '25',
  '260000': '26',
  '410000': '29',
  '310000': '31',
  '320000': '32',
  '330000': '33',
  '340000': '34',
  '350000': '35',
  '360000': '36',
  '370000': '37',
  '380000': '38',
  '390000': '39',
};

const LAYER_CONFIG = {
  none: {
    label: '마커만 보기',
    description: '병의원 마커와 목록에만 집중해서 보기에 적합합니다.',
  },
  pop: {
    label: '인구 분포',
    descriptionNational: '전국 시도 단위 인구 규모를 비교합니다.',
    descriptionLocal: '선택 지역의 시군구별 인구 규모를 비교합니다.',
    gradFrom: 'rgb(219,234,255)',
    gradTo: 'rgb(30,90,160)',
    stroke: '#1769ff',
  },
  corp: {
    label: '사업체 현황',
    descriptionNational: '전국 시도 단위 사업체 규모를 비교합니다.',
    descriptionLocal: '선택 지역의 시군구별 사업체 규모를 비교합니다.',
    gradFrom: 'rgb(212,245,215)',
    gradTo: 'rgb(27,120,50)',
    stroke: '#2e8b57',
  },
  med: {
    label: '의료업종 비율',
    descriptionNational: '전국 시군구 단위 의료업종 비율을 비교합니다.',
    descriptionLocal: '선택 지역의 시군구별 의료업종 비율을 비교합니다.',
    gradFrom: 'rgb(255,235,220)',
    gradTo: 'rgb(190,40,40)',
    stroke: '#e65c4f',
  },
};

const TYPE_GROUPS = [
  { label: '상급·종합병원', codes: ['01', '11'], color: '#d32f2f' },
  { label: '병원', codes: ['21', '28', '29'], color: '#f57c00' },
  { label: '의원', codes: ['31'], color: '#388e3c' },
  { label: '치과', codes: ['41', '51'], color: '#0288d1' },
  { label: '한방병원', codes: ['92'], color: '#7b1fa2' },
  { label: '한의원', codes: ['93'], color: '#9c4dcc' },
  { label: '보건소', codes: ['71', '72', '73', '75'], color: '#5d4037' },
];

const CLUSTER_GRID = {
  5: 2.0,
  6: 1.5,
  7: 1.0,
  8: 0.5,
  9: 0.25,
  10: 0.12,
  11: 0.06,
  12: 0.03,
  13: 0.015,
};

const DATA_BASE_URL = './data';
const RESULTS_DISPLAY_LIMIT = 300;
const INITIAL_MAP_CENTER = { lat: 36.5, lng: 127.8, zoom: 7 };
const MOBILE_MEDIA_QUERY = '(max-width: 960px)';

const state = {
  map: null,
  allData: [],
  filteredData: [],
  cachedClusters: {},
  markers: [],
  activeTypes: new Set(TYPE_GROUPS.map(group => group.label)),
  activeSido: '',
  searchText: '',
  selectedId: null,
  sgisData: null,
  activeLayer: 'pop',
  sidoPolygons: [],
  sggPolygons: [],
  sidoGeoData: null,
  sggGeoData: null,
};

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  initUI();
  updateLegend(state.activeLayer);
  updateLayerDescription();
  updateSidebarSummary();
  updateMapOverlay();
  loadAllData();
  loadSgisData();
});

function initMap() {
  state.map = new naver.maps.Map('map', {
    center: new naver.maps.LatLng(INITIAL_MAP_CENTER.lat, INITIAL_MAP_CENTER.lng),
    zoom: INITIAL_MAP_CENTER.zoom,
    mapTypeId: naver.maps.MapTypeId.NORMAL,
    zoomControl: true,
    zoomControlOptions: { position: naver.maps.Position.TOP_RIGHT },
  });

  let idleTimer = null;
  naver.maps.Event.addListener(state.map, 'idle', () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => updateMarkers(), 180);
  });
}

function initUI() {
  buildTypeFilters();
  buildSidoSelect();
  bindSearchEvents();
  bindActionEvents();
  syncLayerButtons();
  updateMobileSidebarButton();
}

function buildTypeFilters() {
  const container = document.getElementById('type-filters');
  TYPE_GROUPS.forEach(group => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'filter-btn active';
    button.dataset.type = group.label;
    button.textContent = group.label;
    button.setAttribute('aria-pressed', 'true');
    setTypeButtonState(button, true, group.color);
    button.addEventListener('click', () => toggleTypeFilter(group.label, button, group.color));
    container.appendChild(button);
  });
}

function buildSidoSelect() {
  const select = document.getElementById('sido-select');
  SIDO_LIST.forEach(sido => {
    const option = document.createElement('option');
    option.value = sido.code;
    option.textContent = sido.name;
    select.appendChild(option);
  });

  select.addEventListener('change', async event => {
    await setSidoFilter(event.target.value, { fitToScope: Boolean(event.target.value) });
  });
}

function bindSearchEvents() {
  const input = document.getElementById('search-input');
  const clearButton = document.getElementById('search-clear');
  let debounceTimer = null;

  input.addEventListener('input', event => {
    state.searchText = event.target.value.trim();
    clearButton.classList.toggle('visible', state.searchText.length > 0);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => applyFilters(), 180);
  });

  clearButton.addEventListener('click', () => {
    input.value = '';
    state.searchText = '';
    clearButton.classList.remove('visible');
    applyFilters();
    input.focus();
  });
}

function bindActionEvents() {
  document.getElementById('reset-filters').addEventListener('click', resetFilters);
  document.getElementById('info-close').addEventListener('click', closeInfoPanel);

  document.querySelectorAll('.layer-btn').forEach(button => {
    button.addEventListener('click', () => setActiveLayer(button.dataset.layer));
  });

  const sidebarToggle = document.getElementById('mobile-sidebar-toggle');
  sidebarToggle.addEventListener('click', () => toggleSidebar());

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    closeInfoPanel();
    closeSidebarOnMobile();
  });

  const mediaQuery = window.matchMedia(MOBILE_MEDIA_QUERY);
  const onChange = () => updateMobileSidebarButton();
  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', onChange);
  } else if (typeof mediaQuery.addListener === 'function') {
    mediaQuery.addListener(onChange);
  }
}

function toggleTypeFilter(label, button, color) {
  if (state.activeTypes.has(label)) {
    state.activeTypes.delete(label);
    setTypeButtonState(button, false, color);
  } else {
    state.activeTypes.add(label);
    setTypeButtonState(button, true, color);
  }
  applyFilters();
}

function setTypeButtonState(button, isActive, color) {
  button.classList.toggle('active', isActive);
  button.setAttribute('aria-pressed', String(isActive));
  if (isActive) {
    button.style.background = color;
    button.style.borderColor = color;
    button.style.color = '#fff';
  } else {
    button.style.background = '#fff';
    button.style.borderColor = 'rgba(16, 37, 60, 0.12)';
    button.style.color = '#5c6b7a';
  }
}

function setActiveLayer(layer) {
  if (!LAYER_CONFIG[layer]) return;
  state.activeLayer = layer;
  syncLayerButtons();
  updateLegend(layer);
  updateLayerDescription();
  updateSidebarSummary();
  updateMapOverlay();
  updateLayer();
}

function syncLayerButtons() {
  document.querySelectorAll('.layer-btn').forEach(button => {
    const isActive = button.dataset.layer === state.activeLayer;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
}

async function setSidoFilter(sidoCode, options = {}) {
  state.activeSido = sidoCode;
  document.getElementById('sido-select').value = sidoCode;
  applyFilters();
  updateLayerDescription();
  await updateLayer();

  if (options.fitToScope && sidoCode) {
    try {
      const geo = await loadSidoGeo();
      const feature = geo.features.find(item => item.properties.sidoCd === sidoCode);
      if (feature) focusGeometry(feature.geometry);
    } catch (error) {
      console.warn('시도 포커스 오류:', error);
    }
  }
}

async function loadAllData() {
  showLoading(true);
  try {
    const results = await Promise.allSettled(
      SIDO_LIST.map(sido =>
        fetch(`${DATA_BASE_URL}/hospitals_${sido.code}.json`)
          .then(response => (response.ok ? response.json() : []))
          .catch(() => [])
      )
    );

    state.allData = results.flatMap(result => (result.status === 'fulfilled' ? result.value : []));
    if (state.allData.length === 0) {
      renderNoData();
      return;
    }
    applyFilters();
  } catch (error) {
    console.error('데이터 로드 오류:', error);
    renderNoData();
  } finally {
    showLoading(false);
  }
}

async function loadSgisData() {
  try {
    const response = await fetch(`${DATA_BASE_URL}/sgis_stats.json`);
    if (!response.ok) return;
    const data = await response.json();
    state.sgisData = data;
    document.getElementById('legend-updated').textContent = data.updated ? `${data.updated}년 기준` : '';
    updateSidebarSummary();
    updateLayer();
  } catch (error) {
    console.warn('SGIS 데이터 로드 오류:', error);
  }
}

function showLoading(show) {
  document.getElementById('loading-overlay').style.display = show ? 'flex' : 'none';
}

function renderNoData() {
  state.filteredData = [];
  document.getElementById('results-list').innerHTML = `
    <div class="no-results">
      데이터가 없습니다.<br><br>
      GitHub Actions의 <strong>병의원 데이터 업데이트</strong> 워크플로를 실행해 데이터를 수집하세요.
    </div>
  `;
  document.getElementById('visible-count').textContent = '0';
  updateSidebarSummary();
  updateMapOverlay();
}

function applyFilters() {
  const activeTypeCodes = new Set(
    TYPE_GROUPS
      .filter(group => state.activeTypes.has(group.label))
      .flatMap(group => group.codes)
  );
  const query = state.searchText.toLowerCase();

  state.filteredData = state.allData.filter(item => {
    if (!activeTypeCodes.has(item.clCd)) return false;
    if (state.activeSido && item.sidoCd !== state.activeSido) return false;
    if (query) {
      const nameMatch = String(item.name || '').toLowerCase().includes(query);
      const addressMatch = String(item.addr || '').toLowerCase().includes(query);
      if (!nameMatch && !addressMatch) return false;
    }
    return true;
  });

  if (state.selectedId && !state.filteredData.some(item => item.id === state.selectedId)) {
    closeInfoPanel();
  }

  document.getElementById('visible-count').textContent = state.filteredData.length.toLocaleString();
  state.cachedClusters = {};
  updateMarkers();
  renderResultsList();
  updateSidebarSummary();
  updateMapOverlay();
}

function buildClusters(items, zoom) {
  if (zoom >= 14) {
    return items
      .filter(item => item.lat && item.lng)
      .map(item => ({ lat: item.lat, lng: item.lng, count: 1, item }));
  }

  const gridSize = CLUSTER_GRID[Math.max(5, Math.min(zoom, 13))] || 2.0;
  const grid = {};

  items.forEach(item => {
    if (!item.lat || !item.lng) return;
    const gx = Math.floor(item.lng / gridSize);
    const gy = Math.floor(item.lat / gridSize);
    const key = `${gx}:${gy}`;
    if (!grid[key]) {
      grid[key] = { latSum: 0, lngSum: 0, count: 0, item };
    }
    grid[key].latSum += item.lat;
    grid[key].lngSum += item.lng;
    grid[key].count += 1;
  });

  return Object.values(grid).map(cluster => ({
    lat: cluster.latSum / cluster.count,
    lng: cluster.lngSum / cluster.count,
    count: cluster.count,
    item: cluster.item,
  }));
}

function updateMarkers() {
  if (!state.map) return;

  if (state.filteredData.length === 0) {
    state.markers.forEach(marker => marker.setMap(null));
    state.markers = [];
    return;
  }

  const zoom = state.map.getZoom();
  const bounds = state.map.getBounds();
  let clusters = [];

  if (zoom >= 14) {
    clusters = state.filteredData
      .filter(item => item.lat && item.lng && bounds.hasLatLng(new naver.maps.LatLng(item.lat, item.lng)))
      .slice(0, 700)
      .map(item => ({ lat: item.lat, lng: item.lng, count: 1, item }));
  } else {
    const clusterZoom = Math.max(5, Math.min(zoom, 13));
    if (!state.cachedClusters[clusterZoom]) {
      state.cachedClusters[clusterZoom] = buildClusters(state.filteredData, clusterZoom);
    }
    clusters = state.cachedClusters[clusterZoom].filter(cluster =>
      bounds.hasLatLng(new naver.maps.LatLng(cluster.lat, cluster.lng))
    );
  }

  const nextMarkers = [];
  clusters.forEach(cluster => {
    const group = getGroupByCode(cluster.item.clCd);
    const color = group ? group.color : '#666';
    const icon = cluster.count === 1 ? buildMarkerIcon(color) : buildClusterIcon(cluster.count);

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
        state.map.setZoom(Math.min(zoom + 2, 15));
      });
    }

    nextMarkers.push(marker);
  });

  const previousMarkers = state.markers;
  state.markers = nextMarkers;
  previousMarkers.forEach(marker => marker.setMap(null));
}

function buildMarkerIcon(color) {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="28" viewBox="0 0 22 28">',
    `<path d="M11 0C4.925 0 0 4.925 0 11c0 8.25 11 17 11 17s11-8.75 11-17C22 4.925 17.075 0 11 0z" fill="${color}" stroke="white" stroke-width="1.5"/>`,
    '<circle cx="11" cy="11" r="4.5" fill="white" opacity="0.92"/>',
    '</svg>',
  ].join('');

  return {
    content: svg,
    size: new naver.maps.Size(22, 28),
    anchor: new naver.maps.Point(11, 28),
  };
}

function buildClusterIcon(count) {
  const size = count >= 1000 ? 56 : count >= 500 ? 52 : count >= 100 ? 46 : count >= 10 ? 40 : 34;
  const color = count >= 1000 ? '#9c27b0'
    : count >= 500 ? '#db4437'
    : count >= 100 ? '#f4b400'
    : count >= 10 ? '#0f9d58'
    : '#1a73e8';
  const label = count >= 1000 ? `${Math.floor(count / 1000)}k` : String(count);
  const fontSize = Math.round(size * 0.3);

  return {
    content: `<div style="width:${size}px;height:${size}px;background:${color};border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:${fontSize}px;box-shadow:0 2px 8px rgba(0,0,0,0.3);border:2px solid rgba(255,255,255,0.7);cursor:pointer;">${label}</div>`,
    size: new naver.maps.Size(size, size),
    anchor: new naver.maps.Point(size / 2, size / 2),
  };
}

async function updateLayer() {
  clearPolygons(state.sidoPolygons);
  clearPolygons(state.sggPolygons);

  if (state.activeLayer === 'none' || !state.sgisData) return;

  try {
    if (state.activeLayer === 'med' || state.activeSido) {
      await drawSggLayer(state.activeLayer, state.activeSido || null);
    } else {
      await drawSidoLayer(state.activeLayer);
    }
  } catch (error) {
    console.warn('레이어 오류:', error);
  }
}

function clearPolygons(polygons) {
  polygons.forEach(polygon => polygon.setMap(null));
  polygons.length = 0;
}

function getLayerValue(data, layer) {
  if (!data) return null;
  if (layer === 'pop') return data.population || null;
  if (layer === 'corp') return data.corp_cnt || null;
  if (layer === 'med') return data.med_per ?? data.med_avg ?? null;
  return null;
}

function getLayerColor(value, min, max, layer) {
  if (value == null) return 'rgb(230,230,230)';
  const ratio = max > min ? (value - min) / (max - min) : 0;
  if (layer === 'pop') {
    return `rgb(${Math.round(219 - ratio * 189)},${Math.round(234 - ratio * 144)},${Math.round(255 - ratio * 95)})`;
  }
  if (layer === 'corp') {
    return `rgb(${Math.round(212 - ratio * 185)},${Math.round(245 - ratio * 125)},${Math.round(215 - ratio * 165)})`;
  }
  if (layer === 'med') {
    return `rgb(${Math.round(255 - ratio * 65)},${Math.round(235 - ratio * 195)},${Math.round(220 - ratio * 180)})`;
  }
  return 'rgb(200,200,200)';
}

function updateLegend(layer) {
  const legend = document.getElementById('choropleth-legend');
  if (layer === 'none') {
    legend.classList.remove('visible');
    return;
  }

  const config = LAYER_CONFIG[layer];
  legend.classList.add('visible');
  document.getElementById('legend-title').textContent = config.label;
  document.getElementById('legend-gradient').style.background =
    `linear-gradient(to right, ${config.gradFrom}, ${config.gradTo})`;
}

function updateLayerDescription() {
  const target = document.getElementById('layer-description');
  if (state.activeLayer === 'none') {
    target.textContent = LAYER_CONFIG.none.description;
    return;
  }

  const config = LAYER_CONFIG[state.activeLayer];
  if (state.activeLayer === 'med') {
    target.textContent = state.activeSido ? config.descriptionLocal : config.descriptionNational;
    return;
  }

  target.textContent = state.activeSido ? config.descriptionLocal : config.descriptionNational;
}

async function loadSidoGeo() {
  if (state.sidoGeoData) return state.sidoGeoData;
  const response = await fetch(`${DATA_BASE_URL}/sido_geo.json`);
  state.sidoGeoData = await response.json();
  return state.sidoGeoData;
}

async function loadSggGeo() {
  if (state.sggGeoData) return state.sggGeoData;
  const response = await fetch(`${DATA_BASE_URL}/sgg_geo.json`);
  state.sggGeoData = await response.json();
  return state.sggGeoData;
}

let choroplethInfo = null;
function getChoroplethInfo() {
  if (!choroplethInfo) {
    choroplethInfo = new naver.maps.InfoWindow({
      borderWidth: 0,
      backgroundColor: 'transparent',
      disableAnchor: true,
    });
  }
  return choroplethInfo;
}

async function drawSidoLayer(layer) {
  const geo = await loadSidoGeo();
  const features = geo.features || [];
  const values = features
    .map(feature => {
      const kostatCode = HIRA_TO_KOSTAT[feature.properties.sidoCd];
      return getLayerValue(buildSidoSummary(kostatCode), layer);
    })
    .filter(value => value != null);

  const minValue = values.length ? Math.min(...values) : 0;
  const maxValue = values.length ? Math.max(...values) : 1;
  const info = getChoroplethInfo();

  features.forEach(feature => {
    const sidoCode = feature.properties.sidoCd;
    const name = feature.properties.name || getSidoNameByCode(sidoCode);
    const summary = buildSidoSummary(HIRA_TO_KOSTAT[sidoCode]);
    const value = getLayerValue(summary, layer);
    const color = getLayerColor(value, minValue, maxValue, layer);

    geoJsonToPolygons(feature.geometry, {
      fillColor: color,
      fillOpacity: 0.62,
      strokeColor: '#fff',
      strokeWeight: 1.5,
      strokeOpacity: 0.85,
      zIndex: 10,
    }).forEach(polygon => {
      polygon.setMap(state.map);
      naver.maps.Event.addListener(polygon, 'mouseover', event => {
        polygon.setOptions({ strokeWeight: 3, strokeColor: LAYER_CONFIG[layer].stroke });
        info.setContent(makeTipContent(name, summary, layer, { medLabel: '평균 의료업종 비율' }));
        info.open(state.map, event.coord);
      });
      naver.maps.Event.addListener(polygon, 'mouseout', () => {
        polygon.setOptions({ strokeWeight: 1.5, strokeColor: '#fff' });
        info.close();
      });
      naver.maps.Event.addListener(polygon, 'click', async () => {
        await setSidoFilter(sidoCode);
        focusGeometry(feature.geometry);
      });
      state.sidoPolygons.push(polygon);
    });
  });
}

async function drawSggLayer(layer, sidoCode) {
  const geo = await loadSggGeo();
  const features = sidoCode
    ? geo.features.filter(feature => feature.properties.sidoCd === sidoCode)
    : geo.features;
  const stats = state.sgisData.sgg || {};
  const values = features
    .map(feature => getLayerValue(stats[feature.properties.code], layer))
    .filter(value => value != null);

  const minValue = values.length ? Math.min(...values) : 0;
  const maxValue = values.length ? Math.max(...values) : 1;
  const info = getChoroplethInfo();

  features.forEach(feature => {
    const code = feature.properties.code;
    const data = stats[code] || null;
    const value = getLayerValue(data, layer);
    const color = getLayerColor(value, minValue, maxValue, layer);
    const name = feature.properties.name;

    geoJsonToPolygons(feature.geometry, {
      fillColor: color,
      fillOpacity: 0.65,
      strokeColor: '#fff',
      strokeWeight: 0.8,
      strokeOpacity: 0.75,
      zIndex: 10,
    }).forEach(polygon => {
      polygon.setMap(state.map);
      naver.maps.Event.addListener(polygon, 'mouseover', event => {
        polygon.setOptions({ strokeWeight: 2, strokeColor: LAYER_CONFIG[layer].stroke });
        info.setContent(makeTipContent(name, data, layer));
        info.open(state.map, event.coord);
      });
      naver.maps.Event.addListener(polygon, 'mouseout', () => {
        polygon.setOptions({ strokeWeight: 0.8, strokeColor: '#fff' });
        info.close();
      });
      naver.maps.Event.addListener(polygon, 'click', async () => {
        if (!sidoCode && feature.properties.sidoCd) {
          await setSidoFilter(feature.properties.sidoCd);
        }
        focusGeometry(feature.geometry);
      });
      state.sggPolygons.push(polygon);
    });
  });
}

function makeTipContent(name, data, layer, options = {}) {
  if (!data) {
    return `<div class="map-tooltip"><strong>${escapeHtml(name)}</strong><div class="tip-sub">데이터 없음</div></div>`;
  }

  const medValue = data.med_per ?? data.med_avg ?? null;
  const medLabel = options.medLabel || '의료업종 비율';
  const rows = [
    buildTipRow('인구', data.population, value => `${value.toLocaleString()}명`, layer === 'pop'),
    buildTipRow('사업체', data.corp_cnt, value => `${value.toLocaleString()}개`, layer === 'corp'),
    buildTipRow('종사자', data.tot_worker, value => `${value.toLocaleString()}명`, false),
    buildTipRow(medLabel, medValue, value => `${Number(value).toFixed(2)}%`, layer === 'med'),
  ].filter(Boolean).join('');

  return `<div class="map-tooltip"><strong>${escapeHtml(name)}</strong>${rows || '<div class="tip-sub">데이터 없음</div>'}</div>`;
}

function buildTipRow(label, value, formatter, isActive) {
  if (value == null) return '';
  return `
    <div class="tip-row${isActive ? ' is-active' : ''}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(formatter(value))}</strong>
    </div>
  `;
}

function geoJsonToPolygons(geometry, options) {
  const polygons = [];
  const makePaths = rings => rings.map(ring => ring.map(([lng, lat]) => new naver.maps.LatLng(lat, lng)));

  if (geometry.type === 'Polygon') {
    polygons.push(new naver.maps.Polygon({ paths: makePaths(geometry.coordinates), ...options }));
  } else if (geometry.type === 'MultiPolygon') {
    geometry.coordinates.forEach(coords => {
      polygons.push(new naver.maps.Polygon({ paths: makePaths(coords), ...options }));
    });
  }

  return polygons;
}

function renderResultsList() {
  const list = document.getElementById('results-list');
  if (state.filteredData.length === 0) {
    list.innerHTML = '<div class="no-results">검색 결과가 없습니다.<br>검색어나 필터 조건을 바꿔보세요.</div>';
    return;
  }

  const displayItems = state.filteredData.slice(0, RESULTS_DISPLAY_LIMIT);
  const exceeded = state.filteredData.length > RESULTS_DISPLAY_LIMIT;

  list.innerHTML = displayItems.map(item => {
    const group = getGroupByCode(item.clCd);
    const color = group ? group.color : '#888';
    const region = [item.sidoCdNm, item.sgguCdNm].filter(Boolean).join(' ');
    const meta = [];
    if (item.drTotCnt) meta.push(`의사 ${Number(item.drTotCnt).toLocaleString()}명`);
    if (item.estbDd) meta.push(`개설 ${formatDate(item.estbDd)}`);

    return `
      <div class="result-item${item.id === state.selectedId ? ' active' : ''}" role="listitem" data-id="${escapeHtml(item.id)}">
        <div class="result-top">
          <span class="result-type-badge" style="background:${color}18;color:${color};">${escapeHtml(item.clCdNm || '')}</span>
          <span class="result-region">${escapeHtml(region)}</span>
        </div>
        <div class="result-name">${escapeHtml(item.name || '')}</div>
        <div class="result-addr">${escapeHtml(item.addr || '')}</div>
        ${meta.length ? `<div class="result-meta">${escapeHtml(meta.join(' · '))}</div>` : ''}
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

  list.querySelectorAll('.result-item').forEach(element => {
    element.addEventListener('click', () => {
      const item = state.filteredData.find(entry => entry.id === element.dataset.id);
      if (item) selectFacility(item);
    });
  });
}

function selectFacility(item) {
  state.selectedId = item.id;
  if (item.lat && item.lng) {
    state.map.setCenter(new naver.maps.LatLng(item.lat, item.lng));
    if (state.map.getZoom() < 15) state.map.setZoom(15);
  }
  showInfoPanel(item);
  highlightListItem(item.id);
  closeSidebarOnMobile();
}

function highlightListItem(id) {
  document.querySelectorAll('.result-item').forEach(element => {
    const isActive = element.dataset.id === id;
    element.classList.toggle('active', isActive);
    if (isActive) {
      element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });
}

function showInfoPanel(item) {
  const group = getGroupByCode(item.clCd);
  const color = group ? group.color : '#666';
  const rows = buildInfoRows(item);
  const areaStats = findAreaStatsByItem(item);
  const marketCard = areaStats ? buildAreaStatsCard(item, areaStats) : '';

  document.getElementById('info-content').innerHTML = `
    <div class="info-type-badge" style="background:${color}">${escapeHtml(item.clCdNm || '병의원')}</div>
    <div class="info-name">${escapeHtml(item.name || '')}</div>
    ${marketCard}
    <div class="info-divider"></div>
    ${rows.map(row => `
      <div class="info-row">
        <div class="info-row-label">${escapeHtml(row.label)}</div>
        <div class="info-row-text">${row.html}</div>
      </div>
    `).join('')}
  `;

  document.getElementById('info-panel').removeAttribute('hidden');
  document.getElementById('info-content').scrollTop = 0;
}

function buildInfoRows(item) {
  const rows = [];

  if (item.addr) rows.push({ label: '주소', html: escapeHtml(item.addr) });
  if (item.phone) {
    rows.push({
      label: '전화',
      html: `<a href="tel:${escapeHtml(item.phone)}">${escapeHtml(item.phone)}</a>`,
    });
  }
  if (item.hospUrl) {
    const url = item.hospUrl.startsWith('http') ? item.hospUrl : `http://${item.hospUrl}`;
    rows.push({
      label: '웹사이트',
      html: `<a href="${encodeURI(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.hospUrl)}</a>`,
    });
  }
  if (item.estbDd) rows.push({ label: '개설일', html: escapeHtml(formatDate(item.estbDd)) });
  if (item.drTotCnt) {
    const doctorText = `의사 ${Number(item.drTotCnt).toLocaleString()}명`
      + (item.mdeptSdrCnt ? ` · 전문의 ${Number(item.mdeptSdrCnt).toLocaleString()}명` : '');
    rows.push({ label: '의료진', html: escapeHtml(doctorText) });
  }
  if (item.sgguCdNm || item.sidoCdNm) {
    rows.push({
      label: '지역',
      html: escapeHtml([item.sidoCdNm, item.sgguCdNm].filter(Boolean).join(' ')),
    });
  }

  return rows;
}

function buildAreaStatsCard(item, stats) {
  const title = [item.sidoCdNm, stats.name].filter(Boolean).join(' ');
  return `
    <div class="info-market-card">
      <h3>${escapeHtml(title)} 입지 데이터</h3>
      <div class="info-market-grid">
        <div class="info-market-metric">
          <span>인구</span>
          <strong>${escapeHtml(formatFullCount(stats.population, '명'))}</strong>
        </div>
        <div class="info-market-metric">
          <span>사업체</span>
          <strong>${escapeHtml(formatFullCount(stats.corp_cnt, '개'))}</strong>
        </div>
        <div class="info-market-metric">
          <span>의료업종 비율</span>
          <strong>${escapeHtml(formatPercent(stats.med_per))}</strong>
        </div>
      </div>
    </div>
  `;
}

function findAreaStatsByItem(item) {
  if (!state.sgisData || !item.sidoCd || !item.sgguCdNm) return null;

  const sidoCode = HIRA_TO_KOSTAT[item.sidoCd];
  const targetName = normalizeRegionName(item.sgguCdNm);
  if (!sidoCode || !targetName) return null;

  return Object.values(state.sgisData.sgg || {}).find(entry =>
    entry.sido === sidoCode && normalizeRegionName(entry.name) === targetName
  ) || null;
}

function normalizeRegionName(name) {
  return String(name || '')
    .replace(/\s+/g, '')
    .replace(/특별자치시|특별자치도/g, '')
    .trim();
}

function closeInfoPanel() {
  document.getElementById('info-panel').setAttribute('hidden', '');
  state.selectedId = null;
  document.querySelectorAll('.result-item').forEach(element => element.classList.remove('active'));
}

function updateSidebarSummary() {
  document.getElementById('summary-visible-value').textContent = state.filteredData.length
    ? state.filteredData.length.toLocaleString()
    : '0';

  document.getElementById('summary-scope-value').textContent = getSelectedSidoName() || '전국';
  document.getElementById('summary-scope-desc').textContent = getScopeDescription();

  const layerLabel = LAYER_CONFIG[state.activeLayer].label;
  document.getElementById('summary-layer-value').textContent = layerLabel;
  document.getElementById('summary-layer-desc').textContent = state.activeLayer === 'none'
    ? '병의원 마커만 표시합니다.'
    : '병의원 마커와 함께 배경 데이터가 표시됩니다.';

  const insight = getScopeInsights();
  document.getElementById('insight-scope-title').textContent = `${insight.name} 요약`;
  document.getElementById('insight-scope-badge').textContent = insight.badge;
  document.getElementById('insight-population').textContent = insight.population != null
    ? `${formatCompactNumber(insight.population)}명`
    : '-';
  document.getElementById('insight-businesses').textContent = insight.corpCnt != null
    ? `${formatCompactNumber(insight.corpCnt)}개`
    : '-';
  document.getElementById('insight-medical').textContent = insight.medRate != null
    ? formatPercent(insight.medRate)
    : '-';
  document.getElementById('insight-note').textContent = insight.note;
}

function getScopeInsights() {
  const scopeName = getSelectedSidoName() || '전국';
  if (!state.sgisData) {
    return {
      name: scopeName,
      badge: 'SGIS 데이터 로딩 중',
      population: null,
      corpCnt: null,
      medRate: null,
      note: 'SGIS 데이터를 불러오면 입지 지표가 표시됩니다.',
    };
  }

  const sggItems = Object.values(state.sgisData.sgg || {});
  if (state.activeSido) {
    const kostatCode = HIRA_TO_KOSTAT[state.activeSido];
    const sidoData = state.sgisData.sido?.[kostatCode] || null;
    const currentSgg = sggItems.filter(item => item.sido === kostatCode);
    const medRate = average(currentSgg.map(item => item.med_per).filter(value => value != null));
    const workers = sidoData?.tot_worker ?? sum(currentSgg.map(item => item.tot_worker || 0));
    return {
      name: scopeName,
      badge: `시군구 ${currentSgg.length}개`,
      population: sidoData?.population ?? sum(currentSgg.map(item => item.population || 0)),
      corpCnt: sidoData?.corp_cnt ?? sum(currentSgg.map(item => item.corp_cnt || 0)),
      medRate,
      note: workers
        ? `종사자 ${formatFullCount(workers, '명')} 기준으로 지역 입지를 비교할 수 있습니다.`
        : '선택 지역의 시군구 단위 지표를 비교합니다.',
    };
  }

  const sidoItems = Object.values(state.sgisData.sido || {});
  const medRate = average(sggItems.map(item => item.med_per).filter(value => value != null));
  const workers = sum(sidoItems.map(item => item.tot_worker || 0));
  const scopeBadge = state.activeLayer === 'med' ? '시군구 252개' : '시도 17개';

  return {
    name: scopeName,
    badge: scopeBadge,
    population: sum(sidoItems.map(item => item.population || 0)),
    corpCnt: sum(sidoItems.map(item => item.corp_cnt || 0)),
    medRate,
    note: workers
      ? `종사자 ${formatFullCount(workers, '명')}를 포함한 전국 기준 요약입니다.`
      : '전국 기준 지표를 비교합니다.',
  };
}

function getScopeDescription() {
  if (state.activeLayer === 'none') {
    return state.activeSido ? '선택 지역의 병의원만 보고 있습니다.' : '전국 병의원 마커를 보고 있습니다.';
  }
  return (state.activeLayer === 'med' || state.activeSido) ? '시군구 단위 비교 중' : '시도 단위 비교 중';
}

function updateMapOverlay() {
  document.getElementById('map-scope-label').textContent = getSelectedSidoName() || '전국';
  document.getElementById('map-layer-label').textContent = getMapLayerLabel();
}

function getMapLayerLabel() {
  if (state.activeLayer === 'none') {
    return '병의원 마커만 표시';
  }
  const layerLabel = LAYER_CONFIG[state.activeLayer].label;
  const layerScope = (state.activeLayer === 'med' || state.activeSido) ? '시군구 단위' : '시도 단위';
  return `${layerLabel} · ${layerScope}`;
}

function buildSidoSummary(kostatCode) {
  if (!state.sgisData || !kostatCode) return null;
  const base = state.sgisData.sido?.[kostatCode] || null;
  if (!base) return null;

  const sggItems = Object.values(state.sgisData.sgg || {}).filter(item => item.sido === kostatCode);
  return {
    ...base,
    med_avg: average(sggItems.map(item => item.med_per).filter(value => value != null)),
  };
}

function getSelectedSidoName() {
  return SIDO_LIST.find(item => item.code === state.activeSido)?.name || '';
}

function getSidoNameByCode(code) {
  return SIDO_LIST.find(item => item.code === code)?.name || code;
}

function resetFilters() {
  state.searchText = '';
  state.activeSido = '';
  state.activeTypes = new Set(TYPE_GROUPS.map(group => group.label));

  document.getElementById('search-input').value = '';
  document.getElementById('search-clear').classList.remove('visible');
  document.getElementById('sido-select').value = '';

  document.querySelectorAll('.filter-btn').forEach(button => {
    const group = TYPE_GROUPS.find(item => item.label === button.dataset.type);
    if (group) setTypeButtonState(button, true, group.color);
  });

  closeInfoPanel();
  state.map.setCenter(new naver.maps.LatLng(INITIAL_MAP_CENTER.lat, INITIAL_MAP_CENTER.lng));
  state.map.setZoom(INITIAL_MAP_CENTER.zoom);
  applyFilters();
  updateLayerDescription();
  updateLayer();
}

function toggleSidebar(forceOpen) {
  const shouldOpen = typeof forceOpen === 'boolean'
    ? forceOpen
    : !document.body.classList.contains('sidebar-open');
  document.body.classList.toggle('sidebar-open', shouldOpen);
  updateMobileSidebarButton();
}

function closeSidebarOnMobile() {
  if (window.matchMedia(MOBILE_MEDIA_QUERY).matches) {
    toggleSidebar(false);
  }
}

function updateMobileSidebarButton() {
  const button = document.getElementById('mobile-sidebar-toggle');
  if (!button) return;
  const isOpen = document.body.classList.contains('sidebar-open');
  button.setAttribute('aria-expanded', String(isOpen));
  button.textContent = isOpen ? '패널 닫기' : '탐색 패널';
}

function focusGeometry(geometry) {
  const bounds = geometryToBounds(geometry);
  if (!bounds) return;
  state.map.fitBounds(bounds);
}

function geometryToBounds(geometry) {
  if (!geometry || !geometry.coordinates) return null;

  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;

  const walk = value => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      const [lng, lat] = value;
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      return;
    }
    value.forEach(walk);
  };

  walk(geometry.coordinates);
  if (minLat === 90) return null;

  return new naver.maps.LatLngBounds(
    new naver.maps.LatLng(minLat, minLng),
    new naver.maps.LatLng(maxLat, maxLng)
  );
}

function getGroupByCode(code) {
  return TYPE_GROUPS.find(group => group.codes.includes(code));
}

function formatDate(value) {
  if (!value || String(value).length < 8) return String(value || '');
  const text = String(value);
  return `${text.slice(0, 4)}.${text.slice(4, 6)}.${text.slice(6, 8)}`;
}

function formatPercent(value) {
  return value == null ? '-' : `${Number(value).toFixed(2)}%`;
}

function formatFullCount(value, unit) {
  return value == null ? '-' : `${Number(value).toLocaleString()}${unit}`;
}

function formatCompactNumber(value) {
  if (value == null) return '-';
  const number = Number(value);
  const abs = Math.abs(number);
  if (abs >= 100000000) return `${trimZero((number / 100000000).toFixed(abs >= 1000000000 ? 0 : 1))}억`;
  if (abs >= 10000) return `${trimZero((number / 10000).toFixed(abs >= 100000 ? 0 : 1))}만`;
  return number.toLocaleString();
}

function trimZero(text) {
  return String(text).replace(/\.0$/, '');
}

function sum(values) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((total, value) => total + Number(value || 0), 0) / values.length;
}

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
