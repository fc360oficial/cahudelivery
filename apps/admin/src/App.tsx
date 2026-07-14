import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { sessao } from './api';
import { Layout } from './Layout';
import { Clientes } from './paginas/Clientes';
import { Dashboard } from './paginas/Dashboard';
import { Login } from './paginas/Login';
import { PedidoDetalhe } from './paginas/PedidoDetalhe';
import { Pedidos } from './paginas/Pedidos';
import { Produtos } from './paginas/Produtos';

function Protegido({ children }: { children: React.ReactNode }) {
  return sessao() ? <Layout>{children}</Layout> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Protegido><Dashboard /></Protegido>} />
        <Route path="/pedidos" element={<Protegido><Pedidos /></Protegido>} />
        <Route path="/pedidos/:id" element={<Protegido><PedidoDetalhe /></Protegido>} />
        <Route path="/clientes" element={<Protegido><Clientes /></Protegido>} />
        <Route path="/produtos" element={<Protegido><Produtos /></Protegido>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
