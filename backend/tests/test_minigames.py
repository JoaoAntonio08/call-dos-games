"""Minigames, clipe de risada, recados e secretas: o segredo fica no servidor e só quem está na call joga."""

from __future__ import annotations

import json

import pytest
from fastapi import HTTPException

from app import conquistas as cq
from app import minigames as mg
from app import palavras
from app.core import Auth
from app.realtime import Hub


@pytest.fixture()
def call(monkeypatch):
    """Uma call (canal 9) com 1, 2, 3 e 4 dentro; o 99 está fora."""
    h = Hub()
    for uid in (1, 2, 3, 4):
        h.voice.setdefault(9, {})[uid] = {"stream": False, "laugh": True}
        h.user_voice[uid] = 9
    sent: list[tuple[int, str, dict]] = []

    async def send(user_ids, event, data):
        for u in set(user_ids):
            sent.append((u, event, data))

    async def no_server(_cid):
        return None

    async def no_mod(_cid, _uid):
        return False

    async def is_open(_cid):
        return True

    h.send = send
    monkeypatch.setattr(mg, "hub", h)
    monkeypatch.setattr(mg, "server_of", no_server)
    monkeypatch.setattr(mg, "can_moderate", no_mod)
    monkeypatch.setattr(mg, "channel_open", is_open)
    monkeypatch.setattr(mg, "games", {})
    monkeypatch.setattr(mg, "_last_act", {})
    monkeypatch.setattr(mg, "_laughs", {})
    monkeypatch.setattr(mg, "_last_laugh_clip", {})
    monkeypatch.setattr(mg, "_last_report", {})
    return h, sent


def views_of(sent, uid):
    return [d["game"] for u, e, d in sent if u == uid and e == "minigame"]


# ------------------------------------------------------------------ listas
def test_word_lists_are_sane():
    assert len(palavras.QUINA) > 300
    assert all(len(w) == 5 and w.isascii() and w.isalpha() for w in palavras.QUINA)
    for t in palavras.TEMAS.values():
        assert len(t["palavras"]) >= 20 and len(set(t["palavras"])) == len(t["palavras"])


def test_quina_marks_handle_repeated_letters():
    assert mg.marks("arara", "praia") == [0, 2, 2, 0, 2], "os 'a' do segredo já foram usados nos lugares certos"
    assert mg.marks("aerea", "praia") == [1, 0, 1, 0, 2]
    assert mg.marks("carro", "carro") == [2, 2, 2, 2, 2]
    assert mg.marks("ossos", "sorte") == [1, 1, 0, 0, 0]


def test_song_answers():
    keys = mg.song_keys("Legião Urbana - Tempo Perdido (Official Video)", "Legião Urbana")
    assert mg.song_matches("tempo perdido", keys)
    assert mg.song_matches("Tempo perdid", keys)
    assert not mg.song_matches("legiao urbana", keys), "o artista sozinho não vale"
    assert not mg.song_matches("a", keys)
    assert mg.song_matches("bohemian rhapsody", mg.song_keys("Queen – Bohemian Rhapsody [Remastered 2011]", "Queen Official"))


# ------------------------------------------------------------------ quem pode jogar
@pytest.mark.asyncio
async def test_outside_the_call_cannot_start_or_play(call):
    with pytest.raises(HTTPException) as e:
        await mg.start_game("9", mg.StartIn(kind="forca"), Auth(99, 1))
    assert e.value.status_code == 403
    await mg.start_game("9", mg.StartIn(kind="forca"), Auth(1, 1))
    with pytest.raises(HTTPException):
        await mg.act_game("9", mg.ActIn(action="letra", text="a"), Auth(99, 1))
    with pytest.raises(HTTPException):
        await mg.get_game("9", Auth(99, 1))


