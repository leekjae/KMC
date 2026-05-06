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

const TYPE_GROUPS = [
  { label: '상급·종합병원', codes: ['01', '11'], color: '#d32f2f' },
  { label: '병원', codes: ['21', '28', '29'], color: '#f57c00' },
  { label: '의원', codes: ['31'], color: '#388e3c' },
  { label: '치과', codes: ['41', '51'], color: '#0288d1' },
  { label: '한방병원', codes: ['92'], color: '#7b1fa2' },
  { label: '한의원', codes: ['93'], color: '#9c4dcc' },
  { label: '보건소', codes: ['71', '72', '73', '75'], color: '#5d4037' },
];

const LAYER_CONFIG = {
  none: {
    label: '마커만 보기',
    description: '한의원 마커와 목록에만 집중해서 보기에 적합합니다.',
  },
  totalPopulation: {
    label: '총인구',
    description: '거주 수요의 절대 규모를 확인합니다.',
    gradFrom: 'rgb(219,234,255)',
    gradTo: 'rgb(29,92,175)',
    stroke: '#1769ff',
    valueType: 'count',
  },
  averageAge: {
    label: '평균연령',
    description: '평균연령이 높은 권역은 한의원 수요 구조와 잘 맞을 수 있습니다.',
    gradFrom: 'rgb(255,239,214)',
    gradTo: 'rgb(204,99,28)',
    stroke: '#cf6a19',
    valueType: 'age',
  },
  senior65Rate: {
    label: '65세 이상 비율',
    description: '고령층 비율이 높은 생활권을 비교합니다.',
    gradFrom: 'rgb(255,231,231)',
    gradTo: 'rgb(198,51,89)',
    stroke: '#d33c6b',
    valueType: 'percent',
  },
  workerCount: {
    label: '종사자수',
    description: '직장 배후 수요가 큰 권역을 확인합니다.',
    gradFrom: 'rgb(221,247,232)',
    gradTo: 'rgb(29,134,87)',
    stroke: '#238858',
    valueType: 'count',
  },
  apartmentRate: {
    label: '아파트 비율',
    description: '주거 밀도가 높고 안정적인 아파트 생활권을 비교합니다.',
    gradFrom: 'rgb(238,232,255)',
    gradTo: 'rgb(103,69,181)',
    stroke: '#6c4ab7',
    valueType: 'percent',
  },
};

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
const DEFAULT_ACTIVE_TYPES = new Set(['한의원']);

const state = {
  map: null,
  allData: [],
  filteredData: [],
  cachedClusters: {},
  markers: [],
  activeTypes: new Set(DEFAULT_ACTIVE_TYPES),
  activeSido: '',
  searchText: '',
  selectedId: null,
  marketData: null,
  activeLayer: 'senior65Rate',
  dongPolygons: [],
  sidoPolygons: [],
  dongGeoCache: {},
  sidoGeoData: null,
};

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  initUI();
  updateLegend(state.activeLayer);
  updateLayerDescription();
  updateSidebarSummary();
  updateMapOverlay();

  showLoading(true);
  Promise.all([loadAllData(), loadMarketData()])
    .finally(() => showLoading(false));
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
    button.className = 'filter-btn';
    button.dataset.type = group.label;
    button.textContent = group.label;
    const isActive = state.activeTypes.has(group.label);
    setTypeButtonState(button, isActive, group.color);
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
  updateSidebarSummary();
  updateMapOverlay();
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
    console.error('병의원 데이터 로드 오류:', error);
    renderNoData();
  }
}

