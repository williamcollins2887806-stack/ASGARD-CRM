const http = require('http');
const startTime = Date.now();
const options = {
  hostname: 'localhost', port: 3000, method: 'GET',
  path: '/api/mimir/auto-estimate?work_id=11',
  headers: {
    'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MzQ3NCwibG9naW4iOiJhbmRyb3NvdiIsInJvbGUiOiJBRE1JTiIsImlhdCI6MTc3NjAwNTk3MCwiZXhwIjoxNzc2MDkyMzcwfQ.WKo_bHgW-VOuGFMaQfmkFzml7rk_5CI60YALZCT5YPs',
    'Accept': 'text/event-stream'
  }
};
let body = '';
const req = http.request(options, (res) => {
  console.log('Status:', res.statusCode);
  res.on('data', (chunk) => { body += chunk.toString(); });
  res.on('end', () => {
    console.log('Time:', Math.round((Date.now() - startTime)/1000) + 's');
    const SEP = String.fromCharCode(10) + String.fromCharCode(10);
    const lines = body.split(SEP).filter(l => l.startsWith('data:'));
    lines.forEach(l => {
      try {
        const d = JSON.parse(l.slice(5).trim());
        if (d.type === 'heartbeat') return;
        if (d.type === 'result') {
          console.log('=== RESULT ===');
          console.log('total_cost:', d.card && d.card.total_cost);
          console.log('total_with_vat:', d.card && d.card.total_with_vat);
          console.log('crew:', d.card && d.card.crew_count, 'days:', d.card && d.card.work_days);
          console.log('markup:', d.card && d.card.markup_multiplier);
          console.log('fot:', d.card && d.card.fot_subtotal);
          console.log('travel:', d.card && d.card.travel_subtotal);
          console.log('transport:', d.card && d.card.transport_subtotal);
          console.log('chemistry:', d.card && d.card.chemistry_subtotal);
          console.log('current:', d.card && d.card.current_subtotal);
          console.log('warnings:', d.analysis && d.analysis.warnings && d.analysis.warnings.length);
          console.log('equipment:', d.equipment_status && d.equipment_status.to_purchase && d.equipment_status.to_purchase.length);
          console.log('crew_rec:', d.recommended_crew && d.recommended_crew.length);
          console.log('model:', d.ai_meta && d.ai_meta.model);
          console.log('duration_ms:', d.ai_meta && d.ai_meta.duration_ms);
        } else if (d.type === 'error') {
          console.log('ERROR:', d.message);
        } else if (d.type === 'text_response') {
          console.log('TEXT:', (d.text || '').substring(0, 500));
        } else if (d.type === 'questions') {
          console.log('QUESTIONS:', JSON.stringify(d.questions));
        } else {
          console.log(d.type + ':', d.message || '');
        }
      } catch(e) { console.log('PARSE_ERR:', l.substring(0, 100)); }
    });
    process.exit(0);
  });
});
req.on('error', (e) => { console.log('ERR:', e.message); process.exit(1); });
req.end();
setTimeout(() => { console.log('TIMEOUT 280s'); process.exit(1); }, 280000);