@pytest.mark.asyncio
async def test_only_host_ends_or_replaces_the_game(call):
    await mg.start_game("9", mg.StartIn(kind="quina"), Auth(1, 1))
    with pytest.raises(HTTPException) as e:
        await mg.end_game("9", Auth(2, 1))
    assert e.value.status_code == 403
    with pytest.raises(HTTPException) as e:
        await mg.start_game("9", mg.StartIn(kind="forca"), Auth(2, 1))
    assert e.value.status_code == 409
    await mg.end_game("9", Auth(1, 1))
    assert 9 not in mg.games


# ------------------------------------------------------------------ Impostor
@pytest.mark.asyncio
async def test_impostor_secret_only_reaches_the_right_people(call):
    _, sent = call
    await mg.start_game("9", mg.StartIn(kind="impostor", theme="lugares"), Auth(1, 1))
    g = mg.games[9]
    (imp,) = g.impostors
    for uid in (1, 2, 3, 4):
        v = views_of(sent, uid)[-1]
        blob = json.dumps(v, ensure_ascii=False)
        assert "impostors" not in v, "ninguém recebe a lista de impostores durante o jogo"
        if uid == imp:
            assert v["card"] == {"impostor": True} and g.word not in blob
        else:
            assert v["card"] == {"word": g.word}


@pytest.mark.asyncio
async def test_impostor_votes_validated_and_caught_impostor_can_steal(call):
    await mg.start_game("9", mg.StartIn(kind="impostor", theme="comidas"), Auth(1, 1))
    g = mg.games[9]
    (imp,) = g.impostors
    crew = [p for p in (1, 2, 3, 4) if p != imp]
    await mg.act_game("9", mg.ActIn(action="votacao"), Auth(crew[0], 1))
    with pytest.raises(HTTPException):
        await mg.act_game("9", mg.ActIn(action="voto", target=str(crew[0])), Auth(crew[0], 1))  # em si mesmo
    with pytest.raises(HTTPException):
        await mg.act_game("9", mg.ActIn(action="voto", target="12345"), Auth(crew[0], 1))  # fora do jogo
    for p in (1, 2, 3, 4):
        await mg.act_game("9", mg.ActIn(action="voto", target=str(imp if p != imp else crew[0])), Auth(p, 1))
    assert g.phase == "guess" and g.guesser == imp
    with pytest.raises(HTTPException):
        await mg.act_game("9", mg.ActIn(action="chute", text=g.word), Auth(crew[1], 1))  # só o impostor chuta
    await mg.act_game("9", mg.ActIn(action="chute", text=g.word.upper()), Auth(imp, 1))
    assert g.phase == "end" and g.winner == "impostor"


@pytest.mark.asyncio
async def test_impostor_needs_three_people(call):
    h, _ = call
    for uid in (3, 4):
        h.voice[9].pop(uid)
        h.user_voice.pop(uid)
    with pytest.raises(HTTPException):
        await mg.start_game("9", mg.StartIn(kind="impostor"), Auth(1, 1))


# ------------------------------------------------------------------ Forca e Quina
@pytest.mark.asyncio
async def test_forca_never_sends_the_word_while_playing(call):
    _, sent = call
    await mg.start_game("9", mg.StartIn(kind="forca", theme="animais"), Auth(1, 1))
    g = mg.games[9]
    v = views_of(sent, 2)[-1]
    assert "_" in v["mask"] and v["mask"] != g.secret
    assert len(v["mask"]) == len(g.secret)
    with pytest.raises(HTTPException):
        await mg.act_game("9", mg.ActIn(action="letra", text="ab"), Auth(2, 1))
    mg._last_act.clear()
    await mg.act_game("9", mg.ActIn(action="palavra", text="nao e isso"), Auth(2, 1))
    assert g.lives == 4
    mg._last_act.clear()
    await mg.act_game("9", mg.ActIn(action="palavra", text=palavras.plain(g.secret)), Auth(3, 1))
    assert g.phase == "end" and g.solved and views_of(sent, 2)[-1]["mask"] == g.secret


