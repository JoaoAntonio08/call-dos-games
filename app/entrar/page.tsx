import { Suspense } from "react";
import { LoginForm } from "@/components/auth/auth";

export default function Page() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
