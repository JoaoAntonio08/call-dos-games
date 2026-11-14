import { AccessToken } from "livekit-server-sdk";
import { roomNameFromKey } from "@/lib/room-key";

export async function POST(request: Request) {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.LIVEKIT_URL;

  if (!apiKey || !apiSecret || !url) {
    return Response.json(
      {
        error:
          "Servidor sem configuração do LiveKit. Cadastre LIVEKIT_URL, LIVEKIT_API_KEY e LIVEKIT_API_SECRET nas variáveis de ambiente da Vercel (ou no .env.local, rodando no PC).",
      },
      { status: 500 },
    );
  }

  let body: { key?: unknown; name?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const key = typeof body.key === "string" ? body.key : "";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 32) : "";
  const room = roomNameFromKey(key);

  if (!room) return Response.json({ error: "Chave da sala inválida." }, { status: 400 });
  if (!name) return Response.json({ error: "Digite um nome." }, { status: 400 });

  // identidade única, assim duas pessoas com o mesmo nome não se derrubam
  const identity = `${name}#${crypto.randomUUID().slice(0, 6)}`;

  const token = new AccessToken(apiKey, apiSecret, {
    identity,
    name,
    ttl: "12h",
  });
  token.addGrant({
    roomJoin: true,
    room,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return Response.json({ token: await token.toJwt(), url, identity });
}