@pytest.mark.asyncio
async def test_quina_hides_word_and_checks_guesses(call):
    _, sent = call
    await mg.start_game("9", mg.StartIn(kind="quina"), Auth(1, 1))
    g = mg.games[9]
    assert views_of(sent, 2)[-1]["word"] is None
    with pytest.raises(HTTPException):
        await mg.act_game("9", mg.ActIn(action="chute", text="abc"), Auth(2, 1))
    mg._last_act.clear()
    await mg.act_game("9", mg.ActIn(action="chute", text=g.secret), Auth(2, 1))
    assert g.phase == "end" and g.streak == 1 and views_of(sent, 2)[-1]["word"] == g.secret
    g.cancel_timer()


# ------------------------------------------------------------------ Onde foi isso?
def _commons(url="https://upload.wikimedia.org/x.jpg", mime="image/jpeg", date="2014-05-01 10:00", title="File:Rua.jpg"):
    return {
        "query": {
            "pages": {
                "1": {
                    "title": title,
                    "coordinates": [{"lat": -22.9, "lon": -43.2}],
                    "imageinfo": [
                        {"thumburl": url, "mime": mime, "width": 1280, "descriptionurl": "https://commons.wikimedia.org/wiki/File:Rua.jpg",
                         "extmetadata": {"DateTimeOriginal": {"value": date}, "Artist": {"value": "<a href='x'>Fulano</a>"}, "LicenseShortName": {"value": "CC BY-SA 4.0"}}}
                    ],
                }
            }
        }
    }


def test_photo_only_from_wikimedia_uploads_and_with_year_when_needed():
    p = mg.pick_photo(_commons(), True, set())
    assert p and p["year"] == 2014 and p["artist"] == "Fulano"
    assert mg.pick_photo(_commons(url="https://evil.example/x.jpg"), False, set()) is None
    assert mg.pick_photo(_commons(url="http://upload.wikimedia.org/x.jpg"), False, set()) is None
    assert mg.pick_photo(_commons(mime="image/svg+xml"), False, set()) is None
    assert mg.pick_photo(_commons(date="sem data"), True, set()) is None
    assert mg.pick_photo(_commons(date="sem data"), False, set()) is not None
    assert mg.pick_photo(_commons(title="File:Mapa do Rio.jpg"), False, set()) is None


def test_photo_from_the_new_commons_thumbnail_host():
    # desde 2026 o Commons entrega as miniaturas por thumb.wikimedia.org, com utm_* no fim
    url = "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/14/Rua.JPG/1280px-Rua.JPG?utm_source=commons.wikimedia.org&utm_content=thumbnail"
    p = mg.pick_photo(_commons(url=url), False, set())
    # baixa pelo upload.wikimedia.org (mesmo arquivo): o servidor não precisa liberar um endereço novo
    assert p and p["url"] == "https://upload.wikimedia.org/wikipedia/commons/thumb/1/14/Rua.JPG/1280px-Rua.JPG"
    assert mg.pick_photo(_commons(url="https://thumb.wikimedia.org.evil.example/x.jpg"), False, set()) is None


def test_points():
    assert mg.place_points(0) == 5000 and mg.place_points(20000) < 50
    assert mg.year_points(0) == 5000 and mg.year_points(40) < 50
    assert round(mg.distance_km((-22.9, -43.2), (-23.55, -46.63))) in range(340, 370)


@pytest.mark.asyncio
async def test_mundo_hides_answer_and_photo_needs_token(call):
    _, sent = call
    g = mg.Mundo(9, 1, [1, 2], None)
    g.setup({"rounds": 3, "mode": "quando"})
    g.photos = [{"lat": 1.0, "lon": 2.0, "year": 2000, "artist": "a", "license": "l", "page": "p", "title": "t", "url": "u"}] * 3
    g.images = [(b"jpg", "image/jpeg")] * 3
    g.rounds = 3
    mg.games[9] = g
    await g.next_round()
    await mg.push(g)
    v = views_of(sent, 2)[-1]
    assert "answer" not in v and "lat" not in json.dumps(v)
    with pytest.raises(HTTPException):
        await mg.game_photo("9", "token-errado", 1, Auth(2, 1))
    with pytest.raises(HTTPException):
        await mg.game_photo("9", g.token, 2, Auth(2, 1))  # rodada que ainda não chegou
    with pytest.raises(HTTPException):
        await mg.game_photo("9", g.token, 1, Auth(99, 1))  # fora da call
    assert (await mg.game_photo("9", g.token, 1, Auth(2, 1))).body == b"jpg"
    with pytest.raises(HTTPException):
        await mg.act_game("9", mg.ActIn(action="chute", lat=91, lon=0, year=2000), Auth(2, 1))
    g.cancel_timer()


