# Pendientes y cosas para revisar — Más Música (v101)

Actualizado: 20/10/2026. Este archivo es solo una guía de trabajo; la app no lo usa.

## 1. Seguridad (lo más urgente)

- [ ] **Revocar los dos tokens de GitHub** en https://github.com/settings/tokens
      (el clásico `ghp_...` y el fine-grained `github_pat_...`). Mientras estén activos,
      cualquiera que los vea puede escribir en el repositorio.
- [ ] Una vez revocados, avisarme para generar uno nuevo (o pasar a subir por `git push`).
- [ ] Revisar quién tiene la cuenta `SUPER_ADMIN` (`admin`, `admin2`) y con qué contraseña.

## 2. Cuentas de prueba que quedaron en Producción

Producción tiene 10 cuentas, varias de demostración. Se borran desde
**Administración → Usuarios** (no hace falta tocar `data.json`).

- [ ] `luca_demo`, `ana_guitarra`, `pedro_bateria`, `laura_teclado`, `marcos_bajo`,
      `sofia_canto` → parecen de demo, borrar si no son reales.
- [ ] `marcelo` (músico real) → confirmar si se queda.
- [ ] `admin2` → decidir si se conserva como segunda cuenta de administración.
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
- [ ] Definir si la **suscripción al Chat Global** se cobra de verdad.

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
- [ ] Revisar de vez en cuando el registro de producción
      (`Temp\opencode\produccion.log` y `.err.log`) buscando errores repetidos.
- [ ] Limpieza opcional en la instancia de prueba (3100): reservas y mensajes de prueba.
- [ ] `sw.js` tiene unas palabras mal codificadas en los comentarios (no afecta el
      funcionamiento, pero conviene corregirlas alguna vez).

## 9. Lo que todavía no se probó en el celular

- [ ] Seña en el celular (aunque sea en simulado).
- [ ] Reservar desde el mapa en el celular.
- [ ] Subir una foto desde la cámara del celular.
- [ ] Que las reseñas con muchas visitas se lean bien en pantalla chica.
