import type { Metadata } from 'next';
import { Raleway } from 'next/font/google';
import './globals.css';

// Raleway, a tipografia do Manual de Marca (p. 33). O next/font baixa no build e serve do próprio site.
const raleway = Raleway({
  subsets: ['latin'],
  weight: ['400', '600', '700', '800'],
  display: 'swap',
  variable: '--font-marca',
});

export const metadata: Metadata = {
  title: 'Painel de Vendas · Brinde do Bem',
  description: 'Dashboard de marketplaces, ERP e CRM',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={raleway.variable} suppressHydrationWarning>
      <head>
        {/* Aplica a escolha de tema salva antes de desenhar a página, para não piscar. Sem escolha, vale o sistema. */}
        <script
          dangerouslySetInnerHTML={{
            __html: "try{var t=localStorage.getItem('bdb-tema');if(t==='claro'||t==='escuro'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}",
          }}
        />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
