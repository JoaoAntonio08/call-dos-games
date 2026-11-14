import { Suspense } from "react";
import { ResetForm } from "@/components/auth/auth";

export default function Page() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
