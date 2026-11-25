import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AgentMRI',
  description: 'AI 에이전트 실행 품질과 평가 신뢰도를 감사하는 메타-평가 도구'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
