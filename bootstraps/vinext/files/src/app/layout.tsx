import type { ReactNode } from "react";

export const metadata = { title: "__PROJECT_NAME__", description: "A w3bstack vinext project" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
