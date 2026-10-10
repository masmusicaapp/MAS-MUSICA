# 🎸 Más Música — Salas de ensayo

Plataforma para **encontrar y reservar salas de ensayo**, con tres niveles de acceso:
usuarios/músicos, dueños de sala y la administración general de Más Música.

---

## ▶️ Cómo usarla

```bash
cd salas-ensayo
node server.js
```

Abrí **http://localhost:3000**. No hace falta instalar nada más (sin dependencias).

- El estado vive en **`data.json`** (el servidor es la autoridad de disponibilidad).
- Las imágenes se guardan en `public/assets/{salas,usuarios,bandas}/`.
- Los datos se guardan en **json** (Node), por eso todos los dispositivos ven lo mismo.

---

## 🔐 Cuentas y roles

| Rol | Se crea | Puede hacer |
|---|---|---|
| 🎸 `USER` | Registro público ("Soy músico / usuario") | Buscar salas, ver fotos/equipos/precios, reservar, historial, favoritas, avisos |
| 🎛️ `ROOM_ADMIN` | Registro público ("Tengo una sala de ensayo") | Todo lo anterior **+** administrar **solo su propia sala** |
| 👑 `SUPER_ADMIN` | Solo por consola (`node server.js --crear-admin`) | Control total: cuentas, aprobación de salas, reservas, configuración |

### Registro

La pantalla inicial ofrece las dos opciones públicas:

1. **🎸 Soy músico / usuario** → nombre y apellido, nombre de usuario, foto de perfil,
   email, teléfono, contraseña, localidad/zona e instrumento(s).
2. **🎛️ Tengo una sala de ensayo** → datos del responsable (nombre, usuario, email,
   teléfono, contraseña, confirmación de responsabilidad) **+ datos de la sala**
   (nombre, dirección, localidad, ubicación en el mapa, teléfono, descripción, capacidad,
   equipamiento por tipo, precio por hora, días y horarios).

La sala queda **PENDIENTE DE APROBACIÓN**: no se publica hasta que la apruebe la
administración general. El dueño ya tiene acceso a su panel mientras tanto.

### Cuenta madre (SUPER_ADMIN)

No existe en el registro público. La primera vez que arranca el servidor se crea sola
con una contraseña aleatoria **impresa una única vez en la consola**:

```
╔════════════════════════════════════════════════════╗
║  CUENTA MADRE (SUPER_ADMIN) — anotá estos datos    ║
║  Usuario:     admin                                ║
║  Contraseña:  QX8QLg2EM-yz                         ║
╚════════════════════════════════════════════════════╝
```

Para crear otra (o recuperarla):

```bash
node server.js --crear-admin            # usuario/email/contraseña aleatorios
node server.js --crear-admin ana ana@correo.com MiClave123
```

Entrás en la app con usuario + contraseña, o con el **PIN de emergencia** (por defecto
`1234`, cambiable en *Ajustes*) si olvidás la clave. Desde *Ajustes* cambiás tu contraseña.

### Acceso rápido al panel (administración)

Doble toque en el logo **+ MÚSICA** o entrada por URL con **`#admin`**.

---

## 🎸 Para el músico

- 📅 Calendario (hasta 60 días de anticipación).
- 🎸 Salas con **logo, dirección, precio/hora, capacidad, equipamiento** y ficha completa (`ℹ️ Ficha`).
- ♥️ **Salas favoritas** (botón ♡ en cada tarjeta o filtro "Favoritas").
- ⏱ Reservas de 1 o varias horas, con la duración de turno que defina cada sala.
- 🔒 Los horarios reservados o bloqueados aparecen tachados.
- 📋 **Mis reservas** solo en la vista de **Salas** (en los pasos de reserva): próximas, historial, cancelar.
- 🔔 **Avisos**: reserva confirmada, cambios, aprobación de tu sala, nuevas reservas si sos dueño.

## 🛎 El Inicio: resumen de alertas

El **Inicio** no es un mapa: es un **resumen corto** para entrar en calor.

- **📊 Datos**: salas publicadas, reservas de hoy, reservas de los próximos 7 días y tus reservas.
- **🔔 Alertas y 🎉 promociones**: ya no se resumen en el Inicio — todo vive en la **campana de
  notificaciones** (avisos de reservas + "Promociones y novedades" de la administración, que se
  abren con su detalle al tocarlas).
