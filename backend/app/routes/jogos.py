"""Bot de jogos: /jogo <nome> procura na loja da Steam e /gratis mostra os jogos grátis para resgatar na Steam.

Com um canal de avisos escolhido no módulo, o bot posta sozinho cada jogo grátis novo (confere a cada 30 min).
Fontes públicas, sem chave: a loja da Steam (store.steampowered.com/api) e o GamerPower (gamerpower.com/api),
que junta as promoções de "pegue e fique com ele" da Steam.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import time
from datetime import datetime
from typing import Any

import httpx

from ..core import pool

STEAM_STORE = os.environ.get("STEAM_STORE_BASE", "https://store.steampowered.com").rstrip("/")
GAMERPOWER = os.environ.get("GAMERPOWER_BASE", "https://www.gamerpower.com").rstrip("/")
CHECK_EVERY = int(os.environ.get("FREE_GAMES_CHECK_SECONDS", "1800"))
UA = {"User-Agent": "CallDosGames/1.0 (bot de jogos)"}

_free_cache: tuple[float, list[dict]] | None = None


def _brl(cents: int) -> str:
    return f"R$ {cents / 100:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


async def _get(url: str, params: dict[str, str]) -> Any:
    async with httpx.AsyncClient(timeout=8, headers=UA) as c:
        r = await c.get(url, params=params)
    if r.status_code != 200:
        return None
    return r.json()


# ------------------------------------------------------------------ /jogo
async def game_search(q: str) -> str:
    q = q.strip()[:80]
    if not q:
        return "🎮 Use assim: /jogo nome do jogo"
    try:
        found = await _get(STEAM_STORE + "/api/storesearch/", {"term": q, "l": "portuguese", "cc": "BR"})
    except Exception:
        found = None
    if found is None:
        return "🎮 A loja da Steam não respondeu agora. Tente de novo daqui a pouco."
    items = [i for i in (found.get("items") or []) if i.get("type") == "app"][:3]
    if not items:
        return f"🎮 Não achei nenhum jogo chamado “{q}” na Steam."
    first = items[0]
    lines = [f"🎮 **{first['name']}**"]
    try:
        det = await _get(STEAM_STORE + "/api/appdetails", {"appids": str(first["id"]), "cc": "BR", "l": "portuguese"})
        data = ((det or {}).get(str(first["id"])) or {}).get("data") or {}
    except Exception:
        data = {}
    if data.get("short_description"):
        lines.append(re.sub(r"<[^>]+>", "", str(data["short_description"]))[:280])
    info = []
    if data.get("is_free"):
        info.append("Grátis para jogar")
    elif (po := data.get("price_overview")) and po.get("final_formatted"):
        info.append(po["final_formatted"] + (f" (−{po['discount_percent']}%)" if po.get("discount_percent") else ""))
    elif (pr := first.get("price")) and pr.get("final") is not None:
        info.append(_brl(int(pr["final"])) + (f" (era {_brl(int(pr['initial']))})" if pr.get("initial", 0) > pr["final"] else ""))
    if genres := ", ".join(g.get("description", "") for g in (data.get("genres") or [])[:3] if g.get("description")):
        info.append(genres)
    if (rd := (data.get("release_date") or {}).get("date")):
        info.append(f"lançamento {rd}")
    if first.get("metascore"):
        info.append(f"Metacritic {first['metascore']}")
    if info:
        lines.append(" · ".join(info))
    lines.append(f"https://store.steampowered.com/app/{first['id']}/")
    if len(items) > 1:
        others = []
        for i in items[1:]:
            pr = i.get("price") or {}
            others.append(f"{i['name']}" + (f" ({_brl(int(pr['final']))})" if pr.get("final") is not None else ""))
        lines.append("Também achei: " + " · ".join(others))
    return "\n".join(lines)


# ------------------------------------------------------------------ /gratis
def _clean_title(t: str) -> str:
    t = re.sub(r"\s*\((Steam|PC)\)\s*", " ", t, flags=re.I)
    t = re.sub(r"\s*(Giveaway|Free)$", "", t.strip(), flags=re.I)
    return t.strip()


async def free_games(force: bool = False) -> list[dict]:
    """Jogos que estão de graça para resgatar (e ficar) na Steam agora. Cache de 10 min."""
    global _free_cache
    if not force and _free_cache and time.monotonic() - _free_cache[0] < 600:
        return _free_cache[1]
    data = await _get(GAMERPOWER + "/api/giveaways", {"platform": "steam", "type": "game", "sort-by": "date"})
    if not isinstance(data, list):
        return _free_cache[1] if _free_cache else []
    out = []
    for g in data[:20]:
        if str(g.get("status", "Active")).lower() != "active":
            continue
        end = None
        try:
            if g.get("end_date") and g["end_date"] != "N/A":
                end = datetime.strptime(g["end_date"], "%Y-%m-%d %H:%M:%S")
        except ValueError:
            end = None
        out.append(
            {
                "id": str(g.get("id")),
                "title": _clean_title(str(g.get("title", "")))[:120],
                "worth": "" if str(g.get("worth", "N/A")) == "N/A" else str(g["worth"]),
                "until": end.strftime("%d/%m") if end else "",
                "url": str(g.get("open_giveaway_url") or g.get("gamerpower_url") or ""),
            }
        )
    _free_cache = (time.monotonic(), out)
    return out


def _free_line(g: dict) -> str:
    extra = [x for x in (f"valia {g['worth']}" if g["worth"] else "", f"até {g['until']}" if g["until"] else "") if x]
    return f"• **{g['title']}**" + (f" ({', '.join(extra)})" if extra else "") + (f"\n  {g['url']}" if g["url"] else "")


async def free_games_text() -> str:
    try:
        games = await free_games()
    except Exception:
        return "🎁 Não consegui ver as promoções agora. Tente de novo daqui a pouco."
    if not games:
        return "🎁 Nenhum jogo grátis para resgatar na Steam agora. Volte mais tarde (ou ligue os avisos no bot de jogos)."
    return "🎁 **Grátis na Steam agora** (resgate e o jogo fica seu):\n" + "\n".join(_free_line(g) for g in games[:8])


# ------------------------------------------------------------------ avisos automáticos
async def free_games_loop() -> None:
    from .messages import post_webhook_message

    await asyncio.sleep(20)
    while True:
        try:
            rows = await pool().fetch("SELECT id, server_id, name, modules FROM server_bots WHERE modules ? 'jogos'")
            targets = []
            for r in rows:
                mods = json.loads(r["modules"]) if isinstance(r["modules"], str) else dict(r["modules"])
                cfg = mods.get("jogos") or {}
                if cfg.get("enabled") and cfg.get("aviso"):
                    targets.append((r, int(cfg["aviso"])))
            if targets:
                games = await free_games(force=True)
                for r, cid in targets:
                    if not await pool().fetchval("SELECT 1 FROM channels WHERE id = $1 AND server_id = $2", cid, r["server_id"]):
                        continue
                    seen = {x["giveaway"] for x in await pool().fetch("SELECT giveaway FROM free_games_seen WHERE server_id = $1", r["server_id"])}
                    new = [g for g in games if g["id"] not in seen][:5]
                    for g in new:
                        await pool().execute(
                            "INSERT INTO free_games_seen (server_id, giveaway) VALUES ($1, $2) ON CONFLICT DO NOTHING", r["server_id"], g["id"]
                        )
                        await post_webhook_message(cid, r["id"], r["name"], "🎁 **Jogo grátis na Steam!** Resgate e ele fica seu.\n" + _free_line(g))
        except asyncio.CancelledError:
            raise
        except Exception:
            pass
        await asyncio.sleep(CHECK_EVERY)
