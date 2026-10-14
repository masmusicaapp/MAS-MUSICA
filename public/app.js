'use strict';

/* ================= Utilidades ================= */
const $  = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const pad2 = n => String(n).padStart(2, '0');
const toMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
const toHHMM = m => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
const dateFromStr = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const addDaysStr = (s, n) => { const d = dateFromStr(s); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const fmtDate = (s, opts) => dateFromStr(s).toLocaleDateString('es-ES', opts || { weekday: 'long', day: 'numeric', month: 'long' });
const fmtMoney = n => {
  const num = Math.round(Number(n) || 0);
  const txt = String(Math.abs(num)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return state.settings.currency + (num < 0 ? '-' : '') + txt;
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Limpia un @usuario de red social para armar un enlace seguro (solo letras, números, . _ -) */
const limpiarIdentRed = v => String(v || '').trim().replace(/^@+/, '').replace(/[^A-Za-z0-9._-]/g, '');
/* Solo permite enlaces web (http/https): bloquea javascript:, data: y otros esquemas en href */
const urlSegura = s => {
  const u = String(s || '').trim();
  return /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : '';
};

/* ---------- Bandas ---------- */
const ETIQUETA_FORMATO = { vertical: 'vertical 3:4', horizontal: 'horizontal 4:3', cuadrado: 'cuadrado 1:1' };
const bandas = () => state.bands || [];
const bandaPorNombre = nombre => bandas().find(b =>
  b.nombre.trim().toLowerCase() === String(nombre || '').trim().toLowerCase());

/* Reduce la imagen del logo de la sala antes de subirla */
function comprimirImagen(file, maxLado = 420) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error('No es una imagen'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Imagen inválida'));
      img.onload = () => {
        const e = Math.min(1, maxLado / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * e));
        const h = Math.max(1, Math.round(img.height * e));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        if (/jpe?g/i.test(file.type)) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
const ahoraMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

/* ================= Capa de API ================= */
let state = null;              // estado compartido (viene del servidor)
let adminPin = '';             // PIN de sesión (no se guarda ni se descarga del servidor)
let adminMode = false;
let currentAdminTab = 'reservas';
let currentLugarTab = 'instrumentos'; // pestaña activa en "Instrumentos y lugar"
let navActual = 'inicio';             // opción activa de la barra inferior

/* Reservas del día (panel de administración) */
let adminResDate = '';        // 'YYYY-MM-DD' ('' = hoy)
let adminResFiltro = -1;      // -1 = todas las salas · 0.. = índice de sala
let adminResPidiendo = '';    // id de reserva en confirmación de cancelación
const ADMIN_RC = ['var(--rc0)', 'var(--rc1)', 'var(--rc2)', 'var(--rc3)', 'var(--rc4)', 'var(--rc5)'];
function colorRoom(room) {
  if (!room) return 'var(--accent)';
  const i = state.rooms.findIndex(x => x.id === room.id);
  return ADMIN_RC[((i % ADMIN_RC.length) + ADMIN_RC.length) % ADMIN_RC.length];
}

const MINE_KEY = 'reservas_salas_mine_v1'; // IDs de reservas hechas desde este dispositivo
let mineIds = [];
try { mineIds = JSON.parse(localStorage.getItem(MINE_KEY) || '[]'); } catch (e) { mineIds = []; }

/* El panel de administración SOLO se muestra en dispositivos donde el
   administrador ya	validó su PIN (así los clientes no lo ven).
   Para entrar la primera vez: doble toque en el logo o abrir con #admin */
const ADMIN_KEY = 'mas_musica_admin_device_v1';
function esDispositivoAdmin() {
  try { return localStorage.getItem(ADMIN_KEY) === '1'; } catch (e) { return false; }
}
function marcarDispositivoAdmin() {
  try { localStorage.setItem(ADMIN_KEY, '1'); } catch (e) { /* modo privado */ }
}
function olvidarDispositivoAdmin() {
  try { localStorage.removeItem(ADMIN_KEY); } catch (e) { /* modo privado */ }
}

/* ================= Sesión y roles ================= */
const TOKEN_KEY = 'mas_musica_token_v1';
let token = '';
try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { token = ''; }

let yo = null;          /* cuenta conectada (null = visitante) */
let miSala = null;      /* sala del dueño de la cuenta (ROOM_ADMIN) */
let notificaciones = [];
let sinLeer = 0;

const esMúsico = () => !!yo && yo.rol === 'USER';
const esDueño = () => !!yo && yo.rol === 'ROOM_ADMIN';
const esSuper = () => !!yo && yo.rol === 'SUPER_ADMIN';
/* Cuentas de control (administrador y dueño de sala): solo control, sin integrantes, instrumentos ni favoritas */
const esCuentaControl = () => esDueño() || esSuper();

function guardarToken(t) {
  token = t || '';
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) { /* modo privado */ }
}

/* Salas que se publican: aprobadas y activas */
const salasPublicas = () => (state.rooms || []).filter(r => r.activo !== false && r.estado === 'aprobada');
const esFavorita = id => !!(yo && (yo.favoritos || []).includes(id));

async function api(path, { method = 'GET', body, admin = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (admin && adminPin) headers['x-admin-pin'] = adminPin;
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch (e) { /* sin cuerpo */ }
  if (!res.ok) throw new Error(data.error || `Error de conexión (${res.status})`);
  return data;
}

/* ================= Disponibilidad (UX local; el servidor es la autoridad) ================= */
const overlap = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;

/* Horario de atención: el propio de la sala si tiene, si no el general */
function horasDelDia(dateStr, roomId) {
  const wd = String(dateFromStr(dateStr).getDay());
  if (roomId) {
    const r = state.rooms.find(x => x.id === roomId);
    if (r && r.horario && (r.horarioPropio || Object.values(r.horario).some(Boolean))) {
      return r.horario[wd] || null;
    }
  }
  return state.settings.hours[wd] || null;
}

/* Duración de los turnos de la sala */
function pasoDe(roomId) {
  const r = state.rooms.find(x => x.id === roomId);
  return [30, 60, 90, 120].includes(r && r.turnoMin) ? r.turnoMin : 60;
}

function slotsFor(dateStr, roomId) {
  const h = horasDelDia(dateStr, roomId);
  if (!h) return { closed: true, slots: [] };
  const open = toMin(h.open), close = toMin(h.close);
  const paso = pasoDe(roomId);
  const today = todayStr();
  const nowMin = (today === dateStr) ? ahoraMin() : -1;
  const slots = [];
  for (let t = open; t + paso <= close; t += paso) {
    const start = toHHMM(t), end = toHHMM(t + paso);
    let status = 'available', ref = null;
    if (dateStr < today || (today === dateStr && t <= nowMin)) {
      status = 'past';
    } else {
      const res = state.reservations.find(r =>
        r.roomId === roomId && r.date === dateStr && (r.estado || 'confirmada') !== 'cancelada' &&
        overlap(t, t + paso, toMin(r.start), toMin(r.end)));
      if (res) { status = 'reserved'; ref = res; }
      else {
        const blk = state.blocks.find(b =>
          b.roomId === roomId && b.date === dateStr &&
          overlap(t, t + paso, toMin(b.from), toMin(b.to)));
        if (blk) { status = 'blocked'; ref = blk; }
      }
    }
    slots.push({ start, end, status, ref });
  }
  return { closed: false, slots };
}

function rangoDisponible(dateStr, roomId, startMin, endMin, excludeId) {
  if (dateStr < todayStr() || endMin <= startMin) return false;
  const { closed, slots } = slotsFor(dateStr, roomId);
  if (closed) return false;
  const paso = pasoDe(roomId);
  for (let t = startMin; t < endMin; t += paso) {
    const s = slots.find(x => toMin(x.start) === t);
    if (!s) return false;
    const libre = s.status === 'available' || (excludeId && s.ref && s.ref.id === excludeId);
    if (!libre) return false;
  }
  return true;
}

function horasConsecutivas(dateStr, roomId, startMin, excludeId) {
  const { closed, slots } = slotsFor(dateStr, roomId);
  if (closed) return 0;
  const paso = pasoDe(roomId);
  let h = 0;
  for (let t = startMin; ; t += paso) {
    const s = slots.find(x => toMin(x.start) === t);
    if (!s) break;
    const libre = s.status === 'available' || (excludeId && s.ref && s.ref.id === excludeId);
    if (!libre) break;
    h++;
  }
  return h;
}

const horasDe = r => Math.max(1, Math.round((toMin(r.end) - toMin(r.start)) / 60));

const precioReserva = r => {
  const room = state.rooms.find(x => x.id === r.roomId);
  return horasDe(r) * (room ? room.price : 0);
};

const esPasada = r => r.date < todayStr() || (r.date === todayStr() && toMin(r.end) <= ahoraMin());

/* ================= Vista pública ================= */
let curStep = 1;
const sel = { date: null, roomId: null, range: null, slot: null, bandaNombre: '' };
let calCursor = todayStr().slice(0, 7);
let filtroSalas = 'todas';   /* 'todas' | 'favoritas' */

function goStep(n) {
  curStep = n;
  for (let i = 1; i <= 4; i++) $('#step-' + i).hidden = i !== n;
  /* "Mis reservas" solo acompaña a la vista de Salas (pasos 2-4); en el Inicio se oculta */
  $('#home-mine').hidden = n === 1;
  renderMineRapido();
  if (n === 1) renderResumenInicio();
  renderSalasStrip();   /* logo de la sala actual en la esquina */
}

/* ---------- Acceso rápido a Mis reservas desde el inicio ---------- */
/* Reservas de esta cuenta: las de este dispositivo + las vinculadas al usuario */
const misReservas = () => state.reservations.filter(r => mineIds.includes(r.id) || (yo && r.userId === yo.id));

function renderMineRapido() {
  const host = $('#home-mine');
  if (!host || host.hidden) return;
  const cuerpo = $('#home-mine-body');
  const mias = misReservas();
  const query = busquedaMine.trim().toLowerCase();
  let lista = query
    ? state.reservations.filter(r => r.name.toLowerCase().includes(query))
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
    : mias.slice().sort((a, b) => {
      const fa = esPasada(a) ? 1 : 0, fb = esPasada(b) ? 1 : 0;
      if (fa !== fb) return fa - fb;
      return fa ? (b.date + b.start).localeCompare(a.date + a.start)
        : (a.date + a.start).localeCompare(b.date + b.start);
    });
  /* Filtro elegido en Ajustes: próximas reservas o historial */
  if (!query && filtroMisReservas === 'proximas') {
    lista = lista.filter(r => !esPasada(r) && r.estado !== 'cancelada');
  } else if (!query && filtroMisReservas === 'historial') {
    lista = lista.filter(r => esPasada(r) || r.estado === 'cancelada');
  }
  const aviso = (!query && filtroMisReservas)
    ? `<div class="filtro-aviso">Mostrando: <strong>${filtroMisReservas === 'proximas' ? 'Próximas reservas' : 'Historial'}</strong>
         <button class="btn btn-sm" id="filtro-mine-clear">Ver todas</button></div>`
    : '';
  if (!lista.length) {
    cuerpo.innerHTML = aviso + `<p class="muted">${query
      ? `No se encontraron reservas con "${esc(busquedaMine)}".`
      : filtroMisReservas === 'proximas' ? 'No tenés reservas próximas. Cuando reserves un horario, aparecerá acá.'
      : filtroMisReservas === 'historial' ? 'Todavía no tenés reservas anteriores.'
           : 'Todavía no tenés reservas. Cuando reserves, aparecerán aquí.'}</p>`;
    return;
  }
  cuerpo.innerHTML = aviso + (query ? `<h3 class="sub">Resultados para "${esc(busquedaMine)}"</h3>` : '')
    + lista.map(r => {
    const room = state.rooms.find(x => x.id === r.roomId);
    const banda = bandaPorNombre(r.name);
    const sala = room ? room.name : 'Sala eliminada';
    const pasada = esPasada(r);
    const cancelada = r.estado === 'cancelada';
    const alq = (r.alquiler || []).length;
    const esMia = mineIds.includes(r.id) || (yo && r.userId === yo.id);
    return `
      <div class="quick-item ${pasada ? 'res-past' : ''} ${cancelada ? 'cancelada' : ''}" data-res="${r.id}" ${banda ? `data-band="${banda.id}"` : ''}>
        ${banda && banda.foto ? `<img class="quick-avatar" src="${esc(banda.foto)}" alt="" data-foto="${esc(banda.foto)}" data-foto-alt="${esc(banda.nombre)}">` : ''}
        <div class="quick-when">
          <strong>${fmtDate(r.date)}</strong>
          <span>🕐 ${r.start} – ${r.end}</span>
        </div>
        <div class="quick-what">
          <strong>${esc(sala)} <span class="badge ${cancelada ? 'badge-past' : pasada ? 'badge-past' : 'badge-next'}">${cancelada ? 'Cancelada' : pasada ? 'Pasada' : r.estado === 'pendiente_pago' ? 'Falta pagar la seña' : 'Próxima'}</span></strong>
          <span class="muted small">${esc(r.name)} · 💰 ${fmtMoney(precioReserva(r))}${alq ? ' · 🎒 ' + alq : ''}</span>
        </div>
        ${(!pasada && !cancelada && esMia) ? `<button class="btn btn-sm btn-danger" data-mine-cancel="${r.id}">Cancelar</button>` : ''}
      </div>`;
  }).join('');
}

/* ---------- Perfil de la banda dentro de Mis reservas ---------- */
/* Tarjeta de perfil: la banda (músico) o la sala (dueño) */
function renderPerfilMine() {
  const host = $('#mine-band-profile');
  if (!host) return;
  if (esDueño() && miSala) return renderPerfilSala();
  const mias = misReservas();
  let banda = null;
  for (const nombre of new Set(mias.map(r => r.name))) {
    banda = bandaPorNombre(nombre);
    if (banda) break;
  }
  if (!banda) {
    host.hidden = false;
    host.innerHTML = `
    <div class="perfil-mini">
      <div class="perfil-avatar-circular perfil-sin-foto">🎭</div>
      <div class="perfil-mini-info">
        <h3>🎭 Registra tu banda</h3>
          <p class="muted small">Registra tu banda para guardar tu logo, sus integrantes y el instrumento que toca cada uno. Todo es opcional.</p>
          <div class="row wrap">
            <button class="btn btn-primary btn-sm" id="bp-new">🎭 Registrar mi banda</button>
          </div>
        </div>
      </div>`;
    host.querySelector('#bp-new').onclick = () => formularioBanda(null);
    return;
  }
  const ints = banda.integrantes || [];
  host.hidden = false;
  host.innerHTML = `
    <div class="perfil-mini">
      ${banda.fotoGrupal ? `<img class="perfil-fondo" src="${esc(banda.fotoGrupal)}" alt="">` : ''}
      ${banda.foto
        ? `<img class="perfil-avatar-circular" src="${esc(banda.foto)}" alt="${esc(banda.nombre)}" data-foto="${esc(banda.foto)}" data-foto-alt="${esc(banda.nombre)}" title="Toca para ver en grande">`
        : '<div class="perfil-avatar-circular perfil-sin-foto">🎭</div>'}
      <div class="perfil-mini-info">
        <h3>${esc(banda.nombre)}</h3>
        <div class="perfil-tags">
          ${banda.genero ? `<span class="tag">🎸 ${esc(banda.genero)}</span>` : ''}
          <span class="tag">👥 ${ints.length} ${ints.length === 1 ? 'integrante' : 'integrantes'}</span>
          ${banda.telefono ? `<span class="tag">📞 ${esc(banda.telefono)}</span>` : ''}
        </div>
        <div class="row wrap perfil-acciones">
          <button class="btn btn-sm" data-band="${banda.id}">Ver perfil completo</button>
          ${banda.fotoGrupal ? `<button class="btn btn-sm" data-foto="${esc(banda.fotoGrupal)}" data-foto-alt="Foto grupal">🖼 Ver foto grupal</button>` : ''}
          <button class="btn btn-sm" id="bp-edit">✏️ Editar perfil</button>
        </div>
      </div>
    </div>`;
  host.querySelector('#bp-edit').onclick = () => formularioBanda(banda.id, () => renderMine());
}

/* El dueño ve su sala como tarjeta de perfil */
function renderPerfilSala() {
  const host = $('#mine-band-profile');
  if (!host || !miSala) return;
  const r = miSala;
  const etq = r.estado === 'aprobada' ? '✅ Aprobada' : r.estado === 'rechazada' ? '✖ Rechazada' : '⏳ En revisión';
  const zona = [r.localidad, r.direccion].filter(Boolean).join(' · ');
  host.hidden = false;
  host.innerHTML = `
    <div class="perfil-mini">
      ${r.foto ? `<img class="perfil-fondo" src="${esc(r.foto)}" alt="">` : ''}
      ${r.foto
        ? `<img class="perfil-avatar-circular" src="${esc(r.foto)}" alt="${esc(r.name)}" data-foto="${esc(r.foto)}" data-foto-alt="${esc(r.name)}" title="Toca para ver en grande">`
        : '<div class="perfil-avatar-circular perfil-sin-foto">🎛️</div>'}
      <div class="perfil-mini-info">
        <h3>${esc(r.name)}</h3>
        <div class="perfil-tags">
          <span class="tag">${etq}</span>
          ${zona ? `<span class="tag">📍 ${esc(zona)}</span>` : ''}
          <span class="tag">💰 ${fmtMoney(r.price)}/h · 👥 ${r.capacity}</span>
        </div>
        <div class="row wrap perfil-acciones">
          <button class="btn btn-sm" id="sp-panel">🎛️ Mi panel de sala</button>
          <button class="btn btn-sm" id="sp-ver">Ver sala</button>
        </div>
      </div>
    </div>`;
  host.querySelector('#sp-panel').onclick = mostrarPanel;
  host.querySelector('#sp-ver').onclick = () => elegirSala(r.id);
}

/* ---------- Sección de integrantes (abajo del perfil) ---------- */
function renderIntegrantesBanda() {
  const host = $('#mine-integrantes');
  if (!host) return;
  /* Los integrantes acompañan al perfil de la banda; en el de la sala no aplican */
  if (esCuentaControl()) { host.hidden = true; host.innerHTML = ''; return; }
  const mias = misReservas();
  let banda = null;
  for (const nombre of new Set(mias.map(r => r.name))) {
    banda = bandaPorNombre(nombre);
    if (banda) break;
  }
  const ints = (banda && banda.integrantes) || [];
  if (!ints.length) { host.hidden = true; host.innerHTML = ''; return; }
  host.hidden = false;
  host.innerHTML = `
    <div class="panel-head">
      <h2>👥 Integrantes y instrumentos</h2>
      <button class="btn btn-sm" data-band="${banda.id}">Ver perfil</button>
    </div>
    <ul class="perfil-lista">
      ${ints.map(m => `
        <li>
          <strong>${esc(m.nombre || 'Sin nombre')}</strong>
          <span>${m.instrumento ? '🎸 ' + esc(m.instrumento) : '<span class="muted">sin instrumento</span>'}</span>
        </li>`).join('')}
    </ul>`;
}

function renderCalendar() {
  const [y, m] = calCursor.split('-').map(Number);
  $('#cal-title').textContent = new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  const grid = $('#cal-grid');
  grid.innerHTML = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá'].map(d => `<div class="cal-h">${d}</div>`).join('');
  const first = new Date(y, m - 1, 1).getDay();
  const days = new Date(y, m, 0).getDate();
  const today = todayStr();
  const max = addDaysStr(today, 60);
  const counts = {};
  state.reservations.forEach(r => { counts[r.date] = (counts[r.date] || 0) + 1; });
  for (let i = 0; i < first; i++) grid.insertAdjacentHTML('beforeend', '<div></div>');
  for (let d = 1; d <= days; d++) {
    const ds = `${calCursor}-${pad2(d)}`;
    const dis = ds < today || ds > max;
    const cls = ['cal-day', ds === sel.date ? 'sel' : '', ds === today ? 'today' : '', dis ? 'dis' : ''].join(' ');
    const badge = counts[ds] ? `<span class="dot">${counts[ds]}</span>` : '';
    grid.insertAdjacentHTML('beforeend',
      `<button class="${cls}" data-date="${ds}" ${dis ? 'disabled' : ''}>${d}${badge}</button>`);
  }
}

function renderRooms() {
  const grid = $('#rooms-grid');
  let rooms = salasPublicas();
  renderSalasStrip();
  pintarBotonFav();
  if (!rooms.length) {
    grid.innerHTML = '<p class="muted">Todavía no hay salas publicadas. Mirá las que están en revisión en el panel de administración.</p>';
    return;
  }
  /* Filtro de favoritas */
  if (filtroSalas === 'favoritas') {
    const favs = rooms.filter(r => esFavorita(r.id));
    if (favs.length) rooms = favs;
    else {
      grid.innerHTML = `<p class="muted">No marcaste ninguna sala como favorita todavía. Tocá el ♥ en una sala para guardarla acá.</p>
        <div class="row"><button class="btn" data-filtro-salas="todas">Ver todas las salas</button></div>`;
      return;
    }
  }
  grid.innerHTML = rooms.map(r => {
    const equ = r.equipos || {};
    const equip = Object.values(equ).filter(Boolean).length;
    return `
    <article class="room-card" data-room="${r.id}">
      <div class="room-top">
        ${r.foto ? `<div class="room-foto"><img src="${esc(r.foto)}" alt="${esc(r.name)}"></div>` : ''}
        <button class="fav-btn ${esFavorita(r.id) ? 'on' : ''}" data-fav="${r.id}" title="Guardar como favorita">${esFavorita(r.id) ? '♥' : '♡'}</button>
      </div>
      <div class="room-info">
        <h3>${esc(r.name)}</h3>
        ${r.localidad || r.direccion ? `<div class="room-ubic">📍 ${esc([r.localidad, r.direccion].filter(Boolean).join(' · '))}</div>` : ''}
        <div class="price">${fmtMoney(r.price)}<span> /hora</span></div>
        <div class="cap">👥 Hasta ${r.capacity} ${r.capacity === 1 ? 'persona' : 'personas'}</div>
      </div>
    </article>`;
  }).join('');
}

/* ---------- Ficha completa de una sala ---------- */
function pintarBotonFav() {
  const b = $('#btn-filtro-fav');
  if (b) b.textContent = filtroSalas === 'favoritas' ? '♥ Favoritas' : '♡ Favoritas';
}

function fichaSala(id) {
  const r = state.rooms.find(x => x.id === id);
  if (!r) return;
  const equ = r.equipos || {};
  const filas = [
    ['🎸 Instrumentos', equ.instrumentos],
    ['🥁 Batería', equ.bateria],
    ['🔊 Amplificadores', equ.amplificadores],
    ['🎤 Micrófonos', equ.microfonos],
    ['🎛️ Consola / sonido', equ.consola],
    ['✨ Otros', equ.otros],
  ].filter(f => f[1]);
  const dias = [1, 2, 3, 4, 5, 6, 0].map(d => {
    const h = horarioSalaDe(r)[String(d)];
    return `<div class="dia-fila"><strong>${['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][d]}</strong><span>${h ? `${h.open} – ${h.close}` : 'Cerrado'}</span></div>`;
  }).join('');
  openModal(`
    <h3>${esc(r.name)}</h3>
    ${r.foto ? `<img class="ficha-logo" src="${esc(r.foto)}" alt="${esc(r.name)}">` : ''}
    <div class="ficha-grid">
      <div><span class="muted">Precio</span><strong>${fmtMoney(r.price)} /hora</strong></div>
      <div><span class="muted">Capacidad</span><strong>Hasta ${r.capacity}</strong></div>
      ${r.telefono ? `<div><span class="muted">Teléfono</span><strong>${esc(r.telefono)}</strong></div>` : ''}
      ${r.localidad ? `<div><span class="muted">Zona</span><strong>${esc(r.localidad)}</strong></div>` : ''}
    </div>
    ${r.direccion ? `<p class="ficha-dir">📍 ${esc(r.direccion)}${linkMapaSala(r) ? ` · <a href="${linkMapaSala(r)}" target="_blank" rel="noopener">ver en el mapa</a>` : ''}</p>` : ''}
    ${r.descripcion ? `<p class="ficha-desc">${esc(r.descripcion)}</p>` : ''}
    ${(r.features || []).length ? `<div class="ficha-chips">${r.features.map(f => `<span class="chip">${esc(f)}</span>`).join('')}</div>` : ''}
    <h4 class="sub">Equipamiento</h4>
    ${filas.length ? filas.map(f => `<div class="dia-fila"><strong>${f[0]}</strong><span>${esc(f[1])}</span></div>`).join('') : '<p class="muted small">Sin detalle de equipamiento.</p>'}
    <h4 class="sub">Horario de atención</h4>
    <div class="dias-fila">${dias}</div>
    <div class="row">
      <button class="btn btn-primary" id="ficha-reservar">Ver horarios →</button>
      <button class="btn" id="ficha-fav">${esFavorita(r.id) ? '♥ Quitar de favoritas' : '♡ Guardar como favorita'}</button>
      <button class="btn" id="ficha-cerrar">Cerrar</button>
    </div>`);
  $('#ficha-cerrar').onclick = closeModal;
  $('#ficha-reservar').onclick = () => { closeModal(); elegirSala(r.id); };
  $('#ficha-fav').onclick = () => { alternarFavorita(r.id); fichaSala(r.id); };
}

/* El horario de la sala para ver en la ficha (propio o general) */
function horarioSalaDe(r) {
  if (r.horario && (r.horarioPropio || Object.values(r.horario).some(Boolean))) return r.horario;
  return state.settings.hours;
}

/* ---------- Favoritas ---------- */
async function alternarFavorita(id) {
  if (!yo) { toast('Iniciá sesión para guardar tus salas favoritas', 'warn'); return; }
  try {
    const data = await api('/api/auth/favoritos', { method: 'PUT', body: { roomId: id } });
    yo = data.user;
    renderRooms();
    renderSalasStrip();
    renderMapa();
    if (!$('#view-mine').hidden) renderPerfil();
    toast(data.favoritos.includes(id) ? 'Sala guardada en favoritas ♥' : 'Sala quitada de favoritas', 'ok');
  } catch (e) {
    toast(e.message, 'error');
  }
}

/* ================= Mapa de salas ================= */
let mapa = null;
let capaMarcas = null;
let marcasSala = {};          /* marcador de cada sala, para abrir su popup desde la lista */
let timerEncuadre = null;     /* encuadre automático pendiente (se cancela si el usuario elige una sala) */
let vistaSalas = 'mapa';      /* el mapa vive en el Inicio */
let miUbicacion = null;        /* [lat, lng] del usuario (si autoriza) */

const tieneUbicacion = r => r && r.lat !== null && r.lat !== undefined && r.lat !== ''
  && r.lng !== null && r.lng !== undefined && r.lng !== ''
  && Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lng));

/* Distancia en kilómetros entre dos puntos */
function distKm(lat1, lng1, lat2, lng2) {
  const R = 6371, rad = d => d * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* Mejor enlace a Google Maps para una sala: sus coordenadas (si las tiene), si no
   el enlace cargado por el dueño, y si no, su dirección. Así el enlace guardado
   a mano (que puede ser genérico) nunca reemplaza al punto exacto de la sala. */
function linkMapaSala(r) {
  if (!r) return '';
  if (tieneUbicacion(r)) return `https://www.google.com/maps/search/?api=1&query=${Number(r.lat)},${Number(r.lng)}`;
  if (urlSegura(r.mapa)) return urlSegura(r.mapa);
  const dir = [r.direccion, r.localidad].filter(Boolean).join(', ');
  return dir ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dir)}` : '';
}

/* ================= MAPA: Google Maps (si hay clave) u OpenStreetMap ================= */
let gmap = null;            /* mapa de Google */
let ginfo = null;           /* ventana de información de Google */
let gmarcadores = [];       /* marcas actuales en Google */
let gmapaFallo = false;     /* la clave de Google no sirvió → seguimos con OpenStreetMap */
let cargandoGoogle = null;  /* promesa de la API de Google */
let huellaMapa = '';        /* qué había dibujado la última vez */

const claveGoogle = () => String((state && state.settings && state.settings.gmapsKey) || '').trim();
const mapaEsGoogle = () => !!gmap && !gmapaFallo;

/* Carga la API de Google Maps sólo si hay clave. Resuelve true si quedó lista. */
function cargarGoogleMaps() {
  if (gmapaFallo) return Promise.resolve(false);
  if (window.google && window.google.maps) return Promise.resolve(true);
  const clave = claveGoogle();
  if (!clave) return Promise.resolve(false);
  if (cargandoGoogle) return cargandoGoogle;
  cargandoGoogle = new Promise(resolve => {
    const listo = ok => { cargandoGoogle = null; resolve(ok); };
    /* Clave inválida o API no habilitada */
    window.gm_authFailure = () => {
      gmapaFallo = true;
      toast('⚠️ La clave de Google Maps no funciona. Se muestra el mapa de OpenStreetMap.', 'warn');
      listo(false);
      /* Si ya estábamos dibujando con Google, volvemos a OpenStreetMap */
      if (gmap) {
        limpiarMapa();
        huellaMapa = '';
        const pane = $('#pane-mapa');
        if (pane && !pane.hidden) renderMapaLeaflet();
      }
    };
    /* La API avisa cuando quedó lista (carga asíncrona) */
    window.__gmapsListo = () => listo(!gmapaFallo && !!(window.google && window.google.maps));
    const s = document.createElement('script');
    s.src = 'https://maps.googleapis.com/maps/api/js?loading=async&language=es&region=AR'
      + '&key=' + encodeURIComponent(clave) + '&callback=__gmapsListo';
    s.async = true;
    s.onerror = () => {
      gmapaFallo = true;
      toast('⚠️ No pude cargar Google Maps. Se muestra el mapa de OpenStreetMap.', 'warn');
      listo(false);
    };
    document.head.appendChild(s);
    /* Por si el callback nunca llega */
    setTimeout(() => { if (cargandoGoogle) listo(!!(window.google && window.google.maps) && !gmapaFallo); }, 15000);
  });
  return cargandoGoogle;
}

/* Deja el contenedor listo para el otro proveedor de mapas */
function limpiarMapa() {
  if (mapa) { try { mapa.remove(); } catch (e) {} mapa = null; capaMarcas = null; }
  if (gmap) { try { google.maps.event.clearInstanceListeners(gmap); } catch (e) {} gmap = null; }
  if (ginfo) { try { ginfo.close(); } catch (e) {} ginfo = null; }
  gmarcadores = [];
  marcasSala = {};
  const cont = $('#mapa');
  if (cont) {
    cont.innerHTML = '';
    cont.classList.remove('leaflet-container', 'leaflet-touch', 'leaflet-retina', 'leaflet-fade-anim', 'leaflet-grab', 'leaflet-grabbing');
    cont.removeAttribute('tabindex');
    delete cont._leaflet_id;
  }
}

/* Ícono circular para Google Maps: logo de la sala (o emoji si no hay foto) */
function iconoCircularGoogle(src, tam, emoji) {
  const px = tam * 2;
  return new Promise(resolve => {
    const c = document.createElement('canvas');
    c.width = c.height = px;
    const g = c.getContext('2d');
    const centro = px / 2, radio = px / 2 - 4;
    const dibujar = img => {
      try {
        g.clearRect(0, 0, px, px);
        g.save();
        g.beginPath();
        g.arc(centro, centro, radio, 0, Math.PI * 2);
        g.closePath();
        g.fillStyle = '#00a038';
        g.fill();
        if (img) {
          const lado = radio * 2;
          const rel = Math.max(lado / img.width, lado / img.height);
          const w = img.width * rel, h = img.height * rel;
          g.clip();
          g.drawImage(img, centro - w / 2, centro - h / 2, w, h);
        } else {
          g.fillStyle = '#fff';
          g.font = 'bold ' + Math.round(radio * 1.05) + 'px sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(emoji || '🎸', centro, centro + 1);
        }
        g.restore();
        g.beginPath();
        g.arc(centro, centro, radio, 0, Math.PI * 2);
        g.lineWidth = 4;
        g.strokeStyle = '#fff';
        g.stroke();
        resolve(c.toDataURL('image/png'));
      } catch (e) { resolve(''); }
    };
    if (!src) return dibujar(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const seguro = setTimeout(() => dibujar(null), 3000);
    img.onload = () => { clearTimeout(seguro); dibujar(img); };
    img.onerror = () => { clearTimeout(seguro); dibujar(null); };
    img.src = src;
  });
}

function initMapa() {
  if (mapa) return mapa;
  const cont = $('#mapa');
  if (!cont || !window.L) return null;
  if (gmap) limpiarMapa();   /* estábamos con Google Maps */
  const conLugares = (state.rooms || []).filter(tieneUbicacion);
  const inicial = conLugares.length ? [Number(conLugares[0].lat), Number(conLugares[0].lng)] : [-31.4201, -64.1888];
  mapa = L.map(cont, { zoomControl: true, scrollWheelZoom: false })
    .setView(inicial, conLugares.length ? 12 : 4);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap',
  }).addTo(mapa);
  return mapa;
}

/* Foto horizontal de la sala (portada): la principal, si no la primera subida */
function fotoPortadaSala(r) {
  if (r.fotoPortada) return r.fotoPortada;
  const f = (r.fotos || [])[0];
  return f ? f.foto : '';
}

function popupSala(r) {
  const dist = miUbicacion ? ` · a ${distKm(miUbicacion[0], miUbicacion[1], Number(r.lat), Number(r.lng)).toFixed(1)} km` : '';
  const eq = Object.values(r.equipos || {}).filter(Boolean).length;
  const dir = [r.direccion, r.localidad].filter(Boolean).join(' · ');
  const tel = String(r.telefono || '').trim();
  const telHref = tel.replace(/[^0-9+]/g, '');
  const portada = fotoPortadaSala(r);
  /* Enlace a Google Maps: prioriza las coordenadas de la sala */
  const gmaps = linkMapaSala(r);
  return `
    <div class="pop pop-detalle">
      <div class="pop-cover ${portada ? '' : 'sin-foto'}">
        ${portada
          ? `<img class="pop-cover-img" src="${esc(portada)}" alt="Foto de ${esc(r.name)}" data-pop-foto="${esc(portada)}" title="Ver la foto en grande">`
          : '<span>🎸</span>'}
        ${r.foto ? `<img class="pop-logo" src="${esc(r.foto)}" alt="Logo de ${esc(r.name)}">` : '<div class="pop-logo sin-foto">🎸</div>'}
      </div>
      <div class="pop-datos">
        <strong class="pop-nombre">${esc(r.name)}</strong>
        <span class="pop-linea">📍 ${dir ? esc(dir) : 'Dirección sin cargar'}</span>
        ${tel
          ? `<a class="pop-linea pop-tel" href="tel:${esc(telHref)}">📞 ${esc(tel)}</a>`
          : '<span class="pop-linea muted">📞 Teléfono sin cargar</span>'}
        <span class="muted small">${fmtMoney(r.price)}/hora · 👥 ${r.capacity}${dist}${eq ? ` · 🎚 ${eq} elemento(s)` : ''}</span>
        <div class="row pop-acciones">
          <button class="btn btn-primary btn-sm" data-mapa-sala="${r.id}">Ver horarios</button>
          <button class="btn btn-sm" data-mapa-ficha="${r.id}">ℹ️ Ficha</button>
          ${urlSegura(gmaps) ? `<a class="btn btn-sm" href="${urlSegura(gmaps)}" target="_blank" rel="noopener">📍 Google Maps</a>` : ''}
          ${tel ? `<a class="btn btn-sm" href="tel:${esc(telHref)}">📞 Llamar</a>` : ''}
          ${yo ? `<button class="btn btn-sm" data-mapa-fav="${r.id}">${esFavorita(r.id) ? '♥' : '♡'}</button>` : ''}
        </div>
      </div>
    </div>`;
}

function popupReserva(res, sala) {
  const pasada = esPasada(res);
  const dir = [sala.direccion, sala.localidad].filter(Boolean).join(' · ');
  const portada = fotoPortadaSala(sala);
  return `
    <div class="pop pop-detalle">
      ${portada ? `<div class="pop-cover pop-cover-chica"><img class="pop-cover-img" src="${esc(portada)}" alt="Foto de ${esc(sala.name)}" data-pop-foto="${esc(portada)}"></div>` : ''}
      <div class="pop-datos">
        <strong class="pop-nombre">🎸 ${esc(sala.name)}</strong>
        <span class="pop-linea">${fmtDate(res.date)} · ${res.start}–${res.end}</span>
        <span class="pop-linea">${esc(res.name)}</span>
        ${dir ? `<span class="pop-linea muted small">📍 ${esc(dir)}</span>` : ''}
        ${sala.telefono ? `<a class="pop-linea pop-tel small" href="tel:${esc(String(sala.telefono).replace(/[^0-9+]/g, ''))}">📞 ${esc(sala.telefono)}</a>` : ''}
        ${pasada ? '<span class="badge badge-past">Pasada</span>' : '<span class="badge badge-next">Tu reserva</span>'}
        <div class="row pop-acciones">
          <button class="btn btn-primary btn-sm" data-mapa-sala="${sala.id}">Ver sala</button>
          ${!pasada && res.estado !== 'cancelada' ? `<button class="btn btn-sm btn-danger" data-mapa-cancelar="${res.id}">Cancelar</button>` : ''}
        </div>
      </div>
    </div>`;
}

/* ---------- Qué hay dibujado, para no rearmar el mapa si nada cambió ---------- */
function huellaDelMapa() {
  return JSON.stringify([
    salasPublicas().filter(tieneUbicacion).map(r => [r.id, r.lat, r.lng, r.foto, r.name, r.price, r.capacity]),
    salasPublicas().filter(r => !tieneUbicacion(r)).map(r => r.id),
    misReservas().filter(r => r.estado !== 'cancelada').map(r => [r.id, r.roomId, r.date, r.start, r.end, r.estado]),
    miUbicacion,
    claveGoogle(),
  ]);
}

/* ---------- Salas que todavía no tienen punto en el mapa ---------- */
function renderSalasSinUbicacion() {
  const caja = $('#mapa-sin-ubicacion');
  if (!caja) return;
  const sinUbic = salasPublicas().filter(r => !tieneUbicacion(r));
  caja.innerHTML = sinUbic.length ? `
      <h3 class="sub">Salas sin ubicación en el mapa</h3>
      <p class="muted small">${sinUbic.length} sala(s) todavía no tienen punto en el mapa. El dueño lo ubica desde su panel (Mi sala → 🗺 Ubicar en el mapa).</p>
      <div class="ficha-chips">${sinUbic.map(r => `<span class="chip">${esc(r.name)}</span>`).join('')}</div>`
    : '';
}

/* ---------- Lista de salas del mapa (ordenada por cercanía si hay ubicación) ---------- */
function salasOrdenadasParaMapa() {
  if (!state) return [];
  const lista = salasPublicas().slice();
  const dist = r => (miUbicacion && tieneUbicacion(r))
    ? distKm(miUbicacion[0], miUbicacion[1], Number(r.lat), Number(r.lng))
    : Infinity;
  if (miUbicacion) lista.sort((a, b) => (dist(a) - dist(b)) || String(a.name).localeCompare(String(b.name)));
  else lista.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return lista;
}

function renderMapaLista() {
  const caja = $('#mapa-lista');
  if (!caja || !state) return;
  const salas = salasOrdenadasParaMapa();
  const btn = $('#mapa-hoja-btn');
  const hoja = $('#mapa-hoja');
  if (!salas.length) {
    caja.innerHTML = '';
    if (btn) btn.hidden = true;
    if (hoja) hoja.classList.remove('abierta');
    const cuerpoVacio = $('#mapa-hoja-cuerpo');
    if (cuerpoVacio) cuerpoVacio.style.maxHeight = '0px';
    return;
  }
  if (btn) {
    btn.hidden = false;
    btn.setAttribute('aria-label', `Ver salas (${salas.length})`);
    btn.title = `Deslizá para ver las ${salas.length} salas`;
  }
  caja.innerHTML = `
    <div class="mapa-lista-head">
      <h3 class="sub">${miUbicacion ? '📍 Salas más cercanas a vos' : '🗺 Todas las salas'}</h3>
      <div class="mapa-lista-ctrl">
        <span class="mapa-indice" id="mapa-indice">1 / ${salas.length}</span>
        <button type="button" class="mapa-flecha" id="mapa-prev" aria-label="Sala anterior" title="Anterior">‹</button>
        <button type="button" class="mapa-flecha" id="mapa-next" aria-label="Sala siguiente" title="Siguiente">›</button>
      </div>
    </div>
    <div class="mapa-lista-items" aria-label="Salas (deslizá de costado)">
      ${salas.map(r => {
        const ubic = tieneUbicacion(r);
        const km = (miUbicacion && ubic)
          ? distKm(miUbicacion[0], miUbicacion[1], Number(r.lat), Number(r.lng))
          : null;
        const dir = [r.direccion, r.localidad].filter(Boolean).join(' · ');
        const enlace = linkMapaSala(r);
        return `
        <article class="mapa-item${ubic ? '' : ' sin-punto'}"${ubic ? ` data-mapa-item="${esc(r.id)}"` : ''}>
          <div class="mapa-item-foto">${r.foto ? `<img src="${esc(r.foto)}" alt="">` : '<span>🎸</span>'}</div>
          <div class="mapa-item-info">
            <div class="mapa-item-head">
              <strong>${esc(r.name)}</strong>
              ${km != null ? `<span class="mapa-item-dist" title="Distancia desde tu ubicación">${km.toFixed(1)} km</span>` : ''}
            </div>
            <span class="mapa-item-dir muted small">📍 ${esc(dir || 'Sin dirección')}</span>
            <div class="mapa-item-meta">
              <span class="chip">💵 ${fmtMoney(r.price)}/hora</span>
              <span class="chip">👥 hasta ${esc(String(r.capacity))}</span>
              ${ubic ? '' : '<span class="chip chip-alt">Sin punto en el mapa</span>'}
            </div>
          </div>
          <div class="mapa-item-acciones">
            ${ubic ? `<button class="btn btn-sm btn-primary" data-mapa-ver="${esc(r.id)}">🗺 Ver en el mapa</button>` : ''}
            <button class="btn btn-sm" data-mapa-ficha="${esc(r.id)}">ℹ️ Ficha</button>
            ${enlace ? `<a class="btn btn-sm" href="${enlace}" target="_blank" rel="noopener">📍 Google Maps</a>` : ''}
          </div>
        </article>`;
      }).join('')}
    </div>`;
  if (window.matchMedia('(min-width: 960px)').matches) prepararCarruselDesktop();
}

/* ---------- Carrusel horizontal de salas (solo escritorio) ---------- */

/* En pantallas anchas arma cada tarjeta con la foto + datos arriba y los
   botones abajo, y conecta flechas, rueda del mouse y arrastre */
function prepararCarruselDesktop() {
  const track = document.querySelector('#mapa-lista .mapa-lista-items');
  if (!track) return;
  track.querySelectorAll('.mapa-item').forEach(art => {
    const foto = art.querySelector('.mapa-item-foto');
    const info = art.querySelector('.mapa-item-info');
    if (!foto || !info || art.querySelector('.mapa-item-top')) return;
    const top = document.createElement('div');
    top.className = 'mapa-item-top';
    art.insertBefore(top, foto);
    top.appendChild(foto);
    top.appendChild(info);
  });
  const prev = $('#mapa-prev');
  const next = $('#mapa-next');
  if (prev) prev.onclick = () => moverCarrusel(-1);
  if (next) next.onclick = () => moverCarrusel(1);
  conectarBotonSalas();
  carruselMapaDrag();
  actualizarCarrusel(track);
  let t = null;
  track.addEventListener('scroll', () => {
    if (t) return;
    t = setTimeout(() => { t = null; actualizarCarrusel(track); }, 80);
  });
}

/* Botón "ocultar / mostrar" la lista de salas (solo escritorio) */
function conectarBotonSalas() {
  const tog = $('#mapa-lista-toggle');
  if (!tog || tog._ok) return;
  tog._ok = true;
  tog.onclick = () => {
    const oculta = document.body.classList.toggle('salas-oculta');
    actualizarBotonSalas();
    if (!oculta) {
      const track = document.querySelector('#mapa-lista .mapa-lista-items');
      setTimeout(() => { if (track) actualizarCarrusel(track); }, 360);
    }
  };
  actualizarBotonSalas();
}

function actualizarBotonSalas() {
  const tog = $('#mapa-lista-toggle');
  if (!tog) return;
  const oculta = document.body.classList.contains('salas-oculta');
  tog.textContent = oculta ? '🗒️' : '✕';
  const txt = oculta ? 'Mostrar la lista de salas' : 'Ocultar la lista de salas';
  tog.title = txt;
  tog.setAttribute('aria-label', txt);
}

/* Arrastre con el mouse: la tira sigue al cursor y al soltar encaja sola
   en la tarjeta más cercana (en el celular el desplazamiento es nativo) */
function carruselMapaDrag() {
  const track = document.querySelector('#mapa-lista .mapa-lista-items');
  if (!track || track._carruselOk) return;
  track._carruselOk = true;
  let drag = null;

  track.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') return;   /* el dedo usa el scroll nativo */
    if (e.button !== 0) return;
    if (e.target.closest('button, a')) return;
    drag = { x: e.clientX, sl: track.scrollLeft, movido: false };
    track._carruselMovido = false;
    track.style.scrollSnapType = 'none';   /* que siga al cursor sin saltar */
    track.style.cursor = 'grabbing';
    try { track.setPointerCapture(e.pointerId); } catch (err) {}
  });

  track.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = drag.x - e.clientX;
    if (Math.abs(dx) > 5) drag.movido = true;
    track.scrollLeft = drag.sl + dx;   /* la tira acompaña al mouse */
  });

  const soltar = e => {
    if (!drag) return;
    const movido = drag.movido;
    drag = null;
    track.style.cursor = '';
    try { track.releasePointerCapture(e.pointerId); } catch (err) {}
    track._carruselMovido = movido;
    encajarCarrusel(track);
    track.style.scrollSnapType = '';   /* vuelve el encaje suave */
  };
  track.addEventListener('pointerup', soltar);
  track.addEventListener('pointercancel', soltar);

  /* La rueda del mouse desliza la tira de costado */
  track.addEventListener('wheel', e => {
    if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;  /* scroll horizontal nativo */
    const antes = track.scrollLeft;
    track.scrollLeft = antes + e.deltaY;
    if (track.scrollLeft !== antes) e.preventDefault();
  }, { passive: false });

  /* Si veníamos de arrastrar, ese clic no abre la sala */
  track.addEventListener('click', e => {
    if (track._carruselMovido) {
      track._carruselMovido = false;
      e.stopPropagation();
      e.preventDefault();
    }
  });
}

/* Centra la tira en una tarjeta */
function centrarEnTarjeta(track, card) {
  const t = track.getBoundingClientRect();
  const c = card.getBoundingClientRect();
  const destino = track.scrollLeft + (c.left - t.left) - (track.clientWidth - c.width) / 2;
  const max = Math.max(0, track.scrollWidth - track.clientWidth);
  track.scrollLeft = Math.max(0, Math.min(max, destino));
}

/* Devuelve la tarjeta más cercana al centro (índice 0-based) */
function posicionCarrusel(track) {
  const cards = Array.from(track.querySelectorAll('.mapa-item'));
  const n = cards.length;
  if (!n) return { idx: 0, n: 0 };
  const t = track.getBoundingClientRect();
  const centro = t.left + t.width / 2;
  let idx = 0, min = Infinity;
  cards.forEach((c, i) => {
    const r = c.getBoundingClientRect();
    const d = Math.abs((r.left + r.width / 2) - centro);
    if (d < min) { min = d; idx = i; }
  });
  return { idx, n };
}

/* Encaja la tira en la tarjeta más cercana al centro */
function encajarCarrusel(track) {
  const cards = Array.from(track.querySelectorAll('.mapa-item'));
  if (!cards.length) return;
  const { idx } = posicionCarrusel(track);
  centrarEnTarjeta(track, cards[idx]);
  actualizarCarrusel(track);
}

/* Pinta el contador "n / N" y habilita/deshabilita las flechas */
function pintarCarrusel(idx, n) {
  const ind = $('#mapa-indice');
  if (ind && n) ind.textContent = (idx + 1) + ' / ' + n;
  const prev = $('#mapa-prev');
  const next = $('#mapa-next');
  if (prev) prev.disabled = idx <= 0;
  if (next) next.disabled = idx >= n - 1;
}

function actualizarCarrusel(track) {
  const p = posicionCarrusel(track);
  pintarCarrusel(p.idx, p.n);
  return p;
}

/* Pasa de a una sala con las flechas ‹ › */
function moverCarrusel(dir) {
  const track = document.querySelector('#mapa-lista .mapa-lista-items');
  if (!track) return;
  const cards = Array.from(track.querySelectorAll('.mapa-item'));
  if (!cards.length) return;
  const { idx, n } = posicionCarrusel(track);
  const nuevo = Math.max(0, Math.min(n - 1, idx + dir));
  centrarEnTarjeta(track, cards[nuevo]);
  pintarCarrusel(nuevo, n);
}

/* Lleva la tira hasta la tarjeta de una sala (al tocar su marcador) */
function irACarruselSala(id) {
  const track = document.querySelector('#mapa-lista .mapa-lista-items');
  if (!track) return;
  const card = track.querySelector('[data-mapa-item="' + CSS.escape(String(id)) + '"]');
  if (!card) return;
  centrarEnTarjeta(track, card);
  actualizarCarrusel(track);
}

/* Centra el mapa en una sala de la lista y abre su ficha en el popup */
function verSalaEnMapa(id) {
  const r = (state.rooms || []).find(x => x.id === id);
  if (!r || !tieneUbicacion(r)) return;
  const punto = [Number(r.lat), Number(r.lng)];
  centrarMapa(punto, 15);
  if (mapaEsGoogle()) { if (gmap) abrirVentanaInfo(popupSala(r)); return; }
  if (marcasSala[id]) { try { marcasSala[id].openPopup(); } catch (e) {} }
  irACarruselSala(id);
}

/* ---------- Ventana de información de Google (mismo contenido que los popups) ---------- */
function abrirVentanaInfo(html) {
  if (!ginfo || !gmap) return;
  const caja = document.createElement('div');
  caja.innerHTML = html;
  caja.onclick = accionesMapa;
  ginfo.setContent(caja);
  ginfo.open({ map: gmap });
}

/* Cierra el popup del mapa, sea cual sea el proveedor */
function cerrarPopupMapa() {
  if (ginfo) { try { ginfo.close(); } catch (e) {} }
  if (mapa && mapa.closePopup) { try { mapa.closePopup(); } catch (e) {} }
}

/* Acciones dentro de los popups (tanto Leaflet como Google) */
function accionesMapa(e) {
  const lista = e.target.closest('[data-ir-lista]');
  if (lista) { e.preventDefault(); return irSalas(); }
  const foto = e.target.closest('[data-pop-foto]');
  if (foto) { e.preventDefault(); return verFoto(foto.dataset.popFoto, 'Foto de la sala'); }
  const ver = e.target.closest('[data-mapa-ver]');
  if (ver) { e.preventDefault(); return verSalaEnMapa(ver.dataset.mapaVer); }
  /* Tocar una sala de la lista la muestra en el mapa (salvo que toquen un botón o enlace) */
  if (!e.target.closest('button') && !e.target.closest('a')) {
    const item = e.target.closest('[data-mapa-item]');
    if (item) return verSalaEnMapa(item.dataset.mapaItem);
  }
  const s = e.target.closest('[data-mapa-sala]');
  if (s) { cerrarPopupMapa(); return elegirSala(s.dataset.mapaSala); }
  const fch = e.target.closest('[data-mapa-ficha]');
  if (fch) { cerrarPopupMapa(); return fichaSala(fch.dataset.mapaFicha); }
  const fav = e.target.closest('[data-mapa-fav]');
  if (fav) return alternarFavorita(fav.dataset.mapaFav);
  const cx = e.target.closest('[data-mapa-cancelar]');
  if (cx) { cerrarPopupMapa(); return cancelarReservaMia(cx.dataset.mapaCancelar); }
}

/* ---------- Dibujo del mapa ---------- */
function renderMapa() {
  renderMapaLista();
  const pane = $('#pane-mapa');
  if (!pane || pane.hidden) return;
  if (claveGoogle() && !gmapaFallo) {
    if (window.google && window.google.maps) return renderMapaGoogle();
    /* mientras se carga la API de Google seguimos mostrando OpenStreetMap */
    renderMapaLeaflet();
    cargarGoogleMaps().then(ok => { if (ok && !pane.hidden) renderMapa(); });
    return;
  }
  renderMapaLeaflet();
}

function renderMapaLeaflet() {
  const aviso = $('#mapa-fallback');
  const cont = $('#mapa');
  if (!window.L) {
    if (aviso) aviso.hidden = false;
    if (cont) cont.hidden = true;
    renderSalasSinUbicacion();
    return;
  }
  if (aviso) aviso.hidden = true;
  if (cont) cont.hidden = false;
  const m = initMapa();
  if (!m) return;
  if (capaMarcas) capaMarcas.remove();
  capaMarcas = L.layerGroup().addTo(m);
  marcasSala = {};

  /* 1. Salas publicadas */
  const salas = salasPublicas().filter(tieneUbicacion);
  salas.forEach(r => {
    const icono = L.divIcon({
      className: 'mk-wrap',
      html: `<div class="mk-sala${r.foto ? '' : ' mk-marca'}">${r.foto ? `<img src="${esc(r.foto)}" alt="">` : '<img src="assets/marca-agua-negro.png" alt="">'}</div>`,
      iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -16],
    });
    marcasSala[r.id] = L.marker([Number(r.lat), Number(r.lng)], { icon: icono, title: r.name })
      .addTo(capaMarcas)
      .bindPopup(popupSala(r))
      .on('click', () => irACarruselSala(r.id));
  });

  /* 2. Las reservas del usuario, sobre el lugar de cada sala */
  misReservas().filter(r => r.estado !== 'cancelada').forEach(res => {
    const sala = (state.rooms || []).find(x => x.id === res.roomId);
    if (!sala || !tieneUbicacion(sala)) return;
    const icono = L.divIcon({
      className: 'mk-wrap',
      html: '<div class="mk-res">🎸</div>',
      iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -14],
    });
    L.marker([Number(sala.lat), Number(sala.lng)], { icon: icono, title: 'Tu reserva' })
      .addTo(capaMarcas)
      .bindPopup(popupReserva(res, sala));
  });

  /* 3. Dónde está el usuario: círculo verde con el logo negro */
  if (miUbicacion) {
    const iconoYo = L.divIcon({
      className: 'mk-wrap',
      html: '<div class="mk-yo"><img src="assets/marca-agua-negro.png" alt=""></div>',
      iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -14],
    });
    L.marker(miUbicacion, { icon: iconoYo, zIndexOffset: 900, title: 'Estás acá' })
      .addTo(capaMarcas)
      .bindPopup('<strong>Estás acá</strong>');
  }

  /* 4. Salas sin ubicación + encuadre */
  renderSalasSinUbicacion();
  encuadrarMapa();
  if (timerEncuadre) clearTimeout(timerEncuadre);
  timerEncuadre = setTimeout(() => { if (mapa) { mapa.invalidateSize(); encuadrarMapa(); } }, 140);
}

/* Mapa con Google Maps (cuando hay clave válida) */
async function renderMapaGoogle() {
  const aviso = $('#mapa-fallback');
  const cont = $('#mapa');
  const huella = huellaDelMapa();
  if (gmap && huella === huellaMapa) {
    /* nada cambió: no rearmamos nada (así no se pierde el lugar que miraba el usuario) */
    try { google.maps.event.trigger(gmap, 'resize'); } catch (e) {}
    return;
  }
  if (aviso) aviso.hidden = true;
  if (cont) cont.hidden = false;
  try {
    if (!gmap) {
      if (mapa) limpiarMapa();   /* estábamos con OpenStreetMap */
      const conLugares = (state.rooms || []).filter(tieneUbicacion);
      const inicial = conLugares.length
        ? { lat: Number(conLugares[0].lat), lng: Number(conLugares[0].lng) }
        : { lat: -31.4201, lng: -64.1888 };
      gmap = new google.maps.Map(cont, {
        center: inicial,
        zoom: conLugares.length ? 13 : 4,
        language: 'es',
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        rotateControl: false,
        clickableIcons: false,
        gestureHandling: 'greedy',
        scrollwheel: false,
      });
      ginfo = new google.maps.InfoWindow();
    }
    gmarcadores.forEach(x => { try { x.setMap(null); } catch (e) {} });
    gmarcadores = [];

    /* 1. Salas publicadas (logo en un círculo, igual que en OpenStreetMap) */
    const salas = salasPublicas().filter(tieneUbicacion);
    const iconos = await Promise.all(salas.map(r => iconoCircularGoogle(r.foto || 'assets/marca-agua-negro.png', 28, '🎸')));
    if (gmapaFallo || !gmap) return;   /* la clave falló mientras cargaban los íconos */
    salas.forEach((r, i) => {
      const m = new google.maps.Marker({
        map: gmap,
        position: { lat: Number(r.lat), lng: Number(r.lng) },
        title: r.name,
        zIndex: 4,
        icon: iconos[i]
          ? { url: iconos[i], scaledSize: new google.maps.Size(28, 28), anchor: new google.maps.Point(14, 14) }
          : undefined,
      });
      m.addListener('click', () => abrirVentanaInfo(popupSala(r)));
      gmarcadores.push(m);
    });

    /* 2. Reservas del usuario, con 🎸 sobre la sala */
    const iconoRes = await iconoCircularGoogle('', 24, '🎸');
    if (gmapaFallo || !gmap) return;
    misReservas().filter(x => x.estado !== 'cancelada').forEach(res => {
      const sala = (state.rooms || []).find(x => x.id === res.roomId);
      if (!sala || !tieneUbicacion(sala)) return;
      const m = new google.maps.Marker({
        map: gmap,
        position: { lat: Number(sala.lat), lng: Number(sala.lng) },
        title: 'Tu reserva · ' + sala.name,
        zIndex: 6,
        icon: { url: iconoRes, scaledSize: new google.maps.Size(24, 24), anchor: new google.maps.Point(12, 12) },
      });
      m.addListener('click', () => abrirVentanaInfo(popupReserva(res, sala)));
      gmarcadores.push(m);
    });

    /* 3. Dónde está el usuario: círculo verde con el logo negro */
    if (miUbicacion) {
      const iconoYo = await iconoCircularGoogle('assets/marca-agua-negro.png', 12, '');
      if (!gmapaFallo && gmap) {
        const m = new google.maps.Marker({
          map: gmap,
          position: { lat: miUbicacion[0], lng: miUbicacion[1] },
          title: 'Estás acá',
          zIndex: 9,
          icon: { url: iconoYo, scaledSize: new google.maps.Size(24, 24), anchor: new google.maps.Point(12, 12) },
        });
        m.addListener('click', () => abrirVentanaInfo('<div class="pop"><strong>Estás acá</strong></div>'));
        gmarcadores.push(m);
      }
    }

    /* 4. Salas sin ubicación + encuadre */
    renderSalasSinUbicacion();
    huellaMapa = huella;
    encuadrarMapa();
    setTimeout(() => { if (gmap) { try { google.maps.event.trigger(gmap, 'resize'); } catch (e) {} } }, 220);
  } catch (e) {
    console.warn('Google Maps no pudo dibujar el mapa:', e);
    gmapaFallo = true;
    limpiarMapa();
    huellaMapa = '';
    const pane = $('#pane-mapa');
    if (pane && !pane.hidden) renderMapaLeaflet();
  }
}

/* Encuadra el mapa sobre todas las salas publicadas */
function encuadrarMapa() {
  const puntos = salasPublicas().filter(tieneUbicacion).map(r => [Number(r.lat), Number(r.lng)]);
  if (miUbicacion) puntos.push(miUbicacion);
  if (mapaEsGoogle()) {
    if (!gmap || !puntos.length) return;
    if (puntos.length === 1) {
      gmap.setCenter({ lat: puntos[0][0], lng: puntos[0][1] });
      gmap.setZoom(14);
      return;
    }
    const b = new google.maps.LatLngBounds();
    puntos.forEach(p => b.extend({ lat: p[0], lng: p[1] }));
    gmap.fitBounds(b, { top: 40, right: 40, bottom: 40, left: 40 });
    return;
  }
  if (!mapa || !window.L) return;
  if (puntos.length > 1) mapa.fitBounds(L.latLngBounds(puntos).pad(0.3), { maxZoom: 15 });
  else if (puntos.length === 1) mapa.setView(puntos[0], 14);
}

/* Centra el mapa en un punto [lat, lng] */
function centrarMapa(punto, zoom) {
  /* si había un encuadre automático pendiente, no dejamos que pise lo que eligió el usuario */
  if (timerEncuadre) { clearTimeout(timerEncuadre); timerEncuadre = null; }
  if (mapaEsGoogle()) {
    if (!gmap) return;
    gmap.setCenter({ lat: punto[0], lng: punto[1] });
    gmap.setZoom(zoom);
    return;
  }
  if (mapa) mapa.setView(punto, zoom);
}

/* El mapa está en su propia pantalla */
function actualizarMapaSiSeVe() {
  if ((mapa || gmap || claveGoogle()) && !$('#view-mapa').hidden) renderMapa();
}

/* ---------- Resumen del Inicio: estadísticas ---------- */
/* Enlaces a redes: uno o más, separados por espacio o coma. Solo se aceptan http(s). */
function parseRedes(txt) {
  return String(txt || '').split(/[\s,]+/).map(t => t.trim()).filter(Boolean).map(t => {
    try {
      const x = new URL(/^https?:\/\//i.test(t) ? t : 'https://' + t);
      return /^https?:$/.test(x.protocol) && x.hostname.includes('.') ? x.href : '';
    } catch (e) { return ''; }
  }).filter(Boolean);
}
const nombreRed = href => {
  const h = new URL(href).hostname.replace(/^www\./, '');
  if (/instagram/.test(h)) return 'Instagram';
  if (/facebook|fb\.com/.test(h)) return 'Facebook';
  if (/tiktok/.test(h)) return 'TikTok';
  if (/youtube|youtu\.be/.test(h)) return 'YouTube';
  if (/wa\.me|whatsapp/.test(h)) return 'WhatsApp';
  if (/^x\.com$|twitter/.test(h)) return 'X';
  return h;
};
function linksRedesHTML(txt) {
  const links = parseRedes(txt).map(urlSegura).filter(Boolean);
  return links.length ? `<div class="promo-links">${links.map(href =>
    `<a class="promo-link" href="${esc(href)}" target="_blank" rel="noopener">${esc(nombreRed(href))}</a>`).join('')}</div>` : '';
}

/* Bloque de promociones: el flyer es lo principal; debajo, solo título, un detalle y los enlaces */
function promosBloqueHTML(lista, vacio) {
  if (!lista.length) return vacio ? `<p class="muted small">${esc(vacio)}</p>` : '';
  return `<div class="promo-grid">${lista.map(p => `
    <article class="promo-hero" data-promo-id="${esc(p.id)}" role="button" tabindex="0" title="Ver promoción">
      ${p.flyer ? `<img class="promo-hero-img" src="${esc(p.flyer)}" alt="Flyer de ${esc(p.titulo)}">` : ''}
      <div class="promo-hero-info">
        <strong>${esc(p.titulo)}</strong>
        ${p.texto ? `<span>${esc(p.texto)}</span>` : ''}
        ${linksRedesHTML(p.redes)}
      </div>
    </article>`).join('')}</div>`;
}

/* Inicio público: promociones activas, visibles para todos (con o sin sesión) */
function promosInicioHTML() {
  const lista = promosActivas();
  if (!lista.length) return '';
  return `<div class="promos-publico">
    <h3 class="promos-tit">🎉 Promociones y novedades</h3>
    ${promosBloqueHTML(lista)}
  </div>`;
}

function renderResumenInicio() {
  const box = $('#inicio-resumen');
  if (!box || !state) return;
  const hoy = todayStr();
  const salas = salasPublicas();
  const todas = state.reservations.filter(r => r.estado !== 'cancelada');
  const hoyCount = todas.filter(r => r.date === hoy).length;
  const semana = todas.filter(r => r.date > hoy && r.date <= addDaysStr(hoy, 7)).length;
  const proximas = misReservas().filter(r => r.date >= hoy && r.estado !== 'cancelada').length;

  box.innerHTML = `
    <div class="panel-head"><h2>🛎 Resumen</h2></div>

    <div class="stats-cards resumen-stats">
      <div class="stat"><span>Salas publicadas</span><strong>${salas.length}</strong></div>
      <div class="stat"><span>Reservas hoy</span><strong>${hoyCount}</strong></div>
      <div class="stat"><span>Próximos 7 días</span><strong>${semana}</strong></div>
      <div class="stat"><span>Mis reservas</span><strong>${proximas}</strong></div>
    </div>

    ${promosInicioHTML()}

    ${!yo ? `<div class="row wrap"><button class="btn btn-sm" id="sum-login">👤 Iniciar sesión</button></div>` : ''}`;
}

/* Mi ubicación y vista general */
function pedirMiUbicacion() {
  if (!navigator.geolocation) { toast('Tu navegador no permite ubicaciones', 'warn'); return; }
  if (miUbicacion && (mapa || gmap)) { centrarMapa(miUbicacion, 13); return renderMapa(); }
  toast('Buscando tu ubicación…', 'info');
  navigator.geolocation.getCurrentPosition(
    pos => {
      miUbicacion = [pos.coords.latitude, pos.coords.longitude];
      centrarMapa(miUbicacion, 13);
      renderMapa();
      toast('Ubicación detectada 📍', 'ok');
    },
    () => toast('No pude obtener tu ubicación. Revisá los permisos.', 'warn'),
    { timeout: 8000 }
  );
}

/* Acciones dentro de los popups del mapa */
function wireMapa() {
  $('#btn-mi-ubicacion').onclick = pedirMiUbicacion;
  $('#btn-ver-todas').onclick = () => { renderMapa(); encuadrarMapa(); };
  $('#btn-ver-mapa').onclick = irMapa;
  const bvi = $('#btn-ver-instrumentos');
  if (bvi) bvi.onclick = irInstrumentos;
  const hojaBtn = $('#mapa-hoja-btn');
  const hoja = $('#mapa-hoja');
  const hojaCuerpo = $('#mapa-hoja-cuerpo');
  // Altura máxima que puede alcanzar la hoja (contenido real, tope 46% de la pantalla)
  const maxHoja = () => Math.min(hojaCuerpo ? hojaCuerpo.scrollHeight : 0, Math.round(window.innerHeight * 0.46));
  const abrirHoja = (abrir, animar) => {
    if (!hoja || !hojaCuerpo) return;
    if (animar === false) hojaCuerpo.style.transition = 'none';
    else hojaCuerpo.style.transition = '';
    hoja.classList.toggle('abierta', !!abrir);
    hojaCuerpo.style.maxHeight = (abrir ? maxHoja() : 0) + 'px';
    if (hojaBtn) hojaBtn.setAttribute('aria-expanded', abrir ? 'true' : 'false');
  };
  if (hojaBtn && hoja && hojaCuerpo) {
    hojaBtn.onclick = () => abrirHoja(!hoja.classList.contains('abierta'));
    // Arrastre en vivo: la hoja acompaña el dedo
    let arrastrando = false, yArranque = 0, altoArranque = 0, dyFinal = 0;
    hojaBtn.addEventListener('touchstart', e => {
      arrastrando = true;
      yArranque = e.touches[0].clientY;
      dyFinal = 0;
      altoArranque = hojaCuerpo.getBoundingClientRect().height;
      hojaCuerpo.style.transition = 'none';
    }, { passive: true });
    hojaBtn.addEventListener('touchmove', e => {
      if (!arrastrando) return;
      dyFinal = yArranque - e.touches[0].clientY; // >0 = hacia arriba
      const alto = Math.max(0, Math.min(maxHoja(), altoArranque + dyFinal));
      hojaCuerpo.style.maxHeight = alto + 'px';
      hoja.classList.toggle('abierta', alto > maxHoja() * 0.5);
    }, { passive: true });
    const soltarTirador = () => {
      if (!arrastrando) return;
      arrastrando = false;
      hojaCuerpo.style.transition = '';
      const alto = hojaCuerpo.getBoundingClientRect().height;
      abrirHoja(dyFinal > -40 && alto > maxHoja() * 0.3);
    };
    hojaBtn.addEventListener('touchend', soltarTirador);
    hojaBtn.addEventListener('touchcancel', soltarTirador);
    // Deslizar hacia abajo sobre la lista (si está arriba de todo) para cerrar
    const hojaCard = hojaCuerpo.querySelector('.mapa-hoja-card');
    let yCuerpo = null, yCuerpoFin = null;
    hojaCuerpo.addEventListener('touchstart', e => {
      yCuerpo = (hojaCard ? hojaCard.scrollTop : 0) <= 0 ? e.touches[0].clientY : null;
      yCuerpoFin = yCuerpo;
      if (yCuerpo != null) hojaCuerpo.style.transition = 'none';
    }, { passive: true });
    hojaCuerpo.addEventListener('touchmove', e => {
      if (yCuerpo == null) return;
      yCuerpoFin = e.touches[0].clientY;
      const dy = yCuerpoFin - yCuerpo; // >0 = hacia abajo
      if (dy <= 0) return;
      const alto = Math.max(0, maxHoja() - dy);
      hojaCuerpo.style.maxHeight = alto + 'px';
      hoja.classList.toggle('abierta', alto > maxHoja() * 0.5);
    }, { passive: true });
    hojaCuerpo.addEventListener('touchend', () => {
      if (yCuerpo == null) return;
      const dy = (yCuerpoFin || yCuerpo) - yCuerpo;
      yCuerpo = null; yCuerpoFin = null;
      hojaCuerpo.style.transition = '';
      abrirHoja(dy < 80);
    });
  }
  const cerrarHoja = () => abrirHoja(false);
  $('#mapa').onclick = e => { cerrarHoja(); accionesMapa(e); };
  const lista = $('#mapa-lista');
  if (lista) lista.onclick = accionesMapa;
}

async function cancelarReservaMia(id) {
  const r = state.reservations.find(x => x.id === id);
  if (!r) return;
  if (!confirm(`¿Cancelar tu reserva del ${fmtDate(r.date)} ${r.start} – ${r.end}?\nEl horario queda libre.`)) return;
  try {
    const data = await api(`/api/reservations/${r.id}/cancel`, { method: 'POST', body: { name: r.name, phone: r.phone } });
    state = data.state;
    mineIds = mineIds.filter(x => x !== r.id);
    localStorage.setItem(MINE_KEY, JSON.stringify(mineIds));
    renderMineRapido();
    renderMapa();
    toast('Reserva cancelada. El horario quedó libre.', 'ok');
  } catch (e) { toast(e.message, 'error'); }
}

/* ---------- Selector de ubicación (dueños y administración) ---------- */
function abrirSelectorUbicacion(lat, lng, titulo) {
  return new Promise(resolve => {
    openModal(`
      <h3>🗺 ${esc(titulo || 'Ubicar en el mapa')}</h3>
      <p class="muted small">Tocá el mapa para marcar el punto exacto de la sala.</p>
      <div id="mapa-picker"></div>
      <p class="muted small" id="picker-texto"></p>
      <div class="row wrap">
        <button class="btn btn-primary" id="picker-ok">✔ Guardar ubicación</button>
        <button class="btn" id="picker-cancel">Cancelar</button>
      </div>`);
    const hayPunto = lat !== null && lat !== undefined && lat !== ''
      && lng !== null && lng !== undefined && lng !== '';
    const inicial = hayPunto ? [Number(lat), Number(lng)] : (miUbicacion || [-31.4201, -64.1888]);
    let punto = inicial;
    const texto = () => {
      const el = $('#picker-texto');
      if (el) el.textContent = `${punto[0].toFixed(5)}, ${punto[1].toFixed(5)}`;
    };
    const cancelar = () => { closeModal(); resolve(null); };
    const guardar = () => { closeModal(); resolve({ lat: punto[0], lng: punto[1] }); };
    $('#picker-cancel').onclick = cancelar;
    $('#picker-ok').onclick = guardar;

    /* Mismo proveedor que el mapa principal: Google si hay clave, si no OpenStreetMap */
    const usarLeaflet = () => {
      if (!window.L) {
        $('#picker-texto').textContent = 'No se pudo cargar el mapa: pasá el punto a mano con latitud y longitud.';
        $('#picker-ok').disabled = true;
        return;
      }
      const mp = L.map('mapa-picker', { zoomControl: true }).setView(inicial, 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(mp);
      const marca = L.marker(inicial, { draggable: true }).addTo(mp).bindPopup('Arrastrá para ajustar');
      marca.on('dragend', () => { const p = marca.getLatLng(); punto = [p.lat, p.lng]; texto(); });
      mp.on('click', e => { punto = [e.latlng.lat, e.latlng.lng]; marca.setLatLng(e.latlng); texto(); });
      texto();
      setTimeout(() => mp.invalidateSize(), 120);
    };
    const usarGoogle = () => {
      try {
        const mp = new google.maps.Map($('#mapa-picker'), {
          center: { lat: inicial[0], lng: inicial[1] },
          zoom: 14,
          language: 'es',
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          gestureHandling: 'greedy',
        });
        const marca = new google.maps.Marker({ map: mp, position: { lat: inicial[0], lng: inicial[1] }, draggable: true });
        marca.addListener('dragend', () => { const p = marca.getPosition(); punto = [p.lat(), p.lng()]; texto(); });
        mp.addListener('click', ev => {
          punto = [ev.latLng.lat(), ev.latLng.lng()];
          marca.setPosition(ev.latLng);
          texto();
        });
        texto();
        setTimeout(() => { try { google.maps.event.trigger(mp, 'resize'); } catch (e) {} }, 150);
        /* Si la clave no sirve, Google avisa apenas se crea el mapa: volvemos a OpenStreetMap */
        setTimeout(() => {
          if (!gmapaFallo) return;
          const cont = $('#mapa-picker');
          if (cont) cont.innerHTML = '';
          usarLeaflet();
        }, 2500);
      } catch (e) { usarLeaflet(); }
    };

    if (claveGoogle() && !gmapaFallo) {
      cargarGoogleMaps().then(ok => (ok && window.google ? usarGoogle() : usarLeaflet()));
    } else {
      usarLeaflet();
    }
  });
}

/* Busca una dirección en el mapa: Google Geocoding si hay clave, si no Nominatim */
async function buscarDireccion(direccion) {
  const q = String(direccion || '').trim();
  if (q.length < 4) { toast('Escribí la dirección para buscar', 'warn'); return null; }
  toast('Buscando la dirección…', 'info');

  /* 1. Google Maps (si hay clave cargada) */
  if (claveGoogle() && !gmapaFallo) {
    const ok = await cargarGoogleMaps();
    if (ok && window.google && window.google.maps && google.maps.Geocoder) {
      try {
        const rta = await Promise.race([
          new Promise(resolve => {
            new google.maps.Geocoder().geocode({ address: q, region: 'AR' }, (res, est) => resolve({ res, est }));
          }),
          new Promise(resolve => setTimeout(() => resolve({ res: null, est: 'TIMEOUT' }), 9000)),
        ]);
        if (rta.est === 'OK' && Array.isArray(rta.res) && rta.res.length) {
          const loc = rta.res[0].geometry.location;
          toast('Dirección encontrada ✓', 'ok');
          return { lat: loc.lat(), lng: loc.lng(), nombre: rta.res[0].formatted_address };
        }
      } catch (e) { /* si Google falla, probamos con OpenStreetMap */ }
    }
  }

  /* 2. OpenStreetMap (Nominatim) */
  try {
    const res = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q));
    const lista = await res.json();
    if (!lista || !lista.length) { toast('No encontré esa dirección', 'warn'); return null; }
    return { lat: Number(lista[0].lat), lng: Number(lista[0].lon), nombre: lista[0].display_name };
  } catch (e) {
    toast('No se pudo buscar la dirección (sin conexión)', 'warn');
    return null;
  }
}

/* ---------- Sala actual en la esquina ---------- */
function renderSalasStrip() {
  const box = $('#sala-actual');
  if (!box || !state) return;
  const room = salasPublicas().find(r => r.id === sel.roomId);
  if (!room) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.title = `Ver horarios de ${room.name}`;
  box.innerHTML = (room.foto
    ? `<img class="sala-chip-foto" src="${esc(room.foto)}" alt="${esc(room.name)}">`
    : '<span class="sala-chip-foto">🎸</span>')
    + `<span>${esc(room.name)}</span>`;
}

/* Elige una sala (desde el mapa o la lista) y sigue con la fecha o los horarios */
function elegirSala(roomId) {
  ocultarVistas();
  const room = salasPublicas().find(r => r.id === roomId);
  if (!room) return;
  $('#view-public').hidden = false;
  $('#view-mine').hidden = true;
  $('#view-lugar').hidden = true;
  $('#view-panel').hidden = true;
  setNav('inicio');
  sel.roomId = room.id; sel.range = null; sel.slot = null;
  /* Si todavía no hay fecha, primero se elige la fecha de esa sala */
  if (!sel.date) {
    sel.date = null;
    calCursor = todayStr().slice(0, 7);
    goStep(1);
    renderCalendar();
    renderSalasStrip();
    scrollMainArriba();
    toast(`Elegí la fecha para ${room.name}`, 'ok');
    return;
  }
  renderSlots();
  goStep(3);
  scrollMainArriba();
}

function renderSlots() {
  const room = salasPublicas().find(r => r.id === sel.roomId);
  if (!room) { goStep(2); renderRooms(); return; }
  $('#slots-title').textContent = `🕐 ${room.name} · ${fmtDate(sel.date)}`;
  const { closed, slots } = slotsFor(sel.date, sel.roomId);
  const grid = $('#slots-grid');
  const bar = $('#range-bar');
  if (closed) {
    grid.innerHTML = '<p class="muted">La sala está cerrada este día.</p>';
    bar.hidden = true;
    return;
  }
  if (!slots.length) {
    grid.innerHTML = '<p class="muted">No hay horarios disponibles este día.</p>';
    bar.hidden = true;
    return;
  }
  const rStart = sel.range ? toMin(sel.range.start) : null;
  const rEnd = sel.range ? toMin(sel.range.end) : null;
  grid.innerHTML = slots.map(s => {
    const t = toMin(s.start);
    const inRange = sel.range && t >= rStart && t < rEnd;
    let cls, label;
    if (s.status === 'available' || inRange) {
      cls = inRange ? 'in-range' : 'available';
      label = `${s.start} – ${s.end}<small>Disponible · ${fmtMoney(room.price)}/h</small>`;
    } else if (s.status === 'reserved') {
      cls = 'reserved';
      label = `${s.start} – ${s.end}<small>🔒 Reservado</small>`;
    } else if (s.status === 'blocked') {
      cls = 'blocked';
      label = `${s.start} – ${s.end}<small>🚫 Bloqueado</small>`;
    } else {
      cls = 'past';
      label = `${s.start} – ${s.end}<small>Ya pasó</small>`;
    }
    return `<button class="slot ${cls}" data-start="${s.start}" ${s.status !== 'available' ? 'disabled' : ''}>${label}</button>`;
  }).join('');

  if (sel.range) {
    const horas = (rEnd - rStart) / 60;
    $('#range-text').textContent = `⏱ ${sel.range.start} – ${sel.range.end} · ${horas} hora${horas > 1 ? 's' : ''} · Total: ${fmtMoney(horas * room.price)}`;
    bar.hidden = false;
  } else {
    bar.hidden = true;
  }
}

/* ---------- Visor de fotos: arrastrar y acercar ---------- */
function verFoto(src, alt) {
  if (!src) return;
  const v = document.createElement('div');
  v.className = 'viewer';
  v.innerHTML = `
    <button class="viewer-close" type="button" aria-label="Cerrar">✕</button>
    <img class="viewer-img" src="${esc(src)}" alt="${esc(alt || '')}">
    <div class="viewer-controls">
      <button class="btn btn-sm" data-v="out" title="Alejar">➖</button>
      <button class="btn btn-sm" data-v="reset" title="Centrar">🎯</button>
      <button class="btn btn-sm" data-v="in" title="Acercar">➕</button>
    </div>
    <p class="viewer-hint">Arrastra la foto hacia abajo o arriba para moverla · ➕➖ para acercar · toca fuera para cerrar</p>`;
  document.body.appendChild(v);
  const img = v.querySelector('.viewer-img');
  let nivel = 1, ox = 0, oy = 0, arr = null;
  const aplicar = () => { img.style.transform = `translate(${ox}px, ${oy}px) scale(${nivel})`; };
  const zoom = f => { nivel = Math.max(0.4, Math.min(5, nivel * f)); aplicar(); };
  v.addEventListener('pointerdown', e => {
    arr = { x: e.clientX, y: e.clientY, ox, oy };
    try { v.setPointerCapture(e.pointerId); } catch (err) { /* navegador sin captura */ }
    img.classList.add('grabbing');
  });
  v.addEventListener('pointermove', e => {
    if (!arr) return;
    ox = arr.ox + (e.clientX - arr.x);
    oy = arr.oy + (e.clientY - arr.y);
    aplicar();
  });
  const soltar = () => { arr = null; img.classList.remove('grabbing'); };
  v.addEventListener('pointerup', soltar);
  v.addEventListener('pointercancel', soltar);
  v.addEventListener('wheel', e => { e.preventDefault(); zoom(e.deltaY < 0 ? 1.12 : 0.89); }, { passive: false });
  v.addEventListener('click', e => {
    const b = e.target.closest('[data-v]');
    if (b) {
      const a = b.dataset.v;
      if (a === 'in') zoom(1.2);
      else if (a === 'out') zoom(1 / 1.2);
      else { nivel = 1; ox = 0; oy = 0; aplicar(); }
      return;
    }
    if (e.target === v || e.target.closest('.viewer-close')) v.remove();
  });
  aplicar();
}

/* ---------- Recortador de fotos (encuadre fijo, ajuste manual) ---------- */
const FORMATOS_FOTO = { vertical: 3 / 4, horizontal: 16 / 9, cuadrado: 1 };

function montarRecortador(host, opciones = {}) {
  const titulo = opciones.titulo || '';
  const formato = opciones.formato || 'cuadrado';   /* encuadre fijo, sin opciones */
  const ratio = FORMATOS_FOTO[formato];
  host.classList.add('crop-host');
  host.innerHTML = `
    ${titulo ? `<p class="crop-titulo">${titulo}</p>` : ''}
    <div class="crop-frame ${formato === 'horizontal' ? 'ancho' : ''} ${formato === 'cuadrado' ? 'circulo' : ''}" style="aspect-ratio:${ratio}">
      <canvas class="crop-canvas"></canvas>
      <div class="crop-grid"></div>
      <div class="crop-empty">📷<br>Elige una imagen</div>
    </div>
    <div class="crop-controls">
      <button class="btn btn-sm" data-crop="out" title="Achicar">➖</button>
      <button class="btn btn-sm" data-crop="reset" title="Centrar y llenar el cuadro">🎯</button>
      <button class="btn btn-sm" data-crop="in" title="Agrandar">➕</button>
    </div>
    <p class="muted small crop-hint">Ajusta a mano: arrastra para mover · ➕➖ acercar o alejar · 🎯 llena todo el cuadro</p>`;

  const frame = host.querySelector('.crop-frame');
  const canvas = host.querySelector('.crop-canvas');
  const empty = host.querySelector('.crop-empty');
  const ctx = canvas.getContext('2d');

  let img = null;
  let escala = 1, dx = 0, dy = 0, modificado = false;

  function ajustarTamano() {
    const r = frame.getBoundingClientRect();
    if (!r.width) return false;
    canvas.width = Math.round(r.width * 2);   // 2x para que se vea nítido
    canvas.height = Math.round(canvas.width / ratio);
    return true;
  }

  function dibujar() {
    if (!ajustarTamano()) return;
    const cw = canvas.width, ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#0b0f1c';
    ctx.fillRect(0, 0, cw, ch);
    if (!img) return;
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;
    const s = Math.max(cw / iw, ch / ih) * escala;  /* siempre cubre el marco */
    const dw = iw * s, dh = ih * s;
    const maxX = Math.max(0, (dw - cw) / 2), maxY = Math.max(0, (dh - ch) / 2);
    dx = Math.max(-maxX, Math.min(maxX, dx));
    dy = Math.max(-maxY, Math.min(maxY, dy));
    ctx.drawImage(img, (cw - dw) / 2 + dx, (ch - dh) / 2 + dy, dw, dh);
  }

  function cargarImagen(fuente, _formatoSugerido, marcarCambio) {
    return new Promise((resolve, reject) => {
      const n = new Image();
      n.onload = () => {
        img = n;
        escala = 1; dx = 0; dy = 0;   /* siempre empieza llenando el cuadro */
        modificado = (marcarCambio !== false);
        empty.hidden = true;
        dibujar();
        resolve(n);
      };
      n.onerror = () => reject(new Error('No se pudo leer la imagen'));
      n.crossOrigin = 'anonymous';
      n.src = fuente;
    });
  }

  /* Zoom con rueda del mouse o pellizco */
  function zoomEn(factor) {
    if (!img) return;
    escala = Math.max(1, Math.min(5, escala * factor));
    modificado = true;
    dibujar();
  }

  /* Arrastre (mouse y dedo) */
  let arrastre = null;
  frame.addEventListener('pointerdown', e => {
    if (!img) return;
    arrastre = { x: e.clientX, y: e.clientY, dx, dy };
    try { frame.setPointerCapture(e.pointerId); } catch (err) { /* navegador sin captura */ }
  });
  frame.addEventListener('pointermove', e => {
    if (!arrastre) return;
    const f = canvas.width / frame.getBoundingClientRect().width;
    dx = arrastre.dx + (e.clientX - arrastre.x) * f;
    dy = arrastre.dy + (e.clientY - arrastre.y) * f;
    modificado = true;
    dibujar();
  });
  const soltar = () => { arrastre = null; };
  frame.addEventListener('pointerup', soltar);
  frame.addEventListener('pointercancel', soltar);
  frame.addEventListener('wheel', e => { e.preventDefault(); zoomEn(e.deltaY < 0 ? 1.12 : 0.89); }, { passive: false });

  host.querySelectorAll('[data-crop]').forEach(b => {
    b.onclick = () => {
      const a = b.dataset.crop;
      if (a === 'in') zoomEn(1.2);
      else if (a === 'out') zoomEn(1 / 1.2);
      else if (a === 'reset') { escala = 1; dx = 0; dy = 0; modificado = !!img; dibujar(); }
    };
  });

  return {
    cargar: cargarImagen,
    zoom: zoomEn,
    formato: () => formato,
    etiquetaFormato: () => ETIQUETA_FORMATO[formato] || formato,
    hayFoto: () => !!img,
    cambioHecho: () => modificado,
    /* 'png' conserva la transparencia (ideal para la foto grupal) */
    obtener: (modo) => {
      if (!img) return null;
      return modo === 'png' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.9);
    },
  };
}

/* ---------- Registrar / editar banda ---------- */
function formularioBanda(id, alGuardar) {
  const b = id ? bandas().find(x => x.id === id) : { nombre: '', telefono: '', foto: '' };
  if (id && !b) return;
  const fotoActual = b.foto || '';
  const grupoActual = b.fotoGrupal || '';
  openModal(`
    <h3>${id ? 'Editar banda' : '🎭 Registrar mi banda'}</h3>
    <div id="bd-crop"></div>
    <label>Logo / foto de perfil (círculo)<input type="file" id="bd-file" accept="image/*"></label>
    <label class="check" id="bd-quitar-wrap" ${fotoActual ? '' : 'hidden'}><input type="checkbox" id="bd-quitar"> Quitar la foto</label>
    <div class="grupo-foto">
      <div class="miembros-head">
        <strong>🖼 Foto grupal <span class="muted small">(opcional)</span></strong>
        <button class="btn btn-sm" id="bd-toggle-grupo" type="button">${grupoActual ? 'Ver editor' : '＋ Agregar'}</button>
      </div>
      <div id="bd-grupo-caja" hidden>
        <div id="bd-crop-grupo"></div>
        <label>Foto grupal (horizontal, cubre todo el cuadro)<input type="file" id="bd-file-grupo" accept="image/*"></label>
        <label class="check" id="bd-quitar-grupo-wrap" ${grupoActual ? '' : 'hidden'}><input type="checkbox" id="bd-quitar-grupo"> Quitar la foto grupal</label>
        <p class="muted small">Se muestra de fondo, sin tapar ningún botón. Sube un PNG para que conserve la transparencia.</p>
      </div>
    </div>
    <label>Nombre de la banda *<input id="bd-name" maxlength="60" value="${esc(b.nombre)}" placeholder="Ej.: Banda Luna"></label>
    <label>Teléfono / contacto<input id="bd-phone" type="tel" maxlength="20" value="${esc(b.telefono)}" placeholder="Opcional"></label>
    <label>Género / estilo <span class="muted">(opcional)</span><input id="bd-genero" maxlength="40" value="${esc(b.genero || '')}" placeholder="Ej.: Rock, cumbia, pop"></label>
    <div class="miembros">
      <div class="miembros-head">
        <strong>👥 Integrantes <span class="muted small">(opcional)</span></strong>
        <button class="btn btn-sm" id="bd-add-miembro" type="button">＋ Agregar</button>
      </div>
      <div id="bd-miembros"></div>
      <p class="muted small">Pon el nombre de cada integrante y qué instrumento toca.</p>
    </div>
    <div class="row modal-acciones">
      <button class="btn btn-primary" id="bd-save">💾 Guardar cambios</button>
      <button class="btn" id="bd-cancel">Cancelar</button>
    </div>`);

  const rec = montarRecortador($('#bd-crop'), { titulo: '🔵 Logo de la banda', formato: 'cuadrado' });
  /* Si ya tiene foto, se puede volver a encuadrar (detectando su orientación) */
  if (fotoActual) {
    rec.cargar(fotoActual, 'auto', false).catch(() => toast('No se pudo abrir la foto actual', 'warn'));
  }

  /* ---------- Foto grupal horizontal (opcional, con transparencia) ---------- */
  let recGrupo = null;
  const cajaGrupo = $('#bd-grupo-caja');
  const btnGrupo = $('#bd-toggle-grupo');
  function mostrarGrupo() {
    cajaGrupo.hidden = false;
    btnGrupo.textContent = 'Ocultar';
    if (recGrupo) return;
    recGrupo = montarRecortador($('#bd-crop-grupo'), { titulo: '🖼 Foto grupal', formato: 'horizontal' });
    if (grupoActual) {
      recGrupo.cargar(grupoActual, 'horizontal', false).catch(() => toast('No se pudo abrir la foto grupal', 'warn'));
    }
    $('#bd-file-grupo').onchange = e => {
      const f = e.target.files[0];
      if (!f) return;
      if (!/^image\//.test(f.type)) { toast('Ese archivo no es una imagen', 'error'); return; }
      const lector = new FileReader();
      lector.onload = () => recGrupo.cargar(lector.result)
        .then(() => toast('Encuadra la foto grupal con ➕➖', 'ok'))
        .catch(err => toast(err.message || 'No se pudo leer la imagen', 'error'));
      lector.onerror = () => toast('No se pudo leer el archivo', 'error');
      lector.readAsDataURL(f);
    };
  }
  btnGrupo.onclick = () => {
    if (cajaGrupo.hidden) mostrarGrupo();
    else { cajaGrupo.hidden = true; btnGrupo.textContent = grupoActual ? 'Ver editor' : '＋ Agregar'; }
  };
  if (grupoActual) mostrarGrupo();

  /* Integrantes: se cargan los que ya tenía (si edita) */
  $('#bd-add-miembro').onclick = () => agregarFilaMiembro();
  const intsPrevios = b.integrantes || [];
  intsPrevios.forEach(agregarFilaMiembro);

  $('#bd-file').onchange = e => {
    const f = e.target.files[0];
    if (!f) return;
    if (!/^image\//.test(f.type)) { toast('Ese archivo no es una imagen', 'error'); return; }
    const lector = new FileReader();
    lector.onload = () => rec.cargar(lector.result)
      .then(() => toast('Encuadra tu foto con ➕➖ y arrastrando', 'ok'))
      .catch(err => toast(err.message || 'No se pudo leer la imagen', 'error'));
    lector.onerror = () => toast('No se pudo leer el archivo', 'error');
    lector.readAsDataURL(f);
  };

  $('#bd-save').onclick = async () => {
    const nombre = $('#bd-name').value.trim();
    if (!nombre) { toast('Escribe el nombre de la banda', 'warn'); return; }
    const integrantes = Array.from($('#bd-miembros').children).map(fila => ({
      nombre: fila.querySelector('[data-m-nombre]').value.trim(),
      instrumento: fila.querySelector('[data-m-instrumento]').value.trim(),
    })).filter(m => m.nombre || m.instrumento);
    const body = {
      nombre,
      telefono: $('#bd-phone').value.trim(),
      genero: $('#bd-genero').value.trim(),
      integrantes,
    };
    const quitar = $('#bd-quitar-wrap').hidden ? false : $('#bd-quitar').checked;
    if (quitar) body.foto = '';
    else if (rec.hayFoto() && rec.cambioHecho()) body.foto = rec.obtener();
    if (recGrupo) {
      const quitarGrupo = $('#bd-quitar-grupo-wrap').hidden ? false : $('#bd-quitar-grupo').checked;
      if (quitarGrupo) body.fotoGrupal = '';
      else if (recGrupo.hayFoto() && recGrupo.cambioHecho()) body.fotoGrupal = recGrupo.obtener('png');
    }
    try {
      const data = id
        ? await api(`/api/bands/${id}`, { method: 'PUT', admin: adminMode, body })
        : await api('/api/bands', { method: 'POST', body });
      state = data.state;
      closeModal();
      toast(id ? 'Banda actualizada ✓' : `¡${nombre} registrada! ✓`, 'ok');
      const creada = bandaPorNombre(nombre);
      if (alGuardar) alGuardar(creada);
      else refrescarVistasTrasBanda();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  $('#bd-cancel').onclick = closeModal;
}

/* Filas de integrantes (opcionales) */
function agregarFilaMiembro(mi = {}) {
  const cont = $('#bd-miembros');
  if (!cont) return;
  if (cont.children.length >= 24) { toast('Máximo 24 integrantes', 'warn'); return; }
  const fila = document.createElement('div');
  fila.className = 'miembro-row';
  fila.innerHTML = `
    <input maxlength="40" placeholder="Nombre" value="${esc(mi.nombre || '')}" data-m-nombre aria-label="Nombre del integrante">
    <input maxlength="60" placeholder="Instrumento" value="${esc(mi.instrumento || '')}" data-m-instrumento aria-label="Instrumento">
    <button class="btn btn-sm btn-danger" type="button" title="Quitar integrante" data-m-del>✕</button>`;
  fila.querySelector('[data-m-del]').onclick = () => fila.remove();
  cont.appendChild(fila);
}

/* Refresca lo que esté visible tras guardar el perfil */
function refrescarVistasTrasBanda() {
  if (!$('#view-mine').hidden) renderMine();
  else if (!$('#view-lugar').hidden) renderLugarTab(currentLugarTab);
  if (!$('#tab-bandas').hidden) renderBandasAdmin();
  if (!$('#view-public').hidden && curStep === 4 && $('#bk-band')) renderConfirm();
}

/* ---------- Perfil de la banda ---------- */
function verPerfilBanda(id) {
  const b = bandas().find(x => x.id === id);
  if (!b) { toast('La banda ya no está registrada', 'warn'); return; }
  const ints = b.integrantes || [];
  openModal(`
    <div class="perfil">
      ${b.fotoGrupal ? `<img class="perfil-fondo" src="${esc(b.fotoGrupal)}" alt="">` : ''}
      ${b.foto
        ? `<img class="perfil-avatar-circular grande" src="${esc(b.foto)}" alt="${esc(b.nombre)}" data-foto="${esc(b.foto)}" data-foto-alt="${esc(b.nombre)}" title="Toca para ver en grande">`
        : '<div class="perfil-avatar-circular grande perfil-sin-foto">🎭</div>'}
      <h3>${esc(b.nombre)}</h3>
      <div class="perfil-tags">
        ${b.genero ? `<span class="tag">🎸 ${esc(b.genero)}</span>` : ''}
        <span class="tag">👥 ${ints.length} ${ints.length === 1 ? 'integrante' : 'integrantes'}</span>
        ${b.telefono ? `<span class="tag">📞 ${esc(b.telefono)}</span>` : ''}
      </div>
      <h4 class="sub">Integrantes y instrumentos</h4>
      ${ints.length
        ? `<ul class="perfil-lista">${ints.map(m => `
            <li>
              <strong>${esc(m.nombre || 'Sin nombre')}</strong>
              <span>${m.instrumento ? '🎸 ' + esc(m.instrumento) : '<span class="muted">sin instrumento</span>'}</span>
            </li>`).join('')}</ul>`
        : '<p class="muted small">Esta banda aún no registró sus integrantes.</p>'}
    </div>
    <div class="row">
      ${b.fotoGrupal ? `<button class="btn btn-primary" data-foto="${esc(b.fotoGrupal)}" data-foto-alt="Foto grupal">🖼 Ver foto grupal</button>` : ''}
      <button class="btn ${b.fotoGrupal ? '' : 'btn-primary'}" id="pf-edit">✏️ Editar perfil</button>
      <button class="btn" id="pf-close">Cerrar</button>
    </div>`);
  $('#pf-edit').onclick = () => formularioBanda(id, () => verPerfilBanda(id));
  $('#pf-close').onclick = closeModal;
}

function renderConfirm() {
  const room = state.rooms.find(r => r.id === sel.roomId);
  const horas = horasDe({ start: sel.slot.start, end: sel.slot.end });
  const total = horas * room.price;
  const listaBandas = bandas();
  const elegida = bandaPorNombre(sel.bandaNombre);
  const alquilables = (state.instruments || []).filter(i => i.activo !== false && i.alquiler);
  $('#confirm-body').innerHTML = `
    <div class="summary">
      <div><span>Fecha</span><strong>${fmtDate(sel.date)}</strong></div>
      <div><span>Sala</span><strong>${esc(room.name)}</strong></div>
      <div><span>Horario</span><strong>${sel.slot.start} – ${sel.slot.end}</strong></div>
      <div><span>Duración</span><strong>${horas} hora${horas > 1 ? 's' : ''}</strong></div>
      <div><span>Precio por hora</span><strong>${fmtMoney(room.price)}</strong></div>
      <div id="bk-alq-row" hidden><span>Alquiler de instrumentos</span><strong id="bk-alq-val">${fmtMoney(0)}</strong></div>
      <div><span>Total a pagar</span><strong class="accent" id="bk-total">${fmtMoney(total)}</strong></div>
    </div>
    ${alquilables.length ? `
    <div class="alquiler-box">
      <div class="alquiler-box-head">
        <strong>🎒 ¿Alquilas instrumentos?</strong>
        <span class="muted small">Se cobra por hora de ensayo (${horas}h)</span>
      </div>
      ${alquilables.map(i => `
        <label class="alquiler-item">
          <input type="checkbox" data-alq="${i.id}">
          <span class="alquiler-item-name">${esc(i.nombre)}</span>
          <span class="alquiler-item-price">${fmtMoney(i.precioAlquiler)}/h</span>
        </label>`).join('')}
      <p class="muted small" style="margin:6px 0 0">Opcional · puedes pedirlos también al llegar a la sala.</p>
    </div>` : ''}
    <div class="band-picker">
      <div id="band-preview" class="band-preview" ${elegida ? `data-band="${elegida.id}"` : ''} ${elegida ? '' : 'hidden'}>
        ${elegida ? (elegida.foto
          ? `<img class="band-avatar" src="${esc(elegida.foto)}" alt="${esc(elegida.nombre)}">`
          : `<span class="band-avatar band-emoji">🎭</span>`) : ''}
        <div class="mine-band-info">
          <strong>${elegida ? esc(elegida.nombre) : ''}</strong>
          <span class="muted small">Banda registrada</span>
        </div>
      </div>
      <label class="lbl-band">Banda registrada (opcional)
        <select id="bk-band">
          <option value="">— Escribe tu nombre —</option>
          ${listaBandas.map(b => `<option value="${esc(b.nombre)}" ${elegida && b.id === elegida.id ? 'selected' : ''}>${esc(b.nombre)}</option>`).join('')}
        </select>
      </label>
      <button class="btn btn-sm" id="bk-register-band">🎭 Registrar mi banda</button>
    </div>
    <label>Nombre o banda *<input id="bk-name" maxlength="60" placeholder="Ej.: Banda Luna" autocomplete="name" value="${yo ? esc(yo.nombre) : ''}"></label>
    <label>Teléfono (opcional)${yo ? '' : ' <span class="muted small">(creá una cuenta para no escribirlo cada vez)</span>'}<input id="bk-phone" type="tel" maxlength="20" placeholder="Ej.: +56 9 1234 5678" value="${yo ? esc(yo.telefono || '') : ''}"></label>
    ${yo ? '' : `<button class="btn btn-sm btn-block" id="bk-login">👤 Iniciar sesión / crear cuenta</button>`}
    <button class="btn btn-primary btn-big" id="bk-confirm">✔ Confirmar reserva</button>
    <p class="muted small">Al confirmar, estos horarios quedan bloqueados automáticamente para otros usuarios.</p>`;

  /* Selector de banda: rellena el nombre y muestra el logo */
  const selBand = $('#bk-band');
  const preview = $('#band-preview');
  const pintarBanda = () => {
    const b = bandaPorNombre(selBand.value);
    sel.bandaNombre = b ? b.nombre : '';
    if (b) {
      preview.hidden = false;
      preview.dataset.band = b.id;
      preview.innerHTML = (b.foto
        ? `<img class="band-avatar" src="${esc(b.foto)}" alt="${esc(b.nombre)}">`
        : `<span class="band-avatar band-emoji">🎭</span>`) +
        `<div class="mine-band-info"><strong>${esc(b.nombre)}</strong><span class="muted small">Banda registrada · ver perfil ›</span></div>`;
      $('#bk-name').value = b.nombre;
      if (b.telefono && !$('#bk-phone').value) $('#bk-phone').value = b.telefono;
    } else {
      preview.hidden = true;
      sel.bandaNombre = '';
    }
  };
  selBand.onchange = pintarBanda;
  if (elegida) pintarBanda();

  /* Registrar una banda nueva y seleccionarla */
  $('#bk-register-band').onclick = () => formularioBanda(null, creada => {
    if (!creada) return;
    renderConfirm();                       /* recarga el selector */
    const nuevoSel = $('#bk-band');
    nuevoSel.value = creada.nombre;
    pintarBanda();
  });

  /* Alquiler de instrumentos: recalcula el total */
  $$('#confirm-body [data-alq]').forEach(c => {
    c.onchange = () => {
      let suma = 0;
      $$('#confirm-body [data-alq]:checked').forEach(x => {
        const inst = alquilables.find(i => i.id === x.dataset.alq);
        if (inst) suma += inst.precioAlquiler * horas;
      });
      $('#bk-alq-row').hidden = suma <= 0;
      $('#bk-alq-val').textContent = fmtMoney(suma);
      $('#bk-total').textContent = fmtMoney(total + suma);
    };
  });

  $('#bk-confirm').onclick = confirmBooking;
  const btnLogin = $('#bk-login');
  if (btnLogin) btnLogin.onclick = () => { closeModal(); pantallaAuth('inicio'); };
  if (!$('#bk-name').value) $('#bk-name').focus();
}

async function confirmBooking() {
  const name = $('#bk-name').value.trim();
  const phone = $('#bk-phone').value.trim();
  if (!name) { toast('Escribe tu nombre o el de tu banda', 'warn'); return; }
  const startMin = toMin(sel.slot.start), endMin = toMin(sel.slot.end);
  if (!rangoDisponible(sel.date, sel.roomId, startMin, endMin)) {
    toast('Ese horario ya no está disponible. Elige otro.', 'error');
    sel.range = null;
    renderSlots();
    goStep(3);
    return;
  }
  const alquilerIds = $$('#confirm-body [data-alq]:checked').map(c => c.dataset.alq);
  let data;
  try {
    data = await api('/api/reserve', {
      method: 'POST',
      body: { date: sel.date, roomId: sel.roomId, start: sel.slot.start, end: sel.slot.end, name, phone, alquiler: alquilerIds },
    });
  } catch (e) {
    toast(e.message, 'error');
    if (e.message.includes('disponible')) {
      sel.range = null;
      renderSlots();
      goStep(3);
    }
    return;
  }
  state = data.state;
  mineIds.push(data.reservation.id);
  localStorage.setItem(MINE_KEY, JSON.stringify(mineIds));
  if (yo) cargarNotificaciones();
  if (data.pago) {
    const roomP = state.rooms.find(r => r.id === sel.roomId);
    const hasta = new Date(data.pago.venceEn).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    $('#confirm-body').innerHTML = `
      <div class="success">
        <h3>Falta pagar la seña</h3>
        <p><strong>${esc(name)}</strong></p>
        <p>${fmtDate(sel.date)} · ${esc(roomP ? roomP.name : '')} · ${data.reservation.start} – ${data.reservation.end}</p>
        <p class="accent"><strong>Seña a pagar ahora: ${fmtMoney(data.pago.sena)}</strong></p>
        <p class="muted small">Total ${fmtMoney(data.pago.total)} · el saldo de ${fmtMoney(data.pago.saldo)} se paga en la sala.</p>
        <p class="muted small">Tu horario queda reservado hasta las ${hasta}. Si no se paga la seña, se libera.</p>
        ${data.pago.url && urlSegura(data.pago.url)
          ? `<a class="btn btn-primary" href="${urlSegura(data.pago.url)}">Pagar la seña con Mercado Pago</a>`
          : '<p class="muted small">Modo de prueba: el pago no está conectado todavía.</p>'}
        <button class="btn" id="bk-mine">👤 Ver mis reservas</button>
      </div>`;
    $('#bk-mine').onclick = () => { mostrarMisReservas(); };
    renderMineRapido();
    if (urlSegura(data.pago.url)) { toast('Te llevamos a Mercado Pago para pagar la seña…', 'ok'); setTimeout(() => { location.href = urlSegura(data.pago.url); }, 1500); }
    return;
  }
  const room = state.rooms.find(r => r.id === sel.roomId);
  const horas = horasDe(data.reservation);
  const alquilados = data.reservation.alquiler || [];
  const totalAlq = alquilados.reduce((s, a) => s + a.total, 0);
  $('#confirm-body').innerHTML = `
    <div class="success">
      <div class="ok-mark">✔</div>
      <h3>¡Reserva confirmada!</h3>
      <p><strong>${esc(name)}</strong></p>
      <p>${fmtDate(sel.date)}</p>
      <p>${esc(room.name)} · ${data.reservation.start} – ${data.reservation.end} (${horas} hora${horas > 1 ? 's' : ''})</p>
      ${alquilados.length ? `
        <div class="alquiler-confirmado">
          <strong>🎒 Alquiler</strong>
          ${alquilados.map(a => `<div class="muted small">${esc(a.nombre)} · ${a.horas}h · ${fmtMoney(a.total)}</div>`).join('')}
        </div>` : ''}
      <p class="accent"><strong>Total: ${fmtMoney(horas * room.price + totalAlq)}</strong></p>
      <p class="muted small">Estos horarios ya no están disponibles para otros usuarios.</p>
      <button class="btn btn-primary" id="bk-again">Hacer otra reserva</button>
      <button class="btn" id="bk-mine">👤 Ver mi perfil</button>
    </div>`;
  $('#bk-again').onclick = () => { sel.range = null; sel.roomId = null; sel.slot = null; sel.bandaNombre = ''; goStep(1); renderCalendar(); };
  $('#bk-mine').onclick = () => { mostrarMisReservas(); };
  renderMineRapido();   /* la reserva nueva ya figura en "Mis reservas" */
  toast('Reserva registrada ✓', 'ok');
}

/* ---------- Mis reservas (cliente) ---------- */
let busquedaMine = '';
let filtroMisReservas = '';   /* '' | 'proximas' | 'historial' (se elige en Ajustes) */

function mostrarMisReservas() {
  ocultarVistas();
  $('#view-public').hidden = true;
  $('#view-lugar').hidden = true;
  $('#view-mine').hidden = false;
  setNav('perfil');
  renderMine();
}

function volverAReservar() {
  ocultarVistas();
  $('#view-mine').hidden = true;
  $('#view-public').hidden = false;
  setNav('inicio');
}

function mostrarLugar() {
  ocultarVistas();
  $('#view-public').hidden = true;
  $('#view-mine').hidden = true;
  $('#view-lugar').hidden = false;
  setNav('salas');
  renderLugarTab('instrumentos');
}

/* ---------- Barra inferior (5 opciones) ---------- */
function setNav(nav) {
  navActual = nav;
  document.body.classList.toggle('modo-control', esCuentaControl());
  /* En el Mapa la barra inferior va transparente (solo en celular) */
  document.body.classList.toggle('nav-mapa', nav === 'mapa');
  $$('#dock-container [data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === nav));
  $('#dock-container').hidden = nav === 'admin'; /* el admin usa todo el alto */
  actualizarAccionesHeader();
}

function scrollMainArriba() {
  const m = document.querySelector('main:not([hidden])');
  if (m) m.scrollTop = 0;
}

function irInicio() {
  ocultarVistas();
  $('#view-public').hidden = false;
  $('#view-mine').hidden = true;
  $('#view-lugar').hidden = true;
  setNav('inicio');
  goStep(1);
  renderCalendar();
  renderMapa();
  scrollMainArriba();
}

function irSalas(vista) {
  ocultarVistas();
  $('#view-public').hidden = false;
  $('#view-mine').hidden = true;
  $('#view-lugar').hidden = true;
  $('#view-panel').hidden = true;
  setNav('salas');
  filtroSalas = 'todas';
  sel.roomId = null; sel.range = null; sel.slot = null;
  if (!sel.date) {
    sel.date = todayStr();
    calCursor = sel.date.slice(0, 7);
  }
  renderCalendar();
  renderRooms();
  goStep(2);
  scrollMainArriba();
}

/* El mapa tiene su propia pantalla */
function irMapa() {
  ocultarVistas();
  $('#view-mapa').hidden = false;
  setNav('mapa');
  renderMapa();
  scrollMainArriba();
  if (timerEncuadre) clearTimeout(timerEncuadre);
  timerEncuadre = setTimeout(() => {
    if (mapa) mapa.invalidateSize();
    if (gmap) { try { google.maps.event.trigger(gmap, 'resize'); } catch (e) {} }
    encuadrarMapa();
  }, 220);
}

function nuevaReserva() {
  sel.roomId = null; sel.range = null; sel.slot = null; sel.bandaNombre = '';
  irSalas();
  toast('Elegí la sala 👇', 'ok');
}

function irInstrumentos() { mostrarLugar(); }
function irMisReservas() { mostrarMisReservas(); }

/* ================= Comunidad (solo músicos) ================= */
let comuTab = 'musicos';
let comuBusqueda = '';
let comuSoloZona = false;
let comuLista = [];
let comuChatCon = null;
let comuPollTimer = null;
let comuBuscarTimer = null;
let comuConvFirma = '';
let comuHiloFirma = '';

const comuAvatar = m => {
  const inicial = esc(String((m && m.nombre) || '?').trim().charAt(0).toUpperCase() || '?');
  return m && m.foto
    ? `<span class="comu-avatar"><img src="${esc(m.foto)}" alt=""></span>`
    : `<span class="comu-avatar comu-avatar-letra">${inicial}</span>`;
};

const horaCorta = ts => new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

function irComunidad(tab) {
  if (!esMúsico()) { toast('La comunidad es solo para músicos', 'warn'); return; }
  ocultarVistas();
  $('#view-comunidad').hidden = false;
  setNav('comunidad');
  cambiarComuTab(tab || comuTab);
  scrollMainArriba();
}

function activarComuPane(tab) {
  comuTab = tab;
  $$('#view-comunidad .comu-tab').forEach(b => b.classList.toggle('active', b.dataset.comuTab === tab));
  $('#comu-pane-musicos').hidden = tab !== 'musicos';
  $('#comu-pane-mensajes').hidden = tab !== 'mensajes';
  $('#comu-pane-siguiendo').hidden = tab !== 'siguiendo';
}

function cambiarComuTab(tab) {
  activarComuPane(tab);
  if (tab === 'musicos') { cerrarComuChat(); cargarComuMusicos(); }
  if (tab === 'mensajes') { cerrarComuChat(); cargarComuConversaciones(); }
  if (tab === 'siguiendo') { cargarComuSiguiendo(); }
  iniciarComuPoll();
}

function pararComuPoll() { if (comuPollTimer) { clearInterval(comuPollTimer); comuPollTimer = null; } }
function iniciarComuPoll() {
  pararComuPoll();
  comuPollTimer = setInterval(() => {
    const v = $('#view-comunidad');
    if (!v || v.hidden) return;
    if (comuTab === 'mensajes') {
      if (comuChatCon) cargarComuChat(comuChatCon, true);
      else cargarComuConversaciones(true);
    }
  }, 5000);
}

/* ----- Directorio de músicos ----- */
async function cargarComuMusicos() {
  const host = $('#comu-lista');
  if (!host) return;
  host.innerHTML = '<p class="muted small">Cargando músicos…</p>';
  try {
    const q = new URLSearchParams();
    if (comuBusqueda.trim()) q.set('q', comuBusqueda.trim());
    if (comuSoloZona && yo && yo.localidad) q.set('zona', yo.localidad);
    const r = await api('/api/comunidad/musicos?' + q.toString());
    comuLista = r.musicos || [];
    const nota = $('#comu-zona-nota');
    if (nota) nota.textContent = (yo && yo.localidad) ? `Tu zona: ${yo.localidad}` : 'Cargá tu localidad en el Perfil';
    renderComuLista();
  } catch (e) { host.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
}

const comuTags = instrumentos => (instrumentos && instrumentos.length)
  ? `<div class="comu-tags">${instrumentos.map(i => `<span class="comu-tag">${esc(i)}</span>`).join('')}</div>`
  : '';

const comuBotones = (m, conSeg) => `<div class="comu-acciones">
    ${conSeg ? `<button type="button" class="btn btn-sm ${m.siguiendo ? 'btn-primary' : ''}" data-comu-seguir="${m.id}">${m.siguiendo ? 'Siguiendo ✓' : 'Seguir'}</button>` : ''}
    <button type="button" class="btn btn-sm btn-primary" data-comu-msg="${m.id}">💬 Mensaje</button>
  </div>`;

function renderComuLista() {
  const host = $('#comu-lista');
  if (!comuLista.length) {
    host.innerHTML = '<p class="muted">No se encontraron músicos con ese filtro.</p>';
    return;
  }
  host.innerHTML = comuLista.map(m => `
    <div class="comu-card" data-id="${m.id}">
      ${comuAvatar(m)}
      <div class="comu-info">
        <strong>${esc(m.nombre)} <span class="comu-user">@${esc(m.usuario)}</span></strong>
        <span class="muted small">📍 ${m.localidad ? esc(m.localidad) : 'Sin localidad'}</span>
        ${comuTags(m.instrumentos)}
        ${m.meSigue ? '<span class="comu-me-sigue">Te sigue</span>' : ''}
        ${comuBotones(m, true)}
      </div>
    </div>`).join('');
}

/* ----- Seguir / dejar de seguir ----- */
async function comuSeguir(id, btn) {
  if (btn) btn.disabled = true;
  try {
    const r = await api('/api/comunidad/seguir', { method: 'POST', body: { userId: id } });
    const item = comuLista.find(m => m.id === id);
    if (item) item.siguiendo = r.siguiendo;
    $$(`[data-comu-seguir="${id}"]`).forEach(b => {
      b.disabled = false;
      b.classList.toggle('btn-primary', r.siguiendo);
      b.textContent = r.siguiendo ? 'Siguiendo ✓' : 'Seguir';
    });
    toast(r.siguiendo ? 'Ahora seguís a este músico' : 'Dejaste de seguir', 'ok');
  } catch (e) { if (btn) btn.disabled = false; toast(e.message, 'error'); }
}

/* ----- Mensajes ----- */
function actualizarComuBadge(n) {
  const b = $('#comu-msg-badge');
  if (!b) return;
  b.hidden = !n;
  b.textContent = n > 9 ? '9+' : String(n || 0);
}

async function cargarComuConversaciones(silent) {
  const host = $('#comu-chats');
  if (!host) return;
  if (!silent) host.innerHTML = '<p class="muted small">Cargando…</p>';
  try {
    const r = await api('/api/comunidad/conversaciones');
    actualizarComuBadge(r.sinLeer);
    const firma = JSON.stringify(r.conversaciones);
    if (silent && firma === comuConvFirma) return;
    comuConvFirma = firma;
    if (!r.conversaciones.length) { host.innerHTML = '<p class="muted">Todavía no tenés conversaciones. Entrá a «Músicos» y escribile a alguien.</p>'; return; }
    host.innerHTML = r.conversaciones.map(c => `
      <button type="button" class="comu-chat-item" data-comu-open="${c.id}">
        ${comuAvatar(c)}
        <span class="comu-chat-info">
          <strong>${esc(c.nombre)} <span class="comu-user">@${esc(c.usuario)}</span></strong>
          <span class="muted small">${c.ultimo ? (c.ultimo.mio ? 'Vos: ' : '') + esc(c.ultimo.texto) : 'Decile algo 👋'}</span>
        </span>
        ${c.sinLeer ? `<span class="comu-badge">${c.sinLeer}</span>` : ''}
      </button>`).join('');
  } catch (e) { if (!silent) host.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
}

function cerrarComuChat() {
  comuChatCon = null;
  comuHiloFirma = '';
  const chat = $('#comu-chat'), chats = $('#comu-chats');
  if (chat) { chat.hidden = true; chat.innerHTML = ''; }
  if (chats) chats.hidden = false;
}

async function abrirComuChat(userId) {
  if (!esMúsico()) return;
  activarComuPane('mensajes');
  comuChatCon = userId;
  comuHiloFirma = '';
  $('#comu-chats').hidden = true;
  $('#comu-chat').hidden = false;
  $('#comu-chat').innerHTML = '<p class="muted small">Cargando…</p>';
  await cargarComuChat(userId, false);
  iniciarComuPoll();
}

async function cargarComuChat(userId, silent) {
  try {
    const r = await api('/api/comunidad/mensajes?con=' + encodeURIComponent(userId));
    if (comuChatCon !== userId) return;
    const v = $('#view-comunidad');
    if (!v || v.hidden) return;
    if (silent) pintarComuHilo(r.mensajes);
    else renderComuChat(r);
  } catch (e) { /* en silencio durante el refresco automático */ }
}

function renderComuChat(r) {
  const m = r.musico;
  $('#comu-chat').innerHTML = `
    <div class="comu-chat-head">
      <button type="button" class="btn btn-sm btn-ghost" id="comu-chat-volver" title="Volver">←</button>
      ${comuAvatar(m)}
      <span class="comu-chat-nombre"><strong>${esc(m.nombre)}</strong><span class="comu-user">@${esc(m.usuario)}</span></span>
      <button type="button" class="btn btn-sm ${r.siguiendo ? 'btn-primary' : ''}" data-comu-seguir="${m.id}">${r.siguiendo ? 'Siguiendo ✓' : 'Seguir'}</button>
    </div>
    <div class="comu-hilo" id="comu-hilo"></div>
    <form class="comu-form" id="comu-form" autocomplete="off">
      <input id="comu-input" type="text" maxlength="600" placeholder="Escribí un mensaje…" autocomplete="off">
      <button class="btn btn-sm btn-primary" type="submit">Enviar</button>
    </form>`;
  comuHiloFirma = '';
  pintarComuHilo(r.mensajes);
  const input = $('#comu-input');
  if (input) input.focus();
}

function pintarComuHilo(msgs) {
  const host = $('#comu-hilo');
  if (!host) return;
  const firma = (msgs.length || 0) + ':' + (msgs.length ? msgs[msgs.length - 1].id : '');
  if (firma === comuHiloFirma) return;
  comuHiloFirma = firma;
  host.innerHTML = msgs.length
    ? msgs.map(m => `<div class="comu-burbuja ${m.mio ? 'mio' : 'otro'}">
        <span class="comu-texto">${esc(m.texto)}</span>
        <span class="comu-hora">${horaCorta(m.fecha)}</span>
      </div>`).join('')
    : '<p class="muted small">Escribile para arrancar la charla 👋</p>';
  host.scrollTop = host.scrollHeight;
}

async function enviarComuMensaje(texto) {
  if (!comuChatCon || !texto.trim()) return;
  const input = $('#comu-input');
  if (input) input.value = '';
  try {
    await api('/api/comunidad/mensajes', { method: 'POST', body: { para: comuChatCon, texto: texto.trim() } });
    await cargarComuChat(comuChatCon, true);
  } catch (e) { if (input) { input.value = texto; input.focus(); } toast(e.message, 'error'); }
}

/* ----- Siguiendo ----- */
async function cargarComuSiguiendo(silent) {
  const host = $('#comu-siguiendo');
  if (!host) return;
  if (!silent) host.innerHTML = '<p class="muted small">Cargando…</p>';
  try {
    const r = await api('/api/comunidad/siguiendo');
    const bloque = (titulo, lista, vacio, conSeg) => `
      <h3 class="comu-sub">${titulo}</h3>
      ${lista.length ? lista.map(m => `
        <div class="comu-card" data-id="${m.id}">
          ${comuAvatar(m)}
          <div class="comu-info">
            <strong>${esc(m.nombre)} <span class="comu-user">@${esc(m.usuario)}</span></strong>
            <span class="muted small">📍 ${m.localidad ? esc(m.localidad) : 'Sin localidad'}</span>
            ${comuTags(m.instrumentos)}
            ${comuBotones(m, conSeg)}
          </div>
        </div>`).join('') : `<p class="muted small">${vacio}</p>`}`;
    host.innerHTML = bloque('⭐ A quiénes seguís', r.sigo.map(x => Object.assign({ siguiendo: true }, x)), 'Todavía no seguís a nadie.', true)
      + bloque('👥 Quiénes te siguen', r.meSiguen, 'Nadie te sigue todavía.', false);
  } catch (e) { if (!silent) host.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
}

function renderMine() {
  /* El Perfil abre con la tarjeta de perfil (banda o sala); debajo, los datos y favoritas */
  renderPerfilMine();
  renderPerfilCuenta();
  renderIntegrantesBanda();
}

/* ================= Cuentas: acceso, perfil, panel del dueño ================= */

let fotoTemporal = '';   /* imagen elegida en los formularios de registro */
let datosDuenio = null;  /* paso 1 del registro de sala (se conserva al pasar al paso 2) */

/* ---------- Mostrar / ocultar pantallas ---------- */
function mostrarApp() {
  $('#view-auth').hidden = true;
  $('#app-header').hidden = false;
  $('#dock-container').hidden = false;
  actualizarBarraSesion();
  pintarInstagram();
}

/* Botón de Instagram de la cabecera: enlace a la cuenta para ver contenido (se muestra solo si está cargada) */
function pintarInstagram() {
  const el = $('#btn-ig');
  if (!el) return;
  const ig = limpiarIdentRed((state && state.settings && state.settings.contacto && state.settings.contacto.instagram) || '');
  if (ig) {
    el.href = 'https://www.instagram.com/' + ig;
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

function mostrarAcceso() {
  ocultarVistas();
  $('#app-header').hidden = true;
  $('#dock-container').hidden = true;
  $('#view-auth').hidden = false;
}

/* Cierra todas las vistas menos la que se vaya a mostrar */
function ocultarVistas() {
  pararComuPoll();
  ['view-public', 'view-mine', 'view-lugar', 'view-panel', 'view-admin', 'view-mapa', 'view-comunidad', 'view-auth']
    .forEach(v => { const el = $('#' + v); if (el) el.hidden = true; });
}

/* Botones del header según el rol conectado */
function actualizarBarraSesion() {
  document.body.classList.toggle('modo-control', esCuentaControl());
  const naAdmin = $('#nav-admin');
  if (naAdmin) naAdmin.hidden = !esSuper();
  const naPanel = $('#nav-panel');
  if (naPanel) naPanel.hidden = !esDueño();
  const naComunidad = $('#nav-comunidad');
  if (naComunidad) naComunidad.hidden = !esMúsico();
  if (!yo) {
    $('#btn-panel').hidden = true;
    $('#btn-notif').hidden = true;
    $('#btn-ajustes').hidden = true;
    return;
  }
  $('#btn-panel').hidden = !esDueño();
  actualizarAccionesHeader();
}

/* Dentro del Perfil la campana se cambia por el engranaje de Ajustes */
function actualizarAccionesHeader() {
  $('#btn-ajustes').hidden = !yo || $('#view-mine').hidden;
  $('#btn-notif').hidden = !yo || !$('#view-mine').hidden;
  if (yo && $('#view-mine').hidden) pintarBadgeNotif();
}

function pintarBadgeNotif() {
  const b = $('#notif-badge');
  if (!b) return;
  b.hidden = !sinLeer;
  b.textContent = sinLeer > 9 ? '9+' : String(sinLeer);
  const btn = $('#btn-notif');
  if (btn) btn.classList.toggle('tiene-nuevas', sinLeer > 0);
}

/* ---------- Validación de los formularios de acceso ---------- */
/* Cada regla recibe el valor del campo y (si hace falta) todos los campos del
   formulario. Devuelve '' si está bien, o el mensaje de error. */
const REGLA_TEXTO = {
  usuario: v => /^[a-z0-9._-]{3,24}$/.test(v.trim().toLowerCase()) ? '' : 'Usá de 3 a 24 caracteres: letras, números, punto, guion o guion bajo',
  email: v => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v.trim()) ? '' : 'Ese email no parece válido',
  nombre: v => v.trim().length >= 2 ? '' : 'Escribí tu nombre y apellido',
  password: v => v.length >= 6 ? '' : 'Usá al menos 6 caracteres',
  pass2: (v, todos) => v === todos.password ? '' : 'Las contraseñas no coinciden',
  telefono: v => /^[\d\s()+.-]{6,30}$/.test(v.trim()) ? '' : 'Ese teléfono no parece válido',
};

const campoEl = id => document.querySelector(`[data-campo="${id}"]`);

function campoEstado(id, estado, msg) {
  const w = campoEl(id);
  if (!w) return;
  w.classList.remove('ok', 'error', 'checking');
  if (estado) w.classList.add(estado);
  const m = w.querySelector('.campo-msg');
  if (m) m.textContent = msg || '';
}
const campoError = (id, msg) => campoEstado(id, 'error', msg);
const campoOk = id => campoEstado(id, 'ok', '');
const campoLimpiar = id => campoEstado(id, null, '');

/* Valida un campo y pinta su estado. Devuelve true si está correcto. */
function validarInput(input) {
  const id = input.id;
  const obligatorio = input.hasAttribute('data-obligatorio');
  const valor = input.value;
  if (!valor.trim()) {
    if (obligatorio) { campoError(id, 'Completá este dato'); return false; }
    campoLimpiar(id);
    return true;
  }
  const regla = REGLA_TEXTO[input.dataset.valida];
  if (regla) {
    const todos = {};
    const form = input.closest('form');
    if (form) $$('[data-valida]', form).forEach(i => { todos[i.dataset.valida] = i.value; });
    const err = regla(valor, todos);
    if (err) { campoError(id, err); return false; }
  }
  campoOk(id);
  return true;
}

/* Valida todos los campos de un formulario y enfoca el primero con error. */
function validarFormulario(form) {
  let ok = true, primero = null;
  $$('[data-valida]', form).forEach(c => {
    if (!validarInput(c)) { ok = false; if (!primero) primero = c; }
  });
  if (primero) primero.focus();
  return ok;
}

/* Medidor de fuerza de la contraseña */
function pintarFuerza(input) {
  const w = input.closest('.campo');
  const bar = w && w.querySelector('.fuerza');
  if (!bar) return;
  const p = input.value;
  let n = 0;
  if (p.length >= 6) n++;
  if (p.length >= 10) n++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) n++;
  if (/\d/.test(p)) n++;
  if (/[^A-Za-z0-9]/.test(p)) n++;
  n = Math.min(n, 4);
  bar.dataset.n = p ? n : 0;
  const txt = bar.querySelector('.fuerza-txt');
  if (txt) txt.textContent = p && n > 0 ? ['Débil', 'Aceptable', 'Buena', 'Excelente'][n - 1] : '';
}

/* Consulta al servidor si el usuario/email ya existen (mensaje en vivo) */
async function chequearDisponible(input) {
  const tipo = input.dataset.valida;
  if (tipo !== 'usuario' && tipo !== 'email') return;
  if (!validarInput(input)) return;
  const w = campoEl(input.id);
  if (!w) return;
  w.classList.remove('ok');
  w.classList.add('checking');
  const m = w.querySelector('.campo-msg');
  if (m) m.textContent = 'Verificando…';
  try {
    const q = new URLSearchParams();
    q.set(tipo, input.value.trim());
    const r = await api('/api/auth/disponible?' + q.toString());
    if (!document.body.contains(input)) return;
    const libre = tipo === 'usuario' ? r.usuarioLibre : r.emailLibre;
    if (libre === false) campoError(input.id, tipo === 'usuario' ? 'Ese nombre de usuario ya está en uso' : 'Ya existe una cuenta con ese email');
    else if (libre === true) campoOk(input.id);
    else campoLimpiar(input.id);
  } catch (e) {
    if (!document.body.contains(input)) return;
    campoLimpiar(input.id);   /* sin endpoint disponible: el servidor valida al enviar */
  }
}

/* Ubica un error del servidor en el campo correspondiente. Devuelve true si lo logró. */
function mapearErrorServidor(msg) {
  const m = String(msg || '').toLowerCase();
  const idUsr = $('#mu-usuario') ? 'mu-usuario' : ($('#sg-usuario') ? 'sg-usuario' : '');
  const idMail = $('#mu-email') ? 'mu-email' : ($('#sg-email') ? 'sg-email' : '');
  const idPass = $('#mu-pass') ? 'mu-pass' : ($('#sg-pass') ? 'sg-pass' : '');
  if (/usuario ya est/.test(m) && idUsr) { campoError(idUsr, msg); return true; }
  if (/email/.test(m) && idMail) { campoError(idMail, msg); return true; }
  if (/contrase/.test(m) && idPass) { campoError(idPass, msg); return true; }
  return false;
}

/* ---------- Render de campos con validación ---------- */
function campoAuth(id, etiqueta, opts = {}) {
  const { type = 'text', ph = '', req = false, max = 60, val = '', ac = '', valida = '', extra = '' } = opts;
  return `<label class="campo" data-campo="${id}">
    <span class="campo-lbl">${etiqueta}${req ? ' <span class="req">*</span>' : ''}</span>
    <input id="${id}" type="${type}" maxlength="${max}"${ph ? ` placeholder="${ph}"` : ''}${ac ? ` autocomplete="${ac}"` : ''}${val ? ` value="${val}"` : ''}${valida ? ` data-valida="${valida}"` : ''}${req ? ' data-obligatorio' : ''}${extra}>
    <span class="campo-msg"></span>
  </label>`;
}

function campoPassword(id, etiqueta, opts = {}) {
  const { ph = '', valida = 'password', fuerza = false, ac = 'new-password' } = opts;
  return `<label class="campo" data-campo="${id}">
    <span class="campo-lbl">${etiqueta} <span class="req">*</span></span>
    <span class="pass-wrap">
      <input id="${id}" type="password" autocomplete="${ac}" data-valida="${valida}" data-obligatorio${ph ? ` placeholder="${ph}"` : ''}>
      <button type="button" class="pass-eye" data-ver="${id}" aria-label="Mostrar u ocultar contraseña" tabindex="-1"><svg class="pass-eye-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
    </span>
    ${fuerza ? '<span class="fuerza" data-n="0"><i></i><i></i><i></i><i></i><span class="fuerza-txt"></span></span>' : ''}
    <span class="campo-msg"></span>
  </label>`;
}

function campoArea(id, etiqueta, opts = {}) {
  const { ph = '', rows = 2, max = 600 } = opts;
  return `<label class="campo" data-campo="${id}">
    <span class="campo-lbl">${etiqueta}</span>
    <textarea id="${id}" rows="${rows}" maxlength="${max}"${ph ? ` placeholder="${ph}"` : ''}></textarea>
    <span class="campo-msg"></span>
  </label>`;
}

/* ---------- Pantalla de acceso ---------- */
function pantallaAuth(vista = 'inicio') {
  mostrarAcceso();
  const b = $('#auth-body');
  const vol = '<button class="btn btn-sm btn-ghost auth-volver" data-vista="inicio">← Volver</button>';

  if (vista === 'inicio') {
    const cIni = (state && state.settings && state.settings.contacto) || {};
    const igIni = cIni.instagram ? limpiarIdentRed(cIni.instagram) : '';
    b.innerHTML = `
      <div class="auth-card">
        <div class="auth-titulo">
          <h1 class="auth-title">¿Cómo querés usar <span class="verde">Más Música</span>?</h1>
          <p class="auth-sub">Elegí tu perfil para empezar.</p>
        </div>
        <div class="auth-roles">
          <button class="auth-rol auth-rol-fijo" data-vista="musico">
            <span class="auth-rol-ic">
              <svg viewBox="0 0 24 24" fill="none" stroke="#0F1A2B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M9 18V5l12-2v13"></path>
                <circle cx="6" cy="18" r="3"></circle>
                <circle cx="18" cy="16" r="3"></circle>
              </svg>
            </span>
            <span class="auth-rol-txt">
              <strong>Soy músico</strong>
              <span>Creá tu cuenta para buscar y reservar salas de ensayo.</span>
            </span>
            <span class="auth-rol-go" aria-hidden="true">›</span>
          </button>
          <button class="auth-rol auth-rol-lar" data-vista="duenio">
            <span class="auth-rol-ic">
              <svg viewBox="0 0 24 24" fill="none" stroke="#00A038" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="5" y1="3" x2="5" y2="21"></line>
                <line x1="12" y1="3" x2="12" y2="21"></line>
                <line x1="19" y1="3" x2="19" y2="21"></line>
                <circle cx="5" cy="15" r="2.2" fill="#16263D"></circle>
                <circle cx="12" cy="8" r="2.2" fill="#16263D"></circle>
                <circle cx="19" cy="13" r="2.2" fill="#16263D"></circle>
              </svg>
            </span>
            <span class="auth-rol-txt">
              <strong>Tengo una sala de ensayo</strong>
              <span>Registrá tu sala para sumarla a Más Música.</span>
            </span>
            <span class="auth-rol-go" aria-hidden="true">›</span>
          </button>
        </div>
        <p class="auth-cuenta">¿Ya tenés cuenta?
          <button type="button" class="auth-link" data-vista="login">Iniciar sesión</button>
        </p>
        ${igIni ? `<p class="auth-redes"><a class="auth-link" target="_blank" rel="noopener" href="https://www.instagram.com/${esc(igIni)}">📸 Seguinos en Instagram ${esc('@' + igIni)}</a></p>` : ''}
      </div>`;
    return;
  }

  if (vista === 'login') {
    b.innerHTML = `
      ${vol}
      <div class="auth-card">
        <h1 class="auth-title">Ingresá a tu cuenta</h1>
        <p class="auth-sub">Tu usuario o email, y tu contraseña.</p>
        <form id="f-login" class="auth-form" novalidate>
          ${campoAuth('lg-user', 'Usuario o email', { req: true, valida: 'obligatorio', ac: 'username', ph: 'Ej.: marcelo o marcelo@mail.com', max: 80 })}
          ${campoPassword('lg-pass', 'Contraseña', { valida: 'obligatorio', ac: 'current-password' })}
          <button class="btn btn-primary btn-block btn-lg" type="submit">Ingresar</button>
          <button type="button" class="btn btn-sm btn-block btn-ghost" data-vista="pin">¿Sos de la administración? Entrá con el PIN</button>
        </form>
        <p class="auth-cuenta">¿Olvidaste tu contraseña o tu cuenta está bloqueada?
          <button type="button" class="auth-link" data-vista="ayuda">Pedí ayuda</button>
        </p>
      </div>`;
    return;
  }

  if (vista === 'ayuda') {
    const c = (state.settings && state.settings.contacto) || {};
    const botones = [];
    const wa = String(c.whatsapp || '').replace(/[^\d+]/g, '');
    if (wa) botones.push(`<a class="btn btn-sm" target="_blank" rel="noopener" href="https://wa.me/${esc(wa)}">💬 WhatsApp</a>`);
    if (c.facebook) botones.push(`<a class="btn btn-sm" target="_blank" rel="noopener" href="https://www.facebook.com/${esc(limpiarIdentRed(c.facebook))}">👍 Facebook</a>`);
    if (c.tiktok) botones.push(`<a class="btn btn-sm" target="_blank" rel="noopener" href="https://www.tiktok.com/@${esc(limpiarIdentRed(c.tiktok))}">🎵 TikTok</a>`);
    if (c.email) botones.push(`<a class="btn btn-sm" href="mailto:${esc(c.email)}">✉️ Email</a>`);
    b.innerHTML = `
      ${vol}
      <div class="auth-card">
        <h1 class="auth-title">¿Problemas para entrar?</h1>
        <p class="auth-sub">Contanos qué pasó: la administración recibe tu pedido y te ayuda a recuperar tu cuenta.</p>
        <form id="f-ayuda" class="auth-form" novalidate>
          <label class="campo" data-campo="ay-motivo">
            <span class="campo-lbl">¿Qué pasó? <span class="req">*</span></span>
            <select id="ay-motivo" data-obligatorio>
              <option value="olvide" selected>Olvidé mi contraseña</option>
              <option value="bloqueada">Mi cuenta está bloqueada o desactivada</option>
              <option value="otro">Otro problema</option>
            </select>
            <span class="campo-msg"></span>
          </label>
          ${campoAuth('ay-ident', 'Tu usuario o email', { req: true, valida: 'obligatorio', ac: 'username', ph: 'Ej.: marcelo o marcelo@mail.com', max: 120 })}
          ${campoArea('ay-msj', 'Contanos qué pasó (opcional)', { ph: 'Ej.: no puedo entrar desde ayer', max: 500 })}
          <button class="btn btn-primary btn-block btn-lg" type="submit">Enviar pedido</button>
        </form>
        ${botones.length ? `
          <p class="auth-sub" style="margin-top:18px">O escribinos directo por:</p>
          <div class="row wrap auth-ayuda-contacto">${botones.join('')}</div>` : ''}
        <p class="muted small" style="margin-top:12px">Tu pedido llega directo a la administración de Más Música. Te respondemos por el mismo canal.</p>
      </div>`;
    return;
  }

  if (vista === 'pin') {
    b.innerHTML = `
      ${vol}
      <div class="auth-card">
        <h1 class="auth-title">Acceso de administración</h1>
        <p class="auth-sub">Ingresá el PIN para entrar al panel.</p>
        <form id="f-pin" class="auth-form" novalidate>
          ${campoAuth('pn-pin', 'PIN de administrador', { type: 'password', req: true, valida: 'obligatorio', extra: ' inputmode="numeric"' })}
          <button class="btn btn-primary btn-block btn-lg" type="submit">Entrar al panel</button>
        </form>
      </div>`;
    return;
  }

  if (vista === 'musico') {
    b.innerHTML = `
      ${vol}
      <div class="auth-card">
        <h1 class="auth-title">Crear cuenta de músico</h1>
        <p class="auth-sub">Para buscar y reservar salas de ensayo.</p>
        <form id="f-musico" class="auth-form" novalidate>
          <div class="auth-foto">
            <div class="sala-foto-edit" id="mu-preview">${fotoTemporal ? `<img src="${fotoTemporal}" alt="previsualización">` : '<span class="sala-chip-foto" style="width:60px;height:60px;font-size:1.6rem">🎸</span>'}</div>
            <div class="auth-foto-txt">
              <label class="btn btn-sm">📷 Foto de perfil<input type="file" id="mu-foto" accept="image/*" hidden></label>
              <span class="muted small">Opcional</span>
            </div>
          </div>
          ${campoAuth('mu-nombre', 'Nombre y apellido', { req: true, valida: 'nombre', ac: 'name', ph: 'Ej.: Marcelo Gómez' })}
          ${campoAuth('mu-usuario', 'Nombre de usuario', { req: true, valida: 'usuario', ac: 'username', ph: 'Ej.: marcelo', max: 24 })}
          ${campoAuth('mu-email', 'Email', { type: 'email', req: true, valida: 'email', ac: 'email', ph: 'tucorreo@mail.com', max: 80 })}
          ${campoAuth('mu-tel', 'Teléfono', { valida: 'telefono', ac: 'tel', ph: 'Ej.: 15854455', max: 30 })}
          ${campoPassword('mu-pass', 'Contraseña', { fuerza: true, ph: 'Mínimo 6 caracteres' })}
          ${campoPassword('mu-pass2', 'Repetí la contraseña', { valida: 'pass2', ph: 'Igual que arriba' })}
          ${campoAuth('mu-loc', 'Localidad o zona', { ph: 'Ej.: Villa Carlos Paz', max: 80 })}
          ${campoAuth('mu-inst', '¿Qué instrumento tocás?', { ph: 'Ej.: Bajo, Guitarra (separados por coma)', max: 200 })}
          <button class="btn btn-primary btn-block btn-lg" type="submit">Crear mi cuenta</button>
        </form>
      </div>`;
    return;
  }

  /* Registro de sala: paso 1 datos del responsable, paso 2 datos de la sala */
  if (vista === 'duenio' || vista === 'duenio-sala') {
    const paso1 = vista === 'duenio';
    b.innerHTML = `
      ${vol}
      <div class="auth-card">
        <h1 class="auth-title">Registrar mi sala de ensayo</h1>
        ${paso1 ? `
          <p class="auth-sub">Paso 1 de 2 · Tus datos. La sala queda pendiente de aprobación.</p>
          <form id="f-duenio" class="auth-form" novalidate>
            ${campoAuth('sg-nombre', 'Nombre y apellido', { req: true, valida: 'nombre', ac: 'name', ph: 'Ej.: Ana Pérez' })}
            ${campoAuth('sg-usuario', 'Nombre de usuario', { req: true, valida: 'usuario', ac: 'username', ph: 'Ej.: salanueva', max: 24 })}
            ${campoAuth('sg-email', 'Email', { type: 'email', req: true, valida: 'email', ac: 'email', ph: 'tucorreo@mail.com', max: 80 })}
            ${campoAuth('sg-tel', 'Teléfono', { req: true, valida: 'telefono', ac: 'tel', ph: 'Ej.: 15854455', max: 30 })}
            ${campoPassword('sg-pass', 'Contraseña', { fuerza: true, ph: 'Mínimo 6 caracteres' })}
            <label class="check"><input type="checkbox" id="sg-soy"> Soy responsable de esta sala</label>
            <button class="btn btn-primary btn-block btn-lg" type="submit">Continuar →</button>
          </form>` : `
          <p class="auth-sub">Paso 2 de 2 · Los datos de la sala. La administración de Más Música la revisa antes de publicarla.</p>
          <form id="f-sala" class="auth-form" novalidate>
            ${campoAuth('sa-name', 'Nombre de la sala', { req: true, valida: 'obligatorio', ph: 'Ej.: Estudio Sur' })}
            ${campoAuth('sa-direccion', 'Dirección', { req: true, valida: 'obligatorio', ph: 'Calle y número', max: 160 })}
            <div class="row2">
              ${campoAuth('sa-loc', 'Localidad / zona', { max: 80 })}
              ${campoAuth('sa-tel', 'Teléfono de la sala', { valida: 'telefono', max: 30 })}
            </div>
            ${campoArea('sa-desc', 'Descripción', { ph: 'Ej.: Sala con buena acústica para bandas de 4 a 6 personas' })}
            <div class="row2">
              ${campoAuth('sa-price', 'Precio por hora', { type: 'number', req: true, valida: 'obligatorio', val: '10000', extra: ' min="1" step="1"' })}
              ${campoAuth('sa-cap', 'Capacidad', { type: 'number', val: '4', extra: ' min="1" step="1"' })}
            </div>
            ${campoAuth('sa-mapa', 'Ubicación en el mapa', { ph: 'Enlace de Google Maps', max: 300 })}
            <div class="row2">
              ${campoAuth('sa-lat', 'Latitud', { ph: '-31.4201', extra: ' inputmode="decimal"' })}
              ${campoAuth('sa-lng', 'Longitud', { ph: '-64.1888', extra: ' inputmode="decimal"' })}
            </div>
            <div class="row wrap">
              <button type="button" class="btn btn-sm" data-accion-ubicacion="ubicar">🗺 Ubicar en el mapa</button>
              <button type="button" class="btn btn-sm" data-accion-ubicacion="buscar">🔎 Buscar por dirección</button>
            </div>
            <p class="muted small">Es lo primero que ven los músicos: con la ubicación, tu sala aparece en el mapa de Más Música.</p>
            <h3 class="sub">Horario de atención</h3>
            <div class="dias-sel" id="sa-dias">
              <label class="check"><input type="checkbox" value="1" checked> Lun</label>
              <label class="check"><input type="checkbox" value="2" checked> Mar</label>
              <label class="check"><input type="checkbox" value="3" checked> Mié</label>
              <label class="check"><input type="checkbox" value="4" checked> Jue</label>
              <label class="check"><input type="checkbox" value="5" checked> Vie</label>
              <label class="check"><input type="checkbox" value="6"> Sáb</label>
              <label class="check"><input type="checkbox" value="0"> Dom</label>
            </div>
            <div class="row2">
              ${campoAuth('sa-open', 'Abre', { type: 'time', val: '10:00' })}
              ${campoAuth('sa-close', 'Cierra', { type: 'time', val: '22:00' })}
            </div>
            <h3 class="sub">Equipamiento disponible</h3>
            ${campoAuth('sa-eq-instrumentos', 'Instrumentos', { ph: 'Ej.: Guitarra, Bajo, Batería', max: 300 })}
            ${campoAuth('sa-eq-bateria', 'Batería', { max: 300 })}
            ${campoAuth('sa-eq-amp', 'Amplificadores', { max: 300 })}
            ${campoAuth('sa-eq-micro', 'Micrófonos', { max: 300 })}
            ${campoAuth('sa-eq-consola', 'Consola / sonido', { max: 300 })}
            ${campoAuth('sa-eq-otros', 'Otros', { max: 300 })}
            <div class="auth-foto">
              <div class="sala-foto-edit" id="sa-preview">${fotoTemporal ? `<img src="${fotoTemporal}" alt="previsualización">` : '<span class="sala-chip-foto" style="width:60px;height:60px;font-size:1.6rem">🎛️</span>'}</div>
              <div class="auth-foto-txt">
                <label class="btn btn-sm">🏷️ Logo de la sala<input type="file" id="sa-logo" accept="image/*" hidden></label>
                <span class="muted small">Opcional</span>
              </div>
            </div>
            <label class="campo" data-campo="sa-fotos">
              <span class="campo-lbl">Fotografías</span>
              <input type="file" id="sa-fotos" accept="image/*" multiple>
              <span class="campo-msg"></span>
            </label>
            <button class="btn btn-primary btn-block btn-lg" type="submit">Enviar solicitud de publicación</button>
          </form>`}
      </div>`;
  }
}

/* ---------- Acciones de la pantalla de acceso ---------- */
function wireAuth() {
  const b = $('#auth-body');

  b.onclick = e => {
    /* Mostrar / ocultar contraseña */
    const eye = e.target.closest('[data-ver]');
    if (eye) {
      const inp = document.getElementById(eye.dataset.ver);
      if (inp) {
        const ver = inp.type === 'password';
        inp.type = ver ? 'text' : 'password';
        eye.innerHTML = ver
          ? '<svg class="pass-eye-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
          : '<svg class="pass-eye-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
        inp.focus();
      }
      return;
    }
    const v = e.target.closest('[data-vista]');
    if (v) {
      pantallaAuth(v.dataset.vista);
    }
  };

  /* Foto de perfil / logo */
  b.addEventListener('change', e => {
    const id = e.target.id;
    if (id === 'mu-foto' || id === 'sa-logo') {
      const f = e.target.files[0];
      if (!f) return;
      comprimirImagen(f, 420)
        .then(url => {
          fotoTemporal = url;
          const prev = id === 'mu-foto' ? $('#mu-preview') : $('#sa-preview');
          if (prev) prev.innerHTML = `<img src="${url}" alt="previsualización">`;
        })
        .catch(err => toast(err.message || 'No se pudo leer la imagen', 'error'));
    }
  });

  /* Validación en vivo: al escribir */
  b.addEventListener('input', e => {
    const i = e.target;
    if (!(i && i.matches && i.matches('[data-valida]'))) return;
    if (i.dataset.valida === 'usuario') i.value = i.value.toLowerCase();
    if (i.dataset.valida === 'password') {
      pintarFuerza(i);
      const p2 = document.getElementById('mu-pass2');
      if (p2 && p2.value) validarInput(p2);
    }
    /* Si el campo ya estaba en error, se revisa mientras se corrige */
    const w = i.closest('.campo');
    if (w && w.classList.contains('error')) validarInput(i);
  });

  /* Validación al salir del campo + chequeo de disponibilidad */
  b.addEventListener('blur', e => {
    const i = e.target;
    if (!(i && i.matches && i.matches('[data-valida]'))) return;
    validarInput(i);
    if (i.dataset.valida === 'usuario' || i.dataset.valida === 'email') chequearDisponible(i);
  }, true);

  /* Ubicación de la sala: tocar el mapa o buscar la dirección */
  b.addEventListener('click', e => {
    const act = e.target.closest('[data-accion-ubicacion]');
    if (!act) return;
    const accion = act.dataset.accionUbicacion;
    if (accion === 'ubicar') {
      abrirSelectorUbicacion($('#sa-lat').value, $('#sa-lng').value, 'Ubicá tu sala').then(p => {
        if (!p) return;
        $('#sa-lat').value = p.lat.toFixed(5);
        $('#sa-lng').value = p.lng.toFixed(5);
        toast('Ubicación puesta 📍', 'ok');
      });
    } else if (accion === 'buscar') {
      buscarDireccion($('#sa-direccion').value + ' ' + $('#sa-loc').value).then(p => {
        if (!p) return;
        $('#sa-lat').value = p.lat.toFixed(5);
        $('#sa-lng').value = p.lng.toFixed(5);
        toast('Dirección encontrada 📍', 'ok');
      });
    }
  });

  b.onsubmit = async e => {
    const f = e.target;
    e.preventDefault();

    /* Primero valida todo el formulario */
    if (!validarFormulario(f)) {
      toast('Revisá los datos marcados', 'warn');
      return;
    }

    const btn = f.querySelector('button[type=submit]');
    const texto = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
    try {
      if (f.id === 'f-login') await iniciarSesion($('#lg-user').value.trim(), $('#lg-pass').value);
      else if (f.id === 'f-pin') await loginConPinAuth($('#pn-pin').value);
      else if (f.id === 'f-ayuda') await enviarPedidoAyuda();
      else if (f.id === 'f-musico') await registrarMusico(f);
      else if (f.id === 'f-duenio') {
        if (!$('#sg-soy').checked) { toast('Confirmá que sos responsable de la sala', 'warn'); return; }
        datosDuenio = {
          nombre: $('#sg-nombre').value.trim(),
          usuario: $('#sg-usuario').value.trim().toLowerCase(),
          email: $('#sg-email').value.trim(),
          telefono: $('#sg-tel').value.trim(),
          password: $('#sg-pass').value,
        };
        pantallaAuth('duenio-sala');
      } else if (f.id === 'f-sala') await registrarSala();
    } catch (err) {
      /* Si el error es de un dato puntual (usuario/email en uso, etc.), se marca el campo */
      if (!mapearErrorServidor(err.message)) toast(err.message || 'No se pudo completar la operación', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = texto; }
    }
  };
}

async function registrarMusico(form) {
  const instrumentos = $('#mu-inst').value.split(',').map(s => s.trim()).filter(Boolean);
  const data = await api('/api/auth/registro', {
    method: 'POST',
    body: {
      nombre: $('#mu-nombre').value.trim(),
      usuario: $('#mu-usuario').value.trim().toLowerCase(),
      email: $('#mu-email').value.trim(),
      telefono: $('#mu-tel').value.trim(),
      password: $('#mu-pass').value,
      localidad: $('#mu-loc').value.trim(),
      instrumentos,
      foto: fotoTemporal || '',
    },
  });
  fotoTemporal = '';
  await iniciarSesionConToken(data);
  toast('¡Bienvenido a Más Música! 🎸', 'ok');
  irInicio();
}

async function registrarSala() {
  if (!datosDuenio) { pantallaAuth('duenio'); return; }
  const archivos = Array.from($('#sa-fotos').files || []).slice(0, 6);
  const fotos = [];
  for (const f of archivos) {
    try { fotos.push({ foto: await comprimirImagen(f, 1200) }); } catch (e) { /* se omite esa foto */ }
  }
  const dias = $$('#sa-dias input:checked').map(i => Number(i.value));
  const data = await api('/api/auth/registro-sala', {
    method: 'POST',
    body: {
      nombre: datosDuenio.nombre,
      usuario: datosDuenio.usuario,
      email: datosDuenio.email,
      telefono: datosDuenio.telefono,
      password: datosDuenio.password,
      foto: '',
      sala: {
        name: $('#sa-name').value.trim(),
        direccion: $('#sa-direccion').value.trim(),
        localidad: $('#sa-loc').value.trim(),
        telefono: $('#sa-tel').value.trim(),
        descripcion: $('#sa-desc').value.trim(),
        price: Number($('#sa-price').value),
        capacity: Number($('#sa-cap').value),
        mapa: $('#sa-mapa').value.trim(),
        lat: $('#sa-lat').value.trim(),
        lng: $('#sa-lng').value.trim(),
        dias,
        horario: [$('#sa-open').value, $('#sa-close').value],
        equipos: {
          instrumentos: $('#sa-eq-instrumentos').value.trim(),
          bateria: $('#sa-eq-bateria').value.trim(),
          amplificadores: $('#sa-eq-amp').value.trim(),
          microfonos: $('#sa-eq-micro').value.trim(),
          consola: $('#sa-eq-consola').value.trim(),
          otros: $('#sa-eq-otros').value.trim(),
        },
        fotos,
        logo: fotoTemporal || '',
      },
    },
  });
  fotoTemporal = '';
  datosDuenio = null;
  await iniciarSesionConToken(data);
  toast('Solicitud enviada. Revisamos tu sala y te avisamos.', 'ok');
  mostrarPanel();
}

async function enviarPedidoAyuda() {
  const data = await api('/api/auth/ayuda', {
    method: 'POST',
    body: {
      motivo: $('#ay-motivo').value,
      usuario: $('#ay-ident').value.trim(),
      mensaje: $('#ay-msj').value.trim(),
    },
  });
  toast(data.mensaje || 'Pedido enviado ✓', 'ok');
  pantallaAuth('inicio');
}

async function iniciarSesion(user, pass) {
  const data = await api('/api/auth/login', { method: 'POST', body: { usuario: user, password: pass } });
  await iniciarSesionConToken(data);
  toast(`¡Hola, ${data.user.nombre.split(' ')[0]}!`, 'ok');
  irInicio();
}

/* Inicio de sesión con PIN desde la pantalla de acceso: entra al Inicio, no al panel */
async function loginConPinAuth(pin) {
  const data = await api('/api/auth/pin', { method: 'POST', body: { pin } });
  await iniciarSesionConToken(data);
  marcarDispositivoAdmin();
  adminMode = true;
  toast('Sesión de administrador general iniciada', 'ok');
  irInicio();
}

async function iniciarSesionConToken(data) {
  guardarToken(data.token);
  yo = data.user;
  miSala = data.room || null;
  state = await api('/api/state');
  adminMode = esSuper();
  await cargarNotificaciones();
  mostrarApp();
  renderCalendar();
  renderRooms();
  goStep(1);
  renderMineRapido();
  renderMapa();
  renderMine();   /* el perfil se repinta siempre: nada queda de la cuenta anterior */
}

async function cerrarSesion() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) { /* sin conexión */ }
  guardarToken('');
  yo = null; miSala = null; notificaciones = []; sinLeer = 0;
  adminMode = false; adminPin = '';
  $('#btn-exit-admin').hidden = true;
  cerrarPanelAjustes();
  cerrarPanelNotif();
  closeModal();
  /* Al salir se vuelve al inicio de todo: registrarse o iniciar sesión (sin modo espectador) */
  pantallaAuth('inicio');
  toast('Sesión cerrada', 'ok');
}

async function cargarNotificaciones() {
  if (!yo) { notificaciones = []; sinLeer = 0; pintarBadgeNotif(); return; }
  try {
    const data = await api('/api/notificaciones');
    notificaciones = data.notificaciones || [];
    sinLeer = data.sinLeer || 0;
  } catch (e) { notificaciones = []; sinLeer = 0; }
  pintarBadgeNotif();
}

/* ---------- Panel de notificaciones (se despliega desde arriba) ---------- */
const ES_CONFIRMADA = n => /confirmada|modificada/i.test(n.titulo || '');
const ES_CANCELADA = n => /cancelada/i.test(n.titulo || '');

async function abrirPanelNotif() {
  const drop = $('#notif-drop');
  if (!drop) return;
  await cargarNotificaciones();
  renderPanelNotif();
  prepararSwipeNotif();
  drop.classList.add('open');
  drop.setAttribute('aria-hidden', 'false');
  /* Marcar la bienvenida como vista (solo aparece una vez) */
  localStorage.setItem('mm-bienvenida-vista', '1');
}

function cerrarPanelNotif() {
  const drop = $('#notif-drop');
  if (!drop) return;
  drop.classList.remove('open');
  drop.setAttribute('aria-hidden', 'true');
}

function renderPanelNotif() {
  const bod = $('#notif-sheet-body');
  const sub = $('#notif-sheet-sub');
  if (!bod) return;
  sub.textContent = notificaciones.length
    ? (sinLeer ? `${sinLeer} sin leer · ${notificaciones.length} en total` : `${notificaciones.length} aviso(s)`)
    : 'Nada por acá todavía';
  $('#notif-panel-leer').hidden = !sinLeer;
  $('#notif-panel-borrar-todas').hidden = !notificaciones.length;

  /* Las promos de bienvenida solo se muestran una vez */
  const bienvenidaVista = localStorage.getItem('mm-bienvenida-vista') === '1';
  const promos = promosActivas().filter(p => {
    if (/bienvenido/i.test(p.titulo || '') && bienvenidaVista) return false;
    return true;
  });
  const promosHtml = promos.length ? promos.map(itemPromo).join('') : '';

  bod.innerHTML = promosHtml + (notificaciones.length
    ? notificaciones.map(itemNotif).join('')
    : `<div class="notif-vacio"><b>No tenés notificaciones</b>Te avisamos cuando confirmes, modifiquen o cancelen una reserva tuya.</div>`);
}

/* Promociones y novedades de la administración → también viven en la campana */
function promosActivas() {
  const ahora = Date.now();
  return (state.promociones || []).filter(p => p.activa !== false
    && (!p.desde || p.desde <= ahora) && (!p.hasta || p.hasta >= ahora));
}

function itemPromo(p) {
  const rango = [p.desde, p.hasta].filter(Boolean)
    .map(ts => new Date(ts).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }))
    .join(' → ');
  return `<div class="notif-item promo-item" data-promo-id="${p.id}" role="button" tabindex="0" title="Ver promoción">
    <span class="notif-chip info">🎉</span>
    <div class="notif-txt">
      <strong>${esc(p.titulo)}</strong>
      <span>${esc(p.texto)}</span>
      <small class="muted">${rango ? 'Vigencia ' + rango : 'Promoción de las salas'}</small>
    </div>
    <svg class="notif-flecha" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>
  </div>`;
}

function abrirPromo(id) {
  const p = (state.promociones || []).find(x => x.id === id);
  if (!p) return;
  /* Promos de registro → panel de administración (super admin) */
  if (/registro|registr/i.test(p.titulo || '') && esSuper()) {
    cerrarPanelNotif();
    showAdmin();
    return;
  }
  /* Promos de bienvenida → solo cerrar, no navegar */
  if (/bienvenido/i.test(p.titulo || '')) {
    cerrarPanelNotif();
    return;
  }
  openModal(`<h3>${esc(p.titulo)}</h3>
    ${p.flyer ? `<img class="promo-flyer-img" src="${esc(p.flyer)}" alt="Flyer de ${esc(p.titulo)}">` : ''}
    ${p.texto ? `<p>${esc(p.texto)}</p>` : ''}
    ${linksRedesHTML(p.redes)}
    <div class="row"><button class="btn" onclick="closeModal()">Cerrar</button></div>`);
}

function itemNotif(n) {
  const chip = n.tipo === 'ok' ? '<span class="notif-chip ok">✓</span>'
    : n.tipo === 'warn' ? '<span class="notif-chip warn">✕</span>'
      : '<span class="notif-chip info">!</span>';
  return `<div class="notif-item ${n.leida ? '' : 'nueva'}" data-notif-id="${n.id}" role="button" tabindex="0" title="Ver la reserva">
    ${chip}
    <div class="notif-txt">
      <strong>${esc(n.titulo)}</strong>
      <span>${esc(n.texto)}</span>
      <small class="${n.leida ? 'muted' : ''}">${fechaNotif(n.fecha)}</small>
    </div>
    <button class="notif-borrar" data-borrar-notif="${n.id}" title="Borrar aviso" aria-label="Borrar aviso">✕</button>
    <svg class="notif-flecha" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>
  </div>`;
}

function fechaNotif(ts) {
  const d = new Date(ts);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return d.toDateString() === new Date().toDateString()
    ? `hoy · ${hm}`
    : `${d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })} · ${hm}`;
}

async function marcarLeidasPanel() {
  try {
    await api('/api/notificaciones/leer', { method: 'POST' });
    await cargarNotificaciones();
    renderPanelNotif();   /* el panel sigue abierto, se repinta */
  } catch (e) { toast(e.message, 'error'); }
}

/* Borrar una notificación individual (con animación de cierre) */
async function borrarNotificacion(id, itemEl) {
  try {
    await api('/api/notificaciones/' + id, { method: 'DELETE' });
    notificaciones = notificaciones.filter(n => n.id !== id);
    /* Animar: colapsar la tarjeta para que las demás suban */
    if (itemEl) {
      itemEl.style.transition = 'height .3s ease, margin .3s ease, padding .3s ease, opacity .25s ease, transform .25s ease';
      itemEl.style.height = itemEl.offsetHeight + 'px';
      itemEl.style.overflow = 'hidden';
      requestAnimationFrame(() => {
        itemEl.style.height = '0px';
        itemEl.style.margin = '0px';
        itemEl.style.padding = '0px';
        itemEl.style.opacity = '0';
        itemEl.style.transform = 'scale(.95)';
      });
      setTimeout(() => { renderPanelNotif(); pintarBadgeNotif(); }, 320);
    } else {
      renderPanelNotif();
      pintarBadgeNotif();
    }
  } catch (e) { toast(e.message, 'error'); }
}

/* Borrar todas las notificaciones */
async function borrarTodasNotificaciones() {
  if (!notificaciones.length) return;
  try {
    await api('/api/notificaciones', { method: 'DELETE' });
    notificaciones = [];
    renderPanelNotif();
    pintarBadgeNotif();
    toast('Avisos borrados', 'ok');
  } catch (e) { toast(e.message, 'error'); }
}

/* Deslizar una notificación para borrarla (swipe a izquierda o derecha)
   y deslizar hacia arriba para cerrar el panel */
function prepararSwipeNotif() {
  const cont = $('#notif-sheet-body');
  const sheet = $('#notif-sheet');
  if (!cont || cont._swipeOk) return;
  cont._swipeOk = true;
  let activo = null, x0 = 0, y0 = 0, dx = 0, dy = 0;

  cont.addEventListener('touchstart', e => {
    const item = e.target.closest('.notif-item');
    if (!item || e.target.closest('.notif-borrar')) return;
    activo = item;
    x0 = e.touches[0].clientX;
    y0 = e.touches[0].clientY;
    dx = 0; dy = 0;
    item.style.transition = 'none';
  }, { passive: true });

  cont.addEventListener('touchmove', e => {
    if (!activo) return;
    dx = e.touches[0].clientX - x0;
    dy = e.touches[0].clientY - y0;
    /* Swipe horizontal → borrar */
    if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
      activo.style.transform = `translateX(${Math.max(-90, Math.min(90, dx))}px)`;
      activo.classList.add('swipe-borrando');
    }
  }, { passive: true });

  cont.addEventListener('touchend', () => {
    if (!activo) return;
    const item = activo;
    activo = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
      borrarNotificacion(item.dataset.notifId, item);
    } else {
      item.style.transition = 'transform .25s ease';
      item.style.transform = '';
      item.classList.remove('swipe-borrando');
    }
  });

  /* Swipe hacia arriba en el panel → cerrar */
  if (sheet && !sheet._swipeUpOk) {
    sheet._swipeUpOk = true;
    let yStart = 0, yEnd = 0;
    sheet.addEventListener('touchstart', e => {
      if (e.target.closest('.notif-item')) return;   /* las notificaciones manejan su propio swipe */
      yStart = e.touches[0].clientY;
      yEnd = yStart;
    }, { passive: true });
    sheet.addEventListener('touchmove', e => {
      yEnd = e.touches[0].clientY;
    }, { passive: true });
    sheet.addEventListener('touchend', () => {
      if (yStart - yEnd > 80) cerrarPanelNotif();   /* subió más de 80px */
      yStart = 0; yEnd = 0;
    });
  }
}

/* ---------- Navegación desde una notificación ---------- */
async function irANotificacion(id) {
  const n = notificaciones.find(x => x.id === id);
  cerrarPanelNotif();
  if (!n) return;
  /* Estado fresco para que la tarjeta destino exista al navegar */
  try {
    const fresh = await api('/api/state');
    if (fresh && Array.isArray(fresh.reservations)) state = fresh;
  } catch (e) { /* offline: usar el estado local */ }
  const r = n.reservaId ? state.reservations.find(x => x.id === n.reservaId) : null;

  /* Avisos dirigidos al dueño de una sala → su panel de administración, pestaña Reservas */
  if (n.para === 'dueno' && esDueño() && n.roomId) {
    const room = state.rooms.find(x => x.id === n.roomId);
    if (room) {
      mostrarPanel().then(() => {
        renderPanelTab('reservas');
        if (r) setTimeout(() => resaltarReserva(r.id, '#ps-reservas'), 100);
      });
      return;
    }
  }

  /* Avisos de reservas propias → "Mis reservas" filtradas (próximas / historial) */
  if (r) {
    irReservasFiltradas(/cancelada/i.test(n.titulo || '') ? 'historial' : 'proximas');
    setTimeout(() => resaltarReserva(r.id, '#home-mine-body'), 180);
    return;
  }

  /* Avisos de nuevo registro → panel de administración */
  if (/registro|registr/i.test(n.titulo || '') && esSuper()) {
    showAdmin();
    return;
  }

  /* Avisos de cuenta / perfil / bienvenida → solo mostrar, no navegar, se borran solos */
  if (/bienvenido/i.test(n.titulo || '')) {
    const itemEl = document.querySelector(`[data-notif-id="${n.id}"]`);
    borrarNotificacion(n.id, itemEl);
    cerrarPanelNotif();
    return;
  }

  /* Otros avisos sin reserva → Inicio */
  cerrarPanelNotif();
  const navInicio = document.getElementById('nav-inicio');
  if (navInicio) navInicio.click();
}

/* Marca visualmente la tarjeta de una reserva y la trae al centro */
function resaltarReserva(id, hostSel) {
  const host = $(hostSel);
  if (!host) return;
  const card = host.querySelector(`[data-res="${id}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.classList.add('res-destacada');
  setTimeout(() => card.classList.remove('res-destacada'), 2600);
}

/* ---------- Panel de Ajustes (se despliega desde arriba, igual que el de avisos) ---------- */
function abrirPanelAjustes() {
  const drop = $('#ajustes-drop');
  if (!drop) return;
  renderPanelAjustes();
  drop.classList.add('open');
  drop.setAttribute('aria-hidden', 'false');
}

function cerrarPanelAjustes() {
  const drop = $('#ajustes-drop');
  if (!drop) return;
  drop.classList.remove('open');
  drop.setAttribute('aria-hidden', 'true');
}

/* Toda la configuración: cuenta, preferencias, reservas y ayuda */
function renderPanelAjustes() {
  const bod = $('#ajustes-sheet-body');
  if (!bod) return;
  const sub = $('#ajustes-sheet-sub');
  const instrumentos = (yo.instrumentos || []).join(', ');
  const mias = misReservas();
  const nProx = mias.filter(r => !esPasada(r) && r.estado !== 'cancelada').length;
  const nHist = mias.filter(r => esPasada(r) || r.estado === 'cancelada').length;
  const nFav = (yo.favoritos || []).length;
  const prefAvisos = localStorage.getItem('mm-avisos-toast') !== '0';
  const tTema = temaActual();
  if (sub) sub.textContent = yo ? `@${yo.usuario} · configuración` : 'Configuración y preferencias';
  bod.innerHTML = `
    <p class="aj-lbl" style="margin-top:6px">Mi cuenta</p>
    <div class="aj-card">
      ${filaAj('datos', ICO_AJ.persona, 'Datos personales', yo.email || '')}
      ${filaAj('pass', ICO_AJ.candado, 'Contraseña')}
      ${esCuentaControl() ? '' : filaAj('inst', ICO_AJ.nota, 'Mis instrumentos', instrumentos || 'Agregá los que tocás')}
      ${esDueño() ? filaAj('panel', ICO_AJ.panel, 'Mi panel de sala', miSala ? `${esc(miSala.name)} · ${miSala.estado}` : '') : ''}
      ${esSuper() ? filaAj('admin', ICO_AJ.engranaje, 'Panel de administración') : ''}
    </div>

    <p class="aj-lbl">Preferencias</p>
    <div class="aj-card">
      <label class="aj-row" for="aj-notif">
        ${svgAj(ICO_AJ.campana)}
        <span class="aj-txt">Notificaciones de reservas</span>
        <input type="checkbox" id="aj-notif" ${prefAvisos ? 'checked' : ''}>
      </label>
      ${filaAj('zona', ICO_AJ.pin, 'Mi zona', yo.localidad || 'Sin definir')}
      ${filaAj('avisos', ICO_AJ.buzon, 'Mis avisos', sinLeer ? `${sinLeer} sin leer` : notificaciones.length ? `${notificaciones.length} avisos` : 'Sin avisos')}
      <div class="aj-row aj-apariencia">
        ${svgAj(ICO_AJ.luna)}
        <span class="aj-txt">Apariencia</span>
        <span class="aj-seg">
          <button type="button" data-tema="auto" ${tTema === 'auto' ? 'class="on"' : ''}>Automático</button>
          <button type="button" data-tema="claro" ${tTema === 'claro' ? 'class="on"' : ''}>Claro</button>
          <button type="button" data-tema="oscuro" ${tTema === 'oscuro' ? 'class="on"' : ''}>Oscuro</button>
        </span>
      </div>
    </div>

    <p class="aj-lbl">Mis reservas</p>
    <div class="aj-card">
      ${filaAj('proximas', ICO_AJ.cal, 'Próximas reservas', `${nProx} reserva${nProx === 1 ? '' : 's'}`)}
      ${filaAj('historial', ICO_AJ.reloj, 'Historial', `${nHist} reserva${nHist === 1 ? '' : 's'}`)}
      ${esCuentaControl() ? '' : filaAj('favoritas', ICO_AJ.corazon, 'Salas favoritas', `${nFav} guardada${nFav === 1 ? '' : 's'}`)}
    </div>

    <p class="aj-lbl">Ayuda</p>
    <div class="aj-card">
      ${filaAj('ayuda', ICO_AJ.ayuda, 'Ayuda y contacto')}
      ${filaAj('terminos', ICO_AJ.doc, 'Términos y condiciones')}
    </div>

    <button class="aj-salir" id="btn-logout-perfil">
      ${svgAj(ICO_AJ.salir, 'aj-ico', 20)} Cerrar sesión
    </button>`;
}

/* ---------- Filas de Ajustes (formato del mockup) ---------- */
const ICO_AJ = {
  persona: '<circle cx="12" cy="8" r="4"></circle><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"></path>',
  candado: '<rect x="4" y="11" width="16" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path>',
  nota: '<path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle>',
  panel: '<line x1="5" y1="3" x2="5" y2="21"></line><line x1="12" y1="3" x2="12" y2="21"></line><line x1="19" y1="3" x2="19" y2="21"></line><circle cx="5" cy="15" r="2.2"></circle><circle cx="12" cy="8" r="2.2"></circle><circle cx="19" cy="13" r="2.2"></circle>',
  engranaje: '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"></path>',
  campana: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"></path>',
  telefono: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.13.96.36 1.9.7 2.8a2 2 0 0 1-.45 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.45c.9.34 1.84.57 2.8.7a2 2 0 0 1 1.7 2z"></path>',
  buzon: '<path d="M22 12h-6l-2 3h-4l-2-3H2"></path><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"></path><circle cx="12" cy="10" r="3"></circle>',
  luna: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"></path>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>',
  reloj: '<circle cx="12" cy="12" r="9"></circle><polyline points="12 7 12 12 15 14"></polyline>',
  corazon: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"></path>',
  ayuda: '<circle cx="12" cy="12" r="9"></circle><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12" y2="17.01"></line>',
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline>',
  salir: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line>',
};
const svgAj = (path, cls = 'aj-ico', size = 22) =>
  `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const chevronAj = `<svg class="aj-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>`;
const filaAj = (tipo, ico, texto, extra = '') => `
  <button class="aj-row" data-aj="${tipo}">
    ${svgAj(ico)}
    <span class="aj-txt">${texto}${extra ? `<small>${extra}</small>` : ''}</span>
    ${chevronAj}
  </button>`;

/* ---------- Perfil del usuario ---------- */
function renderPerfilCuenta() {
  const box = $('#mine-user');
  const fav = $('#mine-favoritas');
  const notif = $('#mine-notif');

  if (!yo) {
    box.hidden = false;
    box.innerHTML = `
      <div class="panel-head"><h2>Mi perfil</h2></div>
      <p class="muted">No iniciaste sesión. Creá tu cuenta para guardar tus reservas, tus salas favoritas y recibir avisos.</p>
      <div class="row wrap">
        <button class="btn btn-primary" data-auth="login">Iniciar sesión</button>
        <button class="btn" data-auth="musico">Crear cuenta de músico</button>
        <button class="btn" data-auth="duenio">Registrar mi sala</button>
      </div>`;
    fav.hidden = true;
    notif.hidden = true;
    return;
  }

  box.hidden = false;
  const instrumentos = (yo.instrumentos || []).join(', ');
  const nReservas = misReservas().length;
  const nFavoritas = (yo.favoritos || []).length;
  const nBandas = (state.bandas || []).filter(b => b.integrantes && b.integrantes.some(i => i.nombre && i.nombre.toLowerCase().includes((yo.nombre || '').toLowerCase()))).length || 0;
  box.innerHTML = `
    <div class="panel-head"><h2>Mis datos</h2></div>
    <div class="aj-cuenta">
      <div class="user-avatar aj-avatar">${yo.foto ? `<img src="${esc(yo.foto)}" alt="${esc(yo.nombre)}">` : esc((yo.nombre || '?').trim().charAt(0).toUpperCase())}</div>
      <div class="aj-cuenta-txt">
        <strong>${esc(yo.nombre)}</strong>
        <span>@${esc(yo.usuario)}${yo.localidad ? ' · ' + esc(yo.localidad) : ''}</span>
        <span class="aj-badges">
          <span class="badge">${esDueño() ? '🎛️ Dueño de sala' : esSuper() ? '👑 Administración general' : '🎸 Músico'}</span>
          ${miSala ? `<span class="badge ${miSala.estado === 'aprobada' ? '' : 'badge-next'}">Sala: ${esc(miSala.name)} · ${miSala.estado}</span>` : ''}
        </span>
      </div>
    </div>

    <div class="perfil-stats">
      <div class="perfil-stat"><strong>${nReservas}</strong><span>Reservas</span></div>
      <div class="perfil-stat"><strong>${nFavoritas}</strong><span>Favoritas</span></div>
      <div class="perfil-stat"><strong>${nBandas}</strong><span>Bandas</span></div>
    </div>

    <div class="row wrap" style="gap:12px;margin-bottom:14px">
      <button class="aj-editar" id="btn-editar-perfil">✏️ Editar perfil</button>
    </div>

    <p class="aj-lbl">Datos</p>
    <div class="aj-card">
      <div class="aj-row aj-dato">${svgAj(ICO_AJ.buzon)}
        <span class="aj-txt">Email<small>${esc(yo.email || 'Sin email')}</small></span>
      </div>
      <div class="aj-row aj-dato">${svgAj(ICO_AJ.telefono)}
        <span class="aj-txt">Teléfono<small>${esc(yo.telefono || 'Sin cargar')}</small></span>
      </div>
      <div class="aj-row aj-dato">${svgAj(ICO_AJ.pin)}
        <span class="aj-txt">Localidad<small>${esc(yo.localidad || 'Sin definir')}</small></span>
      </div>
      <div class="aj-row aj-dato">${svgAj(ICO_AJ.nota)}
        <span class="aj-txt">Instrumentos<small>${instrumentos || 'No agregaste ninguno'}</small></span>
      </div>
      <div class="aj-row aj-dato">${svgAj(ICO_AJ.cal)}
        <span class="aj-txt">Cuenta creada<small>${yo.creado ? fechaCorta(yo.creado) : '—'}</small></span>
      </div>
    </div>`;

  const salones = salasPublicas().filter(r => (yo.favoritos || []).includes(r.id));
  fav.hidden = false;
  fav.innerHTML = `
    <div class="panel-head"><h2>♥️ Mis salas favoritas</h2>
      <button class="btn btn-sm" id="fav-ver">Ver salas</button>
    </div>
    ${salones.length
      ? `<div class="mini-fotos">${salones.map(r => `<button class="fav-item" data-ir-sala="${r.id}">
          ${r.foto ? `<img src="${esc(r.foto)}" alt="">` : '<span class="sala-chip-foto">🎸</span>'}
          <span>${esc(r.name)}<small>${fmtMoney(r.price)}/h</small></span></button>`).join('')}</div>`
      : '<p class="muted small">Todavía no guardaste ninguna sala. Tocá el ♡ en una sala para guardarla acá.</p>'}`;

  /* Los avisos viven en la campana y en el panel de Ajustes del engranaje */
  notif.hidden = true;
  notif.innerHTML = '';
}

function fechaCorta(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) + ' ' +
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* ---------- Formulario de edición del perfil ---------- */
function formularioPerfil() {
  openModal(`
    <h3>Editar mi perfil</h3>
    <label>Nombre y apellido<input id="pe-nombre" maxlength="60" value="${esc(yo.nombre)}"></label>
    <label>Teléfono<input id="pe-tel" maxlength="30" value="${esc(yo.telefono || '')}"></label>
    <label>Localidad o zona<input id="pe-loc" maxlength="80" value="${esc(yo.localidad || '')}"></label>
    <label>Mis instrumentos (separados por coma)<input id="pe-inst" maxlength="200" value="${esc((yo.instrumentos || []).join(', '))}"></label>
    <label>Email<input value="${esc(yo.email)}" disabled></label>
    <div class="sala-foto-edit" id="pe-preview">${yo.foto ? `<img src="${esc(yo.foto)}" alt="">` : '<span class="sala-chip-foto" style="width:60px;height:60px;font-size:1.6rem">🎸</span>'}</div>
    <label>Nueva foto de perfil<input type="file" id="pe-foto" accept="image/*"></label>
    <div class="row">
      <button class="btn btn-primary" id="pe-guardar">💾 Guardar cambios</button>
      <button class="btn" id="pe-cancelar">Cancelar</button>
    </div>`);
  let nuevaFoto = null;
  $('#pe-foto').onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      nuevaFoto = await comprimirImagen(f, 420);
      $('#pe-preview').innerHTML = `<img src="${nuevaFoto}" alt="">`;
    } catch (err) { toast(err.message, 'error'); }
  };
  $('#pe-cancelar').onclick = closeModal;
  $('#pe-guardar').onclick = async () => {
    const body = {
      nombre: $('#pe-nombre').value.trim(),
      telefono: $('#pe-tel').value.trim(),
      localidad: $('#pe-loc').value.trim(),
      instrumentos: $('#pe-inst').value.split(',').map(s => s.trim()).filter(Boolean),
    };
    if (nuevaFoto) body.foto = nuevaFoto;
    try {
      const data = await api('/api/auth/perfil', { method: 'PUT', body });
      yo = data.user;
      closeModal();
      renderMine();
      toast('Perfil actualizado ✓', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  };
}

/* ---------- Acciones de la pantalla de Ajustes ---------- */
function irAAvisos() {
  cerrarPanelAjustes();
  abrirPanelNotif();
}

/* Próximas reservas / Historial: filtran "Mis reservas" del Inicio */
function irReservasFiltradas(tipo) {
  filtroMisReservas = tipo;
  busquedaMine = '';
  const inp = $('#home-search');
  if (inp) inp.value = '';
  irSalas();   /* "Mis reservas" vive en la vista de Salas, no en el Inicio */
  const host = $('#home-mine');
  if (host) setTimeout(() => host.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
}

/* Apariencia: claro / oscuro / automático (según el sistema) */
function temaActual() {
  return document.documentElement.getAttribute('data-tema') || 'oscuro';
}

function aplicarTema(tema) {
  document.documentElement.setAttribute('data-tema', tema);
  try { localStorage.setItem('mm-tema', tema); } catch (e) { /* navegación privada */ }
  const claro = tema === 'claro' ||
    (tema === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', claro ? '#f5f5f2' : '#0d1b2f');
  /* El favicon/ícono de la app sigue el tema: azul marino (oscuro) o verde (claro) */
  const fav = document.querySelector('link[rel="icon"]');
  if (fav) fav.href = claro ? 'assets/icon-app-claro-192.png' : 'assets/icon-app-oscuro-192.png';
  /* marca la opción elegida en la fila "Apariencia" si está a la vista */
  document.querySelectorAll('.aj-seg [data-tema]')
    .forEach(b => b.classList.toggle('on', b.dataset.tema === tema));
}

function elegirApariencia(tema) {
  const nombre = { auto: 'Automático', claro: 'Claro', oscuro: 'Oscuro' }[tema] || tema;
  aplicarTema(tema);
  toast(`Tema ${nombre} activo ✓`, 'ok');
}

/* En modo automático, sigue los cambios del sistema */
try {
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (temaActual() === 'auto') aplicarTema('auto');
  });
} catch (e) { /* navegadores sin soporte */ }

function accionAjustes(tipo) {
  cerrarPanelAjustes();
  switch (tipo) {
    case 'datos':
    case 'inst':
    case 'zona':
      return formularioPerfil();
    case 'pass': return formularioPassword();
    case 'panel': return mostrarPanel();
    case 'admin': return esSuper() ? showAdmin() : enterAdmin();
    case 'avisos': return abrirPanelNotif();
    case 'proximas':
    case 'historial': return irReservasFiltradas(tipo);
    case 'favoritas': {
      setTimeout(() => {
        const f = $('#mine-favoritas');
        if (f) f.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 60);
      return;
    }
    case 'ayuda': return modalAyuda();
    case 'terminos': return modalTerminos();
  }
}

/* ---------- Cambiar contraseña de la cuenta ---------- */
function formularioPassword() {
  openModal(`
    <h3>Cambiar mi contraseña</h3>
    <label>Contraseña actual<input type="password" id="pc-actual" autocomplete="current-password" required></label>
    <label>Nueva contraseña<input type="password" id="pc-nueva" autocomplete="new-password" required></label>
    <label>Repetí la nueva contraseña<input type="password" id="pc-repetir" autocomplete="new-password" required></label>
    <div class="row">
      <button class="btn btn-primary" id="pc-guardar">Guardar contraseña</button>
      <button class="btn" id="pc-cancelar">Cancelar</button>
    </div>`);
  $('#pc-cancelar').onclick = closeModal;
  $('#pc-guardar').onclick = async () => {
    const actual = $('#pc-actual').value;
    const nueva = $('#pc-nueva').value;
    const repetir = $('#pc-repetir').value;
    if (nueva.length < 6) { toast('La nueva contraseña debe tener al menos 6 caracteres', 'warn'); return; }
    if (nueva !== repetir) { toast('Las contraseñas no coinciden', 'warn'); return; }
    const btn = $('#pc-guardar');
    btn.disabled = true;
    try {
      const data = await api('/api/auth/perfil', { method: 'PUT', body: { actual, password: nueva } });
      yo = data.user;
      closeModal();
      toast('Contraseña actualizada ✓', 'ok');
    } catch (e) {
      btn.disabled = false;
      toast(e.message, 'error');
    }
  };
}

/* ---------- Ayuda y contacto ---------- */
function modalAyuda() {
  const h = (state.settings.reglas && state.settings.reglas.cancelacionHoras) || 0;
  openModal(`
    <h3>Ayuda y contacto</h3>
    <ul class="ayuda-lista">
      <li><strong>1. Elegí la fecha</strong> en el Inicio, después la sala y el horario que querés.</li>
      <li><strong>2. Confirmá la reserva</strong> con el nombre de tu banda o el tuyo. Te llega un aviso en "Mis avisos".</li>
      <li><strong>3. ¿Necesitás cancelar?</strong> Podés hacerlo desde "Mis reservas" ${h ? `hasta ${h} horas antes` : 'en cualquier momento'} del horario reservado.</li>
      <li><strong>4. ¿Hablás con la sala?</strong> Abrí la sala en el Mapa y tocá "📍 Google Maps" o "📞 Llamar".</li>
      <li><strong>5. ¿Alquilás un instrumento?</strong> Marcalo en el paso de confirmación y se suma a tu reserva.</li>
    </ul>
    <div class="row"><button class="btn btn-primary" onclick="closeModal()">Entendido</button></div>`);
}

/* ---------- Términos y condiciones ---------- */
function modalTerminos() {
  const h = (state.settings.reglas && state.settings.reglas.cancelacionHoras) || 0;
  openModal(`
    <h3>Términos y condiciones</h3>
    <div class="terminos">
      <p><strong>Uso de la app.</strong> +Música conecta a músicos con salas de ensayo independientes. La app solo organiza la reserva: el ensayo se realiza en la sala elegida.</p>
      <p><strong>Reservas.</strong> Cada reserva queda a nombre de la banda o del músico que la confirma y habilita el horario elegido. Los horarios ocupados aparecen tachados para el resto de los usuarios.</p>
      <p><strong>Cancelaciones.</strong> ${h ? `Podés cancelar hasta ${h} horas antes del inicio del ensayo. Después de ese plazo la sala puede mantener el horario reservado.` : 'Podés cancelar la reserva desde "Mis reservas" mientras el ensayo no haya comenzado.'}</p>
      <p><strong>Precios y alquileres.</strong> El precio por hora y el de los instrumentos en alquiler los define cada sala y se muestran antes de confirmar. El total se calcula en el servidor.</p>
      <p><strong>Datos personales.</strong> Guardamos tu nombre, usuario, email, teléfono, localidad e instrumentos para operar tus reservas y avisos. Podés editarlos o pedir la baja de tu cuenta en cualquier momento.</p>
      <p><strong>Salas asociadas.</strong> Cada sala es responsable de su información, sus fotos, sus horarios y la atención en su establecimiento.</p>
    </div>
    <div class="row"><button class="btn btn-primary" onclick="closeModal()">Cerrar</button></div>`);
}

/* ---------- Panel del dueño de la sala ---------- */
let panelTab = 'inicio';
let panelDatos = null;
let panelLogoTmp = '';
let panelPortadaTmp = '';
let panelFotosTmp = [];

async function mostrarPanel() {
  if (!yo || (!esDueño() && !esSuper())) { toast('Iniciá sesión como dueño de sala', 'warn'); return; }
  await cargarPanel();
  ocultarVistas();
  $('#view-panel').hidden = false;
  renderPanelTab(panelTab);
  actualizarAccionesHeader();
}

function salirDelPanel() {
  ocultarVistas();
  $('#view-public').hidden = false;
  renderCalendar();
  renderRooms();
  goStep(1);
  setNav('inicio');
}

async function cargarPanel() {
  try {
    panelDatos = await api('/api/panel/sala' + (miSala ? '?roomId=' + encodeURIComponent(miSala.id) : ''));
    miSala = panelDatos.room;
  } catch (e) {
    toast(e.message, 'error');
    panelDatos = null;
  }
}

function renderPanelTab(tab) {
  panelTab = tab;
  $$('.admin-tab[data-ptab]').forEach(b => b.classList.toggle('active', b.dataset.ptab === tab));
  ['inicio', 'sala', 'disponibilidad', 'reservas', 'movimientos', 'datos'].forEach(t => { $('#ptab-' + t).hidden = t !== tab; });
  if (!panelDatos) return;
  renderPanelEstado();
  ({ inicio: renderPanelInicio, sala: renderPanelSala, disponibilidad: renderPanelDisponibilidad, reservas: renderPanelReservas, movimientos: renderPanelMovimientos, datos: renderPanelDatos }[tab])();
}

/* Inicio del panel de sala: resumen del día de su sala */
function renderPanelInicio() {
  const cont = $('#panel-inicio');
  if (!cont) return;
  const hoy = todayStr();
  const todas = (panelDatos.reservas || []).filter(r => r.estado !== 'cancelada');
  const lista = todas.filter(r => r.date === hoy).sort((a, b) => a.start.localeCompare(b.start));
  const ingresos = lista.reduce((s, r) => s + precioReserva(r), 0);
  const pendPago = lista.filter(r => r.estado === 'pendiente_pago').length;
  const semana = todas.filter(r => r.date > hoy && r.date <= addDaysStr(hoy, 7)).length;
  const promos = promosActivas();
  const fechaTxt = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });

  cont.innerHTML = `
    <div class="inicio-saludo">
      <h2>${esc(panelDatos.room ? panelDatos.room.name : 'Mi sala')}</h2>
      <p class="muted small">${esc(fechaTxt)}</p>
    </div>

    <div class="admin-stats inicio-stats">
      <div class="stat"><span>Reservas hoy</span><b>${lista.length}</b></div>
      <div class="stat"><span>Ingresos de hoy</span><b>${fmtMoney(ingresos)}</b></div>
      <div class="stat"><span>Pendientes de pago</span><b>${pendPago}</b></div>
      <div class="stat"><span>Próximos 7 días</span><b>${semana}</b></div>
    </div>

    <div class="inicio-grid">
      <section class="inicio-card">
        <h3>Reservas de hoy</h3>
        ${lista.length ? `<ul class="inicio-prox">${lista.slice(0, 6).map(r => `
          <li><time>${esc(r.start)}–${esc(r.end)}</time><span class="nom">${esc(r.name)}</span><span class="sala">${esc(r.phone || '')}</span></li>`).join('')}</ul>`
          : '<p class="muted small">No hay reservas para hoy.</p>'}
        <div class="inicio-pie"><button class="btn btn-sm" data-goto-ptab="reservas">Ver todas las reservas</button></div>
      </section>

      <section class="inicio-card">
        <h3>Accesos rápidos</h3>
        <div class="inicio-links">
          <button class="inicio-link" data-goto-ptab="sala"><span>Mi sala</span><i>›</i></button>
          <button class="inicio-link" data-goto-ptab="disponibilidad"><span>Disponibilidad</span><i>›</i></button>
          <button class="inicio-link" data-goto-ptab="reservas"><span>Reservas</span><i>›</i></button>
          <button class="inicio-link" data-goto-ptab="movimientos"><span>Movimientos</span><i>›</i></button>
          <button class="inicio-link" data-goto-ptab="datos"><span>Mis datos</span><i>›</i></button>
        </div>
      </section>

      <section class="inicio-card ancha">
        <h3>🎉 Promociones activas <span class="muted small">(${promos.length})</span></h3>
        ${promosBloqueHTML(promos, 'No hay promociones activas en este momento.')}
      </section>
    </div>`;

  cont.onclick = e => {
    const g = e.target.closest('[data-goto-ptab]');
    if (g) return renderPanelTab(g.dataset.gotoPtab);
    const pp = e.target.closest('[data-promo-id]');
    if (pp && !e.target.closest('a')) abrirPromo(pp.dataset.promoId);
  };
}

/* ---------- Movimientos y resumen mensual de la sala ---------- */
let movMes = todayStr().slice(0, 7);   /* 'AAAA-MM' */

const estadoMov = r => r.estado === 'cancelada' ? 'Cancelada' : r.estado === 'pendiente_pago' ? 'Pendiente de pago' : 'Confirmada';
const horasMov = r => (toMin(r.end) - toMin(r.start)) / 60;
const montoMov = r => horasMov(r) * (panelDatos && panelDatos.room ? panelDatos.room.price : 0);
const fmtFechaCorta = s => { const [y, m, d] = String(s).split('-'); return `${d}/${m}/${y}`; };
const shiftMes = (mes, n) => { const [y, m] = mes.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; };
const etiquetaMes = mes => new Date(mes + '-01T12:00:00').toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });

function movimientosDelMes(mes) {
  return (panelDatos.reservas || [])
    .filter(r => String(r.date || '').startsWith(mes))
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

function resumenMovimientos(lista) {
  const vivas = lista.filter(r => r.estado !== 'cancelada');
  const canc = lista.filter(r => r.estado === 'cancelada');
  const pend = vivas.filter(r => r.estado === 'pendiente_pago');
  const conf = vivas.filter(r => r.estado !== 'pendiente_pago');
  const suma = arr => arr.reduce((s, r) => s + montoMov(r), 0);
  return {
    reservas: vivas.length,
    bruto: suma(vivas),
    horas: vivas.reduce((s, r) => s + horasMov(r), 0),
    confirmadas: conf.length, montoConfirmado: suma(conf),
    pendientes: pend.length, montoPendiente: suma(pend),
    canceladas: canc.length, montoCancelado: suma(canc),
  };
}

function renderPanelMovimientos() {
  const cont = $('#panel-movimientos');
  if (!cont || !panelDatos) return;
  const lista = movimientosDelMes(movMes);
  const R = resumenMovimientos(lista);
  const hoyMes = todayStr().slice(0, 7);

  cont.innerHTML = `
    <div class="mov-bar">
      <div class="mov-nav">
        <button class="btn btn-sm" data-mes="-1" aria-label="Mes anterior">‹</button>
        <strong class="mov-mes">${esc(etiquetaMes(movMes))}</strong>
        <button class="btn btn-sm" data-mes="1" aria-label="Mes siguiente" ${movMes >= hoyMes ? 'disabled' : ''}>›</button>
      </div>
      <button class="btn btn-primary btn-sm" data-descargar-mes>⬇ Descargar Excel</button>
    </div>

    <div class="admin-stats mov-stats">
      <div class="stat"><span>Reservas del mes</span><b>${R.reservas}</b></div>
      <div class="stat"><span>Ingreso bruto</span><b>${fmtMoney(R.bruto)}</b></div>
      <div class="stat"><span>Confirmado</span><b>${fmtMoney(R.montoConfirmado)}</b></div>
      <div class="stat"><span>Pendiente de pago</span><b style="color:var(--warn)">${fmtMoney(R.montoPendiente)}</b></div>
      <div class="stat"><span>Canceladas</span><b>${R.canceladas}</b></div>
    </div>

    <div class="mov-wrap">
      <table class="mov-table">
        <thead><tr><th>Fecha</th><th>Horario</th><th>Cliente</th><th class="num">Horas</th><th class="num">Monto</th><th>Estado</th></tr></thead>
        <tbody>${lista.length ? lista.map(r => {
          const cls = r.estado === 'cancelada' ? 'off' : r.estado === 'pendiente_pago' ? 'pend' : 'ok';
          return `<tr class="${r.estado === 'cancelada' ? 'anulada' : ''}">
            <td>${esc(fmtFechaCorta(r.date))}</td>
            <td>${esc(r.start)}–${esc(r.end)}</td>
            <td>${esc(r.name)}</td>
            <td class="num">${horasMov(r).toString().replace('.', ',')}</td>
            <td class="num">${fmtMoney(r.estado === 'cancelada' ? 0 : montoMov(r))}</td>
            <td><span class="mov-estado ${cls}">${estadoMov(r)}</span></td>
          </tr>`;
        }).join('') : `<tr><td colspan="6" class="muted">No hay movimientos en este mes.</td></tr>`}</tbody>
      </table>
    </div>
    <p class="mov-foot">El ingreso bruto suma las reservas no canceladas (horas × tarifa de la sala). Las canceladas no suman.</p>`;

  cont.onclick = e => {
    const m = e.target.closest('[data-mes]');
    if (m && !m.disabled) { movMes = shiftMes(movMes, Number(m.dataset.mes)); return renderPanelMovimientos(); }
    if (e.target.closest('[data-descargar-mes]')) descargarMovimientosExcel();
  };
}

/* Archivo CSV con separador ";" y BOM: Excel lo abre con las columnas ya separadas */
function descargarMovimientosExcel() {
  const lista = movimientosDelMes(movMes);
  const R = resumenMovimientos(lista);
  const room = panelDatos.room || {};
  const nf = n => (Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',');
  const celda = v => { const s = String(v ?? ''); return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

  const filas = [
    ['Resumen mensual de movimientos'],
    ['Sala', room.name || ''],
    ['Mes', etiquetaMes(movMes)],
    [],
    ['Concepto', 'Cantidad', 'Monto'],
    ['Reservas del mes (sin canceladas)', R.reservas, nf(R.bruto)],
    ['Confirmadas', R.confirmadas, nf(R.montoConfirmado)],
    ['Pendientes de pago', R.pendientes, nf(R.montoPendiente)],
    ['Canceladas (no suman)', R.canceladas, nf(R.montoCancelado)],
    ['Horas reservadas', nf(R.horas), ''],
    [],
    ['Detalle de reservas'],
    ['Fecha', 'Horario', 'Cliente', 'Teléfono', 'Horas', 'Tarifa por hora', 'Monto', 'Estado'],
    ...lista.map(r => [
      fmtFechaCorta(r.date), `${r.start}-${r.end}`, r.name, r.phone || '',
      nf(horasMov(r)), nf(room.price || 0),
      nf(r.estado === 'cancelada' ? 0 : montoMov(r)), estadoMov(r),
    ]),
    [],
    ['Total del mes (sin canceladas)', '', '', '', '', '', nf(R.bruto), ''],
  ];

  const csv = '\uFEFF' + filas.map(f => f.map(celda).join(';')).join('\r\n');
  const slug = (room.name || 'sala').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `movimientos-${slug}-${movMes}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Archivo descargado ✓', 'ok');
}

function renderPanelEstado() {
  const s = panelDatos.resumen || {};
  const r = panelDatos.room;
  const estado = r.estado === 'aprobada'
    ? '<span class="badge">🟢 Publicada</span>'
    : r.estado === 'pendiente'
      ? '<span class="badge badge-next">🕒 Pendiente de aprobación</span>'
      : '<span class="badge badge-past">⛔ ' + esc(r.estado) + '</span>';
  $('#panel-estado').innerHTML = `
    <div class="stats-cards">
      <div class="stat"><span>Hoy</span><strong>${s.hoy || 0}</strong></div>
      <div class="stat"><span>Próximas</span><strong>${s.proximas || 0}</strong></div>
      <div class="stat"><span>Ingresos futuros</span><strong>${fmtMoney(s.ingresos || 0)}</strong></div>
      <div class="stat"><span>Canceladas</span><strong>${s.canceladas || 0}</strong></div>
    </div>
    <div class="row wrap">${estado}<span class="badge">${esc(r.name)}</span></div>
    ${r.estado === 'pendiente' ? '<p class="muted small">Tu sala está esperando la aprobación de la administración de Más Música. Apenas esté aprobada aparece junto al logo de la app.</p>' : ''}`;
}

/* --- Mi sala --- */
function renderPanelSala() {
  const r = panelDatos.room;
  $('#ps-name').value = r.name || '';
  $('#ps-price').value = r.price || 0;
  $('#ps-descripcion').value = r.descripcion || '';
  $('#ps-direccion').value = r.direccion || '';
  $('#ps-localidad').value = r.localidad || '';
  $('#ps-telefono').value = r.telefono || '';
  $('#ps-capacity').value = r.capacity || 4;
  $('#ps-mapa').value = r.mapa || '';
  $('#ps-lat').value = r.lat != null ? r.lat : '';
  $('#ps-lng').value = r.lng != null ? r.lng : '';
  const eq = r.equipos || {};
  $('#ps-eq-instrumentos').value = eq.instrumentos || '';
  $('#ps-eq-bateria').value = eq.bateria || '';
  $('#ps-eq-amplificadores').value = eq.amplificadores || '';
  $('#ps-eq-microfonos').value = eq.microfonos || '';
  $('#ps-eq-consola').value = eq.consola || '';
  $('#ps-eq-otros').value = eq.otros || '';
  panelLogoTmp = '';
  panelPortadaTmp = '';
  panelFotosTmp = [];
  $('#ps-preview-logo').innerHTML = r.foto ? `<img src="${esc(r.foto)}" alt="">` : '<span class="sala-chip-foto" style="width:60px;height:60px;font-size:1.6rem">🎛️</span>';
  $('#ps-portada-preview').innerHTML = r.fotoPortada
    ? `<img src="${esc(r.fotoPortada)}" alt="Foto horizontal de ${esc(r.name)}">`
    : '<span>Sin foto horizontal</span>';
  renderFotosPanel();
}

function renderFotosPanel() {
  const r = panelDatos.room;
  $('#ps-fotos-grid').innerHTML = (r.fotos || []).map((f, i) => `
    <div class="mini-foto"><img src="${esc(f.foto)}" alt="">
      <button class="btn btn-sm btn-danger" data-quitar-foto="${i}">Quitar</button></div>`).join('');
}

async function guardarPanelSala() {
  const fotos = (panelDatos.room.fotos || []).map(f => ({ titulo: f.titulo, foto: f.foto }));
  fotos.push(...panelFotosTmp);
  const body = {
    roomId: panelDatos.room.id,
    name: $('#ps-name').value.trim(),
    price: Number($('#ps-price').value),
    capacity: Number($('#ps-capacity').value),
    descripcion: $('#ps-descripcion').value.trim(),
    direccion: $('#ps-direccion').value.trim(),
    localidad: $('#ps-localidad').value.trim(),
    telefono: $('#ps-telefono').value.trim(),
    mapa: $('#ps-mapa').value.trim(),
    lat: $('#ps-lat').value.trim(),
    lng: $('#ps-lng').value.trim(),
    equipos: {
      instrumentos: $('#ps-eq-instrumentos').value.trim(),
      bateria: $('#ps-eq-bateria').value.trim(),
      amplificadores: $('#ps-eq-amplificadores').value.trim(),
      microfonos: $('#ps-eq-microfonos').value.trim(),
      consola: $('#ps-eq-consola').value.trim(),
      otros: $('#ps-eq-otros').value.trim(),
    },
    fotos,
  };
  if (panelLogoTmp) body.logo = panelLogoTmp;
  if (panelPortadaTmp) body.fotoPortada = panelPortadaTmp;
  try {
    const data = await api('/api/panel/sala', { method: 'PUT', body });
    state = data.state;
    miSala = state.rooms.find(x => x.id === panelDatos.room.id) || miSala;
    await cargarPanel();
    renderPanelTab('sala');
    renderSalasStrip();
    toast('Sala guardada ✓', 'ok');
  } catch (e) { toast(e.message, 'error'); }
}

/* --- Disponibilidad --- */
const DIAS_NOMBRE = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
function renderPanelDisponibilidad() {
  const r = panelDatos.room;
  $('#ps-turno').value = String(r.turnoMin || 60);
  const h = horarioSalaDe(r);
  $('#ps-horario').innerHTML = Object.keys(DIAS_NOMBRE).map(k => {
    const i = String(k);
    const v = h[i];
    return `<div class="hora-fila">
      <strong>${DIAS_NOMBRE[k]}</strong>
      <label class="check"><input type="checkbox" data-dia="${i}" ${v ? 'checked' : ''}> Abre</label>
      <input type="time" data-open="${i}" value="${v ? v.open : '10:00'}" ${v ? '' : 'disabled'}>
      <span>a</span>
      <input type="time" data-close="${i}" value="${v ? v.close : '22:00'}" ${v ? '' : 'disabled'}>
    </div>`;
  }).join('');
  $$('#ps-horario input[type=checkbox]').forEach(c => {
    c.onchange = () => {
      const i = c.dataset.dia;
      $(`[data-open="${i}"]`).disabled = !c.checked;
      $(`[data-close="${i}"]`).disabled = !c.checked;
    };
  });
  $('#ps-bloques').innerHTML = (panelDatos.bloques || []).length
    ? panelDatos.bloques.map(b => `<div class="res-item">
        <div class="res-time">${b.from} – ${b.to}</div>
        <div class="res-info"><strong>${fmtDate(b.date)}</strong><div class="muted small">${esc(b.reason || 'Bloqueado')}</div></div>
        <div class="res-actions"><button class="btn btn-sm btn-danger" data-quitar-bloqueo="${b.id}">Quitar</button></div>
      </div>`).join('')
    : '<p class="muted small">No tenés horarios bloqueados.</p>';
}

async function guardarPanelHorario() {
  const horario = {};
  $$('#ps-horario input[type=checkbox]').forEach(c => {
    if (!c.checked) return;
    const i = c.dataset.dia;
    horario[i] = { open: $(`[data-open="${i}"]`).value, close: $(`[data-close="${i}"]`).value };
  });
  try {
    const data = await api('/api/panel/horario', {
      method: 'PUT',
      body: { roomId: panelDatos.room.id, horario, turnoMin: Number($('#ps-turno').value) },
    });
    state = data.state;
    await cargarPanel();
    renderPanelTab('disponibilidad');
    toast('Horarios guardados ✓', 'ok');
  } catch (e) { toast(e.message, 'error'); }
}

/* --- Reservas de mi sala --- */
function renderPanelReservas() {
  const hoy = todayStr();
  const inp = $('#ps-res-date');
  if (!inp.value) inp.value = '';
  const filtro = $('#ps-res-filtro').value;
  const fecha = inp.value;
  let lista = (panelDatos.reservas || []).slice();
  if (fecha) lista = lista.filter(r => r.date === fecha);
  if (filtro === 'futuras') lista = lista.filter(r => r.date >= hoy);
  if (filtro === 'pasadas') lista = lista.filter(r => r.date < hoy);
  if (filtro === 'canceladas') lista = lista.filter(r => r.estado === 'cancelada');
  lista.sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start));
  const ingresos = lista.filter(r => r.estado !== 'cancelada')
    .reduce((s, r) => s + (toMin(r.end) - toMin(r.start)) / 60 * panelDatos.room.price, 0);
  $('#ps-res-resumen').innerHTML = `<strong>${lista.length}</strong> reserva(s) · <strong>${fmtMoney(ingresos)}</strong>`;
  $('#ps-reservas').innerHTML = lista.length ? lista.map(r => `
    <div class="res-item ${r.estado === 'cancelada' ? 'cancelada' : ''}" data-res="${r.id}">
      <div class="res-time">${r.start} – ${r.end}</div>
      <div class="res-info">
        <strong>${fmtDate(r.date, { weekday: 'short', day: 'numeric', month: 'short' })} ${r.estado === 'cancelada' ? '<span class="badge badge-past">Cancelada</span>' : r.date >= hoy ? '<span class="badge badge-next">Próxima</span>' : ''}</strong>
        <div>${esc(r.name)}${r.phone ? ' · 📞 ' + esc(r.phone) : ''}</div>
        ${(r.alquiler || []).length ? `<div class="muted small">🎒 ${r.alquiler.map(a => esc(a.nombre)).join(', ')}</div>` : ''}
      </div>
      <div class="res-price">${fmtMoney((toMin(r.end) - toMin(r.start)) / 60 * panelDatos.room.price)}</div>
      <div class="res-actions">
        <button class="btn btn-sm" data-editar-res="${r.id}">Editar</button>
        ${r.estado !== 'cancelada' ? `<button class="btn btn-sm btn-danger" data-cancelar-res="${r.id}">Cancelar</button>` : ''}
      </div>
    </div>`).join('') : '<p class="muted">No hay reservas para este filtro.</p>';
}

/* --- Mis datos --- */
function renderPanelDatos() {
  if (!yo) return;
  $('#pd-nombre').value = yo.nombre || '';
  $('#pd-telefono').value = yo.telefono || '';
  $('#pd-localidad').value = yo.localidad || '';
  $('#pd-email').value = yo.email || '';
  $('#pd-instrumentos').value = (yo.instrumentos || []).join(', ');
  $('#pd-actual').value = '';
  $('#pd-nueva').value = '';
  $('#pd-preview').innerHTML = yo.foto ? `<img src="${esc(yo.foto)}" alt="">` : '<span class="sala-chip-foto" style="width:60px;height:60px;font-size:1.6rem">🎸</span>';
}

async function guardarPanelDatos() {
  const body = {
    nombre: $('#pd-nombre').value.trim(),
    telefono: $('#pd-telefono').value.trim(),
    localidad: $('#pd-localidad').value.trim(),
    email: $('#pd-email').value.trim(),
    instrumentos: $('#pd-instrumentos').value.split(',').map(s => s.trim()).filter(Boolean),
  };
  const nueva = $('#pd-nueva').value;
  if (nueva) {
    body.actual = $('#pd-actual').value;
    body.password = nueva;
  }
  try {
    const data = await api('/api/auth/perfil', { method: 'PUT', body });
    yo = data.user;
    renderPanelTab('datos');
    renderMine();
    toast('Datos guardados ✓', 'ok');
  } catch (e) { toast(e.message, 'error'); }
}

/* ---------- Acciones del panel del dueño ---------- */
function wirePanel() {
  $$('.admin-tab[data-ptab]').forEach(b => { b.onclick = () => renderPanelTab(b.dataset.ptab); });
  $('#btn-exit-panel').onclick = salirDelPanel;
  $('#btn-guardar-sala').onclick = guardarPanelSala;
  /* Ubicación en el mapa: tocar el mapa o buscar la dirección */
  $('#ps-ubicar').onclick = async () => {
    const p = await abrirSelectorUbicacion($('#ps-lat').value, $('#ps-lng').value, 'Ubicá tu sala');
    if (!p) return;
    $('#ps-lat').value = p.lat.toFixed(5);
    $('#ps-lng').value = p.lng.toFixed(5);
    toast('Ubicación puesta. Guardá los cambios para publicarla en el mapa.', 'ok');
  };
  $('#ps-buscar-direccion').onclick = async () => {
    const dir = $('#ps-direccion').value.trim() + ' ' + $('#ps-localidad').value.trim();
    const p = await buscarDireccion(dir);
    if (!p) return;
    $('#ps-lat').value = p.lat.toFixed(5);
    $('#ps-lng').value = p.lng.toFixed(5);
    if (!$('#ps-mapa').value) $('#ps-mapa').value = p.nombre.slice(0, 300);
    toast('Dirección located 📍 Guardá los cambios.', 'ok');
  };
  $('#btn-guardar-horario').onclick = guardarPanelHorario;
  $('#btn-guardar-datos').onclick = guardarPanelDatos;
  $('#ps-res-filtro').onchange = renderPanelReservas;
  $('#ps-res-date').onchange = renderPanelReservas;

  $('#ps-logo').onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      panelLogoTmp = await comprimirImagen(f, 420);
      $('#ps-preview-logo').innerHTML = `<img src="${panelLogoTmp}" alt="">`;
    } catch (err) { toast(err.message, 'error'); }
  };
  $('#ps-portada').onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      panelPortadaTmp = await comprimirImagen(f, 1400);
      $('#ps-portada-preview').innerHTML = `<img src="${panelPortadaTmp}" alt="previsualización">`;
      toast('Foto horizontal lista ✓ Guardá los cambios.', 'ok');
    } catch (err) { toast(err.message, 'error'); }
  };
  $('#ps-fotos').onchange = async e => {
    const files = Array.from(e.target.files || []).slice(0, 6 - panelFotosTmp.length);
    for (const f of files) {
      try { panelFotosTmp.push({ foto: await comprimirImagen(f, 1200) }); } catch (err) { /* se omite */ }
    }
    e.target.value = '';
    renderFotosPanel();
  };
  $('#ps-fotos-grid').onclick = async e => {
    const q = e.target.closest('[data-quitar-foto]');
    if (!q) return;
    const i = Number(q.dataset.quitarFoto);
    const todas = (panelDatos.room.fotos || []).map(f => ({ titulo: f.titulo, foto: f.foto })).concat(panelFotosTmp);
    todas.splice(i, 1);
    try {
      const data = await api('/api/panel/sala', { method: 'PUT', body: { roomId: panelDatos.room.id, fotos: todas } });
      state = data.state;
      await cargarPanel();
      renderPanelTab('sala');
    } catch (err) { toast(err.message, 'error'); }
  };

  $('#btn-ps-bloquear').onclick = async () => {
    try {
      const data = await api('/api/panel/bloqueo', {
        method: 'POST',
        body: {
          roomId: panelDatos.room.id,
          date: $('#ps-blk-date').value,
          from: $('#ps-blk-from').value,
          to: $('#ps-blk-to').value,
          reason: $('#ps-blk-reason').value.trim(),
        },
      });
      state = data.state;
      await cargarPanel();
      renderPanelTab('disponibilidad');
      toast('Horario bloqueado', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  };
  $('#ps-bloques').onclick = async e => {
    const q = e.target.closest('[data-quitar-bloqueo]');
    if (!q) return;
    try {
      const data = await api(`/api/panel/bloqueo/${q.dataset.quitarBloqueo}?roomId=${encodeURIComponent(panelDatos.room.id)}`, { method: 'DELETE' });
      state = data.state;
      await cargarPanel();
      renderPanelTab('disponibilidad');
    } catch (err) { toast(err.message, 'error'); }
  };

  $('#ps-reservas').onclick = async e => {
    const ed = e.target.closest('[data-editar-res]');
    if (ed) return editarReservaPanel(ed.dataset.editarRes);
    const cx = e.target.closest('[data-cancelar-res]');
    if (!cx) return;
    if (!confirm('¿Cancelar esta reserva? Se le avisa al músico.')) return;
    try {
      const data = await api(`/api/panel/reserva/${cx.dataset.cancelarRes}?roomId=${encodeURIComponent(panelDatos.room.id)}`, { method: 'DELETE' });
      state = data.state;
      await cargarPanel();
      renderPanelTab('reservas');
      toast('Reserva cancelada', 'ok');
    } catch (err) { toast(err.message, 'error'); }
  };

  $('#btn-usar-horario-general').onclick = async () => {
    try {
      const data = await api('/api/panel/horario?roomId=' + encodeURIComponent(panelDatos.room.id), { method: 'DELETE' });
      state = data.state;
      await cargarPanel();
      renderPanelTab('disponibilidad');
      toast('Ahora usás el horario general', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  };

  $('#btn-logout').onclick = cerrarSesion;
}

function editarReservaPanel(id) {
  const r = (panelDatos.reservas || []).find(x => x.id === id);
  if (!r) return;
  const { slots } = slotsFor(r.date, panelDatos.room.id);
  openModal(`
    <h3>Editar reserva</h3>
    <label>Fecha<input type="date" id="pr-date" value="${r.date}"></label>
    <div class="row2">
      <label>Desde<select id="pr-start">${slots.map(s => `<option value="${s.start}" ${s.start === r.start ? 'selected' : ''}>${s.start}</option>`).join('')}</select></label>
      <label>Hasta<select id="pr-end">${slots.map(s => `<option value="${s.end}" ${s.end === r.end ? 'selected' : ''}>${s.end}</option>`).join('')}</select></label>
    </div>
    <p class="muted small">${esc(r.name)}${r.phone ? ' · 📞 ' + esc(r.phone) : ''}</p>
    <div class="row">
      <button class="btn btn-primary" id="pr-ok">💾 Guardar</button>
      <button class="btn" id="pr-cancel">Cancelar</button>
    </div>`);
  $('#pr-cancel').onclick = closeModal;
  $('#pr-ok').onclick = async () => {
    try {
      const data = await api(`/api/panel/reserva/${id}`, {
        method: 'PUT',
        body: { roomId: panelDatos.room.id, date: $('#pr-date').value, start: $('#pr-start').value, end: $('#pr-end').value },
      });
      state = data.state;
      closeModal();
      await cargarPanel();
      renderPanelTab('reservas');
      toast('Reserva actualizada ✓', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  };
}

/* ---------- Instrumentos y lugar (vista pública) ---------- */
function renderLugarTab(tab) {
  currentLugarTab = tab;
  $$('.lugar-tab').forEach(b => b.classList.toggle('active', b.dataset.lugarTab === tab));
  $('#tab-instrumentos').hidden = tab !== 'instrumentos';
  $('#tab-alquiler').hidden = tab !== 'alquiler';
  $('#tab-lugar-fotos').hidden = tab !== 'lugar';
  if (tab === 'instrumentos') renderInstrumentos();
  else if (tab === 'alquiler') renderAlquiler();
  else renderFotosLugar();
}

function fotoInstrumento(i) {
  return i.foto
    ? `<img src="${esc(i.foto)}" alt="${esc(i.nombre)}" onerror="this.parentElement.innerHTML='<span class=inst-emoji>🎸</span>'">`
    : '<span class="inst-emoji">🎸</span>';
}

function renderInstrumentos() {
  const list = (state.instruments || []).filter(i => i.activo !== false);
  $('#instruments-grid').innerHTML = list.length ? list.map(i => `
    <article class="inst-card">
      <div class="inst-photo">${fotoInstrumento(i)}</div>
      <h3>${esc(i.nombre)}</h3>
      ${i.descripcion ? `<p class="muted">${esc(i.descripcion)}</p>` : ''}
      ${i.alquiler ? `<span class="tag tag-alquiler">🎒 Alquiler ${fmtMoney(i.precioAlquiler)}/hora</span>` : ''}
    </article>`).join('')
    : '<p class="muted">No hay instrumentos para mostrar.</p>';
}

/* Instrumentos que se pueden alquilar */
function renderAlquiler() {
  const list = (state.instruments || []).filter(i => i.activo !== false && i.alquiler);
  $('#alquiler-grid').innerHTML = list.length ? list.map(i => `
    <article class="inst-card alquiler-card">
      <div class="inst-photo">${fotoInstrumento(i)}</div>
      <h3>${esc(i.nombre)}</h3>
      ${i.descripcion ? `<p class="muted">${esc(i.descripcion)}</p>` : ''}
      <div class="alquiler-precio">${fmtMoney(i.precioAlquiler)}<span> / hora</span></div>
    </article>`).join('')
    : '<p class="muted">Por ahora no hay instrumentos en alquiler.</p>';
}

function renderFotosLugar() {
  const list = state.placePhotos || [];
  $('#place-grid').innerHTML = list.length ? list.map(p => `
    <figure class="place-photo">
      <img src="${esc(p.foto)}" alt="${esc(p.titulo || 'Foto del lugar')}">
      ${p.titulo ? `<figcaption>${esc(p.titulo)}</figcaption>` : ''}
    </figure>`).join('')
    : '<p class="muted">Pronto publicaremos fotos del lugar.</p>';
}

/* ---------- Wiring vista pública ---------- */
function wirePublic() {
  $('#cal-prev').onclick = () => {
    const [y, m] = calCursor.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    calCursor = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
    renderCalendar();
  };
  $('#cal-next').onclick = () => {
    const [y, m] = calCursor.split('-').map(Number);
    const d = new Date(y, m, 1);
    calCursor = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
    renderCalendar();
  };
  $('#btn-today').onclick = () => {
    calCursor = todayStr().slice(0, 7);
    sel.date = todayStr(); sel.range = null; sel.slot = null;
    renderCalendar();
    /* Si ya había elegido sala, sigue directo a los horarios */
    if (sel.roomId) { renderSlots(); goStep(3); } else { renderRooms(); goStep(2); }
  };
  $('#cal-grid').onclick = e => {
    const b = e.target.closest('.cal-day');
    if (!b || b.disabled) return;
    sel.date = b.dataset.date; sel.range = null; sel.slot = null;
    renderCalendar();
    if (sel.roomId) { renderSlots(); goStep(3); }
    else { renderRooms(); goStep(2); }
  };
  $('#btn-back-1').onclick = () => goStep(1);
  $('#btn-filtro-fav').onclick = () => {
    if (!yo) { toast('Iniciá sesión para ver tus favoritas', 'warn'); return pantallaAuth('inicio'); }
    filtroSalas = filtroSalas === 'favoritas' ? 'todas' : 'favoritas';
    renderRooms();
    pintarBotonFav();
  };
  $('#btn-back-room').onclick = () => goStep(2);
  $('#rooms-grid').onclick = e => {
    const fav = e.target.closest('[data-fav]');
    if (fav) { e.stopPropagation(); return alternarFavorita(fav.dataset.fav); }
    const fich = e.target.closest('[data-ficha]');
    if (fich) { e.stopPropagation(); return fichaSala(fich.dataset.ficha); }
    const filtro = e.target.closest('[data-filtro-salas]');
    if (filtro) { filtroSalas = filtro.dataset.filtroSalas; return renderRooms(); }
    const card = e.target.closest('.room-card');
    if (!card) return;
    elegirSala(card.dataset.room);
  };

  $('#slots-grid').onclick = e => {
    const b = e.target.closest('.slot');
    if (!b || b.disabled) return;
    const t = toMin(b.dataset.start);
    if (!sel.range) {
      sel.range = { start: b.dataset.start, end: toHHMM(t + 60) };
    } else {
      const cur = toMin(sel.range.start);
      if (t < cur) {
        sel.range = { start: b.dataset.start, end: toHHMM(t + 60) };
      } else if (t >= cur && t < toMin(sel.range.end)) {
        sel.range = { start: sel.range.start, end: toHHMM(t + 60) };
      } else {
        const newEnd = t + 60;
        if (rangoDisponible(sel.date, sel.roomId, cur, newEnd)) {
          sel.range = { start: sel.range.start, end: toHHMM(newEnd) };
        } else {
          toast('El rango incluye un horario ocupado', 'warn');
          return;
        }
      }
    }
    renderSlots();
  };
  $('#range-clear').onclick = () => { sel.range = null; renderSlots(); };
  $('#range-continue').onclick = () => {
    if (!sel.range) return;
    if (!rangoDisponible(sel.date, sel.roomId, toMin(sel.range.start), toMin(sel.range.end))) {
      toast('Ese rango ya no está disponible', 'error');
      sel.range = null;
      renderSlots();
      return;
    }
    sel.slot = { start: sel.range.start, end: sel.range.end };
    renderConfirm();
    goStep(4);
  };

  /* Ver el perfil de una banda desde el avatar (tarjeta o confirmación)
     y abrir las fotos en grande con el visor */
  document.addEventListener('click', e => {
    const f = e.target.closest('[data-foto]');
    if (f) { verFoto(f.dataset.foto, f.dataset.fotoAlt || ''); return; }
    const b = e.target.closest('[data-band]');
    if (b) verPerfilBanda(b.dataset.band);
  });
  $$('.lugar-tab').forEach(b => { b.onclick = () => renderLugarTab(b.dataset.lugarTab); });
  /* Sala actual (esquina superior): tocar abre sus horarios */
  $('#sala-actual').onclick = () => elegirSala(sel.roomId);
  /* Barra inferior: 5 opciones */
  const ACCIONES_NAV = {
    inicio: irInicio,
    salas: irSalas,
    mapa: irMapa,
    comunidad: () => irComunidad(),
    instrumentos: irInstrumentos,
    perfil: irMisReservas,
    admin: () => (esSuper() ? showAdmin() : enterAdmin()),
    panel: () => { mostrarPanel(); setNav('panel'); },
  };
  $$('#dock-container [data-nav]').forEach(b => {
    b.onclick = () => ACCIONES_NAV[b.dataset.nav]();
  });
  /* Comunidad (solo músicos) */
  if ($('#view-comunidad')) {
    $$('#view-comunidad .comu-tab').forEach(b => { b.onclick = () => cambiarComuTab(b.dataset.comuTab); });
    $('#comu-buscar').oninput = e => {
      comuBusqueda = e.target.value;
      clearTimeout(comuBuscarTimer);
      comuBuscarTimer = setTimeout(cargarComuMusicos, 300);
    };
    $('#comu-zona').onclick = () => {
      if (!yo || !yo.localidad) { toast('Cargá tu localidad en el Perfil para filtrar por zona', 'warn'); return; }
      comuSoloZona = !comuSoloZona;
      $('#comu-zona').classList.toggle('btn-primary', comuSoloZona);
      cargarComuMusicos();
    };
    $('#view-comunidad').onclick = e => {
      const sg = e.target.closest('[data-comu-seguir]');
      if (sg) return comuSeguir(sg.dataset.comuSeguir, sg);
      const msg = e.target.closest('[data-comu-msg]');
      if (msg) return abrirComuChat(msg.dataset.comuMsg);
      const op = e.target.closest('[data-comu-open]');
      if (op) return abrirComuChat(op.dataset.comuOpen);
      if (e.target.closest('#comu-chat-volver')) return cambiarComuTab('mensajes');
    };
    $('#view-comunidad').addEventListener('submit', e => {
      if (e.target.id === 'comu-form') { e.preventDefault(); enviarComuMensaje($('#comu-input').value); }
    });
  }
  $('#home-search').oninput = e => { busquedaMine = e.target.value; renderMineRapido(); };
  /* Perfil / Ajustes: filas, apariencia, avisos y accesos */
  $('#mine-user').onclick = e => {
    const a = e.target.closest('[data-auth]');
    if (a) { pantallaAuth(a.dataset.auth); return; }
    const aj = e.target.closest('[data-aj]');
    if (aj) return accionAjustes(aj.dataset.aj);
    const t = e.target.closest('button[data-tema]');
    if (t) return elegirApariencia(t.dataset.tema);
    if (e.target.closest('#btn-editar-perfil')) return formularioPerfil();
    if (e.target.closest('#btn-cambiar-pass')) return formularioPassword();
    if (e.target.closest('#btn-ir-panel')) return mostrarPanel();
    if (e.target.closest('#btn-ir-admin')) return esSuper() ? showAdmin() : enterAdmin();
    if (e.target.closest('#btn-notif-lista')) return irAAvisos();
    if (e.target.closest('#btn-logout-perfil')) return cerrarSesion();
  };
  $('#mine-user').onchange = e => {
    if (e.target.id !== 'aj-notif') return;
    const on = e.target.checked;
    localStorage.setItem('mm-avisos-toast', on ? '1' : '0');
    toast(on ? 'Vas a ver un aviso en pantalla cuando llegue una novedad'
             : 'Avisos en pantalla desactivados (igual los encontrás en "Mis avisos")', 'ok');
  };
  /* Avisos: marcar como leídos (el botón vive en su propio panel) */
  $('#mine-notif').onclick = e => {
    if (!e.target.closest('#notif-leer')) return;
    const btn = $('#notif-leer');
    btn.disabled = true;
    api('/api/notificaciones/leer', { method: 'POST' })
      .then(() => cargarNotificaciones())
      .then(() => {
        renderMine();
        toast('Avisos marcados como leídos', 'ok');
      })
      .catch(err => { btn.disabled = false; toast(err.message, 'error'); });
  };
  $('#mine-favoritas').onclick = e => {
    if (e.target.closest('#fav-ver')) { filtroSalas = 'favoritas'; return irSalas(); }
    const s = e.target.closest('[data-ir-sala]');
    if (s) elegirSala(s.dataset.irSala);
  };
  $('#btn-notif').onclick = () => abrirPanelNotif();
  $('#btn-ajustes').onclick = () => abrirPanelAjustes();
  /* Panel de notificaciones: cerrar con ✕, el fondo o la tecla Escape */
  $('#notif-panel-cerrar').onclick = cerrarPanelNotif;
  $('#notif-backdrop').onclick = cerrarPanelNotif;
  $('#notif-panel-leer').onclick = marcarLeidasPanel;
  $('#notif-panel-borrar-todas').onclick = borrarTodasNotificaciones;
  /* Tocar una notificación lleva a la reserva correspondiente */
  $('#notif-sheet-body').onclick = e => {
    const borrar = e.target.closest('[data-borrar-notif]');
    if (borrar) {
      e.stopPropagation();
      const item = borrar.closest('.notif-item');
      return borrarNotificacion(borrar.dataset.borrarNotif, item);
    }
    const pr = e.target.closest('[data-promo-id]');
    if (pr) return abrirPromo(pr.dataset.promoId);
    const it = e.target.closest('.notif-item');
    if (it) irANotificacion(it.dataset.notifId);
  };
  $('#notif-sheet-body').onkeydown = e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const pr = e.target.closest('[data-promo-id]');
    if (pr) { e.preventDefault(); return abrirPromo(pr.dataset.promoId); }
    const it = e.target.closest('.notif-item');
    if (it) { e.preventDefault(); irANotificacion(it.dataset.notifId); }
  };
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if ($('#notif-drop').classList.contains('open')) return cerrarPanelNotif();
    if ($('#ajustes-drop').classList.contains('open')) return cerrarPanelAjustes();
  });
  /* Panel de ajustes: cerrar con ✕, el fondo o Escape */
  $('#ajustes-panel-cerrar').onclick = cerrarPanelAjustes;
  $('#ajustes-backdrop').onclick = cerrarPanelAjustes;
  $('#ajustes-sheet-body').onclick = e => {
    const aj = e.target.closest('[data-aj]');
    if (aj) return accionAjustes(aj.dataset.aj);
    const t = e.target.closest('button[data-tema]');
    if (t) return elegirApariencia(t.dataset.tema);
    if (e.target.closest('#btn-logout-perfil')) return cerrarSesion();
  };
  $('#ajustes-sheet-body').onchange = e => {
    if (e.target.id !== 'aj-notif') return;
    localStorage.setItem('mm-avisos-toast', e.target.checked ? '1' : '0');
    toast(e.target.checked ? 'Vas a ver un aviso en pantalla cuando llegue una novedad'
         : 'Avisos en pantalla desactivados (igual los encontrás en la campana)', 'ok');
  };
  $('#btn-panel').onclick = mostrarPanel;
  /* Resumen del Inicio: accesos */
  $('#inicio-resumen').onclick = e => {
    if (e.target.closest('#sum-login')) return pantallaAuth('login');
    if (e.target.closest('a')) return;
    const pp = e.target.closest('[data-promo-id]');
    if (pp) return abrirPromo(pp.dataset.promoId);
    const promo = e.target.closest('[data-promo]');
    if (promo) {
      const p = (state.promociones || []).find(x => x.id === promo.dataset.promo);
      if (!p) return;
      return openModal(`<h3>${esc(p.titulo)}</h3><p>${esc(p.texto)}</p>
        <div class="row"><button class="btn" onclick="closeModal()">Cerrar</button></div>`);
    }
  };
  $('#home-mine-body').onclick = async e => {
    if (e.target.closest('#filtro-mine-clear')) {
      filtroMisReservas = '';
      renderMineRapido();
      return;
    }
    const b = e.target.closest('[data-mine-cancel]');
    if (!b) return;
    const r = state.reservations.find(x => x.id === b.dataset.mineCancel);
    if (!r) return;
    if (!confirm(`¿Cancelar tu reserva del ${fmtDate(r.date)} ${r.start} – ${r.end}?\nEl horario quedará libre.`)) return;
    try {
      const data = await api(`/api/reservations/${r.id}/cancel`, {
        method: 'POST',
        body: { name: r.name, phone: r.phone },
      });
      state = data.state;
      mineIds = mineIds.filter(id => id !== r.id);
      localStorage.setItem(MINE_KEY, JSON.stringify(mineIds));
      renderMineRapido();
      renderMine();
      toast('Reserva cancelada. El horario quedó libre.', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

/* ================= Panel de administración ================= */

/* Entrar al panel: con la cuenta de administración general o con el PIN */
async function enterAdmin() {
  if (esSuper()) { showAdmin(); return; }
  openModal(`
    <h3>🔒 Panel de administración</h3>
    <p class="muted small">Ingresá con la cuenta de administración general de Más Música.</p>
    <label>Usuario o email<input id="ad-user" autocomplete="username"></label>
    <label>Contraseña<input type="password" id="ad-pass" autocomplete="current-password"></label>
    <div class="row">
      <button class="btn btn-primary" id="ad-ok">Entrar</button>
      <button class="btn" id="ad-pin">Usar el PIN</button>
      <button class="btn" id="ad-cancel">Cancelar</button>
    </div>`);
  $('#ad-user').focus();
  const intentar = async () => {
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: { usuario: $('#ad-user').value.trim(), password: $('#ad-pass').value } });
      if (data.user.rol !== 'SUPER_ADMIN') { toast('Esa cuenta no es de administración general', 'warn'); return; }
      await iniciarSesionConToken(data);
      adminPin = '';           /* a partir de ahora manda la sesión */
      marcarDispositivoAdmin();
      closeModal();
      showAdmin();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  $('#ad-ok').onclick = intentar;
  $('#ad-pass').onkeydown = e => { if (e.key === 'Enter') intentar(); };
  $('#ad-cancel').onclick = closeModal;
  $('#ad-pin').onclick = () => { closeModal(); pedirPinAdmin(); };
}

/* Entrada explícita al panel de administración con el PIN de emergencia */
function pedirPinAdmin() {
  openModal(`
    <h3>🔑 PIN de administrador</h3>
    <label>PIN<input type="password" id="pin-input" inputmode="numeric" placeholder="PIN de administrador"></label>
    <div class="row">
      <button class="btn btn-primary" id="pin-ok">Entrar</button>
      <button class="btn" id="pin-cancel">Cancelar</button>
    </div>`);
  $('#pin-input').focus();
  const intentar = async () => {
    const pin = $('#pin-input').value;
    try {
      const data = await api('/api/auth/pin', { method: 'POST', body: { pin } });
      await iniciarSesionConToken(data);
      marcarDispositivoAdmin();
      adminMode = true;
      closeModal();
      showAdmin();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  $('#pin-ok').onclick = intentar;
  $('#pin-input').onkeydown = e => { if (e.key === 'Enter') intentar(); };
  $('#pin-cancel').onclick = closeModal;
}

function showAdmin() {
  ocultarVistas();
  $('#view-admin').hidden = false;
  $('#btn-exit-admin').hidden = false;
  setNav('admin');
  /* Arranca en las solicitudes pendientes si hay alguna */
  currentAdminTab = 'inicio';
  renderAdminTab(currentAdminTab);
  actualizarAdminHead();
}

/* Sub-título del encabezado del panel: qué sesión lo está administrando */
function actualizarAdminHead() {
  const el = $('#admin-head-user');
  if (el) el.textContent = yo ? '@' + yo.usuario : 'acceso por PIN de emergencia';
}

function salirAdmin() {
  adminMode = false;
  adminPin = '';
  ocultarVistas();
  $('#view-public').hidden = false;
  $('#btn-exit-admin').hidden = true;
  actualizarBarraSesion();
  setNav('inicio');
  renderCalendar();
  renderRooms();
  goStep(1);
}

const TABS_ADMIN = ['inicio', 'solicitudes', 'usuarios', 'ayuda', 'reservas', 'historial', 'salas', 'horarios', 'bloqueos', 'estadisticas', 'ajustes', 'lugar', 'bandas', 'promociones'];

function renderAdminTab(tab) {
  currentAdminTab = tab;
  $$('.admin-tab[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  TABS_ADMIN.forEach(t => { $('#tab-' + t).hidden = t !== tab; });
  ({
    inicio: renderInicioAdmin,
    solicitudes: renderSolicitudes,
    usuarios: renderUsuarios,
    ayuda: renderAyuda,
    reservas: renderReservasAdmin,
    historial: renderHistorial,
    salas: renderSalasAdmin,
    horarios: renderHorariosAdmin,
    bloqueos: renderBloqueosAdmin,
    estadisticas: renderStats,
    ajustes: renderAjustes,
    lugar: renderLugarAdmin,
    bandas: renderBandasAdmin,
    promociones: renderPromocionesAdmin,
  }[tab])();
  const pend = (state.rooms || []).filter(r => r.estado === 'pendiente').length;
  const pill = $('#pill-solicitudes');
  if (pill) { pill.hidden = !pend; pill.textContent = pend; }
  const pendAyuda = (window.__ayuda || []).filter(a => a.estado === 'pendiente').length;
  const pillAy = $('#pill-ayuda');
  if (pillAy) { pillAy.hidden = !pendAyuda; pillAy.textContent = pendAyuda; }
}

/* ---------- Solicitudes de salas (aprobación) ---------- */
let filtroSolicitudes = 'pendiente';
let listaSolicitudes = null;

function renderSolicitudes() {
  const cont = $('#solicitudes-list');
  if (!cont) return;
  if (!listaSolicitudes) {
    cont.innerHTML = '<p class="muted">Cargando solicitudes…</p>';
    api('/api/admin/solicitudes', { admin: true })
      .then(data => { listaSolicitudes = data.salas; renderSolicitudes(); })
      .catch(e => { cont.innerHTML = `<p class="muted">${esc(e.message)}</p>`; });
    return;
  }
  const lista = listaSolicitudes.filter(r => filtroSolicitudes === 'todas' || r.estado === filtroSolicitudes);
  const orden = { pendiente: 0, rechazada: 1, suspendida: 2, aprobada: 3 };
  lista.sort((a, b) => (orden[a.estado] - orden[b.estado]) || ((b.solicitud && b.solicitud.fecha) - (a.solicitud && a.solicitud.fecha)));
  const ETIQUETA = { pendiente: '🕒 Pendiente', aprobada: '🟢 Aprobada', rechazada: '⛔ Rechazada', suspendida: '⏸ Suspendida' };
  cont.innerHTML = lista.length ? lista.map(r => `
    <div class="sol-card ${r.estado}">
      <div class="sol-top">
        ${r.foto ? `<img class="sol-logo" src="${esc(r.foto)}" alt="">` : '<span class="sol-logo sin-foto">🎸</span>'}
        <div class="sol-info">
          <strong>${esc(r.name)}</strong>
          <span class="muted small">${esc([r.localidad, r.direccion].filter(Boolean).join(' · '))}</span>
          <span class="muted small">👤 ${r.duenio ? esc(r.duenio.nombre + ' (@' + r.duenio.usuario + ')') : 'Sin dueño asignado'}${r.duenio && r.duenio.telefono ? ' · 📞 ' + esc(r.duenio.telefono) : ''}</span>
          <span class="muted small">${fmtMoney(r.price)}/h · 👥 ${r.capacity} · enviada ${r.solicitud && r.solicitud.fecha ? fechaCorta(r.solicitud.fecha) : '—'}</span>
        </div>
        <span class="badge ${r.estado === 'aprobada' ? '' : 'badge-next'}">${ETIQUETA[r.estado]}</span>
      </div>
      ${r.descripcion ? `<p class="sol-desc">${esc(r.descripcion)}</p>` : ''}
      ${Object.values(r.equipos || {}).filter(Boolean).length ? `<div class="ficha-chips">${Object.entries(r.equipos).filter(([, v]) => v).map(([, v]) => `<span class="chip">${esc(v.slice(0, 28))}</span>`).join('')}</div>` : ''}
      ${r.solicitud && r.solicitud.motivo ? `<p class="muted small">📝 ${esc(r.solicitud.motivo)}</p>` : ''}
      <div class="row wrap">
        ${r.estado === 'pendiente' ? `
          <button class="btn btn-primary btn-sm" data-sol-ok="${r.id}">✅ Aprobar</button>
          <button class="btn btn-sm" data-sol-corr="${r.id}">✏️ Pedir correcciones</button>
          <button class="btn btn-sm btn-danger" data-sol-no="${r.id}">⛔ Rechazar</button>` : `
          <button class="btn btn-sm" data-sol-ok="${r.id}">🟢 Activar / aprobar</button>
          <button class="btn btn-sm btn-danger" data-sol-no="${r.id}">${r.estado === 'suspendida' ? '⛔ Rechazar' : '⏸ Suspender'}</button>`}
        <button class="btn btn-sm" data-sol-editar="${r.id}">✏️ Editar datos</button>
      </div>
    </div>`).join('') : '<p class="muted">No hay salas con ese estado.</p>';
}

async function accionSolicitud(id, accion, motivo) {
  try {
    const data = await api(`/api/admin/solicitudes/${id}`, { method: 'PUT', body: { accion, motivo } });
    state = data.state;
    listaSolicitudes = null;
    renderAdminTab('solicitudes');
    renderRooms();
    toast(
      accion === 'aprobar' ? 'Sala aprobada y publicada ✓' :
      accion === 'rechazar' ? 'Sala rechazada' :
      accion === 'corregir' ? 'Le pedimos correcciones al dueño' : 'Sala actualizada',
      'ok');
    await cargarNotificaciones();
  } catch (e) { toast(e.message, 'error'); }
}

/* ---------- Cuentas registradas ---------- */
let filtroUsuarios = '';
function renderUsuarios() {
  const cont = $('#usuarios-list');
  if (!cont) return;
  if (!window.__usuarios) { cont.innerHTML = '<p class="muted">Cargando cuentas…</p>'; cargarUsuarios(); return; }
  const q = filtroUsuarios.trim().toLowerCase();
  const lista = window.__usuarios.filter(u => !q ||
    (u.nombre + ' ' + u.usuario + ' ' + u.email).toLowerCase().includes(q));
  const ROL = { USER: '🎸 Músico', ROOM_ADMIN: '🎛️ Dueño de sala', SUPER_ADMIN: '👑 Administración general' };
  cont.innerHTML = lista.length ? `<table class="tabla">
    <thead><tr><th>Cuenta</th><th>Rol</th><th>Salas</th><th>Reservas</th><th>Estado</th><th></th></tr></thead>
    <tbody>${lista.map(u => `<tr>
      <td><strong>${esc(u.nombre)}</strong><br><span class="muted small">@${esc(u.usuario)} · ${esc(u.email)}${u.telefono ? ' · 📞 ' + esc(u.telefono) : ''}</span></td>
      <td>${ROL[u.rol] || esc(u.rol)}${u.localidad ? `<br><span class="muted small">📍 ${esc(u.localidad)}</span>` : ''}</td>
      <td>${(u.salas || []).map(s => `<span class="chip ${s.estado === 'aprobada' ? '' : 'chip-alt'}">${esc(s.name)}</span>`).join(' ') || '<span class="muted small">—</span>'}</td>
      <td>${u.reservas || 0}</td>
      <td>${u.bloqueado ? '<span class="badge badge-past">🚫 Bloqueada</span>' : u.activo === false ? '<span class="badge badge-past">⏸ Desactivada</span>' : '<span class="badge">🟢 Activa</span>'}</td>
      <td class="acciones-td">
        <button class="btn btn-sm" data-user-bloquear="${u.id}">${u.bloqueado ? 'Desbloquear' : 'Bloquear'}</button>
        <button class="btn btn-sm" data-user-rol="${u.id}">Cambiar rol</button>
        <button class="btn btn-sm btn-danger" data-user-borrar="${u.id}">Eliminar</button>
      </td>
    </tr>`).join('')}</tbody></table>` : '<p class="muted">No hay cuentas con ese criterio.</p>';
}

async function cargarUsuarios() {
  try {
    const data = await api('/api/admin/usuarios', { admin: true });
    window.__usuarios = data.usuarios;
    renderUsuarios();
  } catch (e) {
    $('#usuarios-list').innerHTML = `<p class="muted">${esc(e.message)}</p>`;
  }
}

async function accionUsuario(id, accion) {
  const u = (window.__usuarios || []).find(x => x.id === id);
  if (!u) return;
  try {
    if (accion === 'borrar') {
      if (!confirm(`¿Eliminar la cuenta de ${u.nombre}? Se borra su historial de reservas.`)) return;
      const data = await api(`/api/admin/usuarios/${id}`, { method: 'DELETE', admin: true });
      state = data.state;
    } else if (accion === 'bloquear') {
      const data = await api(`/api/admin/usuarios/${id}`, { method: 'PUT', admin: true, body: { bloqueado: !u.bloqueado } });
      state = data.state;
    } else if (accion === 'rol') {
      const nuevo = prompt(
        `Rol de ${u.nombre}:\n1) USER — músico\n2) ROOM_ADMIN — dueño de sala\n3) SUPER_ADMIN — administración general`,
        u.rol === 'USER' ? '1' : u.rol === 'ROOM_ADMIN' ? '2' : '3');
      if (nuevo === null) return;
      const rol = { 1: 'USER', 2: 'ROOM_ADMIN', 3: 'SUPER_ADMIN' }[nuevo.trim()] || u.rol;
      const data = await api(`/api/admin/usuarios/${id}`, { method: 'PUT', admin: true, body: { rol } });
      state = data.state;
    }
    await cargarUsuarios();
    toast('Cuenta actualizada', 'ok');
  } catch (e) { toast(e.message, 'error'); }
}

/* ---------- Pedidos de ayuda (usuarios que no pueden entrar) ---------- */
function renderAyuda() {
  const cont = $('#ayuda-list');
  if (!cont) return;
  if (!window.__ayuda) { cont.innerHTML = '<p class="muted">Cargando pedidos…</p>'; cargarAyuda(); return; }
  const lista = window.__ayuda;
  const MOTIVOS = { olvide: '🔑 Olvidé mi contraseña', bloqueada: '🚫 Cuenta bloqueada/desactivada', otro: '❓ Otro problema' };
  const fechaCorta = t => new Date(t).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const pendientes = lista.filter(a => a.estado === 'pendiente');
  const resueltos = lista.filter(a => a.estado === 'resuelta');
  if (!lista.length) {
    cont.innerHTML = '<p class="muted">Todavía no hay pedidos de ayuda. Cuando alguien no pueda entrar, aparece acá (y te avisa el timbre 🔔).</p>';
    return;
  }
  const tarjeta = a => `<div class="panel ayuda-item ${a.estado === 'resuelta' ? 'ayuda-resuelta' : ''}">
    <div class="ayuda-head">
      <strong>${MOTIVOS[a.motivo] || '❓ Otro problema'}</strong>
      <span class="muted small">${fechaCorta(a.fecha)}</span>
    </div>
    <p>👤 <strong>${esc(a.ident)}</strong>
      ${a.cuenta ? ` — <span class="muted small">cuenta encontrada: @${esc(a.cuenta.usuario)} (${esc(a.cuenta.nombre)})${a.cuenta.email ? ' · ' + esc(a.cuenta.email) : ''}${a.cuenta.bloqueado ? ' · <span class="badge badge-past">bloqueada</span>' : a.cuenta.activo === false ? ' · <span class="badge badge-past">desactivada</span>' : ''}</span>` : '<span class="muted small">(cuenta no encontrada con ese dato)</span>'}
    </p>
    ${a.mensaje ? `<p class="ayuda-msj">“${esc(a.mensaje)}”</p>` : ''}
    <div class="row wrap">
      ${a.estado === 'pendiente' && a.cuenta && (a.cuenta.bloqueado || a.cuenta.activo === false) && a.cuenta.rol !== 'SUPER_ADMIN'
        ? `<button class="btn btn-sm" data-ayuda-desbloquear="${a.id}">🔓 Desbloquear cuenta</button>` : ''}
      ${a.estado === 'pendiente' ? `<button class="btn btn-sm btn-ghost" data-ayuda-resolver="${a.id}">✓ Marcar resuelto</button>` : ''}
      ${a.estado === 'resuelta' ? '<span class="muted small">✓ Resuelto' + (a.resuelta ? ' el ' + fechaCorta(a.resuelta) : '') + '</span>' : ''}
    </div>
  </div>`;
  cont.innerHTML = `
    ${pendientes.length ? `<h3 class="sub">Pendientes (${pendientes.length})</h3>${pendientes.map(tarjeta).join('')}` : ''}
    ${resueltos.length ? `<h3 class="sub">Resueltos (${resueltos.length})</h3>${resueltos.slice(0, 20).map(tarjeta).join('')}` : ''}
  `;
}

async function cargarAyuda() {
  try {
    const data = await api('/api/admin/ayuda', { admin: true });
    window.__ayuda = data.ayuda || [];
  } catch (e) {
    window.__ayuda = [];
    const cont = $('#ayuda-list');
    if (cont) cont.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
  }
  renderAyuda();
  const pend = (window.__ayuda || []).filter(a => a.estado === 'pendiente').length;
  const pill = $('#pill-ayuda');
  if (pill) { pill.hidden = !pend; pill.textContent = pend; }
}

async function resolverAyuda(id, desbloquear) {
  try {
    const data = await api('/api/admin/ayuda', { method: 'POST', admin: true, body: { id, desbloquear: !!desbloquear } });
    if (desbloquear) {
      toast('Cuenta desbloqueada y pedido resuelto ✓', 'ok');
    } else {
      toast('Pedido marcado como resuelto ✓', 'ok');
    }
    await cargarAyuda();
  } catch (e) { toast(e.message, 'error'); }
}

/* ---------- Reservas del día ---------- */
function renderReservasAdmin() {
  if (!adminResDate) adminResDate = todayStr();
  const ds = adminResDate;
  const esHoy = ds === todayStr();
  const fecha = new Date(ds + 'T12:00:00');

  /* Selector de día */
  $('#res-dlabel').textContent = fecha.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#res-dsub').textContent = esHoy
    ? `Hoy · ${fecha.getFullYear()}`
    : `${fecha.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })} · ${fecha.getFullYear()}`;
  $('#res-today').hidden = esHoy;

  /* Estadísticas */
  const list = state.reservations
    .filter(r => r.date === ds && r.estado !== 'cancelada')
    .sort((a, b) => a.start.localeCompare(b.start));
  const total = list.reduce((s, r) => s + precioReserva(r), 0);
  $('#res-count').textContent = list.length;
  $('#res-pend').textContent = list.filter(r => r.estado === 'pendiente_pago').length;
  $('#res-income').textContent = fmtMoney(total);

  /* Chips de salas (cada una con su color) */
  $('#res-chips').innerHTML = ['Todas', ...(state.rooms || []).map(r => r.name)].map((n, i) => {
    const room = i > 0 ? state.rooms[i - 1] : null;
    return `<button class="chip ${adminResFiltro === i - 1 ? 'on' : ''}" data-i="${i - 1}">` +
      (room ? `<i style="--c:${colorRoom(room)}"></i>` : '') + esc(n) + `</button>`;
  }).join('');

  const ver = adminResFiltro < 0 ? list : list.filter(r => r.roomId === (state.rooms[adminResFiltro] || {}).id);
  if (!ver.length) {
    $('#res-list').innerHTML = `<div class="res-empty"><b>${list.length ? 'Sin reservas en esta sala' : 'No hay reservas este día'}</b>${list.length ? 'Elegí otra sala para ver el resto.' : 'Cuando entre una reserva va a aparecer acá.'}</div>`;
    return;
  }

  /* Escritorio: agenda con las salas en columnas y las horas en filas */
  if (window.matchMedia('(min-width: 1024px)').matches) {
    $('#res-list').innerHTML = agendaAdminHTML(ver);
    return;
  }

  $('#res-list').innerHTML = `<div class="res-list">` + ver.map(r => {
    const room = state.rooms.find(x => x.id === r.roomId);
    const extra = (r.alquiler || []).length ? ` · 🎒 ${r.alquiler.map(a => esc(a.nombre)).join(', ')}` : '';
    return `
      <div class="res-card" style="--rc:${colorRoom(room)}">
        <div class="res-row">
          <div class="res-time"><b>${r.start}</b><span>hasta ${r.end}</span></div>
          <div class="res-who">
            <b>${esc(r.name)}</b>
            <span>${esc(room ? room.name : 'Sala eliminada')}${r.phone ? ' · ' + esc(r.phone) : ''}${extra}</span>
          </div>
          <div class="res-price">${fmtMoney(precioReserva(r))}</div>
        </div>
        ${adminResPidiendo === r.id
          ? `<div class="res-ask"><span>¿Cancelar esta reserva?</span><div><button data-ask-no>No</button><button class="yes" data-ask-yes="${r.id}">Sí, cancelar</button></div></div>`
          : `<div class="res-acts"><button data-edit="${r.id}">Editar</button><button data-cancel="${r.id}">Cancelar</button></div>`}
      </div>`;
  }).join('') + `</div>`;
}

/* ---------- Agenda del día (escritorio) ---------- */
function agendaAdminHTML(ver) {
  const toMin = t => { const p = String(t || '0:0').split(':'); return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0); };
  const fin = r => { const s = toMin(r.start), e = toMin(r.end); return e > s ? e : e + 1440; };
  const HPX = 68; /* alto de una hora en pantalla */
  const salas = adminResFiltro < 0 ? (state.rooms || []).slice() : [state.rooms[adminResFiltro]].filter(Boolean);
  if (adminResFiltro < 0 && ver.some(r => !salas.some(x => x.id === r.roomId))) salas.push({ id: '__sin_sala', name: 'Sala eliminada' });
  const ini = Math.floor(Math.min(...ver.map(r => toMin(r.start))) / 60) * 60;
  let fn = Math.ceil(Math.max(...ver.map(fin)) / 60) * 60;
  if (fn - ini < 360) fn = ini + 360;
  const alto = (fn - ini) / 60 * HPX;
  let horas = '';
  for (let m = ini; m < fn; m += 60) {
    horas += `<span style="top:${(m - ini) / 60 * HPX}px">${String(Math.floor(m / 60) % 24).padStart(2, '0')}:00</span>`;
  }
  const huerfana = room => room.id === '__sin_sala';
  const cols = salas.map(room => {
    const propias = ver.filter(r => huerfana(room) ? !state.rooms.some(x => x.id === r.roomId) : r.roomId === room.id);
    const bloques = propias.map(r => {
      const top = (toMin(r.start) - ini) / 60 * HPX;
      const h = Math.max((fin(r) - toMin(r.start)) / 60 * HPX - 4, 40);
      const pend = r.estado === 'pendiente_pago';
      const extra = (r.alquiler || []).length ? ' · ' + r.alquiler.map(a => esc(a.nombre)).join(', ') : '';
      return `<div class="ag-res${pend ? ' pend' : ''}" tabindex="0" style="top:${top + 2}px;height:${h}px;--rc:${colorRoom(huerfana(room) ? null : room)}">
        <b>${esc(r.name)}</b>
        <span>${r.start}–${r.end} · ${fmtMoney(precioReserva(r))}</span>
        ${pend ? '<span class="ag-pend">Pendiente de pago</span>' : ''}
        <span class="ag-sub">${r.phone ? esc(r.phone) : ''}${extra}</span>
        ${adminResPidiendo === r.id
          ? `<div class="ag-ask"><span>¿Cancelar?</span><button data-ask-no>No</button><button class="yes" data-ask-yes="${r.id}">Sí</button></div>`
          : `<div class="ag-acts"><button data-edit="${r.id}">Editar</button><button data-cancel="${r.id}">Cancelar</button></div>`}
      </div>`;
    }).join('');
    return `<div class="ag-col" style="--hpx:${HPX}px">${bloques}</div>`;
  }).join('');
  const cab = salas.map(room => `<div class="ag-room"><i style="--c:${colorRoom(huerfana(room) ? null : room)}"></i>${esc(room.name)}</div>`).join('');
  return `<div class="agenda" style="--n:${salas.length}">
    <div class="ag-head"><span></span>${cab}</div>
    <div class="ag-body" style="height:${alto}px"><div class="ag-hours">${horas}</div>${cols}</div>
  </div>`;
}

/* Si se achica o agranda la ventana, se vuelve a dibujar la vista que corresponde */
window.matchMedia('(min-width: 1024px)').addEventListener('change', () => {
  const v = document.getElementById('view-admin');
  if (v && !v.hidden && typeof currentAdminTab !== 'undefined' && currentAdminTab === 'reservas' && state && state.reservations) renderReservasAdmin();
});

function cambiarDiaAdmin(n) {
  const base = adminResDate ? new Date(adminResDate + 'T12:00:00') : new Date();
  base.setDate(base.getDate() + n);
  adminResDate = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
  adminResPidiendo = '';
  renderReservasAdmin();
}

async function cancelarReservaAdmin(id) {
  try {
    const data = await api(`/api/reservations/${id}`, { method: 'DELETE', admin: true });
    state = data.state;
    adminResPidiendo = '';
    renderReservasAdmin();
    toast('Reserva cancelada', 'ok');
  } catch (e) { toast(e.message, 'error'); }
}

/* ---------- Editar / cancelar ---------- */
function editarReserva(id, backTab = 'reservas') {
  const r = state.reservations.find(x => x.id === id);
  if (!r) return;
  const rooms = salasPublicas();
  const duracionActual = horasDe(r);
  openModal(`
    <h3>Editar reserva</h3>
    <label>Fecha<input type="date" id="er-date" value="${r.date}"></label>
    <label>Sala<select id="er-room">${rooms.map(x => `<option value="${x.id}" ${x.id === r.roomId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
    <div class="row2">
      <label>Hora de inicio<select id="er-time"></select></label>
      <label>Duración<select id="er-dur"></select></label>
    </div>
    <label>Nombre o banda<input id="er-name" maxlength="60" value="${esc(r.name)}"></label>
    <label>Teléfono<input id="er-phone" maxlength="20" value="${esc(r.phone || '')}"></label>
    <div class="row">
      <button class="btn btn-primary" id="er-save">Guardar</button>
      <button class="btn" id="er-cancel">Cancelar</button>
    </div>`);
  const fillTimes = () => {
    const { slots } = slotsFor($('#er-date').value, $('#er-room').value);
    const opciones = slots.filter(s => s.status === 'available' || (s.ref && s.ref.id === id));
    $('#er-time').innerHTML = opciones.length
      ? opciones.map(s => `<option value="${s.start}" ${s.start === r.start ? 'selected' : ''}>${s.start}</option>`).join('')
      : '<option value="">Sin horarios</option>';
    fillDur();
  };
  const fillDur = () => {
    const start = $('#er-time').value;
    if (!start) { $('#er-dur').innerHTML = '<option value="">—</option>'; return; }
    const max = horasConsecutivas($('#er-date').value, $('#er-room').value, toMin(start), id);
    let opts = '';
    for (let h = 1; h <= max; h++) {
      opts += `<option value="${h}" ${h === duracionActual ? 'selected' : ''}>${h} hora${h > 1 ? 's' : ''}</option>`;
    }
    $('#er-dur').innerHTML = opts || '<option value="">—</option>';
  };
  fillTimes();
  $('#er-date').onchange = fillTimes;
  $('#er-room').onchange = fillTimes;
  $('#er-time').onchange = fillDur;
  $('#er-save').onclick = async () => {
    const name = $('#er-name').value.trim();
    const date = $('#er-date').value, roomId = $('#er-room').value, start = $('#er-time').value;
    const dur = parseInt($('#er-dur').value, 10);
    if (!name) { toast('El nombre es obligatorio', 'warn'); return; }
    if (!start || !dur) { toast('No hay horario disponible', 'warn'); return; }
    const startMin = toMin(start), endMin = startMin + dur * 60;
    if (!rangoDisponible(date, roomId, startMin, endMin, id)) {
      toast('Ese horario ya está ocupado', 'error');
      return;
    }
    try {
      const data = await api(`/api/reservations/${id}`, {
        method: 'PUT',
        admin: true,
        body: { date, roomId, start, end: toHHMM(endMin), name, phone: $('#er-phone').value.trim() },
      });
      state = data.state;
      closeModal();
      renderAdminTab(backTab);
      toast('Reserva actualizada ✓', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  $('#er-cancel').onclick = closeModal;
}

async function cancelarReserva(id, backTab = 'reservas') {
  const r = state.reservations.find(x => x.id === id);
  if (!r) return;
  if (!confirm(`¿Cancelar la reserva de "${r.name}" (${fmtDate(r.date)} ${r.start} – ${r.end})?\nEl horario quedará libre.`)) return;
  try {
    const data = await api(`/api/reservations/${id}`, { method: 'DELETE', admin: true });
    state = data.state;
    renderAdminTab(backTab);
    toast('Reserva cancelada', 'ok');
  } catch (e) {
    toast(e.message, 'error');
  }
}

/* ---------- Historial ---------- */
function renderHistorial() {
  const filtro = $('#hist-filter').value;
  const q = ($('#hist-search').value || '').trim().toLowerCase();
  let list = [...state.reservations];
  if (filtro === 'futuras') list = list.filter(r => !esPasada(r) && r.estado !== 'cancelada');
  if (filtro === 'pasadas') list = list.filter(esPasada);
  if (q) list = list.filter(r => r.name.toLowerCase().includes(q));
  list.sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start));
  const activas = list.filter(r => r.estado !== 'cancelada');
  const horas = activas.reduce((s, r) => s + horasDe(r), 0);
  const total = activas.reduce((s, r) => s + precioReserva(r), 0);
  const canceladas = list.filter(r => r.estado === 'cancelada').length;
  $('#hist-summary').innerHTML = `<strong>${list.length}</strong> reserva(s) · <strong>${horas}</strong> hora(s) · <strong>${fmtMoney(total)}</strong>${canceladas ? ` · <span class="muted">${canceladas} cancelada(s)</span>` : ''}`;
  const grupos = {};
  list.forEach(r => { (grupos[r.date] = grupos[r.date] || []).push(r); });
  const fechas = Object.keys(grupos).sort().reverse();
  $('#hist-list').innerHTML = fechas.length ? fechas.map(f => `
    <h3 class="sub">${fmtDate(f)}${f < todayStr() ? ' <span class="muted">(pasada)</span>' : ''}</h3>
    ${grupos[f].sort((a, b) => a.start.localeCompare(b.start)).map(r => {
      const room = state.rooms.find(x => x.id === r.roomId);
      const canc = r.estado === 'cancelada';
      return `
        <div class="res-item ${esPasada(r) ? 'res-past' : ''} ${canc ? 'cancelada' : ''}">
          <div class="res-time">${r.start} – ${r.end}</div>
          <div class="res-info">
            <strong>${esc(room ? room.name : 'Sala eliminada')}${canc ? ' <span class="badge badge-past">Cancelada</span>' : ''}</strong>
            <div>${esc(r.name)}${r.phone ? ' · 📞 ' + esc(r.phone) : ''}</div>
          </div>
          <div class="res-price">${fmtMoney(precioReserva(r))}</div>
          <div class="res-actions">
            ${canc ? '' : `<button class="btn btn-sm" data-edit="${r.id}">Editar</button>`}
            ${canc ? '' : `<button class="btn btn-sm btn-danger" data-cancel="${r.id}">Cancelar</button>`}
          </div>
        </div>`;
    }).join('')}`).join('')
    : '<p class="muted">No hay reservas con esos filtros.</p>';
}

/* ---------- Salas ---------- */
const ESTADO_SALA_TXT = { pendiente: 'Pendiente de aprobación', aprobada: 'Aprobada', rechazada: 'Rechazada', suspendida: 'Suspendida' };

function renderSalasAdmin() {
  const grid = $('#salas-grid-admin');
  grid.innerHTML = state.rooms.length ? state.rooms.map(r => `
    <article class="room-card ${r.activo === false ? 'inactive' : ''}">
      ${r.foto ? `<div class="room-foto"><img src="${esc(r.foto)}" alt="${esc(r.name)}"></div>` : ''}
      <h3>${esc(r.name)} ${r.activo === false ? '<small class="muted">(inactiva)</small>' : ''}</h3>
      <div class="row wrap">
        <span class="badge ${r.estado === 'aprobada' ? '' : 'badge-next'}">${esc(ESTADO_SALA_TXT[r.estado] || r.estado)}</span>
        ${r.ownerId ? '<span class="badge">👤 Con dueño</span>' : '<span class="badge badge-past">Sin dueño</span>'}
      </div>
      ${r.localidad || r.direccion ? `<div class="room-ubic">📍 ${esc([r.localidad, r.direccion].filter(Boolean).join(' · '))}</div>` : ''}
      <div class="price">${fmtMoney(r.price)}<span> /hora</span></div>
      <div class="cap">👥 Hasta ${r.capacity} ${r.capacity === 1 ? 'persona' : 'personas'}</div>
      <ul class="feats">${r.features.length ? r.features.map(f => `<li>${esc(f)}</li>`).join('') : '<li>Sin características</li>'}</ul>
      <div class="row wrap">
        <button class="btn btn-sm" data-edit-room="${r.id}">Editar</button>
        <button class="btn btn-sm" data-toggle-room="${r.id}">${r.activo === false ? 'Activar' : 'Desactivar'}</button>
        <button class="btn btn-sm btn-danger" data-del-room="${r.id}">Eliminar</button>
      </div>
    </article>`).join('')
    : '<p class="muted">Aún no hay salas. Crea la primera con el botón "Nueva sala".</p>';
}

function formularioSala(id) {
  const r = id ? state.rooms.find(x => x.id === id) : { name: '', price: 10000, capacity: 4, features: [], activo: true, estado: 'aprobada', foto: '', fotoPortada: '', direccion: '', localidad: '', telefono: '', descripcion: '', equipos: {}, fotos: [] };
  if (id && !r) return;
  let fotoNueva = null;
  let portadaNueva = null;
  const eq = r.equipos || {};
  openModal(`
    <h3>${id ? 'Editar sala' : 'Nueva sala'}</h3>
    <div class="sala-foto-edit" id="fr-preview">${r.foto
      ? `<img src="${esc(r.foto)}" alt="${esc(r.name)}">`
      : '<span class="sala-chip-foto" style="width:60px;height:60px;font-size:1.6rem">🎸</span>'}</div>
    <label>Logo o foto de la sala<input type="file" id="fr-foto" accept="image/*"></label>
    <label class="check" id="fr-quitar-wrap" ${r.foto ? '' : 'hidden'}><input type="checkbox" id="fr-quitar"> Quitar la foto</label>
    <h3 class="sub">Foto horizontal (la que se ve en el mapa)</h3>
    <div class="portada-preview" id="fr-portada-preview">${r.fotoPortada
      ? `<img src="${esc(r.fotoPortada)}" alt="Foto horizontal de ${esc(r.name)}">`
      : '<span>Sin foto horizontal</span>'}</div>
    <label>Cambiar foto horizontal<input type="file" id="fr-portada" accept="image/*"></label>
    <label class="check" id="fr-portada-quitar-wrap" ${r.fotoPortada ? '' : 'hidden'}><input type="checkbox" id="fr-portada-quitar"> Quitar la foto horizontal</label>
    <label>Nombre *<input id="fr-name" maxlength="60" value="${esc(r.name)}" placeholder="Ej.: Sala 1"></label>
    <div class="row2">
      <label>Precio por hora *<input type="number" id="fr-price" min="1" step="1" value="${r.price}"></label>
      <label>Capacidad *<input type="number" id="fr-cap" min="1" step="1" value="${r.capacity}"></label>
    </div>
    <label>Dirección<input id="fr-direccion" maxlength="160" value="${esc(r.direccion || '')}"></label>
    <div class="row2">
      <label>Localidad / zona<input id="fr-localidad" maxlength="80" value="${esc(r.localidad || '')}"></label>
      <label>Teléfono<input id="fr-tel" maxlength="30" value="${esc(r.telefono || '')}"></label>
    </div>
    <label>Descripción<textarea id="fr-desc" rows="2" maxlength="600">${esc(r.descripcion || '')}</textarea></label>
    <label>Características (separadas por coma)<input id="fr-feats" value="${esc((r.features || []).join(', '))}" placeholder="Batería, Amplificadores"></label>
    <label>Ubicación en el mapa<input id="fr-mapa" maxlength="300" value="${esc(r.mapa || '')}" placeholder="Enlace de Google Maps"></label>
    <div class="row2">
      <label>Latitud<input id="fr-lat" inputmode="decimal" value="${r.lat != null ? esc(r.lat) : ''}" placeholder="-31.4201"></label>
      <label>Longitud<input id="fr-lng" inputmode="decimal" value="${r.lng != null ? esc(r.lng) : ''}" placeholder="-64.1888"></label>
    </div>
    <div class="row wrap">
      <button class="btn btn-sm" type="button" id="fr-ubicar">🗺 Ubicar en el mapa</button>
      <button class="btn btn-sm" type="button" id="fr-buscar">🔎 Buscar por dirección</button>
    </div>
    <h3 class="sub">Equipamiento</h3>
    <div class="row2">
      <label>Instrumentos<input id="fr-eq-instrumentos" maxlength="300" value="${esc(eq.instrumentos || '')}"></label>
      <label>Batería<input id="fr-eq-bateria" maxlength="300" value="${esc(eq.bateria || '')}"></label>
    </div>
    <div class="row2">
      <label>Amplificadores<input id="fr-eq-amp" maxlength="300" value="${esc(eq.amplificadores || '')}"></label>
      <label>Micrófonos<input id="fr-eq-micro" maxlength="300" value="${esc(eq.microfonos || '')}"></label>
    </div>
    <div class="row2">
      <label>Consola / sonido<input id="fr-eq-consola" maxlength="300" value="${esc(eq.consola || '')}"></label>
      <label>Otros<input id="fr-eq-otros" maxlength="300" value="${esc(eq.otros || '')}"></label>
    </div>
    ${(r.fotos || []).length ? `<div class="mini-fotos">${r.fotos.map(f => `<div class="mini-foto"><img src="${esc(f.foto)}" alt=""></div>`).join('')}</div>` : ''}
    <div class="row2">
      <label>Estado<select id="fr-estado">
        ${Object.entries(ESTADO_SALA_TXT).map(([k, v]) => `<option value="${k}" ${r.estado === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
      </select></label>
      <label>Duración del turno<select id="fr-turno">
        ${[30, 60, 90, 120].map(t => `<option value="${t}" ${(r.turnoMin || 60) === t ? 'selected' : ''}>${t < 60 ? t + ' min' : (t / 60) + ' h'}</option>`).join('')}
      </select></label>
    </div>
    <label class="check"><input type="checkbox" id="fr-active" ${r.activo !== false ? 'checked' : ''}> Sala visible para reservar</label>
    <div class="row">
      <button class="btn btn-primary" id="fr-save">💾 Guardar cambios</button>
      <button class="btn" id="fr-cancel">Cancelar</button>
    </div>`);

  $('#fr-foto').onchange = e => {
    const f = e.target.files[0];
    if (!f) return;
    comprimirImagen(f)
      .then(dataUrl => {
        fotoNueva = dataUrl;
        $('#fr-preview').innerHTML = `<img src="${dataUrl}" alt="previsualización">`;
        $('#fr-quitar').checked = false;
        toast('Logo listo ✓', 'ok');
      })
      .catch(err => toast(err.message || 'No se pudo leer la imagen', 'error'));
  };

  $('#fr-portada').onchange = e => {
    const f = e.target.files[0];
    if (!f) return;
    comprimirImagen(f, 1400)
      .then(dataUrl => {
        portadaNueva = dataUrl;
        $('#fr-portada-preview').innerHTML = `<img src="${dataUrl}" alt="previsualización">`;
        $('#fr-portada-quitar').checked = false;
        toast('Foto horizontal lista ✓', 'ok');
      })
      .catch(err => toast(err.message || 'No se pudo leer la imagen', 'error'));
  };

  $('#fr-save').onclick = async () => {
    const name = $('#fr-name').value.trim();
    const price = Math.max(1, parseInt($('#fr-price').value, 10) || 0);
    const capacity = Math.max(1, parseInt($('#fr-cap').value, 10) || 1);
    if (!name) { toast('El nombre es obligatorio', 'warn'); return; }
    const features = $('#fr-feats').value.split(',').map(s => s.trim()).filter(Boolean);
    const body = {
      name, price, capacity, features,
      active: $('#fr-active').checked,
      estado: $('#fr-estado').value,
      turnoMin: Number($('#fr-turno').value),
      direccion: $('#fr-direccion').value.trim(),
      localidad: $('#fr-localidad').value.trim(),
      telefono: $('#fr-tel').value.trim(),
      descripcion: $('#fr-desc').value.trim(),
      mapa: $('#fr-mapa').value.trim(),
      lat: $('#fr-lat').value.trim(),
      lng: $('#fr-lng').value.trim(),
      equipos: {
        instrumentos: $('#fr-eq-instrumentos').value.trim(),
        bateria: $('#fr-eq-bateria').value.trim(),
        amplificadores: $('#fr-eq-amp').value.trim(),
        microfonos: $('#fr-eq-micro').value.trim(),
        consola: $('#fr-eq-consola').value.trim(),
        otros: $('#fr-eq-otros').value.trim(),
      },
    };
    const quitar = $('#fr-quitar-wrap').hidden ? false : $('#fr-quitar').checked;
    if (quitar) body.foto = '';
    else if (fotoNueva) body.foto = fotoNueva;
    const quitarPortada = $('#fr-portada-quitar-wrap').hidden ? false : $('#fr-portada-quitar').checked;
    if (quitarPortada) body.fotoPortada = '';
    else if (portadaNueva) body.fotoPortada = portadaNueva;
    try {
      const data = id
        ? await api(`/api/rooms/${id}`, { method: 'PUT', admin: true, body })
        : await api('/api/rooms', { method: 'POST', admin: true, body });
      state = data.state;
      closeModal();
      renderAdminTab('salas');
      renderSalasStrip();
      renderRooms();
      toast('Sala guardada ✓', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  $('#fr-cancel').onclick = closeModal;
  /* Ubicación en el mapa */
  $('#fr-ubicar').onclick = async () => {
    const p = await abrirSelectorUbicacion($('#fr-lat').value, $('#fr-lng').value, 'Ubicá la sala en el mapa');
    if (!p) return;
    $('#fr-lat').value = p.lat.toFixed(5);
    $('#fr-lng').value = p.lng.toFixed(5);
  };
  $('#fr-buscar').onclick = async () => {
    const dir = $('#fr-direccion').value.trim() + ' ' + $('#fr-localidad').value.trim();
    const p = await buscarDireccion(dir);
    if (!p) return;
    $('#fr-lat').value = p.lat.toFixed(5);
    $('#fr-lng').value = p.lng.toFixed(5);
    if (!$('#fr-mapa').value) $('#fr-mapa').value = p.nombre.slice(0, 300);
    toast('Ubicación encontrada 📍', 'ok');
  };
}

async function eliminarSala(id) {
  const r = state.rooms.find(x => x.id === id);
  if (!r) return;
  const n = state.reservations.filter(x => x.roomId === id).length;
  if (!confirm(`¿Eliminar "${r.name}"?\nSe borrarán también ${n} reserva(s) y sus bloqueos.`)) return;
  try {
    const data = await api(`/api/rooms/${id}`, { method: 'DELETE', admin: true });
    state = data.state;
    renderAdminTab('salas');
    toast('Sala eliminada', 'ok');
  } catch (e) {
    toast(e.message, 'error');
  }
}

/* ---------- Instrumentos y fotos del lugar (admin) ---------- */
function renderLugarAdmin() {
  $('#instruments-admin').innerHTML = (state.instruments || []).length ? (state.instruments || []).map(i => `
    <div class="res-item">
      <div class="res-info">
        <strong>${esc(i.nombre)}</strong>
        <div>${esc(i.descripcion || '—')}</div>
        ${i.alquiler ? `<div class="muted small">🎒 Alquiler ${fmtMoney(i.precioAlquiler)}/hora</div>` : ''}
        ${i.foto ? `<div class="muted small">📷 ${esc(i.foto)}</div>` : ''}
      </div>
      <div class="res-actions">
        <button class="btn btn-sm" data-edit-inst="${i.id}">Editar</button>
        <button class="btn btn-sm" data-toggle-inst="${i.id}">${i.activo === false ? 'Activar' : 'Desactivar'}</button>
        <button class="btn btn-sm btn-danger" data-del-inst="${i.id}">Eliminar</button>
      </div>
    </div>`).join('')
    : '<p class="muted">Aún no hay instrumentos.</p>';

  $('#place-photos-admin').innerHTML = (state.placePhotos || []).length ? (state.placePhotos || []).map(p => `
    <div class="res-item">
      <div class="res-info">
        <strong>${esc(p.titulo || 'Foto')}</strong>
        <div class="muted small">${esc(p.foto)}</div>
      </div>
      <div class="res-actions">
        <button class="btn btn-sm" data-edit-photo="${p.id}">Editar</button>
        <button class="btn btn-sm btn-danger" data-del-photo="${p.id}">Eliminar</button>
      </div>
    </div>`).join('')
    : '<p class="muted">Aún no hay fotos del lugar.</p>';
}

function formularioInstrumento(id) {
  const i = id ? (state.instruments || []).find(x => x.id === id) : { nombre: '', descripcion: '', foto: '', activo: true };
  if (id && !i) return;
  openModal(`
    <h3>${id ? 'Editar instrumento' : 'Nuevo instrumento'}</h3>
    <label>Nombre *<input id="fi-name" maxlength="50" value="${esc(i.nombre)}" placeholder="Ej.: Batería completa"></label>
    <label>Descripción<input id="fi-desc" maxlength="200" value="${esc(i.descripcion)}" placeholder="Ej.: Pearl Export 5 piezas + platillos"></label>
    <label>Foto (ruta o URL)<input id="fi-foto" maxlength="300" value="${esc(i.foto)}" placeholder="assets/instrumentos/bateria.png o https://..."></label>
    <p class="muted small">Sin foto se muestra un ícono. Guarda las fotos en <code>public/assets/</code> del servidor o usa un enlace.</p>
    <label class="check"><input type="checkbox" id="fi-alquiler" ${i.alquiler ? 'checked' : ''}> 🎒 Se puede alquilar a los músicos</label>
    <label>Precio del alquiler por hora<input type="number" id="fi-precio-alq" min="0" step="1" value="${i.precioAlquiler || 0}"></label>
    <label class="check"><input type="checkbox" id="fi-active" ${i.activo !== false ? 'checked' : ''}> Visible para los visitantes</label>
    <div class="row">
      <button class="btn btn-primary" id="fi-save">Guardar</button>
      <button class="btn" id="fi-cancel">Cancelar</button>
    </div>`);
  $('#fi-save').onclick = async () => {
    const nombre = $('#fi-name').value.trim();
    if (!nombre) { toast('El nombre es obligatorio', 'warn'); return; }
    const body = {
      nombre,
      descripcion: $('#fi-desc').value.trim(),
      foto: $('#fi-foto').value.trim(),
      alquiler: $('#fi-alquiler').checked,
      precioAlquiler: $('#fi-precio-alq').value,
      activo: $('#fi-active').checked,
    };
    try {
      const data = id
        ? await api(`/api/instruments/${id}`, { method: 'PUT', admin: true, body })
        : await api('/api/instruments', { method: 'POST', admin: true, body });
      state = data.state;
      closeModal();
      renderLugarAdmin();
      toast('Instrumento guardado ✓', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  $('#fi-cancel').onclick = closeModal;
}

async function eliminarInstrumento(id) {
  const i = (state.instruments || []).find(x => x.id === id);
  if (!i) return;
  if (!confirm(`¿Eliminar "${i.nombre}"?`)) return;
  try {
    const data = await api(`/api/instruments/${id}`, { method: 'DELETE', admin: true });
    state = data.state;
    renderLugarAdmin();
    toast('Instrumento eliminado', 'ok');
  } catch (e) {
    toast(e.message, 'error');
  }
}

function formularioFotoLugar(id) {
  const p = id ? (state.placePhotos || []).find(x => x.id === id) : { titulo: '', foto: '' };
  if (id && !p) return;
  openModal(`
    <h3>${id ? 'Editar foto' : 'Nueva foto del lugar'}</h3>
    <label>Título<input id="fp-title" maxlength="60" value="${esc(p.titulo)}" placeholder="Ej.: Sala 1"></label>
    <label>Foto (ruta o URL) *<input id="fp-foto" maxlength="300" value="${esc(p.foto)}" placeholder="assets/lugar/sala-1.png o https://..."></label>
    <p class="muted small">Guarda las fotos en <code>public/assets/</code> del servidor o usa un enlace https://.</p>
    <div class="row">
      <button class="btn btn-primary" id="fp-save">Guardar</button>
      <button class="btn" id="fp-cancel">Cancelar</button>
    </div>`);
  $('#fp-save').onclick = async () => {
    const foto = $('#fp-foto').value.trim();
    if (!foto) { toast('La foto es obligatoria', 'warn'); return; }
    const body = { titulo: $('#fp-title').value.trim(), foto };
    try {
      const data = id
        ? await api(`/api/place-photos/${id}`, { method: 'PUT', admin: true, body })
        : await api('/api/place-photos', { method: 'POST', admin: true, body });
      state = data.state;
      closeModal();
      renderLugarAdmin();
      toast('Foto guardada ✓', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  $('#fp-cancel').onclick = closeModal;
}

async function eliminarFotoLugar(id) {
  const p = (state.placePhotos || []).find(x => x.id === id);
  if (!p) return;
  if (!confirm(`¿Eliminar la foto "${p.titulo || 'sin título'}"?`)) return;
  try {
    const data = await api(`/api/place-photos/${id}`, { method: 'DELETE', admin: true });
    state = data.state;
    renderLugarAdmin();
    toast('Foto eliminada', 'ok');
  } catch (e) {
    toast(e.message, 'error');
  }
}

/* ---------- Bandas registradas (admin) ---------- */
function renderBandasAdmin() {
  const list = bandas();
  $('#bands-admin').innerHTML = list.length ? list.map(b => `
    <div class="band-admin-item">
      <span class="band-avatar band-avatar-lg">${b.foto
        ? `<img src="${esc(b.foto)}" alt="${esc(b.nombre)}">`
        : '🎭'}</span>
      ${b.fotoGrupal ? `<img class="band-mini-grupo" src="${esc(b.fotoGrupal)}" alt="foto grupal">` : ''}
      <div class="res-info">
        <strong>${esc(b.nombre)}</strong>
        <div class="muted small">${(b.integrantes || []).length ? '👥 ' + b.integrantes.length + ' integrantes' : 'Sin integrantes'}${b.genero ? ' · ' + esc(b.genero) : ''}${b.foto ? ' · Con foto' : ''}</div>
      </div>
      <div class="res-actions">
        <button class="btn btn-sm" data-edit-band="${b.id}">Editar</button>
        <button class="btn btn-sm btn-danger" data-del-band="${b.id}">Eliminar</button>
      </div>
    </div>`).join('')
    : '<p class="muted">Aún no se han registrado bandas.</p>';
}

async function eliminarBanda(id) {
  const b = bandas().find(x => x.id === id);
  if (!b) return;
  const n = state.reservations.filter(r =>
    String(r.name).trim().toLowerCase() === b.nombre.trim().toLowerCase()).length;
  if (!confirm(`¿Eliminar la banda "${b.nombre}"?\nLas ${n} reserva(s) con ese nombre se conservan.`)) return;
  try {
    const data = await api(`/api/bands/${id}`, { method: 'DELETE', admin: true });
    state = data.state;
    renderBandasAdmin();
    toast('Banda eliminada', 'ok');
  } catch (e) {
    toast(e.message, 'error');
  }
}

/* Solo se aceptan enlaces http(s) para evitar esquemas peligrosos */
function safeUrl(u) { return /^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : ''; }

/* ---------- Inicio del panel: resumen del día ---------- */
function renderInicioAdmin() {
  const cont = $('#inicio-admin');
  if (!cont) return;
  const hoy = todayStr();
  const fechaTxt = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
  const list = (state.reservations || [])
    .filter(r => r.date === hoy && r.estado !== 'cancelada')
    .sort((a, b) => a.start.localeCompare(b.start));
  const ingresos = list.reduce((s, r) => s + precioReserva(r), 0);
  const pendPago = list.filter(r => r.estado === 'pendiente_pago').length;
  const solicitudes = (state.rooms || []).filter(r => r.estado === 'pendiente').length;
  const promos = promosActivas();
  const nombreSala = id => { const s = (state.rooms || []).find(x => x.id === id); return s ? s.name : 'Sala eliminada'; };

  cont.innerHTML = `
    <div class="inicio-saludo">
      <h2>Hola${yo ? ', ' + esc(yo.usuario) : ''} 👋</h2>
      <p class="muted small">${esc(fechaTxt)}</p>
    </div>

    <div class="admin-stats inicio-stats">
      <div class="stat"><span>Reservas hoy</span><b>${list.length}</b></div>
      <div class="stat"><span>Ingresos de hoy</span><b>${fmtMoney(ingresos)}</b></div>
      <div class="stat"><span>Pendientes de pago</span><b>${pendPago}</b></div>
      <div class="stat"><span>Solicitudes de salas</span><b>${solicitudes}</b></div>
    </div>

    <div class="inicio-grid">
      <section class="inicio-card">
        <h3>Próximas reservas de hoy</h3>
        ${list.length ? `<ul class="inicio-prox">${list.slice(0, 6).map(r => `
          <li><time>${esc(r.start)}–${esc(r.end)}</time><span class="nom">${esc(r.name)}</span><span class="sala">${esc(nombreSala(r.roomId))}</span></li>`).join('')}</ul>`
          : '<p class="muted small">No hay reservas para hoy.</p>'}
        <div class="inicio-pie"><button class="btn btn-sm" data-goto="reservas">Ver agenda completa</button></div>
      </section>

      <section class="inicio-card">
        <h3>Accesos rápidos</h3>
        <div class="inicio-links">
          <button class="inicio-link" data-goto="solicitudes"><span>Solicitudes</span>${solicitudes ? `<b class="n">${solicitudes}</b>` : ''}<i>›</i></button>
          <button class="inicio-link" data-goto="promociones"><span>Promociones</span><i>›</i></button>
          <button class="inicio-link" data-goto="estadisticas"><span>Estadísticas</span><i>›</i></button>
          <button class="inicio-link" data-goto="ajustes"><span>Ajustes</span><i>›</i></button>
        </div>
      </section>

      <section class="inicio-card ancha">
        <h3>🎉 Promociones activas <span class="muted small">(${promos.length})</span></h3>
        ${promosBloqueHTML(promos, 'No hay promociones activas. Cuando actives una, aparece acá.')}
        <div class="inicio-pie"><button class="btn btn-sm" data-goto="promociones">Administrar promociones</button></div>
      </section>
    </div>`;

  cont.onclick = e => {
    const g = e.target.closest('[data-goto]');
    if (g) return renderAdminTab(g.dataset.goto);
    const pp = e.target.closest('[data-promo-id]');
    if (pp && !e.target.closest('a')) abrirPromo(pp.dataset.promoId);
  };
}

/* ---------- Promociones y novedades ---------- */
function renderPromocionesAdmin() {
  const cont = $('#promociones-admin');
  if (!cont) return;
  const lista = [...(state.promociones || [])].sort((a, b) => (b.creado || 0) - (a.creado || 0));
  const f = d => d ? new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: '2-digit' }) : '—';
  cont.innerHTML = lista.length ? lista.map(p => `
    <div class="res-item ${p.activa === false ? 'res-past' : ''}">
      ${p.flyer ? `<img class="promo-thumb" src="${esc(p.flyer)}" alt="Flyer de ${esc(p.titulo)}">` : ''}
      <div class="res-info">
        <strong>${esc(p.titulo)} ${p.activa === false ? '<span class="badge badge-past">Inactiva</span>' : '<span class="badge">Activa</span>'}</strong>
        <div class="muted small">${esc(p.texto)}</div>
        <div class="muted small">Desde ${f(p.desde)} hasta ${f(p.hasta)}</div>
        ${linksRedesHTML(p.redes) ? `<div class="muted small">${linksRedesHTML(p.redes)}</div>` : ''}
      </div>
      <div class="res-actions">
        <button class="btn btn-sm" data-edit-promo="${p.id}">Editar</button>
        <button class="btn btn-sm" data-toggle-promo="${p.id}">${p.activa === false ? 'Activar' : 'Desactivar'}</button>
        <button class="btn btn-sm btn-danger" data-del-promo="${p.id}">Eliminar</button>
      </div>
    </div>`).join('') : '<p class="muted">No hay promociones cargadas.</p>';
}

function formularioPromocion(id) {
  const p = id ? (state.promociones || []).find(x => x.id === id) : { titulo: '', texto: '', activa: true, flyer: '', redes: '' };
  if (id && !p) return;
  const aIso = t => t ? new Date(t).toISOString().slice(0, 10) : '';
  openModal(`
    <h3>${id ? 'Editar promoción' : 'Nueva promoción'}</h3>
    <label>Título *<input id="pr-titulo" maxlength="80" value="${esc(p.titulo)}" placeholder="Ej.: 🎉 2x1 los martes"></label>
    <label>Texto<textarea id="pr-texto" rows="3" maxlength="400" placeholder="Detalle corto que se verá en el Inicio">${esc(p.texto)}</textarea></label>
    <div class="row2">
      <label>Desde<input type="date" id="pr-desde" value="${aIso(p.desde || Date.now())}"></label>
      <label>Hasta<input type="date" id="pr-hasta" value="${aIso(p.hasta || (Date.now() + 864e5 * 30))}"></label>
    </div>
    <div class="promo-flyer-edit">
      <label>Flyer (foto de la promo)<input type="file" id="pr-flyer" accept="image/*"></label>
      <div id="pr-flyer-prev">${p.flyer ? `<img src="${esc(p.flyer)}" alt="Flyer actual">` : ''}</div>
      <label class="check" id="pr-quitar-wrap" ${p.flyer ? '' : 'hidden'}><input type="checkbox" id="pr-quitar"> Quitar el flyer</label>
    </div>
    <label>Enlaces a redes (uno o más, separados por espacio)<input id="pr-redes" maxlength="500" value="${esc(p.redes || '')}" placeholder="instagram.com/tu_sala facebook.com/tu_sala"></label>
    <label class="check"><input type="checkbox" id="pr-activa" ${p.activa !== false ? 'checked' : ''}> Mostrar en el Inicio</label>
    <div class="row">
      <button class="btn btn-primary" id="pr-guardar">💾 Guardar</button>
      <button class="btn" id="pr-cancelar">Cancelar</button>
    </div>`);
  let flyerNuevo = null;          /* null = no tocar; '' = quitar; dataURL = nuevo */
  $('#pr-flyer').onchange = async e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      flyerNuevo = await comprimirImagen(f, 1000);
      $('#pr-flyer-prev').innerHTML = `<img src="${flyerNuevo}" alt="Flyer nuevo">`;
      $('#pr-quitar-wrap').hidden = false;
      $('#pr-quitar').checked = false;
    } catch (err) { toast(err.message, 'warn'); }
  };
  $('#pr-quitar').onchange = e => {
    if (e.target.checked) { flyerNuevo = ''; $('#pr-flyer-prev').innerHTML = ''; $('#pr-flyer').value = ''; }
    else { flyerNuevo = null; $('#pr-flyer-prev').innerHTML = p.flyer ? `<img src="${esc(p.flyer)}" alt="Flyer actual">` : ''; }
  };
  $('#pr-cancelar').onclick = closeModal;
  $('#pr-guardar').onclick = async () => {
    const titulo = $('#pr-titulo').value.trim();
    if (!titulo) { toast('Escribí el título', 'warn'); return; }
    const redes = parseRedes($('#pr-redes').value).join(' ');
    const body = {
      titulo,
      texto: $('#pr-texto').value.trim(),
      activa: $('#pr-activa').checked,
      flyer: flyerNuevo !== null ? flyerNuevo : (p.flyer || ''),
      redes,
      desde: new Date($('#pr-desde').value + 'T08:00:00').getTime(),
      hasta: new Date($('#pr-hasta').value + 'T23:59:00').getTime(),
    };
    try {
      const data = id
        ? await api(`/api/promociones/${id}`, { method: 'PUT', admin: true, body })
        : await api('/api/promociones', { method: 'POST', admin: true, body });
      state = data.state;
      closeModal();
      renderAdminTab('promociones');
      renderResumenInicio();
      toast('Promoción guardada ✓', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  };
}

/* ---------- Horarios ---------- */
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function renderHorariosAdmin() {
  $('#hours-container').innerHTML = DIAS.map((d, i) => {
    const h = state.settings.hours[String(i)];
    return `
      <div class="hour-row">
        <strong>${d}</strong>
        <label class="check"><input type="checkbox" data-closed="${i}" ${h ? '' : 'checked'}> Cerrado</label>
        <input type="time" data-open="${i}" value="${h ? h.open : '10:00'}" ${h ? '' : 'disabled'}>
        <span class="muted">a</span>
        <input type="time" data-close="${i}" value="${h ? h.close : '22:00'}" ${h ? '' : 'disabled'}>
      </div>`;
  }).join('');
  $$('#hours-container [data-closed]').forEach(cb => {
    cb.onchange = () => {
      const i = cb.dataset.closed;
      $(`[data-open="${i}"]`).disabled = cb.checked;
      $(`[data-close="${i}"]`).disabled = cb.checked;
    };
  });
}

async function guardarHorarios() {
  const hours = {};
  for (let i = 0; i < 7; i++) {
    if ($(`[data-closed="${i}"]`).checked) { hours[String(i)] = null; continue; }
    const open = $(`[data-open="${i}"]`).value || '10:00';
    const close = $(`[data-close="${i}"]`).value || '22:00';
    if (toMin(open) >= toMin(close)) { toast(`Horario inválido el día ${DIAS[i]}`, 'error'); return; }
    hours[String(i)] = { open, close };
  }
  try {
    const data = await api('/api/settings/hours', { method: 'PUT', admin: true, body: { hours } });
    state = data.state;
    toast('Horarios actualizados ✓', 'ok');
  } catch (e) {
    toast(e.message, 'error');
  }
}

/* ---------- Bloqueos ---------- */
function renderBloqueosAdmin() {
  const selRoom = $('#blk-room');
  const actual = selRoom.value;
  selRoom.innerHTML = state.rooms.filter(r => r.activo !== false)
    .map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
  if (actual && state.rooms.some(r => r.id === actual && r.activo !== false)) selRoom.value = actual;
  if (!$('#blk-date').value) $('#blk-date').value = todayStr();
  const list = [...state.blocks].sort((a, b) => (a.date + a.from).localeCompare(b.date + b.from));
  $('#blocks-list').innerHTML = list.length ? list.map(b => {
    const room = state.rooms.find(x => x.id === b.roomId);
    return `
      <div class="res-item">
        <div class="res-time">${fmtDate(b.date, { day: 'numeric', month: 'short' })}<br>${b.from} – ${b.to}</div>
        <div class="res-info">
          <strong>${esc(room ? room.name : '—')}</strong>
          <div>${esc(b.reason || 'Sin motivo')}</div>
        </div>
        <div class="res-actions">
          <button class="btn btn-sm btn-danger" data-del-block="${b.id}">Quitar</button>
        </div>
      </div>`;
  }).join('') : '<p class="muted">No hay bloqueos. Los horarios bloqueados no aparecen disponibles para reservar.</p>';
}

async function agregarBloque() {
  const roomId = $('#blk-room').value;
  const date = $('#blk-date').value;
  const from = $('#blk-from').value, to = $('#blk-to').value;
  const reason = $('#blk-reason').value.trim();
  if (!roomId || !date || !from || !to) { toast('Completa todos los campos', 'warn'); return; }
  if (toMin(from) >= toMin(to)) { toast('La hora de inicio debe ser anterior al cierre', 'warn'); return; }
  try {
    const data = await api('/api/blocks', { method: 'POST', admin: true, body: { roomId, date, from, to, reason } });
    state = data.state;
    renderBloqueosAdmin();
    toast('Horario bloqueado ✓', 'ok');
  } catch (e) {
    toast(e.message, 'error');
  }
}

/* ---------- Estadísticas ---------- */
function renderStats() {
  const inp = $('#stats-month');
  if (!inp.value) inp.value = todayStr().slice(0, 7);
  const prefix = inp.value;
  const [y, m] = prefix.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();

  let totalSlots = 0, horasOcupadas = 0, reservas = 0, revenue = 0;
  const perRoom = {};
  state.rooms.forEach(r => { perRoom[r.id] = { name: r.name, active: r.activo !== false && r.estado === 'aprobada', slots: 0, horas: 0, reservas: 0, revenue: 0 }; });

  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${prefix}-${pad2(d)}`;
    state.rooms.forEach(r => {
      if (!perRoom[r.id].active) return;
      const { slots } = slotsFor(ds, r.id);
      const avail = slots.filter(s => s.status !== 'past').length;
      totalSlots += avail;
      perRoom[r.id].slots += avail;
    });
  }
  state.reservations.forEach(r => {
    if (!r.date.startsWith(prefix)) return;
    if (r.estado === 'cancelada') return;
    const room = state.rooms.find(x => x.id === r.roomId);
    const amount = precioReserva(r);
    const h = horasDe(r);
    reservas++;
    horasOcupadas += h;
    revenue += amount;
    if (room && perRoom[room.id]) { perRoom[room.id].horas += h; perRoom[room.id].reservas++; perRoom[room.id].revenue += amount; }
  });

  const fmtPct = (b, s) => {
    if (!s) return '0%';
    const p = (b / s) * 100;
    if (p === 0) return '0%';
    if (p < 1) return '<1%';
    return Math.round(p) + '%';
  };
  const occ = fmtPct(horasOcupadas, totalSlots);

  let next7 = 0;
  for (let i = 0; i < 7; i++) {
    const ds = addDaysStr(todayStr(), i);
    next7 += state.reservations.filter(r => r.date === ds && r.estado !== 'cancelada').reduce((s, r) => s + horasDe(r), 0);
  }
  const top = Object.values(perRoom).filter(p => p.active && p.reservas > 0).sort((a, b) => b.reservas - a.reservas)[0];

  $('#stats-cards').innerHTML = `
    <div class="stat"><span>💰 Ingresos del mes</span><strong>${fmtMoney(revenue)}</strong></div>
    <div class="stat"><span>📊 Ocupación</span><strong>${occ}</strong></div>
    <div class="stat"><span>📲 Reservas</span><strong>${reservas}</strong></div>
    <div class="stat"><span>⏱ Horas reservadas</span><strong>${horasOcupadas}</strong></div>
    <div class="stat"><span>🗓 Próximos 7 días</span><strong>${next7} h</strong></div>
    ${top ? `<div class="stat"><span>🎸 Sala más reservada</span><strong>${esc(top.name)}</strong></div>` : ''}`;

  $('#stats-table').innerHTML = `
    <table>
      <thead><tr><th>Sala</th><th>Reservas</th><th>Horas</th><th>Ingresos</th><th>Ocupación</th></tr></thead>
      <tbody>${Object.values(perRoom).filter(p => p.active).map(p => `
        <tr>
          <td>${esc(p.name)}</td>
          <td>${p.reservas}</td>
          <td>${p.horas}</td>
          <td>${fmtMoney(p.revenue)}</td>
          <td>${fmtPct(p.horas, p.slots)}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

/* ---------- Ajustes ---------- */
function renderAjustes() {
  $('#set-currency').value = state.settings.currency;
  $('#set-pin').value = '';
  const inGmaps = $('#set-gmaps');
  if (inGmaps) inGmaps.value = state.settings.gmapsKey || '';
  /* Contacto: redes + email de avisos */
  const c = (state.settings && state.settings.contacto) || {};
  const val = id => { const el = $(id); if (el) el.value = c[id.replace(/^#?set-/, '')] || ''; };
  val('#set-whatsapp'); val('#set-instagram'); val('#set-facebook'); val('#set-tiktok');
  const mailEl = $('#set-contact-email');
  if (mailEl) mailEl.value = c.email || '';
  const estMail = $('#mail-estado');
  if (estMail) {
    estMail.innerHTML = state.settings.avisoMail
      ? (c.email
        ? '✅ <strong>Mail de avisos activo.</strong> Cada registro y pedido de ayuda llega a <strong>' + esc(c.email) + '</strong> además del timbre 🔔 de la app.'
        : '⚠️ El mail de avisos está activo, pero falta cargar el <strong>email de contacto</strong> de arriba para saber a dónde enviarlo.')
      : '⚪ Mail de avisos desactivado: los avisos llegan solo al timbre 🔔 de la app. Para activarlos agregá <code>RESEND_API_KEY</code> en <code>server.js</code> y reiniciá el servidor (resend.com).';
  }
  const estadoG = $('#gmaps-estado');
  if (estadoG) {
    estadoG.innerHTML = state.settings.gmapsKey
      ? (gmapaFallo
        ? '⚠️ <strong>La clave no funcionó</strong> (revisá que la <em>Maps JavaScript API</em> esté habilitada). El mapa usa OpenStreetMap.'
        : '✅ <strong>Google Maps activo</strong> en el mapa y en el buscador de direcciones.')
      : '⚪ Sin clave: el mapa usa OpenStreetMap y la búsqueda de direcciones usa OpenStreetMap.';
  }
  const selCancel = $('#set-cancelacion');
  if (selCancel) selCancel.value = String((state.settings.reglas && state.settings.reglas.cancelacionHoras) || 0);
  $('#admin-device-info').innerHTML = esDispositivoAdmin()
    ? '✅ Este dispositivo está autorizado como <strong>administrador</strong>: el botón 🔒 aparece en el inicio. En otros dispositivos no se ve.'
    : '🔒 Este dispositivo <strong>no</strong> es de administración. Para entrar: doble toque en el logo (o URL con <code>#admin</code>) y escribí tu usuario y contraseña.';
  const info = $('#admin-cuenta-info');
  if (info) {
    info.innerHTML = yo
      ? 'Estos son los datos de la cuenta que administra la app. Podés editarlos y cambiar la contraseña.'
      : '⚠️ Entrás con el <strong>PIN de emergencia</strong> (no hay cuenta de administración general iniciada).';
  }
  /* Tarjeta resumen de la cuenta madre */
  const resumen = $('#cm-resumen');
  if (resumen) {
    const fecha = t => t ? new Date(t).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
    resumen.innerHTML = yo
      ? `<div class="cm-ava">${yo.foto ? `<img src="${esc(yo.foto)}" alt="">` : '<span>👑</span>'}</div>
         <div class="cm-datos">
           <strong>${esc(yo.nombre)}</strong>
           <span class="cm-badge">Super administradora</span>
           <span class="muted small">@${esc(yo.usuario)} · ${esc(yo.email || 'sin email')}</span>
           <span class="muted small">Cuenta creada: ${fecha(yo.creado)} · Último acceso: ${fecha(yo.ultimoAcceso)}</span>
         </div>`
      : '<p class="muted small">Sin sesión de administración iniciada. <code>#admin</code> con usuario y contraseña, o el PIN de emergencia.</p>';
  }
  const nom = $('#cm-nombre'), usr = $('#cm-usuario'), mail = $('#cm-email');
  if (yo) {
    if (nom) nom.value = yo.nombre || '';
    if (usr) usr.value = yo.usuario || '';
    if (mail) mail.value = yo.email || '';
  }
  /* Control de apariencia disponible también desde el panel */
  const tema = temaActual();
  $$('#aj-apariencia-admin [data-tema]').forEach(b => b.classList.toggle('on', b.dataset.tema === tema));
}

async function guardarCuentaMadre() {
  if (!yo) { toast('Iniciá sesión como administración general para editar la cuenta', 'error'); return; }
  const body = {
    nombre: $('#cm-nombre').value.trim(),
    usuario: $('#cm-usuario').value.trim().toLowerCase(),
    email: $('#cm-email').value.trim(),
  };
  try {
    const data = await api('/api/auth/perfil', { method: 'PUT', body });
    yo = data.user;
    renderAjustes();
    renderMine();
    actualizarAdminHead();
    toast('Cuenta madre actualizada ✓', 'ok');
  } catch (e) { toast(e.message, 'error'); }
}

async function guardarAjustes() {
  const body = { currency: $('#set-currency').value.trim() || '$' };
  const inGmaps = $('#set-gmaps');
  const claveAntes = (state.settings && state.settings.gmapsKey) || '';
  if (inGmaps) body.gmapsKey = inGmaps.value.trim();
  const pin = $('#set-pin').value.trim();
  if (pin) {
    if (pin.length < 4) { toast('El PIN debe tener al menos 4 caracteres', 'warn'); return; }
    body.pin = pin;
  }
  const selCancel = $('#set-cancelacion');
  if (selCancel) body.reglas = Object.assign({}, state.settings.reglas, { cancelacionHoras: Number(selCancel.value) });
  /* Contacto: redes + email de avisos */
  const contacto = {
    whatsapp: ($('#set-whatsapp') || {}).value,
    instagram: ($('#set-instagram') || {}).value,
    facebook: ($('#set-facebook') || {}).value,
    tiktok: ($('#set-tiktok') || {}).value,
    email: ($('#set-contact-email') || {}).value,
  };
  if (contacto.whatsapp !== undefined || contacto.instagram !== undefined || contacto.facebook !== undefined ||
      contacto.tiktok !== undefined || contacto.email !== undefined) {
    body.contacto = {};
    Object.keys(contacto).forEach(k => { if (contacto[k] !== undefined) body.contacto[k] = String(contacto[k]).trim(); });
  }
  try {
    const data = await api('/api/settings', { method: 'PUT', admin: true, body });
    state = data.state;
    pintarInstagram();
    if (pin) adminPin = pin;
    const claveDespues = state.settings.gmapsKey || '';
    if (claveDespues !== claveAntes) {
      /* La API de Google sólo se carga una vez por clave */
      const yaCargada = !!(window.google && window.google.maps);
      gmapaFallo = false;
      cargandoGoogle = null;
      huellaMapa = '';
      if (gmap && !claveDespues) limpiarMapa();
      renderAjustes();
      toast(yaCargada
        ? 'Clave guardada. Recargá la app (F5 🔄) para que se use la nueva.'
        : (claveDespues ? 'Clave de Google Maps guardada ✓ El mapa va a usar Google Maps.' : 'Clave quitada. El mapa vuelve a OpenStreetMap ✓'), 'ok');
      return;
    }
    renderAjustes();
    toast('Ajustes guardados ✓', 'ok');
  } catch (e) {
    toast(e.message, 'error');
  }
}

function exportar() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `reservas-salas-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Datos exportados ✓', 'ok');
}

async function importar(file) {
  const fr = new FileReader();
  fr.onload = async () => {
    try {
      const data = JSON.parse(fr.result);
      const res = await api('/api/state', { method: 'PUT', admin: true, body: data });
      state = res.state;
      showAdmin();
      toast('Datos importados ✓', 'ok');
    } catch (e) {
      toast(e.message || 'Archivo inválido', 'error');
    }
  };
  fr.readAsText(file);
}

/* ================= Modal y toast ================= */
function openModal(html) {
  $('#modal-box').innerHTML = html;
  $('#modal').classList.add('open');
}
function closeModal() {
  $('#modal').classList.remove('open');
}

let toastTimer;
function toast(msg, type = 'ok') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ================= Sincronización en tiempo real ================= */
let ticksPolling = 0;
function startPolling() {
  setInterval(async () => {
    if (!state) return;
    // no interrumpir al usuario
    if ($('#modal').classList.contains('open')) return;
    if (curStep === 4 && $('#bk-name') && $('#bk-name').value.trim()) return;
    try {
      const fresh = await api('/api/state');
      const cambiado = JSON.stringify(fresh) !== JSON.stringify(state);
      state = fresh;
      /* Los avisos se consultan cada ~1 minuto */
      if (yo && ++ticksPolling % 5 === 0) {
        const antes = sinLeer;
        const conocidos = new Set(notificaciones.map(n => n.id));
        cargarNotificaciones().then(() => {
          if (sinLeer !== antes && !$('#view-mine').hidden) renderMine();
          /* Si el panel de notificaciones o de ajustes está abierto, repintarlo en vivo */
          if ($('#notif-drop').classList.contains('open')) renderPanelNotif();
          if ($('#ajustes-drop').classList.contains('open')) renderPanelAjustes();
          /* Preferencia de Ajustes: avisar en pantalla cuando llega algo nuevo */
          const nuevas = notificaciones.filter(n => !conocidos.has(n.id));
          if (nuevas.length && localStorage.getItem('mm-avisos-toast') !== '0') {
            toast(`🔔 ${nuevas[0].titulo}`, 'ok');
          }
        });
      }
      if (cambiado) refreshVisible();
    } catch (e) { /* servidor offline: se reintentará en el próximo ciclo */ }
  }, 12000);
}

function refreshVisible() {
  // si el rango seleccionado ya no está libre (otro usuario lo tomó), limpiarlo
  if (sel.range && sel.roomId && sel.date &&
      !rangoDisponible(sel.date, sel.roomId, toMin(sel.range.start), toMin(sel.range.end))) {
    sel.range = null;
    toast('Un horario que tenías seleccionado acaba de ocuparse', 'warn');
  }
  if (!$('#view-public').hidden) {
    renderCalendar();
    renderSalasStrip();
    renderMineRapido();
    renderResumenInicio();
    if (curStep >= 2) renderRooms();
    if (curStep >= 3) renderSlots();
    if (curStep === 4 && $('#confirm-body') && $('#bk-name') && !$('#bk-name').value.trim()) renderConfirm();
  } else if (!$('#view-mine').hidden) {
    renderMine();
  } else if (!$('#view-lugar').hidden) {
    renderLugarTab(currentLugarTab);
  } else if (!$('#view-mapa').hidden) {
    actualizarMapaSiSeVe();
  } else if (!$('#view-panel').hidden) {
    if (panelDatos) renderPanelEstado();
  } else if (!$('#view-admin').hidden) {
    renderAdminTab(currentAdminTab);
  }
}

/* ================= Inicio ================= */
function wireAdmin() {
  /* El panel solo es visible para el administrador.
     Acceso: doble toque en el logo o URL con #admin (la primera vez pide el PIN). */
  let logoTaps = 0, logoTimer = null;
  $('.brand').addEventListener('click', () => {
    logoTaps++;
    clearTimeout(logoTimer);
    logoTimer = setTimeout(() => { logoTaps = 0; }, 700);
    if (logoTaps >= 2) { logoTaps = 0; enterAdmin(); }
  });
  $('#btn-exit-admin').onclick = salirAdmin;
  $$('.admin-tab[data-tab]').forEach(b => {
    b.onclick = () => {
      window.__usuarios = null;      /* las cuentas se vuelven a pedir al abrir la pestaña */
      window.__ayuda = null;         /* y también los pedidos de ayuda */
      if (b.dataset.tab === 'solicitudes') listaSolicitudes = null;
      renderAdminTab(b.dataset.tab);
    };
  });
  /* Solicitudes de salas: aprobar, rechazar o pedir correcciones */
  $$('[data-estado-sol]').forEach(b => {
    b.onclick = () => { filtroSolicitudes = b.dataset.estadoSol; renderSolicitudes(); };
  });
  $('#solicitudes-list').onclick = e => {
    const ok = e.target.closest('[data-sol-ok]');
    if (ok) return accionSolicitud(ok.dataset.solOk, 'aprobar');
    const corr = e.target.closest('[data-sol-corr]');
    if (corr) {
      const motivo = prompt('¿Qué tenés que corregir? Se le avisa al dueño de la sala:');
      if (motivo) accionSolicitud(corr.dataset.solCorr, 'corregir', motivo);
      return;
    }
    const no = e.target.closest('[data-sol-no]');
    if (no) {
      const sala = (listaSolicitudes || []).find(r => r.id === no.dataset.solNo);
      const motivo = prompt(`¿Por qué ${sala && sala.estado === 'pendiente' ? 'rechazás' : 'suspendés'} “${sala ? sala.name : 'la sala'}”?`, '');
      if (motivo === null) return;
      const accion = sala && sala.estado === 'pendiente' ? 'rechazar' : (sala && sala.estado === 'suspendida' ? 'rechazar' : 'desactivar');
      return accionSolicitud(no.dataset.solNo, accion, motivo);
    }
    const ed = e.target.closest('[data-sol-editar]');
    if (ed) return formularioSala(ed.dataset.solEditar);
  };
  /* Cuentas registradas */
  $('#usuarios-buscar').oninput = e => { filtroUsuarios = e.target.value; renderUsuarios(); };
  $('#usuarios-list').onclick = e => {
    const b = e.target.closest('[data-user-bloquear]');
    if (b) return accionUsuario(b.dataset.userBloquear, 'bloquear');
    const r = e.target.closest('[data-user-rol]');
    if (r) return accionUsuario(r.dataset.userRol, 'rol');
    const d = e.target.closest('[data-user-borrar]');
    if (d) return accionUsuario(d.dataset.userBorrar, 'borrar');
  };
  /* Pedidos de ayuda */
  $('#ayuda-list').onclick = e => {
    const des = e.target.closest('[data-ayuda-desbloquear]');
    if (des) return resolverAyuda(des.dataset.ayudaDesbloquear, true);
    const res = e.target.closest('[data-ayuda-resolver]');
    if (res) return resolverAyuda(res.dataset.ayudaResolver, false);
  };
  $('#res-prev').onclick = () => cambiarDiaAdmin(-1);
  $('#res-next').onclick = () => cambiarDiaAdmin(1);
  $('#res-today').onclick = () => { adminResDate = ''; adminResPidiendo = ''; renderReservasAdmin(); };
  $('#res-chips').onclick = e => {
    const c = e.target.closest('.chip[data-i]');
    if (c) { adminResFiltro = parseInt(c.dataset.i, 10); renderReservasAdmin(); }
  };
  $('#res-list').onclick = e => {
    const ed = e.target.closest('[data-edit]');
    if (ed) return editarReserva(ed.dataset.edit, 'reservas');
    const cx = e.target.closest('[data-cancel]');
    if (cx) { adminResPidiendo = cx.dataset.cancel; renderReservasAdmin(); return; }
    const no = e.target.closest('[data-ask-no]');
    if (no) { adminResPidiendo = ''; renderReservasAdmin(); return; }
    const si = e.target.closest('[data-ask-yes]');
    if (si) return cancelarReservaAdmin(si.dataset.askYes);
  };
  $('#hist-filter').onchange = renderHistorial;
  $('#hist-search').oninput = renderHistorial;
  $('#hist-list').onclick = e => {
    const ed = e.target.closest('[data-edit]');
    if (ed) return editarReserva(ed.dataset.edit, 'historial');
    const cx = e.target.closest('[data-cancel]');
    if (cx) return cancelarReserva(cx.dataset.cancel, 'historial');
  };
  $('#btn-new-room').onclick = () => formularioSala(null);
  $('#salas-grid-admin').onclick = e => {
    const ed = e.target.closest('[data-edit-room]');
    if (ed) return formularioSala(ed.dataset.editRoom);
    const tg = e.target.closest('[data-toggle-room]');
    if (tg) {
      const r = state.rooms.find(x => x.id === tg.dataset.toggleRoom);
      if (!r) return;
      api(`/api/rooms/${r.id}`, {
        method: 'PUT', admin: true,
        body: { name: r.name, price: r.price, capacity: r.capacity, features: r.features, active: r.activo === false, estado: r.estado, turnoMin: r.turnoMin, foto: r.foto },
      }).then(data => { state = data.state; renderAdminTab('salas'); })
        .catch(err => toast(err.message, 'error'));
      return;
    }
    const del = e.target.closest('[data-del-room]');
    if (del) return eliminarSala(del.dataset.delRoom);
  };
  $('#btn-save-hours').onclick = guardarHorarios;
  $('#btn-add-block').onclick = agregarBloque;
  $('#blocks-list').onclick = async e => {
    const del = e.target.closest('[data-del-block]');
    if (!del) return;
    try {
      const data = await api(`/api/blocks/${del.dataset.delBlock}`, { method: 'DELETE', admin: true });
      state = data.state;
      renderBloqueosAdmin();
      toast('Bloqueo eliminado', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  $('#stats-month').onchange = renderStats;
  $('#btn-new-promo').onclick = () => formularioPromocion(null);
  $('#promociones-admin').onclick = async e => {
    const ed = e.target.closest('[data-edit-promo]');
    if (ed) return formularioPromocion(ed.dataset.editPromo);
    const del = e.target.closest('[data-del-promo]');
    if (del) {
      if (!confirm('¿Eliminar esta promoción?')) return;
      try {
        const data = await api(`/api/promociones/${del.dataset.delPromo}`, { method: 'DELETE', admin: true });
        state = data.state;
        renderAdminTab('promociones');
        renderResumenInicio();
      } catch (err) { toast(err.message, 'error'); }
      return;
    }
    const tg = e.target.closest('[data-toggle-promo]');
    if (!tg) return;
    const p = (state.promociones || []).find(x => x.id === tg.dataset.togglePromo);
    if (!p) return;
    try {
      const data = await api(`/api/promociones/${p.id}`, { method: 'PUT', admin: true, body: { activa: p.activa === false } });
      state = data.state;
      renderAdminTab('promociones');
      renderResumenInicio();
    } catch (err) { toast(err.message, 'error'); }
  };
  $('#btn-save-settings').onclick = guardarAjustes;
  $('#btn-save-cuenta').onclick = guardarCuentaMadre;
  $('#aj-apariencia-admin').onclick = e => {
    const t = e.target.closest('button[data-tema]');
    if (t) elegirApariencia(t.dataset.tema);
  };
  $('#btn-save-pass').onclick = async () => {
    const nueva = $('#set-pass-nueva').value;
    const actual = $('#set-pass-actual').value;
    if (nueva.length < 6) { toast('La nueva contraseña debe tener al menos 6 caracteres', 'warn'); return; }
    try {
      const data = await api('/api/auth/perfil', { method: 'PUT', body: { password: nueva, actual } });
      yo = data.user;
      $('#set-pass-nueva').value = '';
      $('#set-pass-actual').value = '';
      toast('Contraseña de administrador cambiada ✓', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  };
  $('#btn-forget-admin').onclick = () => {
    olvidarDispositivoAdmin();
    renderAjustes();
    toast('Este dispositivo ya no muestra el panel', 'ok');
  };
  $('#btn-export').onclick = exportar;
  $('#btn-import').onclick = () => $('#import-file').click();
  $('#import-file').onchange = e => {
    if (e.target.files[0]) importar(e.target.files[0]);
    e.target.value = '';
  };
  /* Instrumentos y fotos del lugar */
  $('#btn-new-instrument').onclick = () => formularioInstrumento(null);
  $('#instruments-admin').onclick = e => {
    const ed = e.target.closest('[data-edit-inst]');
    if (ed) return formularioInstrumento(ed.dataset.editInst);
    const tg = e.target.closest('[data-toggle-inst]');
    if (tg) {
      const i = (state.instruments || []).find(x => x.id === tg.dataset.toggleInst);
      if (!i) return;
      api(`/api/instruments/${i.id}`, {
        method: 'PUT', admin: true,
        body: {
          nombre: i.nombre, descripcion: i.descripcion, foto: i.foto,
          activo: i.activo === false,
          alquiler: i.alquiler === true, precioAlquiler: i.precioAlquiler || 0,
        },
      }).then(data => { state = data.state; renderLugarAdmin(); })
        .catch(err => toast(err.message, 'error'));
      return;
    }
    const del = e.target.closest('[data-del-inst]');
    if (del) return eliminarInstrumento(del.dataset.delInst);
  };
  $('#btn-new-place-photo').onclick = () => formularioFotoLugar(null);
  $('#place-photos-admin').onclick = e => {
    const ed = e.target.closest('[data-edit-photo]');
    if (ed) return formularioFotoLugar(ed.dataset.editPhoto);
    const del = e.target.closest('[data-del-photo]');
    if (del) return eliminarFotoLugar(del.dataset.delPhoto);
  };
  /* Bandas registradas */
  $('#btn-new-band').onclick = () => formularioBanda(null);
  $('#bands-admin').onclick = e => {
    const ed = e.target.closest('[data-edit-band]');
    if (ed) return formularioBanda(ed.dataset.editBand);
    const del = e.target.closest('[data-del-band]');
    if (del) return eliminarBanda(del.dataset.delBand);
  };
  $('#btn-demo').onclick = async () => {
    if (!confirm('¿Cargar datos de demostración? Se reemplazarán los datos actuales.')) return;
    try {
      const data = await api('/api/demo', { method: 'POST', admin: true });
      state = data.state;
      showAdmin();
      toast('Datos de demo cargados', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  $('#btn-reset').onclick = async () => {
    if (!confirm('¿Borrar TODOS los datos (salas, reservas y bloqueos)?')) return;
    try {
      const data = await api('/api/reset', { method: 'POST', admin: true });
      state = data.state;
      showAdmin();
      toast('Datos borrados', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
}

/* ================= Pantalla de arranque =================
   Se ve apenas abre la app: igualador verde + marca. Se oculta sola
   cuando la app terminó de cargar (y nunca antes de SPLASH_MS). */
const SPLASH_MS = 1900;
const splashInicio = Date.now();
function cerrarSplash() {
  const s = document.getElementById('splash');
  if (!s || s.dataset.listo) return;
  s.dataset.listo = '1';
  const espera = Math.max(0, SPLASH_MS - (Date.now() - splashInicio));
  setTimeout(() => {
    s.classList.add('fuera');
    setTimeout(() => { if (s.parentNode) s.remove(); }, 600);
  }, espera);
}
setTimeout(cerrarSplash, 5000);   /* red de seguridad si algo falla */

async function init() {
  try {
    state = await api('/api/state');
  } catch (e) {
    $('#loading').hidden = true;
    $('#conn-error').hidden = false;
    cerrarSplash();
    return;
  }
  $('#loading').hidden = true;
  wirePublic();
  wireAdmin();
  wireAuth();
  wirePanel();
  wireMapa();
  setNav('inicio');

  /* Sesión guardada en este dispositivo */
  if (token) {
    try {
      const data = await api('/api/auth/me');
      yo = data.user;
      miSala = data.room || null;
      adminMode = esSuper();
      if (!yo) guardarToken('');
    } catch (e) { guardarToken(''); }
  }
  await cargarNotificaciones();
  if (yo) {
    mostrarApp();
    renderCalendar();
    renderRooms();
    goStep(1);
    renderMapa();
  } else {
    /* Sin sesión: solo se puede registrarse o iniciar sesión (no hay modo espectador) */
    pantallaAuth('inicio');
  }          /* el mapa del Inicio */

  /* Acceso directo: .../#admin abre el pedido de acceso */
  if (location.hash === '#admin') {
    history.replaceState(null, '', location.pathname + location.search);
    setTimeout(() => enterAdmin(), 250);
  }
  startPolling();
  cerrarSplash();

  /* Service worker (solo en contextos seguros: HTTPS o localhost) */
  if ('serviceWorker' in navigator &&
      (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  /* Instalación como app (PWA) */
  let deferredPrompt = null;

  /* ¿Ya está instalada como app (pantalla propia, sin la barra del navegador)? */
  const esAppInstalada = () =>
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    (navigator && navigator.standalone === true);

  /* iPhone/iPad: no hay diálogo de instalar; se agrega con "Añadir a pantalla de inicio" */
  const esIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

  const mostrarBtnInstalar = () => { if (!esAppInstalada()) $('#btn-install').hidden = false; };

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    mostrarBtnInstalar();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    $('#btn-install').hidden = true;
    toast('App instalada ✓', 'ok');
  });
  $('#btn-install').onclick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      try {
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') toast('Instalando app…', 'ok');
      } catch (e) { /* el usuario cerró el diálogo */ }
      deferredPrompt = null;
      $('#btn-install').hidden = true;
      return;
    }
    if (esIOS()) {
      openModal(
        '<h3>📲 Instalar la app</h3>' +
        '<p>En tu iPhone o iPad:</p>' +
        '<ol style="padding-left:20px;margin:8px 0;line-height:1.7">' +
        '<li>Tocá el botón <b>Compartir</b> ⬆️ en la barra del navegador.</li>' +
        '<li>Elegí <b>Añadir a pantalla de inicio</b>.</li>' +
        '<li>Tocá <b>Añadir</b> (arriba a la derecha).</li>' +
        '</ol>' +
        '<p>¡Listo! La app queda con su ícono en tu pantalla.</p>' +
        '<div class="modal-acciones"><button class="btn btn-ghost" onclick="closeModal()">Entendido</button></div>'
      );
    }
  };
  /* En iPhone se muestra el botón aunque no llegue el diálogo de instalación */
  if (esIOS() && !esAppInstalada()) mostrarBtnInstalar();

  /* Colchón de historial: el botón atrás del teléfono cierra capas en vez de salir */
  if (window.__mantenerColchon) window.__mantenerColchon();
}

/* Al volver de Mercado Pago (?pago=ok | pendiente | error) */
(function () {
  const pg = new URLSearchParams(location.search).get('pago');
  if (!pg) return;
  history.replaceState(null, '', location.pathname + location.hash);
  setTimeout(() => {
    if (pg === 'ok') toast('¡Seña recibida! Tu reserva se confirma en unos segundos. Mirala en Mis reservas ✓', 'ok');
    else if (pg === 'pendiente') toast('Tu pago está pendiente. Te avisamos cuando se acredite.', 'warn');
    else toast('El pago no se completó. Podés intentarlo de nuevo antes de que venza el horario.', 'warn');
  }, 1500);
})();

/* ---------- Botón "atrás" del teléfono ---------- */
/* La app es de una sola pantalla: el botón atrás cierra lo que está encima
   (modal, hoja del mapa, pasos de la reserva) o vuelve a Inicio, antes de salir. */
(function () {
  function mantenerColchon() {
    try { history.pushState({ mm: 1 }, ''); } catch (e) {}
  }
  function cerrarCapaAtras() {
    const modal = $('#modal');
    if (modal && modal.classList.contains('open')) { closeModal(); return true; }
    const hoja = $('#mapa-hoja'), cuerpo = $('#mapa-hoja-cuerpo');
    if (hoja && hoja.classList.contains('abierta')) {
      hoja.classList.remove('abierta');
      if (cuerpo) { cuerpo.style.transition = ''; cuerpo.style.maxHeight = '0px'; }
      const b = $('#mapa-hoja-btn'); if (b) b.setAttribute('aria-expanded', 'false');
      return true;
    }
    const enReserva = $('#view-public') && !$('#view-public').hidden;
    if (enReserva && curStep > 1) { goStep(curStep - 1); return true; }
    const enAuth = $('#view-auth') && !$('#view-auth').hidden;
    if (!enAuth && navActual && navActual !== 'inicio') { irInicio(); return true; }
    return false;
  }
  window.addEventListener('popstate', () => { if (cerrarCapaAtras()) mantenerColchon(); });
  window.__mantenerColchon = mantenerColchon;
})();
document.addEventListener('DOMContentLoaded', init);