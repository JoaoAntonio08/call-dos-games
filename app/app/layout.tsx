import type { Metadata } from "next";
import { Suspense } from "react";
import { AppRoot } from "@/components/app/app-root";

export const metadata: Metadata = { title: "Call dos Games" };

/* O app inteiro vive no layout: a call de voz continua conectada enquanto você troca de canal. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense>
        <AppRoot />
      </Suspense>
      <div hidden>{children}</div>
    </>
  );
}
