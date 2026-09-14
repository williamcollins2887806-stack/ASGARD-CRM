/**
 * Mobile widget: воронка перенесена на хаб тендеров.
 */
import { useNavigate } from 'react-router-dom';

export default function TendersFunnelWidget() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate('/tenders')}
      style={{
        width: '100%', textAlign: 'left', padding: 12,
        borderRadius: 12, border: '1px solid var(--brd)', background: 'var(--bg-2)', color: 'inherit'
      }}
    >
      <div style={{ fontWeight: 700 }}>Воронка тендеров</div>
      <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>Открыть хаб тендеров</div>
    </button>
  );
}
