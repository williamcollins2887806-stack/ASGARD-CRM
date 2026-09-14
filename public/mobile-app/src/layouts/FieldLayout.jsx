import { useEffect, useState } from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import { useFieldAuthStore } from '@/stores/fieldAuthStore';
import { UpdateChangelogModal, PwaInstallBanner, PushPermissionBanner } from '@/components/field/AcademyBanners';

function hasPinLocal() {
  return localStorage.getItem('field_has_pin') === '1';
}

export default function FieldLayout() {
  const [, setReady] = useState(false);
  const status = useFieldAuthStore((s) => s.status);
  const token = useFieldAuthStore((s) => s.token);

  useEffect(() => { setReady(true); }, []);

  // После SMS без PIN — только setup, в приложение нельзя
  if (status === 'need_pin_setup' || (token && !hasPinLocal() && status !== 'authenticated')) {
    return <Navigate to="/field/pin-setup" replace />;
  }
  if (status === 'need_pin') {
    return <Navigate to="/field/pin-entry" replace />;
  }
  if (!token || status !== 'authenticated') {
    return <Navigate to="/field/welcome" replace />;
  }

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
      <UpdateChangelogModal />
      <PwaInstallBanner />
      <PushPermissionBanner />
    </div>
  );
}
