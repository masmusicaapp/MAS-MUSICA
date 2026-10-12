'use strict';

/**
 * Más Música — Backend (Node.js, sin dependencias externas)
 *
 * API REST + archivos estáticos. El estado se guarda en data.json.
 * La validación de disponibilidad se hace SIEMPRE en el servidor (autoridad).
 *
 * ROLES
 *   USER        músico: busca salas, consulta y reserva
 *   ROOM_ADMIN  dueño/administrador de una sala: administra solo su sala
 *   SUPER_ADMIN administrador general de Más Música: control total
 *
 * AUTENTICACIÓN
 *   POST /api/auth/registro            crear cuenta de músico      → USER
 *   POST /api/auth/registro-sala       registrar mi sala de ensayo → ROOM_ADMIN + sala PENDIENTE
 *   POST /api/auth/login               { usuario|email, password } → { token, user }
 *   POST /api/auth/pin                 { pin } (PIN de emergencia) → { token, user }
 *   POST /api/auth/logout              cerrar sesión
 *   GET  /api/auth/me                  sesión actual
 *   PUT  /api/auth/perfil              actualizar mis datos (nombre, email, usuario, teléfono, foto, contraseña)
 *   PUT  /api/auth/favoritos           { roomId } marca/desmarca favorita
 *   POST /api/auth/ayuda               pedido de ayuda (olvidé contraseña / cuenta bloqueada) → avisa a la administración (+ mail)
 *
 * CUENTAS (SUPER_ADMIN o PIN de emergencia)
 *   GET    /api/admin/ayuda               pedidos de ayuda pendientes
 *   POST   /api/admin/ayuda               { id, desbloquear? } marca un pedido como resuelto (y opcionalmente desbloquea la cuenta)
 *   GET    /api/admin/usuarios            lista de cuentas
 *   PUT    /api/admin/usuarios/:id        { activo, bloqueado, rol }
 *   DELETE /api/admin/usuarios/:id        eliminar cuenta
 *   GET    /api/admin/solicitudes          salas pendientes de aprobación
 *   PUT    /api/admin/solicitudes/:id      { accion: aprobar|rechazar|desactivar|activar, motivo }
 *
 * PANEL DEL DUEÑO DE LA SALA (ROOM_ADMIN de esa sala o SUPER_ADMIN)
 *   GET    /api/panel/sala                 datos + reservas + bloqueos de su sala
 *   PUT    /api/panel/sala                 editar información, fotos, equipos, precios
 *   PUT    /api/panel/horario              días y horarios + duración de los turnos
 *   POST   /api/panel/bloqueo              bloquear un horario
 *   DELETE /api/panel/bloqueo/:id          quitar el bloqueo
 *   PUT    /api/panel/reserva/:id          editar una reserva de su sala
 *   DELETE /api/panel/reserva/:id          cancelar una reserva de su sala
 *
 * PÚBLICO
 *   GET  /api/state                     estado (sin datos privados)
 *   GET  /api/notificaciones            avisos del usuario conectado
 *   POST /api/notificaciones/leer       marcar como leídos
 *   POST /api/reserve                   crear reserva
 *   POST /api/reservations/:id/cancel   cancelar
 *   POST /api/bands                     registrar banda
 *   PUT  /api/bands/:id                 editar banda
 *
 * ADMINISTRACIÓN GENERAL (SUPER_ADMIN o PIN)
 *   PUT/DELETE /api/rooms[/:id]         salas
 *   POST/PUT/DELETE /api/instruments[/:id]
 *   POST/PUT/DELETE /api/place-photos[/:id]
 *   DELETE /api/bands/:id
 *   PUT  /api/settings/hours            horarios generales
 *   PUT  /api/settings                  moneda, PIN, reglas, contacto (redes + email de avisos)
 *   POST /api/blocks                    bloquear horario
 *   DELETE /api/blocks/:id
 *   PUT  /api/state                     importar datos
 *   POST /api/demo | /api/reset
 *
 * Crear la cuenta madre (no existe en el registro público):
 *   node server.js --crear-admin [usuario] [email] [contraseña]
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = path.join(__dirname, 'data.json');
const BANDAS_DIR = path.join(PUBLIC_DIR, 'assets', 'bandas');
const SALAS_DIR = path.join(PUBLIC_DIR, 'assets', 'salas');
const USUARIOS_DIR = path.join(PUBLIC_DIR, 'assets', 'usuarios');

/* ================= Imágenes ================= */

/* Las fotos llegan como data URL y se guardan como archivo
   (así data.json y las respuestas de /api/state quedan livianos). */
function guardarImagen(id, dataUrl, sufijo, subcarpeta) {
  const s = String(dataUrl || '').trim();
  const m = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(s);
  if (!m) return null; /* no es data URL: se guarda como ruta/enlace */
  const tipo = m[1].toLowerCase();
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > 6 * 1024 * 1024) return null;
  /* Verifica los "magic bytes": tiene que ser una imagen de verdad.
     Así un HTML o JS disfrazado de imagen no puede servirse desde la app. */
  const esPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const esJpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const esWebp = buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP';
  const esImagen = (tipo === 'png' && esPng) || (tipo === 'jpg' && esJpg) || (tipo === 'webp' && esWebp);
  if (!esImagen) return null;
  const ext = tipo === 'png' ? 'png' : tipo === 'webp' ? 'webp' : 'jpg';
  /* El id va en el nombre del archivo: se limpia para que nunca pueda salir de la carpeta */
  const idLimpio = String(id || 'x').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 80);
  const sufLimpio = String(sufijo || '').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 20);
  fs.mkdirSync(path.join(PUBLIC_DIR, 'assets', subcarpeta), { recursive: true });
  const rel = `assets/${subcarpeta}/${idLimpio}${sufLimpio}.${ext}`;
  fs.writeFileSync(path.join(PUBLIC_DIR, rel), buf);
  return rel;
}
const guardarFotoBanda = (id, d, s) => guardarImagen(id, d, s, 'bandas');
const guardarFotoSala = (id, d, s) => guardarImagen(id, d, s, 'salas');
const guardarFotoUsuario = (id, d, s) => guardarImagen(id, d, s, 'usuarios');

function borrarEnAssets(fotos, subcarpeta) {
  const base = path.join(PUBLIC_DIR, 'assets', subcarpeta);
  const prefijo = 'assets/' + subcarpeta + '/';
  (Array.isArray(fotos) ? fotos : [fotos]).forEach(rel => {
    if (!rel || typeof rel !== 'string' || !rel.startsWith(prefijo)) return;
    const destino = path.normalize(path.join(base, rel.slice(prefijo.length)));
    /* Solo borra dentro de la carpeta de la subida: bloquea ".." y rutas que escapan */
    if (destino !== base && !destino.startsWith(base + path.sep)) return;
    try { fs.unlinkSync(destino); } catch (e) { /* ya no existe */ }
  });
}
const borrarFotoBanda = f => borrarEnAssets(f, 'bandas');
const borrarFotoSala = f => borrarEnAssets(f, 'salas');
const borrarFotoUsuario = f => borrarEnAssets(f, 'usuarios');

/* ================= Estado ================= */

const HORAS_DEFAULT = {
  '0': null,
  '1': { open: '10:00', close: '22:00' },
  '2': { open: '10:00', close: '22:00' },
  '3': { open: '10:00', close: '22:00' },
  '4': { open: '10:00', close: '22:00' },
  '5': { open: '10:00', close: '22:00' },
  '6': { open: '11:00', close: '20:00' },
};

/* ========================================================
 * PLANES COMERCIALES Y SUSCRIPCIONES (Documento Base v1.0)
 * ======================================================== */
const PLANES_CONFIG = {
  emprendedor: { id: 'emprendedor', nombre: 'Plan Emprendedor', maxSalas: 2, precioMensual: 25000, moneda: 'ARS' },
  estudio:      { id: 'estudio',      nombre: 'Plan Estudio',      maxSalas: 5, precioMensual: 40000, moneda: 'ARS' },
  multisala:    { id: 'multisala',    nombre: 'Plan Multisala',    maxSalas: 10, precioMensual: 60000, moneda: 'ARS' },
  sala_extra:   { id: 'sala_extra',   nombre: 'Sala Adicional',    precioMensual: 5000, moneda: 'ARS' }
};

function getSuscripcionUsuario(state, userId) {
  state.subscriptions = state.subscriptions || [];
  let sub = state.subscriptions.find(s => s.userId === userId);
  if (!sub) {
    // Plan por defecto al registrarse como ROOM_ADMIN
    sub = {
      id: uid(),
      userId,
      plan: 'emprendedor',
      salasExtra: 0,
      estado: 'activo', // activo, cancelado, vencido
      fechaInicio: Date.now(),
      proximoVencimiento: Date.now() + 30 * 24 * 3600 * 1000
    };
    state.subscriptions.push(sub);
  }
  const planInfo = PLANES_CONFIG[sub.plan] || PLANES_CONFIG.emprendedor;
  const limiteSalas = planInfo.maxSalas + (sub.salasExtra || 0);
  const salasActuales = (state.rooms || []).filter(r => r.ownerId === userId).length;
  return {
    ...sub,
    nombrePlan: planInfo.nombre,
    precioMensual: planInfo.precioMensual + ((sub.salasExtra || 0) * PLANES_CONFIG.sala_extra.precioMensual),
    limiteSalas,
    salasActuales,
    puedeCrearSala: salasActuales < limiteSalas
  };
}

const REGlas_DEFAULT = { cancelacionHoras: 0, turnos: [30, 60, 90, 120], avisoHoras: 24, senaPorcentaje: 30, comisionPorcentaje: 8, minutosPago: 15 };

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const toMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
const overlap = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;
const dateStr = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function demoInstruments() {
  return [
    { id: uid(), nombre: 'Batería completa', descripcion: 'Pearl Export 5 piezas + platillos y hardware', foto: '', activo: true, alquiler: false, precioAlquiler: 0 },
    { id: uid(), nombre: 'Amplificador de guitarra', descripcion: 'Fender Frontman 20G, 20 W', foto: '', activo: true, alquiler: true, precioAlquiler: 8000 },
    { id: uid(), nombre: 'Amplificador de bajo', descripcion: 'Fender Rumble 40, 40 W', foto: '', activo: true, alquiler: true, precioAlquiler: 9000 },
    { id: uid(), nombre: 'Teclado', descripcion: 'Yamaha PSR-E373, 61 teclas', foto: '', activo: true, alquiler: true, precioAlquiler: 12000 },
    { id: uid(), nombre: 'Micrófonos', descripcion: '2 × Shure SM58 con cables', foto: '', activo: true, alquiler: true, precioAlquiler: 5000 },
  ];
}

function demoPlacePhotos() {
  return [
    { id: uid(), titulo: 'Sala 1', foto: 'assets/lugar/sala-1.png' },
    { id: uid(), titulo: 'Sala 2', foto: 'assets/lugar/sala-2.png' },
    { id: uid(), titulo: 'Sala 3 — Premium', foto: 'assets/lugar/sala-3.png' },
  ];
}

function demoBands() {
  return [{ id: uid(), nombre: 'Banda Demo', telefono: '', foto: '', createdAt: Date.now() }];
}

/* Novedades y promociones que se resumen en el Inicio */
function demoPromociones() {
  return [{
    id: uid(),
    titulo: '🎉 Bienvenido a Más Música',
    texto: 'Reservá tu sala de ensayo online, guardá tus salas favoritas y gestioná tus reservas desde la app.',
    flyer: '',
    redes: '',
    activa: true,
    desde: Date.now(),
    hasta: Date.now() + 1000 * 60 * 60 * 24 * 90,
    creado: Date.now(),
  }];
}

/* Horario completo de una sala (7 días, inicialmente todo cerrado) */
function horarioVacio() {
  const h = {};
  for (let i = 0; i < 7; i++) h[String(i)] = null;
  return h;
}

/* Una sala nueva trae todos los campos del formulario de "Registrar mi sala" */
function salaNueva(datos = {}) {
  const base = {
    id: datos.id || uid(),
    ownerId: datos.ownerId || null,
    estado: datos.estado || 'pendiente',
    name: '',
    descripcion: '',
    direccion: '',
    localidad: '',
    mapa: '',
    lat: null,
    lng: null,
    telefono: '',
    precio: 10000,
    price: 10000,
    capacity: 4,
    features: [],
    equipos: { instrumentos: '', amplificadores: '', bateria: '', microfonos: '', consola: '', otros: '' },
    fotos: [],
    foto: '',
    fotoPortada: '',   /* foto horizontal que se ve en el mapa */
    horario: horarioVacio(),
    horarioPropio: false,
    turnoMin: 60,
    activo: true,
    solicitud: { fecha: Date.now(), revisada: 0, motivo: '', revisor: '' },
    creado: Date.now(),
  };
  return Object.assign(base, datos);
}

function defaultState() {
  const hoy = dateStr(new Date());
  return {
    settings: {
      currency: '$',
      /* Sin PIN por defecto: se crea solo cuando la administración lo define (seguro). */
      hours: JSON.parse(JSON.stringify(HORAS_DEFAULT)),
      reglas: JSON.parse(JSON.stringify(REGlas_DEFAULT)),
      /* Contacto y redes: se muestran en la app y el email recibe los avisos (registros y pedidos de ayuda) */
      contacto: { whatsapp: '', instagram: '', facebook: '', email: '', tiktok: '' },
    },
    users: [],
    sessions: [],
    notificaciones: [],
    ayuda: [],           /* pedidos de ayuda de los usuarios (olvidé contraseña / cuenta bloqueada) */
    mensajes: [],
    promociones: demoPromociones(),
    rooms: [
      salaNueva({ id: 'r1', estado: 'aprobada', name: 'Sala 1', price: 15000, capacity: 4, features: ['Batería completa', 'Amplificadores'] }),
      salaNueva({ id: 'r2', estado: 'aprobada', name: 'Sala 2', price: 12000, capacity: 3, features: ['Amplificadores', 'Rincón acústico'] }),
      salaNueva({ id: 'r3', estado: 'aprobada', name: 'Sala 3 — Premium', price: 22000, capacity: 8, features: ['Batería', 'Amplificadores', 'Iluminación LED', 'Camarín'] }),
    ],
    reservations: [
      { id: uid(), roomId: 'r1', date: hoy, start: '19:00', end: '21:00', name: 'Banda Demo', phone: '', userId: null, estado: 'confirmada', createdAt: Date.now() },
    ],
    blocks: [],
    instruments: demoInstruments(),
    placePhotos: demoPlacePhotos(),
    bands: demoBands(),
  };
}

