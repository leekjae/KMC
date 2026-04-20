// ============================================================
// 전국 병의원 현황 지도 - 메인 애플리케이션
// ============================================================

// ============================================================
// 상수 정의
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

// 종별 그룹 (실제 API clCd 기준)
const TYPE_GROUPS = [
  { label: '상급·종합병원', codes: ['01', '11'],             color: '#d32f2f' },
  { label: '병원',          codes: ['21', '28', '29'],        color: '#f57c00' },
  { label: '의원',          codes: ['31'],                    color: '#388e3c' },
  { label: '치과',          codes: ['41', '51'],              color: '#0288d1' },
  { label: '한방병원',      codes: ['92'],                    color: '#7b1fa2' },
  { label: '한의원',        codes: ['93'],                    color: '#9c4dcc' },
  { label: '보건소',        codes: ['71', '72', '73', '75'],  color: '#5d4037' },
];

// 줌 레벨별 클러스터 격자 크기 (위경도 단위)
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
  statusFilter: 'open',    // 'open' | 'closed' | 'all'
  populationData: null,
  activeView: 'list',      // 'list' | 'population'
};

// ============================================================
// 진입점
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  initUI();
  loadAllData();
  loadPopulationData();
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
    zoomControlOptions: {
      position: naver.maps.Position.TOP_RIGHT,
    },
  });

  // 지도 이동/줌 완료 후 마커 갱신 (디바운스 250ms)
  let idleTimer = null;
  let lastZoom = state.map.getZoom();
  naver.maps.Event.addListener(state.map, 'idle', () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      const currentZoom = state.map.getZoom();
      const zoomChanged = currentZoom !== lastZoom;
      lastZoom = currentZoom;
      updateMarkers(zoomChanged);
    }, 250);
  });
}

// ============================================================
// UI 초기화
// ============================================================
function initUI() {
  buildStatusFilter();
  buildTypeFilters();
  buildSidoSelect();
  bindSearchEvents();
  bindViewTabs();
  document.getElementById('info-close').addEventListener('click', closeInfoPanel);
}

// 영업상태 필터
function buildStatusFilter() {
  document.querySelectorAll('#status-filters .status-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#status-filters .status-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.statusFilter = btn.dataset.status;
      applyFilters();
    });
  });
}

// 목록/인구통계 탭
function bindViewTabs() {
  document.querySelectorAll('.view-tab').forEach(tab => {
    tab.addEventListener('click', () => setActiveView(tab.dataset.view));
  });
}

function setActiveView(view) {
  state.activeView = view;
  document.querySelectorAll('.view-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.view === view)
  );
  const isList = view === 'list';
  document.getElementById('results-list').hidden = !isList;
  document.getElementById('pop-section').hidden = isList;
  if (!isList) renderPopulationChart();
}

function buildTypeFilters() {
  const container = document.getElementById('type-filters');
  TYPE_GROUPS.forEach(group => {
    const btn = document.createElement('button');
    btn.className = 'filter-btn active';
    btn.textContent = group.label;
    btn.dataset.type = group.label;
    btn.style.setProperty('--group-color', group.color);
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
    updateViewTabsVisibility();
    applyFilters();
  });
}