# ------------------------------------------------------------------ clipe de risada
@pytest.mark.asyncio
async def test_laugh_clip_needs_two_different_people_and_picks_one_app(call):
    _, sent = call
    r = await mg.laugh(mg.LaughIn(channel_id="9", can_clip=True), Auth(2, 1))
    r = await mg.laugh(mg.LaughIn(channel_id="9", can_clip=True), Auth(2, 1))  # a mesma pessoa de novo não conta
    assert not r.get("clip") and not [s for s in sent if s[1] == "risada_clip"]
    r = await mg.laugh(mg.LaughIn(channel_id="9", can_clip=True), Auth(3, 1))
    assert r["clip"] is True
    clips = [s for s in sent if s[1] == "risada_clip"]
    assert len(clips) == 1 and clips[0][0] == 2, "um app só salva o clipe"
    # logo em seguida não clipa de novo
    mg._last_report.clear()
    await mg.laugh(mg.LaughIn(channel_id="9", can_clip=True), Auth(1, 1))
    await mg.laugh(mg.LaughIn(channel_id="9", can_clip=True), Auth(4, 1))
    assert len([s for s in sent if s[1] == "risada_clip"]) == 1
    with pytest.raises(HTTPException):
        await mg.laugh(mg.LaughIn(channel_id="9"), Auth(99, 1))


@pytest.mark.asyncio
async def test_laugh_clip_needs_everyone_in_the_call_to_agree(call):
    h, sent = call
    h.voice[9][4]["laugh"] = False  # uma pessoa não aceitou: ninguém clipa
    await mg.laugh(mg.LaughIn(channel_id="9", can_clip=True), Auth(2, 1))
    r = await mg.laugh(mg.LaughIn(channel_id="9", can_clip=True), Auth(3, 1))
    assert r.get("off") and not [s for s in sent if s[1] in ("risada", "risada_clip")]


@pytest.mark.asyncio
async def test_laugh_clip_is_off_with_someone_from_the_discord_bridge(call, monkeypatch):
    from app.routes import discord as dc

    h, sent = call
    # quem está na call pelo Discord não tem como aceitar o clipe
    monkeypatch.setattr(dc, "discord_voice_snapshot", lambda ids: {"9": [{"id": "x"}]})
    await mg.laugh(mg.LaughIn(channel_id="9", can_clip=True), Auth(2, 1))
    r = await mg.laugh(mg.LaughIn(channel_id="9", can_clip=True), Auth(3, 1))
    assert r.get("off") and not [s for s in sent if s[1] in ("risada", "risada_clip")]


@pytest.mark.asyncio
async def test_reward_counts_once_per_phase(call, monkeypatch):
    got: list[tuple[str, int | None, int]] = []

    async def fake_reward(kind, server_id, uid, n=1):
        got.append((kind, server_id, uid))

    monkeypatch.setattr(mg, "_reward", fake_reward)
    g = mg.Forca(9, 1, [1, 2], 77)
    await g.give("win", 2)
    await g.give("win", 2)  # o fim da rodada rodou de novo
    assert got == [("win", 77, 2)]
    g.public = False  # call privada: conta a secreta, mas não a retrospectiva do servidor
    g.stage += 1
    await g.give("win", 2)
    assert got[-1] == ("win", None, 2)