/* Amplía las salas viejas con los campos nuevos (migración) */
function migrarSala(r) {
  const base = salaNueva({ id: r.id, estado: r.estado || 'aprobada' });
  const out = Object.assign(base, r);
  out.name = String(r.name || 'Sala').slice(0, 60);
  out.price = Math.max(1, parseInt(r.price != null ? r.price : r.precio, 10) || 10000);
  out.precio = out.price;
  out.capacity = Math.max(1, parseInt(r.capacity, 10) || 1);
  out.features = Array.isArray(r.features) ? r.features.map(String).slice(0, 20) : [];
  out.equipos = Object.assign(base.equipos, r.equipos || {});
  out.fotos = Array.isArray(r.fotos) ? r.fotos : [];
  out.fotoPortada = String(r.fotoPortada || '').slice(0, 300);
  out.telefono = String(r.telefono || '').slice(0, 30);
  out.horario = Object.assign(horarioVacio(), r.horario || {});
  out.horarioPropio = !!r.horarioPropio;
  out.turnoMin = [30, 60, 90, 120].includes(parseInt(r.turnoMin, 10)) ? parseInt(r.turnoMin, 10) : 60;
  out.activo = r.activo !== false;
  out.estado = ['pendiente', 'aprobada', 'rechazada', 'suspendida'].includes(r.estado) ? r.estado : 'aprobada';
  out.ownerId = r.ownerId || null;
  /* Ubicación en el mapa (puede venir vacía) */
  out.lat = r.lat === null || r.lat === '' || r.lat === undefined || !Number.isFinite(Number(r.lat)) ? null : Number(r.lat);
  out.lng = r.lng === null || r.lng === '' || r.lng === undefined || !Number.isFinite(Number(r.lng)) ? null : Number(r.lng);
  out.direccion = String(r.direccion || '').slice(0, 160);
  out.localidad = String(r.localidad || '').slice(0, 80);
  return out;
}

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (data && data.settings && Array.isArray(data.rooms) && Array.isArray(data.reservations)) {
      let cambiado = false;
      if (!Array.isArray(data.instruments)) { data.instruments = demoInstruments(); cambiado = true; }
      (data.instruments || []).forEach(i => {
        if (typeof i.alquiler !== 'boolean') { i.alquiler = false; cambiado = true; }
        if (typeof i.precioAlquiler !== 'number') { i.precioAlquiler = 0; cambiado = true; }
      });
      if (!Array.isArray(data.placePhotos)) { data.placePhotos = demoPlacePhotos(); cambiado = true; }
      if (!Array.isArray(data.bands)) { data.bands = demoBands(); cambiado = true; }
      if (!Array.isArray(data.users)) { data.users = []; cambiado = true; }
      if (!Array.isArray(data.sessions)) { data.sessions = []; cambiado = true; }
      if (!Array.isArray(data.notificaciones)) { data.notificaciones = []; cambiado = true; }
      if (!Array.isArray(data.promociones)) { data.promociones = demoPromociones(); cambiado = true; }
      if (!Array.isArray(data.mensajes)) { data.mensajes = []; cambiado = true; }
      (data.users || []).forEach(u => { if (!Array.isArray(u.following)) { u.following = []; cambiado = true; } });
      /* Avisos de cuentas que ya no existen (se limpian al borrar una cuenta) */
      const avisosPrevios = (data.notificaciones || []).length;
      data.notificaciones = (data.notificaciones || []).filter(n => (data.users || []).some(u => u.id === n.userId));
      if (data.notificaciones.length !== avisosPrevios) cambiado = true;
      if (!data.settings.reglas) { data.settings.reglas = JSON.parse(JSON.stringify(REGlas_DEFAULT)); cambiado = true; }
      if (!data.settings.contacto) {
        data.settings.contacto = { whatsapp: '', instagram: '', facebook: '', email: '', tiktok: '' };
        cambiado = true;
      }
      if (!Array.isArray(data.ayuda)) { data.ayuda = []; cambiado = true; }
      /* Seguridad: el PIN de emergencia se migra a hash (nunca queda en texto plano) */
      if (data.settings.adminPin && !data.settings.pinHash) {
        data.settings.pinHash = hashPassword(String(data.settings.adminPin));
        delete data.settings.adminPin;
        cambiado = true;
      }
      /* Seguridad: las sesiones se guardan como hash, no como token en texto plano */
      (data.sessions || []).forEach(s => {
        if (s.token && !s.tokenHash) { s.tokenHash = hashToken(s.token); delete s.token; cambiado = true; }
      });
      const antes = JSON.stringify(data.rooms);
      data.rooms = data.rooms.map(migrarSala);
      if (JSON.stringify(data.rooms) !== antes) cambiado = true;
      data.reservations.forEach(r => {
        if (!r.estado) { r.estado = 'confirmada'; cambiado = true; }
        if (r.userId === undefined) { r.userId = null; cambiado = true; }
      });
      if (cambiado) persist(data);
      return data;
    }
  } catch (e) { /* archivo inexistente o corrupto */ }
  const demo = defaultState();
  persist(demo);
  return demo;
}

function persist(state) {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

/* Estado que se envía al cliente (sin PIN, sin cuentas ni sesiones) */
function publicState(state) {
  const { users, sessions, notificaciones, ...resto } = state;
  return {
    ...resto,
    reservations: (state.reservations || []).map(({ pago, ...x }) => (pago ? { ...x, pagoEstado: pago.estado } : x)),
    settings: {
      currency: state.settings.currency,
      hours: state.settings.hours,
      reglas: state.settings.reglas || REGlas_DEFAULT,
      gmapsKey: String(state.settings.gmapsKey || ''), // clave pública de Google Maps (se restringe por referrer)
      contacto: state.settings.contacto || { whatsapp: '', instagram: '', facebook: '', email: '', tiktok: '' },
      avisoMail: !!process.env.RESEND_API_KEY, // si hay clave de Resend, los avisos llegan por mail además de la app
    },
  };
}

/* ================= Utilidades ================= */

/* Integrantes de una banda: nombre + instrumento (ambos opcionales) */
function normalizarIntegrantes(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map(m => ({
      nombre: String((m && m.nombre) || '').trim().slice(0, 40),
      instrumento: String((m && m.instrumento) || '').slice(0, 60),
    }))
    .filter(m => m.nombre || m.instrumento)
    .slice(0, 24);
}

const listaTexto = (v, max = 20, largo = 60) =>
  Array.isArray(v) ? v.map(x => String(x).trim().slice(0, largo)).filter(Boolean).slice(0, max) : [];

/* Alquiler de instrumentos: el servidor calcula el precio (es la autoridad) */
function calcularAlquiler(state, ids, horas) {
  if (!Array.isArray(ids) || !ids.length) return [];
  const h = Math.max(1, Math.round(horas));
  return ids.slice(0, 12).map(id => {
    const inst = (state.instruments || []).find(i => i.id === id && i.alquiler);
    if (!inst) return null;
    const precio = Math.max(0, parseInt(inst.precioAlquiler, 10) || 0);
    return { id: inst.id, nombre: String(inst.nombre).slice(0, 60), horas: h, precio, total: precio * h };
  }).filter(Boolean);
}

/* Horario de atención: el de la sala si tiene uno propio; si no, el general */
function horarioDeSala(state, ds, roomId) {
  const wd = String(new Date(ds + 'T12:00:00').getDay());
  if (roomId) {
    const room = state.rooms.find(r => r.id === roomId);
    if (room && room.horario) {
      const propio = room.horarioPropio || Object.values(room.horario).some(Boolean);
      if (propio) return room.horario[wd] || null;
    }
  }
  return (state.settings.hours || {})[wd] || null;
}

/* Duración de los turnos de la sala */
function turnoDe(state, roomId) {
  const r = state.rooms.find(x => x.id === roomId);
  const t = parseInt(r && r.turnoMin, 10);
  return [30, 60, 90, 120].includes(t) ? t : 60;
}

/**
 * Autoridad de disponibilidad: ¿está libre el rango [startMin, endMin)
 * para esa sala y fecha? excludeId permite editar la propia reserva.
 */
function rangoDisponible(state, ds, roomId, startMin, endMin, excludeId) {
  const h = horarioDeSala(state, ds, roomId);
  if (!h) return false;
  const open = toMin(h.open), close = toMin(h.close);
  if (startMin < open || endMin > close || endMin <= startMin) return false;
  const paso = turnoDe(state, roomId);
  /* El inicio debe caer en la grilla de turnos de la sala; el final puede ser
     más corto (media hora dentro de un turno de 1 h 30, por ejemplo). */
  if ((startMin - open) % paso !== 0) return false;
  const hoy = new Date();
  const hoyStr = dateStr(hoy);
  if (ds < hoyStr) return false;
  const ahora = hoy.getHours() * 60 + hoy.getMinutes();
  for (let t = startMin; t < endMin; t += paso) {
    if (ds === hoyStr && t <= ahora) return false;
    const res = state.reservations.find(r =>
      r.id !== excludeId && r.roomId === roomId && r.date === ds && (r.estado || 'confirmada') !== 'cancelada' &&
      overlap(t, Math.min(t + paso, endMin), toMin(r.start), toMin(r.end)));
    if (res) return false;
    const blk = state.blocks.find(b =>
      b.roomId === roomId && b.date === ds &&
      overlap(t, Math.min(t + paso, endMin), toMin(b.from), toMin(b.to)));
    if (blk) return false;
  }
  return true;
}

/* ================= Cuentas, sesiones y permisos ================= */

const LONGITUD_HASH = 64;

function hashPassword(pass, salt = crypto.randomBytes(16).toString('hex')) {
  return { hash: crypto.scryptSync(String(pass), salt, LONGITUD_HASH).toString('hex'), salt };
}

/* Comparación a prueba de tiempo de cualquier clave hasheada (scrypt) */
function verificarClave(pass, reg) {
  if (!reg || !reg.hash || !reg.salt) return false;
  try {
    const real = crypto.scryptSync(String(pass), reg.salt, LONGITUD_HASH);
    const esperado = Buffer.from(String(reg.hash), 'hex');
    return real.length === esperado.length && crypto.timingSafeEqual(real, esperado);
  } catch (e) { return false; }
}

function verifyPassword(pass, usuario) {
  return !!usuario && verificarClave(pass, usuario.pass);
}

/* Las sesiones NO se guardan en texto plano: solo su hash. Así una fuga de
   data.json no permite robar sesiones activas. */
const hashToken = t => crypto.createHash('sha256').update(String(t || '')).digest('hex');
const sesionCoincide = (s, token) => !!s && (s.tokenHash === hashToken(token) || (s.token && s.token === token));

function crearSesion(state, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const ahora = Date.now();
  state.sessions = (state.sessions || []).filter(s => s.expira > ahora);
  state.sessions.push({ tokenHash: hashToken(token), userId, creado: ahora, expira: ahora + 1000 * 60 * 60 * 24 * 30 });
  return token;
}

function cerrarSesiones(state, userId) {
  state.sessions = (state.sessions || []).filter(s => s.userId !== userId);
}

/* Cierra todas las sesiones de un usuario salvo la actual (p. ej. al cambiar la contraseña) */
function cerrarOtrasSesiones(state, userId, token) {
  state.sessions = (state.sessions || []).filter(s => s.userId !== userId || sesionCoincide(s, token));
}

function tokenDeReq(req) {
  const h = req.headers['authorization'] || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return req.headers['x-mm-token'] || null;
}

function sesionActual(state, req) {
  const token = tokenDeReq(req);
  if (!token) return null;
  const s = (state.sessions || []).find(x => sesionCoincide(x, token));
  if (!s) return null;
  if (s.expira < Date.now()) return null;
  const u = (state.users || []).find(x => x.id === s.userId);
  if (!u || u.bloqueado || u.activo === false) return null;
  return u;
}

/* ================= Anti fuerza bruta ================= */
const INTENTOS_LIMITE = 8;               /* intentos fallidos que se permiten */
const INTENTOS_VENTANA = 15 * 60 * 1000; /* en una ventana de 15 minutos */
const intentosPorIP = new Map();

function ipDeReq(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?').split(',')[0].trim().slice(0, 64);
}
function chequearIntento(req, clave) {
  const k = clave + '|' + ipDeReq(req);
  const ahora = Date.now();
  const e = intentosPorIP.get(k) || { n: 0, reset: ahora + INTENTOS_VENTANA };
  if (e.reset <= ahora) { e.n = 0; e.reset = ahora + INTENTOS_VENTANA; }
  if (e.n >= INTENTOS_LIMITE) return { bloqueado: true, espera: Math.ceil((e.reset - ahora) / 1000) };
  e.n++;
  intentosPorIP.set(k, e);
  return { bloqueado: false };
}
function liberarIntentos(req, clave) {
  intentosPorIP.delete(clave + '|' + ipDeReq(req));
}

/* PIN de emergencia: se guarda SOLO como hash (nunca en texto plano) */
function pinValido(state, pin) {
  const s = String(pin || '');
  if (!s) return false;
  if (state.settings.pinHash) return verificarClave(s, state.settings.pinHash);
  /* Datos viejos: PIN en texto plano (se migra a hash al primer guardado) */
  const viejo = state.settings.adminPin;
  if (!viejo) return false;
  const a = Buffer.from(s, 'utf8');
  const b = Buffer.from(String(viejo), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* Administración general: sesión SUPER_ADMIN o el PIN de emergencia */
function esSuper(state, req) {
  const pin = req.headers['x-admin-pin'];
  if (pin) {
    /* El PIN también está protegido contra fuerza bruta */
    const it = chequearIntento(req, 'pin');
    if (it.bloqueado || !pinValido(state, pin)) return false;
    liberarIntentos(req, 'pin');
    return true;
  }
  const u = sesionActual(state, req);
  return !!u && u.rol === 'SUPER_ADMIN';
}

/* Dueño de una sala concreta (o el SUPER_ADMIN) */
function esDueño(state, req, roomId) {
  const u = sesionActual(state, req);
  if (!u) return null;
  if (u.rol === 'SUPER_ADMIN') return u;
  if (u.rol === 'ROOM_ADMIN' && roomId) {
    const room = state.rooms.find(r => r.id === roomId);
    if (room && room.ownerId === u.id) return u;
  }
  return null;
}

/* Sala que administra el usuario conectado (o null) */
function salaDelUsuario(state, u) {
  if (!u) return null;
  if (u.rol === 'ROOM_ADMIN') return state.rooms.find(r => r.ownerId === u.id) || null;
  return null;
}

/* Lo que se devuelve al cliente de una cuenta (nunca el hash) */
function usuarioPublico(u) {
  if (!u) return null;
  return {
    id: u.id,
    nombre: u.nombre,
    usuario: u.usuario,
    email: u.email,
    telefono: u.telefono || '',
    foto: u.foto || '',
    localidad: u.localidad || '',
    instrumentos: Array.isArray(u.instrumentos) ? u.instrumentos : [],
    rol: u.rol,
    activo: u.activo !== false,
    bloqueado: !!u.bloqueado,
    favoritos: Array.isArray(u.favoritos) ? u.favoritos : [],
    creado: u.creado || 0,
    ultimoAcceso: u.ultimoAcceso || 0,
  };
}

function avisar(state, userId, titulo, texto, tipo = 'info', ref = null) {
  if (!userId) return;
  state.notificaciones = state.notificaciones || [];
  const n = {
    id: uid(), userId, titulo: String(titulo).slice(0, 80),
    texto: String(texto).slice(0, 240), tipo, leida: false, fecha: Date.now(),
  };
  if (ref && ref.reservaId) {
    n.reservaId = ref.reservaId;
    n.roomId = ref.roomId || '';
    if (ref.para) n.para = ref.para;   /* 'dueno' = aviso dirigido al dueño de la sala */
  }
  state.notificaciones.unshift(n);
  state.notificaciones = state.notificaciones.slice(0, 400);
}

/* ================= Avisos a la administración (app + mail) ================= */

/*
 * Mail real de avisos, sin dependencias externas (usa la API HTTP de Resend).
 * Si no está configurado RESEND_API_KEY, el aviso igual llega dentro de la app.
 *   RESEND_API_KEY  clave de la API (panel de Resend → API Keys)
 *   RESEND_FROM     remitente (defecto: onboarding@resend.dev, que solo envía
 *                   al dueño de la cuenta hasta verificar un dominio propio)
 * El destinatario es el email de contacto cargado en los ajustes.
 */
const RESEND_KEY = String(process.env.RESEND_API_KEY || '').trim();
const RESEND_FROM = String(process.env.RESEND_FROM || '').trim() || 'Más Música <onboarding@resend.dev>';

async function enviarMail(para, asunto, texto) {
  if (!RESEND_KEY || !para || !validarEmail(para)) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: RESEND_FROM, to: [para], subject: asunto, text: texto }),
    });
    if (!r.ok) console.error('[mail]', r.status, String(await r.text().catch(() => '')).slice(0, 300));
    return r.ok;
  } catch (e) { console.error('[mail]', e.message); return false; }
}

