import { AccessToken } from "livekit-server-sdk";
import { roomNameFromKey } from "@/lib/room-key";
import { guestTokenRateLimited } from "@/lib/guest-token-rate-limit";

function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function POST(request: Request) {
  if (guestTokenRateLimited(clientIp(request))) {
    return Response.json({ error: "Muitas tentativas. Espere um minuto." }, { status: 429, headers: { "Cache-Control": "no-store" } });
  }
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.LIVEKIT_URL;

  if (!apiKey || !apiSecret || !url) {
    return Response.json(
      {
        error:
          "Servidor sem configuração do LiveKit. Cadastre LIVEKIT_URL, LIVEKIT_API_KEY e LIVEKIT_API_SECRET no .env.local do site (ou nas variáveis de ambiente da Vercel).",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  let body: { key?: unknown; name?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Pedido inválido." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const key = typeof body.key === "string" ? body.key : "";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 32) : "";
  const room = roomNameFromKey(key);

  if (!room) return Response.json({ error: "Chave da sala inválida ou curta demais." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  if (!name) return Response.json({ error: "Digite um nome." }, { status: 400, headers: { "Cache-Control": "no-store" } });

  // identidade única, assim duas pessoas com o mesmo nome não se derrubam
  const identity = `${name}#${crypto.randomUUID()}`;

  const token = new AccessToken(apiKey, apiSecret, {
    identity,
    name,
    ttl: "10m",
  });
  token.addGrant({
    roomJoin: true,
    room,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return Response.json({ token: await token.toJwt(), url, identity }, { headers: { "Cache-Control": "no-store" } });
}
