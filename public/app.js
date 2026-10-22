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

/* Lee un archivo (foto/video) como data URL */
function leerDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('No se pudo leer el archivo'));
    r.onload = () => resolve(r.result);
    r.readAsDataURL(file);
  });
}

/* Duración de un video en segundos (0 si no se puede determinar) */
function duracionVideo(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    let listo = false;
    const fin = d => { if (listo) return; listo = true; try { URL.revokeObjectURL(url); } catch (e) {} resolve(d); };
    v.onloadedmetadata = () => fin(v.duration || 0);
    v.onerror = () => fin(0);
    setTimeout(() => fin(0), 4000);
    v.src = url;
  });
}

/* ================= Capa de API ================= */
let state = null;              // estado compartido (viene del servidor)
let adminPin = '';             // PIN de sesión (no se guarda ni se descarga del servidor)
let adminMode = false;
let currentAdminTab = 'reservas';
let currentLugarTab = 'instrumentos'; // (obsoleto: se mantiene por compatibilidad)
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

/* Días para adelante que se puede reservar: los músicos y las bandas, solo una semana;
   las cuentas de control (dueño de sala y administración) mantienen los 60 días */
const DIAS_RESERVA_MUSICO = 7;
const DIAS_RESERVA_CONTROL = 60;
const maxFechaReserva = () => addDaysStr(todayStr(), esCuentaControl() ? DIAS_RESERVA_CONTROL : DIAS_RESERVA_MUSICO);

function guardarToken(t) {
  token = t || '';
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) { /* modo privado */ }
}

/* Salas que se publican: aprobadas y activas.
   El dueño de una sala (ROOM_ADMIN) ve únicamente su propia sala, en la lista,
   el mapa, el calendario y las favoritas. */
const salasPublicas = () => (state.rooms || []).filter(r => {
  if (r.activo === false) return false;
  if (esDueño()) return r.ownerId === yo.id;
  return r.estado === 'aprobada';
});
const esFavorita = id => !!(yo && (yo.favoritos || []).includes(id));

async function api(path, { method = 'GET', body, admin = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (adminPin) headers['x-admin-pin'] = adminPin;
  if (token) headers['Authorization'] = 'Bearer ' + token;
  iniciarCarga();
  try {
    const res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* sin cuerpo */ }
    if (!res.ok) {
      const err = new Error(data.error || `Error de conexión (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  } finally {
    finalizarCarga();
  }
}

/* ================= Indicador de carga global ================= */
/* Barra fina en la parte superior que se muestra durante cualquier petición de red.
   Evita que el usuario toque dos veces mientras se espera la respuesta. */
let _cargaActiva = 0;
function iniciarCarga() {
  _cargaActiva++;
  const bar = document.getElementById('carga-global');
  if (bar) bar.classList.add('activa');
}
function finalizarCarga() {
  _cargaActiva = Math.max(0, _cargaActiva - 1);
  if (_cargaActiva === 0) {
    const bar = document.getElementById('carga-global');
    if (bar) bar.classList.remove('activa');
  }
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
  /* "Mis reservas" se ve en el Inicio (paso 1), sin tocar nada */
  $('#home-mine').hidden = false;
  renderMineRapido();
  if (n === 1) renderResumenInicio();
  renderSalasStrip();   /* logo de la sala actual en la esquina */
}

/* ---------- Acceso rápido a Mis reservas desde el inicio ---------- */
/* Reservas de esta cuenta: las de este dispositivo + las vinculadas al usuario */
const misReservas = () => {
  let lista = state.reservations.filter(r => mineIds.includes(r.id) || (yo && r.userId === yo.id));
  /* El dueño de sala ve también las reservas de sus clientes en el inicio */
  if (yo && yo.rol === 'ROOM_ADMIN') {
    const salasPropias = ((state && state.rooms) || []).filter(r => r.ownerId === yo.id).map(r => r.id);
    const delasala = state.reservations.filter(r => salasPropias.includes(r.roomId));
    lista = lista.concat(delasala.filter(r => !lista.some(x => x.id === r.id)));
  }
  return lista;
};

/* Verifica si el pago de una reserva se acreditó. Se dispara al volver a la app
   después de pagar en Mercado Pago (que se abrió en otra pestaña). */
let verificacionPagoActiva = null;
function iniciarVerificacionPago(reservaId, roomId) {
  if (verificacionPagoActiva) clearInterval(verificacionPagoActiva);
  let intentos = 0;
  const maxIntentos = 40; /* ~2 min a 3 s */
  const box = $('#confirm-body');
  const mostrarVerificando = () => {
    if (!box) return;
    if (!box.querySelector('.pago-verificando')) {
      box.insertAdjacentHTML('beforeend', '<div class="pago-verificando muted small" style="margin-top:10px"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> Verificando tu pago… no cierres esta pestaña.</div>');
    }
  };
  mostrarVerificando();
  verificacionPagoActiva = setInterval(async () => {
    intentos++;
    try {
      const data = await api('/api/state');
      state = data.state;
      const r = (state.reservations || []).find(x => x.id === reservaId);
      if (r && (r.estado === 'confirmada' || r.estado === 'cancelada')) {
        clearInterval(verificacionPagoActiva);
        verificacionPagoActiva = null;
        if (r.estado === 'confirmada') {
          toast('¡Seña recibida! Tu reserva está confirmada.', 'ok');
          if (yo) cargarNotificaciones();
          renderMineRapido();
          $('#confirm-body').innerHTML = `
            <div class="success">
              <div class="ok-mark"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></div>
              <h3>¡Reserva confirmada!</h3>
              <p>La seña se acreditó correctamente. Mirala en Mis reservas.</p>
              <button class="btn" id="bk-mine"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> Ver mis reservas</button>
            </div>`;
          const bm = $('#bk-mine'); if (bm) bm.onclick = () => { irAMisReservasInicio(); };
        } else {
          toast('El pago no se completó a tiempo. El horario se liberó.', 'warn');
          $('#confirm-body').innerHTML = '<p class="muted">El horario se liberó. Podés intentar reservar de nuevo.</p>';
        }
        return;
      }
      if (intentos >= maxIntentos) {
        clearInterval(verificacionPagoActiva);
        verificacionPagoActiva = null;
        const pv = document.querySelector('.pago-verificando'); if (pv) pv.remove();
        toast('Todavía no se acreditó el pago. Lo seguimos verificando en segundo plano.', 'warn');
      }
    } catch (e) { /* ignorar errores transitorios */ }
  }, 3000);
  /* También verificar al volver a la pestaña */
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && verificacionPagoActiva) {
      try {
        const data = await api('/api/state');
        state = data.state;
        const r = (state.reservations || []).find(x => x.id === reservaId);
        if (r && (r.estado === 'confirmada' || r.estado === 'cancelada')) {
          clearInterval(verificacionPagoActiva);
          verificacionPagoActiva = null;
          if (r.estado === 'confirmada') {
            toast('¡Seña recibida! Tu reserva está confirmada.', 'ok');
            if (yo) cargarNotificaciones();
            renderMineRapido();
          }
        }
      } catch (e) {}
    }
  });
}

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
      /* Primero las próximas (no pasadas), ordenadas por fecha+hora (primeros turnos primero) */
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
    const sala = room ? room.name : 'Sala eliminada';
    const pasada = esPasada(r);
    const cancelada = r.estado === 'cancelada';
    const esMia = mineIds.includes(r.id) || (yo && r.userId === yo.id);
    const badgeCls = cancelada ? 'badge-past' : pasada ? 'badge-past' : 'badge-next';
    const badgeTxt = cancelada ? 'Cancelada' : pasada ? 'Pasada' : r.estado === 'pendiente_pago' ? 'Falta pagar' : 'Próxima';
    return `
      <div class="mine-card ${pasada ? 'res-past' : ''} ${cancelada ? 'cancelada' : ''}">
        <div class="mine-card-head">
          <strong>${fmtDate(r.date)} · ${r.start}–${r.end}</strong>
          <span class="badge ${badgeCls}">${badgeTxt}</span>
        </div>
        <div class="mine-card-body">
          <span>${esc(sala)}</span>
          <span class="muted small">${esc(r.name)} · ${fmtMoney(precioReserva(r))}</span>
        </div>
        ${esMia && !pasada && !cancelada ? `
        <div class="mine-card-actions">
          ${r.estado === 'pendiente_pago' ? `<button class="btn btn-sm btn-primary" data-mine-pagar="${r.id}">Pagar seña</button>` : ''}
          <button class="btn btn-sm btn-danger" data-mine-cancel="${r.id}">Cancelar</button>
        </div>` : ''}
        ${esMia && (cancelada || pasada) && r.pagoEstado !== 'aprobado' ? `<div class="mine-card-actions"><button class="btn btn-sm" data-mine-eliminar="${r.id}">Eliminar</button></div>` : ''}
      </div>`;
  }).join('');
}

/* Pagar la seña de una reserva pendiente desde "Mis reservas" (si cerró la pantalla de pago) */
async function pagarSenaDesde(r) {
  let data;
  try {
    data = await api('/api/pagos/reintentar', { method: 'POST', body: { reservaId: r.id } });
  } catch (e) {
    toast(e.message || 'No se pudo iniciar el pago', 'error');
    return;
  }
  if (data.url && urlSegura(data.url)) {
    toast('Te llevamos a Mercado Pago para pagar la seña…', 'ok');
    setTimeout(() => {
      try { window.open(urlSegura(data.url), '_blank', 'noopener'); } catch (e) { location.href = urlSegura(data.url); }
    }, 1300);
    return;
  }
  const room = state.rooms.find(x => x.id === r.roomId);
  const sena = data.sena != null ? data.sena : r.sena;
  const total = data.total != null ? data.total : r.total;
  const saldo = data.saldo != null ? data.saldo : r.saldo;
  openModal(`
    <div class="success">
      <h3>Falta pagar la seña</h3>
      <p><strong>${esc(r.name || '')}</strong></p>
      <p>${fmtDate(r.date)} · ${esc(room ? room.name : '')} · ${r.start} – ${r.end}</p>
      <p class="accent"><strong>Seña a pagar ahora: ${fmtMoney(sena)}</strong></p>
      <p class="muted small">Total ${fmtMoney(total)} · el saldo de ${fmtMoney(saldo)} se paga en la sala.</p>
      ${data.simulado
        ? '<button class="btn btn-primary" id="pg-pagar">Pagar la seña (prueba)</button>'
        : '<p class="muted small">El cobro de la seña no está activo.</p>'}
      <button class="btn" id="pg-cerrar">Cerrar</button>
    </div>`);
  $('#pg-cerrar').onclick = closeModal;
  const btn = $('#pg-pagar');
  if (btn) btn.onclick = async () => {
    btn.disabled = true;
    try {
      const res = await api('/api/pagos/simular', { method: 'POST', body: { reservaId: r.id, resultado: 'aprobado' } });
      if (res && res.state) state = res.state;
      if (yo) cargarNotificaciones();
      closeModal();
      renderMineRapido();
      renderMine();
      toast('Seña pagada (prueba) La reserva quedó confirmada', 'ok');
    } catch (err) {
      toast(err.message || 'No se pudo simular el pago', 'error');
      btn.disabled = false;
    }
  };
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
    /* Registrar banda es cosa de músicos: el administrador no ve esta tarjeta */
    if (esCuentaControl()) { host.hidden = true; host.innerHTML = ''; return; }
    host.hidden = false;
    host.innerHTML = `
    <div class="perfil-mini">
      <div class="perfil-avatar-circular perfil-sin-foto"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h20v8a10 10 0 0 1-20 0z"/><circle cx="8" cy="10" r="1.4"/><circle cx="16" cy="10" r="1.4"/></svg></div>
      <div class="perfil-mini-info">
        <h3><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h20v8a10 10 0 0 1-20 0z"/><circle cx="8" cy="10" r="1.4"/><circle cx="16" cy="10" r="1.4"/></svg> Registra tu banda</h3>
          <p class="muted small">Registra tu banda para guardar tu logo, sus integrantes y el instrumento que toca cada uno. Todo es opcional.</p>
          <div class="row wrap">
            <button class="btn btn-primary btn-sm" id="bp-new"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h20v8a10 10 0 0 1-20 0z"/><circle cx="8" cy="10" r="1.4"/><circle cx="16" cy="10" r="1.4"/></svg> Registrar mi banda</button>
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
        ? `<img class="perfil-avatar-circular" src="${esc(banda.foto)}" alt="${esc(banda.nombre)}" data-foto="${esc(banda.foto)}" data-foto-alt="${esc(banda.nombre)}" title="Tocá para ver en grande">`
        : '<div class="perfil-avatar-circular perfil-sin-foto"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h20v8a10 10 0 0 1-20 0z"/><circle cx="8" cy="10" r="1.4"/><circle cx="16" cy="10" r="1.4"/></svg></div>'}
      <div class="perfil-mini-info">
        <h3>${esc(banda.nombre)}</h3>
        <div class="perfil-tags">
          ${banda.genero ? `<span class="tag"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg> ${esc(banda.genero)}</span>` : ''}
          <span class="tag"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> ${ints.length} ${ints.length === 1 ? 'integrante' : 'integrantes'}</span>
          ${banda.telefono ? `<span class="tag"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg> ${esc(banda.telefono)}</span>` : ''}
        </div>
        <div class="row wrap perfil-acciones">
          <button class="btn btn-sm" data-band="${banda.id}">Ver perfil completo</button>
          ${banda.fotoGrupal ? `<button class="btn btn-sm" data-foto="${esc(banda.fotoGrupal)}" data-foto-alt="Foto grupal"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> Ver foto grupal</button>` : ''}
          <button class="btn btn-sm" id="bp-edit"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg> Editar perfil</button>
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
  const etq = r.estado === 'aprobada' ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg> Aprobada' : r.estado === 'rechazada' ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Rechazada' : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h12"/><path d="M6 22h12"/><path d="M6 2v4a6 6 0 0 0 6 6 6 6 0 0 0 6-6V2"/><path d="M6 22v-4a6 6 0 0 1 6-6 6 6 0 0 1 6 6v4"/></svg> En revisión';
  const zona = [r.localidad, [r.direccion, r.numero].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
  host.hidden = false;
  host.innerHTML = `
    <div class="perfil-mini">
      ${r.foto ? `<img class="perfil-fondo" src="${esc(r.foto)}" alt="">` : ''}
      ${r.foto
        ? `<img class="perfil-avatar-circular" src="${esc(r.foto)}" alt="${esc(r.name)}" data-foto="${esc(r.foto)}" data-foto-alt="${esc(r.name)}" title="Tocá para ver en grande">`
        : '<div class="perfil-avatar-circular perfil-sin-foto"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg></div>'}
      <div class="perfil-mini-info">
        <h3>${esc(r.name)}</h3>
        <div class="perfil-tags">
          <span class="tag">${etq}</span>
          ${zona ? `<span class="tag"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> ${esc(zona)}</span>` : ''}
          <span class="tag"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> ${fmtMoney(r.price)}/h · <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> ${r.capacity}</span>
        </div>
        <div class="row wrap perfil-acciones">
          <button class="btn btn-sm" id="sp-panel"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg> Mi panel de sala</button>
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
      <h2><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> Integrantes y instrumentos</h2>
      <button class="btn btn-sm" data-band="${banda.id}">Ver perfil</button>
    </div>
    <ul class="perfil-lista">
      ${ints.map(m => `
        <li>
          <strong>${esc(m.nombre || 'Sin nombre')}</strong>
          <span>${m.instrumento ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg> ' + esc(m.instrumento) : '<span class="muted">sin instrumento</span>'}</span>
        </li>`).join('')}
    </ul>`;
}

function renderCalendar() {
  const [y, m] = calCursor.split('-').map(Number);
  $('#cal-title').textContent = new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  /* Cada sala administra sus reservas: el dueño solo cuenta las de sus propias salas */
  const salasPropias = esDueño() ? ((state && state.rooms) || []).filter(r => r.ownerId === (yo && yo.id)).map(r => r.id) : null;
  /* Aviso de hasta cuándo se puede reservar, según la cuenta */
  const hint = $('#cal-hint');
  if (hint) hint.textContent = (esCuentaControl()
    ? 'Podés reservar hasta con 60 días de anticipación.'
    : 'Los músicos y las bandas pueden reservar hasta con 7 días de anticipación.')
    + (salasPropias ? ' Los días con un número son las reservas de tu sala.' : ' Los días con reservas muestran un número.');
  const grid = $('#cal-grid');
  grid.innerHTML = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá'].map(d => `<div class="cal-h">${d}</div>`).join('');
  const first = new Date(y, m - 1, 1).getDay();
  const days = new Date(y, m, 0).getDate();
  const today = todayStr();
  const max = maxFechaReserva();
  const counts = {};
  state.reservations.forEach(r => {
    if (r.estado === 'cancelada') return;                       /* una reserva cancelada no cuenta */
    if (salasPropias && !salasPropias.includes(r.roomId)) return;
    counts[r.date] = (counts[r.date] || 0) + 1;
  });
  for (let i = 0; i < first; i++) grid.insertAdjacentHTML('beforeend', '<div></div>');
  for (let d = 1; d <= days; d++) {
    const ds = `${calCursor}-${pad2(d)}`;
    const dis = ds < today || ds > max;
    const cls = ['cal-day', ds === sel.date ? 'sel' : '', ds === today ? 'today' : '', dis ? 'dis' : ''].join(' ');
    const badge = counts[ds] ? `<span class="dot">${counts[ds]}</span>` : '';
    grid.insertAdjacentHTML('beforeend',
      `<button class="${cls}" data-date="${ds}" ${dis ? 'disabled' : ''}>${d}${badge}</button>`);
  }
  renderCalReservasDia();
}

/* Reservas del día seleccionado en el calendario, ordenadas por hora */
function renderCalReservasDia() {
  const caja = $('#cal-reservas-dia');
  if (!caja) return;
  const fecha = sel && sel.date;
  if (!fecha) { caja.innerHTML = ''; return; }
  const salasPropias = esDueño() ? ((state && state.rooms) || []).filter(r => r.ownerId === (yo && yo.id)).map(r => r.id) : null;
  let lista = (state && state.reservations || []).filter(r => r.date === fecha && r.estado !== 'cancelada');
  if (salasPropias) lista = lista.filter(r => salasPropias.includes(r.roomId));
  lista = lista.slice().sort((a, b) => String(a.start).localeCompare(String(b.start)));
  if (!lista.length) {
    caja.innerHTML = `<p class="muted small cal-res-dia-vacio">Sin reservas para el ${esc(fmtDate(fecha, { weekday: 'long', day: 'numeric', month: 'long' }))}.</p>`;
    return;
  }
  const nombreSala = id => { const s = (state && state.rooms || []).find(x => x.id === id); return s ? s.name : 'Sala'; };
  caja.innerHTML = `
    <div class="cal-res-dia-head">
      <strong>Reservas del ${esc(fmtDate(fecha, { weekday: 'long', day: 'numeric', month: 'long' }))}</strong>
      <span class="muted small">${lista.length} reserva(s), ordenadas por hora</span>
    </div>
    <ul class="cal-res-dia-lista">
      ${lista.map(r => `
        <li class="cal-res-dia-item">
          <span class="cal-res-dia-hora">${esc(r.start)} – ${esc(r.end)}</span>
          <span class="cal-res-dia-sala">${esc(nombreSala(r.roomId))}</span>
          <span class="cal-res-dia-nom">${esc(r.name || '')}</span>
          ${r.estado === 'pendiente_pago' ? '<span class="badge badge-next">Pendiente de pago</span>' : ''}
        </li>`).join('')}
    </ul>`;
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
      grid.innerHTML = `<p class="muted">No marcaste ninguna sala como favorita todavía. Tocá el <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path fill="currentColor" d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg> en una sala para guardarla acá.</p>
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
        <button class="fav-btn ${esFavorita(r.id) ? 'on' : ''}" data-fav="${r.id}" title="Guardar como favorita">${esFavorita(r.id) ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path fill="currentColor" d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>'}</button>
      </div>
      <div class="room-info">
        <h3>${esc(r.name)}</h3>
        ${puntajeSalaHTML(r, true)}
        ${r.localidad || r.direccion ? `<div class="room-ubic"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> ${esc([r.localidad, [r.direccion, r.numero].filter(Boolean).join(' ')].filter(Boolean).join(' · '))}</div>` : ''}
        <div class="price">${fmtMoney(r.price)}<span> /hora</span></div>
      </div>
    </article>`;
  }).join('');
}

/* ---------- Ficha completa de una sala ---------- */
function pintarBotonFav() {
  const b = $('#btn-filtro-fav');
  if (b) b.innerHTML = filtroSalas === 'favoritas' ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path fill="currentColor" d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg> Favoritas' : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg> Favoritas';
}

/* Íconos SVG compartidos (ficha de sala y tarjeta del mapa) */
const ICO_SVG = {
  precio: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  telefono: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
  pin: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  camara: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  reloj: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  consola: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>',
  musica: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
  bateria: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="7" rx="8" ry="3"/><path d="M4 7v8c0 1.7 3.6 3 8 3s8-1.3 8-3V7"/><path d="M4 11c1.5 1.2 4.5 2 8 2s6.5-.8 8-2"/></svg>',
  amplis: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>',
  micro: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',
  estrella: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  estrellaOn: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  info: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  flecha: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>',
  corazon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
  corazonOn: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path fill="currentColor" d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
  basura: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
  tarjeta: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',
  edificio: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v17"/><path d="M15 9h3a1 1 0 0 1 1 1v11"/><line x1="8" y1="7" x2="12" y2="7"/><line x1="8" y1="11" x2="12" y2="11"/><line x1="8" y1="15" x2="12" y2="15"/></svg>',
  relojArena: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h12"/><path d="M6 22h12"/><path d="M6 2v4a6 6 0 0 0 6 6 6 6 0 0 0 6-6V2"/><path d="M6 22v-4a6 6 0 0 1 6-6 6 6 0 0 1 6 6v4"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  ajustes: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  guardar: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
  refrescar: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
  lista: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
  transferido: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>',
  reembolso: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>'
};

/* ---------- Reseñas de las salas ---------- */
/* Solo pueden reseñar las cuentas que reservaron en la sala (el servidor lo controla). */
const resenasDeSala = id => (state.resenas || []).filter(x => x.roomId === id).sort((a, b) => (b.fecha || 0) - (a.fecha || 0));
const puntajeDe = id => {
  const lista = resenasDeSala(id);
  if (!lista.length) return { promedio: 0, total: 0 };
  const suma = lista.reduce((a, b) => a + (Number(b.estrellas) || 0), 0);
  return { promedio: Math.round((suma / lista.length) * 10) / 10, total: lista.length };
};
const misResenasDeSala = id => (yo ? resenasDeSala(id).filter(x => x.usuario === yo.usuario) : []);
const puedeResenar = id => !!yo && (state.reservations || [])
  .some(r => r.roomId === id && r.userId === yo.id && r.estado !== 'cancelada');

/* Cinco estrellas, pintadas hasta la nota que se pasa */
function estrellasHTML(nota, tam = 16) {
  const n = Math.max(0, Math.min(5, Math.round(Number(nota) || 0)));
  let out = `<span class="estrellas" aria-label="${n} de 5 estrellas">`;
  for (let i = 1; i <= 5; i++) {
    out += `<span class="est${i <= n ? ' on' : ''}">${i <= n ? ICO_SVG.estrellaOn : ICO_SVG.estrella}</span>`;
  }
  return out + '</span>';
}

/* Puntaje de una sala: estrellas + promedio + cantidad (vacío si no tiene reseñas) */
function puntajeSalaHTML(r, compacto = false) {
  const p = (r && r.puntaje) || { promedio: 0, total: 0 };
  if (!p.total) return '';
  return `<span class="sala-puntaje${compacto ? ' mini' : ''}">${estrellasHTML(p.promedio)}
    <b>${p.promedio.toFixed(1)}</b><small>(${p.total})</small></span>`;
}

/* Bloque de reseñas para la ficha de la sala */
function bloqueResenas(id) {
  const lista = resenasDeSala(id);
  const p = (state.rooms.find(x => x.id === id) || {}).puntaje || { promedio: 0, total: 0 };
  const puede = puedeResenar(id);
  const mias = misResenasDeSala(id);
  /* Las reseñas de una misma cuenta se juntan: la primera con sus estrellas y,
     debajo, las demás visitas con su fecha. Así el número de reseñas cuenta
     cuántas veces se reservó, y no se repite el nombre en cada línea. */
  const grupos = [];
  lista.forEach(x => {
    const g = grupos.find(y => y.usuario === (x.usuario || 'músico'));
    if (g) g.items.push(x);
    else grupos.push({ usuario: x.usuario || 'músico', items: [x] });
  });

  const aviso = !yo
    ? '<p class="muted small">Iniciá sesión para dejar tu reseña.</p>'
    : (!puede
      ? '<p class="muted small">Podés reseñar esta sala cuando tengas una reserva en ella.</p>'
      : '');

  const estrellas = [1, 2, 3, 4, 5].map(n =>
    `<button type="button" class="est-btn" data-n="${n}" aria-label="${n} estrella${n > 1 ? 's' : ''}">${ICO_SVG.estrellaOn}</button>`).join('');

  const items = grupos.length
    ? grupos.map(g => `
      <article class="resena">
        <div class="resena-top">
          ${estrellasHTML(g.items[0].estrellas)}
          <strong>${esc(g.usuario)}</strong>
        </div>
        ${g.items.map(x => `<p class="resena-visita"><span class="muted small">${x.fecha ? new Date(x.fecha).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}</span>${x.texto ? ' ' + esc(x.texto) : ''}</p>`).join('')}
      </article>`).join('')
    : '<p class="muted small">Todavía no hay reseñas. Si reservaste en esta sala, ¡sé el primero en contar cómo es!</p>';

  return `
    <h4 class="ficha-titulo">${ICO_SVG.estrella}Reseñas ${p.total ? `<span class="muted small">· ${p.promedio.toFixed(1)} de 5 (${p.total})</span>` : ''}</h4>
    <div class="resenas-lista">${items}</div>
    ${aviso}
    ${puede ? `
      <form id="f-resena" class="resena-form" novalidate>
        <input type="hidden" id="resena-nota" value="0">
        <div class="resena-estrellas" id="resena-estrellas">${estrellas}</div>
        <textarea id="resena-texto" maxlength="500" rows="3" placeholder="Contá cómo es la sala: el sonido, el equipo, la atención…"></textarea>
        <div class="row wrap">
          <button class="btn btn-primary btn-sm" type="submit">Publicar reseña</button>
        </div>
        <p class="muted small">Podés dejar una reseña por cada vez que reserves. No se reemplaza ninguna.</p>
        ${mias.length ? `<p class="muted small" id="resena-mias">${mias.length === 1 ? 'Dejaste 1 reseña' : `Dejaste ${mias.length} reseñas`} en esta sala. Abajo de todo tenés cuál borrar.</p>` : ''}
      </form>` : ''}
    ${mias.length ? `
      <details class="resena-borrar-caja">
        <summary>${ICO_SVG.basura} Borrar una de mis reseñas</summary>
        <ul class="resena-mias">${mias.map(x => `
          <li>
            <span>${x.fecha ? new Date(x.fecha).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' }) : ''} · ${x.estrellas}<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> ${esc(String(x.texto || '').slice(0, 60))}</span>
            <button class="btn btn-sm" type="button" data-borrar-resena="${x.id}">Borrar</button>
          </li>`).join('')}</ul>
      </details>` : ''}`;
}

/* Conecta el formulario de reseña que está abierto en la ficha */
function wireResenas(id) {
  const redibujar = () => {
    fichaSala(id);
    renderRooms();
    renderSalasStrip();
  };

  /* Borrar una reseña puntual (de las mías) */
  document.querySelectorAll('[data-borrar-resena]').forEach(b => {
    b.onclick = async () => {
      const resenaId = b.dataset.borrarResena;
      b.disabled = true;
      try {
        const data = await api('/api/resenas/' + resenaId, { method: 'DELETE' });
        state.resenas = (state.resenas || []).filter(x => x.id !== resenaId);
        const room = state.rooms.find(x => x.id === id);
        if (room && data.puntaje) room.puntaje = data.puntaje;
        toast('Tu reseña se borró', 'ok');
        redibujar();
      } catch (e) {
        toast(e.message, 'error');
        b.disabled = false;
      }
    };
  });

  const form = $('#f-resena');
  if (!form) return;
  const oculto = $('#resena-nota');
  const botones = [...form.querySelectorAll('.est-btn')];
  const pintar = n => botones.forEach(b => b.classList.toggle('on', Number(b.dataset.n) <= n));
  botones.forEach(b => { b.onclick = () => { oculto.value = b.dataset.n; pintar(Number(b.dataset.n)); }; });

  form.onsubmit = async e => {
    e.preventDefault();
    const nota = Number(oculto.value);
    if (!nota) { toast('Elegí cuántas estrellas le ponés', 'warn'); return; }
    const btn = form.querySelector('button[type=submit]');
    const txt = btn.textContent;
    btn.disabled = true; btn.textContent = 'Publicando…';
    try {
      const data = await api('/api/resenas', {
        method: 'POST',
        body: { roomId: id, estrellas: nota, texto: $('#resena-texto').value },
      });
      state.resenas = (state.resenas || []).concat([data.resena]);
      const room = state.rooms.find(x => x.id === id);
      if (room && data.puntaje) room.puntaje = data.puntaje;
      toast('Gracias por tu reseña', 'ok');
      redibujar();
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false; btn.textContent = txt;
    }
  };
}

function fichaSala(id) {
  const r = state.rooms.find(x => x.id === id);
  if (!r) return;
  const equ = r.equipos || {};
  const filas = [
    [ICO_SVG.musica, 'Instrumentos', equ.instrumentos],
    [ICO_SVG.bateria, 'Batería', equ.bateria],
    [ICO_SVG.amplis, 'Amplificadores', equ.amplificadores],
    [ICO_SVG.micro, 'Micrófonos', equ.microfonos],
    [ICO_SVG.consola, 'Consola / sonido', equ.consola],
    [ICO_SVG.estrella, 'Otros', equ.otros],
  ].filter(f => f[2]);
  const dias = [1, 2, 3, 4, 5, 6, 0].map(d => {
    const h = horarioSalaDe(r)[String(d)];
    const nombre = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][d];
    return `<div class="fh-dia${h ? '' : ' cerrado'}" title="${nombre}"><strong>${nombre.slice(0, 3)}</strong><span>${h ? `${h.open} – ${h.close}` : 'Cerrado'}</span></div>`;
  }).join('');
  openModal(`
    <div class="ficha-stats">
      <div class="ficha-dato"><span>${ICO_SVG.precio}Precio</span><strong>${fmtMoney(r.price)} /hora</strong></div>
      ${r.telefono ? `<div class="ficha-dato"><span>${ICO_SVG.telefono}Teléfono</span><strong>${esc(r.telefono)}</strong></div>` : ''}
      ${r.localidad ? `<div class="ficha-dato"><span>${ICO_SVG.pin}Zona</span><strong>${esc(r.localidad)}</strong></div>` : ''}
      ${(r.puntaje && r.puntaje.total) ? `<div class="ficha-dato"><span>${ICO_SVG.estrella}Reseñas</span><strong>${r.puntaje.promedio.toFixed(1)} / 5 <span class="muted small">(${r.puntaje.total})</span></strong></div>` : ''}
    </div>
    ${r.direccion ? `<p class="ficha-dir">${ICO_SVG.pin}${esc([r.direccion, r.numero].filter(Boolean).join(' '))}${linkMapaSala(r) ? ` · <a href="${linkMapaSala(r)}" target="_blank" rel="noopener">ver en el mapa</a>` : ''}</p>` : ''}
    ${(r.fotos || []).length ? `<h4 class="ficha-titulo">${ICO_SVG.camara}Fotos</h4><div class="ficha-fotos">${(r.fotos || []).map(f => `<figure class="ficha-foto">${f.foto ? `<img src="${esc(f.foto)}" alt="${esc(f.titulo || r.name)}" onclick="verFoto('${esc(f.foto)}', 'Foto de la sala')" title="Ver en grande">` : ''}${f.titulo ? `<figcaption>${esc(f.titulo)}</figcaption>` : ''}</figure>`).join('')}</div>` : ''}
    ${r.descripcion ? `<p class="ficha-desc">${esc(r.descripcion)}</p>` : ''}
    ${(r.features || []).length ? `<div class="ficha-chips">${r.features.map(f => `<span class="chip">${esc(f)}</span>`).join('')}</div>` : ''}
    ${filas.length ? `<h4 class="ficha-titulo">${ICO_SVG.consola}Equipamiento</h4><div class="ficha-equip">${filas.map(f => `<div class="ficha-dato"><span>${f[0]}${f[1]}</span><strong>${esc(f[2])}</strong></div>`).join('')}</div>` : ''}
    ${catalogoSalaHTML(r)}
    <h4 class="ficha-titulo">${ICO_SVG.reloj}Horario de atención</h4>
    <div class="ficha-horario">${dias}</div>
    ${bloqueResenas(r.id)}
    <div class="row">
      <button class="btn btn-primary" id="ficha-reservar">Ver horarios ${ICO_SVG.flecha}</button>
      <button class="btn" id="ficha-fav">${esFavorita(r.id) ? `${ICO_SVG.corazonOn} Quitar de favoritas` : `${ICO_SVG.corazon} Guardar como favorita`}</button>
      <button class="btn" id="ficha-cerrar">Cerrar</button>
    </div>`);
  $('#ficha-cerrar').onclick = closeModal;
  $('#ficha-reservar').onclick = () => { closeModal(); elegirSala(r.id); };
  $('#ficha-fav').onclick = () => { alternarFavorita(r.id); fichaSala(r.id); };
  wireResenas(r.id);
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
    toast(data.favoritos.includes(id) ? 'Sala guardada en favoritas' : 'Sala quitada de favoritas', 'ok');
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
  const dir = [[r.direccion, r.numero].filter(Boolean).join(' '), r.localidad].filter(Boolean).join(', ');
  return dir ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dir)}` : '';
}

/* ================= MAPA: Google Maps (si hay clave) u OpenStreetMap ================= */
let gmap = null;            /* mapa de Google */
let ginfo = null;           /* ventana de información de Google */
let gmarcadores = [];       /* marcas actuales en Google */
let gmapaFallo = false;     /* la clave de Google no sirvió  seguimos con OpenStreetMap */
let cargandoGoogle = null;  /* promesa de la API de Google */
let huellaMapa = '';        /* qué había dibujado la última vez */

const claveGoogle = () => '';   /* Google Maps desactivado: se usa Leaflet + CartoDB (sin API key) */
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
      toast('La clave de Google Maps no funciona. Se muestra el mapa de OpenStreetMap.', 'warn');
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
      toast('No pude cargar Google Maps. Se muestra el mapa de OpenStreetMap.', 'warn');
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
          g.fillText('♪', centro, centro + 1);
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
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap, &copy; CARTO',
  }).addTo(mapa);
  return mapa;
}

/* Foto horizontal de la sala (portada): la principal, si no la primera subida */
function fotoPortadaSala(r) {
  if (r.fotoPortada) return r.fotoPortada;
  const f = (r.fotos || [])[0];
  return f ? f.foto : (r.foto || '');
}

function popupSala(r) {
  const dist = miUbicacion ? ` · a ${distKm(miUbicacion[0], miUbicacion[1], Number(r.lat), Number(r.lng)).toFixed(1)} km` : '';
  const eq = Object.values(r.equipos || {}).filter(Boolean).length;
  const dir = [[r.direccion, r.numero].filter(Boolean).join(' '), r.localidad].filter(Boolean).join(' · ');
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
          : '<img class="pop-cover-img" src="/assets/marca-agua-negro.png" alt="Logo de Más Música">'}
        ${r.foto ? `<img class="pop-logo" src="${esc(r.foto)}" alt="Logo de ${esc(r.name)}">` : '<img class="pop-logo" src="/assets/marca-agua-negro.png" alt="Logo de Más Música">'}
      </div>
      <div class="pop-datos">
        <strong class="pop-nombre">${esc(r.name)}</strong>
        ${puntajeSalaHTML(r, true)}
        <span class="pop-linea"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> ${dir ? esc(dir) : 'Dirección sin cargar'}</span>
        ${tel
          ? `<a class="pop-linea pop-tel" href="tel:${esc(telHref)}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg> ${esc(tel)}</a>`
          : '<span class="pop-linea muted"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg> Teléfono sin cargar</span>'}
        <span class="muted small">${fmtMoney(r.price)}/hora · <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> ${r.capacity}${dist}${eq ? ` · <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg> ${eq} elemento(s)` : ''}</span>
        <div class="row pop-acciones">
          <button class="btn btn-primary btn-sm" data-mapa-sala="${r.id}">Ver horarios</button>
          <button class="btn btn-primary btn-sm" data-mapa-ficha="${r.id}">undefined Ficha</button>
          ${urlSegura(gmaps) ? `<a class="btn btn-sm" href="${urlSegura(gmaps)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> Google Maps</a>` : ''}
          ${tel ? `<a class="btn btn-sm" href="tel:${esc(telHref)}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg> Llamar</a>` : ''}
          ${yo ? `<button class="btn btn-sm" data-mapa-fav="${r.id}">${esFavorita(r.id) ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path fill="currentColor" d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>'}</button>` : ''}
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
        <strong class="pop-nombre"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg> ${esc(sala.name)}</strong>
        <span class="pop-linea">${fmtDate(res.date)} · ${res.start}–${res.end}</span>
        <span class="pop-linea">${esc(res.name)}</span>
        ${dir ? `<span class="pop-linea muted small"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> ${esc(dir)}</span>` : ''}
        ${sala.telefono ? `<a class="pop-linea pop-tel small" href="tel:${esc(String(sala.telefono).replace(/[^0-9+]/g, ''))}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg> ${esc(sala.telefono)}</a>` : ''}
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
    miUbicacion,
    claveGoogle(),
  ]);
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

