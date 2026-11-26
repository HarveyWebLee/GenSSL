import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './layouts/AppLayout';
import { OverviewPage } from './pages/OverviewPage';
import { RootCaPage } from './pages/RootCaPage';
import { IssueCertPage } from './pages/IssueCertPage';
import { CertsPage } from './pages/CertsPage';
import { ServersPage } from './pages/ServersPage';
import { DeployPage } from './pages/DeployPage';
import { NginxPage } from './pages/NginxPage';
import { NginxServiceNewPage } from './pages/NginxServiceNewPage';
import { NginxServicePage } from './pages/NginxServicePage';
import { GuidePage } from './pages/GuidePage';
import { ArchivePage } from './pages/ArchivePage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/ca" element={<RootCaPage />} />
          <Route path="/issue" element={<IssueCertPage />} />
          <Route path="/certs" element={<CertsPage />} />
          <Route path="/archive" element={<ArchivePage />} />
          <Route path="/servers" element={<ServersPage />} />
          <Route path="/deploy" element={<DeployPage />} />
          <Route path="/nginx" element={<NginxPage />} />
          <Route path="/nginx/new" element={<NginxServiceNewPage />} />
          <Route path="/nginx/:id" element={<NginxServicePage />} />
          <Route path="/guide" element={<GuidePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
