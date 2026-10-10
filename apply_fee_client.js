const fs = require('fs');

let appContent = fs.readFileSync('public/app.js', 'utf8');

// 1. Reemplazar summary de confirmación
const oldSum = `      <div><span>Precio por hora</span><strong>\${fmtMoney(room.price)}</strong></div>\r\n      <div id="bk-alq-row" hidden><span>Alquiler de instrumentos</span><strong id="bk-alq-val">\${fmtMoney(0)}</strong></div>\r\n      <div><span>Total a pagar</span><strong class="accent" id="bk-total">\${fmtMoney(total)}</strong></div>`;

const oldSumLF = `      <div><span>Precio por hora</span><strong>\${fmtMoney(room.price)}</strong></div>\n      <div id="bk-alq-row" hidden><span>Alquiler de instrumentos</span><strong id="bk-alq-val">\${fmtMoney(0)}</strong></div>\n      <div><span>Total a pagar</span><strong class="accent" id="bk-total">\${fmtMoney(total)}</strong></div>`;

const newSumLF = `      <div><span>Precio por hora</span><strong>\${fmtMoney(room.price)}</strong></div>
      <div><span>Subtotal sala</span><strong id="bk-subtotal-sala">\${fmtMoney(total)}</strong></div>
      <div id="bk-alq-row" hidden><span>Alquiler instrumentos</span><strong id="bk-alq-val">\${fmtMoney(0)}</strong></div>
      <div><span>Servicio +MÚSICA (5%)</span><strong id="bk-fee" class="muted">\${fmtMoney(Math.round(total * 0.05))}</strong></div>
      <div style="border-top:1px dashed var(--border);padding-top:6px;margin-top:4px"><span>Total a pagar</span><strong class="accent" id="bk-total" style="font-size:1.15rem">\${fmtMoney(total + Math.round(total * 0.05))}</strong></div>`;

if (appContent.includes(oldSum)) {
  appContent = appContent.replace(oldSum, newSumLF);
  console.log('Summary reemplazado (CRLF)');
} else if (appContent.includes(oldSumLF)) {
  appContent = appContent.replace(oldSumLF, newSumLF);
  console.log('Summary reemplazado (LF)');
} else {
  console.log('Buscando summary con regex...');
  appContent = appContent.replace(
    /<div><span>Precio por hora<\/span>[\s\S]*?<div><span>Total a pagar<\/span><strong class="accent" id="bk-total">\$\{fmtMoney\(total\)\}<\/strong><\/div>/,
    newSumLF
  );
  console.log('Summary reemplazado con regex');
}

// 2. Reemplazar recalculo de instrumentos
appContent = appContent.replace(
  /\$\('#bk-alq-row'\)\.hidden = suma <= 0;[\s\S]*?\$\('#bk-total'\)\.textContent = fmtMoney\(total \+ suma\);/,
  `$('#bk-alq-row').hidden = suma <= 0;
      $('#bk-alq-val').textContent = fmtMoney(suma);
      const subtotalTotal = total + suma;
      const fee5 = Math.round(subtotalTotal * 0.05);
      $('#bk-fee').textContent = fmtMoney(fee5);
      $('#bk-total').textContent = fmtMoney(subtotalTotal + fee5);`
);

// 3. Reemplazar modal tras reservar
appContent = appContent.replace(
  /<p class="accent"><strong>Seña a pagar ahora:[\s\S]*?el saldo de \$\{fmtMoney\(data\.pago\.saldo\)\} se paga en la sala\.<\/p>/,
  `<div style="background:var(--bg-subtle, rgba(255,255,255,0.05));padding:10px 14px;border-radius:8px;margin:10px 0;text-align:left">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>Sala y servicios:</span><strong>\${fmtMoney(data.pago.room_price || data.reservation.room_price || data.pago.total)}</strong></div>
          <div style="display:flex;justify-content:space-between;margin-bottom:4px;color:var(--text-muted)"><span>Cargo de servicio +MÚSICA (5%):</span><strong>\${fmtMoney(data.pago.service_fee || data.reservation.service_fee || Math.round((data.pago.total || 0) * 0.05))}</strong></div>
          <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:6px;font-weight:bold;color:var(--accent)"><span>Total a pagar:</span><span style="font-size:1.15rem">\${fmtMoney(data.pago.total_amount || data.pago.total)}</span></div>
        </div>`
);

fs.writeFileSync('public/app.js', appContent, 'utf8');
console.log('app.js guardado con éxito.');