function updateViewTabsVisibility() {
  const tabs = document.getElementById('view-tabs');
  tabs.hidden = !state.activeSido;
  if (!state.activeSido && state.activeView === 'population') {
    setActiveView('list');
  }
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
// 데이터 로드 (시도별 JSON 병렬 로드)
// ============================================================
async function loadAllData() {
  showLoading(true);
  try {
    const results = await Promise.allSettled(
      SIDO_LIST.map(sido =>
        fetch(`${DATA_BASE_URL}/hospitals_${sido.code}.json`)
          .then(r => {
            if (!r.ok) return [];
            return r.json();
          })
          .catch(() => [])
      )
    );

    state.allData = results.flatMap(r =>
      r.status === 'fulfilled' ? r.value : []
    );

    if (state.allData.length === 0) {
      renderNoData();
      return;
    }

    applyFilters();
  } catch (err) {
    console.error('데이터 로드 오류:', err);
    renderNoData();
  } finally {
    showLoading(false);
  }
}

async function loadPopulationData() {
  try {
    const resp = await fetch(`${DATA_BASE_URL}/population.json`);
    if (!resp.ok) return;
    const data = await resp.json();
    if (data.regions && Object.keys(data.regions).length > 0) {
      state.populationData = data;
      // 인구통계 탭이 열려 있으면 갱신
      if (state.activeView === 'population') renderPopulationChart();
    }
  } catch (e) {
    // 파일 없으면 무시
  }
}

function showLoading(show) {
  const el = document.getElementById('loading-overlay');
  el.style.display = show ? 'flex' : 'none';
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
    TYPE_GROUPS
      .filter(g => state.activeTypes.has(g.label))
      .flatMap(g => g.codes)
  );

  const query = state.searchText.toLowerCase();

  state.filteredData = state.allData.filter(item => {
    // 영업상태 필터
    if (state.statusFilter === 'open'   &&  item.closed) return false;
    if (state.statusFilter === 'closed' && !item.closed) return false;

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
    return items
      .filter(d => d.lat && d.lng)
      .map(d => ({ lat: d.lat, lng: d.lng, count: 1, item: d }));
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
    grid[key].count++;
  });

  return Object.values(grid).map(c => ({
    lat: c.latSum / c.count,
    lng: c.lngSum / c.count,
    count: c.count,
    item: c.item,
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
    if (!state.cachedClusters[z]) {
      state.cachedClusters[z] = buildClusters(state.filteredData, z);
    }
    clusters = state.cachedClusters[z].filter(c =>
      bounds.hasLatLng(new naver.maps.LatLng(c.lat, c.lng))
    );
  }

  const newMarkers = [];
  clusters.forEach(cluster => {
    const isClosed = cluster.count === 1 && cluster.item.closed;
    const color = isClosed
      ? '#9e9e9e'
      : (getGroupByCode(cluster.item.clCd)?.color || '#666');

    const icon = cluster.count === 1
      ? buildMarkerIcon(color, isClosed)
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

function buildMarkerIcon(color, isClosed = false) {
  const innerSvg = isClosed
    ? `<line x1="7.5" y1="7.5" x2="14.5" y2="14.5" stroke="white" stroke-width="2" stroke-linecap="round"/>
       <line x1="14.5" y1="7.5" x2="7.5" y2="14.5" stroke="white" stroke-width="2" stroke-linecap="round"/>`
    : `<circle cx="11" cy="11" r="4.5" fill="white" opacity="0.9"/>`;

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="28" viewBox="0 0 22 28">`,
    `<path d="M11 0C4.925 0 0 4.925 0 11c0 8.25 11 17 11 17s11-8.75 11-17C22 4.925 17.075 0 11 0z"`,
    ` fill="${color}" stroke="white" stroke-width="1.5"/>`,
    innerSvg,
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
// 검색결과 목록 렌더링
// ============================================================
function renderResultsList() {
  const list = document.getElementById('results-list');

  if (state.filteredData.length === 0) {
    const msg = state.statusFilter === 'closed'
      ? '폐업 데이터가 없습니다.<br>현재 영업중인 기관만 수집됩니다.'
      : '검색 결과가 없습니다.<br>검색어나 필터를 변경해보세요.';
    list.innerHTML = `<div class="no-results">${msg}</div>`;
    return;
  }

  const displayItems = state.filteredData.slice(0, RESULTS_DISPLAY_LIMIT);
  const exceeded = state.filteredData.length > RESULTS_DISPLAY_LIMIT;

  list.innerHTML = displayItems.map(item => {
    const group = getGroupByCode(item.clCd);
    const color = item.closed ? '#9e9e9e' : (group ? group.color : '#888');
    const isActive = item.id === state.selectedId;
    const closedBadge = item.closed ? '<span class="closed-badge">폐업</span>' : '';
    return `
      <div class="result-item${isActive ? ' active' : ''}${item.closed ? ' is-closed' : ''}" role="listitem" data-id="${escapeHtml(item.id)}">
        <span class="result-type-badge" style="background:${color}20;color:${color}">${escapeHtml(item.clCdNm || '')}</span>${closedBadge}
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
  const color = item.closed ? '#9e9e9e' : (group ? group.color : '#666');

  const rows = buildInfoRows(item);

  document.getElementById('info-content').innerHTML = `
    <div class="info-type-badge" style="background:${color}">${escapeHtml(item.clCdNm || '병의원')}</div>
    ${item.closed ? '<div style="margin:4px 0 10px;font-size:13px;color:#d32f2f;font-weight:500">🚫 폐업' + (item.closedDate ? ` (${formatDate(item.closedDate)})` : '') + '</div>' : ''}
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

  if (item.addr) {
    rows.push({ icon: '📍', html: escapeHtml(item.addr) });
  }
  if (item.phone) {
    rows.push({ icon: '📞', html: `<a href="tel:${escapeHtml(item.phone)}">${escapeHtml(item.phone)}</a>` });
  }
  if (item.hospUrl) {
    const url = item.hospUrl.startsWith('http') ? item.hospUrl : 'http://' + item.hospUrl;
    rows.push({ icon: '🌐', html: `<a href="${encodeURI(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.hospUrl)}</a>` });
  }
  if (item.estbDd) {
    rows.push({ icon: '📅', html: `개설일 ${formatDate(item.estbDd)}` });
  }
  if (item.drTotCnt) {
    const doctorText = `의사 ${item.drTotCnt}명` +
      (item.mdeptSdrCnt ? ` (전문의 ${item.mdeptSdrCnt}명)` : '');
    rows.push({ icon: '👨‍⚕️', html: escapeHtml(doctorText) });
  }
  if (item.sgguCdNm) {
    rows.push({ icon: '🗺️', html: escapeHtml(`${item.sidoCdNm || ''} ${item.sgguCdNm}`.trim()) });
  }

  return rows;
}

function closeInfoPanel() {
  document.getElementById('info-panel').setAttribute('hidden', '');
  state.selectedId = null;
  document.querySelectorAll('.result-item').forEach(el => el.classList.remove('active'));
}

// ============================================================
// 인구통계 차트
// ============================================================
function renderPopulationChart() {
  const panel = document.getElementById('pop-section');

  if (!state.populationData || !state.populationData.regions?.[state.activeSido]) {
    const hasAnyData = state.populationData && Object.keys(state.populationData.regions || {}).length > 0;
    panel.innerHTML = `
      <div class="pop-no-data">
        ${hasAnyData
          ? '선택한 지역의 인구통계 데이터가 없습니다.'
          : `인구통계 데이터가 없습니다.<br><br>아래 명령어로 수집하세요:<code>MOIS_API_KEY=발급키<br>python scripts/fetch_population.py</code>`
        }
      </div>
    `;
    return;
  }

  const d = state.populationData.regions[state.activeSido];
  const malePct  = d.total > 0 ? (d.male   / d.total * 100) : 50;
  const femlPct  = d.total > 0 ? (d.female / d.total * 100) : 50;
  const maleW    = Math.round(malePct * 2.2);   // 100% → 220px
  const femlW    = Math.round(femlPct * 2.2);
  const ym       = state.populationData.updated || '';
  const ymLabel  = ym.length === 6 ? `${ym.slice(0,4)}년 ${ym.slice(4)}월` : ym;

  panel.innerHTML = `
    <div class="pop-header">
      <div class="pop-region-name">${escapeHtml(d.name)}</div>
      <div class="pop-total-count">총 <strong>${d.total.toLocaleString()}</strong>명</div>
    </div>

    <div class="pop-gender-section">
      <div class="pop-gender-row-item">
        <div class="pop-gender-label male-label">남성</div>
        <div class="pop-gender-bar-wrap">
          <div class="pop-gender-bar male-bar" style="width:${maleW}px"></div>
          <div class="pop-gender-val">${d.male.toLocaleString()}명 <span class="pop-pct">${malePct.toFixed(1)}%</span></div>
        </div>
      </div>
      <div class="pop-gender-row-item">
        <div class="pop-gender-label female-label">여성</div>
        <div class="pop-gender-bar-wrap">
          <div class="pop-gender-bar female-bar" style="width:${femlW}px"></div>
          <div class="pop-gender-val">${d.female.toLocaleString()}명 <span class="pop-pct">${femlPct.toFixed(1)}%</span></div>
        </div>
      </div>
    </div>

    <div class="pop-divider-line-h"></div>

    <div class="pop-stats-grid">
      <div class="pop-stat-item">
        <div class="pop-stat-label">세대수</div>
        <div class="pop-stat-value">${d.households.toLocaleString()}<span class="pop-stat-unit">세대</span></div>
      </div>
      <div class="pop-stat-item">
        <div class="pop-stat-label">세대당 인구</div>
        <div class="pop-stat-value">${d.hhSize}<span class="pop-stat-unit">명</span></div>
      </div>
      <div class="pop-stat-item">
        <div class="pop-stat-label">성비</div>
        <div class="pop-stat-value">${d.mfRatio}<span class="pop-stat-unit">남/여×100</span></div>
      </div>
    </div>

    <div class="pop-updated">기준: ${ymLabel} · 행정안전부 주민등록 인구통계</div>
  `;
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
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
