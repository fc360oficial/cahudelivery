import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { sessao } from './api';
import { Layout } from './Layout';
import { Banners } from './paginas/Banners';
import { Categorias } from './paginas/Categorias';
import { Clientes } from './paginas/Clientes';
import { Configuracoes } from './paginas/Configuracoes';
import { Dashboard } from './paginas/Dashboard';
import { Login } from './paginas/Login';
import { Logs } from './paginas/Logs';
import { Marcas } from './paginas/Marcas';
import { Notificacoes } from './paginas/Notificacoes';
import { PedidoDetalhe } from './paginas/PedidoDetalhe';
import { Pedidos } from './paginas/Pedidos';
import { Produtos } from './paginas/Produtos';
import { Promocoes } from './paginas/Promocoes';
import { Patrocinadores } from './paginas/Patrocinadores';
import { SolicitacoesCredito } from './paginas/SolicitacoesCredito';
import { Usuarios } from './paginas/Usuarios';

function Protegido({ children }: { children: React.ReactNode }) {
  return sessao() ? <Layout>{children}</Layout> : <Navigate to="/login" replace />;
}

const ROTAS: [string, React.ReactNode][] = [
  ['/', <Dashboard />],
  ['/pedidos', <Pedidos />],
  ['/pedidos/:id', <PedidoDetalhe />],
  ['/clientes', <Clientes />],
  ['/credito', <SolicitacoesCredito />],
  ['/produtos', <Produtos />],
  ['/categorias', <Categorias />],
  ['/marcas', <Marcas />],
  ['/promocoes', <Promocoes />],
  ['/patrocinadores', <Patrocinadores />],
  ['/banners', <Banners />],
  ['/notificacoes', <Notificacoes />],
  ['/usuarios', <Usuarios />],
  ['/configuracoes', <Configuracoes />],
  ['/logs', <Logs />],
];

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        {ROTAS.map(([caminho, el]) => (
          <Route key={caminho} path={caminho} element={<Protegido>{el}</Protegido>} />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
