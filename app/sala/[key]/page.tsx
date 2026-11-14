import { Suspense } from "react";
import { notFound } from "next/navigation";
import { RoomClient } from "@/components/room/room-client";
import { normalizeKey } from "@/lib/room-key";

async function Room({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const clean = normalizeKey(decodeURIComponent(key));
  if (clean.length < 3) notFound();
  return <RoomClient roomKey={clean} />;
}

export default function SalaPage(props: PageProps<"/sala/[key]">) {
  return (
    <Suspense fallback={<main className="min-h-svh flex-1 bg-[#0b0a10]" />}>
      <Room params={props.params} />
    </Suspense>
  );
}
