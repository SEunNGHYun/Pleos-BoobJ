import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
 title: '밥맞J | 식당 관리',
 description: '차량 도착 시간에 맞춰 준비하는 밥맞J 식당 관리',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
 return <html lang="ko"><body>{children}</body></html>;
}