/* Email de destino de los avisos (el de contacto, si está cargado) */
function emailDeAvisos(state) {
  return (state.settings && state.settings.contacto && state.settings.contacto.email) || '';
}

/* Avisa a todas las cuentas de administración general y, si hay mail configurado, lo manda también por email */
function avisarAdministracion(state, titulo, texto, tipo = 'info') {
  const t = String(titulo).slice(0, 80);
  const x = String(texto).slice(0, 240);
  (state.users || []).filter(u => u.rol === 'SUPER_ADMIN').forEach(u => avisar(state, u.id, t, x, tipo));
  const destino = emailDeAvisos(state);
  if (destino) enviarMail(destino, t, x).catch(() => {});
  return true;
}

function validarEmail(v) {
  const s = String(v || '').trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(s) ? s : '';
}

/* Crea la cuenta madre la primera vez (nunca por registro público) */
function asegurarSuperAdmin(state) {
  if ((state.users || []).some(u => u.rol === 'SUPER_ADMIN')) return null;
  const pass = crypto.randomBytes(9).toString('base64url');
  const admin = {
    id: uid(),
    nombre: 'Administración Más Música',
    usuario: 'admin',
    email: 'admin@masmusica.app',
    telefono: '',
    pass: hashPassword(pass),
    foto: '',
    localidad: '',
    instrumentos: [],
    rol: 'SUPER_ADMIN',
    activo: true,
    bloqueado: false,
    favoritos: [],
    creado: Date.now(),
    ultimoAcceso: 0,
  };
  state.users.push(admin);
  persist(state);
  return { usuario: 'admin', password: pass };
}

/* Alta de cuenta (músico o dueño de sala) */
function crearUsuario(state, datos, rol) {
  const nombre = String(datos.nombre || '').trim().slice(0, 60);
  const usuario = String(datos.usuario || '').trim().toLowerCase().slice(0, 24);
  const email = validarEmail(datos.email);
  const password = String(datos.password || '');
  if (nombre.length < 2) throw Object.assign(new Error('Escribí tu nombre y apellido'), { code: 400 });
  if (!/^[a-z0-9._-]{3,24}$/.test(usuario)) throw Object.assign(new Error('El nombre de usuario debe tener 3 a 24 caracteres (a-z, 0-9, . _ -)'), { code: 400 });
  if (!email) throw Object.assign(new Error('Revisá el email'), { code: 400 });
  if (password.length < 6) throw Object.assign(new Error('La contraseña debe tener al menos 6 caracteres'), { code: 400 });
  if ((state.users || []).some(u => u.usuario === usuario)) throw Object.assign(new Error('Ese nombre de usuario ya está en uso'), { code: 409 });
  if ((state.users || []).some(u => (u.email || '').toLowerCase() === email)) throw Object.assign(new Error('Ya existe una cuenta con ese email'), { code: 409 });
  const id = uid();
  const nuevo = {
    id,
    nombre,
    usuario,
    email,
    telefono: String(datos.telefono || '').trim().slice(0, 30),
    pass: hashPassword(password),
    foto: guardarFotoUsuario(id, datos.foto, '') || '',
    localidad: String(datos.localidad || '').trim().slice(0, 80),
    instrumentos: listaTexto(datos.instrumentos, 8, 40),
    rol,
    activo: true,
    bloqueado: false,
    favoritos: [],
    creado: Date.now(),
    ultimoAcceso: Date.now(),
  };
  state.users.push(nuevo);
  return nuevo;
}

/* ================= PAGOS (seña con Mercado Pago) =================
   MODO_PAGOS:
     'mercadopago' → hay MP_ACCESS_TOKEN y BASE_URL: se cobra la seña de verdad
     'simulado'    → MODO_PAGOS=simulado: para probar sin cobrar (ver PAGOS.md)
     'apagado'     → sin variables: la app funciona como antes (reserva confirmada directa)
   La seña entra a la cuenta de +MÚSICA. De esa seña se descuenta la comisión y el
   resto se le liquida a la sala. El saldo se paga en la sala. */
const MP_TOKEN = process.env.MP_ACCESS_TOKEN || '';
const BASE_URL = (process.env.BASE_URL || '').replace(/\/+$/, '');
const MP_API = (process.env.MP_API_BASE || 'https://api.mercadopago.com').replace(/\/+$/, '');
const MP_MONEDA = process.env.MP_MONEDA || 'ARS';
const MODO_PAGOS = process.env.MODO_PAGOS === 'simulado' ? 'simulado' : (MP_TOKEN && BASE_URL ? 'mercadopago' : 'apagado');
const MOTIVO_VENCIDA = 'No se pagó la seña a tiempo';

const numEntre = (v, min, max, def) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };

function reglasPago(state) {
  const r = (state.settings && state.settings.reglas) || {};
  return {
    senaPorcentaje: numEntre(r.senaPorcentaje, 1, 100, 30),
    comisionPorcentaje: numEntre(r.comisionPorcentaje, 0, 100, 8),
    minutosPago: numEntre(r.minutosPago, 5, 60, 15),
  };
}

/* Modelo de negocio oficial +MÚSICA:
 * room_price: valor base sala + alquiler instrumentos
 * service_fee: 5% a cargo del músico (ingreso bruto plataforma)
 * total_amount: room_price + service_fee
 */
function calcularPago(room, startMin, endMin, alquiler, regs) {
  const horas = (endMin - startMin) / 60;
  const room_price = Math.round(room.price * horas) + (alquiler || []).reduce((s, a) => s + a.total, 0);
  const service_fee = Math.round(room_price * 0.05);
  const total_amount = room_price + service_fee;
  return {
    room_price,
    service_fee,
    total_amount,
    total: total_amount,
    sena: total_amount,
    comision: service_fee,
    paraSala: room_price,
    saldo: 0
  };
}

async function mpFetch(ruta, opciones = {}) {
  const resp = await fetch(MP_API + ruta, {
    method: opciones.method || 'GET',
    headers: Object.assign({ 'Authorization': 'Bearer ' + MP_TOKEN, 'Content-Type': 'application/json' }, opciones.headers || {}),
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
  });
  const txt = await resp.text();
  let json = {};
  try { json = txt ? JSON.parse(txt) : {}; } catch (e) { /* respuesta no JSON */ }
  if (!resp.ok) throw new Error(`Mercado Pago ${resp.status}: ${txt.slice(0, 200)}`);
  return json;
}

async function crearPreferencia(reserva, room) {
  const pref = await mpFetch('/checkout/preferences', {
    method: 'POST',
    body: {
      items: [{
        title: `Seña · ${room.name} · ${reserva.date} ${reserva.start}-${reserva.end}`.slice(0, 120),
        quantity: 1,
        unit_price: reserva.sena,
        currency_id: MP_MONEDA,
      }],
      external_reference: reserva.id,
      back_urls: {
        success: `${BASE_URL}/?pago=ok`,
        pending: `${BASE_URL}/?pago=pendiente`,
        failure: `${BASE_URL}/?pago=error`,
      },
      auto_return: 'approved',
      notification_url: `${BASE_URL}/api/pagos/webhook`,
      statement_descriptor: 'MASMUSICA',
      expires: true,
      expiration_date_to: new Date(reserva.venceEn).toISOString(),
    },
  });
  const sandbox = MP_TOKEN.startsWith('TEST-');
  return { id: pref.id, url: (sandbox ? pref.sandbox_init_point : pref.init_point) || pref.init_point || pref.sandbox_init_point };
}

const consultarPago = id => mpFetch('/v1/payments/' + encodeURIComponent(id));

async function reembolsarSena(r) {
  if (MODO_PAGOS === 'simulado') return true;
  if (!r.pago || !r.pago.pagoId) return false;
  try {
    await mpFetch(`/v1/payments/${encodeURIComponent(r.pago.pagoId)}/refunds`, {
      method: 'POST', body: {}, headers: { 'X-Idempotency-Key': 'reembolso-' + r.id },
    });
    return true;
  } catch (e) {
    console.error('[pagos] no se pudo reembolsar la reserva ' + r.id + ':', e.message);
    return false;
  }
}

/* Reservas sin seña pagada a tiempo: se cancelan y el horario vuelve a quedar libre */
function expirarPendientes(state) {
  const ahora = Date.now();
  let cambio = false;
  (state.reservations || []).forEach(r => {
    if (r.estado === 'pendiente_pago' && r.venceEn && r.venceEn < ahora) {
      r.estado = 'cancelada';
      r.cancelada = ahora;
      r.motivoCancelacion = MOTIVO_VENCIDA;
      if (r.pago) r.pago.estado = 'vencido';
      cambio = true;
    }
  });
  if (cambio) persist(state);
}

function confirmarPorPago(state, r, pagoId) {
  r.estado = 'confirmada';
  delete r.cancelada;
  delete r.motivoCancelacion;
  r.pago = Object.assign(r.pago || {}, { estado: 'aprobado', pagoId: String(pagoId || ''), pagadoEn: Date.now() });
  const room = state.rooms.find(x => x.id === r.roomId);
  const detalle = `${room ? room.name : 'Sala'} · ${fmtFechaCorta(r.date)} · ${r.start}–${r.end}`;
  if (r.userId) avisar(state, r.userId, 'Reserva confirmada', `${detalle} · Seña recibida`, 'ok', { reservaId: r.id, roomId: r.roomId });
  if (room && room.ownerId) avisar(state, room.ownerId, 'Nueva reserva', `${r.name} reservó ${room.name} el ${fmtFechaCorta(r.date)}, de ${r.start} a ${r.end} (seña pagada)`, 'info', { reservaId: r.id, roomId: r.roomId, para: 'dueno' });
}

/* Procesa el aviso de pago. Siempre se consulta el pago a Mercado Pago con nuestro token,
   así nadie puede falsificar un aviso. */
async function procesarPago(state, pagoId, datos) {
  const pago = datos || await consultarPago(pagoId);
  const r = state.reservations.find(x => x.id === pago.external_reference);
  if (!r || !r.pago) return null;
  if (Number(pago.transaction_amount) !== Number(r.sena)) {
    console.error('[pagos] monto inesperado en la reserva ' + r.id);
    return null;
  }
  if (pago.status === 'approved') {
    if (r.pago.estado === 'aprobado') return r;
    if (r.estado === 'pendiente_pago') { confirmarPorPago(state, r, pagoId); return r; }
    /* La reserva ya estaba cancelada: si venció y el horario sigue libre, se recupera; si no, se devuelve la seña */
    const libre = r.motivoCancelacion === MOTIVO_VENCIDA &&
      rangoDisponible(state, r.date, r.roomId, toMin(r.start), toMin(r.end), r.id);
    if (libre) { confirmarPorPago(state, r, pagoId); return r; }
    r.pago.pagoId = String(pagoId);
    r.pago.estado = (await reembolsarSena(r)) ? 'reembolsado' : 'reembolso_pendiente';
    return r;
  }
  if (['refunded', 'charged_back'].includes(pago.status)) r.pago.estado = 'reembolsado';
  if (['rejected', 'cancelled'].includes(pago.status) && r.pago.estado !== 'aprobado') r.pago.estado = 'rechazado';
  return r;
}

function resumenPagos(state, roomId) {
  const filas = (state.reservations || []).filter(r => r.pago && (!roomId || r.roomId === roomId));
  const porSala = {};
  filas.forEach(r => {
    const room = state.rooms.find(x => x.id === r.roomId);
    const k = r.roomId;
    const f = porSala[k] = porSala[k] || { roomId: k, sala: room ? room.name : k, cobrado: 0, comision: 0, paraSala: 0, liquidado: 0, porLiquidar: 0 };
    if (r.pago.estado === 'aprobado' && r.estado !== 'cancelada') {
      f.cobrado += r.sena; f.comision += r.comision; f.paraSala += r.paraSala;
      if (r.pago.liquidadoEn) f.liquidado += r.paraSala; else f.porLiquidar += r.paraSala;
    }
  });
  return {
    modo: MODO_PAGOS,
    salas: Object.values(porSala),
    reservas: filas.map(r => ({
      id: r.id, roomId: r.roomId, date: r.date, start: r.start, end: r.end, name: r.name, estado: r.estado,
      total: r.total, sena: r.sena, comision: r.comision, paraSala: r.paraSala, saldo: r.saldo,
      pago: r.pago.estado, liquidadoEn: r.pago.liquidadoEn || null,
    })),
  };
}

/* ================= HTTP helpers ================= */

function sendJson(res, code, obj) {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    let cerrado = false;
    const terminar = () => { if (!cerrado) { cerrado = true; resolve({}); } };
    req.on('data', c => {
      if (cerrado) return;
      data += c;
      if (data.length > 8e6) { req.destroy(); terminar(); } // las fotos llegan como data URL
    });
    req.on('end', () => {
      if (!cerrado) {
        cerrado = true;
        try { resolve(JSON.parse(data || '{}')); } catch (e) { resolve({}); }
      }
    });
    req.on('error', terminar);
    req.on('close', terminar);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, url) {
  let p;
  try { p = decodeURIComponent(url.pathname); } catch (e) { res.writeHead(400); return res.end(); }
  if (p === '/') p = '/index.html';
  /* Solo rutas normales dentro de public/: nada de "..", "." ni caracteres raros */
  if (p.split('/').some(s => s === '..' || s === '.' || s.includes('\0'))) { res.writeHead(403); return res.end(); }
  const file = path.join(PUBLIC_DIR, p);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('No encontrado'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
    res.end(data);
  });
}