@pytest.mark.asyncio
async def test_replacing_a_game_cancels_its_preparation(call):
    import asyncio

    g = mg.Mundo(9, 1, [1, 2], None)
    g.setup({})
    g.images = [(b"x", "image/jpeg")]
    g.prep = asyncio.create_task(asyncio.sleep(60))
    g.retire()
    await asyncio.sleep(0)
    assert g.prep is None and g.images == []


# ------------------------------------------------------------------ secretas
def test_night_owl_and_marathon_need_company():
    three_am_brt = 1_700_000_000 - (1_700_000_000 % 86400) + 6 * 3600  # 06:00 UTC = 03:00 Brasília
    alone = {1: {7: {"since": 0}}}
    assert cq.night_and_marathon(alone, three_am_brt) == []
    together = {1: {7: {"since": three_am_brt * 1000}, 8: {"since": (three_am_brt - 7 * 3600) * 1000}}}
    got = cq.night_and_marathon(together, three_am_brt)
    assert (7, "coruja") in got and (8, "coruja") in got and (8, "maratona") in got and (7, "maratona") not in got


def test_secret_rewards_are_real_rewards():
    for reward, _, _ in cq.SECRETS.values():
        assert reward in cq.REWARDS
    assert cq.clean_flair({"plate": "coruja"}, []) == {}
    assert cq.clean_flair({"plate": "coruja"}, ["plate:coruja"]) == {"plate": "coruja"}