- **🔔 Alerta de notificaciones**: la campana rediseñada (píldora junto a la marca) con
  contador **sin leer** y brillo verde + sacudida cuando llega algo nuevo. Al tocarla se despliega
  desde arriba el **panel de notificaciones** con todas las **reservas confirmadas**, las
  **reservas canceladas** y otros avisos, filtradas por fecha, con botón **Marcar leídas**.
  **Cada aviso es tappable**: tocar una notificación ofrece la reserva correspondiente — lleva a
  **Mis reservas** filtradas (próximas si fue confirmada/modificada, historial si fue cancelada)
  y **resalta la tarjeta** de esa reserva; los avisos de un dueño de sala ("Nueva reserva")
  llevan directo al **panel de su sala → Reservas**. La campana está en todas las pantallas
  salvo en el **Perfil**, donde se cambia por el **engranaje de Ajustes** (la campana con su
  contador reaparece al salir del perfil).

## 🎨 Estilo: bienvenida y Ajustes

El diseño sigue la guía visual de la marca **+MÚSICA**:

- **Paleta**: fondo `#0D1B2F`, tarjetas `#16263D`, bordes `#243752`, acento **verde `#00A038`**
  y peligro `#FF9B8F`. El **tema claro** usa fondo `#F5F5F2`, tarjetas blancas y texto `#0D1A2E`
  (ver **Arranque y temas** más abajo).
- **Tipografía**: **Barlow** para el texto y **Barlow Condensed** (cursiva, negrita, mayúsculas)
  para los títulos (`Ajustes`, `Mis reservas`, `Elige la fecha`…). Los rótulos de grupo
  (`Mi cuenta`, `Preferencias`…) van en mayúsculas chicas con espaciado.
- **Bienvenida**: logo grande, "¿Cómo querés usar Más Música?" y dos tarjetas:
  **Soy músico** (verde sólida con texto oscuro) y **Tengo una sala de ensayo**
  (borde verde), con el enlace **Iniciar sesión** abajo.
- **Perfil** (opción de la barra inferior): abre con la **tarjeta de perfil** — la **banda** del músico
  (o "Registra tu banda" si todavía no tiene) o la **sala** del dueño (logo, estado, ubicación,
  precio/capacidad y accesos a su panel) — y debajo quedan **Mis datos** (avatar, @usuario, email,
  teléfono, localidad, instrumentos y fecha de alta, con ✏️ Editar perfil y 🔑 Cambiar contraseña),
  los integrantes y las salas favoritas.
- **🔧 Ajustes en el engranaje**: dentro del **Perfil** la campana de avisos se cambia por el
  **engranaje de Ajustes** (la campana vuelve al salir del perfil). Al tocarlo se despliega a
  **pantalla completa** (igual que el panel de avisos, ocultando la barra inferior) con toda la
  configuración en grupos de filas con icono y chevrón:
  - **Mi cuenta**: Datos personales · Contraseña · Mis instrumentos ·
    Mi panel de sala (dueños) / Panel de administración (general).
  - **Preferencias**: Notificaciones de reservas (activa o corta los avisos en pantalla) ·
    Mi zona · Mis avisos · Apariencia (Automático / Claro / Oscuro, las tres funcionan).
  - **Mis reservas**: Próximas reservas · Historial · Salas favoritas.
  - **Ayuda**: Ayuda y contacto · Términos y condiciones.
  - **Cerrar sesión** con borde rojo suave.
- **Próximas reservas** y **Historial** filtran la lista *Mis reservas* de la vista de **Salas**
  (la lista ya no se muestra en el Inicio):
  aparece un aviso con el botón **Ver todas** para volver a la lista completa.

## 🚀 Arranque y temas (claro / oscuro)

**Pantalla de arranque.** Al abrir la app (o al instalarla y abrirla desde el ícono) aparece
un splash con el fondo del tema, un **igualador de 5 barras verdes** que late en el centro y la
**marca +MÚSICA** abajo. Se oculta sola cuando la app terminó de cargar (nunca antes de
1,9 s y con corte de seguridad a los 5 s). En pantallas con movimiento reducido las barras
quedan quietas.

- Está hecha con HTML/CSS propio (`#splash` en `index.html`), así que se pinta al instante
  aunque la hoja de estilos tarde: hay un CSS crítico en línea en el `<head>`.
- Geometría tomada de la referencia: barras de `clamp(14px, 4.2vw, 41px)` con separación
  `clamp(12px, 3vw, 29px)` centradas a la altura del 46 %; marca de `min(47vw, 190px)` al 8,5 %
  del piso.

**Tema claro / oscuro / automático.** La fila **Apariencia** (Perfil → Preferencias) tiene las
tres opciones activas:

