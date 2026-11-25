import { useEffect } from 'react';
import { Layout } from './components/layout/Layout';
import { navigate, resolveRoute, useLocation, type RouteDef } from './app/router';
import { DashboardPage } from './pages/DashboardPage';
import { DevicesPage } from './pages/DevicesPage';
import { DeviceDetailPage } from './pages/DeviceDetailPage';
import { SensorsPage } from './pages/SensorsPage';
import { NetworkMapPage } from './pages/NetworkMapPage';
import { SitesPage } from './pages/SitesPage';
import { AlertsPage } from './pages/AlertsPage';
import { ReportsPage } from './pages/ReportsPage';
import { DiscoveryPage } from './pages/DiscoveryPage';
import { CollectorsPage } from './pages/CollectorsPage';
import { AdminPage } from './pages/AdminPage';
import { Empty, PageHeader } from './components/ui';

const routes: RouteDef[] = [
  { pattern: '/dashboard', render: () => <DashboardPage /> },
  { pattern: '/devices', render: () => <DevicesPage /> },
  { pattern: '/devices/:id', render: (p) => <DeviceDetailPage id={p.id} /> },
  { pattern: '/sensors', render: () => <SensorsPage /> },
  { pattern: '/maps', render: () => <NetworkMapPage /> },
  { pattern: '/sites', render: () => <SitesPage /> },
  { pattern: '/alerts', render: () => <AlertsPage /> },
  { pattern: '/reports', render: () => <ReportsPage /> },
  { pattern: '/discovery', render: () => <DiscoveryPage /> },
  { pattern: '/collectors', render: () => <CollectorsPage /> },
  { pattern: '/admin', render: () => <AdminPage /> },
];

export function App() {
  const { path } = useLocation();

  useEffect(() => {
    if (path === '/') navigate('/dashboard', { replace: true });
  }, [path]);

  const page = resolveRoute(routes, path);
  return (
    <Layout>
      {/* key erzwingt frischen Zustand je Seite */}
      <div key={path} style={{ display: 'contents' }}>
        {page ?? (
          <>
            <PageHeader title="Seite nicht gefunden" />
            <Empty>Die Adresse „{path}“ existiert nicht.</Empty>
          </>
        )}
      </div>
    </Layout>
  );
}