/* ================= API ================= */

async function handleApi(req, res, url, parts) {
  const method = req.method;
  const body = method === 'GET' || method === 'DELETE' ? {} : await readBody(req);
  const state = loadState();
  expirarPendientes(state);
  const P = parts[1];

  /* ======================= AUTENTICACIÓN ======================= */

  // Crear cuenta de músico
  if (method === 'POST' && url.pathname === '/api/auth/registro') {
    const it = chequearIntento(req, 'registro');
    if (it.bloqueado) return sendJson(res, 429, { error: `Demasiados intentos. Probá de nuevo en ${it.espera} s.` });
    let nuevo;
    try { nuevo = crearUsuario(state, body, 'USER'); }
    catch (e) { return sendJson(res, e.code || 400, { error: e.message }); }
    const token = crearSesion(state, nuevo.id);
    avisar(state, nuevo.id, '¡Bienvenido a Más Música!', 'Tu cuenta ya está activa. Buscá tu sala de ensayo y reservá.', 'ok');
    /* La administración se entera de cada registro (notificación en la app + mail si está configurado) */
    avisarAdministracion(state, '🎸 Nuevo registro',
      `@${nuevo.usuario} · ${nuevo.nombre}${nuevo.email ? ' · ' + nuevo.email : ''}${nuevo.localidad ? ' · ' + nuevo.localidad : ''}`, 'info');
    persist(state);
    return sendJson(res, 201, { token, user: usuarioPublico(nuevo) });
  }

  // Registrar mi sala de ensayo (crea la cuenta + la sala, pendiente de aprobación)
  if (method === 'POST' && url.pathname === '/api/auth/registro-sala') {
    const it = chequearIntento(req, 'registro');
    if (it.bloqueado) return sendJson(res, 429, { error: `Demasiados intentos. Probá de nuevo en ${it.espera} s.` });
    const nombreSala = String(body.sala && body.sala.name || '').trim();
    const direccion = String(body.sala && body.sala.direccion || '').trim();
    if (nombreSala.length < 2) return sendJson(res, 400, { error: 'Escribí el nombre de la sala' });
    if (direccion.length < 4) return sendJson(res, 400, { error: 'Escribí la dirección de la sala' });
    let duenio;
    try { duenio = crearUsuario(state, body, 'ROOM_ADMIN'); }
    catch (e) { return sendJson(res, e.code || 400, { error: e.message }); }
    const s = body.sala;
    const id = uid();
    const horario = horarioVacio();
    if (Array.isArray(s.horario) && s.horario.length) {
      /* "Lun a Vie 10:00 – 22:00" */
      const open = String(s.horario[0] || '10:00').slice(0, 5);
      const close = String(s.horario[1] || '22:00').slice(0, 5);
      const dias = Array.isArray(s.dias) ? s.dias.map(Number) : [1, 2, 3, 4, 5];
      dias.forEach(d => { if (d >= 0 && d <= 6 && toMin(open) < toMin(close)) horario[String(d)] = { open, close }; });
    }
    const sala = salaNueva({
      id,
      ownerId: duenio.id,
      estado: 'pendiente',
      horario,
      solicitud: { fecha: Date.now(), revisada: 0, motivo: '', revisor: '' },
    });
    sala.horarioPropio = Object.values(horario).some(Boolean);
    const datosSala = Object.assign({}, s);
    delete datosSala.horario;   // el horario ya se calculó arriba
    delete datosSala.dias;
    delete datosSala.fotos;
    Object.assign(sala, datosDeSala(datosSala, sala));
    sala.precio = sala.price;
    const fotos = [];
    (Array.isArray(s.fotos) ? s.fotos : []).slice(0, 8).forEach((f, i) => {
      const rel = guardarFotoSala(id, f.foto || f, '-f' + (i + 1));
      if (rel) fotos.push({ id: uid(), titulo: String(f.titulo || '').slice(0, 60), foto: rel });
    });
    sala.fotos = fotos;
    if (s.logo) {
      const logo = guardarFotoSala(id, s.logo, '');
      if (logo) sala.foto = logo;
    }
    duenio.telefono = String(s.telefono || duenio.telefono).slice(0, 30);
    const subInfo = getSuscripcionUsuario(state, duenio.id);
    if (!subInfo.puedeCrearSala) {
      return sendJson(res, 403, { error: `Alcanzaste el límite de ${subInfo.limiteSalas} salas de tu ${subInfo.nombrePlan}. Mejora tu plan para agregar más salas.` });
    }
    state.rooms.push(sala);
    avisar(state, duenio.id, 'Solicitud enviada', `Revisamos los datos de “${sala.name}”. Te avisamos cuando sea aprobada.`, 'info');
    /* La administración se entera de cada sala nueva (notificación en la app + mail si está configurado) */
    avisarAdministracion(state, '🏠 Solicitud de sala pendiente',
      `“${sala.name}” · dueño @${duenio.usuario}${duenio.email ? ' · ' + duenio.email : ''}`, 'info');
    const token = crearSesion(state, duenio.id);
    persist(state);
    return sendJson(res, 201, { token, user: usuarioPublico(duenio), room: sala });
  }

  // Consultar si un usuario/email están libres (validación en vivo del registro)
  if (method === 'GET' && url.pathname === '/api/auth/disponible') {
    const u = String(url.searchParams.get('usuario') || '').trim().toLowerCase();
    const e = validarEmail(url.searchParams.get('email') || '');
    const out = {};
    if (u) out.usuarioLibre = !(state.users || []).some(x => x.usuario === u);
    if (e) out.emailLibre = !(state.users || []).some(x => (x.email || '').toLowerCase() === e);
    return sendJson(res, 200, out);
  }

  // Pedido de ayuda (olvidé la contraseña / cuenta bloqueada): llega al panel y al mail de la administración
  if (method === 'POST' && url.pathname === '/api/auth/ayuda') {
    const it = chequearIntento(req, 'ayuda');
    if (it.bloqueado) return sendJson(res, 429, { error: `Demasiados pedidos. Probá de nuevo en ${it.espera} s.` });
    const MOTIVOS = { olvide: 'Olvidé mi contraseña', bloqueada: 'Cuenta bloqueada o desactivada', otro: 'Otro problema' };
    const motivo = MOTIVOS[String(body.motivo)] ? String(body.motivo) : 'otro';
    const ident = String(body.usuario || body.email || '').trim().slice(0, 120);
    if (!ident) return sendJson(res, 400, { error: 'Escribí tu usuario o email para que podamos ubicarte' });
    const mensaje = String(body.mensaje || '').trim().slice(0, 500);
    /* Se busca la cuenta para orientar a la administración, sin revelar si existe (siempre responde el mismo mensaje) */
    const idB = ident.toLowerCase();
    const cuenta = (state.users || []).find(u =>
      u.usuario === idB || (u.email || '').toLowerCase() === idB);
    const solicitud = {
      id: uid(),
      fecha: Date.now(),
      motivo,
      ident,
      mensaje,
      cuenta: cuenta ? { id: cuenta.id, nombre: cuenta.nombre, usuario: cuenta.usuario, email: cuenta.email || '', rol: cuenta.rol, bloqueado: !!cuenta.bloqueado, activo: cuenta.activo !== false } : null,
      estado: 'pendiente',
      resuelta: 0,
    };
    state.ayuda = state.ayuda || [];
    state.ayuda.unshift(solicitud);
    state.ayuda = state.ayuda.slice(0, 200);
    const quien = cuenta ? `@${cuenta.usuario} (${cuenta.nombre})` : ident;
    avisarAdministracion(state, '📥 Pedido de ayuda',
      `${MOTIVOS[motivo]} · ${quien}${cuenta ? ' · ' + (cuenta.email || 'sin email') : ''}${mensaje ? ' — ' + mensaje : ''}`, 'warn');
    persist(state);
    return sendJson(res, 200, { ok: true, mensaje: 'Recibimos tu pedido. La administración te va a escribir para ayudarte.' });
  }

  // Iniciar sesión
  if (method === 'POST' && url.pathname === '/api/auth/login') {
    const it = chequearIntento(req, 'login');
    if (it.bloqueado) return sendJson(res, 429, { error: `Demasiados intentos. Probá de nuevo en ${it.espera} s.` });
    const id = String(body.usuario || body.email || '').trim().toLowerCase();
    const u = (state.users || []).find(x => x.usuario === id || (x.email || '').toLowerCase() === id);
    if (!u || !verifyPassword(body.password, u)) return sendJson(res, 401, { error: 'Usuario o contraseña incorrectos' });
    liberarIntentos(req, 'login');
    if (u.bloqueado) return sendJson(res, 403, { error: 'Tu cuenta está bloqueada. Escribí a la administración de Más Música.' });
    if (u.activo === false) return sendJson(res, 403, { error: 'Tu cuenta está desactivada' });
    u.ultimoAcceso = Date.now();
    const token = crearSesion(state, u.id);
    const sala = salaDelUsuario(state, u);
    persist(state);
    return sendJson(res, 200, { token, user: usuarioPublico(u), room: sala || null });
  }

  // Entrar con el PIN de emergencia (para la cuenta madre si no recuerda la clave)
  if (method === 'POST' && url.pathname === '/api/auth/pin') {
    const it = chequearIntento(req, 'pin');
    if (it.bloqueado) return sendJson(res, 429, { error: `Demasiados intentos. Probá de nuevo en ${it.espera} s.` });
    if (!pinValido(state, body.pin)) {
      return sendJson(res, 401, { error: 'PIN incorrecto' });
    }
    liberarIntentos(req, 'pin');
    const u = (state.users || []).find(x => x.rol === 'SUPER_ADMIN' && !x.bloqueado && x.activo !== false);
    if (!u) return sendJson(res, 403, { error: 'No hay ninguna cuenta de administrador general. Creala con: node server.js --crear-admin' });
    u.ultimoAcceso = Date.now();
    const token = crearSesion(state, u.id);
    persist(state);
    return sendJson(res, 200, { token, user: usuarioPublico(u), room: null });
  }

  if (method === 'POST' && url.pathname === '/api/auth/logout') {
    const u = sesionActual(state, req);
    if (u) {
      cerrarSesiones(state, u.id);
      persist(state);
    }
    return sendJson(res, 200, { ok: true });
  }

  // Sesión actual
  if (method === 'GET' && url.pathname === '/api/auth/me') {
    const u = sesionActual(state, req);
    if (!u) return sendJson(res, 200, { user: null });
    return sendJson(res, 200, { user: usuarioPublico(u), room: salaDelUsuario(state, u) });
  }

  // Actualizar mis datos
  if (method === 'PUT' && url.pathname === '/api/auth/perfil') {
    const u = sesionActual(state, req);
    if (!u) return sendJson(res, 401, { error: 'Iniciá sesión para editar tu perfil' });
    if (body.nombre !== undefined) u.nombre = String(body.nombre).trim().slice(0, 60) || u.nombre;
    if (body.email !== undefined) {
      const mail = validarEmail(body.email);
      if (!mail) return sendJson(res, 400, { error: 'El email no es válido' });
      if ((state.users || []).some(x => x.id !== u.id && (x.email || '').toLowerCase() === mail)) {
        return sendJson(res, 409, { error: 'Ya existe otra cuenta con ese email' });
      }
      u.email = mail;
    }
    if (body.usuario !== undefined) {
      const us = String(body.usuario).trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,24}$/.test(us) || us.length < 3) {
        return sendJson(res, 400, { error: 'El nombre de usuario debe tener 3 a 24 caracteres (a-z, 0-9, . _ -)' });
      }
      if ((state.users || []).some(x => x.id !== u.id && x.usuario === us)) {
        return sendJson(res, 409, { error: 'Ese nombre de usuario ya está en uso' });
      }
      u.usuario = us;
    }
    if (body.telefono !== undefined) u.telefono = String(body.telefono).trim().slice(0, 30);
    if (body.localidad !== undefined) u.localidad = String(body.localidad).trim().slice(0, 80);
    if (body.instrumentos !== undefined) u.instrumentos = listaTexto(body.instrumentos, 8, 40);
    if (body.foto !== undefined) {
      const guardada = guardarFotoUsuario(u.usuario, body.foto, '');
      if (guardada) {
        if (u.foto && u.foto !== guardada) borrarFotoUsuario(u.foto);
        u.foto = guardada;
      } else {
        u.foto = String(body.foto).slice(0, 300);
      }
    }
    if (body.password) {
      if (!verifyPassword(body.actual || '', u)) return sendJson(res, 403, { error: 'La contraseña actual no coincide' });
      if (String(body.password).length < 6) return sendJson(res, 400, { error: 'La contraseña debe tener al menos 6 caracteres' });
      u.pass = hashPassword(body.password);
      /* Cambiar la clave cierra las demás sesiones (solo queda esta) */
      cerrarOtrasSesiones(state, u.id, tokenDeReq(req));
    }
    persist(state);
    return sendJson(res, 200, { user: usuarioPublico(u) });
  }

  // Marcar / desmarcar sala favorita
  if (method === 'PUT' && url.pathname === '/api/auth/favoritos') {
    const u = sesionActual(state, req);
    if (!u) return sendJson(res, 401, { error: 'Iniciá sesión para guardar tus salas favoritas' });
    const room = state.rooms.find(r => r.id === body.roomId);
    if (!room) return sendJson(res, 404, { error: 'Sala no encontrada' });
    u.favoritos = Array.isArray(u.favoritos) ? u.favoritos : [];
    const i = u.favoritos.indexOf(room.id);
    if (i >= 0) u.favoritos.splice(i, 1);
    else u.favoritos.push(room.id);
    persist(state);
    return sendJson(res, 200, { favoritos: u.favoritos, user: usuarioPublico(u) });
  }

  /* ======================= NOTIFICACIONES ======================= */

  if (method === 'GET' && url.pathname === '/api/notificaciones') {
    const u = sesionActual(state, req);
    if (!u) return sendJson(res, 200, { notificaciones: [] });
    const lista = state.notificaciones.filter(n => n.userId === u.id).slice(0, 40);
    return sendJson(res, 200, { notificaciones: lista, sinLeer: lista.filter(n => !n.leida).length });
  }

  if (method === 'POST' && url.pathname === '/api/notificaciones/leer') {
    const u = sesionActual(state, req);
    if (!u) return sendJson(res, 401, { error: 'Iniciá sesión' });
    state.notificaciones.forEach(n => { if (n.userId === u.id) n.leida = true; });
    persist(state);
    return sendJson(res, 200, { ok: true });
  }

  /* ======================= REGISTRO DE BANDAS (público) ======================= */

  if (method === 'POST' && url.pathname === '/api/bands') {
    const { nombre, telefono, foto, fotoGrupal, genero, integrantes } = body;
    if (!nombre || !String(nombre).trim()) return sendJson(res, 400, { error: 'El nombre de la banda es obligatorio' });
    const id = uid();
    const banda = {
      id,
      nombre: String(nombre).trim().slice(0, 60),
      telefono: String(telefono || '').slice(0, 20),
      genero: String(genero || '').slice(0, 40),
      integrantes: normalizarIntegrantes(integrantes),
      foto: guardarFotoBanda(id, foto) || String(foto || '').slice(0, 300) || '',
      fotoGrupal: guardarFotoBanda(id, fotoGrupal, '-grupo') || String(fotoGrupal || '').slice(0, 300) || '',
      createdAt: Date.now(),
    };
    state.bands.push(banda);
    persist(state);
    return sendJson(res, 201, { state: publicState(state) });
  }

  if (method === 'PUT' && P === 'bands' && parts.length === 3) {
    const banda = state.bands.find(x => x.id === parts[2]);
    if (!banda) return sendJson(res, 404, { error: 'Banda no encontrada' });
    const { nombre, telefono, foto, fotoGrupal, genero, integrantes } = body;
    if (!nombre || !String(nombre).trim()) return sendJson(res, 400, { error: 'El nombre de la banda es obligatorio' });
    if (foto !== undefined) {
      const guardada = guardarFotoBanda(banda.id, foto);
      if (guardada) { if (banda.foto && banda.foto !== guardada) borrarFotoBanda(banda.foto); banda.foto = guardada; }
      else banda.foto = String(foto).slice(0, 300);
    }
    if (fotoGrupal !== undefined) {
      const guardada = guardarFotoBanda(banda.id, fotoGrupal, '-grupo');
      if (guardada) { if (banda.fotoGrupal && banda.fotoGrupal !== guardada) borrarFotoBanda(banda.fotoGrupal); banda.fotoGrupal = guardada; }
      else banda.fotoGrupal = String(fotoGrupal).slice(0, 300);
    }
    banda.nombre = String(nombre).trim().slice(0, 60);
    banda.telefono = String(telefono || '').slice(0, 20);
    if (genero !== undefined) banda.genero = String(genero).slice(0, 40);
    if (integrantes !== undefined) banda.integrantes = normalizarIntegrantes(integrantes);
    persist(state);
    return sendJson(res, 200, { state: publicState(state) });
  }

  // Estado completo (sin datos privados)
  if (method === 'GET' && url.pathname === '/api/state') {
    return sendJson(res, 200, publicState(state));
  }

  /* ======================= RESERVAS ======================= */

  if (method === 'POST' && url.pathname === '/api/reserve') {
    const u = sesionActual(state, req);
    const { date, roomId, start, end } = body;
    const name = String(body.name || (u && u.nombre) || '').trim();
    const phone = String(body.phone || (u && u.telefono) || '').trim();
    if (!date || !roomId || !start || !end) return sendJson(res, 400, { error: 'Faltan datos de la reserva' });
    if (!name) return sendJson(res, 400, { error: 'Escribe el nombre o el de la banda' });
    const room = state.rooms.find(r => r.id === roomId && r.activo !== false && r.estado === 'aprobada');
    if (!room) return sendJson(res, 400, { error: 'La sala no existe o no está disponible' });
    const startMin = toMin(start), endMin = toMin(end);
    if (!Number.isInteger(startMin) || !Number.isInteger(endMin)) return sendJson(res, 400, { error: 'Horario inválido' });
    if (!rangoDisponible(state, date, roomId, startMin, endMin)) {
      return sendJson(res, 409, { error: 'Ese horario ya no está disponible' });
    }
    const alquilerCalc = calcularAlquiler(state, body.alquiler, (endMin - startMin) / 60);
    const cobrar = MODO_PAGOS !== 'apagado';
    const reservation = {
      id: uid(), roomId, date, start, end,
      name: name.slice(0, 60),
      phone: phone.slice(0, 20),
      userId: u ? u.id : null,
      estado: cobrar ? 'pendiente_pago' : 'confirmada',
      alquiler: alquilerCalc,
      createdAt: Date.now(),
    };
    if (!cobrar) {
      state.reservations.push(reservation);
      if (u) avisar(state, u.id, 'Reserva confirmada', `${room.name} · ${fmtFechaCorta(date)} · ${start}–${end}`, 'ok', { reservaId: reservation.id, roomId: room.id });
      if (room.ownerId) avisar(state, room.ownerId, 'Nueva reserva', `${reservation.name} reservó ${room.name} el ${fmtFechaCorta(date)}, de ${start} a ${end}`, 'info', { reservaId: reservation.id, roomId: room.id, para: 'dueno' });
      persist(state);
      return sendJson(res, 201, { state: publicState(state), reservation });
    }
    /* Con cobro: la reserva reserva el horario unos minutos hasta que se pague la seña */
    const regs = reglasPago(state);
    Object.assign(reservation, calcularPago(room, startMin, endMin, alquilerCalc, regs), {
      venceEn: Date.now() + regs.minutosPago * 60000,
      pago: { estado: 'pendiente', proveedor: MODO_PAGOS },
    });
    let pago;
    try {
      if (MODO_PAGOS === 'mercadopago') {
        const pref = await crearPreferencia(reservation, room);
        reservation.pago.preferenciaId = pref.id;
        pago = { url: pref.url };
      } else {
        pago = { simulado: true };
      }
    } catch (e) {
      console.error('[pagos] no se pudo crear el pago:', e.message);
      return sendJson(res, 502, { error: 'No pudimos iniciar el pago. Probá de nuevo en unos minutos.' });
    }
    Object.assign(pago, { room_price: reservation.room_price, service_fee: reservation.service_fee, total_amount: reservation.total_amount, total: reservation.total, sena: reservation.sena, saldo: reservation.saldo, venceEn: reservation.venceEn });
    state.reservations.push(reservation);
    if (u) avisar(state, u.id, 'Falta pagar la seña', `${room.name} · ${fmtFechaCorta(date)} · ${start}–${end}. Tenés ${regs.minutosPago} min para pagarla`, 'info', { reservaId: reservation.id, roomId: room.id });
    persist(state);
    return sendJson(res, 201, { state: publicState(state), reservation, pago });
  }

  /* Aviso de Mercado Pago (webhook). Responde rápido y confirma consultando el pago. */
  if (method === 'POST' && url.pathname === '/api/pagos/webhook') {
    if (MODO_PAGOS !== 'mercadopago') return sendJson(res, 200, { ok: true });
    const tipo = (body && body.type) || url.searchParams.get('type') || url.searchParams.get('topic') || '';
    const pagoId = (body && body.data && body.data.id) || url.searchParams.get('data.id') || url.searchParams.get('id');
    if (pagoId && (!tipo || tipo === 'payment')) {
      try {
        const r = await procesarPago(state, pagoId);
        if (r) persist(state);
      } catch (e) {
        console.error('[pagos] webhook:', e.message);
        return sendJson(res, 500, { error: 'reintentar' });   /* Mercado Pago reintenta solo */
      }
    }
    return sendJson(res, 200, { ok: true });
  }

  /* Solo para pruebas (MODO_PAGOS=simulado): aprueba o rechaza la seña de una reserva */
  if (method === 'POST' && url.pathname === '/api/pagos/simular') {
    if (MODO_PAGOS !== 'simulado') return sendJson(res, 404, { error: 'Endpoint no encontrado' });
    const r = state.reservations.find(x => x.id === body.reservaId);
    if (!r || !r.pago) return sendJson(res, 404, { error: 'Reserva no encontrada' });
    await procesarPago(state, 'sim-' + r.id, { external_reference: r.id, transaction_amount: r.sena, status: body.resultado === 'rechazado' ? 'rejected' : 'approved' });
    persist(state);
    return sendJson(res, 200, { state: publicState(state), reservation: r });
  }

  /* Resumen de pagos: administración general (todo) o dueño (solo su sala) */
  if (method === 'GET' && url.pathname === '/api/admin/pagos') {
    const miSala = salaDelUsuario(state, sesionActual(state, req));
    if (!esSuper(state, req) && !miSala) return sendJson(res, 403, { error: 'Sin permiso' });
    return sendJson(res, 200, resumenPagos(state, esSuper(state, req) ? (url.searchParams.get('roomId') || null) : miSala.id));
  }

  /* Marca como liquidado (transferido a la sala) lo que estaba por liquidar */
  if (method === 'POST' && url.pathname === '/api/admin/pagos/liquidar') {
    if (!esSuper(state, req)) return sendJson(res, 403, { error: 'Solo la administración general' });
    let n = 0;
    state.reservations.forEach(r => {
      if (r.roomId === body.roomId && r.pago && r.pago.estado === 'aprobado' && r.estado !== 'cancelada' && !r.pago.liquidadoEn) {
        r.pago.liquidadoEn = Date.now(); n++;
      }
    });
    persist(state);
    return sendJson(res, 200, Object.assign({ liquidadas: n }, resumenPagos(state, body.roomId)));
  }

  if (method === 'POST' && P === 'reservations' && parts[3] === 'cancel') {
    const r = state.reservations.find(x => x.id === parts[2]);
    if (!r) return sendJson(res, 404, { error: 'Reserva no encontrada' });
    const u = sesionActual(state, req);
    const esDueñaDeLaReserva = !!u && (r.userId === u.id || (r.phone && r.phone === u.telefono && r.name === u.nombre));
    if (!esDueñaDeLaReserva) {
      const nameOk = r.name.toLowerCase() === String(body.name || '').trim().toLowerCase();
      const phoneOk = !r.phone || r.phone === String(body.phone || '').trim();
      if (!nameOk || !phoneOk) return sendJson(res, 403, { error: 'Los datos no coinciden con la reserva' });
    } else {
      /* Regla de cancelación configurada por la administración */
      const limite = Math.max(0, parseInt(state.settings.reglas.cancelacionHoras, 10) || 0);
      if (limite > 0) {
        const limiteMin = toMin(r.start);
        const dif = (new Date(r.date + 'T00:00:00').getTime() + limiteMin * 60000) - Date.now();
        if (dif < limite * 3600000) {
          return sendJson(res, 403, { error: `Para cancelar con menos de ${limite} h de anticipación escribí a la sala` });
        }
      }
    }
    /* Seña ya pagada: se devuelve si cancela la sala/administración o si se cancela dentro del plazo */
    if (r.pago && r.pago.estado === 'aprobado') {
      const salaR = state.rooms.find(x => x.id === r.roomId);
      const laSala = !!u && (u.rol === 'SUPER_ADMIN' || (salaR && salaR.ownerId === u.id));
      const lim = Math.max(0, parseInt(state.settings.reglas.cancelacionHoras, 10) || 0);
      const faltaMs = (new Date(r.date + 'T00:00:00').getTime() + toMin(r.start) * 60000) - Date.now();
      const enPlazo = !(lim > 0 && faltaMs < lim * 3600000);
      if (laSala || enPlazo) r.pago.estado = (await reembolsarSena(r)) ? 'reembolsado' : 'reembolso_pendiente';
      else r.pago.estado = 'retenida';
    }
    r.estado = 'cancelada';
    r.cancelada = Date.now();
    r.motivoCancelacion = String(body.motivo || '').slice(0, 120);
    if (r.userId) avisar(state, r.userId, 'Reserva cancelada', `${fmtFechaCorta(r.date)} · ${r.start}–${r.end}`, 'warn', { reservaId: r.id, roomId: r.roomId });
    const room = state.rooms.find(x => x.id === r.roomId);
    if (room && room.ownerId) avisar(state, room.ownerId, 'Reserva cancelada', `${r.name} liberó ${room.name} el ${fmtFechaCorta(r.date)} ${r.start}–${r.end}`, 'warn', { reservaId: r.id, roomId: r.roomId, para: 'dueno' });
    persist(state);
    return sendJson(res, 200, { state: publicState(state) });
  }

  /* ======================= CUENTAS (SUPER_ADMIN) ======================= */

  // Pedidos de ayuda de los usuarios (solo administración general)
  if (url.pathname === '/api/admin/ayuda') {
    if (!esSuper(state, req)) return sendJson(res, 401, { error: 'Acceso solo para la administración general' });
    if (method === 'GET') return sendJson(res, 200, { ayuda: state.ayuda || [] });
    if (method === 'POST') {
      const s = (state.ayuda || []).find(x => x.id === String(body.id || ''));
      if (!s) return sendJson(res, 404, { error: 'Pedido no encontrado' });
      s.estado = 'resuelta';
      s.resuelta = Date.now();
      const admin = sesionActual(state, req);
      s.resueltoPor = admin ? admin.id : '';
      /* Opción del panel: desbloquear/activar la cuenta vinculada al pedido */
      if (body.desbloquear && s.cuenta && s.cuenta.id) {
        const u = (state.users || []).find(x => x.id === s.cuenta.id);
        if (u && u.rol !== 'SUPER_ADMIN') {
          u.bloqueado = false;
          u.activo = true;
          avisar(state, u.id, 'Cuenta habilitada', 'La administración desbloqueó tu cuenta. Ya podés iniciar sesión.', 'ok');
        }
      }
      persist(state);
      return sendJson(res, 200, { state: publicState(state) });
    }
  }

  if (url.pathname.startsWith('/api/admin/usuarios')) {
    if (!esSuper(state, req)) return sendJson(res, 401, { error: 'Acceso solo para la administración general' });
    if (method === 'GET') {
      const lista = (state.users || []).map(u => Object.assign(usuarioPublico(u), {
        telefono: u.telefono || '',
        email: u.email,
        salas: state.rooms.filter(r => r.ownerId === u.id).map(r => ({ id: r.id, name: r.name, estado: r.estado })),
        reservas: state.reservations.filter(r => r.userId === u.id).length,
      }));
      return sendJson(res, 200, { usuarios: lista });
    }
    const u = (state.users || []).find(x => x.id === parts[3]);
    if (!u) return sendJson(res, 404, { error: 'Cuenta no encontrada' });
    if (method === 'PUT') {
      if (body.activo !== undefined) u.activo = body.activo === true;
      if (body.bloqueado !== undefined) u.bloqueado = body.bloqueado === true;
      if (body.rol && ['USER', 'ROOM_ADMIN', 'SUPER_ADMIN'].includes(body.rol)) {
        if (u.id === sesionActual(state, req).id && body.rol !== 'SUPER_ADMIN') {
          return sendJson(res, 400, { error: 'No podés quitarte a vos mismo el acceso de administrador' });
        }
        u.rol = body.rol;
      }
      if (body.password) {
        if (String(body.password).length < 6) return sendJson(res, 400, { error: 'La contraseña debe tener al menos 6 caracteres' });
        u.pass = hashPassword(body.password);
        cerrarSesiones(state, u.id);
      }
      persist(state);
      return sendJson(res, 200, { state: publicState(state), user: usuarioPublico(u) });
    }
    if (method === 'DELETE') {
      const self = sesionActual(state, req);
      if (self && self.id === u.id) return sendJson(res, 400, { error: 'No podés eliminar tu propia cuenta' });
      if (u.rol === 'SUPER_ADMIN' && (state.users || []).filter(x => x.rol === 'SUPER_ADMIN').length <= 1) {
        return sendJson(res, 400, { error: 'Debe quedar al menos una cuenta de administrador general' });
      }
      cerrarSesiones(state, u.id);
      borrarFotoUsuario(u.foto);
      state.users = state.users.filter(x => x.id !== u.id);
      state.notificaciones = state.notificaciones.filter(n => n.userId !== u.id);
      /* Sus salas quedan sin dueño (siguen publicadas) */
      state.rooms.forEach(r => { if (r.ownerId === u.id) r.ownerId = null; });
      persist(state);
      return sendJson(res, 200, { state: publicState(state) });
    }
  }

  /* ======================= APROBACIÓN DE SALAS (SUPER_ADMIN) ======================= */

  if (P === 'admin' && parts[2] === 'solicitudes') {
    if (!esSuper(state, req)) return sendJson(res, 401, { error: 'Acceso solo para la administración general' });
    if (method === 'GET') {
      const salas = state.rooms.map(r => Object.assign({}, r, {
        duenio: (() => {
          const u = (state.users || []).find(x => x.id === r.ownerId);
          return u ? { nombre: u.nombre, usuario: u.usuario, email: u.email, telefono: u.telefono || '' } : null;
        })(),
      }));
      return sendJson(res, 200, { salas });
    }
    const room = state.rooms.find(r => r.id === parts[3]);
    if (!room) return sendJson(res, 404, { error: 'Sala no encontrada' });
    if (method === 'PUT') {
      const accion = String(body.accion || '');
      const motivo = String(body.motivo || '').slice(0, 240);
      if (accion === 'aprobar') { room.estado = 'aprobada'; room.activo = true; }
      else if (accion === 'rechazar') { room.estado = 'rechazada'; room.activo = false; }
      else if (accion === 'corregir') { room.estado = 'pendiente'; }
      else if (accion === 'activar') { room.estado = 'aprobada'; room.activo = true; }
      else if (accion === 'desactivar' || accion === 'suspender') { room.estado = 'suspendida'; room.activo = false; }
      else return sendJson(res, 400, { error: 'Acción no válida' });
      room.solicitud = Object.assign({}, room.solicitud, {
        revisada: Date.now(),
        motivo,
        revisor: (sesionActual(state, req) || {}).nombre || 'administración',
      });
      const textos = {
        aprobar: ['¡Sala aprobada!', `Tu sala “${room.name}” ya está publicada en Más Música.`],
        rechazar: ['Solicitud rechazada', motivo || `Revisá los datos de “${room.name}” y volvé a enviarlos.`],
        corregir: ['Necesitamos correcciones', motivo || `Revisá los datos de “${room.name}”.`],
        activar: ['Sala activada', `“${room.name}” volvió a estar publicada.`],
        desactivar: ['Sala desactivada', `“${room.name}” ya no aparece en las búsquedas.`],
        suspender: ['Sala suspendida', `“${room.name}” fue suspendida por la administración.`],
      };
      if (room.ownerId) avisar(state, room.ownerId, textos[accion][0], textos[accion][1], accion === 'aprobar' ? 'ok' : 'warn');
      persist(state);
      return sendJson(res, 200, { state: publicState(state) });
    }
  }

  /* ======================= PANEL DEL DUEÑO DE LA SALA ======================= */

  if (P === 'panel') {
    const u = sesionActual(state, req);
    if (!u) return sendJson(res, 401, { error: 'Iniciá sesión para entrar a tu panel' });
    const accion = parts[2];
    const salaPropia = salaDelUsuario(state, u);
    /* El dueño administra su sala; el SUPER_ADMIN indica cuál con roomId */
    const salaId = body.roomId || url.searchParams.get('roomId') || (salaPropia && u.rol === 'ROOM_ADMIN' ? salaPropia.id : null);
    const duenio = esDueño(state, req, salaId);
    if (!duenio) return sendJson(res, 403, { error: 'Solo podés administrar tu propia sala' });
    const room = state.rooms.find(r => r.id === salaId);
    if (!room) return sendJson(res, 404, { error: 'Sala no encontrada' });
    const duenioUser = (state.users || []).find(x => x.id === room.ownerId);

    // Datos + reservas + bloqueos de su sala
    if (method === 'GET' && accion === 'sala') {
      const hoy = dateStr(new Date());
      const reservas = state.reservations
        .filter(r => r.roomId === room.id)
        .sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start));
      const activas = r => (r.estado || 'confirmada') !== 'cancelada';
      const futuras = reservas.filter(r => r.date >= hoy && activas(r));
      const ingresos = futuras.reduce((s, r) => s + (toMin(r.end) - toMin(r.start)) / 60 * room.price, 0);
      return sendJson(res, 200, {
        room,
        reservas,
        bloques: state.blocks.filter(b => b.roomId === room.id).sort((a, b) => b.date.localeCompare(a.date)),
        duenio: duenioUser ? usuarioPublico(duenioUser) : null,
        misSalas: u.rol === 'ROOM_ADMIN' ? state.rooms.filter(r => r.ownerId === u.id) : [],
        suscripcion: getSuscripcionUsuario(state, u.id),
        planesDisponibles: PLANES_CONFIG,
        resumen: {
          hoy: reservas.filter(r => r.date === hoy && activas(r)).length,
          proximas: futuras.length,
          ingresos: Math.round(ingresos),
          canceladas: reservas.filter(r => r.estado === 'cancelada').length,
        },
      });
    }

    // Editar la información de su sala
    if (method === 'PUT' && accion === 'sala') {
      const cambios = datosDeSala(body, room);
      Object.assign(room, cambios);
      room.precio = room.price;
      if (body.fotos !== undefined) {
        const viejas = room.fotos || [];
        const nuevas = [];
        (Array.isArray(body.fotos) ? body.fotos : []).slice(0, 10).forEach((f, i) => {
          const ruta = String(f.foto || '');
          const titulo = String(f.titulo || '').slice(0, 60);
          if (ruta.startsWith('assets/salas/')) { nuevas.push({ id: f.id || uid(), titulo, foto: ruta }); return; }
          const rel = guardarFotoSala(room.id, ruta, '-f' + (i + 1));
          if (rel) nuevas.push({ id: uid(), titulo, foto: rel });
        });
        viejas.filter(v => !nuevas.some(n => n.foto === v.foto)).forEach(v => borrarFotoSala(v.foto));
        room.fotos = nuevas;
        if (!room.foto && nuevas.length) room.foto = nuevas[0].foto;
      }
      if (body.logo !== undefined) {
        const logo = guardarFotoSala(room.id, body.logo, '');
        if (logo) { if (room.foto && room.foto !== logo) borrarFotoSala(room.foto); room.foto = logo; }
        else if (body.logo === '') room.foto = '';
      }
      /* Si cambia datos clave, la sala vuelve a revisión */
      if (['name', 'descripcion', 'direccion', 'localidad'].some(k => body[k] !== undefined)) {
        room.solicitud = Object.assign({}, room.solicitud, { fecha: Date.now(), revisada: 0 });
      }
      persist(state);
      return sendJson(res, 200, { state: publicState(state) });
    }

    // Días, horarios y duración de los turnos
    if (method === 'PUT' && accion === 'horario') {
      const h = body.horario;
      if (!h || typeof h !== 'object') return sendJson(res, 400, { error: 'Horarios inválidos' });
      const limpio = horarioVacio();
      for (let i = 0; i < 7; i++) {
        const v = h[String(i)];
        if (!v) continue;
        if (!v.open || !v.close || toMin(v.open) >= toMin(v.close)) {
          return sendJson(res, 400, { error: 'Revisá los horarios de atención' });
        }
        limpio[String(i)] = { open: String(v.open).slice(0, 5), close: String(v.close).slice(0, 5) };
      }
      room.horario = limpio;
      room.horarioPropio = true;
      if (body.turnoMin !== undefined) {
        const t = parseInt(body.turnoMin, 10);
        room.turnoMin = [30, 60, 90, 120].includes(t) ? t : 60;
      }
      persist(state);
      return sendJson(res, 200, { state: publicState(state) });
    }

    // Volver al horario general de la plataforma
    if (method === 'DELETE' && accion === 'horario') {
      room.horarioPropio = false;
      persist(state);
      return sendJson(res, 200, { state: publicState(state) });
    }

    // Bloquear un horario
    if (method === 'POST' && accion === 'bloqueo') {
      const { date, from, to, reason } = body;
      if (!date || !from || !to) return sendJson(res, 400, { error: 'Completa todos los campos' });
      if (toMin(from) >= toMin(to)) return sendJson(res, 400, { error: 'La hora de inicio debe ser anterior al cierre' });
      const dup = state.blocks.some(b => b.roomId === room.id && b.date === date && overlap(toMin(from), toMin(to), toMin(b.from), toMin(b.to)));
      if (dup) return sendJson(res, 409, { error: 'Ya existe un bloqueo que se superpone' });
      state.blocks.push({ id: uid(), roomId: room.id, date, from, to, reason: String(reason || '').slice(0, 120) });
      persist(state);
      return sendJson(res, 201, { state: publicState(state) });
    }

    // Quitar un bloqueo
    if (method === 'DELETE' && accion === 'bloqueo' && parts.length === 4) {
      const n = state.blocks.length;
      state.blocks = state.blocks.filter(x => !(x.id === parts[3] && x.roomId === room.id));
      if (state.blocks.length === n) return sendJson(res, 404, { error: 'Bloqueo no encontrado' });
      persist(state);
      return sendJson(res, 200, { state: publicState(state) });
    }

    // Editar una reserva de su sala
    if (method === 'PUT' && accion === 'reserva' && parts.length === 4) {
      const r = state.reservations.find(x => x.id === parts[3] && x.roomId === room.id);
      if (!r) return sendJson(res, 404, { error: 'Reserva no encontrada' });
      const { date, start, end } = body;
      if (!date || !start || !end) return sendJson(res, 400, { error: 'Faltan datos' });
      if (!rangoDisponible(state, date, room.id, toMin(start), toMin(end), r.id)) {
        return sendJson(res, 409, { error: 'Ese horario ya está ocupado' });
      }
      const antes = `${fmtFechaCorta(r.date)} ${r.start}–${r.end}`;
      Object.assign(r, { date, start, end, estado: 'confirmada', cancelada: 0 });
      if (r.userId) avisar(state, r.userId, 'Reserva modificada por la sala', `Ahora: ${fmtFechaCorta(date)} ${start}–${end} (antes ${antes})`, 'warn', { reservaId: r.id, roomId: r.roomId });
      persist(state);
      return sendJson(res, 200, { state: publicState(state) });
    }

    // Cancelar una reserva de su sala
    if (method === 'DELETE' && accion === 'reserva' && parts.length === 4) {
      const r = state.reservations.find(x => x.id === parts[3] && x.roomId === room.id);
      if (!r) return sendJson(res, 404, { error: 'Reserva no encontrada' });
      r.estado = 'cancelada';
      r.cancelada = Date.now();
      r.motivoCancelacion = String(body.motivo || '').slice(0, 120);
      if (r.userId) avisar(state, r.userId, 'Reserva cancelada por la sala', `${room.name} · ${fmtFechaCorta(r.date)} ${r.start}–${r.end}`, 'warn', { reservaId: r.id, roomId: r.roomId });
      persist(state);
      return sendJson(res, 200, { state: publicState(state) });
    }



    // Crear una nueva sala para este dueño (dentro del límite de su suscripción)
    if (method === 'POST' && accion === 'nueva-sala') {
      const subInfo = getSuscripcionUsuario(state, u.id);
      if (!subInfo.puedeCrearSala) {
        return sendJson(res, 403, { 
          error: `Alcanzaste el límite de ${subInfo.limiteSalas} salas de tu ${subInfo.nombrePlan}. Mejora tu plan para agregar más salas.` 
        });
      }
      const nombreSala = String(body.name || '').trim();
      if (!nombreSala) return sendJson(res, 400, { error: 'Escribe el nombre de la sala' });

      const nueva = salaNueva({
        id: uid(),
        name: nombreSala,
        price: Math.max(1, parseInt(body.price || 10000, 10)),
        ownerId: u.id,
        estado: 'aprobada', // Los dueños aprobados pueden habilitar subsala de inmediato
        activo: true,
        direccion: room.direccion || '',
        localidad: room.localidad || '',
        telefono: room.telefono || u.telefono || '',
        lat: room.lat || null,
        lng: room.lng || null
      });

      state.rooms.push(nueva);
      avisar(state, u.id, 'Sala creada', `Agregaste exitosamente “${nueva.name}”.`, 'ok');
      persist(state);
      return sendJson(res, 201, { state: publicState(state), room: nueva });
    }

    // Cambiar plan de suscripción
    if (method === 'POST' && accion === 'plan') {
      const nuevoPlan = String(body.plan || '').toLowerCase();
      if (!['emprendedor', 'estudio', 'multisala'].includes(nuevoPlan)) {
        return sendJson(res, 400, { error: 'Plan no válido' });
      }
      const salasExtras = Math.max(0, parseInt(body.salasExtra || 0, 10));
      const sub = state.subscriptions.find(s => s.userId === u.id);
      if (sub) {
        sub.plan = nuevoPlan;
        sub.salasExtra = salasExtras;
        sub.fechaCambio = Date.now();
      }
      avisar(state, u.id, 'Plan actualizado', `Tu suscripción se actualizó al ${PLANES_CONFIG[nuevoPlan].nombre}.`, 'ok');
      persist(state);
      return sendJson(res, 200, { state: publicState(state), suscripcion: getSuscripcionUsuario(state, u.id) });
    }

    return sendJson(res, 404, { error: 'Endpoint no encontrado' });
  }

  /* ======================= ADMINISTRACIÓN GENERAL ======================= */

  /* La Comunidad la usan los músicos (rol USER): se atiende al final, antes del 404,
     así que no pasa por este guard. Todo lo demás de aquí abajo es solo administración. */
  if (!esSuper(state, req) && P !== 'comunidad') {
    return sendJson(res, 401, { error: 'PIN incorrecto o sin permisos de administrador' });
  }


  // Panel de Finanzas de la Plataforma (+MÚSICA): comisiones 5% + suscripciones
  if (method === 'GET' && url.pathname === '/api/admin/finanzas') {
    const ahora = Date.now();
    const subs = state.subscriptions || [];
    
    // Ingresos recurrentes mensuales por suscripciones (MRR)
    let totalMRRSuscripciones = 0;
    const suscripcionesDetalle = subs.map(s => {
      const u = (state.users || []).find(x => x.id === s.userId);
      const planInfo = PLANES_CONFIG[s.plan] || PLANES_CONFIG.emprendedor;
      const costo = planInfo.precioMensual + ((s.salasExtra || 0) * PLANES_CONFIG.sala_extra.precioMensual);
      totalMRRSuscripciones += costo;
      const salasCount = (state.rooms || []).filter(r => r.ownerId === s.userId).length;
      return {
        id: s.id,
        duenioNombre: u ? u.nombre : 'Usuario ' + s.userId,
        duenioEmail: u ? u.email : '',
        plan: s.plan,
        nombrePlan: planInfo.nombre,
        salasUsadas: salasCount,
        limiteSalas: planInfo.maxSalas + (s.salasExtra || 0),
        costoMensual: costo,
        estado: s.estado || 'activo',
        vencimiento: s.proximoVencimiento || (ahora + 30 * 86400000)
      };
    });

    // Ingresos por comisiones del 5% del servicio
    let totalComisionesPlataforma = 0;
    let totalBrutoReservas = 0;
    (state.reservations || []).forEach(r => {
      if (r.estado !== 'cancelada') {
        totalBrutoReservas += (r.total_amount || r.total || 0);
        totalComisionesPlataforma += (r.service_fee || r.comision || Math.round((r.total || 0) * 0.05));
      }
    });

    return sendJson(res, 200, {
      moneda: 'ARS',
      totalBrutoReservas,
      totalComisionesPlataforma,
      totalMRRSuscripciones,
      ingresosTotalesPlataforma: totalComisionesPlataforma + totalMRRSuscripciones,
      totalSuscripcionesActivas: subs.length,
      suscripciones: suscripcionesDetalle,
      totalSalasRegistradas: (state.rooms || []).length
    });
  }

  if (method === 'GET' && url.pathname === '/api/admin/verify') {
    return sendJson(res, 200, { ok: true });
  }

  // Editar reserva (cualquier sala)
  if (method === 'PUT' && P === 'reservations' && parts.length === 3) {
    const r = state.reservations.find(x => x.id === parts[2]);
    if (!r) return sendJson(res, 404, { error: 'Reserva no encontrada' });
    const { date, roomId, start, end, name, phone } = body;
    if (!date || !roomId || !start || !end) return sendJson(res, 400, { error: 'Faltan datos' });
    if (!name || !String(name).trim()) return sendJson(res, 400, { error: 'Escribe el nombre o el de la banda' });
    const room = state.rooms.find(x => x.id === roomId && x.activo !== false && x.estado === 'aprobada');
    if (!room) return sendJson(res, 400, { error: 'La sala no existe o no está disponible' });
    if (!rangoDisponible(state, date, roomId, toMin(start), toMin(end), r.id)) {
      return sendJson(res, 409, { error: 'Ese horario ya está ocupado' });
    }
    Object.assign(r, {
      date, roomId, start, end,
      name: String(name).trim().slice(0, 60),
      phone: String(phone || '').slice(0, 20),
      estado: body.estado || r.estado || 'confirmada',
    });
    persist(state);
    return sendJson(res, 200, { state: publicState(state) });
  }

  // Cancelar cualquier reserva
  if (method === 'DELETE' && P === 'reservations' && parts.length === 3) {
    const n = state.reservations.length;
    state.reservations = state.reservations.filter(x => x.id !== parts[2]);
    if (state.reservations.length === n) return sendJson(res, 404, { error: 'Reserva no encontrada' });
    persist(state);
    return sendJson(res, 200, { state: publicState(state) });
  }

  // Crear sala
  if (method === 'POST' && url.pathname === '/api/rooms') {
    const { name, price, capacity, features, active, foto } = body;
    if (!name || !String(name).trim()) return sendJson(res, 400, { error: 'El nombre es obligatorio' });
    const id = uid();
    const room = salaNueva({ id, estado: 'aprobada' });
    Object.assign(room, datosDeSala(body, room));
    room.active = active !== false;
    room.activo = active !== false;
    room.foto = guardarFotoSala(id, foto) || String(foto || '').slice(0, 300) || '';
    state.rooms.push(room);
    persist(state);
    return sendJson(res, 201, { state: publicState(state) });
  }

  // Editar / eliminar sala
  if ((method === 'PUT' || method === 'DELETE') && P === 'rooms' && parts.length === 3) {
    const room = state.rooms.find(x => x.id === parts[2]);
    if (!room) return sendJson(res, 404, { error: 'Sala no encontrada' });
    if (method === 'DELETE') {
      borrarFotoSala(room.foto);
      borrarFotoSala(room.fotoPortada);
      (room.fotos || []).forEach(f => borrarFotoSala(f.foto));
      state.rooms = state.rooms.filter(x => x.id !== parts[2]);
      state.reservations = state.reservations.filter(x => x.roomId !== parts[2]);
      state.blocks = state.blocks.filter(x => x.roomId !== parts[2]);
    } else {
      const { name, price, capacity, features, active, foto, estado } = body;
      if (name !== undefined && !String(name || '').trim()) return sendJson(res, 400, { error: 'El nombre es obligatorio' });
      Object.assign(room, datosDeSala(body, room));
      room.precio = room.price;
      if (active !== undefined) room.activo = active === true;
      if (estado && ['pendiente', 'aprobada', 'rechazada', 'suspendida'].includes(estado)) room.estado = estado;
      if (foto !== undefined) {
        const guardada = guardarFotoSala(room.id, foto);
        if (guardada) { if (room.foto && room.foto !== guardada) borrarFotoSala(room.foto); room.foto = guardada; }
        else room.foto = String(foto).slice(0, 300);
      }
    }
    persist(state);
    return sendJson(res, 200, { state: publicState(state) });
  }

  // ---------- Instrumentos y fotos del lugar ----------

  if (method === 'POST' && url.pathname === '/api/instruments') {
    const { nombre, descripcion, foto, activo, alquiler, precioAlquiler } = body;
    if (!nombre || !String(nombre).trim()) return sendJson(res, 400, { error: 'El nombre es obligatorio' });
    const inst = {
      id: uid(),
      nombre: String(nombre).trim().slice(0, 50),
      descripcion: String(descripcion || '').slice(0, 200),
      foto: String(foto || '').slice(0, 300),
      activo: activo !== false,
      alquiler: alquiler === true,
      precioAlquiler: Math.max(0, parseInt(precioAlquiler, 10) || 0),
    };
    state.instruments.push(inst);
    persist(state);
    return sendJson(res, 201, { state: publicState(state) });
  }

  if ((method === 'PUT' || method === 'DELETE') && P === 'instruments' && parts.length === 3) {
    const inst = state.instruments.find(x => x.id === parts[2]);
    if (!inst) return sendJson(res, 404, { error: 'Instrumento no encontrado' });
    if (method === 'DELETE') {
      state.instruments = state.instruments.filter(x => x.id !== parts[2]);
    } else {
      const { nombre, descripcion, foto, activo, alquiler, precioAlquiler } = body;
      if (!nombre || !String(nombre).trim()) return sendJson(res, 400, { error: 'El nombre es obligatorio' });
      Object.assign(inst, {
        nombre: String(nombre).trim().slice(0, 50),
        descripcion: String(descripcion || '').slice(0, 200),
        foto: String(foto || '').slice(0, 300),
        activo: activo !== false,
        alquiler: alquiler === true,
        precioAlquiler: Math.max(0, parseInt(precioAlquiler, 10) || 0),
      });
    }
    persist(state);
    return sendJson(res, 200, { state: publicState(state) });
  }

  if (method === 'POST' && url.pathname === '/api/place-photos') {
    const { titulo, foto } = body;
    if (!foto || !String(foto).trim()) return sendJson(res, 400, { error: 'La foto es obligatoria' });
    const p = { id: uid(), titulo: String(titulo || '').slice(0, 60), foto: String(foto).trim().slice(0, 300) };
    state.placePhotos.push(p);
    persist(state);
    return sendJson(res, 201, { state: publicState(state) });
  }

  if ((method === 'PUT' || method === 'DELETE') && P === 'place-photos' && parts.length === 3) {
    const p = state.placePhotos.find(x => x.id === parts[2]);
    if (!p) return sendJson(res, 404, { error: 'Foto no encontrada' });
    if (method === 'DELETE') {
      state.placePhotos = state.placePhotos.filter(x => x.id !== parts[2]);
    } else {
      const { titulo, foto } = body;
      if (!foto || !String(foto).trim()) return sendJson(res, 400, { error: 'La foto es obligatoria' });
      Object.assign(p, { titulo: String(titulo || '').slice(0, 60), foto: String(foto).trim().slice(0, 300) });
    }
    persist(state);
    return sendJson(res, 200, { state: publicState(state) });
  }

  // ---------- Promociones y novedades (se resumen en el Inicio) ----------

  if (method === 'POST' && url.pathname === '/api/promociones') {
    const { titulo, texto, activa, desde, hasta, flyer, redes } = body;
    if (!titulo || !String(titulo).trim()) return sendJson(res, 400, { error: 'Escribí el título' });
    const promo = {
      id: uid(),
      titulo: String(titulo).trim().slice(0, 80),
      texto: String(texto || '').slice(0, 400),
      flyer: flyer ? String(flyer) : '',      // flyer de la promo (imagen dataURL)
      redes: redes ? String(redes).slice(0, 500) : '',  // enlaces a redes (separados por espacio)
      activa: activa !== false,
      desde: parseInt(desde, 10) || Date.now(),
      hasta: parseInt(hasta, 10) || (Date.now() + 1000 * 60 * 60 * 24 * 30),
      creado: Date.now(),
    };
    state.promociones.push(promo);
    persist(state);
    return sendJson(res, 201, { state: publicState(state), promocion: promo });
  }

  if ((method === 'PUT' || method === 'DELETE') && P === 'promociones' && parts.length === 3) {
    const promo = state.promociones.find(p => p.id === parts[2]);
    if (!promo) return sendJson(res, 404, { error: 'Promoción no encontrada' });
    if (method === 'DELETE') {
      state.promociones = state.promociones.filter(p => p.id !== parts[2]);
    } else {
      if (body.titulo !== undefined) promo.titulo = String(body.titulo).trim().slice(0, 80) || promo.titulo;
      if (body.texto !== undefined) promo.texto = String(body.texto).slice(0, 400);
      if (body.flyer !== undefined) promo.flyer = body.flyer ? String(body.flyer) : '';
      if (body.redes !== undefined) promo.redes = String(body.redes).slice(0, 500);
      if (body.activa !== undefined) promo.activa = body.activa === true;
      if (body.desde !== undefined) promo.desde = parseInt(body.desde, 10) || promo.desde;
      if (body.hasta !== undefined) promo.hasta = parseInt(body.hasta, 10) || promo.hasta;
    }
    persist(state);
    return sendJson(res, 200, { state: publicState(state) });
  }

  if (method === 'DELETE' && P === 'bands' && parts.length === 3) {
    const banda = state.bands.find(x => x.id === parts[2]);
    if (!banda) return sendJson(res, 404, { error: 'Banda no encontrada' });
    borrarFotoBanda(banda.foto);
    borrarFotoBanda(banda.fotoGrupal);
    state.bands = state.bands.filter(x => x.id !== parts[2]);
    persist(state);
    return sendJson(res, 200, { state: publicState(state) });
  }

  // Horarios generales
  if (method === 'PUT' && url.pathname === '/api/settings/hours') {
    const hours = body.hours;
    if (!hours || typeof hours !== 'object') return sendJson(res, 400, { error: 'Horarios inválidos' });
    for (let i = 0; i < 7; i++) {
      const h = hours[String(i)];
      if (h === null || h === undefined) continue;
      if (!h.open || !h.close || toMin(h.open) >= toMin(h.close)) return sendJson(res, 400, { error: 'Horario inválido' });
    }
    state.settings.hours = hours;
    persist(state);
    return sendJson(res, 200, { state: publicState(state) });
  }

  // Moneda, PIN y reglas
  if (method === 'PUT' && url.pathname === '/api/settings') {
    if (body.currency) state.settings.currency = String(body.currency).slice(0, 3) || '$';
    if (typeof body.gmapsKey === 'string') state.settings.gmapsKey = body.gmapsKey.trim().slice(0, 200);
    if (body.pin) {
      if (String(body.pin).length < 4) return sendJson(res, 400, { error: 'El PIN debe tener al menos 4 caracteres' });
      state.settings.pinHash = hashPassword(String(body.pin));
      delete state.settings.adminPin; /* nunca queda el PIN en texto plano */
    }
    if (body.reglas) {
      const r = body.reglas;
      state.settings.reglas = {
        cancelacionHoras: Math.max(0, Math.min(168, parseInt(r.cancelacionHoras, 10) || 0)),
        avisoHoras: Math.max(1, Math.min(72, parseInt(r.avisoHoras, 10) || 24)),
        turnos: Array.isArray(r.turnos) && r.turnos.length ? r.turnos.map(Number) : REGlas_DEFAULT.turnos,
        senaPorcentaje: numEntre(r.senaPorcentaje, 1, 100, reglasPago(state).senaPorcentaje),
        comisionPorcentaje: numEntre(r.comisionPorcentaje, 0, 100, reglasPago(state).comisionPorcentaje),
        minutosPago: numEntre(r.minutosPago, 5, 60, reglasPago(state).minutosPago),
      };
    }
    /* Contacto: redes + email. El email recibe los avisos de registros y pedidos de ayuda. */
    if (body.contacto && typeof body.contacto === 'object') {
      const c = state.settings.contacto = state.settings.contacto || {};
      ['whatsapp', 'instagram', 'facebook', 'tiktok'].forEach(k => {
        if (body.contacto[k] !== undefined) c[k] = String(body.contacto[k]).trim().replace(/[<>]/g, '').slice(0, 60);
      });
      if (body.contacto.email !== undefined) {
        const mail = validarEmail(body.contacto.email);
        c.email = mail;   /* si no es válido queda vacío (nunca un mail inventado) */
      }
    }
    persist(state);
    return sendJson(res, 200, { state: publicState(state) });
  }

  // Bloquear horario
  if (method === 'POST' && url.pathname === '/api/blocks') {
    const { roomId, date, from, to, reason } = body;
    if (!roomId || !date || !from || !to) return sendJson(res, 400, { error: 'Completa todos los campos' });
    if (toMin(from) >= toMin(to)) return sendJson(res, 400, { error: 'La hora de inicio debe ser anterior al cierre' });
    const dup = state.blocks.some(b => b.roomId === roomId && b.date === date && overlap(toMin(from), toMin(to), toMin(b.from), toMin(b.to)));
    if (dup) return sendJson(res, 409, { error: 'Ya existe un bloqueo que se superpone' });
    state.blocks.push({ id: uid(), roomId, date, from, to, reason: String(reason || '').slice(0, 120) });
    persist(state);
    return sendJson(res, 201, { state: publicState(state) });
  }

  if (method === 'DELETE' && P === 'blocks' && parts.length === 3) {
    const n = state.blocks.length;
    state.blocks = state.blocks.filter(x => x.id !== parts[2]);
    if (state.blocks.length === n) return sendJson(res, 404, { error: 'Bloqueo no encontrado' });
    persist(state);
    return sendJson(res, 200, { state: publicState(state) });
  }

  // Importar datos
  if (method === 'PUT' && url.pathname === '/api/state') {
    if (!body || !Array.isArray(body.rooms) || !Array.isArray(body.reservations) || !body.settings) {
      return sendJson(res, 400, { error: 'Archivo inválido' });
    }
    state.rooms = body.rooms.map(migrarSala);
    state.reservations = body.reservations;
    state.blocks = Array.isArray(body.blocks) ? body.blocks : [];
    if (Array.isArray(body.instruments)) state.instruments = body.instruments;
    if (Array.isArray(body.placePhotos)) state.placePhotos = body.placePhotos;
    if (body.settings.currency) state.settings.currency = String(body.settings.currency).slice(0, 3) || '$';
    if (body.settings.hours) state.settings.hours = body.settings.hours;
    if (body.settings.reglas) state.settings.reglas = body.settings.reglas;
    if (typeof body.settings.gmapsKey === 'string') state.settings.gmapsKey = body.settings.gmapsKey.trim().slice(0, 200);
    persist(state);
    return sendJson(res, 200, { state: publicState(state) });
  }

  if (method === 'POST' && url.pathname === '/api/demo') {
    const demo = defaultState();
    demo.users = state.users;
    demo.sessions = state.sessions;
    persist(demo);
    return sendJson(res, 200, { state: publicState(demo) });
  }

  if (method === 'POST' && url.pathname === '/api/reset') {
    const limpio = {
      settings: state.settings,
      users: state.users,
      sessions: [],
      notificaciones: [],
      mensajes: [],
      rooms: [], reservations: [], blocks: [], instruments: [], placePhotos: [], bands: [],
    };
    persist(limpio);
    return sendJson(res, 200, { state: publicState(limpio) });
  }

  /* ======================= COMUNIDAD (solo músicos) ======================= */
  if (P === 'comunidad') {
    const u = sesionActual(state, req);
    if (!u || u.rol !== 'USER') return sendJson(res, 403, { error: 'La comunidad es solo para cuentas de músico' });
    const txt = s => String(s == null ? '' : s).trim();
    const low = s => txt(s).toLowerCase();
    const musicoMini = x => ({
      id: x.id, nombre: x.nombre, usuario: x.usuario, foto: x.foto || '',
      localidad: x.localidad || '',
      instrumentos: Array.isArray(x.instrumentos) ? x.instrumentos.slice(0, 12) : [],
    });
    const sigoA = (mi, id) => Array.isArray(mi.following) && mi.following.includes(id);
    const seguidoresDe = id => (state.users || []).filter(x => Array.isArray(x.following) && x.following.includes(id)).length;
    const musicosActivos = () => (state.users || []).filter(x => x.rol === 'USER' && x.id !== u.id && x.activo !== false && !x.bloqueado);

    /* Directorio de músicos (con buscador y filtro por zona) */
    if (method === 'GET' && url.pathname === '/api/comunidad/musicos') {
      const q = low(url.searchParams.get('q'));
      const zona = low(url.searchParams.get('zona'));
      let lista = musicosActivos().map(x => Object.assign(musicoMini(x), {
        siguiendo: sigoA(u, x.id),
        seguidores: seguidoresDe(x.id),
        meSigue: sigoA(x, u.id),
      }));
      if (q) lista = lista.filter(m => low(m.nombre).includes(q) || low(m.usuario).includes(q) || m.instrumentos.some(i => low(i).includes(q)));
      if (zona) lista = lista.filter(m => low(m.localidad).includes(zona));
      const miZona = low(u.localidad);
      lista.sort((a, b) => {
        const za = miZona && low(a.localidad) === miZona ? 0 : 1;
        const zb = miZona && low(b.localidad) === miZona ? 0 : 1;
        if (za !== zb) return za - zb;
        return String(a.nombre).localeCompare(String(b.nombre));
      });
      return sendJson(res, 200, { musicos: lista.slice(0, 300), miLocalidad: u.localidad || '' });
    }

    /* Seguir / dejar de seguir */
    if (method === 'POST' && url.pathname === '/api/comunidad/seguir') {
      const otro = musicosActivos().find(x => x.id === txt(body.userId));
      if (!otro) return sendJson(res, 404, { error: 'Músico no encontrado' });
      if (!Array.isArray(u.following)) u.following = [];
      const i = u.following.indexOf(otro.id);
      let siguiendo;
      if (i >= 0) { u.following.splice(i, 1); siguiendo = false; }
      else {
        u.following.push(otro.id); siguiendo = true;
        avisar(state, otro.id, 'Nuevo seguidor', `@${u.usuario} empezó a seguirte.`, 'info');
      }
      persist(state);
      return sendJson(res, 200, { siguiendo, seguidores: seguidoresDe(otro.id) });
    }

    /* Bandeja de conversaciones */
    if (method === 'GET' && url.pathname === '/api/comunidad/conversaciones') {
      const msgs = (state.mensajes || []).filter(m => m.de === u.id || m.para === u.id);
      const por = {};
      msgs.forEach(m => {
        const otroId = m.de === u.id ? m.para : m.de;
        const c = por[otroId] = por[otroId] || { userId: otroId, ultimo: null, sinLeer: 0 };
        if (!c.ultimo || m.fecha > c.ultimo.fecha) c.ultimo = m;
        if (m.para === u.id && !m.leido) c.sinLeer++;
      });
      const conversaciones = Object.keys(por).map(k => {
        const c = por[k];
        const otro = (state.users || []).find(x => x.id === c.userId) || {};
        return {
          userId: c.userId,
          nombre: otro.nombre || 'Músico',
          usuario: otro.usuario || '',
          foto: otro.foto || '',
          localidad: otro.localidad || '',
          ultimo: c.ultimo ? { texto: c.ultimo.texto, fecha: c.ultimo.fecha, mio: c.ultimo.de === u.id } : null,
          sinLeer: c.sinLeer,
        };
      }).sort((a, b) => ((b.ultimo && b.ultimo.fecha) || 0) - ((a.ultimo && a.ultimo.fecha) || 0));
      return sendJson(res, 200, {
        conversaciones,
        sinLeer: msgs.filter(m => m.para === u.id && !m.leido).length,
      });
    }

    /* Hilo de mensajes con un músico (marca como leídos los recibidos) */
    if (method === 'GET' && url.pathname === '/api/comunidad/mensajes') {
      const otro = musicosActivos().find(x => x.id === txt(url.searchParams.get('con')));
      if (!otro) return sendJson(res, 404, { error: 'Músico no encontrado' });
      let cambio = false;
      (state.mensajes || []).forEach(m => {
        if (m.de === otro.id && m.para === u.id && !m.leido) { m.leido = true; cambio = true; }
      });
      if (cambio) persist(state);
      const hilo = (state.mensajes || [])
        .filter(m => (m.de === u.id && m.para === otro.id) || (m.de === otro.id && m.para === u.id))
        .sort((a, b) => a.fecha - b.fecha)
        .map(m => ({ id: m.id, texto: m.texto, fecha: m.fecha, mio: m.de === u.id }));
      return sendJson(res, 200, { musico: musicoMini(otro), mensajes: hilo, siguiendo: sigoA(u, otro.id) });
    }

    /* Enviar mensaje */
    if (method === 'POST' && url.pathname === '/api/comunidad/mensajes') {
      const otro = musicosActivos().find(x => x.id === txt(body.para));
      const texto = txt(body.texto).slice(0, 600);
      if (!otro) return sendJson(res, 404, { error: 'Músico no encontrado' });
      if (!texto) return sendJson(res, 400, { error: 'Escribí un mensaje' });
      state.mensajes = state.mensajes || [];
      const m = { id: uid(), de: u.id, para: otro.id, texto, fecha: Date.now(), leido: false };
      state.mensajes.push(m);
      avisar(state, otro.id, `Mensaje de @${u.usuario}`, texto.slice(0, 120), 'info');
      persist(state);
      return sendJson(res, 201, { mensaje: { id: m.id, texto: m.texto, fecha: m.fecha, mio: true } });
    }

    /* A quiénes sigo y quiénes me siguen */
    if (method === 'GET' && url.pathname === '/api/comunidad/siguiendo') {
      const sigo = (u.following || [])
        .map(id => musicosActivos().find(x => x.id === id))
        .filter(Boolean).map(musicoMini);
      const meSiguen = (state.users || [])
        .filter(x => x.rol === 'USER' && x.id !== u.id && x.activo !== false && !x.bloqueado && sigoA(x, u.id))
        .map(musicoMini);
      return sendJson(res, 200, { sigo, meSiguen });
    }

    return sendJson(res, 404, { error: 'Endpoint de comunidad no encontrado' });
  }

  return sendJson(res, 404, { error: 'Endpoint no encontrado' });
}