def test_strip_jpeg_meta_drops_exif_and_keeps_image():
    from app.minigames import strip_jpeg_meta

    def seg(marker: int, body: bytes) -> bytes:
        return bytes([0xFF, marker]) + (len(body) + 2).to_bytes(2, "big") + body

    jfif = seg(0xE0, b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00")
    exif = seg(0xE1, b"Exif\x00\x00GPS-AQUI")
    com = seg(0xFE, b"tirada em Paris")
    dqt = seg(0xDB, b"\x00" + bytes(64))
    scan = b"\xff\xda\x00\x08\x01\x01\x00\x00?\x00" + b"\x124" + b"\xff\xd9"
    raw = b"\xff\xd8" + jfif + exif + com + dqt + scan
    clean = strip_jpeg_meta(raw)
    assert clean == b"\xff\xd8" + jfif + dqt + scan
    assert b"GPS-AQUI" not in clean and b"Paris" not in clean
    assert strip_jpeg_meta(b"GIF89a") is None
    assert strip_jpeg_meta(b"\xff\xd8\xff\xe1\xff\xff") is None


@pytest.mark.asyncio
async def test_call_turned_private_mid_game_stops_counting_for_the_server(call, monkeypatch):
    got: list[tuple[str, int | None, int]] = []

    async def fake_reward(kind, server_id, uid, n=1):
        got.append((kind, server_id, uid))

    still_open = {"v": True}

    async def is_open(_cid):
        return still_open["v"]

    monkeypatch.setattr(mg, "_reward", fake_reward)
    monkeypatch.setattr(mg, "channel_open", is_open)
    g = mg.Forca(9, 1, [1, 2], 77)
    await g.give("win", 2)
    still_open["v"] = False  # um admin pôs cargo na visão da call durante a partida
    g.stage += 1
    await g.give("win", 2)
    assert got == [("win", 77, 2), ("win", None, 2)]


@pytest.mark.asyncio
async def test_photo_game_limit_holds_when_many_start_at_once(call, monkeypatch):
    import asyncio

    h, _ = call
    for i in range(mg.MAX_PHOTO_GAMES + 3):
        cid = 100 + i
        for uid in (1000 + 2 * i, 1001 + 2 * i):
            h.voice.setdefault(cid, {})[uid] = {"stream": False}
            h.user_voice[uid] = cid

    async def slow_server(_cid):
        await asyncio.sleep(0.01)  # o banco demora: sem trava, todo mundo passaria pela conferência
        return None

    async def no_prepare(_g):
        return None

    monkeypatch.setattr(mg, "server_of", slow_server)
    monkeypatch.setattr(mg, "_prepare", no_prepare)
    starts = [
        mg.start_game(str(100 + i), mg.StartIn(kind="mundo"), Auth(1000 + 2 * i, 1))
        for i in range(mg.MAX_PHOTO_GAMES + 3)
    ]
    res = await asyncio.gather(*starts, return_exceptions=True)
    refused = [r for r in res if isinstance(r, HTTPException) and r.status_code == 503]
    assert sum(isinstance(x, mg.Mundo) for x in mg.games.values()) == mg.MAX_PHOTO_GAMES
    assert len(refused) == 3


def test_changing_channel_permissions_forgets_the_cache(monkeypatch):
    monkeypatch.setattr(cq, "_server_of_channel", {9: (77, True, 0.0), 10: (77, True, 0.0), 11: (88, True, 0.0)})
    cq.forget_channels(cid=9)
    assert set(cq._server_of_channel) == {10, 11}
    cq.forget_channels(server_id=77)
    assert set(cq._server_of_channel) == {11}


# ------------------------------------------------------------------ escolha das músicas
def test_same_song_from_different_uploads_counts_once():
    songs = [
        ("aaaaaaaaaaa", "Eagles - Hotel California (Official Audio)", "Eagles"),
        ("bbbbbbbbbbb", "Hotel California - Eagles (Live 1977)", "EaglesVEVO"),
        ("ccccccccccc", "Creedence Clearwater Revival - Have You Ever Seen The Rain", "CCR"),
    ]
    got = mg.pick_songs(songs, 3, [])
    assert len(got) == 2
    assert {mg.song_id(t, a) for _, t, a in got} == {"eagles|hotel california", "creedence clearwater revival|have you ever seen the rain"}


def test_recent_songs_wait_their_turn():
    songs = [(f"vid{i:08d}", f"Banda {i} - Musica numero {i}", f"Banda {i}") for i in range(12)]
    recent = [mg.song_id(t, a) for _, t, a in songs[:6]]
    got = mg.pick_songs(songs, 6, recent)
    assert {mg.song_id(t, a) for _, t, a in got}.isdisjoint(recent), "tocou há pouco: fica de fora"
    # sem música nova suficiente, completa com as recentes mais antigas primeiro
    got = mg.pick_songs(songs, 8, recent)
    assert [mg.song_id(t, a) for _, t, a in got][6:] == recent[:2]


@pytest.mark.asyncio
async def test_played_here_mode_does_not_fill_with_searched_hits(call, monkeypatch):
    called = []

    async def fake_style(style, picks=3):
        called.append(style)
        return [(f"vid{i:08d}", f"Sertanejo {i} - Modao {i}", "x") for i in range(20)]

    monkeypatch.setattr(mg, "_style_songs", fake_style)
    g = mg.Musica(9, 1, [1, 2], None)
    g.setup({"style": "historico", "rounds": 8})
    with pytest.raises(HTTPException):
        await g.prepare()  # sem servidor e sem histórico: não inventa músicas de busca
    assert called == []


@pytest.mark.asyncio
async def test_style_game_does_not_repeat_the_last_games(call, monkeypatch):
    pool_ = [(f"vid{i:08d}", f"Banda {i} - Rock numero {i}", f"Banda {i}") for i in range(30)]

    async def fake_style(style, picks=3):
        return pool_

    from app.core import settings

    monkeypatch.setattr(settings, "youtube_key", "x", raising=False)
    monkeypatch.setattr(mg, "_style_songs", fake_style)
    monkeypatch.setattr(mg, "_recent_songs", {})
    seen: list[set[str]] = []
    for _ in range(3):
        g = mg.Musica(9, 1, [1, 2], 77)
        g.setup({"style": "rock", "rounds": 8})
        await g.prepare()
        seen.append({mg.song_id(t, a) for _, t, a in g.songs})
    assert seen[0].isdisjoint(seen[1]) and seen[1].isdisjoint(seen[2]) and seen[0].isdisjoint(seen[2])
