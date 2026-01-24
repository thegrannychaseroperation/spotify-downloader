import "./globals.css";

export const metadata = {
  title: "Striker",
  description: "Match your library and export lossless downloads.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
