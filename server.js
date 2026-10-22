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
 *   POST /api/resenas                   { roomId, estrellas, texto } escribir/actualizar mi reseña (quien reservó en la sala)
 *   DELETE /api/resenas/:id             borrar mi reseña
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
const COMUNIDAD_DIR = path.join(PUBLIC_DIR, 'assets', 'comunidad');

/* ================= Imágenes ================= */

/* Las fotos llegan como data URL y se guardan como archivo
   (así data.json y las respuestas de /api/state quedan livianos). */
function guardarImagen(id, dataUrl, sufijo, subcarpeta) {
  const s = String(dataUrl || '').trim();
  const m = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(s);
  if (!m) return null; /* no es data URL: se guarda como ruta/enlace */
  const tipo = m[1].toLowerCase().replace(/^jpeg$/, 'jpg'); // "jpeg" y "jpg" son el mismo formato
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
  /* Cada subida lleva un sello único en el nombre. Si el nombre fuera siempre el mismo
     (por ejemplo assets/salas/<sala>.jpg), al cambiar la foto el navegador seguiría
     mostrando la imagen vieja guardada en caché: la ruta no cambia y reusa la misma. */
  const sello = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const rel = `assets/${subcarpeta}/${idLimpio}${sufLimpio}-${sello}.${ext}`;
  fs.writeFileSync(path.join(PUBLIC_DIR, rel), buf);
  return rel;
}
const guardarFotoBanda = (id, d, s) => guardarImagen(id, d, s, 'bandas');
const guardarFotoSala = (id, d, s) => guardarImagen(id, d, s, 'salas');
const guardarFotoUsuario = (id, d, s) => guardarImagen(id, d, s, 'usuarios');
const guardarFotoComunidad = (id, d, s) => guardarImagen(id, d, s, 'comunidad');

/* Los videos cortos del chat llegan como data URL (mp4/webm) y se guardan como archivo. */
function guardarVideo(id, dataUrl, sufijo, subcarpeta) {
  const s = String(dataUrl || '').trim();
  const m = /^data:video\/(mp4|webm|quicktime|x-m4v);base64,([A-Za-z0-9+/=]+)$/i.exec(s);
  if (!m) return null; /* no es data URL de video */
  const tipo = m[1].toLowerCase();
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > 15 * 1024 * 1024) return null;
  /* Magic bytes: mp4/mov/m4v llevan "ftyp" en el offset 4; webm arranca con EBML 1A 45 DF A3. */
  const esMp4 = buf.slice(4, 8).toString('ascii') === 'ftyp';
  const esWebm = buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
  const esVideo = ((tipo === 'mp4' || tipo === 'quicktime' || tipo === 'x-m4v') && esMp4) || (tipo === 'webm' && esWebm);
  if (!esVideo) return null;
  const ext = tipo === 'webm' ? 'webm' : 'mp4';
  const idLimpio = String(id || 'x').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 80);
  const sufLimpio = String(sufijo || '').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 20);
  fs.mkdirSync(path.join(PUBLIC_DIR, 'assets', subcarpeta), { recursive: true });
  const sello = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const rel = `assets/${subcarpeta}/${idLimpio}${sufLimpio}-${sello}.${ext}`;
  fs.writeFileSync(path.join(PUBLIC_DIR, rel), buf);
  return rel;
}
const guardarVideoComunidad = (id, d, s) => guardarVideo(id, d, s, 'comunidad');

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

/* Resultado de guardar una foto: si se guardó como archivo, su ruta; si no, la
   ruta o enlace tal cual. Un data URL que no se pudo guardar se descarta: guardarlo
   recortado dejaría una imagen rota. */
function fotoORuta(valor, guardada) {
  if (guardada) return guardada;
  const v = String(valor || '').trim();
  return v.startsWith('data:') ? '' : v.slice(0, 300);
}

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

/* Suscripción al chat global para músicos: solo plan mensual */
const CHAT_PLAN_CONFIG = {
  mensual: { id: 'mensual', nombre: 'Chat Global - Mensual', precioMensual: 5000, moneda: 'ARS', duracionDias: 30 }
};

/* IVA de la suscripción: el precio ($5.000) es FINAL, con IVA incluido.
   Se desglosa para poder facturar: neto = precio / 1,21 ; iva = precio - neto. */
const IVA_ALICUOTA = 0.21;
const desglosarIva = (precioFinal) => {
  const total = Math.round(Number(precioFinal) || 0);
  const neto = Math.round(total / (1 + IVA_ALICUOTA));
  return { total, neto, iva: total - neto };
};

/* Versión vigente de los Términos y condiciones: se guarda en la cuenta al registrarse */
const TERMINOS_VERSION = '2026-10-19';

/* ================= Moderación de texto (Chat Global) =================
   Filtra lenguaje ofensivo, spam y contenido inapropiado.
   Si se configura OPENAI_API_KEY, usa moderación avanzada con IA.
   Si no, usa una lista de palabras y patrones prohibidos. */
const PALABRAS_PROHIBIDAS = [
  'puto', 'puta', 'mierda', 'carajo', 'boludo', 'pelotudo', 'forro', 'concha',
  'verga', 'pinga', 'orto', 'culiao', 'marica', 'trolo', 'travesti',
  'nazi', 'hitler', 'matar', 'violar', 'asesinar',
];
const PATRONES_PROHIBIDOS = [
  /\b\d{4,}\b/,           /* números largos (posible spam de teléfono) */
  /(.)\1{4,}/,            /* misma letra repetida 5+ veces (spam) */
  /https?:\/\/\S+/i,      /* links externos (spam) */
];

