import { Suspense } from "react";
import { ForgotForm } from "@/components/auth/auth";

export default function Page() {
  return (
    <Suspense>
      <ForgotForm />
    </Suspense>
  );
}
