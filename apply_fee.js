const fs = require('fs');

// 1. Actualizar server.js
let serverContent = fs.readFileSync('server.js', 'utf8');

const targetCalc = `/* El servidor calcula todo: total, seña, comisión (se descuenta de la seña) y saldo */
function calcularPago(room, startMin, endMin, alquiler, regs) {
  const horas = (endMin - startMin) / 60;
  const total = Math.round(room.price * horas) + (alquiler || []).reduce((s, a) => s + a.total, 0);
  const sena = Math.min(total, Math.round(total * regs.senaPorcentaje / 100));
  const comision = Math.min(sena, Math.round(total * regs.comisionPorcentaje / 100));
  return { total, sena, comision, paraSala: sena - comision, saldo: total - sena };
}`;

const replaceCalc = `/* Modelo de negocio oficial +MÚSICA:
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
}`;

if (serverContent.includes(targetCalc)) {
  serverContent = serverContent.replace(targetCalc, replaceCalc);
  console.log('calcularPago reemplazado correctamente.');
} else {
  console.log('calcularPago no coincidió exactamente');
}

serverContent = serverContent.replace(
  'Object.assign(pago, { total: reservation.total, sena: reservation.sena, saldo: reservation.saldo, venceEn: reservation.venceEn });',
  'Object.assign(pago, { room_price: reservation.room_price, service_fee: reservation.service_fee, total_amount: reservation.total_amount, total: reservation.total, sena: reservation.sena, saldo: reservation.saldo, venceEn: reservation.venceEn });'
);

fs.writeFileSync('server.js', serverContent, 'utf8');

// 2. Actualizar public/app.js para mostrar el desglose explícito
let appContent = fs.readFileSync('public/app.js', 'utf8');

// Modificar renderConfirm para mostrar:
// - Precio de la sala / alquiler
// - Recargo del servicio +MÚSICA (5%)
// - Total a pagar
const targetSummary = `      <div><span>Precio por hora</span><strong>\${fmtMoney(room.price)}</strong></div>
      <div id="bk-alq-row" hidden><span>Alquiler de instrumentos</span><strong id="bk-alq-val">\${fmtMoney(0)}</strong></div>
      <div><span>Total a pagar</span><strong class="accent" id="bk-total">\${fmtMoney(total)}</strong></div>`;

const replaceSummary = `      <div><span>Precio por hora</span><strong>\${fmtMoney(room.price)}</strong></div>
      <div><span>Subtotal sala</span><strong id="bk-subtotal-sala">\${fmtMoney(total)}</strong></div>
      <div id="bk-alq-row" hidden><span>Alquiler instrumentos</span><strong id="bk-alq-val">\${fmtMoney(0)}</strong></div>
      <div><span>Servicio +MÚSICA (5%)</span><strong id="bk-fee" class="muted">\${fmtMoney(Math.round(total * 0.05))}</strong></div>
      <div style="border-top:1px dashed var(--border);padding-top:6px;margin-top:4px"><span>Total a pagar</span><strong class="accent" id="bk-total" style="font-size:1.15rem">\${fmtMoney(total + Math.round(total * 0.05))}</strong></div>`;

if (appContent.includes(targetSummary)) {
  appContent = appContent.replace(targetSummary, replaceSummary);
  console.log('Summary reemplazado en app.js');
} else {
  console.log('targetSummary no coincidió en app.js');
}

// Modificar recálculo de checkboxes de alquiler
const targetRecalc = `      $('#bk-alq-row').hidden = suma <= 0;
      $('#bk-alq-val').textContent = fmtMoney(suma);
      $('#bk-total').textContent = fmtMoney(total + suma);`;

const replaceRecalc = `      $('#bk-alq-row').hidden = suma <= 0;
      $('#bk-alq-val').textContent = fmtMoney(suma);
      const subtotalTotal = total + suma;
      const fee5 = Math.round(subtotalTotal * 0.05);
      $('#bk-fee').textContent = fmtMoney(fee5);
      $('#bk-total').textContent = fmtMoney(subtotalTotal + fee5);`;

if (appContent.includes(targetRecalc)) {
  appContent = appContent.replace(targetRecalc, replaceRecalc);
  console.log('Recálculo alquiler actualizado en app.js');
}

// Modificar modal de confirmación con pago
const targetPagoModal = `<p class="accent"><strong>Seña a pagar ahora: \${fmtMoney(data.pago.sena)}</strong></p>
        <p class="muted small">Total \${fmtMoney(data.pago.total)} · el saldo de \${fmtMoney(data.pago.saldo)} se paga en la sala.</p>`;

const replacePagoModal = `<div style="background:var(--bg-subtle, rgba(255,255,255,0.05));padding:10px 14px;border-radius:8px;margin:10px 0;text-align:left">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>Sala y servicios:</span><strong>\${fmtMoney(data.pago.room_price || data.reservation.room_price || data.pago.total)}</strong></div>
          <div style="display:flex;justify-content:space-between;margin-bottom:4px;color:var(--text-muted)"><span>Cargo de servicio +MÚSICA (5%):</span><strong>\${fmtMoney(data.pago.service_fee || data.reservation.service_fee || Math.round((data.pago.total || 0) * 0.05))}</strong></div>
          <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:6px;font-weight:bold;color:var(--accent)"><span>Total a pagar:</span><span style="font-size:1.15rem">\${fmtMoney(data.pago.total_amount || data.pago.total)}</span></div>
        </div>`;

if (appContent.includes(targetPagoModal)) {
  appContent = appContent.replace(targetPagoModal, replacePagoModal);
  console.log('Modal de pago actualizado en app.js');
}

fs.writeFileSync('public/app.js', appContent, 'utf8');

// 3. Incrementar versión en public/index.html para invalidar caché
let indexContent = fs.readFileSync('public/index.html', 'utf8');
indexContent = indexContent.replace(/styles\.css\?v=[0-9.]+/g, 'styles.css?v=3.6');
indexContent = indexContent.replace(/app\.js\?v=[0-9.]+/g, 'app.js?v=3.6');
fs.writeFileSync('public/index.html', indexContent, 'utf8');
console.log('index.html actualizado a v3.6');
