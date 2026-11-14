import { Suspense } from "react";
import { InvitePage } from "@/components/invite-page";

export default function Page() {
  return (
    <Suspense>
      <InvitePage />
    </Suspense>
  );
}