/* Aplica los campos del formulario de sala sobre una sala existente */
function datosDeSala(body, prev = {}) {
  const out = {};
  if (body.name !== undefined) out.name = String(body.name).trim().slice(0, 60);
  if (body.price !== undefined || body.precio !== undefined) {
    out.price = Math.max(1, parseInt(body.price !== undefined ? body.price : body.precio, 10) || prev.price || 10000);
  }
  if (body.capacity !== undefined) out.capacity = Math.max(1, parseInt(body.capacity, 10) || prev.capacity || 1);
  if (body.features !== undefined) out.features = listaTexto(body.features, 20, 60);
  if (body.descripcion !== undefined) out.descripcion = String(body.descripcion).slice(0, 600);
  if (body.direccion !== undefined) out.direccion = String(body.direccion).slice(0, 160);
  if (body.localidad !== undefined) out.localidad = String(body.localidad).slice(0, 80);
  if (body.mapa !== undefined) out.mapa = String(body.mapa).slice(0, 300);
  if (body.lat !== undefined) {
    const lat = body.lat === null || body.lat === '' ? null : Number(body.lat);
    out.lat = Number.isFinite(lat) ? lat : null;
  }
  if (body.lng !== undefined) {
    const lng = body.lng === null || body.lng === '' ? null : Number(body.lng);
    out.lng = Number.isFinite(lng) ? lng : null;
  }
  if (body.telefono !== undefined) out.telefono = String(body.telefono).slice(0, 30);
  /* Foto horizontal de la sala (se guarda como archivo si viene en data URL) */
  if (body.fotoPortada !== undefined) {
    const ruta = guardarFotoSala(prev.id || uid(), body.fotoPortada, '-portada')
      || String(body.fotoPortada || '').slice(0, 300);
    if (prev.fotoPortada && prev.fotoPortada !== ruta) borrarFotoSala(prev.fotoPortada);
    out.fotoPortada = ruta;
  }
  if (body.equipos !== undefined) {
    const e = body.equipos || {};
    out.equipos = {
      instrumentos: String(e.instrumentos || '').slice(0, 300),
      amplificadores: String(e.amplificadores || '').slice(0, 300),
      bateria: String(e.bateria || '').slice(0, 300),
      microfonos: String(e.microfonos || '').slice(0, 300),
      consola: String(e.consola || '').slice(0, 300),
      otros: String(e.otros || '').slice(0, 300),
    };
  }
  if (body.horario && typeof body.horario === 'object') {
    const limpio = Object.assign(horarioVacio(), prev.horario || {});
    for (let i = 0; i < 7; i++) {
      const v = body.horario[String(i)];
      if (v === null || v === undefined) continue;
      if (v.open && v.close && toMin(v.open) < toMin(v.close)) limpio[String(i)] = { open: String(v.open).slice(0, 5), close: String(v.close).slice(0, 5) };
    }
    out.horario = limpio;
  }
  if (body.turnoMin !== undefined) {
    const t = parseInt(body.turnoMin, 10);
    out.turnoMin = [30, 60, 90, 120].includes(t) ? t : 60;
  }
  return out;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function fmtFechaCorta(ds) {
  const [y, m, d] = String(ds).split('-').map(Number);
  return `${d} de ${MESES[(m || 1) - 1]}`;
}

/* ================= Servidor ================= */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const parts = url.pathname.split('/').filter(Boolean);
  /* HSTS: si el tráfico llega por HTTPS (p. ej. detrás de un túnel), pide HTTPS siempre */
  if ((req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }
  try {
    if (parts[0] === 'api') return await handleApi(req, res, url, parts);
    return serveStatic(req, res, url);
  } catch (e) {
    console.error('[server]', e);
    /* No se envía el detalle del error al cliente: evita filtrar rutas o archivos internos */
    sendJson(res, 500, { error: 'Error interno del servidor. Probá de nuevo en unos minutos.' });
  }
});