async function loadMarketData() {
  try {
    const response = await fetch(`${DATA_BASE_URL}/sgis_haniwon.json`);
    if (!response.ok) return;
    state.marketData = await response.json();
    document.getElementById('legend-updated').textContent = makeUpdatedText(state.marketData.updated || {});
    updateSidebarSummary();
    updateMapOverlay();
    await updateLayer();
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
  clearPolygons(state.dongPolygons);
  clearPolygons(state.sidoPolygons);

  if (state.activeLayer === 'none' || !state.marketData) return;

  try {
    if (state.activeSido) {
      await drawDongLayer(state.activeLayer, state.activeSido);
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

function getLayerValue(entry, layer) {
  if (!entry) return null;
  if (layer === 'totalPopulation') return entry.totalPopulation ?? null;
  if (layer === 'averageAge') return entry.averageAge ?? null;
  if (layer === 'senior65Rate') return entry.senior65Rate ?? null;
  if (layer === 'workerCount') return entry.workerCount ?? null;
  if (layer === 'apartmentRate') return entry.apartmentRate ?? null;
  return null;
}

function getLayerColor(value, min, max, layer) {
  if (value == null) return 'rgb(230,230,230)';
  const ratio = max > min ? (value - min) / (max - min) : 0;

  if (layer === 'totalPopulation') {
    return `rgb(${Math.round(219 - ratio * 190)},${Math.round(234 - ratio * 142)},${Math.round(255 - ratio * 80)})`;
  }
  if (layer === 'averageAge') {
    return `rgb(${Math.round(255 - ratio * 51)},${Math.round(239 - ratio * 140)},${Math.round(214 - ratio * 186)})`;
  }
  if (layer === 'senior65Rate') {
    return `rgb(${Math.round(255 - ratio * 57)},${Math.round(231 - ratio * 180)},${Math.round(231 - ratio * 142)})`;
  }
  if (layer === 'workerCount') {
    return `rgb(${Math.round(221 - ratio * 192)},${Math.round(247 - ratio * 113)},${Math.round(232 - ratio * 145)})`;
  }
  if (layer === 'apartmentRate') {
    return `rgb(${Math.round(238 - ratio * 135)},${Math.round(232 - ratio * 163)},${Math.round(255 - ratio * 74)})`;
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
  target.textContent = LAYER_CONFIG[state.activeLayer].description;
}

async function loadDongGeo(sidoCode) {
  if (!sidoCode) return null;
  if (state.dongGeoCache[sidoCode]) return state.dongGeoCache[sidoCode];
  const response = await fetch(`${DATA_BASE_URL}/dong_geo_sido/${sidoCode}.json`);
  const data = await response.json();
  state.dongGeoCache[sidoCode] = data;
  return data;
}

async function loadSidoGeo() {
  if (state.sidoGeoData) return state.sidoGeoData;
  const response = await fetch(`${DATA_BASE_URL}/sido_geo.json`);
  state.sidoGeoData = await response.json();
  return state.sidoGeoData;
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

async function drawDongLayer(layer, sidoCode) {
  const geo = await loadDongGeo(sidoCode);
  if (!geo) return;
  const marketDong = state.marketData?.dong || {};
  const features = geo.features;

  const values = features
    .map(feature => getLayerValue(marketDong[feature.properties.code], layer))
    .filter(value => value != null);

  const minValue = values.length ? Math.min(...values) : 0;
  const maxValue = values.length ? Math.max(...values) : 1;
  const info = getChoroplethInfo();

  features.forEach(feature => {
    const code = feature.properties.code;
    const areaData = marketDong[code] || null;
    const value = getLayerValue(areaData, layer);
    const color = getLayerColor(value, minValue, maxValue, layer);
    const name = feature.properties.name;

    geoJsonToPolygons(feature.geometry, {
      fillColor: color,
      fillOpacity: 0.65,
      strokeColor: '#fff',
      strokeWeight: 0.55,
      strokeOpacity: 0.55,
      zIndex: 8,
    }).forEach(polygon => {
      polygon.setMap(state.map);
      naver.maps.Event.addListener(polygon, 'mouseover', event => {
        polygon.setOptions({ strokeWeight: 1.6, strokeColor: LAYER_CONFIG[layer].stroke, strokeOpacity: 0.9 });
        info.setContent(makeAreaTipContent(name, areaData, layer));
        info.open(state.map, event.coord);
      });
      naver.maps.Event.addListener(polygon, 'mouseout', () => {
        polygon.setOptions({ strokeWeight: 0.55, strokeColor: '#fff', strokeOpacity: 0.55 });
        info.close();
      });
      naver.maps.Event.addListener(polygon, 'click', () => focusGeometry(feature.geometry));
      state.dongPolygons.push(polygon);
    });
  });
}

function getSidoAggregates() {
  const grouped = {};

  Object.values(state.marketData?.dong || {}).forEach(entry => {
    if (!entry.sidoCd) return;
    if (!grouped[entry.sidoCd]) {
      grouped[entry.sidoCd] = {
        sidoCd: entry.sidoCd,
        name: entry.sidoName,
        totalPopulation: 0,
        workerCount: 0,
        _ageNumerator: 0,
        _ageDenominator: 0,
        _seniorNumerator: 0,
        _seniorDenominator: 0,
        _apartmentNumerator: 0,
        _apartmentDenominator: 0,
      };
    }

    const target = grouped[entry.sidoCd];
    if (entry.totalPopulation != null) {
      target.totalPopulation += Number(entry.totalPopulation);
      if (entry.averageAge != null) {
        target._ageNumerator += Number(entry.averageAge) * Number(entry.totalPopulation);
        target._ageDenominator += Number(entry.totalPopulation);
      }
      if (entry.senior65Rate != null) {
        target._seniorNumerator += Number(entry.senior65Rate) * Number(entry.totalPopulation);
        target._seniorDenominator += Number(entry.totalPopulation);
      }
    }
    if (entry.totalFamilies != null && entry.apartmentRate != null) {
      target._apartmentNumerator += Number(entry.apartmentRate) * Number(entry.totalFamilies);
      target._apartmentDenominator += Number(entry.totalFamilies);
    }
    if (entry.workerCount != null) {
      target.workerCount += Number(entry.workerCount);
    }
  });

  Object.values(grouped).forEach(entry => {
    entry.averageAge = entry._ageDenominator ? entry._ageNumerator / entry._ageDenominator : null;
    entry.senior65Rate = entry._seniorDenominator ? entry._seniorNumerator / entry._seniorDenominator : null;
    entry.apartmentRate = entry._apartmentDenominator ? entry._apartmentNumerator / entry._apartmentDenominator : null;
    delete entry._ageNumerator;
    delete entry._ageDenominator;
    delete entry._seniorNumerator;
    delete entry._seniorDenominator;
    delete entry._apartmentNumerator;
    delete entry._apartmentDenominator;
  });

  return grouped;
}

async function drawSidoLayer(layer) {
  const geo = await loadSidoGeo();
  const marketSido = getSidoAggregates();
  const values = geo.features
    .map(feature => getLayerValue(marketSido[feature.properties.sidoCd], layer))
    .filter(value => value != null);

  const minValue = values.length ? Math.min(...values) : 0;
  const maxValue = values.length ? Math.max(...values) : 1;
  const info = getChoroplethInfo();

  geo.features.forEach(feature => {
    const sidoCode = feature.properties.sidoCd;
    const areaData = marketSido[sidoCode] || null;
    const value = getLayerValue(areaData, layer);
    const color = getLayerColor(value, minValue, maxValue, layer);
    const name = feature.properties.name;

    geoJsonToPolygons(feature.geometry, {
      fillColor: color,
      fillOpacity: 0.62,
      strokeColor: '#fff',
      strokeWeight: 0.9,
      strokeOpacity: 0.75,
      zIndex: 7,
    }).forEach(polygon => {
      polygon.setMap(state.map);
      naver.maps.Event.addListener(polygon, 'mouseover', event => {
        polygon.setOptions({ strokeWeight: 1.8, strokeColor: LAYER_CONFIG[layer].stroke, strokeOpacity: 0.95 });
        info.setContent(makeAreaTipContent(name, areaData, layer));
        info.open(state.map, event.coord);
      });
      naver.maps.Event.addListener(polygon, 'mouseout', () => {
        polygon.setOptions({ strokeWeight: 0.9, strokeColor: '#fff', strokeOpacity: 0.75 });
        info.close();
      });
      naver.maps.Event.addListener(polygon, 'click', () => {
        void setSidoFilter(sidoCode, { fitToScope: true });
      });
      state.sidoPolygons.push(polygon);
    });
  });
}

function makeAreaTipContent(name, areaData, layer) {
  if (!areaData) {
    return `<div class="map-tooltip"><strong>${escapeHtml(name)}</strong><div class="tip-sub">데이터 없음</div></div>`;
  }

  const rows = [
    buildTipRow('총인구', areaData.totalPopulation, value => `${Number(value).toLocaleString()}명`, layer === 'totalPopulation'),
    buildTipRow('평균연령', areaData.averageAge, value => `${Number(value).toFixed(1)}세`, layer === 'averageAge'),
    buildTipRow('65세 이상', areaData.senior65Rate, value => `${Number(value).toFixed(2)}%`, layer === 'senior65Rate'),
    buildTipRow('종사자수', areaData.workerCount, value => `${Number(value).toLocaleString()}명`, layer === 'workerCount'),
    buildTipRow('아파트 비율', areaData.apartmentRate, value => `${Number(value).toFixed(2)}%`, layer === 'apartmentRate'),
  ].filter(Boolean).join('');

  return `<div class="map-tooltip"><strong>${escapeHtml(name)}</strong>${rows}</div>`;
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
    if (item.drTotCnt) meta.push(`한의사 ${Number(item.drTotCnt).toLocaleString()}명`);
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
  const areaStats = findAreaStatsByItem(item);
  const rows = buildInfoRows(item, areaStats);
  const marketCard = areaStats ? buildAreaStatsCard(areaStats) : '';

  document.getElementById('info-content').innerHTML = `
    <div class="info-type-badge" style="background:${color}">${escapeHtml(item.clCdNm || '한의원')}</div>
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

function buildInfoRows(item, areaStats) {
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
    const doctorText = `한의사 ${Number(item.drTotCnt).toLocaleString()}명`
      + (item.mdeptSdrCnt ? ` · 전문의 ${Number(item.mdeptSdrCnt).toLocaleString()}명` : '');
    rows.push({ label: '의료진', html: escapeHtml(doctorText) });
  }
  if (item.sgguCdNm || item.sidoCdNm) {
    rows.push({
      label: '지역',
      html: escapeHtml([item.sidoCdNm, item.sgguCdNm].filter(Boolean).join(' ')),
    });
  }
  if (areaStats) {
    const supportText = [
      areaStats.workerCount != null ? `종사자 ${Number(areaStats.workerCount).toLocaleString()}명` : '',
      areaStats.apartmentRate != null ? `아파트 ${Number(areaStats.apartmentRate).toFixed(1)}%` : '',
      areaStats.femaleRate != null ? `여성 ${Number(areaStats.femaleRate).toFixed(1)}%` : '',
      areaStats.onePersonHouseholdRate != null ? `1인가구 ${Number(areaStats.onePersonHouseholdRate).toFixed(1)}%` : '',
    ].filter(Boolean).join(' · ');
    if (supportText) {
      rows.push({ label: '보조지표', html: escapeHtml(supportText) });
    }
  }

  return rows;
}

function buildAreaStatsCard(areaStats) {
  const title = [areaStats.sidoName, areaStats.sggName, areaStats.name].filter(Boolean).join(' ');
  return `
    <div class="info-market-card">
      <h3>${escapeHtml(title)} 입지 요약</h3>
      <div class="info-market-grid">
        <div class="info-market-metric">
          <span>총인구</span>
          <strong>${escapeHtml(formatFullCount(areaStats.totalPopulation, '명'))}</strong>
        </div>
        <div class="info-market-metric">
          <span>평균연령</span>
          <strong>${escapeHtml(formatAge(areaStats.averageAge))}</strong>
        </div>
        <div class="info-market-metric">
          <span>65세 이상</span>
          <strong>${escapeHtml(formatPercent(areaStats.senior65Rate))}</strong>
        </div>
      </div>
    </div>
  `;
}

function findAreaStatsByItem(item) {
  if (!state.marketData?.dong || !item.sidoCd || !item.sgguCdNm || !item.addr) return null;

  const targetSgg = normalizeRegionName(item.sgguCdNm);
  const candidates = extractDongCandidates(item.addr);
  if (!candidates.length) return null;

  const scoped = Object.values(state.marketData.dong).filter(entry =>
    entry.sidoCd === item.sidoCd && normalizeRegionName(entry.sggName) === targetSgg
  );
  if (!scoped.length) return null;

  for (const candidate of candidates) {
    const normalized = normalizeRegionName(candidate);
    const matched = scoped.find(entry => normalizeRegionName(entry.name) === normalized);
    if (matched) return matched;
  }
  return null;
}

function extractDongCandidates(address) {
  const results = new Set();
  const text = String(address || '');

  const parenMatch = text.match(/\(([^)]+)\)/g) || [];
  parenMatch.forEach(token => {
    token.replace(/[()]/g, '')
      .split(/[,\s/]+/)
      .map(part => part.trim())
      .filter(Boolean)
      .forEach(part => {
        if (/(동|읍|면)$/.test(part)) results.add(part);
      });
  });

  const inlineMatches = text.match(/[가-힣0-9·]+(?:동|읍|면)/g) || [];
  inlineMatches.forEach(match => results.add(match.trim()));
  return Array.from(results);
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
  document.getElementById('summary-scope-desc').textContent = state.activeSido
    ? '선택 지역의 읍면동 입지 비교 중'
    : '전국 읍면동 입지 비교 중';

  document.getElementById('summary-layer-value').textContent = LAYER_CONFIG[state.activeLayer].label;
  document.getElementById('summary-layer-desc').textContent = state.activeLayer === 'none'
    ? '한의원 마커만 표시합니다.'
    : '한의원 수요와 연결되는 SGIS 지표를 표시합니다.';

  const insight = getScopeInsights();
  document.getElementById('insight-scope-title').textContent = `${insight.name} 요약`;
  document.getElementById('insight-scope-badge').textContent = insight.badge;
  document.getElementById('insight-population').textContent = insight.population != null
    ? `${formatCompactNumber(insight.population)}명`
    : '-';
  document.getElementById('insight-average-age').textContent = insight.averageAge != null
    ? formatAge(insight.averageAge)
    : '-';
  document.getElementById('insight-senior-rate').textContent = insight.seniorRate != null
    ? formatPercent(insight.seniorRate)
    : '-';
  document.getElementById('insight-note').textContent = insight.note;
}

function getScopeInsights() {
  const scopeName = getSelectedSidoName() || '전국';
  const scopedEntries = getScopedMarketEntries();
  if (!scopedEntries.length) {
    return {
      name: scopeName,
      badge: 'SGIS 데이터 로딩 중',
      population: null,
      averageAge: null,
      seniorRate: null,
      note: 'SGIS 데이터를 불러오면 한의원 입지 지표가 표시됩니다.',
    };
  }

  const totalPopulation = sum(scopedEntries.map(entry => entry.totalPopulation || 0));
  const weightedAverageAge = weightedAverage(scopedEntries, 'averageAge', 'totalPopulation');
  const weightedSeniorRate = weightedAverage(scopedEntries, 'senior65Rate', 'totalPopulation');
  const weightedApartmentRate = weightedAverage(scopedEntries, 'apartmentRate', 'totalFamilies');
  const weightedFemaleRate = weightedAverage(scopedEntries, 'femaleRate', 'totalPopulation');
  const totalWorkers = sum(scopedEntries.map(entry => entry.workerCount || 0));

  return {
    name: scopeName,
    badge: `읍면동 ${scopedEntries.length.toLocaleString()}개`,
    population: totalPopulation,
    averageAge: weightedAverageAge,
    seniorRate: weightedSeniorRate,
    note: [
      totalWorkers ? `종사자 ${formatFullCount(totalWorkers, '명')}` : '',
      weightedApartmentRate != null ? `아파트 ${formatPercent(weightedApartmentRate)}` : '',
      weightedFemaleRate != null ? `여성 ${formatPercent(weightedFemaleRate)}` : '',
    ].filter(Boolean).join(' · ') || '현재 범위의 주요 입지 지표를 확인할 수 있습니다.',
  };
}

function getScopedMarketEntries() {
  if (!state.marketData?.dong) return [];
  const entries = Object.values(state.marketData.dong);
  return state.activeSido
    ? entries.filter(entry => entry.sidoCd === state.activeSido)
    : entries;
}

function updateMapOverlay() {
  document.getElementById('map-scope-label').textContent = getSelectedSidoName() || '전국';
  document.getElementById('map-layer-label').textContent = getMapLayerLabel();
}

function getMapLayerLabel() {
  if (state.activeLayer === 'none') {
    return '한의원 마커만 표시';
  }
  return `${LAYER_CONFIG[state.activeLayer].label} · 읍면동 단위`;
}

function makeUpdatedText(updated) {
  const parts = [];
  if (updated.populationYear) parts.push(`인구 ${updated.populationYear}`);
  if (updated.companyYear) parts.push(`사업체 ${updated.companyYear}`);
  return parts.length ? `${parts.join(' / ')} 기준` : '';
}

function resetFilters() {
  state.searchText = '';
  state.activeSido = '';
  state.activeTypes = new Set(DEFAULT_ACTIVE_TYPES);

  document.getElementById('search-input').value = '';
  document.getElementById('search-clear').classList.remove('visible');
  document.getElementById('sido-select').value = '';

  document.querySelectorAll('.filter-btn').forEach(button => {
    const group = TYPE_GROUPS.find(item => item.label === button.dataset.type);
    if (!group) return;
    const isActive = DEFAULT_ACTIVE_TYPES.has(group.label);
    setTypeButtonState(button, isActive, group.color);
  });

  closeInfoPanel();
  state.map.setCenter(new naver.maps.LatLng(INITIAL_MAP_CENTER.lat, INITIAL_MAP_CENTER.lng));
  state.map.setZoom(INITIAL_MAP_CENTER.zoom);
  applyFilters();
  updateLayerDescription();
  updateSidebarSummary();
  updateMapOverlay();
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

function getSelectedSidoName() {
  return SIDO_LIST.find(item => item.code === state.activeSido)?.name || '';
}

function formatDate(value) {
  if (!value || String(value).length < 8) return String(value || '');
  const text = String(value);
  return `${text.slice(0, 4)}.${text.slice(4, 6)}.${text.slice(6, 8)}`;
}

function formatPercent(value) {
  return value == null ? '-' : `${Number(value).toFixed(2)}%`;
}

function formatAge(value) {
  return value == null ? '-' : `${Number(value).toFixed(1)}세`;
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

function weightedAverage(entries, valueKey, weightKey) {
  let numerator = 0;
  let denominator = 0;
  entries.forEach(entry => {
    const value = entry[valueKey];
    const weight = entry[weightKey];
    if (value == null || weight == null || Number(weight) <= 0) return;
    numerator += Number(value) * Number(weight);
    denominator += Number(weight);
  });
  return denominator > 0 ? numerator / denominator : null;
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
