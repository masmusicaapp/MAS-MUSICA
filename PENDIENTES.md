# Pendientes y cosas para revisar — Más Música (v124)

Actualizado: 21/10/2026. Este archivo es solo una guía de trabajo; la app no lo usa.

## 0. Cambios recientes

- [x] **El músico puede eliminar sus reservas pasadas** (v124). En **Mis reservas** (Inicio),
      además de las reservas canceladas, ahora también se pueden borrar del historial las
      reservas que **ya pasaron**. Reglas: solo el dueño de la reserva (o la sala/administración)
      puede eliminarla; una reserva **futura activa** no se borra (primero hay que cancelarla);
      y si la reserva tiene una **seña pagada** no se elimina (queda para auditoría y facturación).
      Cambio de servidor + cliente → versión v124.
- [x] **Detalle de suscripciones al chat cobradas** (v123). En **Administración → Pagos y
      Señas** se agregó la sección "Suscripciones al Chat" con tarjetas de resumen (cobrado,
      neto, IVA 21% y cantidad) y una tabla con fecha de pago, músico, plan, total, neto, IVA
      y el ID de pago de Mercado Pago. Sirve para **facturar el IVA**: el precio de $5.000 es
      final (con IVA incluido), así que se desglosa en neto $4.132 + IVA $868. Cambio de
      servidor + cliente → versión v123.
- [x] **Suscripción al chat conectada a Mercado Pago** (v122). Antes, tocar "Suscribirme"
      activaba el acceso al instante y marcaba el pago como aprobado **sin cobrar**. Ahora,
      con Mercado Pago activo, se genera el link de pago ($5.000 final, IVA incluido) y el
      acceso al Chat Global se activa recién cuando el webhook confirma el pago. El pago se
      abre en otra pestaña y, al volver (`?chat=ok`), la app verifica y activa.
      Con el cobro apagado o simulado, sigue activando directo (como antes).
      Cambio de servidor + cliente → versión v122.
- [x] **Inicio: la barra de las 5 opciones ya no tapa "Mis reservas"** (v121). Cuando había
      varias reservas, las últimas tarjetas quedaban por debajo de la barra inferior en el
      celular (y en escritorio el panel se salía de su recuadro). Ahora, en celular el
      listado deja aire abajo (siempre queda por encima de la barra) y en escritorio el
      panel de "Mis reservas" scrollea dentro de su recuadro. Solo CSS → cambio de cliente,
      versión v121.
- [x] **Administración central: se quitó el deslizamiento lateral (swipe) para cambiar de
      pestaña** (v120). Antes, en el celular, al deslizar el dedo de derecha a izquierda
      (o al revés) sobre el panel se pasaba a la pestaña siguiente/anterior. Ese gesto se
      sacó: ahora se cambia de pestaña **solo tocándola**. Cambia cliente (JS) → versión
      v120.
- [x] **Arreglo de textos cortados en "Pagos y Señas"** (v119): los rótulos de las
      tarjetas ("Comisión +Música", "Asignado a salas", "Ya transferido"…) y los títulos
      de las tablas de liquidación se recortaban con puntos suspensivos en pantallas
      angostas. Ahora pasan a dos líneas cuando no entran y las tablas se desplazan en
      horizontal en vez de apretar el texto. Solo CSS → no cambia el servidor.
- [x] **Datos de cobro de la sala + panel de liquidaciones** (v118): cada dueño carga en
      **Mi panel → Información → Datos de cobro** su titular, banco/billetera, alias y CVU.
      Ese dato es privado (solo lo ve el dueño de la sala y la administración). En
      **Administración → Pagos y Señas**, la tabla por sala ahora tiene la columna
      "Datos de cobro" para saber a dónde transferir el importe de cada liquidación.
      El pago sigue entrando a +MÚSICA y la transferencia a la sala se hace a mano
      (ver sección 6 sobre por qué no es automática por API).
- [x] **Refuerzos de seguridad** (servidor): CSP en HTML y API, `ipDeReq` endurecido
      (solo confía en `x-forwarded-for` desde el proxy/túnel propio) y freno general de
      escritura (120 peticiones POST/PUT/PATCH/DELETE por IP cada 5 min). No cambia el
      cliente → sin bump de versión. Requiere reiniciar el server (ya reiniciado).
- [x] **Contraseñas de producción cambiadas**: `admin` (SUPER_ADMIN) y `madeinpilar`
      (ROOM_ADMIN) ya no usan `Test1234!`. Se generaron claves fuertes y se cerraron las
      37 sesiones abiertas. Las claves nuevas no quedan escritas en ningún archivo.
