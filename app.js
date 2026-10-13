/* CineSéries — app 100% estático, hospedagem grátis.
   Fontes:
   - TMDB (se houver API Key): filmes + séries, trending, top rated, upcoming, discover com filtros, capas originais.
   - Sem chave: TVMaze (séries) + YTS (filmes). Sem build, sem backend.
*/
const $ = (s) => document.querySelector(s);
const grid = $('#grid'), statusEl = $('#status'), loadMoreBtn = $('#loadMore');

const TMDB_IMG = 'https://image.tmdb.org/t/p/original';
const TMDB_IMG_SMALL = 'https://image.tmdb.org/t/p/w500';
const PLACEHOLDER = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="750"><rect width="100%" height="100%" fill="#161d33"/><text x="50%" y="50%" fill="#9aa4c7" font-size="28" text-anchor="middle">Sem capa</text></svg>`);

const YTS_MIRRORS = ['https://movies-api.accel.li/api', 'https://yts.am/api', 'https://yts.ag/api', 'https://yts.mx/api', 'https://yts.lt/api']; // endpoint oficial novo primeiro

const state = {
  tab: 'all',
  type: 'all',
  query: '',
  yearMin: '',
  yearMax: '',
  minRating: 0,
  sort: 'rating_desc',
  page: 1,
  items: [],       // itens brutos da fonte atual
  filtered: [],
  perPage: 24,
  shown: 0,
  tmdbKey: localStorage.getItem('tmdb_key') || '',
  favorites: JSON.parse(localStorage.getItem('cineseries_favs') || '[]'),
  watched: JSON.parse(localStorage.getItem('cineseries_watched') || '[]'),
  watching: JSON.parse(localStorage.getItem('cineseries_watching') || '[]'),
  view: 'all', // all | favs | watched | watching
  moodText: '',
  moodProfile: null,
  userLoc: JSON.parse(localStorage.getItem('cineseries_loc') || 'null'), // {lat, lon, label}
  cinemas: [],
  ytsDown: false, // provedor de filmes inacessível (bloqueio de rede/AdBlock?)
  tvmazeCache: null,      // base (págs 0-1, clássicos p/ top)
  tvmazeRecent: null,     // bloco contíguo mais novo (sem buracos)
  loadToken: 0,           // invalida enriquecimento em 2º plano ao trocar filtro/aba
  modalKey: null,         // item com modal aberto (p/ atualizar nota IMDb ao chegar)
};

// ---------- Nota real do IMDb (Cinemeta, grátis, sem chave) ----------
// TVMaze/TMDB/YTS têm escala própria. O IMDb id (tt...) permite buscar a
// nota real: https://v3-cinemeta.strem.io/meta/{movie|series}/{tt}.json
let imdbCache = {};
try { imdbCache = JSON.parse(localStorage.getItem('cineseries_imdb') || '{}'); } catch { imdbCache = {}; }
function saveImdbCache() {
  try {
    const keys = Object.keys(imdbCache);
    if (keys.length > 2000) {
      const trimmed = {};
      keys.slice(-2000).forEach(k => trimmed[k] = imdbCache[k]);
      imdbCache = trimmed;
    }
    localStorage.setItem('cineseries_imdb', JSON.stringify(imdbCache));
  } catch {}
}
const imdbInflight = new Set();
async function fetchImdbRating(imdbId, type) {
  if (!imdbId) return null;
  if (imdbCache[imdbId]?.r) return imdbCache[imdbId].r;
  if (imdbInflight.has(imdbId)) return null;
  imdbInflight.add(imdbId);
  try {
    const kind = type === 'movie' ? 'movie' : 'series';
    const r = await fetch(`https://v3-cinemeta.strem.io/meta/${kind}/${imdbId}.json`);
    if (!r.ok) return null;
    const j = await r.json();
    const v = parseFloat(j?.meta?.imdbRating);
    if (v > 0) { imdbCache[imdbId] = { r: v }; saveImdbCache(); return v; }
  } catch {} finally { imdbInflight.delete(imdbId); }
  return null;
}
function badgeHtml(it) {
  if (it.imdbRating) return `<span class="badge imdb" title="Nota real do IMDb">★ ${it.imdbRating.toFixed(1)}</span>`;
  if (it.rating) return `<span class="badge" title="Nota ${it.source} — nota real IMDb a caminho">★ ${it.rating.toFixed(1)}</span>`;
  return `<span class="badge" title="Ainda sem votos">★ —</span>`;
}
function ratingLabel(it) {
  if (it.imdbRating) return `★ ${it.imdbRating.toFixed(1)} (IMDb)`;
  if (it.rating) return `★ ${it.rating.toFixed(1)} (${it.source})`;
  return '★ sem nota ainda';
}
function paintImdbBadge(key, v) {
  document.querySelectorAll(`[data-card="${CSS.escape(key)}"] .badge`).forEach(b => {
    b.classList.add('imdb'); b.title = 'Nota real do IMDb';
    b.textContent = '★ ' + v.toFixed(1);
  });
}
// Enriquece a leva visível com a nota real IMDb (concorrência limitada, com cache)
const imdbQueue = [];
let imdbRunning = 0;
function enrichIMDb(list) {
  for (const it of list) {
    if (!it.imdb || it.imdbRating || imdbInflight.has(it.imdb)) continue;
    if (imdbCache[it.imdb]?.r) { it.imdbRating = imdbCache[it.imdb].r; continue; }
    if (!imdbQueue.includes(it)) imdbQueue.push(it);
  }
  pumpImdb();
}
async function pumpImdb() {
  while (imdbRunning < 6 && imdbQueue.length) {
    const it = imdbQueue.shift();
    imdbRunning++;
    fetchImdbRating(it.imdb, it.type).then(v => {
      imdbRunning--;
      if (v) {
        for (const x of state.items) if (x.imdb === it.imdb) x.imdbRating = v;
        for (const x of state.favorites) if (x.imdb === it.imdb) x.imdbRating = v;
        paintImdbBadge(it.key, v);
        if (state.modalKey === it.key && !$('#modal').classList.contains('hidden')) openModal(it);
      }
      pumpImdb();
    });
  }
}

// ---------- setup filtros de ano / generos ----------
function setupFilters() {
  const now = new Date().getFullYear();
  const yMin = $('#yearMin'), yMax = $('#yearMax');
  yMin.innerHTML = '<option value="">—</option>' + Array.from({length: now - 1950 + 1}, (_, i) => now - i).map(y => `<option>${y}</option>`).join('');
  yMax.innerHTML = '<option value="">—</option>' + Array.from({length: now - 1950 + 1}, (_, i) => now - i).map(y => `<option>${y}</option>`).join('');
  yMax.value = '';
}