/* Tarjeta centrada (popup-sala) sobre el mapa */
function abrirTarjetaSala(id) {
  const r = (state.rooms || []).find(x => x.id === id);
  if (!r) return;
  const equ = r.equipos || {};
  const filas = [
    ['<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg> Instrumentos', equ.instrumentos],
    ['<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="7" rx="8" ry="3"/><path d="M4 7v8c0 1.7 3.6 3 8 3s8-1.3 8-3V7"/><path d="M4 11c1.5 1.2 4.5 2 8 2s6.5-.8 8-2"/></svg> Batería', equ.bateria],
    ['<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg> Amplificadores', equ.amplificadores],
    ['<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg> Micrófonos', equ.microfonos],
    ['<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg> Consola / sonido', equ.consola],
    ['<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l1.9 5.8L20 9.7l-4.9 3.5L16 19l-4-3-4 3 1-5.8L4 9.7l6.1-1.9z"/></svg> Otros', equ.otros],
  ].filter(f => f[1]);
  const dias = [1, 2, 3, 4, 5, 6, 0].map(d => {
    const h = horarioSalaDe(r)[String(d)];
    return `<div class="dia-fila"><strong>${['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][d]}</strong><span>${h ? `${h.open} – ${h.close}` : 'Cerrado'}</span></div>`;
  }).join('');
  const card = $('#mapa-tarjeta-card');
  if (card) {
    const dir = [r.direccion, r.numero].filter(Boolean).join(' ');
    card.innerHTML = `
      <button type="button" class="mapa-tarjeta-close" onclick="cerrarTarjetaSala()" aria-label="Cerrar tarjeta">×</button>
      <div class="mt">
        <div class="mt-cover ${r.fotoPortada ? '' : 'sin-foto'}">
          ${r.fotoPortada ? `<img src="${esc(r.fotoPortada)}" alt="Portada de ${esc(r.name)}">` : '<img src="/assets/marca-agua-negro.png" alt="Más Música">'}
        </div>
        <div class="mt-cuerpo">
          ${r.foto ? `<img class="mt-logo" src="${esc(r.foto)}" alt="${esc(r.name)}">` : `<div class="mt-logo mt-logo-ico">${ICO_SVG.musica}</div>`}
          <h3 class="mt-nombre">${esc(r.name)}</h3>
          <div class="mt-chips">
            <span class="mt-chip">${ICO_SVG.precio}${fmtMoney(r.price)}<em>/hora</em></span>
            ${r.localidad ? `<span class="mt-chip">${ICO_SVG.pin}${esc(r.localidad)}</span>` : ''}
          </div>
          ${dir ? `<p class="mt-dir">${esc(dir)}${linkMapaSala(r) ? ` · <a href="${linkMapaSala(r)}" target="_blank" rel="noopener">ver en el mapa</a>` : ''}</p>` : ''}
          ${r.telefono ? `<a class="mt-tel" href="tel:${esc(String(r.telefono).replace(/[^0-9+]/g, ''))}">${ICO_SVG.telefono}${esc(r.telefono)}</a>` : ''}
          <div class="mt-acciones">
            <button class="btn btn-primary" id="tarjeta-reservar">Ver horarios ${ICO_SVG.flecha}</button>
            <button class="btn" id="tarjeta-ficha">${ICO_SVG.info}Ficha</button>
            <button class="btn mt-fav ${esFavorita(r.id) ? 'on' : ''}" id="tarjeta-fav" title="${esFavorita(r.id) ? 'Quitar de favoritas' : 'Guardar como favorita'}" aria-label="${esFavorita(r.id) ? 'Quitar de favoritas' : 'Guardar como favorita'}">${esFavorita(r.id) ? ICO_SVG.corazonOn : ICO_SVG.corazon}</button>
          </div>
        </div>
      </div>`;
    card.onclick = accionesMapa;
    const tc = $('#tarjeta-cerrar'); if (tc) tc.onclick = cerrarTarjetaSala;
    const tclose = document.querySelector('.mapa-tarjeta-close'); if (tclose) tclose.onclick = cerrarTarjetaSala;
    const tr = $('#tarjeta-reservar'); if (tr) tr.onclick = () => { cerrarTarjetaSala(); elegirSala(r.id); };
    const tf = $('#tarjeta-ficha'); if (tf) tf.onclick = () => { cerrarTarjetaSala(); fichaSala(r.id); };
    const tfv = $('#tarjeta-fav'); if (tfv) tfv.onclick = () => { alternarFavorita(r.id); abrirTarjetaSala(r.id); };
  }
  const overlay = $('#mapa-tarjeta');
  if (overlay) overlay.hidden = false;
  if (mapa) { try { mapa.panTo([Number(r.lat), Number(r.lng)], { animate: true }); } catch (e) {} }
}
function cerrarTarjetaSala() {
  const overlay = $('#mapa-tarjeta');
  if (overlay) overlay.hidden = true;
  const card = $('#mapa-tarjeta-card');
  if (card) card.innerHTML = '';
}

/* ---------- Tarjeta de reserva: reemplaza al popup viejo de las reservas ---------- */
function abrirTarjetaReserva(resId) {
  const res = misReservas().find(x => x.id === resId);
  const sala = res ? (state.rooms || []).find(x => x.id === res.roomId) : null;
  if (!res || !sala) return;
  const pasada = esPasada(res);
  const dir = [sala.direccion, sala.localidad].filter(Boolean).join(' · ');
  const portada = fotoPortadaSala(sala);
  const ini = String(sala.name || '').split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const card = $('#mapa-tarjeta-card');
  if (card) {
    card.innerHTML = `
      <header class="rm-cover ${portada ? '' : 'rm-cover-sin'}">
        ${portada ? `<img src="${esc(portada)}" alt="Portada de ${esc(sala.name)}" data-pop-foto="${esc(portada)}">` : `<span>${esc((sala.name || '').split(' ')[0] || '')}</span>`}
        <button type="button" class="rm-close" onclick="cerrarTarjetaSala()" aria-label="Cerrar tarjeta"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </header>
      <div class="rm-avatar-wrap">
        ${sala.foto ? `<img class="rm-avatar" src="${esc(sala.foto)}" alt="${esc(sala.name)}">` : `<div class="rm-avatar rm-avatar-ini">${esc(ini)}</div>`}
      </div>
      <section class="rm-body">
        <h3 class="rm-title">${esc(sala.name)}</h3>
        <div class="rm-date">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>
          ${fmtDate(res.date, { weekday: 'long', day: 'numeric', month: 'short' })} · ${res.start} – ${res.end}
        </div>
        <div class="rm-status${pasada ? ' rm-status-pasada' : ''}">${pasada ? 'Pasada' : 'Tu reserva'}</div>
        <div class="rm-details">
          ${dir ? `<div class="rm-row"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg><div><div class="rm-label">Dirección</div><div class="rm-value">${esc(dir)}</div></div></div>` : ''}
          <div class="rm-row"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg><div><div class="rm-label">Reservado por</div><div class="rm-value">${esc(res.name)}</div></div></div>
          ${sala.telefono ? `<div class="rm-row"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 4h4l2 5-2.5 1.5a12 12 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"/></svg><div><div class="rm-label">Teléfono</div><div class="rm-value"><a href="tel:${esc(String(sala.telefono).replace(/[^0-9+]/g, ''))}">${esc(sala.telefono)}</a></div></div></div>` : ''}
        </div>
        <div class="rm-actions">
          <button class="rm-btn rm-btn-primary" id="tarjeta-reservar">Ver horarios <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>
          <div class="rm-btn-row">
            <button class="rm-btn rm-btn-secondary" id="tarjeta-ficha"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 11h6M9 15h4"/></svg> Ficha</button>
            ${!pasada && res.estado !== 'cancelada' ? '<button class="rm-btn rm-btn-danger" id="tarjeta-cancelar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg> Cancelar</button>' : ''}
          </div>
        </div>
      </section>`;
    card.onclick = accionesMapa;
    const tr = $('#tarjeta-reservar'); if (tr) tr.onclick = () => { cerrarTarjetaSala(); elegirSala(sala.id); };
    const tf = $('#tarjeta-ficha'); if (tf) tf.onclick = () => { cerrarTarjetaSala(); fichaSala(sala.id); };
    const tcx = $('#tarjeta-cancelar'); if (tcx) tcx.onclick = () => { cerrarTarjetaSala(); cancelarReservaMia(res.id); };
  }
  const overlay = $('#mapa-tarjeta');
  if (overlay) overlay.hidden = false;
  if (mapa) { try { mapa.panTo([Number(sala.lat), Number(sala.lng)], { animate: true }); } catch (e) {} }
}


/* Acciones dentro de los popups (tanto Leaflet como Google) */
function accionesMapa(e) {
  const foto = e.target.closest('[data-pop-foto]');
  if (foto) { e.preventDefault(); return verFoto(foto.dataset.popFoto, 'Foto de la sala'); }
  const s = e.target.closest('[data-mapa-sala]');
  if (s) { cerrarPopupMapa(); return elegirSala(s.dataset.mapaSala); }
  const fch = e.target.closest('[data-mapa-ficha]');
  if (fch) { cerrarPopupMapa(); cerrarTarjetaSala(); return fichaSala(fch.dataset.mapaFicha); }
  const fav = e.target.closest('[data-mapa-fav]');
  if (fav) return alternarFavorita(fav.dataset.mapaFav);
  const cx = e.target.closest('[data-mapa-cancelar]');
  if (cx) { cerrarPopupMapa(); return cancelarReservaMia(cx.dataset.mapaCancelar); }
}

/* ---------- Dibujo del mapa ---------- */
function renderMapa() {
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
  let salas = salasPublicas().filter(tieneUbicacion);
  if (filtroSalas === 'favoritas') salas = salas.filter(r => esFavorita(r.id));
  salas.forEach(r => {
    const icono = L.divIcon({
      className: 'mk-wrap',
      html: `<div class="mk-sala${r.foto ? '' : ' mk-marca'}">${r.foto ? `<img src="${esc(r.foto)}" alt="">` : '<img src="assets/marca-agua-negro.png" alt="">'}</div>`,
      iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -26],
    });
    marcasSala[r.id] = L.marker([Number(r.lat), Number(r.lng)], { icon: icono, title: r.name })
      .addTo(capaMarcas)
      .on('click', () => {
        if (mapa) mapa.panTo([Number(r.lat), Number(r.lng)], { animate: true });
        abrirTarjetaSala(r.id);
      });
  });

  /* 2. Dónde está el usuario: círculo verde con el logo negro */
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

  /* 4. Encuadre */
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
    const iconos = await Promise.all(salas.map(r => iconoCircularGoogle(r.foto || 'assets/marca-agua-negro.png', 28, '♪')));
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
      m.addListener('click', () => abrirTarjetaSala(r.id));
      gmarcadores.push(m);
    });

    /* 2. Dónde está el usuario: círculo verde con el logo negro */
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

    /* 4. Encuadre */
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

/* El Inicio del músico ya no muestra el bloque " Resumen" (estadísticas)
   ni " Promociones y novedades". Solo queda el ingreso si no hay sesión. */
function renderResumenInicio() {
  const box = $('#inicio-resumen');
  if (!box || !state) return;
  const contenido = !yo
    ? `<div class="row wrap"><button class="btn btn-sm" id="sum-login"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> Iniciar sesión</button></div>`
    : '';
  /* Sin novedades ni botón, se oculta el panel para no dejar una tarjeta vacía */
  box.hidden = !contenido.trim();
  box.innerHTML = contenido;
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
      toast('Ubicación detectada', 'ok');
    },
    () => toast('No pude obtener tu ubicación. Revisá los permisos.', 'warn'),
    { timeout: 8000 }
  );
}

/* Estado del botón "Favoritas" del mapa */
function pintarBotonFavMapa() {
  const b = $('#btn-mapa-fav');
  if (!b) return;
  const on = filtroSalas === 'favoritas';
  b.classList.toggle('on', on);
  b.innerHTML = `${on ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path fill="currentColor" d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>'}<span class="mapa-btn-txt"> Favoritas</span>`;
}

/* Acciones dentro de los popups del mapa */
function wireMapa() {
  $('#btn-mi-ubicacion').onclick = pedirMiUbicacion;
  $('#btn-ver-todas').onclick = () => { filtroSalas = 'todas'; renderMapa(); encuadrarMapa(); pintarBotonFavMapa(); };
  const bmf = $('#btn-mapa-fav');
  if (bmf) bmf.onclick = () => { filtroSalas = filtroSalas === 'favoritas' ? 'todas' : 'favoritas'; renderMapa(); encuadrarMapa(); pintarBotonFavMapa(); };
  pintarBotonFavMapa();
  $('#btn-ver-mapa').onclick = irMapa;
  $('#mapa').onclick = accionesMapa;
}

async function cancelarReservaMia(id) {
  const r = state.reservations.find(x => x.id === id);
  if (!r) return;
  const ok = await confirmarAccion(
    `¿Cancelar tu reserva del ${fmtDate(r.date)} ${r.start} – ${r.end}? El horario queda libre.`,
    '¿Cancelar reserva?',
    'Sí, cancelar',
    'No, mantener',
    'peligro'
  );
  if (!ok) return;
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
      <h3><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg> ${esc(titulo || 'Ubicar en el mapa')}</h3>
      <p class="muted small">Tocá el mapa para marcar el punto exacto de la sala.</p>
      <div id="mapa-picker"></div>
      <p class="muted small" id="picker-texto"></p>
      <div class="row wrap">
        <button class="btn btn-primary" id="picker-ok"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg> Guardar ubicación</button>
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
          toast('Dirección encontrada', 'ok');
          return { lat: loc.lat(), lng: loc.lng(), nombre: rta.res[0].formatted_address };
        }
      } catch (e) { /* si Google falla, probamos con OpenStreetMap */ }
    }
  }

  /* 2. OpenStreetMap (Nominatim) */
  try {
    /* countrycodes=ar: igual que con Google, el mapa es argentino. Evita que una
       dirección rara o incompleta caiga en otro país. */
    const res = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ar&q=' + encodeURIComponent(q));
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
    : '<span class="sala-chip-foto"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></span>')
    + `<span>${esc(room.name)}</span>`;
}

