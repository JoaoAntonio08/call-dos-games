import { Suspense } from "react";
import { RegisterForm } from "@/components/auth/auth";

export default function Page() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
