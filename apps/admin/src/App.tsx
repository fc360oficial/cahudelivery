import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { HOME_DA_SOLUCAO, sessao, solucaoAtual, solucoesDaSessao, trocarSolucao, type Solucao } from './api';
import { Layout } from './Layout';
import { LayoutAdmin, LayoutVendas } from './LayoutAreas';
import { Banners } from './paginas/Banners';
import { Carteira } from './paginas/Carteira';
import { Categorias } from './paginas/Categorias';
import { Clientes } from './paginas/Clientes';
import { Configuracoes } from './paginas/Configuracoes';
import { Dashboard } from './paginas/Dashboard';
import { Dossie } from './paginas/Dossie';
import { IndicaLanding } from './paginas/IndicaLanding';
import { Indicacoes } from './paginas/Indicacoes';
import { Login } from './paginas/Login';
import { Logs } from './paginas/Logs';
import { Mapa } from './paginas/Mapa';
import { Marcas } from './paginas/Marcas';
import { Notificacoes } from './paginas/Notificacoes';
import { PedidoDetalhe } from './paginas/PedidoDetalhe';
import { Pedidos } from './paginas/Pedidos';
import { Produtos } from './paginas/Produtos';
import { Promocoes } from './paginas/Promocoes';
import { RedeCartao } from './paginas/RedeCartao';
import { Patrocinadores } from './paginas/Patrocinadores';
import { SolicitacoesCredito } from './paginas/SolicitacoesCredito';
import { Solucoes } from './paginas/Solucoes';
import { Usuarios } from './paginas/Usuarios';
import { VendasClientes } from './paginas/vendas/Clientes';
import { VendasInicio } from './paginas/vendas/Inicio';
import { VendasOrcamentos } from './paginas/vendas/Orcamentos';
import { VendasPedidoDetalhe } from './paginas/vendas/PedidoDetalhe';
import { VendasPedidos } from './paginas/vendas/Pedidos';
import { VendasProdutos } from './paginas/vendas/Produtos';
import { VendasTabelas } from './paginas/vendas/Tabelas';
import { VendasVendedores } from './paginas/vendas/Vendedores';

type Area = Solucao | 'admin';

/**
 * Guarda de cada área. Sem sessão vai ao login; sem acesso à área, vai à solução do usuário
 * (ou a /solucoes quando não houver nenhuma para onde ir). Nenhum destino volta para a mesma guarda.
 */
function Protegido({ area = 'delivery', children }: { area?: Area; children: React.ReactNode }) {
  const s = sessao();
  const lista = solucoesDaSessao(s);
  useEffect(() => {
    if (s && area !== 'admin' && lista.includes(area)) trocarSolucao(area);
  });
  if (!s) return <Navigate to="/login" replace />;
  if (area === 'admin') {
    if (s.papel !== 'admin') return <Navigate to={HOME_DA_SOLUCAO[solucaoAtual(s) ?? 'delivery']} replace />;
    return <LayoutAdmin>{children}</LayoutAdmin>;
  }
  if (!lista.includes(area)) {
    const outra: Solucao = area === 'delivery' ? 'vendas' : 'delivery';
    return <Navigate to={lista.includes(outra) ? HOME_DA_SOLUCAO[outra] : '/solucoes'} replace />;
  }
  return area === 'vendas' ? <LayoutVendas>{children}</LayoutVendas> : <Layout>{children}</Layout>;
}

const ROTAS: [string, React.ReactNode][] = [
  ['/', <Dashboard />],
  ['/pedidos', <Pedidos />],
  ['/pedidos/:id', <PedidoDetalhe />],
  ['/mapa', <Mapa />],
  ['/clientes', <Clientes />],
  ['/credito', <SolicitacoesCredito />],
  ['/indicacoes', <Indicacoes />],
  ['/carteira', <Carteira />],
  ['/cartao-rede', <RedeCartao />],
  ['/produtos', <Produtos />],
  ['/categorias', <Categorias />],
  ['/marcas', <Marcas />],
  ['/promocoes', <Promocoes />],
  ['/patrocinadores', <Patrocinadores />],
  ['/banners', <Banners />],
  ['/notificacoes', <Notificacoes />],
  ['/configuracoes', <Configuracoes />],
];

const ROTAS_VENDAS: [string, React.ReactNode][] = [
  ['/vendas', <VendasInicio />],
  ['/vendas/vendedores', <VendasVendedores />],
  ['/vendas/pedidos', <VendasPedidos />],
  ['/vendas/pedidos/:id', <VendasPedidoDetalhe />],
  ['/vendas/orcamentos', <VendasOrcamentos />],
  ['/vendas/clientes', <VendasClientes />],
  ['/vendas/tabelas', <VendasTabelas />],
  ['/vendas/produtos', <VendasProdutos />],
];

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/indica/:codigo" element={<IndicaLanding />} />
        {/* Dossiê fora do Layout: página limpa pra imprimir / salvar PDF. */}
        <Route path="/pedidos/:id/dossie" element={sessao() ? <Dossie /> : <Navigate to="/login" replace />} />
        {ROTAS.map(([caminho, el]) => (
          <Route key={caminho} path={caminho} element={<Protegido>{el}</Protegido>} />
        ))}
        {ROTAS_VENDAS.map(([caminho, el]) => (
          <Route key={caminho} path={caminho} element={<Protegido area="vendas">{el}</Protegido>} />
        ))}
        <Route path="/admin/usuarios" element={<Protegido area="admin"><Usuarios /></Protegido>} />
        <Route path="/admin/integracao" element={<Protegido area="admin"><Logs /></Protegido>} />
        <Route path="/usuarios" element={<Navigate to="/admin/usuarios" replace />} />
        <Route path="/logs" element={<Navigate to="/admin/integracao" replace />} />
        <Route path="/solucoes" element={<Solucoes />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
