/**
 * EquipmentQrPrintModal — печать QR-кодов оборудования.
 *
 * E-6b (2026-06-14). Vanilla: warehouse.js:477.
 * Backend: equipment.js:1220 (POST /api/equipment/qr-print-data).
 *
 * Принимает список id оборудования → грузит QR-данные → рендерит сетку для печати.
 */
import { useState, useEffect } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { equipmentQrPrintData } from './api';

export function EquipmentQrPrintModal({ equipmentIds = [] }) {
  const { close } = useModal();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);

  useEffect(() => {
    if (!equipmentIds.length) { setLoading(false); return; }
    equipmentQrPrintData(equipmentIds)
      .then((d) => setItems(d.items || d.qr_data || d.equipment || []))
      .catch((e) => toast.error('Ошибка: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipmentIds.join(',')]);

  const doPrint = () => {
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) return toast.error('Заблокирован попап (разреши всплывающие окна)');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>QR оборудование</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 12mm; }
        .qr-grid { display: flex; flex-wrap: wrap; gap: 8px; }
        .qr-card { width: 200px; padding: 14px; border: 1px solid #ccc; text-align: center; page-break-inside: avoid; }
        .qr-card img { width: 160px; height: 160px; }
        .qr-card .name { font-weight: bold; margin: 8px 0 2px; font-size: 13px; }
        .qr-card .inv  { font-size: 11px; color: #555; }
        @media print { @page { margin: 8mm; } .qr-card { break-inside: avoid; } }
      </style></head><body>
      <div class="qr-grid">
        ${items.map((it) => `
          <div class="qr-card">
            ${it.qr_image ? `<img src="${it.qr_image}" alt="" />` : (it.qr_url ? `<img src="${it.qr_url}" alt="" />` : '<div style="height:160px"></div>')}
            <div class="name">${escapeHtml(it.name || it.title || '')}</div>
            <div class="inv">${escapeHtml(it.inventory_number || it.serial_number || ('#' + it.id))}</div>
            ${it.location ? `<div class="inv">📍 ${escapeHtml(it.location)}</div>` : ''}
          </div>`).join('')}
      </div>
      <script>setTimeout(()=>window.print(),300)</script>
      </body></html>`;
    w.document.write(html);
    w.document.close();
  };

  return (
    <MCard className="modal-lg">
      <MHead icon="🏷" title={`Печать QR-кодов (${equipmentIds.length})`} onClose={close} />
      <MBody>
        {loading ? (
          <div className="c-t3 p-12">⏳ Готовим QR-коды…</div>
        ) : items.length === 0 ? (
          <div className="c-t3 p-12">📭 Нет данных. Backend не вернул QR-картинки.</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 480, overflowY: 'auto' }}>
            {items.map((it) => (
              <div key={it.id} style={{ width: 180, padding: 10, border: '1px solid var(--brd, #243049)', borderRadius: 6, textAlign: 'center' }}>
                {(it.qr_image || it.qr_url) ? (
                  <img src={it.qr_image || it.qr_url} alt="" style={{ width: 140, height: 140 }} />
                ) : (
                  <div style={{ width: 140, height: 140, background: '#fff', display: 'inline-block', color: '#888', fontSize: 11, padding: 8 }}>QR</div>
                )}
                <div className="fs-12 fw-700 mt-6">{it.name || it.title || ''}</div>
                <div className="c-t3 fs-11">{it.inventory_number || it.serial_number || ('#' + it.id)}</div>
              </div>
            ))}
          </div>
        )}
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Закрыть</Btn>
        <Btn variant="primary" disabled={loading || items.length === 0} onClick={doPrint}>🖨 Печать</Btn>
      </MFoot>
    </MCard>
  );
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
