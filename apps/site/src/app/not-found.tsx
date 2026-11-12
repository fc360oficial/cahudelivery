import Link from 'next/link';
import estilos from './estados.module.css';

export default function NaoEncontrado() {
  return (
    <div className={`conteudo ${estilos.estado}`}>
      <h1>Página não encontrada</h1>
      <p>O endereço pode ter mudado ou o produto saiu do catálogo. Use a busca no topo ou escolha uma categoria.</p>
      <div className={estilos.acoes}><Link href="/" className={estilos.botao}>Ir para o início</Link></div>
    </div>
  );
}
