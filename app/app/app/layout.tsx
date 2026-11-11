
import "./globals.css";

export const metadata = {
  title: "Andijon 3D City",
  description: "Andijon 3D shahar xaritasi",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="uz">
      <body>{children}</body>
    </html>
  );
}
