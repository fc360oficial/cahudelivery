import { LayoutDelivery } from './LayoutAreas';

/** Casca da área Delivery: mesma estrutura das demais áreas (ver LayoutAreas.tsx). */
export function Layout({ children }: { children: React.ReactNode }) {
  return <LayoutDelivery>{children}</LayoutDelivery>;
}
