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
  { code: '290000', name: '세종' },
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

// 종별 그룹 (표시색 포함)
const TYPE_GROUPS = [
  { label: '상급·종합병원', codes: ['01', '11'], color: '#d32f2f' },
  { label: '병원',          codes: ['21', '28', '29'], color: '#f57c00' },
  { label: '의원',          codes: ['31'], color: '#388e3c' },
  { label: '치과',          codes: ['41', '42'], color: '#0288d1' },
  { label: '한방',          codes: ['81', '92'], color: '#7b1fa2' },
  { label: '약국',          codes: ['71'], color: '#00796b' },
  { label: '보건소',        codes: ['61', '62', '63'], color: '#5d4037' },
];

// 클러스터 크기별 설정
const CLUSTER_CONFIGS = [
  { threshold: 10,   size: 36, color: '#1a73e8' },
  { threshold: 50,   size: 44, color: '#0f9d58' },
  { threshold: 200,  size: 52, color: '#f4b400' },
  { threshold: 500,  size: 60, color: '#db4437' },
  { threshold: 1000, size: 68, color: '#9c27b0' },
];

const DATA_BASE_URL = './data';
const RESULTS_DISPLAY_LIMIT = 300;

// ============================================================
// 앱 상태
// ============================================================
const state = {
  map: null,
  cluster: null,
  allData: [],
  filteredData: [],
  markers: [],
  activeTypes: new Set(TYPE_GROUPS.map(g => g.label)),
  activeSido: '',
  searchText: '',
  selectedId: null,
};

// ============================================================
// 진입점
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  initUI();
  loadAllData();
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
}

// ============================================================
// UI 초기화
// ============================================================
function initUI() {
  buildTypeFilters();
  buildSidoSelect();
  bindSearchEvents();
  document.getElementById('info-close').addEventListener('click', closeInfoPanel);
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
    applyFilters();
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

  updateMarkers();
  renderResultsList();
}

// ============================================================
// 마커 업데이트
// ============================================================
function updateMarkers() {
  // 기존 클러스터 및 마커 제거
  if (state.cluster) {
    state.cluster.setMap(null);
    state.cluster = null;
  }
  state.markers.forEach(m => m.setMap(null));
  state.markers = [];

  const validData = state.filteredData.filter(d => d.lat && d.lng);
  if (validData.length === 0) return;

  state.markers = validData.map(item => {
    const group = getGroupByCode(item.clCd);
    const color = group ? group.color : '#666';

    const marker = new naver.maps.Marker({
      position: new naver.maps.LatLng(item.lat, item.lng),
      title: item.name,
      icon: buildMarkerIcon(color),
    });

    naver.maps.Event.addListener(marker, 'click', () => selectFacility(item));
    marker._facilityId = item.id;
    return marker;
  });

  // 마커 클러스터링 설정
  state.cluster = new naver.maps.MarkerClustering({
    map: state.map,
    markers: state.markers,
    disableClickZoom: false,
    minClusterSize: 2,
    maxZoom: 14,
    gridSize: 60,
    icons: buildClusterIcons(),
    indexGenerator: CLUSTER_CONFIGS.map(c => c.threshold),
    stylingFunction(clusterMarker, count) {
      const div = clusterMarker.getElement().querySelector('.cluster-marker');
      if (div) div.textContent = count >= 1000 ? Math.floor(count / 1000) + 'k' : count;
    },
  });
}

function buildMarkerIcon(color) {
  // 원형 핀 마커 (SVG)
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

function buildClusterIcons() {
  return CLUSTER_CONFIGS.map(({ size, color }) => ({
    content: `<div class="cluster-marker" style="width:${size}px;height:${size}px;background:${color};font-size:${Math.round(size * 0.32)}px;"></div>`,
    size: new naver.maps.Size(size, size),
    anchor: new naver.maps.Point(size / 2, size / 2),
  }));
}

// ============================================================
// 검색결과 목록 렌더링
// ============================================================
function renderResultsList() {
  const list = document.getElementById('results-list');

  if (state.filteredData.length === 0) {
    list.innerHTML = '<div class="no-results">검색 결과가 없습니다.<br>검색어나 필터를 변경해보세요.</div>';
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

  // 좌표가 있을 때만 지도 이동
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
