import { useRef, useState, useEffect } from 'react';
import { Outlet, useLocation, Navigate } from 'react-router-dom';

export default function FieldLayout() {
  const location = useLocation();
  const navRef = useRef(null);
  const [, setReady] = useState(false);

  // Auth guard — redirect to welcome if no field token
  const fieldToken = localStorage.getItem('field_token');
  if (!fieldToken) {
    return <Navigate to="/field/welcome" replace />;
  }

  // Force re-render after mount (for any layout effects)
  useEffect(() => { setReady(true); }, []);

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  );
}
