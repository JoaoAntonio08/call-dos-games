"""Ponte com o Discord: cartões (embeds), figurinhas e emojis próprios chegam aqui como no Discord."""

from __future__ import annotations

import pytest

import app.routes.discord as dc
import app.routes.messages as messages

GUILD = "900"
LINK = {"channel_id": 5, "discord_channel_id": "777", "created_by": 42}


@pytest.fixture
def bridge(monkeypatch):
    dc.ponte.guilds[GUILD] = {"name": "Turma", "channels": {"321": "jogos"}, "types": {"321": 0}, "roles": {}, "owner_id": "1"}
    posted: list[dict] = []
    downloads: list[str] = []

    async def post(channel_id, webhook_id, name, content, **kw):
        posted.append({"name": name, "content": content, **kw})
        return {}

    async def download(url, name, owner, extra_hosts=frozenset()):
        host = dc.urlparse(url).hostname
        if host not in dc.CDN_HOSTS and host not in extra_hosts:
            return None  # mesma regra do _download de verdade
        downloads.append(url)
        if "falha" in url:
            return None
        n = len(downloads)
        mime = "image/gif" if url.endswith(".gif") or ".gif?" in url else "image/png"
        return {"id": str(1000 + n), "url": f"https://api/files/{1000 + n}", "still": "", "name": name, "mime": mime}

    monkeypatch.setattr(messages, "post_webhook_message", post)
    monkeypatch.setattr(dc, "_download", download)
    yield posted, downloads
    dc.ponte.guilds.pop(GUILD, None)


def msg(**kw):
    base = {"guild_id": GUILD, "channel_id": "777", "author": {"id": "11", "username": "loritta", "bot": True}, "member": {}, "content": "", "mentions": []}
    return {**base, **kw}


@pytest.mark.asyncio
async def test_starboard_card_like_loritta(bridge):
    posted, downloads = bridge
    await dc._to_app(LINK, msg(
        content="⭐ 1 - <#321> | jogos",
        embeds=[{
            "color": 0xFFAC33,
            "author": {"name": "Zeca", "icon_url": "https://cdn.discordapp.com/avatars/1/a.png", "proxy_icon_url": "https://images-ext-1.discordapp.net/x/a.png"},
            "description": "olha esse clipe <@99> <:pepe:123456789012345678>",
            "fields": [{"name": "Mensagem original", "value": "[Pular](https://discord.com/channels/1/2/3)", "inline": True}],
            "image": {"url": "https://cdn.discordapp.com/attachments/1/2/clipe.png?ex=abc", "proxy_url": "https://media.discordapp.net/attachments/1/2/clipe.png?ex=abc", "width": 800, "height": 450},
            "footer": {"text": "<t:1700000000:R>"},
        }],
    ))
    assert len(posted) == 1
    p = posted[0]
    assert p["content"] == "⭐ 1 - #jogos | jogos", "menção de canal vira o nome"
    card = p["embeds"][0]
    assert card["color"] == "#ffac33"
    assert card["author"] == {"name": "Zeca", "icon": "https://images-ext-1.discordapp.net/x/a.png", "url": ""}
    assert card["description"] == "olha esse clipe @alguém <:pepe:123456789012345678>", "emoji próprio fica para o chat desenhar"
    assert card["fields"] == [{"name": "Mensagem original", "value": "[Pular](https://discord.com/channels/1/2/3)", "inline": True}]
    assert card["image"]["file_id"] == "1001" and card["image"]["width"] == 800, "a imagem fica guardada aqui (link do Discord vence)"
    assert downloads == ["https://cdn.discordapp.com/attachments/1/2/clipe.png?ex=abc"]
    assert card["footer"]["text"][:2].isdigit(), "<t:...> vira data"


@pytest.mark.asyncio
async def test_image_fallbacks_and_unknown_hosts(bridge):
    posted, _ = bridge
    await dc._to_app(LINK, msg(content="link", embeds=[
        {"title": "Vídeo", "url": "https://youtube.com/watch?v=x", "provider": {"name": "YouTube"},
         "thumbnail": {"url": "https://falha.cdn.discordapp.com/x.png", "proxy_url": "https://images-ext-2.discordapp.net/external/falha/x.png"}},
        {"title": "Site esquisito", "image": {"url": "https://evil.example/track.png", "proxy_url": "https://evil.example/track.png"}},
        {"url": "https://so-um-link.com"},  # cartão vazio
        {"description": "javascript", "url": "javascript:alert(1)"},
    ]))
    cards = posted[0]["embeds"]
    assert len(cards) == 3, "o cartão vazio some"
    yt, evil, js = cards
    assert yt["provider"] == "YouTube" and yt["thumbnail"] == {"url": "https://images-ext-2.discordapp.net/external/falha/x.png", "width": None, "height": None}
    assert evil["image"] is None, "imagem de fora do Discord não entra"
    assert js["url"] == "", "link que não é http(s) é jogado fora"


@pytest.mark.asyncio
async def test_stickers_become_images_and_lottie_stays_text(bridge):
    posted, downloads = bridge
    await dc._to_app(LINK, msg(sticker_items=[{"id": "555", "name": "joinha", "format_type": 4}, {"id": "556", "name": "dança", "format_type": 3}]))
    p = posted[0]
    assert [a["name"] for a in p["attachments"]] == ["joinha.gif"]
    assert downloads == ["https://media.discordapp.net/stickers/555.gif?size=320"]
    assert p["content"] == "[figurinha: dança]"


@pytest.mark.asyncio
async def test_message_with_only_a_card_still_arrives(bridge):
    posted, _ = bridge
    await dc._to_app(LINK, msg(embeds=[{"title": "Evento hoje", "description": "21h"}]))
    assert posted and posted[0]["content"] == "" and posted[0]["embeds"][0]["title"] == "Evento hoje"
    await dc._to_app(LINK, msg(embeds=[{"url": "https://nada.com"}]))
    assert len(posted) == 1, "nada para mostrar: não manda mensagem vazia"
