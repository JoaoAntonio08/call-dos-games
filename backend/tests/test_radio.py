"""Rádio da call: quando a fila acaba, entra música na mesma vibe (artista único → artista; vários → gênero)."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.routes import radio

CALL = 77


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    for d in (radio.history, radio.picked):
        d.clear()
    radio.off.clear()
    radio._busy.clear()
    monkeypatch.setattr(radio.settings, "youtube_key", "chave-de-teste")
    monkeypatch.setattr(radio.random, "choice", lambda xs: xs[0])  # previsível
    searches: list[str] = []

    async def search(q, n=15, lang=""):
        searches.append(q)
        return SEARCH.get(q, [])

    monkeypatch.setattr(radio, "_search", search)
    return searches


SEARCH: dict[str, list[tuple[str, str, str]]] = {}


def play(*songs):
    for vid, title, author in songs:
        radio.remember(CALL, vid, title, author)


def test_names_are_cleaned():
    assert radio.artist_of("Matuê - Topic") == "Matuê"
    assert radio.artist_of("AnittaVEVO") == "Anitta"
    assert radio.artist_of("Charlie Brown Jr. Oficial") == "Charlie Brown Jr."
    assert radio.same_song_key("Matuê - Quer Voar (Official Music Video)") == radio.same_song_key("Matuê - Quer Voar [Lyric Video]")
    assert radio.same_song_key("Song ft. Fulano") == radio.same_song_key("Song")
    assert radio.same_song_key("Matuê - Quer Voar") == radio.same_song_key("Quer Voar")
    seen = {radio.same_song_key("Veigh - Novo Balanço")}
    assert radio.choose([("x0000000001", "VEIGH - Novo Balanço (Clipe Oficial) I Ecoando Amazon Music", "VEIGH")], set(), seen, "artista", set()) is None
    assert radio.genre_of("https://en.wikipedia.org/wiki/Hip_hop_music") == "Hip hop music"
    # o canal pode ser a gravadora: o título manda
    assert radio.artist_from("Matuê - Máquina do Tempo", "30PRAUM") == "Matuê"
    assert radio.artist_from("Matuê, Teto & WIU - VAMPiro", "30PRAUM") == "Matuê"
    assert radio.artist_from("VEIGH - Novo Balanço (Clipe Oficial)", "VEIGH") == "VEIGH"
    assert radio.artist_from("Máquina do Tempo", "Matuê - Topic") == "Matuê"
    assert radio._NOT_A_SONG.search("Levitating / Adore You (Mashup!)") and radio._NOT_A_SONG.search("blinding lights (sped up+reverb)")
    assert radio.genre_of("https://en.wikipedia.org/wiki/Music") == ""


@pytest.mark.asyncio
async def test_one_artist_searches_by_artist():
    play(("aaaaaaaaaa1", "Quer Voar", "Matuê - Topic"))
    assert await radio.plan(CALL) == ("Matuê", "artista")
    play(("aaaaaaaaaa2", "Kenny G", "Matuê"))
    assert await radio.plan(CALL) == ("Matuê", "artista"), "o mesmo artista com canal diferente continua sendo um só"


@pytest.mark.asyncio
async def test_many_artists_search_by_most_common_genre(monkeypatch):
    play(("v1xxxxxxxxx", "A", "Matuê"), ("v2xxxxxxxxx", "B", "Teto"), ("v3xxxxxxxxx", "C", "Anitta"))

    async def meta(ids):
        return {
            "v1xxxxxxxxx": ["Hip hop music", "Music of Latin America"],
            "v2xxxxxxxxx": ["Hip hop music"],
            "v3xxxxxxxxx": ["Pop music"],
        }

    monkeypatch.setattr(radio, "_videos_meta", meta)
    assert await radio.plan(CALL) == ("rap Matuê Teto Anitta", "estilo"), "gênero + quem tocou (títulos sem cara de português)"
    radio.history.clear()
    play(("v1xxxxxxxxx", "Quer Voar", "Matuê"), ("v2xxxxxxxxx", "Dia Azul", "Teto"), ("v3xxxxxxxxx", "Você Não Sabe", "Anitta"))
    assert await radio.plan(CALL) == ("rap nacional Matuê Teto Anitta", "estilo"), "a turma ouvindo em português: rap nacional"


@pytest.mark.asyncio
async def test_many_artists_without_genre_fall_back_to_last_artist(monkeypatch):
    play(("v1xxxxxxxxx", "A", "Matuê"), ("v2xxxxxxxxx", "B", "Teto"))

    async def meta(ids):
        return {}

    monkeypatch.setattr(radio, "_videos_meta", meta)
    assert await radio.plan(CALL) == ("Teto", "artista")


def test_choose_never_repeats_and_varies_artist_on_style():
    results = [
        ("old00000001", "Quer Voar (Official Video)", "Matuê"),  # já tocou (outro upload)
        ("queued00001", "Na fila", "Teto"),  # já está na fila
        ("same0000001", "Outra do Matuê", "Matuê"),
        ("new00000001", "Música nova", "Veigh"),
    ]
    seen_ids = {"queued00001"}
    seen_titles = {radio.same_song_key("Quer Voar [Lyrics]"), radio.same_song_key("Na fila")}
    assert radio.choose(results, seen_ids, seen_titles, "artista", {"matuê"})[0] == "same0000001"
    assert radio.choose(results, seen_ids, seen_titles, "estilo", {"matuê"})[0] == "new00000001", "por estilo prefere outro artista"
    assert radio.choose(results[:2], seen_ids, seen_titles, "estilo", set()) is None


class FakeDB:
    def __init__(self, queue=None):
        self.queue = list(queue or [])
        self.inserted: list[tuple] = []

    async def fetchval(self, q, *a):
        return len(self.queue)

    async def fetch(self, q, *a):
        if q.startswith("DELETE"):
            gone = [r for r in self.queue if r.get("added_by") is None]
            self.queue = [r for r in self.queue if r.get("added_by") is not None]
            return gone
        return [{"video_id": r["video_id"], "title": r["title"]} for r in self.queue]

    async def execute(self, q, *a):
        self.inserted.append(a)
        self.queue.append({"video_id": a[2], "title": a[3], "added_by": None})


@pytest.fixture
def world(monkeypatch):
    db = FakeDB()
    sent: list = []
    monkeypatch.setattr(radio, "pool", lambda: db)
    monkeypatch.setattr(radio.hub, "voice", {CALL: {1: {}, 2: {}}})
    monkeypatch.setattr(radio.hub, "music", {CALL: {"video_id": "aaaaaaaaaa1"}})

    async def send(users, event, data):
        sent.append((event, data))

    async def announce(cid):
        return []

    monkeypatch.setattr(radio.hub, "send", send)
    import app.routes.extras as extras

    monkeypatch.setattr(extras, "announce_queue", announce)
    return SimpleNamespace(db=db, sent=sent)


@pytest.mark.asyncio
async def test_empty_queue_gets_a_song_in_the_same_vibe(world, clean):
    SEARCH["Matuê"] = [("aaaaaaaaaa1", "Quer Voar", "Matuê"), ("bbbbbbbbbb1", "Máquina do Tempo", "Matuê")]
    play(("aaaaaaaaaa1", "Quer Voar", "Matuê"))
    await radio.fill_if_empty(CALL)
    assert clean == ["Matuê"]
    assert world.db.inserted and world.db.inserted[0][2] == "bbbbbbbbbb1", "não repete a que acabou de tocar"
    assert radio.picked[CALL] == "bbbbbbbbbb1"
    assert world.sent[-1][0] == "music_added" and world.sent[-1][1]["radio"] is True


@pytest.mark.asyncio
async def test_does_nothing_when_queue_has_songs_off_or_call_empty(world, clean, monkeypatch):
    play(("aaaaaaaaaa1", "Quer Voar", "Matuê"))
    world.db.queue = [{"video_id": "zzzzzzzzzz1", "title": "Pedido", "added_by": 5}]
    await radio.fill_if_empty(CALL)
    radio.off.add(CALL)
    world.db.queue = []
    await radio.fill_if_empty(CALL)
    radio.off.clear()
    monkeypatch.setattr(radio.hub, "voice", {})
    await radio.fill_if_empty(CALL)
    monkeypatch.setattr(radio.settings, "youtube_key", "")
    monkeypatch.setattr(radio.hub, "voice", {CALL: {1: {}}})
    await radio.fill_if_empty(CALL)
    assert clean == [] and world.db.inserted == [], "nem pesquisa: fila com música, rádio desligado, call vazia ou sem chave"


@pytest.mark.asyncio
async def test_radio_command_toggles_and_clears_radio_songs(world):
    world.db.queue = [{"video_id": "r1xxxxxxxxx", "title": "do rádio", "added_by": None}, {"video_id": "p1xxxxxxxxx", "title": "pedido", "added_by": 5}]
    text = await radio.radio_command("", CALL)
    assert "desligado" in text and CALL in radio.off
    assert [r["video_id"] for r in world.db.queue] == ["p1xxxxxxxxx"], "tira só o que o rádio pôs"
    text = await radio.radio_command("", CALL)
    assert "ligado" in text and CALL not in radio.off
    assert "desligado" in await radio.radio_command("desligar", CALL)
    assert "desligado" in await radio.radio_command("desligar", CALL), "desligar duas vezes continua desligado"
    assert "ligado" in await radio.radio_command("ligar", CALL)


def test_mixes_and_durations():
    assert radio._NOT_A_SONG.search("HIP-HOP ANOS 2000 RELÍQUIAS, SÓ AS BRABAS!")
    assert radio._NOT_A_SONG.search("Lit Hip Hop Mix 2026")
    assert not radio._NOT_A_SONG.search("Matuê - Máquina do Tempo")
    assert radio._seconds("PT3M41S") == 221 and radio._seconds("PT1H2M") == 3720 and radio._seconds("P1DT1S") == 86401


def test_reset_when_call_empties():
    play(("aaaaaaaaaa1", "Quer Voar", "Matuê"))
    radio.off.add(CALL)
    radio.picked[CALL] = "x"
    radio.reset(CALL)
    assert CALL not in radio.history and CALL not in radio.off and CALL not in radio.picked
