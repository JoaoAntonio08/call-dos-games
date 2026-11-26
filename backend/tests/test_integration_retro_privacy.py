"""Retrospectiva com PostgreSQL de verdade: mensagem que nem todo mundo vê não entra em total, ranking nem emoji."""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import httpx
import pytest

pytestmark = pytest.mark.skipif(os.environ.get("RUN_INTEGRATION") != "1", reason="requer PostgreSQL sintético isolado")


@pytest.mark.asyncio
async def test_retrospective_ignores_private_and_temporary_messages():
    from app import core
    from app.main import app

    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            tag = core.new_id()
            sessions = []
            for n in (1, 2):
                r = await client.post(
                    "/auth/register",
                    json={
                        "email": f"retro-{tag}-{n}@example.invalid",
                        "username": f"retro{tag % 10**8}{n}",
                        "display_name": f"Retro {n}",
                        "password": "correct horse battery staple",
                    },
                )
                assert r.status_code == 200, r.text
                sessions.append(r.json())
            author, viewer = (int(s["user"]["id"]) for s in sessions)
            viewer_headers = {"Authorization": f"Bearer {sessions[1]['token']}"}

            db = core.pool()
            server = core.new_id()
            open_ch, closed_ch, role = core.new_id(), core.new_id(), core.new_id()
            await db.execute("INSERT INTO servers (id, name, owner_id) VALUES ($1, 'Retro', $2)", server, author)
            await db.execute("INSERT INTO members (server_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'member')", server, author, viewer)
            await db.execute("INSERT INTO roles (id, server_id, name) VALUES ($1, $2, 'fechado')", role, server)
            await db.execute("INSERT INTO channels (id, server_id, type, name) VALUES ($1, $2, 'text', 'geral')", open_ch, server)
            await db.execute(
                "INSERT INTO channels (id, server_id, type, name, view_roles) VALUES ($1, $2, 'text', 'fechado', $3)",
                closed_ch, server, [role],
            )

            later = datetime.now(timezone.utc) + timedelta(minutes=10)

            async def message(channel: int, *, private: bool = False, temporary: bool = False) -> int:
                mid = core.new_id()
                await db.execute(
                    "INSERT INTO messages (id, channel_id, author_id, content, visible_to, expires_at) VALUES ($1, $2, $3, 'oi', $4, $5)",
                    mid, channel, author, author if private else None, later if (private or temporary) else None,
                )
                return mid

            for _ in range(2):
                await message(open_ch)  # as únicas que contam
            hidden = [await message(open_ch, private=True) for _ in range(3)]
            hidden += [await message(open_ch, temporary=True) for _ in range(2)]
            hidden += [await message(closed_ch) for _ in range(4)]
            for mid in hidden:
                await db.execute("INSERT INTO reactions (message_id, user_id, emoji) VALUES ($1, $2, '🤫')", mid, author)

            r = await client.get(f"/servers/{server}/retrospectiva", headers=viewer_headers)
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["messages"]["total"] == 2
            assert [x["value"] for x in body["messages"]["top"]] == [2]
            assert body["emojis"] == []
            assert body["star"] is None

            mine = await client.get(f"/servers/{server}/retrospectiva", headers={"Authorization": f"Bearer {sessions[0]['token']}"})
            assert mine.json()["me"]["messages"] == 2
