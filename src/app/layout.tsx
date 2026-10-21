import type { ReactNode } from "react";

export const metadata = { title: "ParcelGuard" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: "48px 24px", maxWidth: 720, marginInline: "auto", lineHeight: 1.6 }}>
        {children}
      </body>
    </html>
  );
}
