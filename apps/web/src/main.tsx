import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import Login from './pages/Login';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Campaigns from './pages/Campaigns';
import Clients from './pages/Clients';
import { useAuth } from './store';

function Private({ children }: { children: React.ReactNode }) {
  const user = useAuth((s) => s.user);
  return user ? <>{children}</> : <Navigate to="/login" />;
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
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