/* Creación segura de la cuenta madre (no existe en el registro público) */
function crearAdminDesdeCLI(argv) {
  const state = loadState();
  const usuario = String(argv[0] || process.env.ADMIN_USUARIO || 'admin').trim().toLowerCase();
  const email = validarEmail(argv[1] || process.env.ADMIN_EMAIL || `${usuario}@masmusica.app`);
  const pass = String(argv[2] || process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url'));
  if ((state.users || []).some(u => u.usuario === usuario)) {
    console.log(`✖ Ya existe una cuenta con el usuario "${usuario}".`);
    process.exit(1);
  }
  state.users.push({
    id: uid(),
    nombre: String(process.env.ADMIN_NOMBRE || 'Administración Más Música'),
    usuario,
    email,
    telefono: '',
    pass: hashPassword(pass),
    foto: '',
    localidad: '',
    instrumentos: [],
    rol: 'SUPER_ADMIN',
    activo: true,
    bloqueado: false,
    favoritos: [],
    creado: Date.now(),
    ultimoAcceso: 0,
  });
  persist(state);
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  CUENTA MADRE CREADA (SUPER_ADMIN)        ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`  Usuario:     ${usuario}`);
  console.log(`  Email:       ${email}`);
  console.log(`  Contraseña:  ${pass}`);
  console.log('  Entrá en la app con estos datos (o con el PIN).');
  return true;
}