function moderarTexto(texto) {
  const t = String(texto || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  /* Palabras prohibidas (con variantes de leet speak) */
  const tLimpio = t.replace(/[0@4]/g, 'a').replace(/[1!|]/g, 'i').replace(/[3]/g, 'e').replace(/[5$]/g, 's').replace(/[7]/g, 't').replace(/[8]/g, 'b');
  for (const p of PALABRAS_PROHIBIDAS) {
    if (tLimpio.includes(p)) return { ok: false, motivo: 'Tu mensaje contiene lenguaje inapropiado. Revisá las reglas del chat.' };
  }
  /* Patrones prohibidos */
  for (const pat of PATRONES_PROHIBIDOS) {
    if (pat.test(texto)) return { ok: false, motivo: 'Tu mensaje contiene contenido no permitido (links, spam o repetición).' };
  }
  /* Mensajes muy cortos con solo símbolos */
  if (texto.length > 0 && /^[\s\W]+$/.test(texto)) return { ok: false, motivo: 'Tu mensaje no tiene contenido válido.' };
  return { ok: true };
}

/* Verificar si un usuario tiene acceso al chat global */
function tieneAccesoChat(state, userId) {
  if (!userId) return false;
  const u = (state.users || []).find(x => x.id === userId);
  if (!u) return false;
  /* Los administradores tienen acceso siempre */
  if (u.rol === 'SUPER_ADMIN') return true;
  /* Verificar suscripción al chat */
  const sub = (state.chatSubscriptions || []).find(s => s.userId === userId && s.estado === 'activo');
  if (!sub) return false;
  /* Verificar si no venció */
  return sub.venceEn > Date.now();
}

/* Activar o renovar la suscripción al chat (una vez confirmado el pago).
   Si renueva antes de vencer, extiende desde el vencimiento actual: no pierde días. */
function activarSuscripcionChat(state, userId, plan, pago) {
  state.chatSubscriptions = state.chatSubscriptions || [];
  const config = CHAT_PLAN_CONFIG[plan] || CHAT_PLAN_CONFIG.mensual;
  const venceEn = Date.now() + config.duracionDias * 24 * 3600 * 1000;

  let sub = state.chatSubscriptions.find(s => s.userId === userId);
  if (sub) {
    const desde = sub.venceEn > Date.now() ? sub.venceEn : Date.now();
    sub.venceEn = desde + config.duracionDias * 24 * 3600 * 1000;
    sub.plan = plan;
    sub.estado = 'activo';
    sub.fechaRenovacion = Date.now();
    if (pago) sub.pago = pago;
  } else {
    sub = {
      id: uid(),
      userId,
      plan,
      estado: 'activo',
      fechaInicio: Date.now(),
      venceEn,
      pago: pago || { estado: 'aprobado', fecha: Date.now() },
    };
    state.chatSubscriptions.push(sub);
  }
  return sub;
}

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

const REGlas_DEFAULT = { cancelacionHoras: 0, turnos: [30, 60, 90, 120], avisoHoras: 24, recordatorioHoras: 24, senaPorcentaje: 30, comisionPorcentaje: 8, minutosPago: 15 };

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const toMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
/* Una reserva ya pasó si su fecha es anterior a hoy, o si es hoy y su fin ya pasó */
function esReservaPasada(r) {
  const hoy = dateStr(new Date());
  if (r.date < hoy) return true;
  if (r.date > hoy) return false;
  const ahora = new Date();
  return toMin(r.end) <= ahora.getHours() * 60 + ahora.getMinutes();
}
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
    numero: '',
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
    /* Datos de cobro: a dónde se le transfiere a la sala lo que le corresponde
       de cada seña (seña menos comisión). Solo lo ven la sala y la administración. */
    cobro: { titular: '', alias: '', cvu: '', banco: '' },
    /* Catálogo de equipos propio de la sala (con foto, descripción y si se alquila).
       Cada ítem: { id, nombre, descripcion, foto, alquiler, precioAlquiler } */
    catalogo: [],
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
    resenas: [],         /* reseñas de los músicos sobre las salas donde reservaron */
    chatGlobal: [],
    chatDirecto: [],
    chatSubscriptions: [],
    chatSolicitudes: [],
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

/* Normaliza el catálogo de equipos de una sala (lista de ítems con nombre,
   descripción, foto y, si se alquila, el precio por hora). */
const MAX_CATALOGO_POR_SALA = 40;
function normalizarCatalogo(lista) {
  if (!Array.isArray(lista)) return [];
  return lista.slice(0, MAX_CATALOGO_POR_SALA).map(it => ({
    id: String((it && it.id) || uid()).slice(0, 40),
    nombre: String((it && it.nombre) || '').trim().slice(0, 60),
    descripcion: String((it && it.descripcion) || '').trim().slice(0, 200),
    foto: String((it && it.foto) || '').slice(0, 300),
    alquiler: !!(it && it.alquiler),
    precioAlquiler: Math.max(0, parseInt(it && it.precioAlquiler, 10) || 0),
  })).filter(it => it.nombre);
}

/* Datos de cobro de la sala (a dónde se transfiere lo que le corresponde) */
function normalizarCobro(c) {
  const o = (c && typeof c === 'object') ? c : {};
  return {
    titular: String(o.titular || '').trim().slice(0, 80),
    alias: String(o.alias || '').trim().slice(0, 60),
    cvu: String(o.cvu || '').replace(/[^\d]/g, '').slice(0, 22),
    banco: String(o.banco || '').trim().slice(0, 80),
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
  out.cobro = normalizarCobro(r.cobro);
  out.catalogo = normalizarCatalogo(r.catalogo);
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
  out.numero = String(r.numero || '').slice(0, 12);
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
      if (!Array.isArray(data.resenas)) { data.resenas = []; cambiado = true; }
      /* Suscripciones y solicitudes de pago del Chat Global */
      if (!Array.isArray(data.chatSubscriptions)) { data.chatSubscriptions = []; cambiado = true; }
      if (!Array.isArray(data.chatSolicitudes)) { data.chatSolicitudes = []; cambiado = true; }
      /* Plazo del recordatorio antes del ensayo (0 = apagado) */
      if (data.settings.reglas && data.settings.reglas.recordatorioHoras === undefined) {
        data.settings.reglas.recordatorioHoras = REGlas_DEFAULT.recordatorioHoras;
        cambiado = true;
      }
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
  copiaDeSeguridadDiaria();
}

/* ================= Copia de seguridad de los datos =================
   Una vez por día (la primera vez que se guarda algo) se guarda una copia
   de data.json en la carpeta "backups". Se conservan las últimas 7.     */
const DIAS_BACKUP = 7;
const CARPETA_BACKUPS = path.join(__dirname, 'backups');
let ultimoBackup = '';

function copiaDeSeguridadDiaria() {
  try {
    const clave = dateStr(new Date());
    if (clave === ultimoBackup) return;
    if (!fs.existsSync(CARPETA_BACKUPS)) fs.mkdirSync(CARPETA_BACKUPS);
    const destino = path.join(CARPETA_BACKUPS, `data-${clave}.json`);
    if (!fs.existsSync(destino)) {
      fs.copyFileSync(DATA_FILE, destino);
      /* Se guardan solo los últimos DIAS_BACKUP archivos */
      const todos = fs.readdirSync(CARPETA_BACKUPS).filter(n => /^data-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
      todos.slice(0, Math.max(0, todos.length - DIAS_BACKUP))
        .forEach(n => { try { fs.unlinkSync(path.join(CARPETA_BACKUPS, n)); } catch (e) {} });
      console.log('[backup] copia del día guardada: backups/' + path.basename(destino));
    }
    ultimoBackup = clave;
  } catch (e) { console.error('[backup] no se pudo guardar la copia diaria:', e.message); }
}

/* Estado que se envía al cliente (sin PIN, sin cuentas ni sesiones, y con privacidad en reservas) */
function publicState(state, req) {
  const admin = req ? esSuper(state, req) : false;
  const u = req ? sesionActual(state, req) : null;
  const miSala = (u && !admin) ? salaDelUsuario(state, u) : null;
  const miUserId = u ? u.id : null;
  const miTel = u ? String(u.telefono || '').trim() : '';

  /* Lista blanca: solo se expone lo que la app necesita. Nunca datos privados
     (usuarios, sesiones, notificaciones, pedidos de ayuda con emails, solicitudes
     de pago, suscripciones crudas, etc.). */
  const resto = {
    settings: state.settings,
    promociones: state.promociones || [],
    blocks: state.blocks || [],
    bands: state.bands || [],
    placePhotos: state.placePhotos || [],
  };

  const reservations = (state.reservations || []).map(r => {
    // 1. Super Administrador ve todas las reservas con datos completos
    if (admin) {
      const { pago, ...x } = r;
      return pago ? { ...x, pagoEstado: pago.estado } : x;
    }
    // 2. Dueño de sala ve reservas completas de su propia sala
    if (miSala && r.roomId === miSala.id) {
      const { pago, ...x } = r;
      return pago ? { ...x, pagoEstado: pago.estado } : x;
    }
    // 3. Usuario dueño de la reserva ve su propia reserva completa (para "Mis reservas")
    if (miUserId && (r.userId === miUserId || (miTel && r.phone && r.phone === miTel))) {
      const { pago, ...x } = r;
      return pago ? { ...x, pagoEstado: pago.estado } : x;
    }
    // 4. Visitante público o cualquier otro usuario: se ocultan datos personales (nombre real, teléfono, email, notas, pago)
    return {
      id: r.id,
      roomId: r.roomId,
      date: r.date,
      start: r.start,
      end: r.end,
      estado: r.estado,
      name: 'Reservado',
    };
  });

  return {
    ...resto,
    rooms: (state.rooms || []).map(r => {
      const conP = Object.assign({}, r, { puntaje: puntajeSala(state, r.id) });
      /* Los datos de cobro son privados: solo los ve el dueño de la sala o la administración */
      const puedeVerCobro = admin || (miSala && r.id === miSala.id) || (miUserId && r.ownerId === miUserId);
      if (!puedeVerCobro) delete conP.cobro;
      return conP;
    }),
    resenas: (state.resenas || []).slice(-300).map(resenaPublica),
    reservations,
    settings: {
      currency: state.settings.currency,
      hours: state.settings.hours,
      reglas: state.settings.reglas || REGlas_DEFAULT,
      gmapsKey: String(state.settings.gmapsKey || ''), // clave pública de Google Maps (se restringe por referrer)
      contacto: state.settings.contacto || { whatsapp: '', instagram: '', facebook: '', email: '', tiktok: '' },
      avisoMail: !!RESEND_KEY, // si hay clave de Resend, los avisos llegan por mail además de la app
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

/* Alquiler de equipos: el servidor calcula el precio (es la autoridad).
   El catálogo es el de la sala elegida. */
function calcularAlquiler(state, ids, horas, roomId) {
  if (!Array.isArray(ids) || !ids.length) return [];
  const room = (state.rooms || []).find(r => r.id === roomId);
  const catalogo = (room && Array.isArray(room.catalogo)) ? room.catalogo : [];
  const h = Math.max(1, Math.round(horas));
  return ids.slice(0, 12).map(id => {
    const inst = catalogo.find(i => i.id === id && i.alquiler);
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

/* Solo se confía en x-forwarded-for cuando la conexión viene de un proxy/túnel
   propio (loopback o el rango del túnel). Así nadie puede falsificar la cabecera
   desde afuera para saltarse el freno de fuerza bruta. */
const PROXIES_CONFIABLES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
function esProxyConfiable(req) {
  const dir = String(req.socket.remoteAddress || '');
  if (PROXIES_CONFIABLES.has(dir)) return true;
  const extra = String(process.env.TRUST_PROXY_IPS || '').split(',').map(s => s.trim()).filter(Boolean);
  return extra.includes(dir);
}
function ipDeReq(req) {
  if (esProxyConfiable(req)) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd.slice(0, 64);
  }
  return String(req.socket.remoteAddress || '?').slice(0, 64);
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

/* Freno general de escritura: limita cuántas peticiones que cambian datos puede
   mandar una misma IP en una ventana. No distingue éxito/fallo (es contra el
   abuso: spam de reservas, reseñas, chat, etc.), con un tope holgado para el uso
   normal. */
const ESCRITURA_LIMITE = 120;                 /* peticiones de escritura por ventana */
const ESCRITURA_VENTANA = 5 * 60 * 1000;      /* en 5 minutos */
const escrituraPorIP = new Map();
function limitarEscritura(req) {
  const k = ipDeReq(req);
  const ahora = Date.now();
  let e = escrituraPorIP.get(k);
  if (!e || e.reset <= ahora) { e = { n: 0, reset: ahora + ESCRITURA_VENTANA }; }
  e.n++;
  escrituraPorIP.set(k, e);
  /* Limpieza liviana para que el mapa no crezca sin control */
  if (escrituraPorIP.size > 5000) {
    for (const [kk, vv] of escrituraPorIP) { if (vv.reset <= ahora) escrituraPorIP.delete(kk); }
  }
  return { bloqueado: e.n > ESCRITURA_LIMITE, espera: Math.ceil((e.reset - ahora) / 1000) };
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
    emailVerificado: !!u.emailVerificado,
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
 * Si no hay clave de Resend, el aviso igual llega dentro de la app.
 *   RESEND_API_KEY  clave de la API (panel de Resend → API Keys)
 *   RESEND_FROM     remitente (defecto: onboarding@resend.dev, que solo envía
 *                   al dueño de la cuenta hasta verificar un dominio propio)
 * La clave también se puede guardar en el archivo local "resend.key" (una sola
 * línea, sin espacios): así queda activada siempre, sin variables de entorno.
 * El destinatario es el email de contacto cargado en los ajustes.
 */
/* Clave de Resend: variable de entorno o, si no está, archivo local "resend.key" */
function leerClaveResend() {
  const deEnv = String(process.env.RESEND_API_KEY || '').trim();
  if (deEnv) return deEnv;
  try {
    const txt = fs.readFileSync(path.join(__dirname, 'resend.key'), 'utf8');
    return String(txt).split(/\r?\n/)[0].trim();
  } catch (e) { return ''; }
}
/* Remitente de los mails, en este orden:
     1. variable de entorno RESEND_FROM
     2. archivo local "resend.from" (una línea, ej: Más Música <reservas@masmusica.app>)
     3. onboarding@resend.dev (el de prueba de Resend: hoy solo entrega al mail de la cuenta)
   Cuando verifiques un dominio propio en Resend, creá el archivo "resend.from"
   con la dirección de ese dominio y los mails de reserva salen con tu nombre. */
function leerRemitente() {
  const deEnv = String(process.env.RESEND_FROM || '').trim();
  if (deEnv) return deEnv;
  try {
    const linea = String(fs.readFileSync(path.join(__dirname, 'resend.from'), 'utf8')).split(/\r?\n/)[0].trim();
    if (linea) return linea;
  } catch (e) { /* no está el archivo: se usa el de prueba */ }
  return 'Más Música <onboarding@resend.dev>';
}
const RESEND_KEY = leerClaveResend();
const RESEND_FROM = leerRemitente();

/* Logo de la app para los emails (URL absoluta) */
function logoMail() {
  const base = BASE_URL || '';
  return base ? `<img src="${base}/assets/logo_musica.png" alt="Más Música" width="48" height="48" style="border-radius:12px;margin-bottom:12px;" />` : '';
}

/* Envuelve el HTML del mail con el logo y un pie común */
function htmlMail(cuerpo) {
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#16263d;">
    ${logoMail()}
    <h2 style="margin:0 0 12px;color:#007d2c;font-size:1.3rem;">Más Música</h2>
    ${cuerpo}
    <hr style="border:none;border-top:1px solid #dde5ec;margin:24px 0 12px;">
    <p style="font-size:.8rem;color:#5b6b7d;margin:0;">Salas de ensayo · Más Música<br>
    <a href="${BASE_URL || ''}" style="color:#007d2c;">Abrir la app</a></p>
  </div>`;
}

async function enviarMail(para, asunto, texto, html) {
  if (!RESEND_KEY || !para || !validarEmail(para)) return false;
  try {
    const cuerpo = { from: RESEND_FROM, to: [para], subject: asunto, text: texto };
    if (html) cuerpo.html = html;
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    if (!r.ok) console.error('[mail]', r.status, String(await r.text().catch(() => '')).slice(0, 300));
    return r.ok;
  } catch (e) { console.error('[mail]', e.message); return false; }
}

/* Email de destino de los avisos (el de contacto, si está cargado) */
function emailDeAvisos(state) {
  return (state.settings && state.settings.contacto && state.settings.contacto.email) || '';
}

/* ================= Mails de confirmación de reserva ================= */

/* Arma el asunto y el texto del mail de una reserva.
   esDueno=false → para el cliente que reservó;  esDueno=true → para el dueño de la sala */
function mailReserva(state, r, room, esDueno) {
  const [yy] = String(r.date).split('-');
  const cuando = `${fmtFechaCorta(r.date)} de ${yy}`;
  const horario = `${r.start} a ${r.end}`;
  const sala = room ? room.name : 'la sala';
  const dir = room && (room.direccion || room.localidad)
    ? [room.direccion, room.localidad].filter(Boolean).join(', ')
    : '';

  if (esDueno) {
    return {
      asunto: `Nueva reserva · ${sala} · ${cuando}`,
      texto:
        `Te reservaron ${sala}.\n\n` +
        `Banda o músico: ${r.name}\n` +
        `Día: ${cuando}\n` +
        `Horario: ${horario}\n` +
        `Teléfono: ${r.phone || 'sin teléfono'}\n\n` +
        `Podés ver todas tus reservas en el panel de Más Música.`,
    };
  }

  return {
    asunto: `Reserva confirmada · ${sala} · ${cuando}`,
    texto:
      `¡Listo! Tu reserva quedó confirmada.\n\n` +
      `Sala: ${sala}${dir ? '\nDirección: ' + dir : ''}\n` +
      `Día: ${cuando}\n` +
      `Horario: ${horario}\n` +
      `A nombre de: ${r.name}\n\n` +
      `Si tenés que cancelar, hacelo desde «Mis reservas» en la app.\n\n` +
      `¡Buen ensayo!\nMás Música`,
  };
}

/* Manda el mail de confirmación al cliente y, si lo tiene cargado, al dueño de la sala.
   Nunca interrumpe la reserva: si el mail falla, la reserva igual queda hecha. */
function avisarReservaPorMail(state, r) {
  const room = (state.rooms || []).find(x => x.id === r.roomId);
  const cliente = r.userId ? (state.users || []).find(u => u.id === r.userId) : null;
  const dueno = (room && room.ownerId) ? (state.users || []).find(u => u.id === room.ownerId) : null;
  if (cliente) {
    const m = mailReserva(state, r, room, false);
    enviarMail(validarEmail(cliente.email), m.asunto, m.texto).catch(() => {});
  }
  if (dueno) {
    const m = mailReserva(state, r, room, true);
    enviarMail(validarEmail(dueno.email), m.asunto, m.texto).catch(() => {});
  }
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
    emailVerificado: false,
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

/* Modelo de negocio oficial +MÚSICA (ver PAGOS.md):
 * room_price: valor base de la sala + alquiler de instrumentos = total que paga la banda
 * sena:       lo que la banda paga al reservar (senaPorcentaje del total)
 * saldo:      el resto del total, que se paga en la sala
 * comision:   lo que se queda +MÚSICA (comisionPorcentaje del total), descontado de la seña
 * paraSala:   lo que se le liquida a la sala por la seña (seña menos comisión)
 */
function calcularPago(room, startMin, endMin, alquiler, regs) {
  const horas = (endMin - startMin) / 60;
  const room_price = Math.round(room.price * horas) + (alquiler || []).reduce((s, a) => s + a.total, 0);
  const sena = Math.round(room_price * regs.senaPorcentaje / 100);
  const comision = Math.round(room_price * regs.comisionPorcentaje / 100);
  return {
    room_price,
    total_amount: room_price,
    total: room_price,
    sena,
    saldo: room_price - sena,
    comision,
    paraSala: sena - comision,
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

/* Preferencia de pago para la suscripción mensual al Chat Global.
   Paga el músico ($5.000 final, IVA incluido). El acceso se activa cuando el
   webhook confirma el pago (ver procesarPagoSuscripcion). */
async function crearPreferenciaSuscripcion(solicitud, u) {
  const pref = await mpFetch('/checkout/preferences', {
    method: 'POST',
    body: {
      items: [{
        title: `Suscripción Chat Global · ${solicitud.planNombre}`.slice(0, 120),
        quantity: 1,
        unit_price: solicitud.monto,
        currency_id: MP_MONEDA,
      }],
      payer: u && u.email ? { email: u.email } : undefined,
      external_reference: solicitud.id,
      back_urls: {
        success: `${BASE_URL}/?chat=ok`,
        pending: `${BASE_URL}/?chat=pendiente`,
        failure: `${BASE_URL}/?chat=error`,
      },
      auto_return: 'approved',
      notification_url: `${BASE_URL}/api/pagos/webhook`,
      statement_descriptor: 'MASMUSICA',
      expires: true,
      expiration_date_to: new Date(solicitud.venceEn).toISOString(),
    },
  });
  const sandbox = MP_TOKEN.startsWith('TEST-');
  return { id: pref.id, url: (sandbox ? pref.sandbox_init_point : pref.init_point) || pref.init_point || pref.sandbox_init_point };
}

const consultarPago = id => mpFetch('/v1/payments/' + encodeURIComponent(id));

/* Activa la suscripción al chat cuando llega el pago aprobado.
   El pago se verifica siempre contra Mercado Pago con nuestro token. */
async function procesarPagoSuscripcion(state, solicitud, pago, pagoId) {
  const u = (state.users || []).find(x => x.id === solicitud.userId);
  if (u) {
    const sub = activarSuscripcionChat(state, solicitud.userId, solicitud.plan, {
      estado: 'aprobado', pagoId: String(pagoId || ''), pagadoEn: Date.now(), monto: solicitud.monto,
    });
    solicitud.estado = 'pagada';
    solicitud.pagadoEn = Date.now();
    solicitud.pagoId = String(pagoId || '');
    solicitud.ivaDiscriminado = desglosarIva(solicitud.monto);
    avisar(state, u.id, '¡Suscripción activada!', `Tu acceso al Chat Global está activo hasta ${new Date(sub.venceEn).toLocaleDateString('es-AR')}.`, 'ok');
  }
  return true;
}

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
/* Máximo de reseñas que una misma cuenta puede dejar en la misma sala */
const MAX_RESENAS_POR_SALA = 10;
/* Una reserva tentativa (armada desde el chat) se libera sola si la sala no la confirma */
const HORAS_TENTATIVA = Number(process.env.TENTATIVA_HORAS) > 0 ? Number(process.env.TENTATIVA_HORAS) : 24;
const MS_TENTATIVA = HORAS_TENTATIVA * 3600 * 1000;
/* Si pasa la mitad del plazo y la sala todavía no respondió, se le manda un recordatorio (una sola vez) */
const HORAS_RECORDATORIO = Number(process.env.RECORDATORIO_HORAS) > 0 ? Number(process.env.RECORDATORIO_HORAS) : Math.max(1, HORAS_TENTATIVA / 2);
const MS_RECORDATORIO = HORAS_RECORDATORIO * 3600 * 1000;

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
    } else if (r.estado === 'tentativa' && (r.createdAt || 0) + MS_TENTATIVA < ahora) {
      r.estado = 'cancelada';
      r.cancelada = ahora;
      r.motivoCancelacion = 'Tentativa vencida (la sala no la confirmó a tiempo)';
      const room = state.rooms.find(x => x.id === r.roomId);
      const detalle = `${room ? room.name : 'Sala'} · ${fmtFechaCorta(r.date)} · ${r.start}–${r.end}`;
      const avisarIds = new Set([r.userId, ...(r.invitados || [])].filter(Boolean));
      avisarIds.forEach(id => avisar(state, id, 'La reserva tentativa venció', `${detalle} · la sala no la confirmó a tiempo`, 'warn', { reservaId: r.id, roomId: r.roomId }));
      if (room && room.ownerId) avisar(state, room.ownerId, 'Reserva tentativa vencida', `${r.name} · ${detalle} · se liberó el horario`, 'info', { reservaId: r.id, roomId: r.roomId, para: 'dueno' });
      cambio = true;
    } else if (r.estado === 'tentativa' && (!r.recordado || !r.recordadoOrg) && (r.createdAt || 0) + MS_RECORDATORIO < ahora && (r.createdAt || 0) + MS_TENTATIVA >= ahora) {
      /* Pasó la mitad del plazo y la sala todavía no respondió: se avisa a la sala y al organizador */
      const room = state.rooms.find(x => x.id === r.roomId);
      const detalle = `${room ? room.name : 'Sala'} · ${fmtFechaCorta(r.date)} · ${r.start}–${r.end}`;
      const horasRestantes = Math.max(1, Math.round(((r.createdAt || 0) + MS_TENTATIVA - ahora) / 3600000));
      if (!r.recordado) {
        r.recordado = ahora;
        cambio = true;
        if (room && room.ownerId) avisar(state, room.ownerId, 'Te falta responder una reserva tentativa', `${r.name} · ${detalle} · quedan ~${horasRestantes} h para confirmarla o rechazarla. Si no respondés, el horario se libera.`, 'warn', { reservaId: r.id, roomId: r.roomId, para: 'dueno' });
      }
      if (!r.recordadoOrg) {
        r.recordadoOrg = ahora;
        cambio = true;
        if (r.userId) avisar(state, r.userId, 'La sala todavía no confirmó tu reserva', `${detalle} · quedan ~${horasRestantes} h. Si no responden, el horario se libera. Si ya no la necesitás, podés desistir desde el chat.`, 'warn', { reservaId: r.id, roomId: r.roomId });
      }
    }
  });
  /* Solicitudes de pago de la suscripción al chat que vencieron sin pagarse */
  (state.chatSolicitudes || []).forEach(s => {
    if (s.estado === 'pendiente' && s.venceEn && s.venceEn < ahora) {
      s.estado = 'vencida';
      cambio = true;
    }
  });
  if (cambio) persist(state);
  /* Aprovechamos cada pedido para revisar también los recordatorios: si toca
     mandar uno, sale aunque el temporizador todavía no haya pasado. */
  enviarRecordatorios(state);
}
/* ================= Recordatorio antes del ensayo ================= */

/* Fecha y hora de una reserva ("2026-10-23" + "16:00") en milisegundos */
const fechaHoraMs = (ds, hm) => {
  const [y, m, d] = String(ds || '').split('-').map(Number);
  const [hh, mm] = String(hm || '').split(':').map(Number);
  if (!y || !m || !d || isNaN(hh) || isNaN(mm)) return 0;
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
};

const mailRecordatorio = (state, r, room) => {
  const [yy] = String(r.date).split('-');
  const cuando = `${fmtFechaCorta(r.date)} de ${yy}`;
  const sala = room ? room.name : 'la sala';
  const dir = room && (room.direccion || room.localidad)
    ? [room.direccion, room.localidad].filter(Boolean).join(', ')
    : '';
  return {
    asunto: `Se acerca tu ensayo · ${sala} · ${cuando}`,
    texto:
      `Te recordamos tu ensayo en ${sala}.\n\n` +
      `Día: ${cuando}\n` +
      `Horario: ${r.start} a ${r.end}\n` +
      `A nombre de: ${r.name}\n` +
      (dir ? `Dirección: ${dir}\n` : '') +
      `\nSi no lo vas a usar, cancelalo desde «Mis reservas» así liberás el horario.\n\n` +
      `¡Buen ensayo!\nMás Música`,
  };
};

/* Avisa al músico que reservó (y a quienes se anotaron) unas horas antes de
   que empiece. Una sola vez por reserva: queda marcada con recordatorioUsuario.
   Con recordatorioHoras en 0 está apagado. */
function enviarRecordatorios(state) {
  const horas = Number((state.settings.reglas || {}).recordatorioHoras);
  if (!horas || horas <= 0) return false;
  const ahora = Date.now();
  const ventana = horas * 3600 * 1000;
  let cambio = false;
  (state.reservations || []).forEach(r => {
    if (r.estado !== 'confirmada' || r.recordatorioUsuario) return;
    const inicio = fechaHoraMs(r.date, r.start);
    if (!inicio) return;
    const falta = inicio - ahora;
    if (falta <= 0 || falta > ventana) return;

    r.recordatorioUsuario = ahora;
    cambio = true;

    const room = state.rooms.find(x => x.id === r.roomId);
    const detalle = `${room ? room.name : 'Sala'} · ${fmtFechaCorta(r.date)} · ${r.start}–${r.end}`;
    const cuantas = Math.max(1, Math.round(falta / 3600000));
    const texto = `${detalle} · empieza en ~${cuantas} h. ¡Ojo con llegar tarde!`;

    /* Aviso en la app: al que reservó y a los que se anotaron */
    const ids = new Set([r.userId, ...(r.invitados || [])].filter(Boolean));
    /* También avisar al dueño de la sala */
    if (room && room.ownerId) ids.add(room.ownerId);
    ids.forEach(id => avisar(state, id, 'Se acerca tu ensayo', texto, 'ok', { reservaId: r.id, roomId: r.roomId }));

    /* Y por mail, si el músico tiene email cargado (nunca interrumpe si falla) */
    const m = mailRecordatorio(state, r, room);
    ids.forEach(id => {
      const u = (state.users || []).find(x => x.id === id);
      if (u) enviarMail(validarEmail(u.email), m.asunto, m.texto).catch(() => {});
    });
  });
  if (cambio) persist(state);
  return cambio;
}

/* ================= Reseñas de las salas ================= */

/* Una reseña por cuenta y sala. La puede escribir quien reservó ahí. */
const resenaPublica = x => ({
  id: x.id,
  roomId: x.roomId,
  estrellas: Number(x.estrellas) || 0,
  texto: String(x.texto || '').slice(0, 500),
  usuario: String(x.usuario || '').slice(0, 24),
  fecha: x.fecha || 0,
});

const puntajeSala = (state, roomId) => {
  const lista = (state.resenas || []).filter(x => x.roomId === roomId);
  if (!lista.length) return { promedio: 0, total: 0 };
  const suma = lista.reduce((a, b) => a + (Number(b.estrellas) || 0), 0);
  return { promedio: Math.round((suma / lista.length) * 10) / 10, total: lista.length };
};

function confirmarPorPago(state, r, pagoId) {
  r.estado = 'confirmada';
  delete r.cancelada;
  delete r.motivoCancelacion;
  r.pago = Object.assign(r.pago || {}, { estado: 'aprobado', pagoId: String(pagoId || ''), pagadoEn: Date.now() });
  const room = state.rooms.find(x => x.id === r.roomId);
  const detalle = `${room ? room.name : 'Sala'} · ${fmtFechaCorta(r.date)} · ${r.start}–${r.end}`;
  if (r.userId) avisar(state, r.userId, 'Reserva confirmada', `${detalle} · Seña recibida`, 'ok', { reservaId: r.id, roomId: r.roomId });
  if (room && room.ownerId) avisar(state, room.ownerId, 'Nueva reserva', `${r.name} reservó ${room.name} el ${fmtFechaCorta(r.date)}, de ${r.start} a ${r.end} (seña pagada)`, 'info', { reservaId: r.id, roomId: r.roomId, para: 'dueno' });
  avisarReservaPorMail(state, r);
}

/* Procesa el aviso de pago. Siempre se consulta el pago a Mercado Pago con nuestro token,
   así nadie puede falsificar un aviso. */
async function procesarPago(state, pagoId, datos) {
  const pago = datos || await consultarPago(pagoId);

  /* ¿Es el pago de una suscripción al chat? (las solicitudes usan "chat:" como prefijo) */
  const ref = String(pago.external_reference || '');
  if (ref.startsWith('chat:')) {
    const solicitud = (state.chatSolicitudes || []).find(x => x.id === ref);
    if (!solicitud) return null;
    if (Number(pago.transaction_amount) !== Number(solicitud.monto)) {
      console.error('[pagos] monto inesperado en la suscripción al chat ' + solicitud.id);
      return null;
    }
    if (pago.status === 'approved') {
      if (solicitud.estado === 'pagada') return true;
      return await procesarPagoSuscripcion(state, solicitud, pago, pagoId);
    }
    if (['rejected', 'cancelled'].includes(pago.status)) solicitud.estado = 'rechazada';
    return solicitud;
  }

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
    const f = porSala[k] = porSala[k] || { roomId: k, sala: room ? room.name : k, cobro: normalizarCobro(room && room.cobro), cobrado: 0, comision: 0, paraSala: 0, liquidado: 0, porLiquidar: 0 };
    if (r.pago.estado === 'aprobado' && r.estado !== 'cancelada') {
      f.cobrado += r.sena; f.comision += r.comision; f.paraSala += r.paraSala;
      if (r.pago.liquidadoEn) f.liquidado += r.paraSala; else f.porLiquidar += r.paraSala;
    }
  });
  /* Suscripciones al Chat Global cobradas con Mercado Pago (dato para facturar el IVA).
     Se listan las solicitudes PAGADAS (ingreso real) y las pendientes/vencidas. */
  const solicitudes = (state.chatSolicitudes || []).filter(s => s.estado === 'pagada');
  const subsChat = solicitudes.map(s => {
    const u = (state.users || []).find(x => x.id === s.userId);
    const d = desglosarIva(s.monto);
    return {
      id: s.id,
      usuario: u ? u.usuario : '',
      nombre: u ? u.nombre : '',
      email: u ? u.email : '',
      plan: s.plan,
      planNombre: s.planNombre || (CHAT_PLAN_CONFIG[s.plan] || CHAT_PLAN_CONFIG.mensual).nombre,
      total: d.total,
      neto: d.neto,
      iva: d.iva,
      pagadoEn: s.pagadoEn || s.creada || null,
      pagoId: s.pagoId || (s.pago && s.pago.pagoId) || null,
    };
  }).sort((a, b) => (b.pagadoEn || 0) - (a.pagadoEn || 0));

  const totalChat = subsChat.reduce((s, x) => s + x.total, 0);
  const totalChatNeto = subsChat.reduce((s, x) => s + x.neto, 0);
  const totalChatIva = subsChat.reduce((s, x) => s + x.iva, 0);

  return {
    modo: MODO_PAGOS,
    salas: Object.values(porSala),
    reservas: filas.map(r => ({
      id: r.id, roomId: r.roomId, date: r.date, start: r.start, end: r.end, name: r.name, estado: r.estado,
      total: r.total, sena: r.sena, comision: r.comision, paraSala: r.paraSala, saldo: r.saldo,
      pago: r.pago.estado, liquidadoEn: r.pago.liquidadoEn || null,
    })),
    chat: {
      ivaAlicuota: IVA_ALICUOTA,
      precioMensual: CHAT_PLAN_CONFIG.mensual.precioMensual,
      cantidad: subsChat.length,
      total: totalChat,
      neto: totalChatNeto,
      iva: totalChatIva,
      suscripciones: subsChat,
    },
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
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
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
      if (data.length > 30e6) { req.destroy(); terminar(); } // fotos y videos cortos llegan como data URL
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
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

/* Política de seguridad del contenido (CSP) para el HTML.
   - script-src: la app usa scripts en línea (tema, fallback) y manejadores onclick,
     por eso hace falta 'unsafe-inline'; el resto son los orígenes externos reales
     (Leaflet desde unpkg y la API de Google Maps).
   - img/connect: solo lo que la app usa (self, data:, blobs, tiles de OpenStreetMap,
     Google Maps y el geocodificador de OpenStreetMap).
   - object-src 'none': nada de plugins/embeds.
   - frame-ancestors 'none': nadie puede incrustar la app (anti clickjacking).
   - base-uri 'self' y form-action 'self': evita secuestro de <base> y envíos a otro sitio. */
const CSP_HTML = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://unpkg.com https://maps.googleapis.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://tile.openstreetmap.org https://*.basemaps.cartocdn.com https://maps.googleapis.com https://maps.gstatic.com https://*.googleapis.com https://*.ggpht.com",
  "connect-src 'self' https://nominatim.openstreetmap.org https://maps.googleapis.com",
  "media-src 'self' data: blob:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

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
    const ext = path.extname(file).toLowerCase();
    const cabeceras = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      /* El HTML nunca se guarda: así el celular siempre toma la última versión.
         El CSS/JS llevan ?v=… en index.html para forzar la descarga cuando cambian. */
      'Cache-Control': ext === '.html' ? 'no-store, no-cache, must-revalidate' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    };
    /* La CSP solo se manda al HTML: define qué puede cargar la página.
       Bloquea scripts/imágenes/conexiones de orígenes desconocidos, impide
       incrustar la app en otro sitio y prohíbe <object>/<embed> y cambiar la base. */
    if (ext === '.html') cabeceras['Content-Security-Policy'] = CSP_HTML;
    res.writeHead(200, cabeceras);
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

  /* Freno general: si una misma IP manda demasiadas peticiones que cambian datos
     (POST/PUT/PATCH/DELETE), se corta por un rato. */
  if (method !== 'GET' && method !== 'HEAD') {
    const lim = limitarEscritura(req);
    if (lim.bloqueado) return sendJson(res, 429, { error: `Demasiadas peticiones. Probá de nuevo en ${lim.espera} s.` });
  }

  /* ======================= CHAT DIRECTO (1 a 1) ======================= */

  /* Listar conversaciones del usuario */
  if (method === 'GET' && url.pathname === '/api/chat-directo/conversaciones') {
    const u = sesionActual(state, req);
    if (!u) return sendJson(res, 401, { error: 'Iniciá sesión' });
    const msgs = (state.chatDirecto || []).filter(m => m.de === u.id || m.para === u.id);
    const contactos = new Map();
    msgs.forEach(m => {
      const otro = m.de === u.id ? m.para : m.de;
      const anterior = contactos.get(otro);
      if (!anterior || m.fecha > anterior.ultimo) {
        contactos.set(otro, { userId: otro, ultimo: m.fecha, ultimoTexto: m.texto || '', sinLeer: 0 });
      }
    });
    /* Contar no leídos */
    msgs.forEach(m => {
      if (m.para === u.id && !m.leido) {
        const c = contactos.get(m.de);
        if (c) c.sinLeer++;
      }
    });
    const lista = [...contactos.values()].map(c => {
      const usr = (state.users || []).find(x => x.id === c.userId);
      return {
        userId: c.userId,
        nombre: usr ? usr.nombre : 'Usuario',
        usuario: usr ? usr.usuario : '??',
        foto: usr ? (usr.foto || '') : '',
        ultimo: c.ultimo,
        ultimoTexto: c.ultimoTexto,
        sinLeer: c.sinLeer,
      };
    }).sort((a, b) => b.ultimo - a.ultimo);
    return sendJson(res, 200, { conversaciones: lista });
  }

  /* Obtener mensajes con un usuario */
  if (method === 'GET' && url.pathname === '/api/chat-directo') {
    const u = sesionActual(state, req);
    if (!u) return sendJson(res, 401, { error: 'Iniciá sesión' });
    const con = String(url.searchParams.get('con') || '').trim();
    if (!con) return sendJson(res, 400, { error: 'Falta el contacto' });
    const msgs = (state.chatDirecto || [])
      .filter(m => (m.de === u.id && m.para === con) || (m.de === con && m.para === u.id))
      .sort((a, b) => a.fecha - b.fecha)
      .slice(-100)
      .map(m => ({
        id: m.id,
        de: m.de,
        para: m.para,
        texto: m.texto || '',
        fecha: m.fecha,
        mio: m.de === u.id,
        leido: !!m.leido,
      }));
    /* Marcar como leídos los recibidos */
    (state.chatDirecto || []).forEach(m => {
      if (m.para === u.id && m.de === con && !m.leido) m.leido = true;
    });
    persist(state);
    return sendJson(res, 200, { mensajes: msgs });
  }

  /* Enviar mensaje directo */
  if (method === 'POST' && url.pathname === '/api/chat-directo') {
    const u = sesionActual(state, req);
    if (!u) return sendJson(res, 401, { error: 'Iniciá sesión' });
    const para = String(body.para || '').trim();
    const texto = String(body.texto || '').trim().slice(0, 600);
    if (!para) return sendJson(res, 400, { error: 'Falta el destinatario' });
    if (!texto) return sendJson(res, 400, { error: 'Escribí un mensaje' });
    const destinatario = (state.users || []).find(x => x.id === para);
    if (!destinatario) return sendJson(res, 404, { error: 'Usuario no encontrado' });
    /* Moderación */
    const mod = moderarTexto(texto);
    if (!mod.ok) return sendJson(res, 400, { error: mod.motivo || 'Mensaje no permitido' });
    state.chatDirecto = state.chatDirecto || [];
    const m = { id: uid(), de: u.id, para, texto, fecha: Date.now(), leido: false };
    state.chatDirecto.push(m);
    if (state.chatDirecto.length > 1000) state.chatDirecto = state.chatDirecto.slice(-1000);
    avisar(state, para, 'Nuevo mensaje', `${u.nombre}: ${texto.slice(0, 60)}`, 'info', { chatDirecto: true, de: u.id });
    persist(state);
    return sendJson(res, 201, { ok: true, mensaje: m });
  }

  /* ======================= AUTENTICACIÓN ======================= */

  // Verificar email (link del mail de confirmación)
  if (method === 'GET' && url.pathname === '/api/auth/verificar-email') {
    const tok = String(url.searchParams.get('token') || '').trim();
    if (!tok) return sendJson(res, 400, { error: 'Falta el token' });
    const u = (state.users || []).find(x => x.tokenVerifEmail === tok);
    if (!u) return sendJson(res, 404, { error: 'Token inválido o ya usado' });
    if (u.tokenVerifExpira && u.tokenVerifExpira < Date.now()) {
      return sendJson(res, 410, { error: 'El link expiró. Pedí uno nuevo desde tu perfil.' });
    }
    u.emailVerificado = true;
    delete u.tokenVerifEmail;
    delete u.tokenVerifExpira;
    persist(state);
    return sendJson(res, 200, { ok: true, mensaje: 'Email confirmado correctamente' });
  }

  // Reenviar mail de verificación
  if (method === 'POST' && url.pathname === '/api/auth/reenviar-verificacion') {
    const u = sesionActual(state, req);
    if (!u) return sendJson(res, 401, { error: 'Iniciá sesión' });
    if (u.emailVerificado) return sendJson(res, 400, { error: 'Tu email ya está verificado' });
    const tok = crypto.randomBytes(24).toString('hex');
    u.tokenVerifEmail = tok;
    u.tokenVerifExpira = Date.now() + 1000 * 60 * 60 * 24;
    persist(state);
    if (RESEND_KEY) {
      const link = `${BASE_URL || ''}/?verificarEmail=${tok}`;
      enviarMail(u.email, 'Confirmá tu email · Más Música',
        `Hola ${u.nombre},\n\nPara confirmar tu email, abrí este link:\n\n${link}\n\nEl link es válido por 24 horas.\n\nMás Música`,
        htmlMail(`<p>Hola <strong>${u.nombre}</strong>,</p><p>Para confirmar tu email, tocá el botón:</p><p><a href="${link}" style="display:inline-block;padding:12px 24px;background:#00a038;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">Confirmar mi email</a></p><p>O copiá y pegá este link:<br><span style="font-size:.85rem;color:#555;">${link}</span></p><p>El link es válido por 24 horas.</p>`)
      ).catch(() => {});
    }
    return sendJson(res, 200, { ok: true, mensaje: 'Te enviamos un nuevo link de verificación' });
  }

  // Crear cuenta de músico
  if (method === 'POST' && url.pathname === '/api/auth/registro') {
    const it = chequearIntento(req, 'registro');
    if (it.bloqueado) return sendJson(res, 429, { error: `Demasiados intentos. Probá de nuevo en ${it.espera} s.` });
    if (body.aceptaTerminos !== true) return sendJson(res, 400, { error: 'Tenés que aceptar los Términos y condiciones' });
    let nuevo;
    try { nuevo = crearUsuario(state, body, 'USER'); }
    catch (e) { return sendJson(res, e.code || 400, { error: e.message }); }
    nuevo.terminos = { version: TERMINOS_VERSION, fecha: Date.now() };
    /* Token de verificación de email (válido 24 h) */
    const tokenVerif = crypto.randomBytes(24).toString('hex');
    nuevo.tokenVerifEmail = tokenVerif;
    nuevo.tokenVerifExpira = Date.now() + 1000 * 60 * 60 * 24;
    const token = crearSesion(state, nuevo.id);
    avisar(state, nuevo.id, '¡Bienvenido a Más Música!', 'Tu cuenta ya está activa. Buscá tu sala de ensayo y reservá.', 'ok');
    /* Enviar mail de confirmación (si Resend está configurado) */
    if (RESEND_KEY) {
      const link = `${BASE_URL || ''}/?verificarEmail=${tokenVerif}`;
      enviarMail(nuevo.email, 'Confirmá tu email · Más Música',
        `Hola ${nuevo.nombre},\n\nGracias por crear tu cuenta en Más Música. Para confirmar tu email, abrí este link:\n\n${link}\n\nEl link es válido por 24 horas.\n\nSi no creaste esta cuenta, ignorá este mensaje.\n\nMás Música`,
        htmlMail(`<p>Hola <strong>${nuevo.nombre}</strong>,</p><p>Gracias por crear tu cuenta en Más Música. Para confirmar tu email, tocá el botón:</p><p><a href="${link}" style="display:inline-block;padding:12px 24px;background:#00a038;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">Confirmar mi email</a></p><p>O copiá y pegá este link en tu navegador:<br><span style="font-size:.85rem;color:#555;">${link}</span></p><p>El link es válido por 24 horas.</p><p style="font-size:.85rem;color:#888;">Si no creaste esta cuenta, ignorá este mensaje.</p>`)
      ).catch(() => {});
    }
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
    if (body.aceptaTerminos !== true) return sendJson(res, 400, { error: 'Tenés que aceptar los Términos y condiciones' });
    const nombreSala = String(body.sala && body.sala.name || '').trim();
    const direccion = String(body.sala && body.sala.direccion || '').trim();
    if (nombreSala.length < 2) return sendJson(res, 400, { error: 'Escribí el nombre de la sala' });
    if (direccion.length < 4) return sendJson(res, 400, { error: 'Escribí la dirección de la sala' });
    let duenio;
    try { duenio = crearUsuario(state, body, 'ROOM_ADMIN'); }
    catch (e) { return sendJson(res, e.code || 400, { error: e.message }); }
    duenio.terminos = { version: TERMINOS_VERSION, fecha: Date.now() };
    /* Token de verificación de email */
    const tokenVerif = crypto.randomBytes(24).toString('hex');
    duenio.tokenVerifEmail = tokenVerif;
    duenio.tokenVerifExpira = Date.now() + 1000 * 60 * 60 * 24;
    if (RESEND_KEY) {
      const link = `${BASE_URL || ''}/?verificarEmail=${tokenVerif}`;
      enviarMail(duenio.email, 'Confirmá tu email · Más Música',
        `Hola ${duenio.nombre},\n\nGracias por registrar tu sala en Más Música. Para confirmar tu email, abrí este link:\n\n${link}\n\nEl link es válido por 24 horas.\n\nMás Música`,
        htmlMail(`<p>Hola <strong>${duenio.nombre}</strong>,</p><p>Gracias por registrar tu sala en Más Música. Para confirmar tu email, tocá el botón:</p><p><a href="${link}" style="display:inline-block;padding:12px 24px;background:#00a038;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">Confirmar mi email</a></p><p>O copiá y pegá este link:<br><span style="font-size:.85rem;color:#555;">${link}</span></p><p>El link es válido por 24 horas.</p>`)
      ).catch(() => {});
    }
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
    if (!u || !verifyPassword(body.password, u)) {
      console.log(`[auth] Ingreso fallido en /api/auth/login (usuario "${id}") desde ${ipDeReq(req)}`);
      return sendJson(res, 401, { error: 'Usuario o contraseña incorrectos' });
    }
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
      console.log(`[auth] PIN incorrecto (intento ${it.n}/${INTENTOS_LIMITE}) desde ${ipDeReq(req)}`);
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
        u.foto = fotoORuta(body.foto, null);
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

  /* Borrar una notificación propia */
  if (method === 'DELETE' && url.pathname.startsWith('/api/notificaciones/')) {
    const u = sesionActual(state, req);
    if (!u) return sendJson(res, 401, { error: 'Iniciá sesión' });
    const idNotif = url.pathname.split('/').pop();
    const antes = state.notificaciones.length;
    state.notificaciones = state.notificaciones.filter(n => !(n.id === idNotif && n.userId === u.id));
    if (state.notificaciones.length === antes) return sendJson(res, 404, { error: 'No se encontró esa notificación' });
    persist(state);
    return sendJson(res, 200, { ok: true });
  }

  /* Borrar todas las notificaciones propias */
  if (method === 'DELETE' && url.pathname === '/api/notificaciones') {
    const u = sesionActual(state, req);
    if (!u) return sendJson(res, 401, { error: 'Iniciá sesión' });
    state.notificaciones = state.notificaciones.filter(n => n.userId !== u.id);
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
      foto: fotoORuta(foto, guardarFotoBanda(id, foto)),
      fotoGrupal: fotoORuta(fotoGrupal, guardarFotoBanda(id, fotoGrupal, '-grupo')),
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
      else banda.foto = fotoORuta(foto, null);
    }
    if (fotoGrupal !== undefined) {
      const guardada = guardarFotoBanda(banda.id, fotoGrupal, '-grupo');
      if (guardada) { if (banda.fotoGrupal && banda.fotoGrupal !== guardada) borrarFotoBanda(banda.fotoGrupal); banda.fotoGrupal = guardada; }
      else banda.fotoGrupal = fotoORuta(fotoGrupal, null);
    }
    banda.nombre = String(nombre).trim().slice(0, 60);
    banda.telefono = String(telefono || '').slice(0, 20);
    if (genero !== undefined) banda.genero = String(genero).slice(0, 40);
    if (integrantes !== undefined) banda.integrantes = normalizarIntegrantes(integrantes);
    persist(state);
    return sendJson(res, 200, { state: publicState(state) });
  }

  // Estado completo (con privacidad según sesión)
  if (method === 'GET' && url.pathname === '/api/state') {
    return sendJson(res, 200, publicState(state, req));
  }

  /* ======================= RESERVAS ======================= */

  if (method === 'POST' && url.pathname === '/api/reserve') {
    const u = sesionActual(state, req);
    if (!u) return sendJson(res, 401, { error: 'Iniciá sesión para hacer una reserva' });
    const { date, roomId, start, end } = body;
    const name = String(body.name || (u && u.nombre) || '').trim();
    const phone = String(body.phone || (u && u.telefono) || '').trim();
    if (!date || !roomId || !start || !end) return sendJson(res, 400, { error: 'Faltan datos de la reserva' });
    if (!name) return sendJson(res, 400, { error: 'Escribe el nombre o el de la banda' });
    /* Los músicos y las bandas reservan con un máximo de 7 días de anticipación */
    if (u.rol === 'USER') {
      const corte = new Date();
      corte.setDate(corte.getDate() + 7);
      if (date > dateStr(corte)) return sendJson(res, 403, { error: 'Los músicos y las bandas pueden reservar hasta 7 días para adelante' });
    }
    const room = state.rooms.find(r => r.id === roomId && r.activo !== false && r.estado === 'aprobada');
    if (!room) return sendJson(res, 400, { error: 'La sala no existe o no está disponible' });
    const startMin = toMin(start), endMin = toMin(end);
    if (!Number.isInteger(startMin) || !Number.isInteger(endMin)) return sendJson(res, 400, { error: 'Horario inválido' });
    if (!rangoDisponible(state, date, roomId, startMin, endMin)) {
      return sendJson(res, 409, { error: 'Ese horario ya no está disponible' });
    }
    const alquilerCalc = calcularAlquiler(state, body.alquiler, (endMin - startMin) / 60, roomId);
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
      avisarReservaPorMail(state, reservation);
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
    Object.assign(pago, { room_price: reservation.room_price, total_amount: reservation.total_amount, total: reservation.total, sena: reservation.sena, saldo: reservation.saldo, venceEn: reservation.venceEn });
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

  /* Reintentar el pago de una seña pendiente (si el músico cerró la pantalla de pago) */
  if (method === 'POST' && url.pathname === '/api/pagos/reintentar') {
    if (MODO_PAGOS === 'apagado') return sendJson(res, 400, { error: 'El cobro de la seña no está activo' });
    const u = sesionActual(state, req);
    if (!u) return sendJson(res, 401, { error: 'Iniciá sesión para pagar la seña' });
    const r = state.reservations.find(x => x.id === body.reservaId);
    if (!r || !r.pago) return sendJson(res, 404, { error: 'Reserva no encontrada' });
    const esMia = r.userId === u.id || (r.phone && r.phone === String(u.telefono || '').trim());
    if (!esMia) return sendJson(res, 403, { error: 'Esa reserva no es tuya' });
    if (r.estado !== 'pendiente_pago') return sendJson(res, 409, { error: 'Esa reserva no está pendiente de pago' });
    if (r.venceEn && r.venceEn < Date.now()) return sendJson(res, 409, { error: 'Se venció el tiempo para pagar la seña. La reserva ya no está tomada.' });
    const info = { sena: r.sena, total: r.total, saldo: r.saldo, venceEn: r.venceEn };
    if (MODO_PAGOS === 'simulado') return sendJson(res, 200, Object.assign({ simulado: true }, info));
    const room = state.rooms.find(x => x.id === r.roomId);
    try {
      const pref = await crearPreferencia(r, room);
      r.pago.preferenciaId = pref.id;
      persist(state);
      return sendJson(res, 200, Object.assign({ url: pref.url }, info));
    } catch (e) {
      console.error('[pagos] reintento:', e.message);
      return sendJson(res, 502, { error: 'No pudimos iniciar el pago. Probá de nuevo en unos minutos.' });
    }
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
      /* Se puede cancelar siempre. Si es fuera del plazo, la seña se retiene (no se reembolsa). */
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
    return sendJson(res, 200, { state: publicState(state, req) });
  }

  /* Eliminar del historial una reserva cancelada o ya pasada (el músico borra las suyas).
     Las reservas futuras activas primero hay que cancelarlas. Si tiene seña pagada, no se borra. */
  if (method === 'DELETE' && P === 'reservations' && parts.length === 3) {
    const r = state.reservations.find(x => x.id === parts[2]);
    if (!r) return sendJson(res, 404, { error: 'Reserva no encontrada' });
    const cancelada = r.estado === 'cancelada';
    const pasada = esReservaPasada(r);
    if (!cancelada && !pasada) return sendJson(res, 403, { error: 'Solo se pueden eliminar reservas canceladas o pasadas' });
    const u = sesionActual(state, req);
    const esDueña = !!u && (r.userId === u.id || (r.phone && r.phone === u.telefono && r.name === u.nombre));
    const esAdmin = !!u && (u.rol === 'SUPER_ADMIN' || u.rol === 'ROOM_ADMIN');
    if (!esDueña && !esAdmin) {
      const nameOk = r.name.toLowerCase() === String(body.name || '').trim().toLowerCase();
      const phoneOk = !r.phone || r.phone === String(body.phone || '').trim();
      if (!nameOk || !phoneOk) return sendJson(res, 403, { error: 'Los datos no coinciden con la reserva' });
    }
    /* Si tenía seña pagada y no se reembolsó, no borrar (dejar para auditoría) */
    if (r.pago && r.pago.estado === 'aprobado') return sendJson(res, 403, { error: 'Esta reserva tiene una seña pagada. Resolvela desde Pagos antes de eliminarla.' });
    state.reservations = state.reservations.filter(x => x.id !== parts[2]);
    persist(state);
    return sendJson(res, 200, { state: publicState(state, req) });
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

  /* ======================= RESEÑAS DE SALAS ======================= */
  if (P === 'resenas') {
    const u = sesionActual(state, req);
    const salaOk = id => (state.rooms || []).find(x => x.id === id && x.estado === 'aprobada');

    /* Publicar mi reseña.
       Puedo dejar varias en la misma sala (una por cada visita): no se reemplaza
       ninguna. Sí se evita el duplicado exacto si toca dos veces el botón. */
    if (method === 'POST' && url.pathname === '/api/resenas') {
      if (!u) return sendJson(res, 401, { error: 'Iniciá sesión para dejar una reseña' });
      const room = salaOk(String(body.roomId || '').trim());
      if (!room) return sendJson(res, 404, { error: 'Sala no encontrada' });
      /* Solo opina quien reservó ahí (las canceladas no cuentan) */
      const reservo = (state.reservations || []).some(r => r.roomId === room.id && r.userId === u.id && r.estado !== 'cancelada');
      if (!reservo) return sendJson(res, 403, { error: 'Solo podés reseñar salas donde reservaste' });
      const estrellas = Math.round(Number(body.estrellas));
      if (!(estrellas >= 1 && estrellas <= 5)) return sendJson(res, 400, { error: 'Elegí de 1 a 5 estrellas' });
      /* Sin etiquetas: se quitan las completas y cualquier < o > suelto */
      const texto = String(body.texto || '').replace(/<[^>]*>/g, '').replace(/[<>]/g, '').trim().slice(0, 500);
      const listas = (state.resenas || []).filter(x => x.roomId === room.id && x.userId === u.id);
      /* Cuántas reseñas puede dejar la misma cuenta en la misma sala */
      if (listas.length >= MAX_RESENAS_POR_SALA) {
        return sendJson(res, 400, { error: `Ya dejaste ${MAX_RESENAS_POR_SALA} reseñas en esta sala` });
      }
      /* El mismo comentario ya está puesto: no lo duplicamos */
      if (listas.some(x => x.estrellas === estrellas && x.texto === texto)) {
        return sendJson(res, 400, { error: 'Esa reseña ya la dejaste' });
      }

      const resena = { id: uid(), roomId: room.id, userId: u.id, usuario: u.usuario, estrellas, texto, fecha: Date.now() };
      state.resenas.push(resena);
      persist(state);
      return sendJson(res, 200, { ok: true, resena: resenaPublica(resena), puntaje: puntajeSala(state, room.id) });
    }

    /* Borrar una reseña: su autor (o la administración general) */
    if (method === 'DELETE' && parts[2]) {
      if (!u) return sendJson(res, 401, { error: 'Iniciá sesión' });
      const i = (state.resenas || []).findIndex(x => x.id === parts[2]);
      if (i < 0) return sendJson(res, 404, { error: 'La reseña ya no existe' });
      const resena = state.resenas[i];
      if (resena.userId !== u.id && u.rol !== 'SUPER_ADMIN') {
        return sendJson(res, 403, { error: 'Solo el autor puede borrar su reseña' });
      }
      const roomId = resena.roomId;
      state.resenas.splice(i, 1);
      persist(state);
      return sendJson(res, 200, { ok: true, puntaje: puntajeSala(state, roomId) });
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
      const ingresos = futuras.reduce((s, r) => s + (r.estado === 'tentativa' ? 0 : (toMin(r.end) - toMin(r.start)) / 60 * room.price), 0);
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

    // Confirmar una reserva tentativa (creada desde el Chat Global)
    if (method === 'POST' && accion === 'reserva' && parts.length === 4) {
      const r = state.reservations.find(x => x.id === parts[3] && x.roomId === room.id);
      if (!r) return sendJson(res, 404, { error: 'Reserva no encontrada' });
      if (r.estado !== 'tentativa') return sendJson(res, 409, { error: 'Esa reserva no está pendiente de confirmación' });
      if (!rangoDisponible(state, r.date, room.id, toMin(r.start), toMin(r.end), r.id)) {
        return sendJson(res, 409, { error: 'Ese horario ya está ocupado por otra reserva' });
      }
      r.estado = 'confirmada';
      r.cancelada = 0;
      const avisados = new Set([r.userId, ...(r.invitados || [])].filter(Boolean));
      avisados.forEach(id => avisar(state, id, 'Reserva confirmada por la sala', `${room.name} · ${fmtFechaCorta(r.date)} ${r.start}–${r.end}`, 'ok', { reservaId: r.id, roomId: room.id }));
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
      (r.invitados || []).forEach(id => { if (id !== r.userId) avisar(state, id, 'Reserva confirmada por la sala', `${room.name} · ${fmtFechaCorta(date)} ${start}–${end}`, 'ok', { reservaId: r.id, roomId: r.roomId }); });
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
      (r.invitados || []).forEach(id => { if (id !== r.userId) avisar(state, id, 'La sala no pudo confirmar la reserva', `${room.name} · ${fmtFechaCorta(r.date)} ${r.start}–${r.end}`, 'warn', { reservaId: r.id, roomId: r.roomId }); });
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

    // Ingresos por la comisión de +MÚSICA (se descuenta de la seña cobrada)
    let totalComisionesPlataforma = 0;
    let totalBrutoReservas = 0;
    (state.reservations || []).forEach(r => {
      if (r.estado !== 'cancelada') {
        totalBrutoReservas += (r.total_amount || r.total || 0);
        totalComisionesPlataforma += (r.comision || r.service_fee || 0);
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

  // Crear sala
  if (method === 'POST' && url.pathname === '/api/rooms') {
    const { name, price, capacity, features, active, foto } = body;
    if (!name || !String(name).trim()) return sendJson(res, 400, { error: 'El nombre es obligatorio' });
    const id = uid();
    const room = salaNueva({ id, estado: 'aprobada' });
    Object.assign(room, datosDeSala(body, room));
    room.active = active !== false;
    room.activo = active !== false;
    room.foto = fotoORuta(foto, guardarFotoSala(id, foto));
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
      if (body.ownerId !== undefined) {
        if (body.ownerId === null || body.ownerId === '') room.ownerId = null;
        else {
          const uOwner = state.users.find(x => x.id === body.ownerId);
          if (!uOwner) return sendJson(res, 400, { error: 'Usuario no encontrado' });
          room.ownerId = uOwner.id;
          if (uOwner.rol === 'USER') uOwner.rol = 'ROOM_ADMIN';
        }
      }
      if (foto !== undefined) {
        const guardada = guardarFotoSala(room.id, foto);
        if (guardada) { if (room.foto && room.foto !== guardada) borrarFotoSala(room.foto); room.foto = guardada; }
        else room.foto = fotoORuta(foto, null);
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
        /* Horas antes del ensayo para avisar al músico (0 = apagado) */
        recordatorioHoras: Math.max(0, Math.min(168, parseInt(r.recordatorioHoras, 10) || 0)),
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
      rooms: [], reservations: [], blocks: [], instruments: [], placePhotos: [], bands: [], resenas: [],
    };
    persist(limpio);
    return sendJson(res, 200, { state: publicState(limpio) });
  }

  /* ======================= COMUNIDAD (solo músicos) ======================= */
  if (P === 'comunidad') {
    const u = sesionActual(state, req);
    if (!u || u.rol !== 'USER') return sendJson(res, 403, { error: 'La comunidad es solo para cuentas de músico' });
    const txt = s => String(s == null ? '' : s).trim();
    /* Verificar acceso al chat (suscripción) */
    if (method === 'GET' && url.pathname === '/api/comunidad/chat-acceso') {
      const tieneAcceso = tieneAccesoChat(state, u.id);
      const sub = (state.chatSubscriptions || []).find(s => s.userId === u.id);
      return sendJson(res, 200, {
        tieneAcceso,
        suscripcion: sub ? {
          plan: sub.plan,
          estado: sub.estado,
          venceEn: sub.venceEn,
          diasRestantes: Math.max(0, Math.ceil((sub.venceEn - Date.now()) / (24 * 3600 * 1000))),
        } : null,
        planes: CHAT_PLAN_CONFIG,
      });
    }

    /* Suscribirse al chat */
    if (method === 'POST' && url.pathname === '/api/comunidad/chat-suscribirse') {
      const plan = txt(body.plan) || 'mensual';
      const config = CHAT_PLAN_CONFIG[plan];
      if (!config) return sendJson(res, 400, { error: 'Plan no válido' });
      const monto = config.precioMensual;   /* $5.000 final, IVA incluido */

      /* Si el cobro está apagado o es simulado, se activa directo (como antes). */
      if (MODO_PAGOS !== 'mercadopago') {
        const sub = activarSuscripcionChat(state, u.id, plan, { estado: 'aprobado', fecha: Date.now(), monto });
        persist(state);
        avisar(state, u.id, '¡Suscripción activada!', `Tu acceso al Chat Global está activo hasta ${new Date(sub.venceEn).toLocaleDateString('es-AR')}.`, 'ok');
        return sendJson(res, 200, {
          ok: true,
          activada: true,
          suscripcion: {
            plan: sub.plan, estado: sub.estado, venceEn: sub.venceEn,
            diasRestantes: Math.max(0, Math.ceil((sub.venceEn - Date.now()) / (24 * 3600 * 1000))),
          },
        });
      }

      /* Con Mercado Pago: se crea la solicitud y se devuelve el link de pago.
         El acceso se activa recién cuando el webhook confirma el pago. */
      const minutos = 30;
      const solicitud = {
        id: 'chat:' + uid(),
        userId: u.id,
        plan,
        planNombre: config.nombre,
        monto,
        estado: 'pendiente',
        proveedor: 'mercadopago',
        creada: Date.now(),
        venceEn: Date.now() + minutos * 60000,
      };
      state.chatSolicitudes = state.chatSolicitudes || [];
      let pago;
      try {
        const pref = await crearPreferenciaSuscripcion(solicitud, u);
        solicitud.preferenciaId = pref.id;
        pago = { url: pref.url, monto, plan, venceEn: solicitud.venceEn };
      } catch (e) {
        console.error('[pagos] no se pudo crear el pago de la suscripción:', e.message);
        return sendJson(res, 502, { error: 'No pudimos iniciar el pago. Probá de nuevo en unos minutos.' });
      }
      state.chatSolicitudes.push(solicitud);
      persist(state);
      return sendJson(res, 200, { ok: true, activada: false, solicitudId: solicitud.id, pago });
    }

    /* ========== CHAT GLOBAL GRUPAL ========== */

    /* Obtener mensajes del chat global */
    if (method === 'GET' && url.pathname === '/api/comunidad/chat-global') {
      if (!tieneAccesoChat(state, u.id)) {
        return sendJson(res, 403, { error: 'Necesitás una suscripción al Chat Global', requiereSuscripcion: true, planes: CHAT_PLAN_CONFIG });
      }
      const desde = Number(url.searchParams.get('desde')) || 0;
      const msgs = (state.chatGlobal || [])
        .filter(m => m.fecha > desde)
        .slice(-100)
        .map(m => {
          const autor = (state.users || []).find(x => x.id === m.userId);
          return {
            id: m.id,
            tipo: m.tipo || 'texto',
            texto: m.texto || '',
            media: m.media || '',
            meta: m.meta || null,
            interesados: (m.interesados || []).length,
            interesado: (m.interesados || []).includes(u.id),
            reservaId: m.reservaId || null,
            reservaEstado: m.reservaId ? ((state.reservations.find(x => x.id === m.reservaId) || {}).estado || null) : null,
            reservaNombre: m.reservaId ? ((state.reservations.find(x => x.id === m.reservaId) || {}).name || null) : null,
            fecha: m.fecha,
            mio: m.userId === u.id,
            autor: autor ? { nombre: autor.nombre, usuario: autor.usuario, foto: autor.foto || '' } : { nombre: 'Usuario', usuario: '??', foto: '' },
          };
        });
      return sendJson(res, 200, { mensajes: msgs, total: (state.chatGlobal || []).length });
    }

    /* Enviar mensaje al chat global */
    if (method === 'POST' && url.pathname === '/api/comunidad/chat-global') {
      if (!tieneAccesoChat(state, u.id)) {
        return sendJson(res, 403, { error: 'Necesitás una suscripción al Chat Global', requiereSuscripcion: true, planes: CHAT_PLAN_CONFIG });
      }
      const tipo = ['texto', 'imagen', 'sticker', 'video', 'invitacion'].includes(body.tipo) ? body.tipo : 'texto';
      let texto = String(body.texto || '').trim().slice(0, 600);
      let media = '';
      let meta = null;
      if (tipo === 'imagen') {
        const ruta = guardarFotoComunidad(u.id, body.media, '-img');
        if (!ruta) return sendJson(res, 400, { error: 'No se pudo guardar la imagen' });
        media = ruta;
      } else if (tipo === 'video') {
        const ruta = guardarVideoComunidad(u.id, body.media, '-vid');
        if (!ruta) return sendJson(res, 400, { error: 'No se pudo guardar el video (usá un clip corto de hasta 15 s)' });
        media = ruta;
      } else if (tipo === 'sticker') {
        const sid = String(body.media || '').slice(0, 12);
        if (!/^s\d{1,2}$/.test(sid)) return sendJson(res, 400, { error: 'Sticker inválido' });
        media = sid;
      } else if (tipo === 'invitacion') {
        const sala = (state.rooms || []).find(r => r.id === String(body.media || ''));
        if (!sala) return sendJson(res, 400, { error: 'Elegí una sala para invitar' });
        const fecha = String(body.fecha || '').slice(0, 10);
        const desde = String(body.desde || '').slice(0, 5);
        const hasta = String(body.hasta || '').slice(0, 5);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{1,2}:\d{2}$/.test(desde) || !/^\d{1,2}:\d{2}$/.test(hasta)) {
          return sendJson(res, 400, { error: 'Elegí un día y un horario' });
        }
        if (!rangoDisponible(state, fecha, sala.id, toMin(desde), toMin(hasta))) {
          return sendJson(res, 409, { error: 'Ese horario ya no está disponible' });
        }
        media = sala.id;
        meta = { nombre: sala.name, direccion: sala.direccion || '', localidad: sala.localidad || '', date: fecha, start: desde, end: hasta };
      }
      if (tipo === 'texto' && !texto) return sendJson(res, 400, { error: 'Escribí un mensaje' });
      /* Moderación automática: rechazar contenido inapropiado */
      if (tipo === 'texto') {
        const mod = moderarTexto(texto);
        if (!mod.ok) {
          /* Registrar advertencia al usuario */
          u.advertenciasChat = (u.advertenciasChat || 0) + 1;
          if (u.advertenciasChat >= 5) {
            u.bloqueado = true;
            persist(state);
            return sendJson(res, 403, { error: 'Tu cuenta fue suspendida por violar las reglas del chat.' });
          }
          persist(state);
          return sendJson(res, 400, { error: mod.motivo || 'Tu mensaje no cumple con las reglas del chat.' });
        }
      }
      state.chatGlobal = state.chatGlobal || [];
      const m = { id: uid(), userId: u.id, tipo, texto, media, meta, interesados: [], fecha: Date.now() };
      state.chatGlobal.push(m);
      /* Mantener solo los últimos 500 mensajes */
      if (state.chatGlobal.length > 500) state.chatGlobal = state.chatGlobal.slice(-500);
      persist(state);
      return sendJson(res, 201, { ok: true, mensaje: { id: m.id, tipo: m.tipo, texto: m.texto, media: m.media, meta: m.meta, fecha: m.fecha } });
    }

    /* Un músico elimina un mensaje propio del chat global */
    if (method === 'POST' && url.pathname === '/api/comunidad/chat-global/borrar') {
      if (!tieneAccesoChat(state, u.id)) {
        return sendJson(res, 403, { error: 'Necesitás una suscripción al Chat Global', requiereSuscripcion: true, planes: CHAT_PLAN_CONFIG });
      }
      const m = (state.chatGlobal || []).find(x => x.id === String(body.mensajeId || ''));
      if (!m) return sendJson(res, 404, { error: 'El mensaje ya no existe' });
      if (m.userId !== u.id) return sendJson(res, 403, { error: 'Solo podés eliminar tus propios mensajes' });
      /* Una invitación con reserva en curso no se puede borrar: primero hay que desistir */
      const resv = m.reservaId ? state.reservations.find(x => x.id === m.reservaId) : null;
      if (resv && (resv.estado === 'tentativa' || resv.estado === 'confirmada')) {
        return sendJson(res, 409, { error: 'Esta invitación tiene una reserva en curso. Desistí de la reserva antes de eliminarla.' });
      }
      /* Si era una foto o un video, se borra también el archivo del disco */
      if ((m.tipo === 'imagen' || m.tipo === 'video') && m.media) borrarEnAssets(m.media, 'comunidad');
      state.chatGlobal = (state.chatGlobal || []).filter(x => x.id !== m.id);
      persist(state);
      return sendJson(res, 200, { ok: true });
    }

    /* Un músico se anota o se desanota de una invitación de sala del chat global */
    if (method === 'POST' && url.pathname === '/api/comunidad/chat-global/interes') {
      if (!tieneAccesoChat(state, u.id)) {
        return sendJson(res, 403, { error: 'Necesitás una suscripción al Chat Global', requiereSuscripcion: true, planes: CHAT_PLAN_CONFIG });
      }
      const idMsg = String(body.mensajeId || '');
      const m = (state.chatGlobal || []).find(x => x.id === idMsg && x.tipo === 'invitacion');
      if (!m) return sendJson(res, 404, { error: 'Invitación no encontrada' });
      m.interesados = m.interesados || [];
      /* Si la reserva tentativa ya está armada, hay que mantener al día su lista de invitados */
      const tentativa = m.reservaId ? state.reservations.find(x => x.id === m.reservaId && x.estado === 'tentativa') : null;
      if (tentativa && !Array.isArray(tentativa.invitados)) tentativa.invitados = [];
      if (m.interesados.includes(u.id)) {
        m.interesados = m.interesados.filter(id => id !== u.id);
        if (tentativa && tentativa.userId !== u.id) tentativa.invitados = tentativa.invitados.filter(id => id !== u.id);
        persist(state);
        return sendJson(res, 200, { ok: true, interesados: m.interesados.length, interesado: false });
      }
      m.interesados.push(u.id);
      if (tentativa && tentativa.userId !== u.id && !tentativa.invitados.includes(u.id)) tentativa.invitados.push(u.id);
      persist(state);
      return sendJson(res, 200, { ok: true, interesados: m.interesados.length, interesado: true });
    }

    /* El organizador de una invitación arma una reserva tentativa (el dueño de la sala la confirma) */
    if (method === 'POST' && url.pathname === '/api/comunidad/chat-global/invitacion/confirmar') {
      if (!tieneAccesoChat(state, u.id)) {
        return sendJson(res, 403, { error: 'Necesitás una suscripción al Chat Global', requiereSuscripcion: true, planes: CHAT_PLAN_CONFIG });
      }
      const m = (state.chatGlobal || []).find(x => x.id === String(body.mensajeId || '') && x.tipo === 'invitacion');
      if (!m) return sendJson(res, 404, { error: 'Invitación no encontrada' });
      if (m.userId !== u.id) return sendJson(res, 403, { error: 'Solo quien envió la invitación puede armar la reserva' });
      if (m.reservaId) return sendJson(res, 409, { error: 'La reserva ya fue pedida' });
      const meta = m.meta || {};
      const room = state.rooms.find(r => r.id === m.media && r.activo !== false && r.estado === 'aprobada');
      if (!room) return sendJson(res, 400, { error: 'La sala ya no está disponible' });
      const sMin = toMin(meta.start), eMin = toMin(meta.end);
      if (!Number.isInteger(sMin) || !Number.isInteger(eMin)) return sendJson(res, 400, { error: 'Horario inválido' });
      if (u.rol === 'USER') {
        const corte = new Date();
        corte.setDate(corte.getDate() + 7);
        if (meta.date > dateStr(corte)) return sendJson(res, 403, { error: 'Los músicos pueden reservar hasta 7 días para adelante' });
      }
      if (!rangoDisponible(state, meta.date, room.id, sMin, eMin)) {
        return sendJson(res, 409, { error: 'Ese horario ya no está disponible' });
      }
      const nombre = String(body.nombre || '').trim().slice(0, 60) || ('Grupo de ' + (u.nombre || 'músicos'));
      const invitados = (m.interesados || []).filter(id => id !== u.id);
      const reserva = {
        id: uid(), roomId: room.id, date: meta.date, start: meta.start, end: meta.end,
        name: nombre, phone: String(u.telefono || '').slice(0, 20), userId: u.id,
        estado: 'tentativa', origen: 'chat', invitados, createdAt: Date.now(),
      };
      state.reservations.push(reserva);
      m.reservaId = reserva.id;
      if (room.ownerId) avisar(state, room.ownerId, 'Reserva tentativa desde el Chat', `${nombre} quiere reservar ${room.name} el ${fmtFechaCorta(meta.date)}, de ${meta.start} a ${meta.end}. Confirmala o rechazala en tu panel.`, 'info', { reservaId: reserva.id, roomId: room.id, para: 'dueno' });
      invitados.forEach(id => avisar(state, id, 'Reserva tentativa pedida', `${room.name} · ${fmtFechaCorta(meta.date)} ${meta.start}–${meta.end}`, 'info', { reservaId: reserva.id, roomId: room.id }));
      persist(state);
      return sendJson(res, 201, { ok: true, reservaId: reserva.id, reserva });
    }

    /* El organizador desiste de la reserva tentativa que armó desde el chat */
    if (method === 'POST' && url.pathname === '/api/comunidad/chat-global/invitacion/desistir') {
      if (!tieneAccesoChat(state, u.id)) {
        return sendJson(res, 403, { error: 'Necesitás una suscripción al Chat Global', requiereSuscripcion: true, planes: CHAT_PLAN_CONFIG });
      }
      const m = (state.chatGlobal || []).find(x => x.id === String(body.mensajeId || '') && x.tipo === 'invitacion');
      if (!m) return sendJson(res, 404, { error: 'Invitación no encontrada' });
      if (m.userId !== u.id) return sendJson(res, 403, { error: 'Solo quien armó la reserva puede desistir' });
      if (!m.reservaId) return sendJson(res, 409, { error: 'Esta invitación no tiene una reserva pedida' });
      const r = state.reservations.find(x => x.id === m.reservaId);
      if (!r) return sendJson(res, 404, { error: 'Reserva no encontrada' });
      if (r.estado !== 'tentativa') return sendJson(res, 409, { error: 'La sala ya respondió: ya no se puede desistir' });
      r.estado = 'cancelada';
      r.cancelada = Date.now();
      r.motivoCancelacion = 'El organizador desistió (chat)';
      const room = state.rooms.find(x => x.id === r.roomId);
      const detalle = `${room ? room.name : 'Sala'} · ${fmtFechaCorta(r.date)} · ${r.start}–${r.end}`;
      const avisarIds = new Set([...(r.invitados || [])].filter(Boolean));
      avisarIds.forEach(id => avisar(state, id, 'El organizador desistió de la reserva', `${r.name} · ${detalle} · se liberó el horario`, 'warn', { reservaId: r.id, roomId: r.roomId }));
      if (room && room.ownerId) avisar(state, room.ownerId, 'Reserva tentativa retirada', `${r.name} · ${detalle} · el organizador desistió, ya no hace falta responder`, 'info', { reservaId: r.id, roomId: r.roomId, para: 'dueno' });
      /* La invitación vuelve a quedar disponible para armar otra reserva */
      m.reservaId = null;
      persist(state);
      return sendJson(res, 200, { ok: true });
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
  if (body.numero !== undefined) out.numero = String(body.numero).slice(0, 12);
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
  /* Datos de cobro de la sala: dónde se le transfiere lo que le corresponde */
  if (body.cobro !== undefined) out.cobro = normalizarCobro(body.cobro);
  /* Foto horizontal de la sala (se guarda como archivo si viene en data URL) */
  if (body.fotoPortada !== undefined) {
    const ruta = fotoORuta(body.fotoPortada, guardarFotoSala(prev.id || uid(), body.fotoPortada, '-portada'));
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
  /* Catálogo de equipos de la sala: cada ítem puede traer su foto como data URL,
     que se guarda como archivo. */
  if (body.catalogo !== undefined) {
    const items = normalizarCatalogo(body.catalogo);
    const idSala = prev.id || uid();
    out.catalogo = items.map((it, i) => {
      const guardada = guardarFotoSala(idSala, it.foto, '-eq' + (i + 1));
      return Object.assign({}, it, { foto: fotoORuta(it.foto, guardada) });
    });
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

    /* Tareas periódicas: liberar reservas vencidas y mandar los recordatorios
       antes del ensayo. Se repiten aunque no entre ningún pedido, así el aviso
       sale a la hora aunque la app esté quieta. */
    setInterval(() => {
      try {
        expirarPendientes(loadState());
      } catch (e) { console.error('[tareas periódicas]', e.message); }
    }, 5 * 60 * 1000);
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