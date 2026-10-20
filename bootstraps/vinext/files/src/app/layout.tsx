import type { ReactNode } from "react";

export const metadata = { title: "__PROJECT_NAME__", description: "A Kitbash vinext project" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