if (process.argv.includes('--crear-admin')) {
  const i = process.argv.indexOf('--crear-admin');
  crearAdminDesdeCLI(process.argv.slice(i + 1));
} else {
  server.listen(PORT, () => {
    const state = loadState();
    const creada = asegurarSuperAdmin(state);
    console.log(`🎸 Más Música corriendo en http://localhost:${PORT}`);
    if (creada) { /* la cuenta madre se muestra abajo */ }
    else if (verificarClave('1234', state.settings.pinHash)) {
      console.log('⚠  ATENCIÓN: el PIN de administración sigue siendo el "1234" (el de fábrica).');
      console.log('   Cambialo YA desde Configuración: cualquiera que lo sepa entra como administrador.');
    }
    console.log(`   Datos guardados en: ${DATA_FILE}`);
    if (creada) {
      console.log('');
      console.log('╔════════════════════════════════════════════════════╗');
      console.log('║  CUENTA MADRE (SUPER_ADMIN) — anotá estos datos    ║');
      console.log('╠════════════════════════════════════════════════════╣');
      console.log(`║  Usuario:     ${creada.usuario.padEnd(42)}║`);
      console.log(`║  Contraseña:  ${creada.password.padEnd(42)}║`);
      console.log('║  Guardalos: son la clave general de la plataforma. ║');
      console.log('╚════════════════════════════════════════════════════╝');
    } else {
      console.log(`   Cuentas: ${state.users.filter(u => u.rol === 'SUPER_ADMIN').length} administrador(es) general(es)`);
    }
  });
}