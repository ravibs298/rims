import { Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { ProtectedRoute, useAuth } from './auth';
import LoginPage from './pages/LoginPage';
import Dashboard from './pages/Dashboard';
import Products from './pages/Products';
import Inventory from './pages/Inventory';
import Orders from './pages/Orders';
import Suppliers from './pages/Suppliers';
import PurchaseOrders from './pages/PurchaseOrders';
import Scan from './pages/Scan';
import Reports from './pages/Reports';
import Users from './pages/Users';
import Integrations from './pages/Integrations';

export const NAV: { to: string; label: string; perm: string; element: JSX.Element }[] = [
  { to: '/', label: 'Dashboard', perm: 'reports.read', element: <Dashboard /> },
  { to: '/products', label: 'Product Catalog', perm: 'products.read', element: <Products /> },
  { to: '/inventory', label: 'Inventory', perm: 'inventory.read', element: <Inventory /> },
  { to: '/orders', label: 'Orders', perm: 'orders.read', element: <Orders /> },
  { to: '/suppliers', label: 'Suppliers', perm: 'suppliers.read', element: <Suppliers /> },
  { to: '/purchase-orders', label: 'Purchase Orders', perm: 'po.read', element: <PurchaseOrders /> },
  { to: '/scan', label: 'Barcode / RFID', perm: 'scan.use', element: <Scan /> },
  { to: '/reports', label: 'Reports', perm: 'reports.read', element: <Reports /> },
  { to: '/users', label: 'Users & Roles', perm: 'users.read', element: <Users /> },
  { to: '/integrations', label: 'Integrations', perm: 'integrations.read', element: <Integrations /> },
];

function Shell() {
  const { user, logout, can } = useAuth();
  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">RIMS<small>XYZ Retail Corporation</small></div>
        {NAV.filter((n) => can(n.perm)).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>{n.label}</NavLink>
        ))}
        <div className="userbox">
          <div>{user?.full_name}</div><div className="muted">{user?.role}</div>
          <button className="small" onClick={logout}>Sign out</button>
        </div>
      </nav>
      <main className="content"><Outlet /></main>
    </div>
  );
}

function Home() {
  const { can } = useAuth();
  const first = NAV.find((n) => can(n.perm));
  return first && first.to !== '/' ? <Navigate to={first.to} replace /> : <Dashboard />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute><Shell /></ProtectedRoute>}>
        <Route index element={<ProtectedRoute perm="reports.read"><Home /></ProtectedRoute>} />
        {NAV.filter((n) => n.to !== '/').map((n) => <Route key={n.to} path={n.to.slice(1)} element={<ProtectedRoute perm={n.perm}>{n.element}</ProtectedRoute>} />)}
        <Route path="*" element={<div className="pad"><h2>Page not found</h2></div>} />
      </Route>
    </Routes>
  );
}
