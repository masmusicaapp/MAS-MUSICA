# Pendientes y cosas para revisar — Más Música (v103)

Actualizado: 20/10/2026. Este archivo es solo una guía de trabajo; la app no lo usa.

## 0. Cambios recientes

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
- [ ] Revisar quién tiene la cuenta `SUPER_ADMIN` (`admin`) y con qué contraseña.

## 2. Cuentas de prueba que quedaron en Producción

- [x] **Borradas las 6 cuentas de demo** (`luca_demo`, `ana_guitarra`, `pedro_bateria`,
      `laura_teclado`, `marcos_bajo`, `sofia_canto`): ninguna tenía sala ni reservas.
      También se limpió su rastro (suscripciones al chat y mensajes que quedaban huérfanos).
- [x] **Borradas `marcelo` (USER) y `admin2` (SUPER_ADMIN)**: no tenían sala; las reservas
      de producción no les pertenecen (`userId: null`). Se limpió su rastro (7 mensajes de
      chat y 1 suscripción).
- Producción quedó con **2 cuentas**: `admin` (SUPER_ADMIN) y `madeinpilar`
      (ROOM_ADMIN, dueño de la sala "made in pilar").
- [ ] Contraseñas de prueba: hoy casi todo usa `Test1234!`.
      Cambiar la de `admin` y la de `madeinpilar` (dueño de sala) antes de abrir al público.

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

- [ ] Hoy **Producción tiene los pagos apagados**: reservar no cobra nada.
- [ ] Falta activar **Mercado Pago** (token + URL pública) y probar el camino completo:
      reserva → seña → confirmación → webhook.
- [x] **Suscripción al Chat Global**: queda **solo el plan mensual de $5.000** (se
      eliminaron los planes trimestral y anual).
- [ ] **La suscripción al chat todavía NO se cobra**: al tocar "Suscribirme ahora" se
      activa directo, sin pasar por Mercado Pago. Si se quiere cobrar de verdad, hay que
      conectarla al mismo circuito de pago que la seña.

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