- [x] **Barra de las 5 opciones se oculta al deslizar hacia abajo** (v116): baja y se
      esconde al deslizar hacia abajo y reaparece al deslizar hacia arriba. En el mapa no
      se oculta.
- [x] **Se quitó "Términos y condiciones" del inicio** (v117): sigue estando dentro de
      Ajustes (abre `terminos.html`).
- [x] **Catálogo de equipos también desde la cuenta madre** (v105): la cuenta madre
      (SUPER_ADMIN) puede cargar los equipos de cualquier sala desde **Administración →
      Salas → Editar sala → Catálogo de equipos** (mismo formulario que usa el dueño). Al
      agregar/editar un equipo, vuelve solo al formulario de la sala sin perder lo escrito.
      Sirve para dar una mano cuando el dueño tiene dificultades.
- [x] **Catálogo de equipos por sala** (v104): cada sala ahora tiene su propio catálogo de
      equipos (nombre, descripción, foto y, si se alquila, precio por hora). El dueño lo
      carga desde **Mi panel → Información → Catálogo de equipos** (con "Agregar equipo";
      se guarda al tocar "Guardar sala"). Los músicos lo ven al abrir la sala (ficha) y los
      equipos en alquiler aparecen al confirmar la reserva, con su precio por hora.
      Se eliminó la vista general "Equipos y sala" (botón, pantalla y pestaña "Lugar" del
      panel de administración), que mostraba un catálogo único para todas las salas.
- [x] **Emojis reemplazados por íconos SVG en toda la app** (v103): menús, botones,
      títulos, avisos, panel de administración (Cuentas, Ayuda, Salas, Estadísticas,
      Ajustes), etc. Ya no queda ningún emoji visible. En el mapa, el ícono cuando una
      sala no tiene foto usa una nota musical (dibujo de canvas). El tilde verde del
      formulario de registro ahora es un SVG (en `styles.css`).

## 1. Seguridad (lo más urgente)

- [ ] **Revocar los dos tokens de GitHub** en https://github.com/settings/tokens
      (el clásico `ghp_...` y el fine-grained `github_pat_...`). Mientras estén activos,
      cualquiera que los vea puede escribir en el repositorio.
- [ ] Una vez revocados, avisarme para generar uno nuevo (o pasar a subir por `git push`).
- [x] **Revisar quién tiene la cuenta `SUPER_ADMIN` (`admin`) y con qué contraseña**:
      hoy hay una sola cuenta madre (`admin`) y su contraseña ya no es la de prueba.
- [x] **Refuerzos de seguridad del servidor**: CSP, `ipDeReq` endurecido y freno general
      de escritura (ver "Cambios recientes"). Queda opcional a futuro: separar los scripts
      en línea del HTML para poder quitar `'unsafe-inline'` de la CSP (hoy hace falta por
      los manejadores `onclick=` y los dos `<script>` en línea de `index.html`).

## 2. Cuentas de prueba que quedaron en Producción

- [x] **Borradas las 6 cuentas de demo** (`luca_demo`, `ana_guitarra`, `pedro_bateria`,
      `laura_teclado`, `marcos_bajo`, `sofia_canto`): ninguna tenía sala ni reservas.
      También se limpió su rastro (suscripciones al chat y mensajes que quedaban huérfanos).
- [x] **Borradas `marcelo` (USER) y `admin2` (SUPER_ADMIN)**: no tenían sala; las reservas
      de producción no les pertenecen (`userId: null`). Se limpió su rastro (7 mensajes de
      chat y 1 suscripción).
- Producción quedó con **2 cuentas**: `admin` (SUPER_ADMIN) y `madeinpilar`
      (ROOM_ADMIN, dueño de la sala "made in pilar").
- [x] Contraseñas de prueba: se cambiaron las de `admin` y `madeinpilar` (dueño de sala).
      Ya no queda ninguna cuenta de producción con `Test1234!`.

## 3. Pedidos de ayuda sin responder

- [ ] Hay **2 pedidos de "olvidé mi contraseña"** sin resolver en
      **Administración → Ayuda**. Se resuelven generando una contraseña nueva desde ahí
      (la app la muestra para copiar y pasar).

## 4. Términos y condiciones

- [ ] Las 10 cuentas actuales **no tienen guardada la aceptación** (se pide solo al
      registrarse). Decidir si al entrar les pedimos una vez aceptar (bloqueante o
      solo un aviso) para que quede registrada también en las cuentas viejas.

## 5. Contenido de la app

- [ ] **Fotos de las salas**: hay una foto de prueba rota (`assets/salas/testlogo01-...jpg`
      da 404). En producción la sala "made in pilar" conviene cargarle fotos reales.
- [ ] **Contacto**: revisar que WhatsApp, Instagram, Facebook, TikTok y el email de
      contacto estén cargados y bien escritos (es lo que muestra "Ayuda y contacto" y los términos).