// ---------- helpers ----------
function stripHtml(h = '') { const d = document.createElement('div'); d.innerHTML = h; return d.textContent.trim(); }
function yearOf(item) { return item.year || null; }
function applyClientFilters(items) {
  // normaliza ano: se "de" > "até", inverte automaticamente
  let lo = state.yearMin ? +state.yearMin : null;
  let hi = state.yearMax ? +state.yearMax : null;
  if (lo && hi && lo > hi) { const t = lo; lo = hi; hi = t; }
  let out = items.filter(it => {
    if (state.type !== 'all' && it.type !== state.type) return false;
    if (state.minRating && (it.rating ?? 0) < state.minRating) return false;
    if (lo && (it.year || 0) < lo) return false;
    if (hi && (it.year || 0) > hi) return false;
    return true;
  });
  const sorters = {
    rating_desc: (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
    year_desc: (a, b) => (b.year ?? 0) - (a.year ?? 0),
    year_asc: (a, b) => (a.year ?? 0) - (b.year ?? 0),
    title_asc: (a, b) => a.title.localeCompare(b.title),
  };
  out.sort(sorters[state.sort] || sorters.rating_desc);
  return out;
}

function saveFavs() { localStorage.setItem('cineseries_favs', JSON.stringify(state.favorites)); updateCounts(); }
function saveWatched() { localStorage.setItem('cineseries_watched', JSON.stringify(state.watched)); updateCounts(); }
function saveWatching() { localStorage.setItem('cineseries_watching', JSON.stringify(state.watching)); updateCounts(); }
function updateCounts() {
  $('#favCount').textContent = state.favorites.length;
  $('#watchedCount').textContent = state.watched.length;
  $('#watchingCount').textContent = state.watching.length;
}
function inList(list, it) { return list.some(f => f.key === it.key); }
function isFav(it) { return inList(state.favorites, it); }
function isWatched(it) { return inList(state.watched, it); }
function isWatching(it) { return inList(state.watching, it); }
function toggleFav(it) {
  const i = state.favorites.findIndex(f => f.key === it.key);
  if (i >= 0) state.favorites.splice(i, 1); else state.favorites.push(it);
  saveFavs(); render();
}
function toggleWatched(it) {
  const i = state.watched.findIndex(f => f.key === it.key);
  if (i >= 0) state.watched.splice(i, 1);
  else { state.watched.push(it); state.watching = state.watching.filter(f => f.key !== it.key); saveWatching(); }
  saveWatched(); render();
}
function toggleWatching(it) {
  const i = state.watching.findIndex(f => f.key === it.key);
  if (i >= 0) state.watching.splice(i, 1);
  else { state.watching.push(it); state.watched = state.watched.filter(f => f.key !== it.key); saveWatched(); }
  saveWatching(); render();
}
function currentBase() {
  if (state.view === 'favs') return state.favorites;
  if (state.view === 'watched') return state.watched;
  if (state.view === 'watching') return state.watching;
  return state.filtered;
}
function paintViewButtons() {
  const map = { favs: '#favBtn', watched: '#watchedBtn', watching: '#watchingBtn' };
  for (const [v, sel] of Object.entries(map)) {
    const b = $(sel);
    if (b) b.style.borderColor = state.view === v ? '#f5c518' : '';
  }
}
function setView(v) {
  state.view = (state.view === v) ? 'all' : v;
  state.shown = state.perPage;
  paintViewButtons();
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- render ----------
function buildCard(it) {
    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.card = it.key;
    card.innerHTML = `
      <div class="poster">
        <img loading="lazy" src="${it.coverSmall || it.cover}" data-full="${it.cover}" alt="Capa de ${it.title.replace(/"/g, '&quot;')}"
             onerror="this.src='${PLACEHOLDER}'" />
        ${badgeHtml(it)}
        <span class="type-tag">${it.type === 'movie' ? 'Filme' : 'Série'}</span>
        <button class="fav ${isFav(it) ? 'on' : ''}" title="Favoritar">★</button>
      </div>
      <div class="info">
        <h3>${it.title}</h3>
        <div class="meta"><span>${it.year || '—'}</span>${it.genres?.length ? `<span>• ${it.genres.slice(0, 2).join(', ')}</span>` : ''}</div>
        <p class="overview">${(it.overview || 'Sem sinopse.').slice(0, 160)}</p>
        <div class="card-flags">
          <button class="flag ${isWatched(it) ? 'on' : ''}" data-act="watched" title="Marcar como assistido">✓ Já vi</button>
          <button class="flag ${isWatching(it) ? 'on' : ''}" data-act="watching" title="Marcar como assistindo">▶ Vendo</button>
        </div>
        <button class="details-btn">Detalhes</button>
      </div>`;
    card.querySelector('img').addEventListener('click', () => openModal(it));
    card.querySelector('.details-btn').addEventListener('click', () => openModal(it));
    card.querySelector('.fav').addEventListener('click', (e) => { e.stopPropagation(); toggleFav(it); });
    card.querySelector('[data-act="watched"]').addEventListener('click', (e) => { e.stopPropagation(); toggleWatched(it); });
    card.querySelector('[data-act="watching"]').addEventListener('click', (e) => { e.stopPropagation(); toggleWatching(it); });
    return card;
}
function render() {
  grid.innerHTML = '';
  let list = applyClientFilters(currentBase());
  const slice = list.slice(0, state.shown);
  for (const it of slice) if (it.imdb && !it.imdbRating && imdbCache[it.imdb]?.r) it.imdbRating = imdbCache[it.imdb].r;
  if (!slice.length) {
    const active = [];
    if (state.yearMin || state.yearMax) active.push(`ano ${state.yearMin || '…'}–${state.yearMax || '…'}`);
    if (state.query && state.tab === 'search') active.push(`busca "${state.query}"`);
    const hints = {
      favs: 'Você ainda não favoritou nada. Toque na ★ de um título para salvar.',
      watched: 'Nenhum título marcado como assistido. Toque em "✓ Já vi" para marcar.',
      watching: 'Nenhum título em acompanhamento. Toque em "▶ Vendo" para marcar.',
    };
    statusEl.textContent = (state.view !== 'all' && hints[state.view])
      ? hints[state.view]
      : state.tab === 'assistant' && !state.moodText.trim()
        ? 'Descreva seu momento acima e toque em "Sugerir o que assistir".'
        : `Nenhum título${active.length ? ` para ${active.join(' • ')}` : ''}. ` +
        'Dica: deixe "até" em branco p/ incluir o ano atual, confira se "de" ≤ "até" e tente aba Lançamentos p/ 2025.';
  } else {
    statusEl.textContent = list.length === 1 ? '1 título encontrado' : `${list.length} títulos encontrados`;
    if (state.ytsDown && state.type !== 'series') statusEl.textContent += ' • filmes indisponíveis: sua rede/AdBlock pode estar bloqueando o provedor';
  }
  // Na aba Em cartaz, separa filmes e séries com títulos de seção.
  const grouped = state.tab === 'nowplaying' && state.view === 'all' && state.type === 'all';
  const groups = grouped
    ? [['🎬 Filmes em cartaz', slice.filter(i => i.type === 'movie')], ['📺 Séries no ar', slice.filter(i => i.type === 'series')]]
    : [[null, slice]];
  for (const [gtitle, gitems] of groups) {
    if (gtitle && gitems.length) {
      const h = document.createElement('h2');
      h.className = 'grid-title';
      h.textContent = gtitle;
      grid.appendChild(h);
    }
    for (const it of gitems) {
      try { grid.appendChild(buildCard(it)); }
      catch (e) { console.error('card', it && it.key, e); }
    }
  }
  loadMoreBtn.classList.toggle('hidden', state.shown >= list.length);
  enrichIMDb(slice); // busca a nota real IMDb da leva visível, sem travar a tela
}

async function resolveTmdbImdb(it) {
  if (it.imdb || !state.tmdbKey || !it.tmdbId || it.imdbResolved) return it.imdb || null;
  it.imdbResolved = true;
  try {
    const d = await tmdb((it.type === 'movie' ? '/movie/' : '/tv/') + it.tmdbId, {});
    if (d.imdb_id) it.imdb = d.imdb_id;
  } catch {}
  return it.imdb || null;
}
function openModal(it) {
  state.modalKey = it.key;
  $('#modalBody').innerHTML = `
    <div class="modal-hero">
      <img src="${it.cover}" onerror="this.src='${PLACEHOLDER}'" alt="Capa original de ${it.title}" />
      <div>
        <h2>${it.title}</h2>
        <div class="sub">${ratingLabel(it)} • ${it.year || '—'} • ${it.type === 'movie' ? 'Filme' : 'Série'}${it.imdb ? ` • <a href="https://www.imdb.com/title/${it.imdb}/" target="_blank" rel="noopener">ver no IMDb</a>` : ''}</div>
        <div class="chips">${(it.genres || []).map(g => `<span>${g}</span>`).join('')}</div>
        <p>${it.overview || 'Sinopse não disponível.'}</p>
        <div class="row">
          <button class="primary" id="mFav">${isFav(it) ? '★ Remover dos favoritos' : '☆ Favoritar'}</button>
          <button class="ghost ${isWatched(it) ? 'on' : ''}" id="mWatched">${isWatched(it) ? '✓ Assistido' : '✓ Já vi'}</button>
          <button class="ghost ${isWatching(it) ? 'on' : ''}" id="mWatching">${isWatching(it) ? '▶ Assistindo' : '▶ Vendo'}</button>
          ${it.type === 'movie' ? `<a href="https://www.google.com/search?q=${encodeURIComponent(it.title + ' ' + (it.year || '') + ' sessões cinema ' + (state.userLoc?.label || ''))}" target="_blank" rel="noopener"><button class="ghost">🎟 Sessões</button></a>` : ''}
          ${it.trailer ? `<a href="${it.trailer}" target="_blank" rel="noopener"><button class="ghost">▶ Trailer</button></a>` : ''}
        </div>
        <p class="hint">Capa original carregada de ${it.source}.</p>
      </div>
    </div>`;
  $('#modal').classList.remove('hidden');
  $('#mFav').addEventListener('click', () => { toggleFav(it); openModal(it); });
  $('#mWatched').addEventListener('click', () => { toggleWatched(it); openModal(it); });
  $('#mWatching').addEventListener('click', () => { toggleWatching(it); openModal(it); });
  // Nota real IMDb ao abrir o detalhe (usa o id IMDb; no modo TMDB resolve primeiro)
  if (it.imdb && !it.imdbRating) {
    fetchImdbRating(it.imdb, it.type).then(v => {
      if (v && state.modalKey === it.key && !$('#modal').classList.contains('hidden')) {
        it.imdbRating = v; paintImdbBadge(it.key, v); openModal(it);
      }
    });
  } else if (!it.imdb && state.tmdbKey && it.tmdbId) {
    resolveTmdbImdb(it).then(id => {
      if (id && state.modalKey === it.key && !$('#modal').classList.contains('hidden')) {
        fetchImdbRating(id, it.type).then(v => {
          if (v && state.modalKey === it.key && !$('#modal').classList.contains('hidden')) {
            it.imdbRating = v; paintImdbBadge(it.key, v); openModal(it);
          }
        });
      }
    });
  }
}

// ---------- TMDB (modo completo) ----------
async function tmdb(path, params = {}) {
  const url = new URL('https://api.themoviedb.org/3' + path);
  url.searchParams.set('api_key', state.tmdbKey);
  url.searchParams.set('language', 'pt-BR');
  url.searchParams.set('include_adult', 'false');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url);
  if (!r.ok) throw new Error('TMDB ' + r.status);
  return r.json();
}
function tmdbToItem(x) {
  const isMovie = x.media_type ? x.media_type === 'movie' : ('title' in x);
  const title = x.title || x.name || 'Sem título';
  const date = x.release_date || x.first_air_date || '';
  return {
    key: 'tmdb-' + (x.media_type || (isMovie ? 'movie' : 'tv')) + '-' + x.id,
    title,
    type: isMovie ? 'movie' : 'series',
    year: date ? +date.slice(0, 4) : null,
    rating: x.vote_average ?? 0,
    cover: x.poster_path ? TMDB_IMG + x.poster_path : PLACEHOLDER,
    coverSmall: x.poster_path ? TMDB_IMG_SMALL + x.poster_path : PLACEHOLDER,
    overview: x.overview || '',
    genres: (x.genre_ids || []).map(id => TMDB_GENRES[id]).filter(Boolean),
    source: 'TMDB',
    runtime: null,
    imdb: null,
    imdbRating: null,
    tmdbId: x.id,
    trailer: `https://www.themoviedb.org/${isMovie ? 'movie' : 'tv'}/${x.id}`,
  };
}
const TMDB_GENRES = {28:'Action',12:'Adventure',16:'Animation',35:'Comedy',80:'Crime',99:'Documentary',18:'Drama',10751:'Family',14:'Fantasy',36:'History',27:'Horror',10402:'Music',9648:'Mystery',10749:'Romance',878:'Sci-Fi',10770:'TV Movie',53:'Thriller',10752:'War',37:'Western',10759:'Action',10762:'Kids',10763:'News',10764:'Reality',10765:'Sci-Fi',10766:'Soap',10767:'Talk',10768:'War'};

async function loadTMDB() {
  const p = { page: state.page };
  if (state.tab === 'trending') {
    const d = await tmdb('/trending/all/week', p);
    return d.results.filter(x => x.media_type === 'movie' || x.media_type === 'tv').map(tmdbToItem);
  }
  if (state.tab === 'search' && state.query) {
    const d = await tmdb('/search/multi', { ...p, query: state.query });
    return d.results.filter(x => (x.media_type === 'movie' || x.media_type === 'tv') && x.poster_path).map(tmdbToItem);
  }
  // top + releases usam discover para respeitar filtros de ano/nota direto na API
  const minVote = 100;
  const base = {
    'vote_count.gte': minVote,
    'vote_average.gte': state.minRating || 0,
    sort_by: state.sort === 'title_asc' ? 'original_title.asc' : state.sort === 'year_asc' ? 'primary_release_date.asc' : state.sort === 'year_desc' ? 'primary_release_date.desc' : 'vote_average.desc',
    page: state.page,
  };
  if (state.yearMin) { base['primary_release_date.gte'] = base['first_air_date.gte'] = state.yearMin + '-01-01'; }
  if (state.yearMax) { base['primary_release_date.lte'] = base['first_air_date.lte'] = state.yearMax + '-12-31'; }
  const out = [];
  const wantMovies = state.type === 'all' || state.type === 'movie';
  const wantTv = state.type === 'all' || state.type === 'series';
  if (state.tab === 'nowplaying') {
    if (wantMovies) out.push(...(await tmdb('/movie/now_playing', { page: state.page, region: 'BR' })).results.map(x => ({ ...x, media_type: 'movie' })).map(tmdbToItem));
    if (wantTv) out.push(...(await tmdb('/tv/on_the_air', { page: state.page })).results.map(x => ({ ...x, media_type: 'tv' })).map(tmdbToItem));
    return out;
  }
  if (state.tab === 'top' || state.tab === 'all') {
    if (state.tab === 'all') base['vote_count.gte'] = 10; // "Todos": catálogo amplo, só respeita os filtros
    if (wantMovies) out.push(...(await tmdb('/discover/movie', base)).results.map(x => ({ ...x, media_type: 'movie' })).map(tmdbToItem));
    if (wantTv) {
      const tvParams = { ...base, sort_by: base.sort_by.replace('primary_release_date', 'first_air_date') };
      delete tvParams['primary_release_date.gte']; delete tvParams['primary_release_date.lte'];
      out.push(...(await tmdb('/discover/tv', tvParams)).results.map(x => ({ ...x, media_type: 'tv' })).map(tmdbToItem));
    }
    return out;
  }
  if (state.tab === 'releases') {
    const y = new Date().getFullYear();
    if (wantMovies) out.push(...(await tmdb('/discover/movie', { ...base, sort_by: 'primary_release_date.desc', 'primary_release_date.gte': (y - 1) + '-01-01', 'vote_count.gte': 10 })).results.map(x => ({ ...x, media_type: 'movie' })).map(tmdbToItem));
    if (wantTv) out.push(...(await tmdb('/discover/tv', { ...base, sort_by: 'first_air_date.desc', 'first_air_date.gte': (y - 1) + '-01-01', 'vote_count.gte': 10 })).results.map(x => ({ ...x, media_type: 'tv' })).map(tmdbToItem));
    return out;
  }
  return [];
}

// ---------- Modo sem chave: TVMaze (séries) ----------
async function tvmazeFetchPage(p) {
  const r = await fetch(`https://api.tvmaze.com/shows?page=${p}`);
  if (!r.ok) throw new Error('TVMaze page ' + p + ' → ' + r.status);
  return r.json();
}
// As páginas são ordenadas por ID (~250/pág). Provas espaçadas (280, 300, …)
// deixam buracos: ex. Spider-Noir (id 77003) está na pág. 308 e era ignorada.
// Por isso: descobre a última página e lê o bloco contíguo mais novo.
async function tvmazeLastPage() {
  try {
    const cached = JSON.parse(localStorage.getItem('tvmaze_lastpage') || 'null');
    if (cached && Date.now() - cached.ts < 7 * 864e5) return cached.page;
  } catch {}
  let hi = 400, last = 340;
  while (hi > 300) {
    try { await tvmazeFetchPage(hi); last = hi; break; } catch { hi -= 5; }
  }
  for (let p = last + 1; p <= last + 5; p++) {
    try { await tvmazeFetchPage(p); last = p; } catch { break; }
  }
  try { localStorage.setItem('tvmaze_lastpage', JSON.stringify({ page: last, ts: Date.now() })); } catch {}
  return last;
}
// Para um ano específico, amostragem de páginas nunca é exaustiva
// (cada página mistura anos). O complemento é a grade de programação:
// 12 datas/ano localizam as séries que estavam no ar naquele ano.
async function fetchInBatches(urls, batch = 12, gapMs = 2500) {
  const out = [];
  for (let i = 0; i < urls.length; i += batch) {
    out.push(...await Promise.allSettled(urls.slice(i, i + batch).map(async u => {
      const r = await fetch(u);
      if (!r.ok) throw new Error(u + ' → ' + r.status);
      return r.json();
    })));
    if (i + batch < urls.length) await new Promise(res => setTimeout(res, gapMs));
  }
  return out;
}
const yearSchedCache = {};
const weeklyCache = {};
function mondayGrid(year) {
  const jan1 = new Date(year + '-01-01T12:00:00Z');
  const offset = (8 - jan1.getUTCDay()) % 7; // dias até a 1ª segunda (0 se 1º jan já é segunda)
  const first = new Date(jan1.getTime() + offset * 864e5);
  const dates = [];
  for (let i = 0; i < 53; i++) {
    const d = new Date(first.getTime() + i * 7 * 864e5);
    if (d.getUTCFullYear() !== year) break;
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}
// Cobertura ampliada do ano em 2º plano: a grade mensal (rápida) já veio no
// carregamento inicial; aqui varremos as segundas-feiras do ano em lotes,
// mesclando e reexibindo a cada lote. Validado: inclui drops de segunda
// como Spider-Noir (25/05/2026), que a grade mensal (dia 15) não alcança.
async function enrichYearWeeklies(year, token) {
  const merge = (raws) => {
    const keys = new Set(state.items.map(it => it.key));
    let added = 0;
    for (const s of raws) {
      if (!s || keys.has('tvmaze-' + s.id)) continue;
      keys.add('tvmaze-' + s.id);
      state.items.push(tvmazeToItem(s));
      added++;
    }
    return added;
  };
  if (weeklyCache[year]) {
    if (token !== state.loadToken) return;
    if (merge(weeklyCache[year])) { state.filtered = state.items; render(); }
    return;
  }
  const dates = mondayGrid(year);
  const collected = [];
  for (let i = 0; i < dates.length; i += 12) {
    if (token !== state.loadToken) return; // usuário trocou de aba/filtro: aborta
    const ss = await Promise.allSettled(dates.slice(i, i + 12).map(async dt => {
      const r = await fetch(`https://api.tvmaze.com/schedule?country=US&date=${dt}`);
      if (!r.ok) throw new Error(dt + ' → ' + r.status);
      return r.json();
    }));
    if (token !== state.loadToken) return;
    const raws = [];
    for (const r of ss) if (r.status === 'fulfilled') for (const e of r.value) if (e.show) raws.push(e.show);
    collected.push(...raws);
    merge(raws);
    state.filtered = state.items;
    render();
    if (i + 12 < dates.length) await new Promise(res => setTimeout(res, 2500));
  }
  weeklyCache[year] = collected;
}
async function tvmazeYearSchedules(lo, hi) {
  const nowY = new Date().getFullYear();
  lo = lo || hi || nowY;
  hi = hi || lo;
  if (hi - lo > 2) lo = hi - 2; // teto: 3 anos (36 requisições em lotes)
  const key = lo + '-' + hi;
  if (yearSchedCache[key]) return yearSchedCache[key];
  const dates = [];
  for (let y = lo; y <= hi; y++) for (let m = 1; m <= 12; m++) dates.push(`${y}-${String(m).padStart(2, '0')}-15`);
  statusEl.textContent = `Buscando grade de ${lo}${hi !== lo ? '–' + hi : ''} (TVMaze)…`;
  const settled = await fetchInBatches(dates.map(d => `https://api.tvmaze.com/schedule?country=US&date=${d}`));
  const seen = new Map();
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue;
    for (const e of r.value) if (e.show && !seen.has(e.show.id)) seen.set(e.show.id, e.show);
  }
  const arr = [...seen.values()];
  yearSchedCache[key] = arr;
  return arr;
}
// As páginas iniciais (0-2) só têm séries antigas (IDs baixos).
// Séries de 2024–2026 estão nas páginas altas (~280+), por isso o filtro
// de ano 2025 retornava vazio. Buscamos as duas pontas + grade da semana.
async function tvmazeBaseShows() {
  if (state.tvmazeCache) return state.tvmazeCache;
  statusEl.textContent = 'Carregando séries (TVMaze)…';
  const pages = [0, 1];
  const all = (await Promise.all(pages.map(tvmazeFetchPage))).flat();
  state.tvmazeCache = all;
  return all;
}
async function tvmazeRecentShows() {
  if (state.tvmazeRecent) return state.tvmazeRecent;
  // Bloco contíguo das 5 páginas mais novas (sem buracos entre provas).
  const last = await tvmazeLastPage().catch(() => 340);
  const pages = [last - 4, last - 3, last - 2, last - 1, last].filter(p => p >= 0);
  const results = await Promise.allSettled(pages.map(tvmazeFetchPage));
  const all = results.filter(r => r.status === 'fulfilled').map(r => r.value).flat();
  state.tvmazeRecent = all;
  return all;
}
async function tvmazeScheduleWeek() {
  const days = [-2, -1, 0, 1, 2, 3];
  const results = await Promise.allSettled(days.map(async off => {
    const d = new Date(Date.now() + off * 864e5).toISOString().slice(0, 10);
    const r = await fetch(`https://api.tvmaze.com/schedule?country=US&date=${d}`);
    if (!r.ok) throw new Error('schedule ' + d);
    return r.json();
  }));
  const seen = new Map();
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const e of r.value) if (e.show && !seen.has(e.show.id)) seen.set(e.show.id, e.show);
  }
  return [...seen.values()];
}
function tvmazeToItem(s) {
  return {
    key: 'tvmaze-' + s.id,
    title: s.name,
    type: 'series',
    year: s.premiered ? +s.premiered.slice(0, 4) : null,
    rating: s.rating?.average ?? 0,
    cover: s.image?.original || s.image?.medium || PLACEHOLDER,
    coverSmall: s.image?.medium || s.image?.original || PLACEHOLDER,
    overview: stripHtml(s.summary),
    genres: s.genres || [],
    source: 'TVMaze',
    runtime: s.runtime || s.averageRuntime || null,
    imdb: s.externals?.imdb || null,
    imdbRating: (s.externals?.imdb && imdbCache[s.externals.imdb]?.r) || null,
    trailer: s.officialSite || s.url,
  };
}
async function loadSeriesFree() {
  if (state.tab === 'search' && state.query) {
    const r = await fetch(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(state.query)}`);
    const d = await r.json();
    return d.map(x => tvmazeToItem(x.show)).filter(x => x.cover !== PLACEHOLDER || x.rating);
  }
  const yf = !!(state.yearMin || state.yearMax);
  const lo = state.yearMin ? +state.yearMin : null;
  const hi = state.yearMax ? +state.yearMax : null;
  if (state.tab === 'releases' || state.tab === 'nowplaying') {
    const [week, recent, fromYear] = await Promise.all([
      tvmazeScheduleWeek().catch(() => []),
      tvmazeRecentShows().catch(() => []),
      yf ? tvmazeYearSchedules(lo, hi).catch(() => []) : Promise.resolve([]),
    ]);
    const seen = new Map();
    for (const s of [...week, ...recent, ...fromYear]) if (s && !seen.has(s.id)) seen.set(s.id, tvmazeToItem(s));
    return [...seen.values()];
  }
  const [base, recent, fromYear] = await Promise.all([
    tvmazeBaseShows(),
    tvmazeRecentShows().catch(() => []),
    yf ? tvmazeYearSchedules(lo, hi).catch(() => []) : Promise.resolve([]),
  ]);
  const seen = new Map();
  for (const s of [...base, ...recent, ...fromYear]) if (s && !seen.has(s.id)) seen.set(s.id, s);
  let items = [...seen.values()].map(tvmazeToItem);
  // Títulos futuros/recentes muitas vezes ainda não têm nota; com filtro de
  // ano eles devem aparecer (no fim da ordenação), não ser descartados.
  if (!yf) items = items.filter(x => x.rating);
  // Filtra (ano/gênero/nota) ANTES de cortar: o slice não pode comer o ano alvo.
  items = applyClientFilters(items);
  return items.slice(0, 800);
}

// ---------- Modo sem chave: YTS (filmes) ----------
async function ytsFetch(params) {
  let lastErr;
  for (const base of YTS_MIRRORS) {
    try {
      const url = new URL(base + '/v2/list_movies.json');
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      const r = await fetch(url);
      const d = await r.json();
      if (d.status === 'ok') { state.ytsDown = false; return d.data.movies || []; }
    } catch (e) { lastErr = e; }
  }
  state.ytsDown = true;
  throw lastErr || new Error('YTS indisponível');
}
function ytsToItem(m) {
  return {
    key: 'yts-' + m.id,
    title: m.title_english || m.title,
    type: 'movie',
    year: m.year || null,
    rating: m.rating || 0,
    cover: m.large_cover_image || m.medium_cover_image || PLACEHOLDER,
    coverSmall: m.medium_cover_image || m.large_cover_image || PLACEHOLDER,
    overview: m.synopsis || m.description_full || '',
    genres: m.genres || [],
    source: 'YTS',
    runtime: m.runtime || null,
    imdb: m.imdb_code || null,
    imdbRating: (m.imdb_code && imdbCache[m.imdb_code]?.r) || null,
    trailer: m.yt_trailer_code ? `https://www.youtube.com/watch?v=${m.yt_trailer_code}` : (m.imdb_code ? `https://www.imdb.com/title/${m.imdb_code}/` : null),
  };
}
async function loadMoviesFree() {
  // A API do YTS não tem parâmetro de ano: o filtro é aplicado no cliente.
  // O problema: com sort por like_count/rating e só 40 itens, títulos de
  // 2025 quase nunca vinham. Com filtro de ano, ordenamos por ano/data e
  // buscamos várias páginas (até ~200 filmes) para o ano existir no lote.
  const hasYearFilter = !!(state.yearMin || state.yearMax);
  const sortMap = { trending: 'like_count', top: 'rating', all: 'like_count', nowplaying: 'year', releases: 'year', search: 'date_added' };
  let sort = sortMap[state.tab] || 'like_count';
  if (hasYearFilter && state.tab !== 'search') sort = 'year';
  const isSearch = state.tab === 'search' && state.query;
  if (state.tab === 'nowplaying' && !isSearch) {
    // "Em cartaz" sem chave: ordenar só por ano traz lixo obscuro (ex. 2027 nota 2).
    // Em vez disso: adicionados recentemente + nota ≥ 6 + ano dentro da janela real.
    const nowY = new Date().getFullYear();
    const batches = await Promise.all([1, 2].map(page => ytsFetch({
      limit: 50, page, sort_by: 'date_added', order_by: 'desc',
      with_rt_ratings: false, minimum_rating: 6,
    }).catch(() => [])));
    const seen = new Map();
    for (const m of batches.flat()) if (m && !seen.has(m.id)) seen.set(m.id, m);
    return [...seen.values()].map(ytsToItem).filter(it => it.year >= nowY - 1 && it.year <= nowY + 1 && it.rating >= 6);
  }
  // Busca: só a página atual. "Todos" sem ano: 3 páginas p/ amplitude.
  // Listagem com filtro de ano: 4 páginas ordenadas por ano p/ cobrir o ano.
  const pages = isSearch ? [state.page]
    : (hasYearFilter && state.page === 1) ? [1, 2, 3, 4]
    : (state.tab === 'all' && state.page === 1) ? [1, 2, 3]
    : [state.page];
  const batches = await Promise.all(pages.map(page => {
    const params = {
      limit: 50, page,
      sort_by: sort,
      order_by: 'desc', with_rt_ratings: false,
      minimum_rating: state.minRating || 0,
    };
    if (isSearch) params.query_term = state.query;
    return ytsFetch(params).catch(() => []);
  }));
  const seen = new Map();
  for (const m of batches.flat()) if (m && !seen.has(m.id)) seen.set(m.id, m);
  return [...seen.values()].map(ytsToItem);
}

