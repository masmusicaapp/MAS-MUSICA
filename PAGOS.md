# 💳 Cobro de seña con Mercado Pago

Cuando está activado, **reservar = pagar una seña**. El resto se paga en la sala.

## Cómo funciona

1. La banda elige sala y horario → el servidor calcula el total, la seña y la comisión.
2. La reserva queda **pendiente de pago** y el horario se bloquea (15 min por defecto).
3. La banda paga la seña en Mercado Pago.
4. Mercado Pago avisa al servidor (`/api/pagos/webhook`). El servidor **consulta el pago** con tu token (así nadie puede falsificar el aviso) y confirma la reserva.
5. Si no se paga a tiempo, la reserva se cancela y el horario queda libre.

Ejemplo con la Sala 1 ($15.000 la hora), seña 30 % y comisión 8 %:

| Concepto | Monto |
|---|---|
| Total de la reserva | $15.000 |
| Seña que paga la banda (30 %) | $4.500 |
| Comisión de +MÚSICA (8 % del total, se descuenta de la seña) | $1.200 |
| Le corresponde a la sala por la seña | $3.300 |
| Saldo que paga la banda en la sala | $10.500 |

La seña entra a **tu cuenta de Mercado Pago**; después le liquidás a cada sala lo que le toca.

## Suscripción al chat (músicos)

El **Chat Global** es solo para músicos (`rol USER`) y cuesta **$5.000 por mes**
(precio final, **IVA incluido**). Usa el mismo circuito que la seña:

1. El músico toca "Suscribirme ahora" → el servidor crea una solicitud y una preferencia de pago.
2. Se abre Mercado Pago en otra pestaña y el músico paga los $5.000.
3. Mercado Pago avisa (`/api/pagos/webhook`); el servidor consulta el pago y **activa el acceso** (30 días).
4. Al volver a la app (`?chat=ok`), si el pago ya se acreditó, el chat se abre solo.

La renovación es acumulativa: si el músico paga antes de que venza, los días se **suman**
desde el vencimiento actual (no se pierden días).

Con el cobro **apagado** o **simulado** (ver más abajo), la suscripción se activa directo,
sin pasar por Mercado Pago.

## Activarlo

Tres modos, según las variables de entorno con las que arranques el servidor:

| Modo | Cómo se activa |
|---|---|
| **Apagado** (como antes) | No definir nada. La reserva se confirma directo. |
| **Simulado** (para probar) | `MODO_PAGOS=simulado node server.js` |
| **Mercado Pago** | `MP_ACCESS_TOKEN=... BASE_URL=https://tu-dominio.com node server.js` |

Opcional: `MP_MONEDA` (por defecto `ARS`).

`BASE_URL` tiene que ser la dirección pública **con HTTPS** de la app: Mercado Pago la usa para volver a la app y para avisar los pagos. No funciona con `localhost`.

## Probar sin cobrar (modo simulado)

```bash
MODO_PAGOS=simulado node server.js
# 1) reservá desde la app (queda "Falta pagar la seña")
# 2) aprobá el pago de prueba:
curl -X POST http://localhost:3000/api/pagos/simular \
  -H "Content-Type: application/json" \
  -d '{"reservaId":"ID_DE_LA_RESERVA","resultado":"aprobado"}'
```

El ID de la reserva aparece en `GET /api/state`. Este endpoint **solo existe en modo simulado**.

## Probar con Mercado Pago (sin dinero real)

1. En tu cuenta de Mercado Pago Developers creá una aplicación y usá las **credenciales de prueba** (el token empieza con `TEST-`).
2. Creá usuarios de prueba (vendedor y comprador) y pagá con las tarjetas de prueba que da Mercado Pago.
3. Revisá en la documentación oficial vigente los pasos exactos, porque pueden cambiar.

## Cobrar de verdad: checklist

- [ ] La app está en un hosting con **HTTPS** y **disco persistente** (guarda `data.json`).
- [ ] Hacés copia de seguridad de `data.json` seguido.
- [ ] El token de Mercado Pago está en variables de entorno, no en el código ni en `data.json`.
- [ ] Cambiaste la contraseña de la cuenta madre y el PIN `1234`.
- [ ] Probaste: pago aprobado, pago rechazado, vencimiento, cancelación con reembolso.
- [ ] Publicaste términos y condiciones con la política de seña y cancelación.
- [ ] Consultaste con un contador cómo facturar tu comisión.

## Ajustar porcentajes (por ahora por API)

Guardados en `settings.reglas`: `senaPorcentaje` (30), `comisionPorcentaje` (8), `minutosPago` (15). Con el PIN de administración:

```bash
curl -X PUT http://localhost:3000/api/settings \
  -H "Content-Type: application/json" -H "x-admin-pin: TU_PIN" \
  -d '{"reglas":{"cancelacionHoras":24,"avisoHoras":24,"turnos":[30,60,90,120],"senaPorcentaje":30,"comisionPorcentaje":8,"minutosPago":15}}'
```

Esa llamada reemplaza las reglas, así que incluí también los valores que ya tenías.

## Cancelaciones y reembolsos

- Si **cancela la sala o la administración**, la seña se devuelve siempre.
- Si cancela la **banda**, se devuelve cuando cancela dentro del plazo de `cancelacionHoras`; si cancela tarde, la seña queda **retenida**.
- Si el reembolso automático falla, la reserva queda con pago `reembolso_pendiente` para resolverlo a mano desde Mercado Pago.
- Si alguien paga después de que venció la reserva: se recupera si el horario sigue libre; si no, se devuelve la seña.

## Liquidar a las salas

- `GET /api/admin/pagos` → cobrado, comisión, lo que corresponde a cada sala y lo que falta liquidar. La administración ve todo; cada dueño ve solo su sala.
- `POST /api/admin/pagos/liquidar` con `{"roomId":"..."}` → marca como liquidado lo que ya transferiste a esa sala.

## Pendiente (no incluido todavía)

- Pestaña **Pagos** en el panel y campos de seña/comisión en Ajustes (hoy se usan las rutas de arriba).
- Privacidad: `GET /api/state` le muestra a cualquier visitante nombre y teléfono de todas las reservas. Conviene ocultarlos antes de abrir la app al público.