- [ ] **Términos**: releerlos con calma y confirmar los datos legales (responsable,
      jurisdicción, plazos). Se editan en `public/terminos.html`.

## 6. Pagos (cuando se quiera cobrar la seña)

- [x] **Producción tiene los pagos ACTIVOS con Mercado Pago** (`modo: mercadopago`):
      reservar pide la seña y se cobra de verdad. `BASE_URL` es la URL del túnel
      Cloudflare vigente.
- [ ] Probar el camino completo en producción: reserva → seña → confirmación → webhook.
      (Se generó un link real pero no se completó el pago; si la reserva venció, hay que
      armar una nueva para probar.)
- [x] **Suscripción al Chat Global**: queda **solo el plan mensual de $5.000** (se
      eliminaron los planes trimestral y anual).
- [x] **La suscripción al chat ya se cobra con Mercado Pago** (v122): al tocar
      "Suscribirme ahora" se genera el link de pago ($5.000 final, IVA incluido), se abre
      en otra pestaña y el acceso se activa cuando el webhook confirma el pago. Queda
      **probar el pago real** en producción (igual que la seña).
- [x] **Liquidación a las salas**: la seña entra entera a la cuenta MP de +MÚSICA; la
      parte de la sala (seña menos comisión) se le transfiere a mano. Para eso, el dueño
      carga su alias/CVU en **Mi panel → Información → Datos de cobro** y +MÚSICA los ve
      en **Administración → Pagos y Señas → Datos de cobro**, con botón "Marcar liquidado".
      **Por qué no es automático:** la API de transferencias salientes de Mercado Pago
      **no está disponible públicamente en Argentina** para cuentas comunes (no hay
      endpoint en la API reference); se habilita solo por convenio comercial.
- [ ] **Split de Pagos 1:1 (marketplace) — solución definitiva a futuro**: es la única
      forma de que Mercado Pago reparta el dinero automáticamente (comisión a +MÚSICA,
      resto al dueño). Requiere implementar **OAuth** (cada dueño conecta su Mercado Pago)
      y que **cada sala tenga cuenta MP verificada (KYC 6)**. Se decidió postergarlo
      porque depende de que los dueños hagan el trámite. Cuando haya volumen, migrar.

## 7. Funciones que todavía no existen

- [ ] **Chat 1 a 1 con la sala** (hoy hay chat global e invitaciones).
- [ ] **Recuperar contraseña sin el administrador** (hoy depende de un pedido de ayuda).
- [ ] **Recordatorio también para el dueño de la sala** (hoy el aviso antes del ensayo
      va solo al músico y a los anotados).
- [ ] **Reseñas**: si más adelante hay usuarios muy activos, revisar el tope
      (hoy son 10 por cuenta y sala, configurable en `MAX_RESENAS_POR_SALA`).

## 8. Mantenimiento

- [x] **Backup automático de `data.json`**: hecho. El servidor guarda una copia del día
      en `backups/data-AAAA-MM-DD.json` la primera vez que se guarda algo, y conserva
      las últimas **7**. No hace falta hacer nada: se dispara solo.
- [x] **`data_backup_*.json` y logs viejos** movidos a `backups/viejos/` (no se borraron).
- [x] `backups/` agregado al `.gitignore` para que nunca se suba a GitHub.
- [x] **Freno de intentos de login**: ya existía (bloquea por IP tras varios fallos en
      15 min). Se bajó el tope de **25 a 8** intentos. Un login correcto limpia el contador,
      así que nadie se traba por equivocarse un par de veces.
- [ ] Revisar de vez en cuando el registro de producción
      (`Temp\opencode\produccion.log` y `.err.log`) buscando errores repetidos.
      El servidor **sí registra los ingresos fallidos** con la IP de quien intenta.
- [ ] Limpieza opcional en la instancia de prueba (3100): reservas y mensajes de prueba.
- [ ] `sw.js` tiene unas palabras mal codificadas en los comentarios (no afecta el
      funcionamiento, pero conviene corregirlas alguna vez).
- [ ] **Registro de errores**: se encontró un `EADDRINUSE` viejo (18/10) porque se levantó
      el servidor dos veces sobre el puerto 3000. No es un problema de la app ni de los
      usuarios: solo pasa si se reinicia mal. Se puede dejar salir ordenadamente si vuelve
      a pasar.

## 9. Lo que todavía no se probó en el celular

- [ ] Seña en el celular (aunque sea en simulado).
- [ ] Reservar desde el mapa en el celular.
- [ ] Subir una foto desde la cámara del celular.
- [ ] Que las reseñas con muchas visitas se lean bien en pantalla chica.

