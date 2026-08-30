import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import Login from './pages/Login';
import Layout from './components/Layout';
import Dashboard from './pages/DashboardScoped';
import Campaigns from './pages/CampaignsScoped';
import Clients from './pages/ClientsResilient';
import { useAuth } from './store';

function Private({ children }: { children: React.ReactNode }) {
  const user = useAuth((state) => state.user);
  const token = localStorage.getItem('token');
  return user && token ? <>{children}</> : <Navigate to="/login" replace />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Private><Layout /></Private>}>
          <Route index element={<Dashboard />} />
          <Route path="campanhas" element={<Campaigns />} />
          <Route path="clientes" element={<Clients />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