- **Oscuro** (por defecto): fondo `#0D1B2F`, tarjetas `#16263D`, texto `#F4F5F2`.
- **Claro**: fondo `#F5F5F2`, tarjetas blancas `#FFFFFF`, bordes `#DEE1D9`, texto `#0D1A2E`,
  verde de acento igual `#00A038`.
- **Automático**: sigue lo que tenga configurado el celular (`prefers-color-scheme`) y se
  actualiza si el sistema cambia.

El **ícono de la aplicación** (favicon) usa el esquema de color del brand kit **+MÚSICA** y sigue
el tema activo:

- **Oscuro / Automático (noche)**: azul marino `#0E1829` con barras verdes `#00A037`
  (`assets/icon-app-oscuro-192.png` y `icon-app-oscuro-512.png`, también los del manifiesto PWA).
- **Claro / Automático (día)**: fondo verde `#00A037` con barras blancas `#FFFFFF`
  (`assets/icon-app-claro-192.png`).

El cambio se hace al cargar la página y cada vez que se elige un tema (incluido el modo
automático cuando el sistema cambia de preferencia).

Detalles de implementación:

- La elección se guarda en `localStorage['mm-tema']` y se aplica con un `<script>` en el
  `<head>` **antes de pintar**, así no hay parpadeo de color al abrir. También cambia el
  `theme-color` de la barra del navegador (`#0d1b2f` / `#f5f5f2`).
- Todos los colores del CSS pasaron a variables (`--bg`, `--panel`, `--line`, `--text`,
  `--hdr`, `--pop`, `--soft`, `--tinte`, `--sombra`…); el tema claro solo las redefine en
  `:root[data-tema="claro"]` y en `@media (prefers-color-scheme: light)` para `auto`.
- El logo blanco de la marca no se ve sobre fondo claro, así que hay una segunda versión
  (`assets/logo_musica_negro.png`, texto `#0D1A2E` + verde) que se muestra u oculta con CSS
  (`img.logo-tema-o` / `img.logo-tema-b`) en la cabecera, la bienvenida y el splash.
- Capas sobre fotos (visor de imágenes, botón de favoritas, recortes) mantienen el fondo
  oscuro en ambos temas para que el contenido se lea igual.

## 🗺 El mapa de las salas

El mapa tiene **pantalla propia**: botón central **🗺 Mapa** de la barra inferior
(**Inicio · Salas · 🗺 Mapa · Instrumentos · Perfil**).

- Cada sala aparece **con su logo**. Al tocarla se abre el **detalle de la sala**:
  - 📷 **Foto horizontal** de la sala (tocá la foto para verla en grande, con zoom).
  - 🎸 **Logo** de la sala.
  - 📍 **Dirección** (y localidad).
  - 📞 **Teléfono** — tócalo para llamar desde el celular (botón **📞 Llamar**).
  - 📍 **Google Maps** — botón que abre la ubicación en Google Maps (pestaña nueva).
    Cada sala tiene su propio enlace en **Editar sala → Enlace de Google Maps**; si no
    tiene, se abre buscando el punto o la dirección de la sala.
  - Precio por hora, capacidad, distancia y equipamiento.
  - Botones **Ver horarios**, **ℹ️ Ficha** y **♥ favorita**.
- **📍 Mi ubicación**: centra el mapa en vos y muestra la distancia a cada sala en km.
- **🔎 Ver todas**: vuelve a encuadrar todas las salas.
- **🎸 Tus reservas**: aparecen sobre el lugar de la sala (foto, fecha, horario y cancelar).
- Las salas sin punto en el mapa se listan abajo, con el aviso de que el dueño las ubicaría.
- En **Salas** está la lista con tarjetas (precio, dirección, favoritos y ficha) y un
  botón **🗺 Ver en el mapa** para abrir el mapa.

**Foto horizontal de la sala** (dueño o administración): **Panel → 🎛️ Mi sala → Foto horizontal**
o **Panel general → Salas → Editar → Foto horizontal**. Si no se carga, se usa la primera
fotografía subida de la sala.

**Cómo se ubica una sala** (dueño o administración):

1. **Panel → 🎛️ Mi sala** (o **Panel general → Salas → Editar**) → **🗺 Ubicar en el mapa**.
2. Tocá el mapa (o arrastrá el marcador) → **✔ Guardar ubicación**.
   También podés usar **🔎 Buscar por dirección**: escribe la dirección y la ubica sola.
3. Guardá los cambios: la sala aparece en el mapa para todos.

**Cómo se reserva desde el mapa**:

