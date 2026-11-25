import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './layouts/AppLayout';
import { OverviewPage } from './pages/OverviewPage';
import { RootCaPage } from './pages/RootCaPage';
import { IssueCertPage } from './pages/IssueCertPage';
import { CertsPage } from './pages/CertsPage';
import { NginxPage } from './pages/NginxPage';
import { GuidePage } from './pages/GuidePage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/ca" element={<RootCaPage />} />
          <Route path="/issue" element={<IssueCertPage />} />
          <Route path="/certs" element={<CertsPage />} />
          <Route path="/nginx" element={<NginxPage />} />
          <Route path="/guide" element={<GuidePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
