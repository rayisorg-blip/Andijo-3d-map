import './globals.css';
export const metadata = { title: 'ANDIJON 3D CITY', description: 'Your city. Your home. Your virtual world.' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