// ---------- Em cartaz: cinemas próximos (OpenStreetMap, grátis, sem chave) ----------
function haversineKm(a, b, c, d) {
  const R = 6371, t = Math.PI / 180;
  const h = Math.sin((c - a) * t / 2) ** 2 + Math.cos(a * t) * Math.cos(c * t) * Math.sin((d - b) * t / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function formatAddr(t = {}) {
  const parts = [];
  const street = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(', ');
  if (street) parts.push(street);
  const hood = t['addr:suburb'] || t['addr:district'] || t['addr:neighbourhood'];
  const city = t['addr:city'] || t['addr:town'] || t['addr:village'];
  if (hood && city) parts.push(`${hood} — ${city}`);
  else if (hood || city) parts.push(hood || city);
  if (t['addr:postcode']) parts.push(t['addr:postcode']);
  return parts.join(' • ') || 'Endereço não cadastrado no mapa';
}
async function overpassCinemas(lat, lon, radius = 25000) {
  const q = `[out:json][timeout:25];(node["amenity"="cinema"](around:${radius},${lat},${lon});way["amenity"="cinema"](around:${radius},${lat},${lon});relation["amenity"="cinema"](around:${radius},${lat},${lon}););out center 20;`;
  const attempts = [
    { url: 'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q) },
    { url: 'https://overpass.kumi.systems/api/interpreter?data=' + encodeURIComponent(q) },
    { url: 'https://overpass-api.de/api/interpreter', opts: { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) } },
  ];
  let lastErr;
  for (const a of attempts) {
    try {
      const r = await fetch(a.url, a.opts);
      if (!r.ok) throw new Error('Overpass ' + r.status);
      return ((await r.json()).elements || []);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Overpass indisponível');
}
function saveLoc() { try { localStorage.setItem('cineseries_loc', JSON.stringify(state.userLoc)); } catch {} }
async function reverseCity(lat, lon) {
  try {
    const r = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&lang=default`);
    const p = (await r.json()).features?.[0]?.properties || {};
    const city = p.city || p.name || '';
    return city && p.state ? `${city} — ${p.state}` : city;
  } catch { return ''; }
}
async function geocodeCity(q) {
  const m = q.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (m) return { lat: +m[1], lon: +m[2], label: `${m[1]}, ${m[2]}` };
  const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=1&lang=default`);
  if (!r.ok) throw new Error('geo ' + r.status);
  const f = (await r.json()).features?.[0];
  if (!f) throw new Error('not found');
  const p = f.properties || {};
  const city = p.city || p.name || '';
  return { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], label: [city, p.state].filter(Boolean).join(' — ') || q };
}
async function loadCinemas() {
  const box = $('#cinemaList'), st = $('#cinemaStatus');
  if (!state.userLoc) { st.textContent = 'Informe sua cidade ou toque em 📍.'; box.innerHTML = ''; return; }
  st.textContent = `Buscando cinemas perto de ${state.userLoc.label}…`;
  box.innerHTML = '';
  try {
    const els = await overpassCinemas(state.userLoc.lat, state.userLoc.lon);
    state.cinemas = els.map(e => {
      const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
      return {
        id: `osm-${e.type}-${e.id}`, name: e.tags?.name || 'Cinema',
        addr: formatAddr(e.tags), lat, lon,
        dist: lat != null ? haversineKm(state.userLoc.lat, state.userLoc.lon, lat, lon) : null,
      };
    }).filter(c => c.lat != null).sort((a, b) => (a.dist ?? 1e9) - (b.dist ?? 1e9)).slice(0, 12);
    renderCinemas();
  } catch (e) { console.error(e); st.textContent = 'Não foi possível buscar cinemas agora. Tente de novo.'; }
}
function renderCinemas() {
  const box = $('#cinemaList'), st = $('#cinemaStatus');
  if (!state.cinemas.length) {
    st.textContent = state.userLoc ? `Nenhum cinema achado num raio de 25 km de ${state.userLoc.label}.` : 'Informe sua cidade ou toque em 📍.';
    box.innerHTML = '';
    return;
  }
  st.textContent = `${state.cinemas.length} cinemas perto de ${state.userLoc.label} • Mapa abre a rota, Sessões mostra horários`;
  const cityQ = state.userLoc.label || '';
  box.innerHTML = state.cinemas.map(c => {
    const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.name + ' ' + c.addr)}`;
    const sess = `https://www.google.com/search?q=${encodeURIComponent('sessões horários ' + c.name + ' ' + cityQ)}`;
    return `<article class="cinema-card"><strong>${c.name.replace(/</g, '&lt;')}</strong><small>${c.addr}</small><small>${c.dist != null ? c.dist.toFixed(1) + ' km de distância' : ''}</small><div class="cinema-links"><a href="${maps}" target="_blank" rel="noopener"><button>📍 Mapa</button></a><a href="${sess}" target="_blank" rel="noopener"><button class="ghost">🎟 Sessões</button></a></div></article>`;
  }).join('');
}

// ---------- Assistente de momento (texto livre → perfil → ranking) ----------
const LIGHT_GENRES = ['Comedy', 'Animation', 'Family', 'Romance', 'Music'];
const INTENSE_GENRES = ['Horror', 'Thriller', 'Crime', 'Action', 'War'];
const COZY_GENRES = ['Drama', 'Romance', 'Mystery', 'Fantasy'];
function analyzeMood(text) {
  const t = (text || '').toLowerCase();
  const has = (...ws) => ws.some(w => t.includes(w));
  const p = { want: new Set(), avoid: new Set(), light: 0, maxRuntime: null, signals: [] };
  const gmap = { 'terror': 'Horror', 'comédia': 'Comedy', 'comedia': 'Comedy', 'romance': 'Romance', 'ação': 'Action', 'acao': 'Action', 'aventura': 'Adventure', 'drama': 'Drama', 'ficção': 'Sci-Fi', 'ficcao': 'Sci-Fi', 'suspense': 'Thriller', 'animação': 'Animation', 'animacao': 'Animation', 'crime': 'Crime', 'documentário': 'Documentary', 'documentario': 'Documentary', 'fantasia': 'Fantasy', 'mistério': 'Mystery', 'misterio': 'Mystery', 'musical': 'Music', 'guerra': 'War', 'faroeste': 'Western', 'história': 'History', 'historia': 'History' };
  for (const [k, g] of Object.entries(gmap)) if (t.includes(k)) { p.want.add(g); p.signals.push(`gênero ${k}`); }
  if (has('cansad', 'exaust', 'relax', 'tranquil', 'leve', 'sono', 'descansar')) { p.light++; LIGHT_GENRES.forEach(g => p.want.add(g)); p.signals.push('energia baixa → leve'); }
  if (has('animad', 'energia', 'adrenalina', 'agitad', 'intens', 'eletrizante')) { INTENSE_GENRES.forEach(g => p.want.add(g)); p.signals.push('energia alta → intenso'); }
  if (has('triste', 'depre', 'chorar', 'pra baixo', 'para baixo', ' mal', 'desanim')) { ['Comedy', 'Romance', 'Animation'].forEach(g => p.want.add(g)); p.avoid.add('Horror'); p.signals.push('astral baixo → para cima'); }
  if (has('ansios', 'estress', 'preocupad', 'nervos', 'tens')) { p.light++; ['Comedy', 'Animation'].forEach(g => p.want.add(g)); p.avoid.add('Horror'); p.signals.push('tensão → leve'); }
  if (has('chuv', 'frio', 'nublado', 'cobertor', 'sofá', 'sofa', 'preguiça', 'preguica')) { COZY_GENRES.forEach(g => p.want.add(g)); p.signals.push('clima aconchegante'); }
  if (has('calor', ' sol', 'sol ', 'praia', 'verão', 'verao')) { ['Adventure', 'Action', 'Comedy'].forEach(g => p.want.add(g)); p.signals.push('calor → aventura'); }
  if (has('medo', 'assustar', 'coragem')) { ['Thriller', 'Mystery'].forEach(g => p.want.add(g)); p.signals.push('clima de suspense'); }
  if (has('comendo', 'comer', 'pipoca', 'janta', 'almoç', 'almoc', 'lanche', 'pizza', 'jantar')) { p.maxRuntime = 140; p.light++; ['Comedy', 'Adventure', 'Animation'].forEach(g => p.want.add(g)); p.signals.push('comendo → até ~2h20 e leve'); }
  if (has('criança', 'crianca', 'filho', 'filha', 'família', 'familia', 'kids')) { ['Animation', 'Family', 'Comedy'].forEach(g => p.want.add(g)); p.signals.push('em família'); }
  let h = new Date().getHours();
  if (has('manhã', 'manha', 'café da manhã', 'cafe da manha')) h = 9;
  else if (has('madrugada')) h = 1;
  else if (has('tarde')) h = 15;
  else if (has('noite')) h = 21;
  if (h >= 0 && h < 6) { p.maxRuntime = Math.min(p.maxRuntime ?? 150, 150); p.light++; p.signals.push('madrugada → nada muito longo'); }
  else if (h < 12) p.signals.push('período da manhã');
  else if (h < 18) p.signals.push('período da tarde');
  else p.signals.push('período da noite');
  return { ...p, hour: h };
}
function scoreItem(it, p) {
  let s = (it.rating || 0) * 2;
  const gs = it.genres || [];
  for (const g of gs) {
    if (p.want.has(g)) s += 3;
    if (p.avoid.has(g)) s -= 6;
  }
  const wantsIntense = [...p.want].some(g => INTENSE_GENRES.includes(g));
  if (p.light > 0 && !wantsIntense && gs.some(g => INTENSE_GENRES.includes(g))) s -= 4;
  if (p.maxRuntime && it.runtime) s += it.runtime <= p.maxRuntime ? 1 : -4;
  if (it.year && it.year >= new Date().getFullYear() - 3) s += 1;
  return s;
}
async function loadAssistant() {
  const text = (state.moodText || '').trim();
  const p = analyzeMood(text);
  state.moodProfile = p;
  const box = $('#moodSummary');
  if (box) {
    if (!text) box.classList.add('hidden');
    else {
      box.classList.remove('hidden');
      box.innerHTML = `<strong>Entendi seu momento:</strong> ${p.signals.length ? p.signals.join(' • ') : 'sem sinais claros — misturei os bem avaliados'}<br><small>Ordenei por compatibilidade (gênero + nota + duração).</small>`;
    }
  }
  if (!text) return [];
  let pool = [];
  if (state.tmdbKey) {
    const d = await tmdb('/trending/all/week', { page: 1 });
    pool = d.results.filter(x => x.media_type === 'movie' || x.media_type === 'tv').map(tmdbToItem);
  } else {
    const [base, recent, ytsRaw] = await Promise.all([
      tvmazeBaseShows().catch(() => []),
      tvmazeRecentShows().catch(() => []),
      (async () => {
        const b = await Promise.all([1, 2].map(pg => ytsFetch({ limit: 50, page: pg, sort_by: 'like_count', order_by: 'desc', with_rt_ratings: false, minimum_rating: 6 }).catch(() => [])));
        const m = new Map();
        for (const x of b.flat()) if (x && !m.has(x.id)) m.set(x.id, x);
        return [...m.values()];
      })(),
    ]);
    const seen = new Map();
    for (const s of [...base, ...recent]) if (s && !seen.has('tvmaze-' + s.id)) seen.set('tvmaze-' + s.id, tvmazeToItem(s));
    for (const m of ytsRaw) seen.set('yts-' + m.id, ytsToItem(m));
    pool = [...seen.values()];
  }
  pool = pool.filter(it => state.type === 'all' || it.type === state.type);
  return pool.map(it => ({ it, s: scoreItem(it, p) })).sort((a, b) => b.s - a.s).slice(0, 24).map(x => x.it);
}

// ---------- orquestração ----------
async function load(reset = true) {
  if (reset) { state.page = 1; state.items = []; state.shown = 0; state.view = 'all'; paintViewButtons(); state.loadToken = (state.loadToken || 0) + 1; }
  state.shown = state.perPage; // primeira leva; "carregar mais" aumenta
  $('#cinemaPanel').classList.toggle('hidden', state.tab !== 'nowplaying');
  $('#assistantPanel').classList.toggle('hidden', state.tab !== 'assistant');
  if (state.tab === 'nowplaying') {
    if (state.userLoc && !state.cinemas.length) loadCinemas();
    else renderCinemas();
  }
  statusEl.textContent = 'Carregando…';
  try {
    let items = [];
    if (state.tab === 'assistant') {
      items = await loadAssistant();
    } else if (state.tmdbKey) {
      items = await loadTMDB();
    } else {
      const wantMovies = state.type === 'all' || state.type === 'movie';
      const wantSeries = state.type === 'all' || state.type === 'series';
      const [movies, series] = await Promise.all([
        wantMovies ? loadMoviesFree().catch(() => []) : Promise.resolve([]),
        wantSeries ? loadSeriesFree().catch(() => []) : Promise.resolve([]),
      ]);
      items = [...movies, ...series];
      if (!items.length) throw new Error('empty');
    }
    state.items = state.page === 1 ? items : [...state.items, ...items];
    // remove duplicados entre páginas (YTS busca multi-página p/ filtro de ano)
    {
      const seen = new Map();
      for (const it of state.items) if (!seen.has(it.key)) seen.set(it.key, it);
      state.items = [...seen.values()];
    }
    state.filtered = state.items;
    render();
    // Cobertura ampliada do ano (séries, modo grátis): grade semanal em 2º plano,
    // sem travar a lista inicial. Vale p/ ano único (de=até=X, ou só um lado).
    const enrichYear = state.yearMin && (!state.yearMax || state.yearMax === state.yearMin) ? +state.yearMin
      : (!state.yearMin && state.yearMax ? +state.yearMax : null);
    if (!state.tmdbKey && enrichYear && state.tab !== 'search' && state.type !== 'movie') {
      enrichYearWeeklies(enrichYear, state.loadToken).catch(() => {});
    }
  } catch (e) {
    console.error(e);
    statusEl.textContent = state.tmdbKey
      ? 'Falha no TMDB. Confira sua chave ou tente sem chave (TVMaze+YTS).'
      : 'Falha ao carregar. Verifique sua internet e tente de novo (YTS pode oscilar; séries via TVMaze continuam).';
  }
}

// ---------- eventos ----------
function bind() {
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    state.tab = b.dataset.tab;
    load(true);
  }));
  $('#typeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    document.querySelectorAll('#typeSeg button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    state.type = b.dataset.type;
    load(true);
  });
  $('#searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    state.query = $('#searchInput').value.trim();
    document.querySelectorAll('.tabs button').forEach(x => x.classList.remove('active'));
    document.querySelector('[data-tab="search"]').classList.add('active');
    state.tab = 'search';
    load(true);
  });
  for (const [id, key] of [['yearMin','yearMin'],['yearMax','yearMax'],['sortFilter','sort']]) {
    $('#' + id).addEventListener('change', (e) => {
      state[key] = e.target.value;
      // Ano/gênero mudam o lote da API no modo sem chave (YTS multi-página,
      // TVMaze páginas recentes), então sempre recarrega. Ordenação é só local.
      if (key === 'sort') { state.shown = state.perPage; render(); return; }
      load(true);
    });
  }
  $('#clearFilters').addEventListener('click', () => {
    state.yearMin = state.yearMax = ''; state.sort = 'rating_desc';
    $('#yearMin').value = ''; $('#yearMax').value = ''; $('#sortFilter').value = 'rating_desc';
    load(true);
  });
  loadMoreBtn.addEventListener('click', async () => {
    state.shown += state.perPage;
    // tenta paginar na fonte quando chegar ao fim
    const listLen = applyClientFilters(currentBase()).length;
    if (state.shown >= listLen && (state.tmdbKey || state.type !== 'series')) {
      state.page += 1;
      statusEl.textContent = 'Carregando mais…';
      try {
        const more = state.tmdbKey ? await loadTMDB() : await loadMoviesFree();
        state.items = [...state.items, ...more];
        state.filtered = state.items;
        state.shown += 0;
      } catch {}
    }
    render();
  });

  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') $('#modal').classList.add('hidden'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#modal').classList.add('hidden'); });

  $('#favBtn').addEventListener('click', () => setView('favs'));
  $('#watchedBtn').addEventListener('click', () => setView('watched'));
  $('#watchingBtn').addEventListener('click', () => setView('watching'));
  $('#chipRow').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const ta = $('#moodInput');
    ta.value = (ta.value ? ta.value.replace(/\s+$/, '') + ' ' : '') + b.textContent.trim() + ' ';
    ta.focus();
  });
  $('#suggestBtn').addEventListener('click', () => {
    state.moodText = $('#moodInput').value;
    document.querySelectorAll('.tabs button').forEach(x => x.classList.remove('active'));
    document.querySelector('[data-tab="assistant"]').classList.add('active');
    state.tab = 'assistant';
    load(true);
  });
  if (state.userLoc?.label && state.userLoc.label !== 'Sua localização') $('#cityInput').value = state.userLoc.label;
  $('#locForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('#cityInput').value.trim();
    if (!q) return;
    $('#cinemaStatus').textContent = `Localizando ${q}…`;
    try { state.userLoc = await geocodeCity(q); saveLoc(); loadCinemas(); }
    catch { $('#cinemaStatus').textContent = 'Cidade não encontrada. Tente "Cidade, UF" ou coordenadas "-23.55, -46.63".'; }
  });
  $('#geoBtn').addEventListener('click', () => {
    if (!navigator.geolocation) { $('#cinemaStatus').textContent = 'Geolocalização indisponível: digite sua cidade.'; return; }
    $('#cinemaStatus').textContent = 'Pedindo sua localização…';
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude: lat, longitude: lon } = pos.coords;
      const city = await reverseCity(lat, lon).catch(() => '');
      state.userLoc = { lat, lon, label: city || 'Sua localização' };
      $('#cityInput').value = city || '';
      saveLoc(); loadCinemas();
    }, () => { $('#cinemaStatus').textContent = 'Permissão negada. Digite sua cidade ou ative o GPS.'; }, { timeout: 15000 });
  });

  $('#modalClose').addEventListener('click', () => $('#modal').classList.add('hidden'));
}

setupFilters();
bind();
updateCounts();
load(true);
