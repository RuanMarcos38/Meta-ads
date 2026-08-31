import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import Login from './pages/Login';
import Layout from './components/Layout';
import Dashboard from './pages/DashboardPro';
import Campaigns from './pages/CampaignsPro';
import Companies from './pages/CompaniesPro';
import BusinessManagers from './pages/BusinessManagers';
import AdAccounts from './pages/AdAccounts';
import Reports from './pages/Reports';
import Alerts from './pages/Alerts';
import Support from './pages/Support';
import UsersAccess from './pages/UsersAccess';
import Integrations from './pages/Integrations';
import Audit from './pages/Audit';
import AgencyOverview from './pages/AgencyOverview';
import Settings from './pages/Settings';
import { useAuth } from './store';

function Private({ children }: { children: React.ReactNode }) {
  const user = useAuth((state) => state.user);
  const token = localStorage.getItem('token');
  return user && token ? <>{children}</> : <Navigate to="/login" replace />;
}

function Roles({ roles, children }: { roles: string[]; children: React.ReactNode }) {
  const user = useAuth((state) => state.user);
  return user && roles.includes(user.role) ? <>{children}</> : <Navigate to="/" replace />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Private><Layout /></Private>}>
          <Route index element={<Dashboard />} />
          <Route path="agencia" element={<Roles roles={['SUPER_ADMIN','AGENCY_ADMIN']}><AgencyOverview /></Roles>} />
          <Route path="empresas" element={<Roles roles={['SUPER_ADMIN','AGENCY_ADMIN','MANAGER']}><Companies /></Roles>} />
          <Route path="clientes" element={<Roles roles={['SUPER_ADMIN','AGENCY_ADMIN','MANAGER']}><Companies /></Roles>} />
          <Route path="business-managers" element={<BusinessManagers />} />
          <Route path="contas-meta" element={<AdAccounts />} />
          <Route path="campanhas" element={<Campaigns />} />
          <Route path="relatorios" element={<Reports />} />
          <Route path="alertas" element={<Alerts />} />
          <Route path="atendimento" element={<Support />} />
          <Route path="usuarios" element={<Roles roles={['SUPER_ADMIN','AGENCY_ADMIN','MANAGER']}><UsersAccess /></Roles>} />
          <Route path="integracoes" element={<Roles roles={['SUPER_ADMIN','AGENCY_ADMIN']}><Integrations /></Roles>} />
          <Route path="auditoria" element={<Roles roles={['SUPER_ADMIN','AGENCY_ADMIN']}><Audit /></Roles>} />
          <Route path="configuracoes" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