/* Elige una sala (desde el mapa o la lista) y sigue con la fecha o los horarios */
function elegirSala(roomId) {
  if (!yo) { toast('Iniciá sesión para hacer una reserva', 'warn'); pantallaAuth('login'); return; }
  ocultarVistas();
  const room = salasPublicas().find(r => r.id === roomId);
  if (!room) return;
  $('#view-public').hidden = false;
  $('#view-mine').hidden = true;
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
  $('#slots-title').innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${esc(room.name)} · ${fmtDate(sel.date)}`;
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
      label = `${s.start} – ${s.end}<small><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Reservado</small>`;
    } else if (s.status === 'blocked') {
      cls = 'blocked';
      label = `${s.start} – ${s.end}<small><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Bloqueado</small>`;
    } else {
      cls = 'past';
      label = `${s.start} – ${s.end}<small>Ya pasó</small>`;
    }
    return `<button class="slot ${cls}" data-start="${s.start}" ${s.status !== 'available' ? 'disabled' : ''}>${label}</button>`;
  }).join('');

  if (sel.range) {
    const horas = (rEnd - rStart) / 60;
    $('#range-text').innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${sel.range.start} – ${sel.range.end} · ${horas} hora${horas > 1 ? 's' : ''} · Total: ${fmtMoney(horas * room.price)}`;
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
    <button class="viewer-close" type="button" aria-label="Cerrar"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    <img class="viewer-img" src="${esc(src)}" alt="${esc(alt || '')}">
    <div class="viewer-controls">
      <button class="btn btn-sm" data-v="out" title="Alejar"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
      <button class="btn btn-sm" data-v="reset" title="Centrar"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg></button>
      <button class="btn btn-sm" data-v="in" title="Acercar"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
    </div>
    <p class="viewer-hint">Arrastra la foto hacia abajo o arriba para moverla · <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg> para acercar · toca fuera para cerrar</p>`;
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
      <div class="crop-empty"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg><br>Elegí una imagen</div>
    </div>
    <div class="crop-controls">
      <button class="btn btn-sm" data-crop="out" title="Achicar"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
      <button class="btn btn-sm" data-crop="reset" title="Centrar y llenar el cuadro"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg></button>
      <button class="btn btn-sm" data-crop="in" title="Agrandar"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
    </div>
    <p class="muted small crop-hint">Ajusta a mano: arrastra para mover · <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg> acercar o alejar · <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg> llena todo el cuadro</p>`;

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
  /* Registrar una banda es solo para músicos; el administrador solo edita o elimina */
  if (!id && esCuentaControl()) { toast('Registrar una banda es solo para músicos', 'warn'); return; }
  const b = id ? bandas().find(x => x.id === id) : { nombre: '', telefono: '', foto: '' };
  if (id && !b) return;
  const fotoActual = b.foto || '';
  const grupoActual = b.fotoGrupal || '';
  openModal(`
    <h3>${id ? 'Editar banda' : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h20v8a10 10 0 0 1-20 0z"/><circle cx="8" cy="10" r="1.4"/><circle cx="16" cy="10" r="1.4"/></svg> Registrar mi banda'}</h3>
    <div id="bd-crop"></div>
    <label>Logo / foto de perfil (círculo)<input type="file" id="bd-file" accept="image/*"></label>
    <label class="check" id="bd-quitar-wrap" ${fotoActual ? '' : 'hidden'}><input type="checkbox" id="bd-quitar"> Quitar la foto</label>
    <div class="grupo-foto">
      <div class="miembros-head">
        <strong><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> Foto grupal <span class="muted small">(opcional)</span></strong>
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
        <strong><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> Integrantes <span class="muted small">(opcional)</span></strong>
        <button class="btn btn-sm" id="bd-add-miembro" type="button">＋ Agregar</button>
      </div>
      <div id="bd-miembros"></div>
      <p class="muted small">Pon el nombre de cada integrante y qué instrumento toca.</p>
    </div>
    <div class="row modal-acciones">
      <button class="btn btn-primary" id="bd-save"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Guardar cambios</button>
      <button class="btn" id="bd-cancel">Cancelar</button>
    </div>`);

  const rec = montarRecortador($('#bd-crop'), { titulo: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/></svg> Logo de la banda', formato: 'cuadrado' });
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
    recGrupo = montarRecortador($('#bd-crop-grupo'), { titulo: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> Foto grupal', formato: 'horizontal' });
    if (grupoActual) {
      recGrupo.cargar(grupoActual, 'horizontal', false).catch(() => toast('No se pudo abrir la foto grupal', 'warn'));
    }
    $('#bd-file-grupo').onchange = e => {
      const f = e.target.files[0];
      if (!f) return;
      if (!/^image\//.test(f.type)) { toast('Ese archivo no es una imagen', 'error'); return; }
      const lector = new FileReader();
      lector.onload = () => recGrupo.cargar(lector.result)
        .then(() => toast('Encuadra la foto grupal con', 'ok'))
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
      .then(() => toast('Encuadra tu foto cony arrastrando', 'ok'))
      .catch(err => toast(err.message || 'No se pudo leer la imagen', 'error'));
    lector.onerror = () => toast('No se pudo leer el archivo', 'error');
    lector.readAsDataURL(f);
  };

  $('#bd-save').onclick = async () => {
    const nombre = $('#bd-name').value.trim();
    if (!nombre) { toast('Escribí el nombre de la banda', 'warn'); return; }
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
      toast(id ? 'Banda actualizada' : `¡${nombre} registrada!`, 'ok');
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
    <button class="btn btn-sm btn-danger" type="button" title="Quitar integrante" data-m-del><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
  fila.querySelector('[data-m-del]').onclick = () => fila.remove();
  cont.appendChild(fila);
}

/* Refresca lo que esté visible tras guardar el perfil */
function refrescarVistasTrasBanda() {
  if (!$('#view-mine').hidden) renderMine();
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
        ? `<img class="perfil-avatar-circular grande" src="${esc(b.foto)}" alt="${esc(b.nombre)}" data-foto="${esc(b.foto)}" data-foto-alt="${esc(b.nombre)}" title="Tocá para ver en grande">`
        : '<div class="perfil-avatar-circular grande perfil-sin-foto"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h20v8a10 10 0 0 1-20 0z"/><circle cx="8" cy="10" r="1.4"/><circle cx="16" cy="10" r="1.4"/></svg></div>'}
      <h3>${esc(b.nombre)}</h3>
      <div class="perfil-tags">
        ${b.genero ? `<span class="tag"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg> ${esc(b.genero)}</span>` : ''}
        <span class="tag"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> ${ints.length} ${ints.length === 1 ? 'integrante' : 'integrantes'}</span>
        ${b.telefono ? `<span class="tag"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg> ${esc(b.telefono)}</span>` : ''}
      </div>
      <h4 class="sub">Integrantes y instrumentos</h4>
      ${ints.length
        ? `<ul class="perfil-lista">${ints.map(m => `
            <li>
              <strong>${esc(m.nombre || 'Sin nombre')}</strong>
              <span>${m.instrumento ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg> ' + esc(m.instrumento) : '<span class="muted">sin instrumento</span>'}</span>
            </li>`).join('')}</ul>`
        : '<p class="muted small">Esta banda aún no registró sus integrantes.</p>'}
    </div>
    <div class="row">
      ${b.fotoGrupal ? `<button class="btn btn-primary" data-foto="${esc(b.fotoGrupal)}" data-foto-alt="Foto grupal"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> Ver foto grupal</button>` : ''}
      <button class="btn ${b.fotoGrupal ? '' : 'btn-primary'}" id="pf-edit"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg> Editar perfil</button>
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
  const alquilables = ((room && room.catalogo) || []).filter(i => i && i.alquiler);
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
        <strong><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10H4z"/><path d="M9 6V4a3 3 0 0 1 6 0v2"/><path d="M9 14h6"/></svg> ¿Alquilas instrumentos?</strong>
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
          : `<span class="band-avatar band-emoji"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h20v8a10 10 0 0 1-20 0z"/><circle cx="8" cy="10" r="1.4"/><circle cx="16" cy="10" r="1.4"/></svg></span>`) : ''}
        <div class="mine-band-info">
          <strong>${elegida ? esc(elegida.nombre) : ''}</strong>
          <span class="muted small">Banda registrada</span>
        </div>
      </div>
      <label class="lbl-band">Banda registrada (opcional)
        <select id="bk-band">
          <option value="">— Escribí tu nombre —</option>
          ${listaBandas.map(b => `<option value="${esc(b.nombre)}" ${elegida && b.id === elegida.id ? 'selected' : ''}>${esc(b.nombre)}</option>`).join('')}
        </select>
      </label>
      ${esCuentaControl() ? '' : '<button class="btn btn-sm" id="bk-register-band"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h20v8a10 10 0 0 1-20 0z"/><circle cx="8" cy="10" r="1.4"/><circle cx="16" cy="10" r="1.4"/></svg> Registrar mi banda</button>'}
    </div>
    <label>Nombre o banda *<input id="bk-name" maxlength="60" placeholder="Ej.: Banda Luna" autocomplete="name" value="${yo ? esc(yo.nombre) : ''}"></label>
    <label>Teléfono (opcional)${yo ? '' : ' <span class="muted small">(creá una cuenta para no escribirlo cada vez)</span>'}<input id="bk-phone" type="tel" maxlength="20" placeholder="Ej.: +56 9 1234 5678" value="${yo ? esc(yo.telefono || '') : ''}"></label>
    ${yo ? '' : `<button class="btn btn-sm btn-block" id="bk-login"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> Iniciar sesión / crear cuenta</button>`}
    <button class="btn btn-primary btn-big" id="bk-confirm"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg> Confirmar reserva</button>
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
        : `<span class="band-avatar band-emoji"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h20v8a10 10 0 0 1-20 0z"/><circle cx="8" cy="10" r="1.4"/><circle cx="16" cy="10" r="1.4"/></svg></span>`) +
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

  /* Registrar una banda nueva y seleccionarla (solo músicos) */
  const btnRegBanda = $('#bk-register-band');
  if (btnRegBanda) btnRegBanda.onclick = () => formularioBanda(null, creada => {
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
  if (!name) { toast('Escribí tu nombre o el de tu banda', 'warn'); return; }
  const startMin = toMin(sel.slot.start), endMin = toMin(sel.slot.end);
  if (!rangoDisponible(sel.date, sel.roomId, startMin, endMin)) {
    toast('Ese horario ya no está disponible. Elegí otro.', 'error');
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
    const pagarUrl = urlSegura(data.pago.url);
    const okConfirmada = () => `
      <div class="success">
        <div class="ok-mark"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></div>
        <h3>¡Reserva confirmada!</h3>
        <p><strong>${esc(name)}</strong></p>
        <p>${esc(roomP ? roomP.name : '')} · ${data.reservation.start} – ${data.reservation.end}</p>
        <p class="muted small">Seña pagada (modo prueba). La sala ya recibió el aviso.</p>
        <button class="btn" id="bk-mine"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> Ver mis reservas</button>
      </div>`;
    const pctSena = Math.max(1, Math.min(100, Math.round((data.pago.sena / data.pago.total) * 100)));
    $('#confirm-body').innerHTML = `
      <div class="confirma-reserva">
        <div class="cr-stepper" aria-label="Progreso de la reserva">
          <div class="cr-step done">Horario elegido</div>
          <div class="cr-step active">Pagar seña</div>
          <div class="cr-step">Sala confirmada</div>
        </div>

        <section class="cr-card">
          <div class="cr-eyebrow">Falta pagar la seña</div>
          <h2 class="cr-title">Confirma tu reserva</h2>
          <p class="cr-sub">${esc(roomP ? roomP.name : '')}</p>

          <div class="cr-info">
            <div class="cr-info-row">
              <span class="cr-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></span>
              <div>
                <strong>${fmtDate(sel.date)}</strong>
                <small>${data.reservation.start} – ${data.reservation.end} · ${esc(roomP ? roomP.name : '')}</small>
              </div>
            </div>
          </div>
        </section>

        <section class="cr-card">
          <div class="cr-pay-head">
            <div>
              <div class="cr-label">Seña a pagar ahora</div>
              <div class="cr-amount">${fmtMoney(data.pago.sena)}</div>
            </div>
            <div class="cr-total">
              <div class="cr-label" style="text-align:right">Total</div>
              <b>${fmtMoney(data.pago.total)}</b>
            </div>
          </div>
          <div class="cr-bar" role="progressbar" aria-valuenow="${pctSena}" aria-valuemin="0" aria-valuemax="100"><div style="width:${pctSena}%"></div></div>
          <div class="cr-split">
            <span>Seña (${pctSena}%) <b>${fmtMoney(data.pago.sena)}</b></span>
            <span>Saldo en sala <b>${fmtMoney(data.pago.saldo)}</b></span>
          </div>
        </section>

        <div class="cr-hold">
          <span class="cr-icon cr-icon-amber"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>
          <div>Tu horario queda reservado hasta las <b>${hasta}</b>. Si no pagás la seña, se libera.</div>
        </div>

        ${pagarUrl
          ? `<a class="btn cr-btn-primary" href="${pagarUrl}" target="_blank" rel="noopener">Pagar seña con Mercado Pago</a>`
          : data.pago.simulado
            ? `<button class="btn cr-btn-primary" id="bk-pagar-prueba">Pagar la seña (prueba)</button>`
            : '<p class="muted small">El cobro de la seña no está activo.</p>'}
        <button class="btn cr-btn-secondary" id="bk-cancelar-reserva"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Cancelar reserva</button>
        <button class="btn cr-btn-secondary" id="bk-mine"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> Ver mis reservas</button>

        <p class="cr-fine">El saldo de ${fmtMoney(data.pago.saldo)} se abona en la sala el día de tu turno.</p>
      </div>`;
    $('#bk-mine').onclick = () => { irAMisReservasInicio(); };
    const btnCancelar = $('#bk-cancelar-reserva');
    if (btnCancelar) btnCancelar.onclick = async () => {
      btnCancelar.disabled = true;
      try {
        const ok = await confirmarAccion(
          '¿Cancelar esta reserva? El horario volverá a quedar libre.',
          '¿Cancelar reserva?',
          'Sí, cancelar',
          'No, mantener',
          'peligro'
        );
        if (!ok) { btnCancelar.disabled = false; return; }
        const data = await api(`/api/reservations/${data.reservation.id}/cancel`, { method: 'POST', body: { name: data.reservation.name, phone: data.reservation.phone } });
        if (data && data.state) state = data.state;
        toast('Reserva cancelada. El horario quedó libre.', 'ok');
        sel.range = null; sel.roomId = null; sel.slot = null; sel.bandaNombre = '';
        goStep(1); renderCalendar();
      } catch (err) {
        toast(err.message || 'No se pudo cancelar', 'error');
        btnCancelar.disabled = false;
      }
    };
    const btnPrueba = $('#bk-pagar-prueba');
    if (btnPrueba) btnPrueba.onclick = async () => {
      btnPrueba.disabled = true;
      try {
        const res = await api('/api/pagos/simular', { method: 'POST', body: { reservaId: data.reservation.id, resultado: 'aprobado' } });
        if (res && res.state) state = res.state;
        toast('Seña pagada (prueba)', 'ok');
        if (yo) cargarNotificaciones();
        renderMineRapido();
        $('#confirm-body').innerHTML = okConfirmada();
        $('#bk-mine').onclick = () => { irAMisReservasInicio(); };
      } catch (err) {
        toast(err.message || 'No se pudo simular el pago', 'error');
        btnPrueba.disabled = false;
      }
    };
    renderMineRapido();
    if (pagarUrl) {
      toast('Te llevamos a Mercado Pago para pagar la seña…', 'ok');
      setTimeout(() => {
        try { window.open(pagarUrl, '_blank', 'noopener'); } catch (e) { location.href = pagarUrl; }
      }, 1300);
      iniciarVerificacionPago(data.reservation.id, sel.roomId);
    }
    return;
  }
  const room = state.rooms.find(r => r.id === sel.roomId);
  const horas = horasDe(data.reservation);
  const alquilados = data.reservation.alquiler || [];
  const totalAlq = alquilados.reduce((s, a) => s + a.total, 0);
  $('#confirm-body').innerHTML = `
    <div class="success">
      <div class="ok-mark"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></div>
      <h3>¡Reserva confirmada!</h3>
      <p><strong>${esc(name)}</strong></p>
      <p>${fmtDate(sel.date)}</p>
      <p>${esc(room.name)} · ${data.reservation.start} – ${data.reservation.end} (${horas} hora${horas > 1 ? 's' : ''})</p>
      ${alquilados.length ? `
        <div class="alquiler-confirmado">
          <strong><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10H4z"/><path d="M9 6V4a3 3 0 0 1 6 0v2"/><path d="M9 14h6"/></svg> Alquiler</strong>
          ${alquilados.map(a => `<div class="muted small">${esc(a.nombre)} · ${a.horas}h · ${fmtMoney(a.total)}</div>`).join('')}
        </div>` : ''}
      <p class="accent"><strong>Total: ${fmtMoney(horas * room.price + totalAlq)}</strong></p>
      <p class="muted small">Estos horarios ya no están disponibles para otros usuarios.</p>
      <button class="btn btn-primary" id="bk-again">Hacer otra reserva</button>
      <button class="btn" id="bk-mine"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> Ver mi perfil</button>
    </div>`;
  $('#bk-again').onclick = () => { sel.range = null; sel.roomId = null; sel.slot = null; sel.bandaNombre = ''; goStep(1); renderCalendar(); };
  $('#bk-mine').onclick = () => { irAMisReservasInicio(); };
  renderMineRapido();   /* la reserva nueva ya figura en "Mis reservas" */
  toast('Reserva registrada', 'ok');
}

/* ---------- Mis reservas (cliente) ---------- */
let busquedaMine = '';
let filtroMisReservas = '';   /* '' | 'proximas' | 'historial' (se elige en Ajustes) */

function mostrarPerfil() {
  ocultarVistas();
  $('#view-public').hidden = true;
  $('#view-mine').hidden = false;
  setNav('perfil');
  renderMine();
}

/* Va al Inicio y baja hasta "Mis reservas" (que vive debajo del calendario) */
function irAMisReservasInicio() {
  ocultarVistas();
  $('#view-public').hidden = false;
  $('#view-mine').hidden = true;
  setNav('inicio');
  const hm = $('#home-mine');
  if (hm) { hm.hidden = false; }
  renderMineRapido();
  if (hm) hm.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function mostrarMisReservas() { mostrarPerfil(); }

function volverAReservar() {
  ocultarVistas();
  $('#view-mine').hidden = true;
  $('#view-public').hidden = false;
  setNav('inicio');
}

/* ---------- Barra inferior (5 opciones) ---------- */
function setNav(nav) {
  navActual = nav;
  document.body.classList.toggle('modo-control', esCuentaControl());
  /* Al dejar el panel de administración, la barra inferior vuelve a mostrarse.
     (También cuando se sale con el botón Atrás del navegador, que no pasa por salirAdmin) */
  if (nav !== 'admin') {
    document.body.classList.remove('admin-abierto');
    $('#btn-exit-admin').hidden = true;
  }
  /* En el Mapa la barra inferior va transparente (solo en celular) */
  document.body.classList.toggle('nav-mapa', nav === 'mapa');
  $$('#dock-container [data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === nav));
  $('#dock-container').hidden = nav === 'admin'; /* el admin usa todo el alto */
  /* Al cambiar de sección, la barra siempre vuelve a mostrarse */
  const dockNav = $('#dock-container');
  if (dockNav) dockNav.classList.remove('dock-oculto');
  actualizarAccionesHeader();
}

function scrollMainArriba() {
  const m = document.querySelector('main:not([hidden])');
  if (m) m.scrollTop = 0;
}

/* Al deslizar hacia abajo, la barra de las 5 opciones se oculta; al deslizar hacia
   arriba, vuelve. Se detecta el scroll de cualquier contenedor con scroll interno
   (las vistas <main>, el panel de admin, etc.) capturando el evento en el documento. */
function prepararDockAutoOcultar() {
  if (window._dockAutoOcultarOk) return;
  window._dockAutoOcultarOk = true;

  const UMBRAL = 6;   /* mínimo de píxeles para considerar un cambio de dirección */
  let ultimo = 0;     /* última posición conocida del scroller activo */
  let scroller = null;

  const dock = () => document.getElementById('dock-container');

  function mostrar() {
    const d = dock();
    if (d) d.classList.remove('dock-oculto');
  }
  function esEscritorio() {
    return window.matchMedia('(min-width: 960px)').matches;
  }
  function ocultar() {
    const d = dock();
    /* No ocultar en escritorio (la barra siempre visible) ni en el mapa */
    if (d && !esEscritorio() && !document.body.classList.contains('nav-mapa')) d.classList.add('dock-oculto');
  }

  document.addEventListener('scroll', e => {
    const el = e.target;
    /* Solo nos interesan elementos con scroll real (no el documento) */
    if (!el || el === document || el.scrollHeight <= el.clientHeight) return;

    /* Si cambia el contenedor que scrollea, reiniciar la referencia */
    if (el !== scroller) {
      scroller = el;
      ultimo = el.scrollTop;
      mostrar();
      return;
    }

    const y = el.scrollTop;
    /* Cerca del tope, siempre visible */
    if (y <= 8) { ultimo = y; mostrar(); return; }

    const dif = y - ultimo;
    if (Math.abs(dif) < UMBRAL) return;

    if (dif > 0) ocultar();   /* desliza hacia abajo: se esconde */
    else mostrar();           /* desliza hacia arriba: reaparece */
    ultimo = y;
  }, { passive: true, capture: true });

  /* Al cambiar de vista, la barra siempre vuelve a mostrarse */
  window._dockMostrar = mostrar;
}

/* Cambio de pestañas en Administración central: solo tocando la pestaña.
   (Antes también se podía deslizar con el dedo de derecha a izquierda sobre
   el panel; ese gesto se quitó a pedido.) */

function irInicio() {
  ocultarVistas();
  $('#view-public').hidden = false;
  $('#view-mine').hidden = true;
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

/* La vista "Salas" del menú muestra el mapa (con todas las salas) */
function irSalasMapa(filtro) {
  /* El dueño de sala no tiene mapa de salas públicas: ve su lista */
  if (esDueño()) { irSalas(); return; }
  filtroSalas = filtro === 'favoritas' ? 'favoritas' : 'todas';
  ocultarVistas();
  $('#view-mapa').hidden = false;
  setNav('salas');
  renderMapa();
  pintarBotonFavMapa();
  scrollMainArriba();
  if (timerEncuadre) clearTimeout(timerEncuadre);
  timerEncuadre = setTimeout(() => {
    if (mapa) mapa.invalidateSize();
    if (gmap) { try { google.maps.event.trigger(gmap, 'resize'); } catch (e) {} }
    encuadrarMapa();
  }, 220);
}

/* El mapa tiene su propia pantalla */
function irMapa() {
  /* El dueño de sala no tiene mapa de salas: lo llevamos a su lista de salas */
  if (esDueño()) { irSalas(); return; }
  ocultarVistas();
  $('#view-mapa').hidden = false;
  setNav('mapa');
  renderMapa();
  pintarBotonFavMapa();
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
  toast('Elegí la sala', 'ok');
}

function irMisReservas() { mostrarPerfil(); }

/* ================= Comunidad (solo músicos) ================= */
function irComunidad() {
  /* Solo los músicos (rol USER) tienen comunidad; admin y dueños van al Perfil */
  if (!esMúsico()) {
    const navPerfil = document.getElementById('nav-mine');
    if (navPerfil) navPerfil.click();
    return;
  }
  ocultarVistas();
  $('#view-comunidad').hidden = false;
  setNav('comunidad');
  scrollMainArriba();
  /* El chat va a pantalla completa: el estado se aplica ya (síncrono) y el
     contenido viejo se limpia, para que no aparezca un instante antes del chat.
     Si hace falta suscribirse, se deshace y vuelven las 5 opciones de abajo. */
  document.body.classList.add('chat-abierto');
  $('#dock-container').hidden = true;
  $('#comu-chats').innerHTML = '<p class="muted small comu-cargando">Cargando chat…</p>';
  /* Verificar acceso al chat y mostrar chat o suscripción */
  verificarAccesoChat().then(tieneAcceso => {
    if (tieneAcceso) {
      cargarChatGlobal();
    } else {
      document.body.classList.remove('chat-abierto');
      $('#dock-container').hidden = false;
      mostrarSuscripcionChat();
    }
  });
}

/* Verificar si el usuario tiene acceso al chat global */
async function verificarAccesoChat() {
  try {
    const data = await api('/api/comunidad/chat-acceso');
    return data.tieneAcceso;
  } catch (e) {
    return false;
  }
}

/* Mostrar la pantalla de suscripción al chat global */
function mostrarSuscripcionChat() {
  const host = $('#comu-chats');
  if (!host) return;

  const tick = '<span class="sus-tick"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>';

  host.innerHTML = `
    <div class="suscripcion-wrap">
      <section class="sus-hero">
        <div class="sus-mark" aria-hidden="true"><i></i><i></i><i></i></div>
        <h1>Más músicos</h1>
        <p class="sus-lede">Charlá con músicos de todo el país que, como vos, usan Más Música.</p>
      </section>

      <ul class="sus-benefits">
        <li>${tick}Chat con otros músicos suscritos</li>
        <li>${tick}Salas y consejos de la comunidad</li>
        <li>${tick}Cancelá cuando quieras</li>
      </ul>

      <section class="sus-plan" aria-labelledby="sus-plan-name">
        <div class="sus-plan-row">
          <span class="sus-plan-name" id="sus-plan-name">Plan mensual</span>
          <span class="sus-plan-price">$5.000<small>/ mes</small></span>
        </div>
        <button class="sus-btn" id="suscribirse-chat" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
          Suscribirme ahora
        </button>
        <p class="sus-fine">Pago seguro. Podés cancelar en cualquier momento desde tu perfil.</p>
      </section>

      <section class="sus-teaser">
        <div class="sus-teaser-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>
        </div>
        <p><strong>Mirá las salas de tu zona</strong> y armá tu banda. Buscá bajista.</p>
      </section>
    </div>`;

  const btnSuscribir = host.querySelector('#suscribirse-chat');
  if (btnSuscribir) {
    btnSuscribir.onclick = async () => {
      if (btnSuscribir.disabled) return;
      const htmlOriginal = btnSuscribir.innerHTML;
      btnSuscribir.disabled = true;
      btnSuscribir.textContent = 'Procesando…';
      try {
        const res = await api('/api/comunidad/chat-suscribirse', { method: 'POST', body: { plan: 'mensual' } });
        /* Con Mercado Pago: se abre el pago en otra pestaña y se verifica al volver. */
        if (res.pago && res.pago.url) {
          window.open(res.pago.url, '_blank', 'noopener');
          toast('Terminá el pago en la otra pestaña. Al volver, te confirmamos la suscripción.', 'ok');
          btnSuscribir.disabled = false;
          btnSuscribir.innerHTML = htmlOriginal;
          esperarPagoChat(res.solicitudId);
          return;
        }
        toast('¡Suscripción activada! Ya podés chatear.', 'ok');
        await cargarChatGlobal();
      } catch (e) {
        toast(e.message, 'error');
      } finally {
        if (btnSuscribir.isConnected && !host.querySelector('.chat-global')) {
          btnSuscribir.disabled = false;
          btnSuscribir.innerHTML = htmlOriginal;
        }
      }
    };
  }
}

/* Tras abrir el pago del chat en Mercado Pago, se consulta el estado hasta que
   se acredite (o hasta que venza el intento). */
function esperarPagoChat(solicitudId) {
  let intentos = 0;
  const max = 40;   /* ~10 minutos, cada 15 s */
  const revisar = async () => {
    intentos++;
    try {
      const acceso = await api('/api/comunidad/chat-acceso');
      if (acceso && acceso.tieneAcceso) {
        toast('¡Suscripción activada! Ya podés chatear.', 'ok');
        await cargarChatGlobal();
        return;
      }
    } catch (e) { /* se reintenta */ }
    if (intentos < max) setTimeout(revisar, 15000);
  };
  setTimeout(revisar, 4000);
}

/* ========== CHAT GLOBAL GRUPAL ========== */

const CHAT_STICKERS = [
  { id:'s1', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z" fill="currentColor" stroke="none"/></svg>' },
  { id:'s2', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.1 8.2 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.2 12 2" fill="currentColor" stroke="none"/></svg>' },
  { id:'s3', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3" fill="currentColor" stroke="none"/><circle cx="18" cy="16" r="3" fill="currentColor" stroke="none"/></svg>' },
  { id:'s4', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" fill="currentColor" stroke="none"/><circle cx="12" cy="9.5" r="2.5" fill="var(--panel)" stroke="none"/></svg>' },
  { id:'s5', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="currentColor" stroke="none"/></svg>' },
  { id:'s6', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3 6.5 7 1-5 4.8 1.2 6.9L12 17.8 5.8 21.2 7 14.3 2 9.5l7-1L12 2z" fill="currentColor" stroke="none" opacity=".85"/></svg>' },
  { id:'s7', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><circle cx="9" cy="9.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="9.5" r="1.2" fill="currentColor" stroke="none"/></svg>' },
  { id:'s8', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21.5c4.6-4.4 7.5-8 7.5-11.5a7.5 7.5 0 1 0-15 0c0 3.5 2.9 7.1 7.5 11.5z" fill="currentColor" stroke="none"/><circle cx="12" cy="9.9" r="2.6" fill="var(--panel)" stroke="none"/></svg>' },
  { id:'s9', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/></svg>' },
  { id:'s10', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="3"/></svg>' },
  { id:'s11', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/></svg>' },
  { id:'s12', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="currentColor" stroke="none"/></svg>' },
];
let chatGlobalTimer = null;
let chatGlobalUltimoFecha = 0;
let chatGlobalTotal = null;   /* cuántos mensajes hay en el servidor (para detectar borrados) */

/* Ver en el mapa la sala de una invitación del chat (centrada y con su tarjeta) */
function verSalaEnMapa(salaId) {
  const sala = (state.rooms || []).find(x => x.id === salaId);
  if (!sala) { toast('La sala ya no está disponible', 'error'); return; }
  /* Sin ubicación cargada, abrimos la ficha (ahí está la dirección) */
  if (!tieneUbicacion(sala)) { fichaSala(sala.id); return; }
  irMapa();
  setTimeout(() => {
    centrarMapa([Number(sala.lat), Number(sala.lng)], 16);
    const marca = marcasSala ? marcasSala[sala.id] : null;
    if (marca && marca.openPopup) { try { marca.openPopup(); } catch (e) {} }
    abrirTarjetaSala(sala.id);
  }, 260);
}

/* Dibuja el cuerpo de un mensaje del chat según su tipo */
function renderCuerpoChat(m) {
  if (m.tipo === 'imagen') return '<img class="chat-msg-img" src="' + esc(m.media) + '" alt="foto" loading="lazy">';
  if (m.tipo === 'video') return '<video class="chat-msg-video" src="' + esc(m.media) + '" controls preload="metadata"></video>';
  if (m.tipo === 'sticker') {
    const st = CHAT_STICKERS.find(function (s) { return s.id === m.media; });
    return '<span class="chat-msg-sticker">' + (st ? st.svg : '') + '</span>';
  }
  if (m.tipo === 'invitacion') {
    const meta = m.meta || {};
    const dir = [meta.direccion, meta.localidad].filter(Boolean).join(' · ');
    const n = Number(m.interesados || 0);
    const cuando = meta.date
      ? fmtDate(meta.date, { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + meta.start + '–' + meta.end
      : '';
    const icono = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z"/><circle cx="12" cy="11" r="2.2"/></svg>';
    const iconoCal = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></svg>';
    const grupo = m.reservaNombre ? ('«' + esc(m.reservaNombre) + '» · ') : '';
    let estado = '';
    if (m.reservaEstado === 'tentativa') estado = '<span class="ci-estado espera">' + grupo + 'Reserva pedida · esperando que la sala confirme</span>';
    else if (m.reservaEstado === 'confirmada') estado = '<span class="ci-estado ok"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg> ' + grupo + 'Reserva confirmada por la sala</span>';
    else if (m.reservaEstado === 'cancelada') estado = '<span class="ci-estado no">' + grupo + 'La sala no pudo confirmar</span>';
    /* Anotarse / desanotarse: se puede mientras la invitación siga abierta */
    const boton = (!m.reservaId || (m.reservaEstado === 'tentativa' && !m.mio))
      ? '<button type="button" class="ci-btn' + (m.interesado ? ' on' : '') + '" data-invitacion="' + esc(m.id) + '">' + (m.interesado ? 'Desanotarse' : 'Anotarse') + '</button>'
      : '';
    const botonConf = (!m.reservaId && m.mio && meta.date)
      ? '<button type="button" class="ci-btn ci-confirmar" data-confirmar-invitacion="' + esc(m.id) + '">Armar reserva tentativa</button>'
      : '';
    const botonDesistir = (m.reservaId && m.reservaEstado === 'tentativa' && m.mio)
      ? '<button type="button" class="ci-btn ci-desistir" data-desistir-invitacion="' + esc(m.id) + '">Desistir</button>'
      : '';
    const botonMapa = m.media
      ? '<button type="button" class="ci-btn ci-mapa" data-mapa-sala="' + esc(m.media) + '">' + icono + ' Ver en el mapa</button>'
      : '';
    return '<div class="chat-invitacion">' +
      '<div class="ci-encabezado">' + icono + ' Invitación a sala</div>' +
      '<div class="ci-nombre">' + esc(meta.nombre || 'Sala') + '</div>' +
      (dir ? '<div class="ci-dir">' + esc(dir) + '</div>' : '') +
      (cuando ? '<div class="ci-cuando">' + iconoCal + ' ' + esc(cuando) + '</div>' : '') +
      boton + botonConf + botonDesistir + botonMapa + estado +
      '<span class="ci-count">' + (n ? n + (n === 1 ? ' músico anotado' : ' músicos anotados') : 'Sé el primero en anotarte') + '</span>' +
      '</div>';
  }
  return m.texto ? '<p class="chat-global-texto">' + esc(m.texto) + '</p>' : '';
}

/* Cargar el chat global */
async function cargarChatGlobal() {
  const host = $('#comu-chats');
  if (!host) return;

  // Mostrar el chat global (a pantalla completa)
  host.innerHTML = `
    <div class="chat-global">
      <div class="chat-global-head">
        <button class="chat-global-volver" id="chat-global-volver" type="button" title="Volver" aria-label="Volver a Inicio"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg></button>
      </div>
      <div class="chat-global-hilo" id="chat-global-hilo"></div>
      <div class="chat-sala-picker" id="chat-sala-picker" hidden></div>
      <div class="chat-sticker-picker" id="chat-sticker-picker" hidden></div>
      <div class="chat-adj-panel" id="chat-adj-panel" hidden>
        <button class="chat-adj-op" id="chat-op-sticker" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><circle cx="9" cy="9.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="9.5" r="1.2" fill="currentColor" stroke="none"/></svg><span>Sticker</span></button>
        <button class="chat-adj-op" id="chat-op-foto" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3.5"/><circle cx="17.5" cy="8.5" r="1" fill="currentColor" stroke="none"/></svg><span>Foto</span></button>
        <button class="chat-adj-op" id="chat-op-video" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3z"/></svg><span>Video</span></button>
        <button class="chat-adj-op" id="chat-op-invitacion" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z"/><circle cx="12" cy="11" r="2.2"/></svg><span>Invitación</span></button>
      </div>
      <div class="chat-global-form">
        <button class="chat-adj-btn" id="chat-adj-btn" type="button" title="Adjuntar" aria-label="Adjuntar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
        <input type="text" id="chat-global-input" placeholder="Escribí un mensaje..." maxlength="600">
        <button class="btn btn-primary btn-sm" id="chat-global-enviar">Enviar</button>
      </div>
      <input type="file" id="chat-foto-input" accept="image/*" hidden>
      <input type="file" id="chat-video-input" accept="video/*" hidden>`;

  /* Se ocultan las 5 opciones de abajo: mientras se chatea el chat ocupa toda la pantalla */
  document.body.classList.add('chat-abierto');
  $('#dock-container').hidden = true;
  const btnVolver = $('#chat-global-volver');
  if (btnVolver) btnVolver.onclick = irInicio;

  // Cargar mensajes (desde cero: el hilo se acaba de crear de nuevo)
  chatGlobalUltimoFecha = 0;
  chatGlobalTotal = null;
  await cargarMensajesGlobal();

  // Configurar envío
  const input = $('#chat-global-input');
  const btnEnviar = $('#chat-global-enviar');

  const enviar = async () => {
    const texto = (input.value || '').trim();
    if (!texto) return;
    try {
      await api('/api/comunidad/chat-global', { method: 'POST', body: { texto } });
      input.value = '';
      await recargarChat();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  if (btnEnviar) btnEnviar.onclick = enviar;

  const panel = $('#chat-adj-panel');
  const adjBtn = $('#chat-adj-btn');
  const picker = $('#chat-sticker-picker');
  const salaPicker = $('#chat-sala-picker');
  const fotoInput = $('#chat-foto-input');
  const videoInput = $('#chat-video-input');
  const hilo = $('#chat-global-hilo');

  const cerrarPaneles = () => {
    if (panel) panel.hidden = true;
    if (picker) picker.hidden = true;
    if (salaPicker) salaPicker.hidden = true;
  };

  if (picker && !picker._ok) {
    picker._ok = true;
    picker.innerHTML = CHAT_STICKERS.map(s => '<button type="button" class="chat-sticker-item" data-sticker="' + s.id + '" aria-label="sticker">' + s.svg + '</button>').join('');
    picker.addEventListener('click', e => {
      const b = e.target.closest('[data-sticker]');
      if (!b) return;
      enviarSticker(b.dataset.sticker);
    });
  }
  if (salaPicker && !salaPicker._ok) {
    salaPicker._ok = true;
    salaPicker.addEventListener('click', e => {
      const sala = e.target.closest('[data-sala]');
      if (sala) { invSalaId = sala.dataset.sala; invDate = null; pintarSalaPicker(); return; }
      const back = e.target.closest('[data-inv-volver]');
      if (back) { invSalaId = null; invDate = null; pintarSalaPicker(); return; }
      const slot = e.target.closest('[data-slot]');
      if (slot) enviarInvitacion(invSalaId, invDate, slot.dataset.start, slot.dataset.end);
    });
    salaPicker.addEventListener('change', e => {
      const d = e.target.closest('#chat-inv-date');
      if (d) { invDate = d.value || todayStr(); pintarSalaPicker(); }
    });
  }
  if (hilo && !hilo._ok) {
    hilo._ok = true;
    hilo.addEventListener('click', async e => {
      const del = e.target.closest('[data-borrar-msg]');
      if (del) {
        if (del.disabled) return;
        del.disabled = true;
        try {
          const ok = await confirmarAccion(
            '¿Eliminar este mensaje? Se borra del chat para todos.',
            '¿Eliminar mensaje?',
            'Sí, eliminar',
            'No, dejarlo',
            'peligro'
          );
          if (!ok) { del.disabled = false; return; }
          await api('/api/comunidad/chat-global/borrar', { method: 'POST', body: { mensajeId: del.dataset.borrarMsg } });
          const fila = del.closest('.chat-global-msg');
          if (fila) fila.remove();
          if (typeof chatGlobalTotal === 'number') chatGlobalTotal = Math.max(0, chatGlobalTotal - 1);
          toast('Mensaje eliminado', 'ok');
        } catch (err) {
          toast(err.message || 'No se pudo eliminar el mensaje', 'error');
          del.disabled = false;
        }
        return;
      }
      const conf = e.target.closest('[data-confirmar-invitacion]');
      if (conf) {
        if (conf.disabled) return;
        conf.disabled = true;
        try {
          const sugerido = (yo && yo.nombre) ? ('Grupo de ' + yo.nombre) : '';
          const nombre = await pedirTextoModal({
            titulo: 'Nombre del grupo',
            texto: 'Así lo ve la sala y los músicos que se anotaron.',
            valor: sugerido,
            placeholder: 'Ej: Trío del barrio',
            aceptar: 'Armar reserva',
          });
          if (nombre === null) { conf.disabled = false; return; }
          await api('/api/comunidad/chat-global/invitacion/confirmar', { method: 'POST', body: { mensajeId: conf.dataset.confirmarInvitacion, nombre: String(nombre || '').trim() } });
          toast('Reserva tentativa pedida. La sala la tiene que confirmar.', 'ok');
          await recargarChat();
        } catch (err) {
          toast(err.message || 'No se pudo armar la reserva', 'error');
          conf.disabled = false;
        }
        return;
      }
      const des = e.target.closest('[data-desistir-invitacion]');
      if (des) {
        if (des.disabled) return;
        des.disabled = true;
        try {
          const ok = await confirmarAccion(
            '¿Desistir de esta reserva? Se avisa a la sala y a los músicos anotados.',
            '¿Desistir de la reserva?',
            'Sí, desistir',
            'No, seguir',
            'peligro'
          );
          if (!ok) { des.disabled = false; return; }
          await api('/api/comunidad/chat-global/invitacion/desistir', { method: 'POST', body: { mensajeId: des.dataset.desistirInvitacion } });
          toast('Desististe de la reserva. Podés armar otra cuando quieras.', 'ok');
          await recargarChat();
        } catch (err) {
          toast(err.message || 'No se pudo desistir', 'error');
          des.disabled = false;
        }
        return;
      }
      const mp = e.target.closest('[data-mapa-sala]');
      if (mp) { verSalaEnMapa(mp.dataset.mapaSala); return; }
      const b = e.target.closest('[data-invitacion]');
      if (!b || b.disabled) return;
      b.disabled = true;
      try {
        const r = await api('/api/comunidad/chat-global/interes', { method: 'POST', body: { mensajeId: b.dataset.invitacion } });
        const anotado = !!r.interesado;
        b.classList.toggle('on', anotado);
        b.textContent = anotado ? 'Desanotarse' : 'Anotarse';
        const card = b.closest('.chat-invitacion');
        const cnt = card && card.querySelector('.ci-count');
        const n = r.interesados || 0;
        if (cnt) cnt.textContent = n ? (n + (n === 1 ? ' músico anotado' : ' músicos anotados')) : 'Sé el primero en anotarte';
        toast(anotado ? 'Te anotaste en la invitación' : 'Te desanotaste de la invitación', 'ok');
        b.disabled = false;   /* es un interruptor: se puede volver a tocar */
      } catch (err) {
        toast(err.message || 'No se pudo anotar', 'error');
        b.disabled = false;
      }
    });
  }
  if (adjBtn) adjBtn.onclick = () => {
    const abrir = panel && panel.hidden;
    cerrarPaneles();
    if (panel && abrir) panel.hidden = false;
  };
  const opSticker = $('#chat-op-sticker');
  if (opSticker) opSticker.onclick = () => { if (panel) panel.hidden = true; if (salaPicker) salaPicker.hidden = true; if (picker) picker.hidden = !picker.hidden; };
  const opFoto = $('#chat-op-foto');
  if (opFoto && fotoInput) opFoto.onclick = () => { cerrarPaneles(); fotoInput.click(); };
  const opVideo = $('#chat-op-video');
  if (opVideo && videoInput) opVideo.onclick = () => { cerrarPaneles(); videoInput.click(); };
  const opInvitacion = $('#chat-op-invitacion');
  if (opInvitacion) opInvitacion.onclick = () => { if (panel) panel.hidden = true; if (picker) picker.hidden = true; abrirSalaPicker(); };

  if (fotoInput) {
    fotoInput.onchange = () => {
      const f = fotoInput.files && fotoInput.files[0];
      fotoInput.value = '';
      if (f) enviarFoto(f);
    };
  }
  if (videoInput) {
    videoInput.onchange = () => {
      const f = videoInput.files && videoInput.files[0];
      videoInput.value = '';
      if (f) enviarVideo(f);
    };
  }

  let invSalaId = null, invDate = null;
  function abrirSalaPicker() {
    if (!salaPicker) return;
    invSalaId = null;
    invDate = null;
    pintarSalaPicker();
  }
  function pintarSalaPicker() {
    if (!salaPicker) return;
    if (!invSalaId) {
      const salas = salasPublicas();
      if (miUbicacion) {
        salas.sort((a, b) => distKm(miUbicacion[0], miUbicacion[1], Number(a.lat), Number(a.lng)) - distKm(miUbicacion[0], miUbicacion[1], Number(b.lat), Number(b.lng)));
      }
      if (!salas.length) {
        salaPicker.innerHTML = '<p class="muted small" style="padding:10px">No hay salas para invitar.</p>';
        salaPicker.hidden = false;
        return;
      }
      salaPicker.innerHTML = '<div class="chat-sala-titulo">Elegí una sala para invitar</div><div class="chat-sala-lista">' +
        salas.map(s => {
          const dir = [s.direccion, s.localidad].filter(Boolean).join(' · ');
          const dist = miUbicacion ? ' · a ' + distKm(miUbicacion[0], miUbicacion[1], Number(s.lat), Number(s.lng)).toFixed(1) + ' km' : '';
          return '<button type="button" class="chat-sala-item" data-sala="' + esc(s.id) + '"><span class="cs-nombre">' + esc(s.name || 'Sala') + '</span><span class="cs-dir">' + esc(dir + dist) + '</span></button>';
        }).join('') + '</div>';
      salaPicker.hidden = false;
      return;
    }
    const sala = state.rooms.find(r => r.id === invSalaId) || {};
    if (!invDate) invDate = todayStr();
    const { slots } = slotsFor(invDate, invSalaId);
    const libres = slots.filter(s => s.status === 'available');
    const max = (function () { const d = new Date(); d.setDate(d.getDate() + 7); const m = String(d.getMonth() + 1).padStart(2, '0'); const dd = String(d.getDate()).padStart(2, '0'); return d.getFullYear() + '-' + m + '-' + dd; })();
    salaPicker.innerHTML = '<div class="chat-sala-titulo">' + esc(sala.name || 'Sala') + '</div>' +
      '<label class="chat-inv-fecha">Día <input type="date" id="chat-inv-date" value="' + invDate + '" min="' + todayStr() + '" max="' + max + '"></label>' +
      '<div class="chat-slot-grid">' + (libres.length
        ? libres.map(s => '<button type="button" class="chat-slot" data-slot data-start="' + esc(s.start) + '" data-end="' + esc(s.end) + '">' + esc(s.start) + '–' + esc(s.end) + '</button>').join('')
        : '<p class="muted small">No hay horarios libres ese día.</p>') +
      '</div>' +
      '<button type="button" class="btn btn-sm" data-inv-volver><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg> Cambiar sala</button>';
    salaPicker.hidden = false;
  }

  if (input) {
    input.onkeydown = e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        enviar();
      }
    };
  }

  async function enviarFoto(file) {
    if (!file || !/^image\//.test(file.type)) { toast('Ese archivo no es una imagen', 'error'); return; }
    try {
      const dataUrl = await comprimirImagen(file, 900);
      await api('/api/comunidad/chat-global', { method: 'POST', body: { tipo: 'imagen', media: dataUrl } });
      if (input) input.value = '';
      await recargarChat();
    } catch (e) { toast(e.message || 'No se pudo enviar la foto', 'error'); }
  }
  async function enviarSticker(id) {
    try {
      await api('/api/comunidad/chat-global', { method: 'POST', body: { tipo: 'sticker', media: id } });
      cerrarPaneles();
      await recargarChat();
    } catch (e) { toast(e.message || 'No se pudo enviar el sticker', 'error'); }
  }
  async function enviarVideo(file) {
    if (!file || !/^video\//.test(file.type)) { toast('Ese archivo no es un video', 'error'); return; }
    if (file.size > 15 * 1024 * 1024) { toast('El video es muy pesado (máximo 15 MB)', 'error'); return; }
    const dur = await duracionVideo(file);
    if (Number.isFinite(dur) && dur > 16) { toast('El video puede durar hasta 15 segundos', 'error'); return; }
    try {
      const dataUrl = await leerDataUrl(file);
      await api('/api/comunidad/chat-global', { method: 'POST', body: { tipo: 'video', media: dataUrl } });
      if (input) input.value = '';
      await recargarChat();
    } catch (e) { toast(e.message || 'No se pudo enviar el video', 'error'); }
  }
  async function enviarInvitacion(salaId, date, start, end) {
    const nota = input ? input.value.trim() : '';
    try {
      await api('/api/comunidad/chat-global', { method: 'POST', body: { tipo: 'invitacion', media: salaId, fecha: date, desde: start, hasta: end, texto: nota } });
      if (input) input.value = '';
      invSalaId = null; invDate = null;
      cerrarPaneles();
      await recargarChat();
    } catch (e) { toast(e.message || 'No se pudo enviar la invitación', 'error'); }
  }
  // Polling para nuevos mensajes
  clearInterval(chatGlobalTimer);
  chatGlobalTimer = setInterval(() => {
    if (!$('#comu-chats')?.querySelector('.chat-global')) return;
    cargarMensajesGlobal(true);
  }, 3000);
}

/* Cargar mensajes del chat global */
async function recargarChat() {
  const hilo = $('#chat-global-hilo');
  if (!hilo) return;
  hilo.innerHTML = '';
  chatGlobalUltimoFecha = 0;
  await cargarMensajesGlobal(true);
}

async function cargarMensajesGlobal(silent) {
  const hilo = $('#chat-global-hilo');
  if (!hilo) return;

  try {
    const data = await api('/api/comunidad/chat-global?desde=' + chatGlobalUltimoFecha);
    const mensajes = data.mensajes || [];

    /* Si alguien borró un mensaje, el total del servidor baja: se refresca el hilo entero */
    if (typeof data.total === 'number') {
      if (chatGlobalTotal !== null && data.total < chatGlobalTotal) {
        chatGlobalTotal = data.total;
        return recargarChat();
      }
      chatGlobalTotal = data.total;
    }

    if (!silent && !mensajes.length) {
      hilo.innerHTML = '<p class="muted small" style="text-align:center;padding:20px">Todavía no hay mensajes. Sé el primero en escribir <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></p>';
      return;
    }

    if (mensajes.length) {
      // Agregar solo mensajes nuevos
      mensajes.forEach(m => {
        if (chatGlobalUltimoFecha >= m.fecha) return;
        const div = document.createElement('div');
        div.className = 'chat-global-msg' + (m.mio ? ' mio' : '');
        var avatarHtml = m.mio ? "" : "<div class=\"chat-global-avatar\">" + String((m.autor && m.autor.nombre) || "?").charAt(0).toUpperCase() + "</div>";
        /* El autor puede borrar su mensaje, salvo una invitación con reserva en curso */
        const puedeBorrar = m.mio && !(m.tipo === 'invitacion' && (m.reservaEstado === 'tentativa' || m.reservaEstado === 'confirmada'));
        div.innerHTML = `
          ${avatarHtml}
          <div class="chat-global-contenido">
            ${m.mio ? '' : `<span class="chat-global-autor">${esc(m.autor?.nombre || 'Músico')}</span>`}
            ${renderCuerpoChat(m)}
            ${m.tipo !== 'texto' && m.texto ? '<p class="chat-global-texto">' + esc(m.texto) + '</p>' : ''}
            <div class="chat-global-pie">
              <span class="chat-global-fecha">${fechaChat(m.fecha)}</span>
              ${puedeBorrar ? `<button type="button" class="chat-global-borrar" data-borrar-msg="${esc(m.id)}" title="Eliminar mensaje" aria-label="Eliminar mensaje">${ICO_SVG.basura}</button>` : ''}
            </div>
          </div>`;
        hilo.appendChild(div);
        chatGlobalUltimoFecha = m.fecha;
      });

      // Scroll al final
      hilo.scrollTop = hilo.scrollHeight;
    }
  } catch (e) {
    if (!silent) toast(e.message, 'error');
  }
}

/* Formato de fecha para el chat */
function fechaChat(ts) {
  const d = new Date(ts);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return d.toDateString() === new Date().toDateString() ? `hoy · ${hm}` : `${d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })} · ${hm}`;
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
  if (!yo) { pantallaAuth('inicio'); return; }
  document.body.classList.add('app-activa');
  $('#view-auth').hidden = true;
  $('#app-header').hidden = false;
  $('#dock-container').hidden = false;
  $('#view-public').hidden = false;
  actualizarBarraSesion();
  pintarInstagram();
}

/* Re-verificar sesión (usado al inicio y tras login) */
async function verificarSesion() {
  if (!token) return false;
  try {
    const data = await api('/api/auth/me');
    if (data && data.user) {
      yo = data.user;
      miSala = data.room || null;
      adminMode = esSuper();
      return true;
    }
  } catch (e) {
    /* Solo borrar la sesión si el servidor dice explícitamente que el token es inválido.
       Si fue un error de red (sin conexión, timeout, etc.), mantenemos el token para
       no sacar al usuario de la app al volver de Mercado Pago o al recargar. */
    if (e && e.status === 401) { guardarToken(''); yo = null; }
  }
  return false;
}

/* Arrancar la app con sesión activa */
function arrancarApp() {
  document.body.classList.add('app-activa');
  setNav('inicio');
  mostrarApp();
  renderCalendar();
  renderRooms();
  goStep(1);
  renderMapa();
  cargarNotificaciones().then(() => { pintarBadgeNotif(); });
}

/* Mostrar pantalla de login */
function mostrarLogin() {
  document.body.classList.remove('app-activa');
  $('#view-auth').hidden = false;
  $('#app-header').hidden = true;
  $('#dock-container').hidden = true;
  pantallaAuth('inicio');
  if (typeof wireAuth === 'function') wireAuth();
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
  clearInterval(chatGlobalTimer);
  chatGlobalTimer = null;
  document.body.classList.remove('chat-abierto');
  ['view-public', 'view-mine', 'view-panel', 'view-admin', 'view-mapa', 'view-comunidad', 'view-auth']
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
  /* El dueño de sala no tiene mapa de salas (ni la pestaña ni el botón de la lista) */
  const naMapa = $('#nav-reservar');
  if (naMapa) naMapa.hidden = esDueño();
  const bVerMapa = $('#btn-ver-mapa');
  if (bVerMapa) bVerMapa.hidden = esDueño();
  /* Si es admin o dueño, el botón de Comunidad se oculta (ya venía hidden) */
  if (!yo) {
    $('#btn-notif').hidden = true;
    $('#btn-ajustes').hidden = true;
    const bPanel = $('#btn-panel');
    if (bPanel) bPanel.hidden = true;
    const chipSala = $('#btn-sala-logo');
    if (chipSala) chipSala.hidden = true;
    return;
  }
  const bPanel = $('#btn-panel');
  if (bPanel) bPanel.hidden = !esDueño();
  actualizarAccionesHeader();
}

/* Dentro del Perfil la campana se cambia por el engranaje de Ajustes */
function actualizarAccionesHeader() {
  $('#btn-ajustes').hidden = !yo || $('#view-mine').hidden;
  $('#btn-notif').hidden = !yo || !$('#view-mine').hidden;
  if (yo && $('#view-mine').hidden) pintarBadgeNotif();
  renderHeaderSalaLogo();
}

/* Mi sala: su logo arriba en la barra, al lado del de Instagram (solo el dueño, si subió logo) */
function renderHeaderSalaLogo() {
  const b = $('#btn-sala-logo');
  if (!b) return;
  const sala = miSala || ((esDueño() && state) ? (state.rooms || []).find(r => r.ownerId === yo.id) : null);
  if (!sala || !sala.foto) { b.hidden = true; b.innerHTML = ''; return; }
  b.hidden = false;
  b.title = 'Mi sala: ' + (sala.name || '');
  b.innerHTML = `<img src="${esc(sala.foto)}" alt="${esc(sala.name || 'Mi sala')}">`;
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
  const vol = '<button class="btn btn-sm btn-ghost auth-volver" data-vista="inicio"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg> Volver</button>';

  if (vista === 'inicio') {
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
        <p class="auth-terminos">Al usar Más Música aceptás los
          <a class="link-term" href="terminos.html" target="_blank" rel="noopener">términos y condiciones</a>,
          la <a class="link-term" href="privacidad.html" target="_blank" rel="noopener">política de privacidad</a>
          y los <a class="link-term" href="precios.html" target="_blank" rel="noopener">precios</a>.
        </p>
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
    const wa = String(c.whatsapp || '').replace(/[^\d]/g, '');
    if (wa) botones.push(`<a class="btn btn-sm" target="_blank" rel="noopener" href="https://wa.me/${esc(wa)}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/></svg> WhatsApp</a>`);
    if (c.facebook) botones.push(`<a class="btn btn-sm" target="_blank" rel="noopener" href="https://www.facebook.com/${esc(limpiarIdentRed(c.facebook))}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg> Facebook</a>`);
    if (c.tiktok) botones.push(`<a class="btn btn-sm" target="_blank" rel="noopener" href="https://www.tiktok.com/@${esc(limpiarIdentRed(c.tiktok))}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg> TikTok</a>`);
    if (c.email) botones.push(`<a class="btn btn-sm" href="mailto:${esc(c.email)}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> Email</a>`);
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
            <div class="sala-foto-edit" id="mu-preview">${fotoTemporal ? `<img src="${fotoTemporal}" alt="previsualización">` : '<span class="sala-chip-foto" style="width:60px;height:60px;font-size:1.6rem"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></span>'}</div>
            <div class="auth-foto-txt">
              <label class="btn btn-sm"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> Foto de perfil<input type="file" id="mu-foto" accept="image/*" hidden></label>
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
          <label class="check"><input type="checkbox" id="mu-terms"> <span>Acepto los <a class="link-term" href="terminos.html" target="_blank" rel="noopener">términos y condiciones</a> y la <a class="link-term" href="privacidad.html" target="_blank" rel="noopener">política de privacidad</a></span></label>
          <button class="btn btn-primary btn-block btn-lg" type="submit">Crear mi cuenta</button>
        </form>
        <p class="auth-cuenta">¿Olvidaste tu contraseña o tu cuenta está bloqueada?
          <button type="button" class="auth-link" data-vista="ayuda">Pedí ayuda</button>
        </p>
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
            <label class="check"><input type="checkbox" id="du-terms"> <span>Acepto los <a class="link-term" href="terminos.html" target="_blank" rel="noopener">términos y condiciones</a> y la <a class="link-term" href="privacidad.html" target="_blank" rel="noopener">política de privacidad</a></span></label>
            <button class="btn btn-primary btn-block btn-lg" type="submit">Continuar <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></button>
          </form>
          <p class="auth-cuenta">¿Olvidaste tu contraseña o tu cuenta está bloqueada?
            <button type="button" class="auth-link" data-vista="ayuda">Pedí ayuda</button>
          </p>` : `
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
              <button type="button" class="btn btn-sm" data-accion-ubicacion="ubicar"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg> Ubicar en el mapa</button>
              <button type="button" class="btn btn-sm" data-accion-ubicacion="buscar"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Buscar por dirección</button>
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
              <div class="sala-foto-edit" id="sa-preview">${fotoTemporal ? `<img src="${fotoTemporal}" alt="previsualización">` : '<span class="sala-chip-foto" style="width:60px;height:60px;font-size:1.6rem"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg></span>'}</div>
              <div class="auth-foto-txt">
                <label class="btn btn-sm"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg> Logo de la sala<input type="file" id="sa-logo" accept="image/*" hidden></label>
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
        toast('Ubicación puesta', 'ok');
      });
    } else if (accion === 'buscar') {
      buscarDireccion($('#sa-direccion').value + ' ' + $('#sa-loc').value).then(p => {
        if (!p) return;
        $('#sa-lat').value = p.lat.toFixed(5);
        $('#sa-lng').value = p.lng.toFixed(5);
        toast('Dirección encontrada', 'ok');
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
        if (!$('#du-terms').checked) { toast('Tenés que aceptar los términos y condiciones', 'warn'); return; }
        datosDuenio = {
          nombre: $('#sg-nombre').value.trim(),
          usuario: $('#sg-usuario').value.trim().toLowerCase(),
          email: $('#sg-email').value.trim(),
          telefono: $('#sg-tel').value.trim(),
          password: $('#sg-pass').value,
          aceptaTerminos: true,
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
  if (!$('#mu-terms').checked) { toast('Tenés que aceptar los términos y condiciones', 'warn'); return; }
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
      aceptaTerminos: true,
    },
  });
  fotoTemporal = '';
  await iniciarSesionConToken(data);
  toast('¡Bienvenido a Más Música!', 'ok');
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
      aceptaTerminos: !!(datosDuenio && datosDuenio.aceptaTerminos),
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
  toast(data.mensaje || 'Pedido enviado', 'ok');
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
  arrancarApp();
  renderMine();
}

async function cerrarSesion() {
  const okSalir = await confirmarAccion(
    '¿Cerrar sesión?',
    'Cerrar sesión',
    'Sí, salir',
    'No, quedarme',
    'peligro'
  );
  if (!okSalir) return;
  try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) { /* sin conexión */ }
  guardarToken('');
  yo = null; miSala = null; notificaciones = []; sinLeer = 0;
  adminMode = false; adminPin = '';
  $('#btn-exit-admin').hidden = true;
  cerrarPanelAjustes();
  cerrarPanelNotif();
  closeModal();
  mostrarLogin();
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

/* ---------- Notificaciones (panel) ---------- */
let notifFiltro = 'todas'; /* 'todas' | 'sin-leer' */

function renderPanelNotif() {
  const bod = $('#notif-sheet-body');
  const sub = $('#notif-sheet-sub');
  if (!bod) return;

  /* Subtítulo */
  sub.textContent = notificaciones.length
    ? (sinLeer ? `${sinLeer} sin leer · ${notificaciones.length} en total` : `${notificaciones.length} aviso(s)`)
    : 'Nada por acá todavía';

  /* Tabs */
  const tabs = document.querySelectorAll('#notif-tabs .notif-tab');
  tabs.forEach(t => {
    t.classList.toggle('active', t.dataset.notifTab === notifFiltro);
    t.setAttribute('aria-selected', t.dataset.notifTab === notifFiltro ? 'true' : 'false');
  });

  /* Botones de acción */
  $('#notif-panel-leer').hidden = !sinLeer;
  $('#notif-panel-borrar-todas').hidden = !notificaciones.length;

  /* Filtrar */
  const lista = notificaciones.filter(n => notifFiltro !== 'sin-leer' || !n.leida);

  /* Renderizar: la campana ya no muestra promociones, solo avisos */
  bod.innerHTML = (lista.length
    ? lista.map(itemNotif).join('')
    : `<div class="notif-vacio"><div class="notif-vacio-icon"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></div><h3>Todo al día</h3><p>Aquí aparecerán tus nuevas reservas y avisos.</p></div>`);
}

function itemNotif(n) {
  const icono = n.tipo === 'ok' ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>' : n.tipo === 'warn' ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>';
  const cls = n.leida ? '' : 'unread';
  return `
  <article class="notif-card ${cls}" data-notif-id="${n.id}" role="button" tabindex="0">
    <div class="notif-icon" aria-hidden="true">${icono}</div>
    <div class="notif-content">
      <div class="notif-row-top">
        <h4 class="notif-title">${esc(n.titulo)}</h4>
        <span class="notif-time">${fechaNotif(n.fecha)}</span>
      </div>
      <p class="notif-detail">${esc(n.texto)}</p>
      <div class="notif-card-actions">
        ${n.leida ? '' : `<button class="notif-link" data-leer-notif="${n.id}">Marcar como leída</button>`}
      </div>
    </div>
    <button class="notif-dismiss" aria-label="Borrar aviso" data-borrar-notif="${n.id}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
  </article>`;
}

/* Promociones y novedades de la administración (se gestionan en sus paneles) */
function promosActivas() {
  const ahora = Date.now();
  return (state.promociones || []).filter(p => p.activa !== false
    && (!p.desde || p.desde <= ahora) && (!p.hasta || p.hasta >= ahora));
}

function abrirPromo(id) {
  const p = (state.promociones || []).find(x => x.id === id);
  if (!p) return;
  /* Promos de registro  panel de administración (super admin) */
  if (/registro|registr/i.test(p.titulo || '') && esSuper()) {
    cerrarPanelNotif();
    showAdmin();
    return;
  }
  /* Promos de bienvenida  solo cerrar, no navegar */
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
  const chip = n.tipo === 'ok' ? '<span class="notif-chip ok"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span>'
    : n.tipo === 'warn' ? '<span class="notif-chip warn"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>'
      : '<span class="notif-chip info">!</span>';
  return `<div class="notif-item ${n.leida ? '' : 'nueva'}" data-notif-id="${n.id}" role="button" tabindex="0" title="Ver la reserva">
    ${chip}
    <div class="notif-txt">
      <strong>${esc(n.titulo)}</strong>
      <span>${esc(n.texto)}</span>
      <small class="${n.leida ? 'muted' : ''}">${fechaNotif(n.fecha)}</small>
    </div>
    <button class="notif-borrar" data-borrar-notif="${n.id}" title="Borrar aviso" aria-label="Borrar aviso"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
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

/* Marcar una notificación como leída */
async function marcarUnaNotif(id) {
  const n = notificaciones.find(x => x.id === id);
  if (!n || n.leida) return;
  n.leida = true;
  sinLeer = notificaciones.filter(x => !x.leida).length;
  renderPanelNotif();
  pintarBadgeNotif();
}

/* Borrar una notificación individual (sin confirmar, con animación de cierre) */
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
    sinLeer = 0;
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
    /* Swipe horizontal  borrar */
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

  /* Swipe hacia arriba en el panel  cerrar */
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

  /* Avisos dirigidos al dueño de una sala  su panel de administración, pestaña Reservas */
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

  /* Avisos de reservas propias  "Mis reservas" filtradas (próximas / historial) */
  if (r) {
    irReservasFiltradas(/cancelada/i.test(n.titulo || '') ? 'historial' : 'proximas');
    setTimeout(() => resaltarReserva(r.id, '#home-mine-body'), 180);
    return;
  }

  /* Avisos de pedido de ayuda  panel de administración, pestaña Ayuda */
  if (/pedido de ayuda/i.test(n.titulo || '') && esSuper()) {
    window.__ayuda = null;      /* fuerza recargar los pedidos */
    showAdmin();
    renderAdminTab('ayuda');
    return;
  }

  /* Avisos de nuevo registro  panel de administración */
  if (/registro|registr/i.test(n.titulo || '') && esSuper()) {
    showAdmin();
    return;
  }

  /* Avisos de cuenta / perfil / bienvenida  solo mostrar, no navegar, se borran solos */
  if (/bienvenido/i.test(n.titulo || '')) {
    const itemEl = document.querySelector(`[data-notif-id="${n.id}"]`);
    borrarNotificacion(n.id, itemEl);
    cerrarPanelNotif();
    return;
  }

  /* Otros avisos sin reserva  Inicio */
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
      <div class="user-avatar aj-avatar">${yo.foto ? `<img src="${esc(yo.foto)}" alt="${esc(yo.nombre)}">` : esDueño() && miSala && miSala.foto ? `<img src="${esc(miSala.foto)}" alt="${esc(miSala.name || yo.nombre)}">` : esc((yo.nombre || '?').trim().charAt(0).toUpperCase())}</div>
      <div class="aj-cuenta-txt">
        <strong>${esc(yo.nombre)}</strong>
        <span>@${esc(yo.usuario)}${yo.localidad ? ' · ' + esc(yo.localidad) : ''}</span>
        <span class="aj-badges">
          <span class="badge">${esDueño() ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg> Dueño de sala' : esSuper() ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7l4 4 6-7 6 7 4-4-2 12H4z"/></svg> Administración general' : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg> Músico'}</span>
          ${miSala ? `<span class="badge ${miSala.estado === 'aprobada' ? '' : 'badge-next'}">Sala: ${esc(miSala.name)} · ${miSala.estado}</span>` : ''}
        </span>
      </div>
    </div>

    <div class="perfil-stats">
      <div class="perfil-stat"><strong>${nReservas}</strong><span>Reservas</span></div>
      ${esCuentaControl() ? '' : `<div class="perfil-stat"><strong>${nFavoritas}</strong><span>Favoritas</span></div>`}
      <div class="perfil-stat"><strong>${nBandas}</strong><span>Bandas</span></div>
    </div>

    <div class="row wrap" style="gap:12px;margin-bottom:14px">
      <button class="aj-editar" id="btn-editar-perfil"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg> Editar perfil</button>
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
      ${esCuentaControl() ? '' : `<div class="aj-row aj-dato">${svgAj(ICO_AJ.nota)}
        <span class="aj-txt">Instrumentos<small>${instrumentos || 'No agregaste ninguno'}</small></span>
      </div>`}
      <div class="aj-row aj-dato">${svgAj(ICO_AJ.cal)}
        <span class="aj-txt">Cuenta creada<small>${yo.creado ? fechaCorta(yo.creado) : '—'}</small></span>
      </div>
    </div>`;

  if (esCuentaControl()) {
    fav.hidden = true;
    fav.innerHTML = '';
  } else {
    const salones = salasPublicas().filter(r => (yo.favoritos || []).includes(r.id));
    fav.hidden = false;
    fav.innerHTML = `
    <div class="panel-head"><h2><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path fill="currentColor" d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg> Mis salas favoritas</h2>
      <button class="btn btn-sm" id="fav-ver">Ver salas</button>
    </div>
    ${salones.length
      ? `<div class="mini-fotos">${salones.map(r => `<button class="fav-item" data-ir-sala="${r.id}">
          ${r.foto ? `<img src="${esc(r.foto)}" alt="">` : '<span class="sala-chip-foto"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></span>'}
          <span>${esc(r.name)}<small>${fmtMoney(r.price)}/h</small></span></button>`).join('')}</div>`
      : '<p class="muted small">Todavía no guardaste ninguna sala. Tocá el <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg> en una sala para guardarla acá.</p>'}`;
  }

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
    <div class="sala-foto-edit" id="pe-preview">${yo.foto ? `<img src="${esc(yo.foto)}" alt="">` : '<span class="sala-chip-foto" style="width:60px;height:60px;font-size:1.6rem"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></span>'}</div>
    <label>Nueva foto de perfil<input type="file" id="pe-foto" accept="image/*"></label>
    <div class="row">
      <button class="btn btn-primary" id="pe-guardar"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Guardar cambios</button>
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
      toast('Perfil actualizado', 'ok');
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
  irInicio();   /* "Mis reservas" vive en el Inicio */
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
  toast(`Tema ${nombre} activo`, 'ok');
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
      toast('Contraseña actualizada', 'ok');
    } catch (e) {
      btn.disabled = false;
      toast(e.message, 'error');
    }
  };
}

/* ---------- Ayuda y contacto ---------- */
function modalAyuda() {
  const h = (state.settings.reglas && state.settings.reglas.cancelacionHoras) || 0;
  const c = (state.settings && state.settings.contacto) || {};
  const ico = (path, size = 17) =>
    `<svg class="ayuda-ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  const icoIg = `<svg class="ayuda-ico" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="2.5" y="2.5" width="19" height="19" rx="5.2"></rect>
          <circle cx="12" cy="12" r="4.1"></circle>
          <line x1="17.4" y1="6.6" x2="17.4" y2="6.61"></line></svg>`;
  const icoFb = `<svg class="ayuda-ico" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M15 3h-2.2A4.3 4.3 0 0 0 8.5 7.3V10H6.2v3.6h2.3V21h3.7v-7.4h2.6l.7-3.6h-3.3V7.6c0-.7.3-1.1 1.2-1.1H15z"></path></svg>`;

  /* Canales de contacto cargados en Ajustes: los vacíos no se muestran */
  const canales = [];
  const wa = String(c.whatsapp || '').replace(/[^\d]/g, '');
  if (wa) canales.push(`<a class="btn btn-sm" target="_blank" rel="noopener" href="https://wa.me/${esc(wa)}">${ico(ICO_AJ.telefono)} WhatsApp</a>`);
  if (c.email) canales.push(`<a class="btn btn-sm" href="mailto:${esc(c.email)}">${ico(ICO_AJ.buzon)} Email</a>`);
  if (c.instagram) canales.push(`<a class="btn btn-sm" target="_blank" rel="noopener" href="https://www.instagram.com/${esc(limpiarIdentRed(c.instagram))}">${icoIg} Instagram</a>`);
  if (c.facebook) canales.push(`<a class="btn btn-sm" target="_blank" rel="noopener" href="https://www.facebook.com/${esc(limpiarIdentRed(c.facebook))}">${icoFb} Facebook</a>`);
  if (c.tiktok) canales.push(`<a class="btn btn-sm" target="_blank" rel="noopener" href="https://www.tiktok.com/@${esc(limpiarIdentRed(c.tiktok))}">${ico(ICO_AJ.nota)} TikTok</a>`);

  openModal(`
    <h3>Ayuda y contacto</h3>
    <ul class="ayuda-lista">
      <li><strong>1. Elegí la fecha</strong> en el Inicio, después la sala y el horario. Los horarios ocupados aparecen tachados.</li>
      <li><strong>2. Confirmá la reserva</strong> con el nombre de tu banda o el tuyo. Si te pide una seña, la abonás en ese paso y el saldo lo pagás en la sala.</li>
      <li><strong>3. Seguí el aviso</strong> en "Mis avisos": la reserva queda guardada en "Mis reservas" con todos los datos.</li>
      <li><strong>4. ¿Necesitás cancelar?</strong> Desde "Mis reservas" ${h ? `hasta ${h} horas antes` : 'antes de que empiece el ensayo'} del horario reservado. Al cancelar, el horario se libera.</li>
      <li><strong>5. ¿Cómo llego o hablo con la sala?</strong> Abrila desde el Mapa y usá "Ver en el mapa", "Google Maps" o "Llamar".</li>
      <li><strong>6. ¿Alquilás un instrumento?</strong> Marcalo en el paso de confirmación y se suma a tu reserva.</li>
      <li><strong>7. Comunidad</strong> Con la suscripción al Chat Global podés chatear con otros músicos, invitar a una fecha y anotarte.</li>
    </ul>
    ${canales.length ? `
      <p class="ayuda-contacto-tit">¿Te falta algo? Escribinos por:</p>
      <div class="row wrap ayuda-contacto">${canales.join('')}</div>` : ''}
    <p class="muted small">Si no podés entrar a tu cuenta, usá "Pedí ayuda" en la pantalla de acceso: la administración recibe tu mensaje.</p>
    <div class="row wrap">
      <button class="btn btn-primary" onclick="modalTerminos()">Términos y condiciones</button>
      <button class="btn" onclick="closeModal()">Entendido</button>
    </div>`);
}

/* ---------- Términos y condiciones ---------- */
/* El texto completo vive en terminos.html: es una página pública, también para
   quien todavía no tiene cuenta. Desde acá la abrimos en otra pestaña. */
function modalTerminos() {
  const v = window.open('terminos.html', '_blank');
  if (!v) location.href = 'terminos.html';
}
function modalPrivacidad() {
  const v = window.open('privacidad.html', '_blank');
  if (!v) location.href = 'privacidad.html';
}
function modalPrecios() {
  const v = window.open('precios.html', '_blank');
  if (!v) location.href = 'precios.html';
}

/* ---------- Panel del dueño de la sala ---------- */
let panelTab = 'inicio';
let panelDatos = null;
let panelLogoTmp = '';
let panelPortadaTmp = '';
let panelFotosTmp = [];
/* Catálogo de equipos de la sala que se está editando en el panel (se guarda junto con la sala) */
let panelCatalogo = [];

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

/* El logo de la sala, arriba en el encabezado del panel (si no hay, queda el ícono ) */
function renderPanelLogo() {
  const box = $('#panel-head-logo');
  if (!box) return;
  const sala = (panelDatos && panelDatos.room) || miSala || {};
  box.innerHTML = sala.foto
    ? `<img src="${esc(sala.foto)}" alt="${esc(sala.name || 'Mi sala')}">`
    : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>';
}

function renderPanelTab(tab) {
  panelTab = tab;
  $$('.admin-tab[data-ptab]').forEach(b => b.classList.toggle('active', b.dataset.ptab === tab));
  ['inicio', 'sala', 'disponibilidad', 'reservas', 'movimientos', 'datos'].forEach(t => { $('#ptab-' + t).hidden = t !== tab; });
  if (!panelDatos) return;
  renderPanelLogo();
  renderPanelEstado();
  ({ inicio: renderPanelInicio, sala: renderPanelSala, disponibilidad: renderPanelDisponibilidad, reservas: renderPanelReservas, movimientos: renderPanelMovimientos, datos: renderPanelDatos }[tab])();
}

/* Reseñas de la sala, para la tarjeta de inicio del panel */
function panelResenasSala() {
  const id = panelDatos && panelDatos.room ? panelDatos.room.id : (miSala && miSala.id);
  if (!id) return '';
  const lista = resenasDeSala(id);
  const p = puntajeDe(id);
  const cuerpo = lista.length
    ? `<div class="inicio-puntaje">${estrellasHTML(p.promedio)}<b>${p.promedio.toFixed(1)}</b>
         <span class="muted small">· ${lista.length} reseña${lista.length === 1 ? '' : 's'}</span></div>
       <ul class="inicio-prox">${lista.slice(0, 4).map(x => `
         <li><span class="nom">${estrellasHTML(x.estrellas)} ${esc(x.usuario || 'músico')}</span>
             <span class="sala">${esc(String(x.texto || '').slice(0, 90))}</span></li>`).join('')}</ul>`
    : '<p class="muted small">Todavía no hay reseñas. Las escriben los músicos que reservaron en tu sala.</p>';
  return `<section class="inicio-card">
      <h3>Reseñas de tu sala</h3>
      ${cuerpo}
    </section>`;
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
      ${panelResenasSala()}
    </div>`;

  cont.onclick = e => {
    const g = e.target.closest('[data-goto-ptab]');
    if (g) return renderPanelTab(g.dataset.gotoPtab);
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
      <button class="btn btn-primary btn-sm" data-descargar-mes><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg> Descargar Excel</button>
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
  toast('Archivo descargado', 'ok');
}

function renderPanelEstado() {
  const s = panelDatos.resumen || {};
  const r = panelDatos.room;
  const estado = r.estado === 'aprobada'
    ? '<span class="badge"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/></svg> Publicada</span>'
    : r.estado === 'pendiente'
      ? '<span class="badge badge-next"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Pendiente de aprobación</span>'
      : '<span class="badge badge-past"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> ' + esc(r.estado) + '</span>';
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
  ubicacionManual = false;
  ubicacionIntentada = '';
  $('#ps-name').value = r.name || '';
  $('#ps-price').value = r.price || 0;
  $('#ps-descripcion').value = r.descripcion || '';
  $('#ps-direccion').value = r.direccion || '';
  $('#ps-numero').value = r.numero || '';
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
  const cob = r.cobro || {};
  $('#ps-cobro-titular').value = cob.titular || '';
  $('#ps-cobro-banco').value = cob.banco || '';
  $('#ps-cobro-alias').value = cob.alias || '';
  $('#ps-cobro-cvu').value = cob.cvu || '';
  panelLogoTmp = '';
  panelPortadaTmp = '';
  panelFotosTmp = [];
  /* Catálogo de equipos: arranca con lo guardado; se edita acá y se guarda con "Guardar sala" */
  panelCatalogo = (r.catalogo || []).map(x => Object.assign({}, x));
  $('#ps-preview-logo').innerHTML = r.foto ? `<img src="${esc(r.foto)}" alt="">` : '<span class="sala-chip-foto" style="width:60px;height:60px;font-size:1.6rem"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg></span>';
  $('#ps-portada-preview').innerHTML = r.fotoPortada
    ? `<img src="${esc(r.fotoPortada)}" alt="Foto horizontal de ${esc(r.name)}">`
    : '<span>Sin foto horizontal</span>';
  renderFotosPanel();
  renderCatalogoPanel();
  /* Si escribió la dirección pero todavía no está en el mapa, la ubicamos sola */
  autoUbicarSala();
}

function renderFotosPanel() {
  const r = panelDatos.room;
  $('#ps-fotos-grid').innerHTML = (r.fotos || []).map((f, i) => `
    <div class="mini-foto"><img src="${esc(f.foto)}" alt="">
      <button class="btn btn-sm btn-danger" data-quitar-foto="${i}">Quitar</button></div>`).join('');
}

/* ---------- Catálogo de equipos (panel del dueño) ---------- */
function renderCatalogoPanel() {
  const cont = $('#ps-catalogo');
  if (!cont) return;
  if (!panelCatalogo.length) {
    cont.innerHTML = '<p class="muted small">Todavía no cargaste equipos. Podés agregarlos uno por uno con foto y precio de alquiler.</p>';
    return;
  }
  cont.innerHTML = panelCatalogo.map((it, i) => `
    <div class="catalogo-item" data-cat="${i}">
      <div class="catalogo-item-head">
        <strong>${esc(it.nombre || 'Equipo sin nombre')}</strong>
        <div class="res-actions">
          <button class="btn btn-sm" data-cat-edit="${i}">Editar</button>
          <button class="btn btn-sm btn-danger" data-cat-del="${i}">Quitar</button>
        </div>
      </div>
      <div class="catalogo-item-info">
        ${it.foto ? `<img class="catalogo-item-foto" src="${esc(it.foto)}" alt="${esc(it.nombre)}">` : ''}
        <div>
          ${it.descripcion ? `<div>${esc(it.descripcion)}</div>` : ''}
          ${it.alquiler ? `<div class="muted small">${ICO_SVG.precio} En alquiler · ${fmtMoney(it.precioAlquiler)}/hora</div>` : '<div class="muted small">Solo equipamiento de la sala</div>'}
        </div>
      </div>
    </div>`).join('');
}

/* Formulario para agregar o editar un equipo del catálogo. La foto se puede
   subir como archivo (se guarda como data URL hasta que se guarde la sala).
   `lista` y `alGuardar` permiten reutilizarlo desde el panel del dueño; `alVolver`
   lo usa la cuenta madre para volver al formulario de la sala al guardar. */
function formularioEquipoCatalogo(indice, lista, alGuardar, alVolver) {
  const items = lista || panelCatalogo;
  const refrescar = alGuardar || renderCatalogoPanel;
  const volver = alVolver || null;
  const editar = indice != null && indice >= 0;
  const it = editar ? items[indice] : { nombre: '', descripcion: '', foto: '', alquiler: false, precioAlquiler: 0 };
  openModal(`
    <h3>${editar ? 'Editar equipo' : 'Nuevo equipo'}</h3>
    <label>Nombre *<input id="ce-nombre" maxlength="60" value="${esc(it.nombre)}" placeholder="Ej.: Batería completa"></label>
    <label>Descripción<input id="ce-desc" maxlength="200" value="${esc(it.descripcion)}" placeholder="Ej.: Pearl Export 5 piezas + platillos"></label>
    <div class="catalogo-foto-edit" id="ce-foto-preview">${it.foto ? `<img src="${esc(it.foto)}" alt="">` : '<span class="muted small">Sin foto</span>'}</div>
    <label>Foto del equipo<input type="file" id="ce-foto" accept="image/*"></label>
    <label class="check"><input type="checkbox" id="ce-alquiler" ${it.alquiler ? 'checked' : ''}> <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10H4z"/><path d="M9 6V4a3 3 0 0 1 6 0v2"/><path d="M9 14h6"/></svg> Se puede alquilar a los músicos</label>
    <label>Precio del alquiler por hora<input type="number" id="ce-precio" min="0" step="1" value="${it.precioAlquiler || 0}"></label>
    <div class="row">
      <button class="btn btn-primary" id="ce-save">Guardar</button>
      <button class="btn" id="ce-cancel">Cancelar</button>
    </div>`);
  let fotoTmp = it.foto || '';
  $('#ce-foto').onchange = e => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 3 * 1024 * 1024) { toast('La foto no puede superar los 3 MB', 'warn'); e.target.value = ''; return; }
    const fr = new FileReader();
    fr.onload = () => {
      fotoTmp = fr.result;
      $('#ce-foto-preview').innerHTML = `<img src="${esc(fotoTmp)}" alt="">`;
    };
    fr.readAsDataURL(f);
  };
  $('#ce-save').onclick = () => {
    const nombre = $('#ce-nombre').value.trim();
    if (!nombre) { toast('Poné un nombre al equipo', 'warn'); return; }
    const nuevo = {
      id: (editar && it.id) || '',
      nombre,
      descripcion: $('#ce-desc').value.trim(),
      foto: fotoTmp,
      alquiler: $('#ce-alquiler').checked,
      precioAlquiler: Number($('#ce-precio').value) || 0,
    };
    if (editar) items[indice] = nuevo;
    else items.push(nuevo);
    closeModal();
    if (volver) volver();
    else refrescar();
    toast('Equipo listo. Se guarda con "Guardar sala".', 'ok');
  };
  $('#ce-cancel').onclick = () => { closeModal(); if (volver) volver(); };
}

/* ---------- Ubicación de la sala en el mapa ----------
   Con la dirección escrita alcanza: buscamos el punto (Google si hay clave, si no
   OpenStreetMap) y guardamos latitud/longitud, así la sala ya figura en el mapa
   sin tener que ubicarla a mano. */
let ubicacionManual = false;   /* el dueño ubicó el punto a mano en esta edición */
let ubicacionIntentada = '';   /* sala ya intentada (evita reintentos en bucle) */

function direccionDeLaSala() {
  const calle = [$('#ps-direccion').value.trim(), $('#ps-numero').value.trim()].filter(Boolean).join(' ');
  const completa = [calle, $('#ps-localidad').value.trim()].filter(Boolean).join(', ');
  return completa || $('#ps-mapa').value.trim();
}

/* Dirección completa de una sala (calle + número + localidad) para mostrar y buscar */
function salaDireccionCompleta(r) {
  if (!r) return '';
  const calle = [r.direccion, r.numero].filter(Boolean).join(' ');
  return [calle, r.localidad].filter(Boolean).join(', ');
}

/* Busca la dirección y deja el punto en el formulario (no guarda).
   Devuelve 'exacta' si encontró la dirección, 'aprox' si solo se ubicó por la
   localidad y false si no se pudo ubicar. */
async function resolverUbicacionSala() {
  const dir = direccionDeLaSala();
  if (dir.length < 4) return false;
  const p = await buscarDireccion(dir);
  if (p) {
    $('#ps-lat').value = p.lat.toFixed(5);
    $('#ps-lng').value = p.lng.toFixed(5);
    return 'exacta';
  }
  /* Si no aparece la calle (nombre raro o sin altura), la ubicamos al menos
     en la localidad: así la sala aparece en el mapa y el dueño ajusta el punto. */
  const loc = $('#ps-localidad').value.trim();
  if (loc.length >= 3 && loc.toLowerCase() !== dir.toLowerCase()) {
    const q = await buscarDireccion(loc);
    if (q) {
      $('#ps-lat').value = q.lat.toFixed(5);
      $('#ps-lng').value = q.lng.toFixed(5);
      return 'aprox';
    }
  }
  return false;
}
const AVISO_UBICACION_APROX = 'Quedó en el centro de tu localidad <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> Ajustala con "Ubicar en el mapa".';

/* Al abrir la ficha de la sala: si ya hay dirección pero todavía no hay punto, la
   ubicamos y la guardamos, así aparece en el mapa sin hacer nada más. */
function autoUbicarSala() {
  const r = panelDatos && panelDatos.room;
  if (!r || ubicacionManual || tieneUbicacion(r)) return;
  if (ubicacionIntentada === r.id) return;
  if (direccionDeLaSala().length < 4) return;
  ubicacionIntentada = r.id;
  (async () => {
    if (!await resolverUbicacionSala()) return;
    try {
      const data = await api('/api/panel/sala', {
        method: 'PUT',
        body: { roomId: r.id, lat: $('#ps-lat').value, lng: $('#ps-lng').value },
      });
      state = data.state;
      r.lat = Number($('#ps-lat').value);
      r.lng = Number($('#ps-lng').value);
      miSala = state.rooms.find(x => x.id === r.id) || miSala;
      renderPanelEstado();
      toast('Listo: tu sala ya figura en el mapa', 'ok');
    } catch (e) { /* si falla, queda para cuando toque Guardar */ }
  })();
}

async function guardarPanelSala() {
  /* Con la dirección escrita y sin punto (o si cambió la dirección) ubicamos la
     sala antes de guardar, para que quede en el mapa. */
  const _r = panelDatos && panelDatos.room;
  const _dir = direccionDeLaSala();
  const _hayPunto = $('#ps-lat').value.trim() !== '' && $('#ps-lng').value.trim() !== '';
  const _dirPrevia = _r ? salaDireccionCompleta(_r) : '';
  if (!ubicacionManual && _dir.length >= 4 && (!_hayPunto || _dir !== _dirPrevia)) {
    await resolverUbicacionSala();
  }
  const fotos = (panelDatos.room.fotos || []).map(f => ({ titulo: f.titulo, foto: f.foto }));
  fotos.push(...panelFotosTmp);
  const body = {
    roomId: panelDatos.room.id,
    name: $('#ps-name').value.trim(),
    price: Number($('#ps-price').value),
    capacity: Number($('#ps-capacity').value),
    descripcion: $('#ps-descripcion').value.trim(),
    direccion: $('#ps-direccion').value.trim(),
    numero: $('#ps-numero').value.trim(),
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
    catalogo: panelCatalogo,
    cobro: {
      titular: $('#ps-cobro-titular').value.trim(),
      banco: $('#ps-cobro-banco').value.trim(),
      alias: $('#ps-cobro-alias').value.trim(),
      cvu: $('#ps-cobro-cvu').value.trim(),
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
    renderHeaderSalaLogo();
    toast('Sala guardada', 'ok');
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
    toast('Horarios guardados', 'ok');
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
        <strong>${fmtDate(r.date, { weekday: 'short', day: 'numeric', month: 'short' })} ${r.estado === 'cancelada' ? '<span class="badge badge-past">Cancelada</span>' : r.estado === 'tentativa' ? '<span class="badge badge-warn">Tentativa · chat</span>' : r.date >= hoy ? '<span class="badge badge-next">Próxima</span>' : ''}</strong>
        <div>${esc(r.name)}${r.phone ? ' · <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg> ' + esc(r.phone) : ''}</div>
        ${r.estado === 'tentativa' ? '<div class="muted small">Pidió reservar desde el Chat Global · confirmá o rechazá</div>' : ''}
        ${(r.alquiler || []).length ? `<div class="muted small"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10H4z"/><path d="M9 6V4a3 3 0 0 1 6 0v2"/><path d="M9 14h6"/></svg> ${r.alquiler.map(a => esc(a.nombre)).join(', ')}</div>` : ''}
      </div>
      <div class="res-price">${fmtMoney((toMin(r.end) - toMin(r.start)) / 60 * panelDatos.room.price)}</div>
      <div class="res-actions">
        ${r.estado === 'tentativa'
          ? `<button class="btn btn-sm btn-primary" data-confirmar-res="${r.id}">Confirmar</button><button class="btn btn-sm btn-danger" data-rechazar-res="${r.id}">Rechazar</button>`
          : `<button class="btn btn-sm" data-editar-res="${r.id}">Editar</button>${r.estado !== 'cancelada' ? `<button class="btn btn-sm btn-danger" data-cancelar-res="${r.id}">Cancelar</button>` : ''}`}
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
  $('#pd-preview').innerHTML = yo.foto ? `<img src="${esc(yo.foto)}" alt="">` : '<span class="sala-chip-foto" style="width:60px;height:60px;font-size:1.6rem"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></span>';
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
    toast('Datos guardados', 'ok');
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
    ubicacionManual = true;
    $('#ps-lat').value = p.lat.toFixed(5);
    $('#ps-lng').value = p.lng.toFixed(5);
    toast('Ubicación puesta. Guardá los cambios para publicarla en el mapa.', 'ok');
  };
  /* Si el dueño escribe las coordenadas a mano, se respeta su punto */
  $('#ps-lat').oninput = () => { ubicacionManual = true; };
  $('#ps-lng').oninput = () => { ubicacionManual = true; };
  $('#ps-buscar-direccion').onclick = async () => {
    const dir = $('#ps-direccion').value.trim() + ' ' + $('#ps-localidad').value.trim();
    const p = await buscarDireccion(dir);
    if (!p) return;
    $('#ps-lat').value = p.lat.toFixed(5);
    $('#ps-lng').value = p.lng.toFixed(5);
    if (!$('#ps-mapa').value) $('#ps-mapa').value = p.nombre.slice(0, 300);
    toast('Dirección located Guardá los cambios.', 'ok');
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
      toast('Foto horizontal lista Guardá los cambios.', 'ok');
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
  /* Catálogo de equipos: agregar, editar y quitar (se guarda con "Guardar sala") */
  $('#btn-catalogo-add').onclick = () => formularioEquipoCatalogo(null);
  $('#ps-catalogo').onclick = e => {
    const ed = e.target.closest('[data-cat-edit]');
    if (ed) return formularioEquipoCatalogo(Number(ed.dataset.catEdit));
    const del = e.target.closest('[data-cat-del]');
    if (del) {
      const i = Number(del.dataset.catDel);
      panelCatalogo.splice(i, 1);
      renderCatalogoPanel();
      toast('Equipo quitado. Se guarda con "Guardar sala".', 'ok');
      return;
    }
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
    const cf = e.target.closest('[data-confirmar-res]');
    if (cf) {
      const okConf = await confirmarAccion(
        '¿Confirmar esta reserva tentativa? Se le avisa a los músicos del chat.',
        '¿Confirmar reserva?',
        'Sí, confirmar',
        'No',
        'ok'
      );
      if (!okConf) return;
      try {
        const data = await api(`/api/panel/reserva/${cf.dataset.confirmarRes}?roomId=${encodeURIComponent(panelDatos.room.id)}`, { method: 'POST' });
        state = data.state;
        await cargarPanel();
        renderPanelTab('reservas');
        toast('Reserva confirmada', 'ok');
      } catch (err) { toast(err.message, 'error'); }
      return;
    }
    const cx = e.target.closest('[data-cancelar-res]') || e.target.closest('[data-rechazar-res]');
    if (!cx) return;
    const esTentativa = !!cx.dataset.rechazarRes;
    const okCancel = await confirmarAccion(
      esTentativa ? '¿Rechazar esta reserva pedida por el chat? Se le avisa al grupo.' : '¿Cancelar esta reserva? Se le avisa al músico.',
      esTentativa ? '¿Rechazar reserva?' : '¿Cancelar reserva?',
      esTentativa ? 'Sí, rechazar' : 'Sí, cancelar',
      'No, mantener',
      'peligro'
    );
    if (!okCancel) return;
    try {
      const id = cx.dataset.cancelarRes || cx.dataset.rechazarRes;
      const data = await api(`/api/panel/reserva/${id}?roomId=${encodeURIComponent(panelDatos.room.id)}`, { method: 'DELETE' });
      state = data.state;
      await cargarPanel();
      renderPanelTab('reservas');
      toast(esTentativa ? 'Reserva rechazada' : 'Reserva cancelada', 'ok');
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
    <p class="muted small">${esc(r.name)}${r.phone ? ' · <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg> ' + esc(r.phone) : ''}</p>
    <div class="row">
      <button class="btn btn-primary" id="pr-ok"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Guardar</button>
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
      toast('Reserva actualizada', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  };
}

/* ---------- Catálogo de equipos por sala (dentro de la ficha) ---------- */
function fotoEquipo(it) {
  return it.foto
    ? `<img src="${esc(it.foto)}" alt="${esc(it.nombre)}" onerror="this.parentElement.classList.add('inst-sin-foto');this.remove()">`
    : '<span class="inst-emoji"></span>';
}

/* Catálogo de la sala: los equipos con foto/descripción y los que se alquilan. */
function catalogoSalaHTML(r) {
  const items = (r.catalogo || []).filter(x => x && x.nombre);
  if (!items.length) return '';
  const equipos = items.filter(x => !x.alquiler);
  const alquiler = items.filter(x => x.alquiler);
  const tarjeta = it => `
    <article class="inst-card${it.alquiler ? ' alquiler-card' : ''}">
      <div class="inst-photo">${fotoEquipo(it)}</div>
      <h3>${esc(it.nombre)}</h3>
      ${it.descripcion ? `<p class="muted">${esc(it.descripcion)}</p>` : ''}
      ${it.alquiler ? `<div class="alquiler-precio">${fmtMoney(it.precioAlquiler)}<span> / hora</span></div>` : ''}
    </article>`;
  return `
    ${equipos.length ? `<h4 class="ficha-titulo">${ICO_SVG.musica}Equipos de la sala</h4>
      <div class="inst-grid ficha-catalogo">${equipos.map(tarjeta).join('')}</div>` : ''}
    ${alquiler.length ? `<h4 class="ficha-titulo">${ICO_SVG.precio}Se alquilan (por hora)</h4>
      <div class="inst-grid ficha-catalogo">${alquiler.map(tarjeta).join('')}</div>` : ''}`;
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
  /* Sala actual (esquina superior): tocar abre sus horarios */
  $('#sala-actual').onclick = () => elegirSala(sel.roomId);
  /* Barra inferior: 5 opciones */
  const ACCIONES_NAV = {
    inicio: irInicio,
    salas: irSalas,
    mapa: irMapa,
    comunidad: () => irComunidad(),
    perfil: irMisReservas,
    admin: () => (esSuper() ? showAdmin() : enterAdmin()),
    panel: () => { mostrarPanel(); setNav('panel'); },
  };
  $$('#dock-container [data-nav]').forEach(b => {
    b.onclick = () => ACCIONES_NAV[b.dataset.nav]();
  });
  const inpBuscar = $('#home-search');
  if (inpBuscar) inpBuscar.oninput = e => { busquedaMine = e.target.value; renderMineRapido(); };
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
  /* Panel de notificaciones: cerrar con , el fondo o la tecla Escape */
  $('#notif-panel-cerrar').onclick = cerrarPanelNotif;
  $('#notif-backdrop').onclick = cerrarPanelNotif;
  $('#notif-panel-leer').onclick = marcarLeidasPanel;
  $('#notif-panel-borrar-todas').onclick = borrarTodasNotificaciones;
  /* Tocar una notificación lleva a la reserva correspondiente */
  $('#notif-sheet-body').onclick = e => {
    const borrar = e.target.closest('[data-borrar-notif]');
    if (borrar) {
      e.stopPropagation();
      const card = borrar.closest('.notif-item');
      return borrarNotificacion(borrar.dataset.borrarNotif, card);
    }
    const leer = e.target.closest('[data-leer-notif]');
    if (leer) {
      e.stopPropagation();
      return marcarUnaNotif(leer.dataset.leerNotif);
    }
    const pr = e.target.closest('[data-promo-id]');
    if (pr) return abrirPromo(pr.dataset.promoId);
    const it = e.target.closest('.notif-item[data-notif-id]');
    if (it) irANotificacion(it.dataset.notifId);
  };
  $('#notif-sheet-body').onkeydown = e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const pr = e.target.closest('[data-promo-id]');
    if (pr) { e.preventDefault(); return abrirPromo(pr.dataset.promoId); }
    const it = e.target.closest('.notif-item[data-notif-id]');
    if (it) { e.preventDefault(); irANotificacion(it.dataset.notifId); }
  };
  /* Tabs de notificaciones (Todas / Sin leer) */
  $('#notif-tabs').onclick = e => {
    const tab = e.target.closest('.notif-tab');
    if (!tab) return;
    notifFiltro = tab.dataset.notifTab;
    renderPanelNotif();
    prepararSwipeNotif();
  };
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if ($('#notif-drop').classList.contains('open')) return cerrarPanelNotif();
    if ($('#ajustes-drop').classList.contains('open')) return cerrarPanelAjustes();
  });
  /* Panel de ajustes: cerrar con , el fondo o Escape */
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
  const btnSalaLogo = $('#btn-sala-logo');
  if (btnSalaLogo) btnSalaLogo.onclick = mostrarPanel;
  /* Resumen del Inicio: solo el acceso para iniciar sesión */
  $('#inicio-resumen').onclick = e => {
    if (e.target.closest('#sum-login')) return pantallaAuth('login');
  };
  $('#home-mine-body').onclick = async e => {
    if (e.target.closest('#filtro-mine-clear')) {
      filtroMisReservas = '';
      renderMineRapido();
      return;
    }
    const pg = e.target.closest('[data-mine-pagar]');
    if (pg) {
      const r = state.reservations.find(x => x.id === pg.dataset.minePagar);
      if (r) {
        pg.disabled = true;
        await pagarSenaDesde(r);
        if (document.body.contains(pg)) pg.disabled = false;
      }
      return;
    }
    const b = e.target.closest('[data-mine-cancel]');
    if (!b) {
      const el = e.target.closest('[data-mine-eliminar]');
      if (el) {
        const r = state.reservations.find(x => x.id === el.dataset.mineEliminar);
        if (!r) return;
        const yaPaso = esPasada(r);
        const queEs = yaPaso ? 'esta reserva pasada' : 'esta reserva cancelada';
        const okRes = await confirmarAccion(
          `¿Eliminar ${queEs} del historial? No se puede deshacer.`,
          '¿Eliminar reserva?',
          'Sí, eliminar',
          'No, mantener',
          'peligro'
        );
        if (!okRes) return;
        try {
          const data = await api(`/api/reservations/${r.id}`, { method: 'DELETE' });
          state = data.state;
          mineIds = mineIds.filter(id => id !== r.id);
          localStorage.setItem(MINE_KEY, JSON.stringify(mineIds));
          renderMineRapido();
          renderMine();
          toast('Reserva eliminada del historial.', 'ok');
        } catch (err) {
          toast(err.message, 'error');
        }
        return;
      }
      return;
    }
    const r = state.reservations.find(x => x.id === b.dataset.mineCancel);
    if (!r) return;
    const okRes = await confirmarAccion(
      `¿Cancelar tu reserva del ${fmtDate(r.date)} ${r.start} – ${r.end}? El horario quedará libre.`,
      '¿Cancelar reserva?',
      'Sí, cancelar',
      'No, mantener',
      'peligro'
    );
    if (!okRes) return;
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
    <h3><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Panel de administración</h3>
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
    <h3><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg> PIN de administrador</h3>
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
  document.body.classList.add('admin-abierto');
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
  document.body.classList.remove('admin-abierto');
  ocultarVistas();
  $('#view-public').hidden = false;
  $('#btn-exit-admin').hidden = true;
  actualizarBarraSesion();
  setNav('inicio');
  renderCalendar();
  renderRooms();
  goStep(1);
}

const TABS_ADMIN = ['inicio', 'solicitudes', 'usuarios', 'ayuda', 'reservas', 'historial', 'salas', 'horarios', 'bloqueos', 'estadisticas', 'promociones', 'pagos', 'ajustes', 'bandas'];

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
    promociones: renderPromocionesAdmin,
    pagos: renderPagosAdmin,
    ajustes: renderAjustes,
    bandas: renderBandasAdmin,
  }[tab])();
  /* La pestaña Salas necesita la lista de cuentas para mostrar el dueño de cada sala */
  if (tab === 'salas' && esSuper() && !(window.__usuarios && window.__usuarios.length)) {
    asegurarUsuarios().then(() => { if (currentAdminTab === 'salas') renderSalasAdmin(); });
  }
  const pend = (state.rooms || []).filter(r => r.estado === 'pendiente').length;
  const pill = $('#pill-solicitudes');
  if (pill) { pill.hidden = !pend; pill.textContent = pend; }
  const pendAyuda = (window.__ayuda || []).filter(a => a.estado === 'pendiente').length;
  const pillAy = $('#pill-ayuda');
  if (pillAy) { pillAy.hidden = !pendAyuda; pillAy.textContent = pendAyuda; }
  actualizarIndicadorAdmin(tab);
}

/* Indicador deslizante bajo las pestañas del admin */
function actualizarIndicadorAdmin(tab) {
  const cont = document.querySelector('.admin-tabs');
  if (!cont) return;
  let indicator = cont.querySelector('.admin-tab-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.className = 'admin-tab-indicator';
    cont.style.position = 'relative';
    cont.appendChild(indicator);
  }
  const btn = [...cont.querySelectorAll('.admin-tab')].find(t => t.dataset.tab === tab);
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  const rc = cont.getBoundingClientRect();
  indicator.style.width = r.width + 'px';
  indicator.style.transform = `translateX(${r.left - rc.left + cont.scrollLeft}px)`;

  /* Centrar la pestaña activa en la barra (auto-scroll) */
  const scrollObjetivo = btn.offsetLeft - (cont.clientWidth - btn.offsetWidth) / 2;
  cont.scrollTo({ left: Math.max(0, scrollObjetivo), behavior: 'smooth' });
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

  /* Estadísticas */
  const nPend = listaSolicitudes.filter(r => r.estado === 'pendiente').length;
  const nAprob = listaSolicitudes.filter(r => r.estado === 'aprobada').length;
  const nRech = listaSolicitudes.filter(r => r.estado === 'rechazada' || r.estado === 'suspendida').length;
  const elP = $('#sol-stat-pend'); if (elP) elP.textContent = nPend;
  const elA = $('#sol-stat-aprob'); if (elA) elA.textContent = nAprob;
  const elR = $('#sol-stat-rech'); if (elR) elR.textContent = nRech;
  const elT = $('#sol-c-todas'); if (elT) elT.textContent = listaSolicitudes.length;
  const elCP = $('#sol-c-pend'); if (elCP) elCP.textContent = nPend;
  const elCA = $('#sol-c-aprob'); if (elCA) elCA.textContent = nAprob;
  const elCR = $('#sol-c-rech'); if (elCR) elCR.textContent = nRech;

  const lista = listaSolicitudes.filter(r => filtroSolicitudes === 'todas' || r.estado === filtroSolicitudes);
  const orden = { pendiente: 0, rechazada: 1, suspendida: 2, aprobada: 3 };
  lista.sort((a, b) => (orden[a.estado] - orden[b.estado]) || ((b.solicitud && b.solicitud.fecha) - (a.solicitud && a.solicitud.fecha)));

  /* Contador */
  const elCont = $('#sol-contador');
  if (elCont) elCont.textContent = `${lista.length} de ${listaSolicitudes.length}`;

  /* Estado vacío */
  const elVacio = $('#sol-vacio');
  if (elVacio) elVacio.hidden = lista.length > 0;

  const CLASE_ESTADO = { pendiente: 'sol-pendiente', aprobada: 'sol-aprobada', rechazada: 'sol-rechazada', suspendida: 'sol-rechazada' };
  const PILL_ESTADO = { pendiente: 'Pendiente', aprobada: 'Aprobada', rechazada: 'Rechazada', suspendida: 'Suspendida' };

  cont.innerHTML = lista.length ? lista.map(r => `
    <article class="sol-req ${CLASE_ESTADO[r.estado] || ''}">
      <div class="sol-req-top">
        <div>
          <h3>${esc(r.name)}</h3>
          <p class="sol-req-meta">${esc([r.localidad, [r.direccion, r.numero].filter(Boolean).join(' ')].filter(Boolean).join(' · '))} · <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> ${r.capacity}</p>
          <p class="sol-req-meta">Enviada por ${r.duenio ? '@' + esc(r.duenio.usuario) : '—'}${r.solicitud && r.solicitud.fecha ? ' · ' + fechaCorta(r.solicitud.fecha) : ''}</p>
          ${r.descripcion ? `<p class="sol-req-desc">${esc(r.descripcion)}</p>` : ''}
        </div>
        <span class="sol-pill">${PILL_ESTADO[r.estado] || r.estado}</span>
      </div>
      ${r.estado === 'pendiente' ? `
      <div class="sol-req-actions">
        <button class="btn ghost" data-sol-no="${r.id}">Rechazar</button>
        <button class="btn ok" data-sol-ok="${r.id}">Aprobar</button>
      </div>` : ''}
    </article>`).join('') : '';
}

async function accionSolicitud(id, accion, motivo) {
  try {
    const data = await api(`/api/admin/solicitudes/${id}`, { method: 'PUT', body: { accion, motivo } });
    state = data.state;
    listaSolicitudes = null;
    renderAdminTab('solicitudes');
    renderRooms();
    toast(
      accion === 'aprobar' ? 'Sala aprobada y publicada <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>' :
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

  const ROL = { USER: { label: 'Músico', emoji: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>', cls: 'musico' }, ROOM_ADMIN: { label: 'Dueño de sala', emoji: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>', cls: 'sala' }, SUPER_ADMIN: { label: 'Admin', emoji: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7l4 4 6-7 6 7 4-4-2 12H4z"/></svg>', cls: 'admin' } };

  /* Contadores por rol */
  const counts = { '': window.__usuarios.length };
  window.__usuarios.forEach(u => { counts[u.rol] = (counts[u.rol] || 0) + 1; });

  /* Chips de filtro */
  const chips = $('#usuarios-chips');
  if (chips) {
    const items = [['', 'Todos'], ['USER', 'Músicos'], ['ROOM_ADMIN', 'Dueños'], ['SUPER_ADMIN', 'Admin']];
    chips.innerHTML = items.map(([k, label]) =>
      `<button class="cuentas-chip${filtroUsuarios === k ? ' active' : ''}" data-filtro-usuarios="${k}">${label} ${counts[k] || 0}</button>`
    ).join('');
  }

  /* Filtrar y buscar */
  const q = ($('#usuarios-buscar') || {}).value || '';
  const qNorm = q.trim().toLowerCase();
  const lista = window.__usuarios.filter(u =>
    (!filtroUsuarios || u.rol === filtroUsuarios) &&
    (!qNorm || (u.nombre + ' ' + u.usuario + ' ' + u.email).toLowerCase().includes(qNorm))
  );

  /* Contador */
  const elCont = $('#usuarios-contador');
  if (elCont) elCont.textContent = `${lista.length} de ${window.__usuarios.length}`;

  /* Vacío */
  const elVacio = $('#usuarios-vacio');
  if (elVacio) elVacio.hidden = lista.length > 0;

  /* Renderizar tarjetas */
  cont.innerHTML = lista.length ? lista.map(u => {
    const r = ROL[u.rol] || { label: u.rol, emoji: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>', cls: '' };
    const isAdmin = u.rol === 'SUPER_ADMIN';
    const blocked = u.bloqueado;
    const off = u.activo === false;
    const statusPill = blocked ? '<span class="cuentas-pill off">Bloqueada</span>'
      : off ? '<span class="cuentas-pill off">Desactivada</span>'
      : `<span class="cuentas-pill ${r.cls}">${r.emoji} ${r.label}</span>`;
    const meta = [
      u.email && `<span><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> ${esc(u.email)}</span>`,
      u.telefono && `<span><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg> ${esc(u.telefono)}</span>`,
      u.localidad && `<span><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> ${esc(u.localidad)}</span>`,
    ].filter(Boolean).join(' ');

    return `
      <article class="cuentas-card" data-id="${u.id}">
        <div class="cuentas-card-top">
          <div class="cuentas-avatar ${r.cls}">${esc((u.nombre||'?')[0].toUpperCase())}</div>
          <div class="cuentas-who">
            <h3>${esc(u.nombre)}</h3>
            <p>@${esc(u.usuario)}</p>
          </div>
          ${statusPill}
        </div>
        ${meta ? `<div class="cuentas-meta">${meta}</div>` : ''}
        <div class="cuentas-actions">
          <select class="cuentas-rol" aria-label="Cambiar rol de ${esc(u.nombre)}" data-user-rol="${u.id}" ${isAdmin ? 'disabled' : ''}>
            ${Object.entries(ROL).filter(([k]) => k !== 'SUPER_ADMIN').map(([k, v]) =>
              `<option value="${k}" ${u.rol === k ? 'selected' : ''}>${v.label}</option>`).join('')}
          </select>
          <button class="btn btn-sm" data-user-bloquear="${u.id}" ${isAdmin ? 'disabled' : ''}>${blocked ? 'Desbloquear' : 'Bloquear'}</button>
          <button class="btn btn-sm btn-danger" data-user-borrar="${u.id}" ${isAdmin ? 'disabled' : ''}>Eliminar</button>
        </div>
      </article>`;
  }).join('') : '';
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

async function accionUsuario(id, accion, nuevoRol) {
  const u = (window.__usuarios || []).find(x => x.id === id);
  if (!u) return;
  try {
    if (accion === 'borrar') {
      const okEliminar = await confirmarAccion(
        `¿Eliminar la cuenta de ${u.nombre}? Se borra su historial de reservas.`,
        '¿Eliminar cuenta?',
        'Sí, eliminar',
        'No, mantener',
        'peligro'
      );
      if (!okEliminar) return;
      const data = await api(`/api/admin/usuarios/${id}`, { method: 'DELETE', admin: true });
      state = data.state;
    } else if (accion === 'bloquear') {
      const data = await api(`/api/admin/usuarios/${id}`, { method: 'PUT', admin: true, body: { bloqueado: !u.bloqueado } });
      state = data.state;
    } else if (accion === 'rol') {
      const rol = nuevoRol || u.rol;
      if (rol === u.rol) return;
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
  const MOTIVOS = { olvide: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg> Olvidé mi contraseña', bloqueada: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Cuenta bloqueada/desactivada', otro: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Otro problema' };
  const fechaCorta = t => new Date(t).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const pendientes = lista.filter(a => a.estado === 'pendiente');
  const resueltos = lista.filter(a => a.estado === 'resuelta');
  if (!lista.length) {
    cont.innerHTML = '<p class="muted">Todavía no hay pedidos de ayuda. Cuando alguien no pueda entrar, aparece acá (y te avisa el timbre <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>).</p>';
    return;
  }
  const tarjeta = a => `<div class="panel ayuda-item ${a.estado === 'resuelta' ? 'ayuda-resuelta' : ''}">
    <div class="ayuda-head">
      <strong>${MOTIVOS[a.motivo] || '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Otro problema'}</strong>
      <span class="muted small">${fechaCorta(a.fecha)}</span>
    </div>
    <p><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> <strong>${esc(a.ident)}</strong>
      ${a.cuenta ? ` — <span class="muted small">cuenta encontrada: @${esc(a.cuenta.usuario)} (${esc(a.cuenta.nombre)})${a.cuenta.email ? ' · ' + esc(a.cuenta.email) : ''}${a.cuenta.bloqueado ? ' · <span class="badge badge-past">bloqueada</span>' : a.cuenta.activo === false ? ' · <span class="badge badge-past">desactivada</span>' : ''}</span>` : '<span class="muted small">(cuenta no encontrada con ese dato)</span>'}
    </p>
    ${a.mensaje ? `<p class="ayuda-msj">“${esc(a.mensaje)}”</p>` : ''}
    <div class="row wrap">
      ${a.estado === 'pendiente' && a.cuenta && (a.cuenta.bloqueado || a.cuenta.activo === false) && a.cuenta.rol !== 'SUPER_ADMIN'
        ? `<button class="btn btn-sm" data-ayuda-desbloquear="${a.id}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg> Desbloquear cuenta</button>` : ''}
      ${a.estado === 'pendiente' && a.cuenta && a.cuenta.rol !== 'SUPER_ADMIN'
        ? `<button class="btn btn-sm" data-ayuda-clave="${a.id}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg> Dar contraseña nueva</button>` : ''}
      ${a.estado === 'pendiente' ? `<button class="btn btn-sm btn-ghost" data-ayuda-resolver="${a.id}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg> Marcar resuelto</button>` : ''}
      ${a.estado === 'resuelta' ? '<span class="muted small"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg> Resuelto' + (a.resuelta ? ' el ' + fechaCorta(a.resuelta) : '') + '</span>' : ''}
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
      toast('Cuenta desbloqueada y pedido resuelto', 'ok');
    } else {
      toast('Pedido marcado como resuelto', 'ok');
    }
    await cargarAyuda();
  } catch (e) { toast(e.message, 'error'); }
}

/* Contraseña temporal legible para pasarle a quien no puede entrar */
function claveTemporalUsuario() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

/* La administración le da una contraseña nueva a la cuenta del pedido; el músico la cambia al entrar */
async function darClaveDesdeAyuda(id) {
  const a = (window.__ayuda || []).find(x => x.id === id);
  if (!a || !a.cuenta || !a.cuenta.id) return toast('Ese pedido no tiene una cuenta asociada', 'error');
  const nueva = await pedirTextoModal({
    titulo: 'Contraseña nueva',
    texto: `Para <b>@${esc(a.cuenta.usuario)}</b> (mínimo 6 caracteres). La persona la usa para entrar.`,
    valor: claveTemporalUsuario(),
    aceptar: 'Guardar'
  });
  if (nueva === null) return;
  const clave = String(nueva).trim();
  if (clave.length < 6) return toast('La contraseña debe tener al menos 6 caracteres', 'error');
  try {
    await api('/api/admin/usuarios/' + a.cuenta.id, { method: 'PUT', admin: true, body: { password: clave } });
  } catch (e) { return toast(e.message, 'error'); }
  /* Al darle una clave nueva, el pedido queda resuelto */
  try { await api('/api/admin/ayuda', { method: 'POST', admin: true, body: { id: a.id } }); } catch (e) {}
  await mostrarClaveModal(a.cuenta.usuario, clave);
  toast('Contraseña actualizada y pedido resuelto', 'ok');
  await cargarAyuda();
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
    const extra = (r.alquiler || []).length ? ` · <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10H4z"/><path d="M9 6V4a3 3 0 0 1 6 0v2"/><path d="M9 14h6"/></svg> ${r.alquiler.map(a => esc(a.nombre)).join(', ')}` : '';
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
      toast('Reserva actualizada', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  $('#er-cancel').onclick = closeModal;
}

async function cancelarReserva(id, backTab = 'reservas') {
  const r = state.reservations.find(x => x.id === id);
  if (!r) return;
  const okCancelAdmin = await confirmarAccion(
    `¿Cancelar la reserva de "${r.name}" (${fmtDate(r.date)} ${r.start} – ${r.end})? El horario quedará libre.`,
    '¿Cancelar reserva?',
    'Sí, cancelar',
    'No, mantener',
    'peligro'
  );
  if (!okCancelAdmin) return;
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
            <div>${esc(r.name)}${r.phone ? ' · <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg> ' + esc(r.phone) : ''}</div>
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

/* ---------- Salas del admin ---------- */
let filtroSalasAdmin = '';
let querySalasAdmin = '';

function renderSalasAdmin() {
  /* Chips de filtro */
  const chips = $('#salas-chips');
  if (chips) {
    const nTodas = state.rooms.length;
    const nAprob = state.rooms.filter(r => r.estado === 'aprobada').length;
    const nPend = state.rooms.filter(r => r.estado === 'pendiente').length;
    const nSinDueno = state.rooms.filter(r => !r.ownerId).length;
    const filtros = [
      ['', 'Todas', nTodas],
      ['aprobada', 'Aprobadas', nAprob],
      ['pendiente', 'Pendientes', nPend],
      ['sin-dueno', 'Sin dueño', nSinDueno],
    ];
    chips.innerHTML = filtros.map(([k, label, count]) =>
      `<button class="salas-chip${filtroSalasAdmin === k ? ' active' : ''}" data-filtro-salas-admin="${k}">${label} <span class="count">${count}</span></button>`
    ).join('');
  }

  /* Filtrar y buscar */
  const q = querySalasAdmin.trim().toLowerCase();
  const lista = state.rooms.filter(r => {
    if (filtroSalasAdmin === 'aprobada' && r.estado !== 'aprobada') return false;
    if (filtroSalasAdmin === 'pendiente' && r.estado !== 'pendiente') return false;
    if (filtroSalasAdmin === 'sin-dueno' && r.ownerId) return false;
    if (q && !r.name.toLowerCase().includes(q)) return false;
    return true;
  });

  /* Vacío */
  const elVacio = $('#salas-vacio');
  if (elVacio) elVacio.hidden = lista.length > 0;

  /* Renderizar tarjetas */
  const cont = $('#salas-grid-admin');
  const ESTADO = { aprobada: { label: 'Aprobada', cls: 'ok' }, pendiente: { label: 'Pendiente', cls: 'wait' }, rechazada: { label: 'Rechazada', cls: 'off' } };

  cont.innerHTML = lista.length ? lista.map(r => {
    const st = ESTADO[r.estado] || { label: r.estado, cls: 'off' };
    const owner = r.ownerId ? (window.__usuarios || []).find(u => u.id === r.ownerId) : null;
    const dueño = owner ? esc(owner.nombre) : 'Sin dueño';
    const dueñoNone = !owner;
    const horas = r.horario ? Object.values(r.horario).filter(Boolean).map(h => h.open + ' – ' + h.close) : [];
    const horasUniq = [...new Set(horas)];
    const horasTxt = horasUniq.length ? horasUniq.join(', ') : 'Sin horario';

    return `
    <article class="sala-card">
      <div class="sala-card-top">
        ${r.foto
          ? `<div class="sala-thumb"><img src="${esc(r.foto)}" alt="${esc(r.name)}"></div>`
          : `<div class="sala-thumb sin-foto" style="background:${r.color || '#1e3350'}">${esc((r.name||'?')[0].toUpperCase())}</div>`}
        <div class="sala-card-title">
          <h3>${esc(r.name)}</h3>
          <span class="sala-status st-${st.cls}">● ${st.label}</span>
        </div>
      </div>

      <div class="sala-price"><strong>${fmtMoney(r.price)}</strong><span>/hora</span></div>

      <div class="sala-grid">
        <div class="sala-field"><small>Dueño</small><b class="${dueñoNone ? 'none' : ''}">${dueño}</b></div>
        <div class="sala-field"><small>Capacidad</small><b>${r.capacity} persona${r.capacity === 1 ? '' : 's'}</b></div>
        <div class="sala-field" style="grid-column: span 2"><small>Horario</small><b>${esc(horasTxt)}</b></div>
      </div>

      <div class="sala-actions">
        ${r.estado === 'pendiente'
          ? `<button class="btn btn-sm ok" data-approve-room="${r.id}">Aprobar</button>`
          : `<button class="btn btn-sm" data-edit-room="${r.id}">Editar</button>`}
        ${owner
          ? `<button class="btn btn-sm" data-change-owner="${r.id}">Cambiar dueño</button>`
          : `<button class="btn btn-sm warn" data-assign-owner="${r.id}">Asignar dueño</button>`}
        <button class="btn btn-sm" data-more-room="${r.id}" aria-label="Más opciones">⋮</button>
      </div>
    </article>`;
  }).join('') : '';
}

function formularioSala(id) {
  const r = id ? state.rooms.find(x => x.id === id) : { name: '', price: 10000, capacity: 4, features: [], activo: true, estado: 'aprobada', foto: '', fotoPortada: '', direccion: '', localidad: '', telefono: '', descripcion: '', equipos: {}, fotos: [], catalogo: [] };
  if (id && !r) return;
  let fotoNueva = null;
  let portadaNueva = null;
  /* Catálogo de equipos de la sala: la cuenta madre lo edita igual que el dueño */
  let adminCatalogo = (r.catalogo || []).map(x => Object.assign({}, x));

  /* Guarda en `r` lo que el admin escribió (para no perderlo al volver del
     formulario de un equipo). */
  function capturarFormulario() {
    if (!$('#fr-name')) return;
    r.name = $('#fr-name').value;
    r.price = $('#fr-price').value;
    r.capacity = $('#fr-cap').value;
    r.direccion = $('#fr-direccion').value;
    r.localidad = $('#fr-localidad').value;
    r.telefono = $('#fr-tel').value;
    r.descripcion = $('#fr-desc').value;
    r.features = $('#fr-feats').value.split(',').map(s => s.trim()).filter(Boolean);
    r.mapa = $('#fr-mapa').value;
    r.lat = $('#fr-lat').value;
    r.lng = $('#fr-lng').value;
    r.equipos = {
      instrumentos: $('#fr-eq-instrumentos').value,
      bateria: $('#fr-eq-bateria').value,
      amplificadores: $('#fr-eq-amp').value,
      microfonos: $('#fr-eq-micro').value,
      consola: $('#fr-eq-consola').value,
      otros: $('#fr-eq-otros').value,
    };
    r.catalogo = adminCatalogo;
  }

  /* Vuelve al formulario de la sala después de cargar/editar un equipo.
     Los valores ya se guardaron en `r` al abrir el formulario del equipo. */
  function volverAlFormularioSala() {
    pintar();
  }

  function pintar() {
  const eq = r.equipos || {};
  const fotoVer = fotoNueva || r.foto;
  const portadaVer = portadaNueva || r.fotoPortada;
  openModal(`
    <h3>${id ? 'Editar sala' : 'Nueva sala'}</h3>
    <div class="sala-foto-edit" id="fr-preview">${fotoVer
      ? `<img src="${esc(fotoVer)}" alt="${esc(r.name)}">`
      : '<span class="sala-chip-foto" style="width:60px;height:60px;font-size:1.6rem"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></span>'}</div>
    <label>Logo o foto de la sala<input type="file" id="fr-foto" accept="image/*"></label>
    <label class="check" id="fr-quitar-wrap" ${fotoVer ? '' : 'hidden'}><input type="checkbox" id="fr-quitar"> Quitar la foto</label>
    <h3 class="sub">Foto horizontal (la que se ve en el mapa)</h3>
    <div class="portada-preview" id="fr-portada-preview">${portadaVer
      ? `<img src="${esc(portadaVer)}" alt="Foto horizontal de ${esc(r.name)}">`
      : '<span>Sin foto horizontal</span>'}</div>
    <label>Cambiar foto horizontal<input type="file" id="fr-portada" accept="image/*"></label>
    <label class="check" id="fr-portada-quitar-wrap" ${portadaVer ? '' : 'hidden'}><input type="checkbox" id="fr-portada-quitar"> Quitar la foto horizontal</label>
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
      <button class="btn btn-sm" type="button" id="fr-ubicar"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg> Ubicar en el mapa</button>
      <button class="btn btn-sm" type="button" id="fr-buscar"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Buscar por dirección</button>
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
    <h3 class="sub">Catálogo de equipos</h3>
    <p class="muted small">Los equipos con foto y precio. Los que marques "en alquiler" se ofrecen a los músicos al reservar.</p>
    <div id="fr-catalogo"></div>
    <div class="row">
      <button class="btn btn-sm" type="button" id="fr-catalogo-add"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Agregar equipo</button>
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
      <button class="btn btn-primary" id="fr-save"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Guardar cambios</button>
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
        toast('Logo listo', 'ok');
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
        toast('Foto horizontal lista', 'ok');
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
      catalogo: adminCatalogo,
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
      toast('Sala guardada', 'ok');
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
    toast('Ubicación encontrada', 'ok');
  };
  /* Catálogo de equipos: la cuenta madre carga los equipos igual que el dueño */
  const pintarCatalogoAdmin = () => renderCatalogoAdmin($('#fr-catalogo'), adminCatalogo);
  /* Antes de abrir el formulario de un equipo guardamos lo que ya está escrito en
     la sala: ese formulario reemplaza al de la sala y hay que poder volver. */
  const abrirEquipo = i => {
    capturarFormulario();
    formularioEquipoCatalogo(i, adminCatalogo, pintarCatalogoAdmin, volverAlFormularioSala);
  };
  $('#fr-catalogo-add').onclick = () => abrirEquipo(null);
  $('#fr-catalogo').onclick = e => {
    const ed = e.target.closest('[data-cat-edit]');
    if (ed) return abrirEquipo(Number(ed.dataset.catEdit));
    const del = e.target.closest('[data-cat-del]');
    if (del) {
      const i = Number(del.dataset.catDel);
      adminCatalogo.splice(i, 1);
      pintarCatalogoAdmin();
    }
  };
  pintarCatalogoAdmin();
  }
  pintar();
}

/* Dibuja el catálogo de equipos dentro de un contenedor (administración) */
function renderCatalogoAdmin(cont, items) {
  if (!cont) return;
  if (!items.length) {
    cont.innerHTML = '<p class="muted small">Sin equipos cargados todavía.</p>';
    return;
  }
  cont.innerHTML = items.map((it, i) => `
    <div class="catalogo-item" data-cat="${i}">
      <div class="catalogo-item-head">
        <strong>${esc(it.nombre || 'Equipo sin nombre')}</strong>
        <div class="res-actions">
          <button class="btn btn-sm" type="button" data-cat-edit="${i}">Editar</button>
          <button class="btn btn-sm btn-danger" type="button" data-cat-del="${i}">Quitar</button>
        </div>
      </div>
      <div class="catalogo-item-info">
        ${it.foto ? `<img class="catalogo-item-foto" src="${esc(it.foto)}" alt="${esc(it.nombre)}">` : ''}
        <div>
          ${it.descripcion ? `<div>${esc(it.descripcion)}</div>` : ''}
          ${it.alquiler ? `<div class="muted small">${ICO_SVG.precio} En alquiler · ${fmtMoney(it.precioAlquiler)}/hora</div>` : '<div class="muted small">Solo equipamiento de la sala</div>'}
        </div>
      </div>
    </div>`).join('');
}

async function eliminarSala(id) {
  const r = state.rooms.find(x => x.id === id);
  if (!r) return;
  const n = state.reservations.filter(x => x.roomId === id).length;
  const okEliminarSala = await confirmarAccion(
    `¿Eliminar "${r.name}"? Se borrarán también ${n} reserva(s) y sus bloqueos.`,
    '¿Eliminar sala?',
    'Sí, eliminar',
    'No, mantener',
    'peligro'
  );
  if (!okEliminarSala) return;
  try {
    const data = await api(`/api/rooms/${id}`, { method: 'DELETE', admin: true });
    state = data.state;
    renderAdminTab('salas');
    toast('Sala eliminada', 'ok');
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
        : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h20v8a10 10 0 0 1-20 0z"/><circle cx="8" cy="10" r="1.4"/><circle cx="16" cy="10" r="1.4"/></svg>'}</span>
      ${b.fotoGrupal ? `<img class="band-mini-grupo" src="${esc(b.fotoGrupal)}" alt="foto grupal">` : ''}
      <div class="res-info">
        <strong>${esc(b.nombre)}</strong>
        <div class="muted small">${(b.integrantes || []).length ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> ' + b.integrantes.length + ' integrantes' : 'Sin integrantes'}${b.genero ? ' · ' + esc(b.genero) : ''}${b.foto ? ' · Con foto' : ''}</div>
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
  const okEliminarBanda = await confirmarAccion(
    `¿Eliminar la banda "${b.nombre}"? Las ${n} reserva(s) con ese nombre se conservan.`,
    '¿Eliminar banda?',
    'Sí, eliminar',
    'No, mantener',
    'peligro'
  );
  if (!okEliminarBanda) return;
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
  const nombreSala = id => { const s = (state.rooms || []).find(x => x.id === id); return s ? s.name : 'Sala eliminada'; };

  cont.innerHTML = `
    <div class="inicio-saludo">
      <h2>Hola${yo ? ', ' + esc(yo.usuario) : ''} <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a1.5 1.5 0 0 0-3 0v4"/><path d="M15 10V4a1.5 1.5 0 0 0-3 0v6"/><path d="M12 10.5V6a1.5 1.5 0 0 0-3 0v8"/><path d="M9 10.5V8a1.5 1.5 0 0 0-3 0v6a7 7 0 0 0 7 7h1a7 7 0 0 0 7-7v-3a1.5 1.5 0 0 0-3 0"/></svg></h2>
      <p class="muted small">${esc(fechaTxt)}</p>
    </div>

    <div class="admin-stats inicio-stats">
      <div class="stat"><span>Reservas hoy</span><b>${list.length}</b></div>
      <div class="stat"><span>Ingresos de hoy</span><b>${fmtMoney(ingresos)}</b></div>
      <div class="stat"><span>Pendientes de pago</span><b>${pendPago}</b></div>
      <div class="stat"><span>Solicitudes de salas</span><b>${solicitudes}</b></div>
    </div>

    <div class="inicio-grid">
      <section class="inicio-card ancha">
        <h3>Próximas reservas de hoy</h3>
        ${list.length ? `<ul class="inicio-prox">${list.slice(0, 6).map(r => `
          <li><time>${esc(r.start)}–${esc(r.end)}</time><span class="nom">${esc(r.name)}</span><span class="sala">${esc(nombreSala(r.roomId))}</span></li>`).join('')}</ul>`
          : '<p class="muted small">No hay reservas para hoy.</p>'}
        <div class="inicio-pie"><button class="btn btn-sm" data-goto="reservas">Ver agenda completa</button></div>
      </section>
    </div>`;

  cont.onclick = e => {
    const g = e.target.closest('[data-goto]');
    if (g) return renderAdminTab(g.dataset.goto);
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
    <label>Título *<input id="pr-titulo" maxlength="80" value="${esc(p.titulo)}" placeholder="Ej.: 2x1 los martes"></label>
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
      <button class="btn btn-primary" id="pr-guardar"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Guardar</button>
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
      toast('Promoción guardada', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  };
}

/* ---------- Horarios ---------- */
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function renderHorariosAdmin() {
  const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  $('#hours-container').innerHTML = DIAS.map((d, i) => {
    const h = state.settings.hours[String(i)];
    const abierto = !!h;
    return `
      <div class="hour-day ${abierto ? '' : 'hour-closed'}" data-dia="${i}">
        <div class="hour-day-head">
          <div>
            <div class="hour-day-name">${d}</div>
            <span class="hour-status ${abierto ? 'open' : 'closed'}">${abierto ? 'Abierto' : 'Cerrado'}</span>
          </div>
          <label class="hour-switch" aria-label="Abierto los ${d.toLowerCase()}">
            <input type="checkbox" data-closed="${i}" ${abierto ? 'checked' : ''}>
            <span class="hour-slider"></span>
          </label>
        </div>
        <div class="hour-times" ${abierto ? '' : 'style="opacity:.4;pointer-events:none"'}>
          <div class="hour-field">
            <label>Apertura</label>
            <input type="time" data-open="${i}" value="${h ? h.open : '10:00'}" ${abierto ? '' : 'disabled'}>
          </div>
          <span class="hour-sep">a</span>
          <div class="hour-field">
            <label>Cierre</label>
            <input type="time" data-close="${i}" value="${h ? h.close : '22:00'}" ${abierto ? '' : 'disabled'}>
          </div>
        </div>
      </div>`;
  }).join('');

  /* Wiring de toggles */
  $$('#hours-container [data-closed]').forEach(cb => {
    cb.onchange = () => {
      const i = cb.dataset.closed;
      const row = $(`[data-dia="${i}"]`);
      const times = row ? row.querySelector('.hour-times') : null;
      if (row) row.classList.toggle('hour-closed', !cb.checked);
      if (times) {
        times.style.opacity = cb.checked ? '' : '.4';
        times.style.pointerEvents = cb.checked ? '' : 'none';
      }
      $(`[data-open="${i}"]`).disabled = !cb.checked;
      $(`[data-close="${i}"]`).disabled = !cb.checked;
    };
  });

  /* Chips de acciones rápidas */
  const copyMon = $('#hours-copy-mon');
  if (copyMon) copyMon.onclick = () => {
    const base = state.settings.hours['1'];
    for (let i = 2; i <= 6; i++) {
      state.settings.hours[String(i)] = base ? { ...base } : null;
    }
    renderHorariosAdmin();
    toast('Lunes copiado a todos los días', 'ok');
  };
  const openAll = $('#hours-open-all');
  if (openAll) openAll.onclick = () => {
    for (let i = 0; i < 7; i++) {
      state.settings.hours[String(i)] = state.settings.hours[String(i)] || { open: '10:00', close: '22:00' };
    }
    renderHorariosAdmin();
    toast('Todos los días abiertos', 'ok');
  };
  const closeWeekend = $('#hours-close-weekend');
  if (closeWeekend) closeWeekend.onclick = () => {
    state.settings.hours['0'] = null;
    state.settings.hours['6'] = null;
    renderHorariosAdmin();
    toast('Sábado y domingo cerrados', 'ok');
  };
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
    toast('Horarios actualizados', 'ok');
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
    toast('Horario bloqueado', 'ok');
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
    <div class="stat"><span><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> Ingresos del mes</span><strong>${fmtMoney(revenue)}</strong></div>
    <div class="stat"><span><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> Ocupación</span><strong>${occ}</strong></div>
    <div class="stat"><span><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg> Reservas</span><strong>${reservas}</strong></div>
    <div class="stat"><span><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Horas reservadas</span><strong>${horasOcupadas}</strong></div>
    <div class="stat"><span><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> Próximos 7 días</span><strong>${next7} h</strong></div>
    ${top ? `<div class="stat"><span><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg> Sala más reservada</span><strong>${esc(top.name)}</strong></div>` : ''}`;

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

/* ---------- Pagos y Liquidaciones ---------- */
let cachePagos = null;

async function renderPagosAdmin() {
  const cards = $('#pagos-cards');
  const badge = $('#pagos-modo-badge');
  const tablaSalas = $('#pagos-tabla-salas');
  const tablaRes = $('#pagos-tabla-reservas');
  if (!cards || !tablaSalas || !tablaRes) return;

  // Cargar inputs de reglas desde state.settings.reglas
  const r = (state.settings && state.settings.reglas) || {};
  const inSena = $('#pagos-set-sena');
  const inCom = $('#pagos-set-comision');
  const inMin = $('#pagos-set-minutos');
  if (inSena && document.activeElement !== inSena) inSena.value = r.senaPorcentaje != null ? r.senaPorcentaje : 30;
  if (inCom && document.activeElement !== inCom) inCom.value = r.comisionPorcentaje != null ? r.comisionPorcentaje : 8;
  if (inMin && document.activeElement !== inMin) inMin.value = r.minutosPago != null ? r.minutosPago : 15;

  cards.innerHTML = '<p class="muted">Cargando estado de pagos y señas...</p>';

  try {
    const data = await api('/api/admin/pagos', { admin: true });
    cachePagos = data;

    // Badge del modo de pagos
    const modo = data.modo || 'apagado';
    let modoHtml = '';
    if (modo === 'mercadopago') {
      modoHtml = `<span class="pill pill-ok">${ICO_SVG.check} Mercado Pago (Producción)</span>`;
    } else if (modo === 'simulado') {
      modoHtml = `<span class="pill pill-warn">${ICO_SVG.info} Simulado (Pruebas)</span>`;
    } else {
      modoHtml = `<span class="pill">${ICO_SVG.info} Pagos desactivados (Reserva directa)</span>`;
    }
    if (badge) badge.innerHTML = modoHtml;

    // Métricas
    let totalCobrado = 0, totalComision = 0, totalParaSala = 0, totalLiquidado = 0, totalPorLiquidar = 0;
    (data.salas || []).forEach(s => {
      totalCobrado += (Number(s.cobrado) || 0);
      totalComision += (Number(s.comision) || 0);
      totalParaSala += (Number(s.paraSala) || 0);
      totalLiquidado += (Number(s.liquidado) || 0);
      totalPorLiquidar += (Number(s.porLiquidar) || 0);
    });

    cards.innerHTML = `
      <div class="stat"><span>${ICO_SVG.tarjeta} Señas cobradas</span><strong>${fmtMoney(totalCobrado)}</strong></div>
      <div class="stat"><span>${ICO_SVG.precio} Comisión +Música</span><strong>${fmtMoney(totalComision)}</strong></div>
      <div class="stat"><span>${ICO_SVG.edificio} Asignado a salas</span><strong>${fmtMoney(totalParaSala)}</strong></div>
      <div class="stat" style="${totalPorLiquidar > 0 ? 'border: 1px solid var(--warn, #e67e22);' : ''}">
        <span>${ICO_SVG.relojArena} Por liquidar</span><strong style="${totalPorLiquidar > 0 ? 'color: var(--warn, #e67e22);' : ''}">${fmtMoney(totalPorLiquidar)}</strong>
      </div>
      <div class="stat"><span>${ICO_SVG.transferido} Ya transferido</span><strong>${fmtMoney(totalLiquidado)}</strong></div>
    `;

    // Tabla de liquidación por sala
    if (!data.salas || data.salas.length === 0) {
      tablaSalas.innerHTML = '<p class="muted small">Aún no hay señas registradas para liquidar a las salas.</p>';
    } else {
      tablaSalas.innerHTML = `
        <table>
          <thead>
            <tr>
              <th>Sala</th>
              <th>Cobrado en señas</th>
              <th>Comisión app</th>
              <th>Para la sala</th>
              <th>Ya transferido</th>
              <th>Por liquidar</th>
              <th>Datos de cobro</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            ${data.salas.map(s => {
              const pendiente = Number(s.porLiquidar) || 0;
              const c = s.cobro || {};
              const destinos = [
                c.alias ? `<span class="muted small">Alias:</span> <b>${esc(c.alias)}</b>` : '',
                c.cvu ? `<span class="muted small">CVU:</span> <b>${esc(c.cvu)}</b>` : '',
                c.titular ? `<span class="muted small">${esc(c.titular)}</span>` : '',
                c.banco ? `<span class="muted small">${esc(c.banco)}</span>` : '',
              ].filter(Boolean).join('<br>');
              return `
              <tr>
                <td><strong>${esc(s.sala)}</strong></td>
                <td>${fmtMoney(s.cobrado)}</td>
                <td>${fmtMoney(s.comision)}</td>
                <td><strong>${fmtMoney(s.paraSala)}</strong></td>
                <td>${fmtMoney(s.liquidado)}</td>
                <td>
                  <span class="pill" style="${pendiente > 0 ? 'background: rgba(230,126,34,.15); color: #e67e22; font-weight: 600;' : ''}">
                    ${fmtMoney(pendiente)}
                  </span>
                </td>
                <td>${destinos || '<span class="pill pill-warn">Sin datos de cobro</span>'}</td>
                <td>
                  ${pendiente > 0 ? `
                    <button class="btn btn-primary btn-sm btn-liquidar-sala" data-room-id="${esc(s.roomId)}" data-room-name="${esc(s.sala)}" data-monto="${pendiente}">
                      ${ICO_SVG.check} Marcar liquidado
                    </button>
                  ` : `<span class="muted small">Al día ${ICO_SVG.check}</span>`}
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      `;

      $$('.btn-liquidar-sala').forEach(btn => {
        btn.onclick = async () => {
          const rId = btn.dataset.roomId;
          const rName = btn.dataset.roomName;
          const rMonto = btn.dataset.monto;
          const ok = await confirmarAccion(
            `¿Confirmas que transferiste ${fmtMoney(rMonto)} a "${rName}"? Las señas correspondientes quedarán marcadas como liquidadas.`,
            'Confirmar liquidación',
            'Sí, marcar liquidado',
            'Cancelar'
          );
          if (!ok) return;
          try {
            await api('/api/admin/pagos/liquidar', { method: 'POST', admin: true, body: { roomId: rId } });
            toast(`Liquidación registrada para "${rName}"`, 'ok');
            renderPagosAdmin();
          } catch (err) {
            toast(err.message, 'error');
          }
        };
      });
    }

    // Tabla de reservas con seña
    if (!data.reservas || data.reservas.length === 0) {
      tablaRes.innerHTML = '<p class="muted small">No hay reservas registradas en el historial de pagos.</p>';
    } else {
      tablaRes.innerHTML = `
        <table>
          <thead>
            <tr>
              <th>Fecha y hora</th>
              <th>Sala</th>
              <th>Banda / Cliente</th>
              <th>Total reserva</th>
              <th>Seña pagada</th>
              <th>Saldo en sala</th>
              <th>Estado pago</th>
              <th>Liquidación</th>
            </tr>
          </thead>
          <tbody>
            ${data.reservas.slice().reverse().map(res => {
              const room = (state.rooms || []).find(x => x.id === res.roomId);
              const salaNom = room ? room.name : res.roomId;
              let pagoTag = `<span class="pill">${esc(res.pago || '—')}</span>`;
              if (res.pago === 'aprobado') {
                pagoTag = `<span class="pill pill-ok">${ICO_SVG.check} Aprobado</span>`;
              } else if (res.pago === 'pendiente') {
                pagoTag = `<span class="pill pill-warn">${ICO_SVG.reloj} Pendiente</span>`;
              } else if (res.pago === 'reembolsado' || res.pago === 'reembolso_pendiente') {
                pagoTag = `<span class="pill pill-danger">${ICO_SVG.reembolso} Reembolso</span>`;
              }

              let liqTag = '—';
              if (res.pago === 'aprobado' && res.estado !== 'cancelada') {
                if (res.liquidadoEn) {
                  const d = new Date(res.liquidadoEn);
                  liqTag = `<span class="muted small" title="${d.toLocaleString()}">${ICO_SVG.check} Transferido (${d.getDate()}/${d.getMonth()+1})</span>`;
                } else {
                  liqTag = `<span class="pill pill-warn">Por transferir</span>`;
                }
              }

              return `
                <tr>
                  <td>${esc(res.date)} ${esc(res.start)} - ${esc(res.end)}</td>
                  <td>${esc(salaNom)}</td>
                  <td><strong>${esc(res.name || '—')}</strong></td>
                  <td>${fmtMoney(res.total)}</td>
                  <td><strong>${fmtMoney(res.sena)}</strong></td>
                  <td>${fmtMoney(res.saldo)}</td>
                  <td>${pagoTag}</td>
                  <td>${liqTag}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `;
    }

    // ===== Suscripciones al Chat Global (con desglose de IVA) =====
    const chatCards = $('#pagos-chat-cards');
    const chatTabla = $('#pagos-tabla-chat');
    const chatPill = $('#pagos-chat-pill');
    const chat = data.chat || { cantidad: 0, total: 0, neto: 0, iva: 0, suscripciones: [] };

    if (chatPill) {
      if (chat.cantidad > 0) {
        chatPill.hidden = false;
        chatPill.className = 'pill pill-ok';
        chatPill.textContent = chat.cantidad + (chat.cantidad === 1 ? ' suscripción cobrada' : ' suscripciones cobradas');
      } else {
        chatPill.hidden = true;
      }
    }

    if (chatCards) {
      chatCards.innerHTML = `
        <div class="stat"><span>${ICO_SVG.tarjeta} Cobrado (chat)</span><strong>${fmtMoney(chat.total)}</strong></div>
        <div class="stat"><span>${ICO_SVG.precio} Neto (sin IVA)</span><strong>${fmtMoney(chat.neto)}</strong></div>
        <div class="stat"><span>${ICO_SVG.info} IVA (21%)</span><strong>${fmtMoney(chat.iva)}</strong></div>
        <div class="stat"><span>${ICO_SVG.edificio} Suscripciones</span><strong>${chat.cantidad}</strong></div>
      `;
    }

    if (chatTabla) {
      if (!chat.suscripciones || chat.suscripciones.length === 0) {
        chatTabla.innerHTML = '<p class="muted small">Todavía no hay suscripciones al chat cobradas.</p>';
      } else {
        chatTabla.innerHTML = `
          <table>
            <thead>
              <tr>
                <th>Fecha de pago</th>
                <th>Músico</th>
                <th>Plan</th>
                <th>Total cobrado</th>
                <th>Neto</th>
                <th>IVA (21%)</th>
                <th>Pago MP</th>
              </tr>
            </thead>
            <tbody>
              ${chat.suscripciones.map(s => {
                const d = s.pagadoEn ? new Date(s.pagadoEn) : null;
                const fecha = d ? `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` : '—';
                return `
                  <tr>
                    <td>${esc(fecha)}</td>
                    <td><strong>${esc(s.nombre || s.usuario || '—')}</strong>${s.email ? `<br><span class="muted small">${esc(s.email)}</span>` : ''}</td>
                    <td>${esc(s.planNombre || 'Mensual')}</td>
                    <td><strong>${fmtMoney(s.total)}</strong></td>
                    <td>${fmtMoney(s.neto)}</td>
                    <td>${fmtMoney(s.iva)}</td>
                    <td>${s.pagoId ? `<span class="muted small">${esc(String(s.pagoId).slice(0, 14))}…</span>` : '—'}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        `;
      }
    }
  } catch (err) {
    cards.innerHTML = `<p class="muted" style="color: var(--danger, red);">Error al cargar pagos: ${esc(err.message)}</p>`;
  }
}

async function guardarReglasPagos() {
  const inSena = $('#pagos-set-sena');
  const inCom = $('#pagos-set-comision');
  const inMin = $('#pagos-set-minutos');
  if (!inSena || !inCom || !inMin) return;

  const sena = parseInt(inSena.value, 10);
  const comision = parseInt(inCom.value, 10);
  const minutos = parseInt(inMin.value, 10);

  if (isNaN(sena) || sena < 1 || sena > 100) { toast('El porcentaje de seña debe ser entre 1 y 100', 'warn'); return; }
  if (isNaN(comision) || comision < 0 || comision > 100) { toast('El porcentaje de comisión debe ser entre 0 y 100', 'warn'); return; }
  if (isNaN(minutos) || minutos < 5 || minutos > 60) { toast('Los minutos de espera de pago deben ser entre 5 y 60', 'warn'); return; }

  const reglas = Object.assign({}, (state.settings && state.settings.reglas) || {}, {
    senaPorcentaje: sena,
    comisionPorcentaje: comision,
    minutosPago: minutos
  });

  try {
    const res = await api('/api/settings', { method: 'PUT', admin: true, body: { reglas } });
    state = res.state;
    toast('Reglas de seña y pago guardadas', 'ok');
    renderPagosAdmin();
  } catch (e) {
    toast(e.message, 'error');
  }
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
        ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg> <strong>Mail de avisos activo.</strong> Cada registro y pedido de ayuda llega a <strong>' + esc(c.email) + '</strong> además del timbre <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg> de la app.'
        : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> El mail de avisos está activo, pero falta cargar el <strong>email de contacto</strong> de arriba para saber a dónde enviarlo.')
      : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/></svg> Mail de avisos desactivado: los avisos llegan solo al timbre <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg> de la app. Para activarlos agregá <code>RESEND_API_KEY</code> en <code>server.js</code> y reiniciá el servidor (resend.com).';
  }
  const estadoG = $('#gmaps-estado');
  if (estadoG) {
    estadoG.innerHTML = state.settings.gmapsKey
      ? (gmapaFallo
        ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> <strong>La clave no funcionó</strong> (revisá que la <em>Maps JavaScript API</em> esté habilitada). El mapa usa OpenStreetMap.'
        : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg> <strong>Google Maps activo</strong> en el mapa y en el buscador de direcciones.')
      : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/></svg> Sin clave: el mapa usa OpenStreetMap y la búsqueda de direcciones usa OpenStreetMap.';
  }
  const selCancel = $('#set-cancelacion');
  if (selCancel) selCancel.value = String((state.settings.reglas && state.settings.reglas.cancelacionHoras) || 0);
  const selRec = $('#set-recordatorio');
  if (selRec) selRec.value = String((state.settings.reglas && state.settings.reglas.recordatorioHoras) || 0);
  $('#admin-device-info').innerHTML = esDispositivoAdmin()
    ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg> Este dispositivo está autorizado como <strong>administrador</strong>: el botón <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> aparece en el inicio. En otros dispositivos no se ve.'
    : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Este dispositivo <strong>no</strong> es de administración. Para entrar: doble toque en el logo (o URL con <code>#admin</code>) y escribí tu usuario y contraseña.';
  const info = $('#admin-cuenta-info');
  if (info) {
    info.innerHTML = yo
      ? 'Estos son los datos de la cuenta que administra la app. Podés editarlos y cambiar la contraseña.'
      : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Entrás con el <strong>PIN de emergencia</strong> (no hay cuenta de administración general iniciada).';
  }
  /* Tarjeta resumen de la cuenta madre */
  const resumen = $('#cm-resumen');
  if (resumen) {
    const fecha = t => t ? new Date(t).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
    resumen.innerHTML = yo
      ? `<div class="cm-ava">${yo.foto ? `<img src="${esc(yo.foto)}" alt="">` : esDueño() && miSala && miSala.foto ? `<img src="${esc(miSala.foto)}" alt="">` : '<span><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7l4 4 6-7 6 7 4-4-2 12H4z"/></svg></span>'}</div>
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
    toast('Cuenta madre actualizada', 'ok');
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
  const selRec = $('#set-recordatorio');
  if (selRec) body.reglas = Object.assign({}, body.reglas || state.settings.reglas, { recordatorioHoras: Number(selRec.value) });
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
        ? 'Clave guardada. Recargá la app (F5 <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>) para que se use la nueva.'
        : (claveDespues ? 'Clave de Google Maps guardada <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg> El mapa va a usar Google Maps.' : 'Clave quitada. El mapa vuelve a OpenStreetMap <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>'), 'ok');
      return;
    }
    renderAjustes();
    toast('Ajustes guardados', 'ok');
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
  toast('Datos exportados', 'ok');
}

async function importar(file) {
  const fr = new FileReader();
  fr.onload = async () => {
    try {
      const data = JSON.parse(fr.result);
      const res = await api('/api/state', { method: 'PUT', admin: true, body: data });
      state = res.state;
      showAdmin();
      toast('Datos importados', 'ok');
    } catch (e) {
      toast(e.message || 'Archivo inválido', 'error');
    }
  };
  fr.readAsText(file);
}

/* ================= Modal y toast ================= */
let avisoCierreModal = null;   /* avisa cuando el modal se cierra sin aceptar (, fondo o Escape) */

function openModal(html) {
  const aviso = avisoCierreModal;
  avisoCierreModal = null;
  if (aviso) aviso();
  $('#modal-box').innerHTML = html;
  $('#modal').classList.add('open');
}
function closeModal() {
  $('#modal').classList.remove('open');
  const aviso = avisoCierreModal;
  avisoCierreModal = null;
  if (aviso) aviso();
}

/* Escape cancela los diálogos con campo de texto (igual que el prompt() del navegador) */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && avisoCierreModal) { e.preventDefault(); closeModal(); }
});

/* Modal de confirmación personalizado (reemplaza a confirm() nativo).
   Escapamos los textos: aunque hoy son texto plano, así ningún dato del usuario
   (nombre de reserva, banda, cuenta o sala) puede inyectar HTML. */
function confirmarAccion(mensaje, titulo = '¿Estás seguro?', textoAceptar = 'Aceptar', textoCancelar = 'Cancelar', tipo = 'peligro') {
  return new Promise(resolve => {
    const colorAceptar = tipo === 'peligro' ? 'btn-danger' : 'btn-primary';
    openModal(`
      <div class="confirmar-modal">
        <div class="confirmar-icono">${tipo === 'peligro' ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'}</div>
        <h3>${esc(titulo)}</h3>
        <p class="confirmar-mensaje">${esc(mensaje)}</p>
        <div class="confirmar-botones">
          <button class="btn" id="confirmar-no">${esc(textoCancelar)}</button>
          <button class="btn ${colorAceptar}" id="confirmar-si">${esc(textoAceptar)}</button>
        </div>
      </div>
    `);
    $('#confirmar-si').onclick = () => { closeModal(); resolve(true); };
    $('#confirmar-no').onclick = () => { closeModal(); resolve(false); };
  });
}

/* Modal con un campo de texto (reemplaza al prompt() del navegador).
   Devuelve el texto escrito, o null si se cancela o se cierra el modal. */
function pedirTextoModal({ titulo, texto = '', valor = '', placeholder = '', multilinea = false, aceptar = 'Aceptar' }) {
  return new Promise(resolve => {
    let listo = false;
    const terminar = v => {
      if (listo) return;
      listo = true;
      avisoCierreModal = null;
      if ($('#modal').classList.contains('open')) closeModal();
      resolve(v);
    };
    openModal(`
      <div class="pedir-modal">
        <h3>${esc(titulo)}</h3>
        ${texto ? `<p class="pedir-texto">${texto}</p>` : ''}
        ${multilinea
          ? `<textarea id="pedir-campo" rows="3" maxlength="400" placeholder="${esc(placeholder)}">${esc(valor)}</textarea>`
          : `<input id="pedir-campo" type="text" maxlength="120" value="${esc(valor)}" placeholder="${esc(placeholder)}">`}
        <div class="confirmar-botones">
          <button class="btn" id="pedir-no">Cancelar</button>
          <button class="btn btn-primary" id="pedir-si">${esc(aceptar)}</button>
        </div>
      </div>`);
    const campo = $('#pedir-campo');
    campo.focus();
    if (multilinea) campo.setSelectionRange(campo.value.length, campo.value.length);
    else campo.select();
    campo.onkeydown = e => {
      if (e.key === 'Enter' && (!multilinea || e.ctrlKey || e.metaKey)) { e.preventDefault(); terminar(campo.value); }
    };
    $('#pedir-si').onclick = () => terminar(campo.value);
    $('#pedir-no').onclick = () => terminar(null);
    avisoCierreModal = () => terminar(null);
  });
}

/* Muestra la contraseña nueva para copiarla y pasarla (reemplaza al alert() del navegador) */
function mostrarClaveModal(usuario, clave) {
  return new Promise(resolve => {
    let listo = false;
    const terminar = () => {
      if (listo) return;
      listo = true;
      avisoCierreModal = null;
      if ($('#modal').classList.contains('open')) closeModal();
      resolve();
    };
    openModal(`
      <div class="pedir-modal">
        <h3>Contraseña nueva</h3>
        <p class="pedir-texto">Se la pasás a <b>@${esc(usuario)}</b> y que la cambie al entrar:</p>
        <div class="clave-caja" id="clave-caja">${esc(clave)}</div>
        <div class="confirmar-botones">
          <button class="btn" id="clave-copiar">Copiar</button>
          <button class="btn btn-primary" id="clave-listo">Listo</button>
        </div>
      </div>`);
    $('#clave-copiar').onclick = async () => {
      try {
        await navigator.clipboard.writeText(clave);
        toast('Contraseña copiada', 'ok');
      } catch (e) {
        const rango = document.createRange();
        rango.selectNodeContents($('#clave-caja'));
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(rango);
        let copiada = false;
        try { copiada = document.execCommand('copy'); } catch (e2) {}
        toast(copiada ? 'Contraseña copiada' : 'Contraseña seleccionada: copiala con Ctrl+C', copiada ? 'ok' : 'warn');
      }
    };
    $('#clave-listo').onclick = terminar;
    avisoCierreModal = terminar;
  });
}

/* Lista de cuentas para la administración general (se pide una vez y queda en memoria) */
async function asegurarUsuarios() {
  if (window.__usuarios && window.__usuarios.length) return window.__usuarios;
  try {
    const data = await api('/api/admin/usuarios', { admin: true });
    window.__usuarios = data.usuarios || [];
  } catch (e) { /* sin lista */ }
  return window.__usuarios || [];
}

/* Asignar o cambiar el dueño de una sala (Administración central  Salas).
   Interacción con búsqueda y selección, reemplaza al prompt() del navegador. */
async function asignarDuenioModal(roomId, cambiar) {
  const r = (state.rooms || []).find(x => x.id === roomId);
  if (!r) return;
  openModal(`
    <h3>${cambiar ? 'Cambiar dueño' : 'Asignar dueño'}</h3>
    <p class="own-ctx">Sala: <b>${esc(r.name)}</b><span id="own-ctx-dueno"></span></p>
    <label>Buscar usuario
      <input type="text" id="own-buscar" placeholder="usuario o nombre…" autocomplete="off">
    </label>
    <div class="own-lista" id="own-lista"><p class="muted small">Cargando cuentas…</p></div>
    <div class="row">
      <button class="btn btn-primary" id="own-ok" disabled>${cambiar ? 'Cambiar' : 'Asignar'}</button>
      <button class="btn" id="own-cancel">Cancelar</button>
    </div>`);
  const lista = $('#own-lista');
  const busq = $('#own-buscar');
  const ok = $('#own-ok');
  const ctxDueno = $('#own-ctx-dueno');
  const ROL = { SUPER_ADMIN: 'Administración', ROOM_ADMIN: 'Dueño', USER: 'Músico' };
  let sel = null;
  let usuarios = [];

  function pintar() {
    if (!lista.isConnected) return;
    const term = String(busq.value || '').trim().toLowerCase();
    const actualId = r.ownerId;
    const us = usuarios.filter(u => u.id !== actualId &&
      (!term || String(u.usuario || '').toLowerCase().includes(term) || String(u.nombre || '').toLowerCase().includes(term)));
    lista.innerHTML = us.length ? us.map(u => `
      <button type="button" class="own-op" data-u="${esc(u.id)}">
        <span class="own-nom"><b>${esc(u.usuario)}</b>${u.nombre ? `<small>${esc(u.nombre)}</small>` : ''}</span>
        <em class="own-rol">${esc(ROL[u.rol] || u.rol || '')}</em>
      </button>`).join('') : '<p class="muted small">Sin usuarios que coincidan.</p>';
  }

  busq.oninput = () => { sel = null; ok.disabled = true; pintar(); };
  lista.onclick = e => {
    const op = e.target.closest('.own-op');
    if (!op) return;
    sel = op.dataset.u;
    lista.querySelectorAll('.own-op.on').forEach(x => x.classList.remove('on'));
    op.classList.add('on');
    ok.disabled = false;
  };
  $('#own-cancel').onclick = closeModal;
  ok.onclick = async () => {
    if (!sel) return;
    ok.disabled = true;
    try {
      const data = await api('/api/rooms/' + roomId, { method: 'PUT', admin: true, body: { ownerId: sel } });
      state = data.state;
      window.__usuarios = null;   /* el rol del nuevo dueño puede haber cambiado */
      closeModal();
      renderAdminTab('salas');
      toast(cambiar ? 'Dueño cambiado' : 'Dueño asignado', 'ok');
    } catch (err) {
      ok.disabled = false;
      toast(err.message, 'error');
    }
  };

  usuarios = await asegurarUsuarios();
  if (!lista.isConnected) return;
  const actual = r.ownerId ? usuarios.find(u => u.id === r.ownerId) : null;
  if (actual) ctxDueno.innerHTML = ` · Dueño actual: <b>${esc(actual.nombre || actual.usuario)}</b>`;
  pintar();
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
            toast(`${nuevas[0].titulo}`, 'ok');
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
    b.onclick = () => {
      filtroSolicitudes = b.dataset.estadoSol;
      $$('#tab-solicitudes .sol-chip').forEach(c => c.setAttribute('aria-selected', c === b ? 'true' : 'false'));
      renderSolicitudes();
    };
  });
  $('#solicitudes-list').onclick = async e => {
    const ok = e.target.closest('[data-sol-ok]');
    if (ok) return accionSolicitud(ok.dataset.solOk, 'aprobar');
    const corr = e.target.closest('[data-sol-corr]');
    if (corr) {
      const motivo = await pedirTextoModal({
        titulo: 'Pedir correcciones',
        texto: 'Contale al dueño de la sala qué tiene que corregir. Se le avisa en la app:',
        placeholder: 'Ej.: faltan fotos del lugar y el horario está incompleto',
        multilinea: true,
        aceptar: 'Enviar aviso'
      });
      if (motivo) accionSolicitud(corr.dataset.solCorr, 'corregir', motivo);
      return;
    }
    const no = e.target.closest('[data-sol-no]');
    if (no) {
      const sala = (listaSolicitudes || []).find(r => r.id === no.dataset.solNo);
      const esPendiente = !!sala && sala.estado === 'pendiente';
      const motivo = await pedirTextoModal({
        titulo: esPendiente ? 'Rechazar sala' : 'Suspender sala',
        texto: `¿Por qué ${esPendiente ? 'rechazás' : 'suspendés'} “${esc(sala ? sala.name : 'la sala')}”? Se le avisa al dueño:`,
        placeholder: 'Motivo',
        multilinea: true,
        aceptar: esPendiente ? 'Rechazar' : 'Suspender'
      });
      if (motivo === null) return;
      const accion = esPendiente ? 'rechazar' : (sala && sala.estado === 'suspendida' ? 'rechazar' : 'desactivar');
      return accionSolicitud(no.dataset.solNo, accion, motivo);
    }
    const ed = e.target.closest('[data-sol-editar]');
    if (ed) return formularioSala(ed.dataset.solEditar);
  };
  /* Cuentas registradas */
  $('#usuarios-buscar').oninput = () => renderUsuarios();
  $('#usuarios-list').onclick = e => {
    const b = e.target.closest('[data-user-bloquear]');
    if (b) return accionUsuario(b.dataset.userBloquear, 'bloquear');
    const d = e.target.closest('[data-user-borrar]');
    if (d) return accionUsuario(d.dataset.userBorrar, 'borrar');
  };
  $('#usuarios-list').onchange = e => {
    const r = e.target.closest('[data-user-rol]');
    if (r) return accionUsuario(r.dataset.userRol, 'rol', r.value);
  };
  $('#usuarios-chips').onclick = e => {
    const chip = e.target.closest('[data-filtro-usuarios]');
    if (!chip) return;
    filtroUsuarios = chip.dataset.filtroUsuarios;
    renderUsuarios();
  };
  /* Pedidos de ayuda */
  $('#ayuda-list').onclick = e => {
    const des = e.target.closest('[data-ayuda-desbloquear]');
    if (des) return resolverAyuda(des.dataset.ayudaDesbloquear, true);
    const clv = e.target.closest('[data-ayuda-clave]');
    if (clv) return darClaveDesdeAyuda(clv.dataset.ayudaClave);
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
  $('#salas-buscar').oninput = e => { querySalasAdmin = e.target.value; renderSalasAdmin(); };
  $('#salas-chips').onclick = e => {
    const chip = e.target.closest('[data-filtro-salas-admin]');
    if (!chip) return;
    filtroSalasAdmin = chip.dataset.filtroSalasAdmin;
    renderSalasAdmin();
  };
  $('#salas-grid-admin').onclick = async e => {
    const ed = e.target.closest('[data-edit-room]');
    if (ed) return formularioSala(ed.dataset.editRoom);
    const ap = e.target.closest('[data-approve-room]');
    if (ap) {
      try {
        const data = await api(`/api/admin/solicitudes/${ap.dataset.approveRoom}`, { method: 'PUT', admin: true, body: { accion: 'aprobar' } });
        state = data.state; renderAdminTab('salas'); toast('Sala aprobada', 'ok');
      } catch (err) { toast(err.message, 'error'); }
      return;
    }
    const own = e.target.closest('[data-assign-owner]');
    if (own) return asignarDuenioModal(own.dataset.assignOwner, false);
    const chg = e.target.closest('[data-change-owner]');
    if (chg) return asignarDuenioModal(chg.dataset.changeOwner, true);
    const more = e.target.closest('[data-more-room]');
    if (more) {
      toast('Opciones: eliminar, desactivar, ver historial', 'ok');
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
      const okEliminarPromo = await confirmarAccion(
    '¿Eliminar esta promoción?',
    '¿Eliminar promoción?',
    'Sí, eliminar',
    'No, mantener',
    'peligro'
  );
  if (!okEliminarPromo) return;
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
  const btnSavePagos = $('#btn-save-pagos-reglas');
  if (btnSavePagos) btnSavePagos.onclick = guardarReglasPagos;
  const btnRefreshPagos = $('#btn-refresh-pagos');
  if (btnRefreshPagos) btnRefreshPagos.onclick = renderPagosAdmin;
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
      toast('Contraseña de administrador cambiada', 'ok');
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
  /* Bandas registradas: solo editar o eliminar (desde acá no se registran) */
  $('#bands-admin').onclick = e => {
    const ed = e.target.closest('[data-edit-band]');
    if (ed) return formularioBanda(ed.dataset.editBand);
    const del = e.target.closest('[data-del-band]');
    if (del) return eliminarBanda(del.dataset.delBand);
  };
  $('#btn-demo').onclick = async () => {
    const okDatosDemo = await confirmarAccion(
    '¿Cargar datos de demostración? Se reemplazarán los datos actuales.',
    '¿Cargar datos demo?',
    'Sí, cargar',
    'No, cancelar',
    'peligro'
  );
  if (!okDatosDemo) return;
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
    const okBorrarTodo = await confirmarAccion(
    '¿Borrar TODOS los datos (salas, reservas y bloqueos)?',
    '¿Borrar todo?',
    'Sí, borrar todo',
    'No, cancelar',
    'peligro'
  );
  if (!okBorrarTodo) return;
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

  /* Sesión guardada en este dispositivo */
  const haySesion = await verificarSesion();
  if (haySesion) {
    arrancarApp();
  } else {
    mostrarLogin();
  }          /* el mapa del Inicio */

  /* Acceso directo: .../#admin abre el pedido de acceso */
  if (location.hash === '#admin') {
    history.replaceState(null, '', location.pathname + location.search);
    setTimeout(() => enterAdmin(), 250);
  }
  startPolling();
  cerrarSplash();

  /* La barra inferior se oculta al deslizar hacia abajo y vuelve al deslizar hacia arriba */
  prepararDockAutoOcultar();

  /* Fallback: si no hay sesión y el auth-body está vacío, forzar pantalla de login */
  if (!yo && !$('#auth-body').innerHTML.trim()) {
    $('#view-auth').hidden = false;
    pantallaAuth('inicio');
    if (typeof wireAuth === 'function') wireAuth();
  }

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
    toast('App instalada', 'ok');
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
        '<h3><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg> Instalar la app</h3>' +
        '<p>En tu iPhone o iPad:</p>' +
        '<ol style="padding-left:20px;margin:8px 0;line-height:1.7">' +
        '<li>Tocá el botón <b>Compartir</b> <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg> en la barra del navegador.</li>' +
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
    if (pg === 'ok') toast('¡Seña recibida! Tu reserva se confirma en unos segundos. Mirala en Mis reservas', 'ok');
    else if (pg === 'pendiente') toast('Tu pago está pendiente. Te avisamos cuando se acredite.', 'warn');
    else toast('El pago no se completó. Podés intentarlo de nuevo antes de que venza el horario.', 'warn');
  }, 1500);
})();

/* Al volver de Mercado Pago por la suscripción al chat (?chat=ok | pendiente | error) */
(function () {
  const ch = new URLSearchParams(location.search).get('chat');
  if (!ch) return;
  history.replaceState(null, '', location.pathname + location.hash);
  setTimeout(() => {
    if (ch === 'ok') toast('¡Suscripción al chat activada! Ya podés entrar a la comunidad.', 'ok');
    else if (ch === 'pendiente') toast('Tu pago de la suscripción está pendiente. Te avisamos cuando se acredite.', 'warn');
    else toast('El pago de la suscripción no se completó. Podés intentarlo de nuevo.', 'warn');
  }, 1500);
})();

/* Verificación de email (?verificarEmail=TOKEN) */
(function () {
  const tok = new URLSearchParams(location.search).get('verificarEmail');
  if (!tok) return;
  history.replaceState(null, '', location.pathname + location.hash);
  setTimeout(async () => {
    try {
      const r = await fetch('/api/auth/verificar-email?token=' + encodeURIComponent(tok));
      const d = await r.json();
      if (r.ok) toast(d.mensaje || 'Email confirmado correctamente', 'ok');
      else toast(d.error || 'No se pudo verificar el email', 'error');
    } catch (e) {
      toast('Error al verificar el email', 'error');
    }
  }, 1500);
})();

/* ---------- Botón "atrás" del teléfono ---------- */
/* La app es de una sola pantalla: el botón atrás cierra lo que está encima
   (modal o pasos de la reserva) o vuelve a Inicio, antes de salir. */
(function () {
  function mantenerColchon() {
    try { history.pushState({ mm: 1 }, ''); } catch (e) {}
  }
  function cerrarCapaAtras() {
    const modal = $('#modal');
    if (modal && modal.classList.contains('open')) { closeModal(); return true; }
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