```
🗺 Tocá la sala  →  📅 fecha  →  🕐 horario  →  ✔ confirmar
```

Si ya tenías fecha elegida, la sala te lleva directo a los horarios.

Mapa: [Leaflet](https://leafletjs.com) + teselas de OpenStreetMap (se cachean al primer uso;
sin conexión la app sigue funcionando con la lista de salas) — o **Google Maps** si se carga
una clave API (ver abajo).

### 🌐 Mapa con Google Maps (opcional)

Por defecto el mapa usa **OpenStreetMap + Leaflet**: gratis y sin cuentas. Si querés el mapa
de **Google Maps**, cargá una clave API en **Panel general → ⚙️ Ajustes → Mapa con Google Maps**:

1. Andá a [Google Cloud → Maps Platform](https://console.cloud.google.com/google/maps-apis/overview),
   creá un proyecto y activá la **facturación** (Google da un crédito mensual; con poco uso no se paga).
2. Habilitá las APIs **Maps JavaScript API** y **Geocoding API**.
3. **Credenciales → Crear clave de API** y copiala (empieza con `AIza…`).
4. Pegála en **Ajustes → Clave de Google Maps** → **Guardar ajustes**.

Con la clave cargada:

- El **mapa principal**, el **selector de ubicación** (🗺 Ubicar en el mapa) y la **búsqueda de
  direcciones** pasan a Google Maps, con los mismos marcadores (logo en círculo, 🎸 de tus
  reservas) y el mismo detalle de sala (foto, dirección, teléfono, Google Maps, ficha).
- Si la clave no sirve (mal cargada, API habilitada o facturación pendiente) **la app avisa y
  sigue mostrando OpenStreetMap**: nunca queda sin mapa ni sin buscador de direcciones.
- La clave es **pública** (viaja en el navegador, como cualquier clave de Google Maps): en
  Google Cloud conviene restringirla por **referrer** a tu dominio.
- Si Google Maps ya se había cargado y después cambiás la clave, recargá la app (F5) para que
  aplique la nueva.

Sin clave, todo lo anterior funciona igual con OpenStreetMap y Nominatim.

---

## 💻 Formato escritorio

En pantallas de **960 px o más** la app cambia a vista de escritorio (sin recargar nada):

- El dock inferior pasa a ser un **riel lateral** con las mismas 5 opciones
  (Inicio · Salas · 🗺 Mapa · Instrumentos · Perfil); en el panel de administración desaparece,
  igual que en el celular, para usar toda la altura.
- El contenido se amplía hasta **1300 px** y queda centrado.
- El **Inicio** muestra el calendario y el resumen **uno al lado del otro**.
- El **Perfil** se distribuye en **dos columnas** (cuenta/banda · favoritas/avisos).
- Salas, instrumentos y fotos del lugar en **grillas más anchas**; el mapa ocupa casi toda la pantalla.
- Los modales llegan a **640 px** y el visor de fotos usa el 84 % del ancho.
- Hover en tarjetas y foco visible al navegar con el teclado.

En pantallas más angostas (celular/tablet) se mantiene el dock inferior, tal cual.

---

## 🎛️ Panel del dueño de la sala

Botón **🎛️ Mi sala** (arriba a la derecha o desde *Perfil*):

| Pestaña | Qué permite hacer |
|---|---|
| 🏠 Mi sala | Editar nombre, descripción, dirección, localidad, mapa, teléfono, precio, capacidad, equipamiento, logo, **foto horizontal** y fotos |
| 🕐 Disponibilidad | Días y horarios de atención, duración de los turnos (30/60/90/120), volver al horario general, bloquear horarios |
| 📲 Reservas | Ver sus reservas, filtrar, editar horario, cancelar (con aviso al músico) |
| 👤 Mis datos | Nombre, teléfono, localidad, instrumentos, foto, contraseña y cierre de sesión |

El dueño **solo** ve y toca su propia sala: el servidor lo valida con cada pedido.

## 👑 Panel de administración general

| Pestaña | Qué permite hacer |
|---|---|
| 📥 Solicitudes | Revisar salas nuevas: **aprobar**, **rechazar**, **pedir correcciones**, **activar/desactivar/suspender** |
| 👥 Cuentas | Ver todas las cuentas, bloquear, desactivar, cambiar el rol, eliminar |
| 📲 Reservas | Reservas del día con el diseño de la app: selector de fecha (‹ día ›, "Ir a hoy"), tarjetas de **ingresos y cantidad**, filtro por sala con su color, y tarjetas de reserva con hora/banda/precio, **Editar** y **Cancelar** (con confirmación integrada) |
| 📋 Historial | Todas las reservas (futuras/pasadas), con canceladas marcadas |
| 🎸 Salas | Crear/editar/eliminar salas, precio, estado, equipamiento, duración de turno |
| 🕐 Horarios | Horarios generales de atención (los que usa toda sala sin horario propio) |
| 🚫 Bloqueos | Bloquear horarios de cualquier sala |
| 📊 Estadísticas | Ingresos, ocupación, reservas, horas, sala más reservada |
| ⚙️ Ajustes | Tarjetas ordenadas: datos de la app (moneda, regla de cancelación), mapa (clave de Google Maps), PIN de emergencia, apariencia (Automático/Claro/Oscuro), **cuenta madre** (nombre, usuario y email editables + cambio de contraseña), acceso al panel y copia de seguridad (exportar/importar, demo, borrar todo) |
| 🖼 Lugar | Fotos del lugar que se ven en la app pública |
| 🎭 Bandas | Bandas registradas, fotos y datos |
| 🎉 Promociones | Novedades y promos de la administración que se muestran en la **campana de notificaciones** |

---

## 🔌 API (resumen)

**Autenticación** (`Authorization: Bearer <token>`)
```
POST /api/auth/registro            crear cuenta de músico
POST /api/auth/registro-sala       registrar mi sala (queda pendiente)
POST /api/auth/login               { usuario|email, password }
POST /api/auth/pin                 { pin }  → acceso de emergencia
POST /api/auth/logout
GET  /api/auth/me
PUT  /api/auth/perfil              datos (nombre, email, usuario), foto o contraseña
PUT  /api/auth/favoritos           { roomId }
GET  /api/notificaciones · POST /api/notificaciones/leer
```

**Panel del dueño** (`ROOM_ADMIN` de esa sala o `SUPER_ADMIN`)
```
GET    /api/panel/sala[?roomId=]   datos + reservas + bloqueos + resumen
PUT    /api/panel/sala             editar la sala
PUT    /api/panel/horario          días, horarios y duración de turnos
DELETE /api/panel/horario          volver al horario general
POST   /api/panel/bloqueo          bloquear un horario
DELETE /api/panel/bloqueo/:id
PUT    /api/panel/reserva/:id      editar una reserva
DELETE /api/panel/reserva/:id      cancelar una reserva
```

**Administración general** (`SUPER_ADMIN` o PIN)
```
GET    /api/admin/usuarios          PUT/DELETE /api/admin/usuarios/:id
GET    /api/admin/solicitudes       PUT /api/admin/solicitudes/:id  { accion }
POST/PUT/DELETE /api/rooms[/:id] · /api/instruments[/:id] · /api/place-photos[/:id]
POST/PUT/DELETE /api/promociones[/:id]   novedades del Inicio
PUT /api/settings · PUT /api/settings/hours · POST/DELETE /api/blocks[/:id]
```

**Público**: `GET /api/state` · `POST /api/reserve` · `POST /api/reservations/:id/cancel` ·
`POST /api/bands` · `PUT /api/bands/:id`

---

## 🧩 Estructura

```
salas-ensayo/
├── server.js          → API, cuentas, roles, disponibilidad, archivos estáticos
├── data.json          → estado (salas, cuentas, reservas, sesiones, avisos)
├── package.json
└── public/
    ├── index.html     → interfaz (acceso, reservas, perfil, panel del dueño, administración)
    ├── styles.css     → tema oscuro, dock, formularios, panel
    ├── app.js         → vistas, reservas, cuentas, panel del dueño, administración
    ├── sw.js          → service worker (PWA)
    └── assets/        → logos, fotos de salas, fotos de usuarios, bandas
```

## 🔐 Seguridad

- Contraseñas con **scrypt** + sal por cuenta; nunca se envían al cliente.
- Sesiones con token aleatorio de 256 bits (30 días) en el encabezado `Authorization`.
- El servidor valida el rol en **cada** pedido: un `ROOM_ADMIN` solo puede tocar su sala.
- Las cuentas de la plataforma no viajan en `/api/state` (solo lo público).
- La cuenta madre no se puede registrar: se crea por consola.

## 🚀 Próximas pasos

- [ ] Pagos (Mercado Pago)
- [ ] Recordatorios por WhatsApp/email
- [ ] Códigos QR para el ingreso a la sala
- [ ] Membresías y planes
- [ ] Varias salas por dueño (ya contemplado en el modelo)