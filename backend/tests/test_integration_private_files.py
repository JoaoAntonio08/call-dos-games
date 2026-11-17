from __future__ import annotations

import os

import httpx
import pytest

pytestmark = pytest.mark.skipif(os.environ.get("RUN_INTEGRATION") != "1", reason="requer PostgreSQL sintético isolado")


@pytest.mark.asyncio
async def test_private_attachment_follows_current_dm_membership():
    from app import core
    from app.main import app

    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            sessions = []
            for n in range(1, 4):
                response = await client.post(
                    "/auth/register",
                    json={
                        "email": f"synthetic-{n}@example.invalid",
                        "username": f"synthetic{n}",
                        "display_name": f"Synthetic {n}",
                        "password": "correct horse battery staple",
                    },
                )
                assert response.status_code == 200
                sessions.append(response.json())

            headers = [{"Authorization": f"Bearer {s['token']}"} for s in sessions]
            uploaded = await client.post(
                "/files",
                headers=headers[0],
                files={"file": ("proof.txt", b"synthetic-private-content", "text/plain")},
            )
            assert uploaded.status_code == 200
            attachment = uploaded.json()

            assert (await client.get(f"/files/{attachment['id']}")).status_code == 404
            assert (await client.get(f"/files/{attachment['id']}", headers=headers[0])).status_code == 200
            assert (await client.get(f"/files/{attachment['id']}", headers=headers[1])).status_code == 404

            channel_id = core.new_id()
            await core.pool().execute(
                "INSERT INTO channels (id, type, name) VALUES ($1, 'dm', '')",
                channel_id,
            )
            for session in sessions[:2]:
                await core.pool().execute(
                    "INSERT INTO dm_participants (channel_id, user_id) VALUES ($1, $2)",
                    channel_id,
                    int(session["user"]["id"]),
                )

            sent = await client.post(
                f"/channels/{channel_id}/messages",
                headers=headers[0],
                json={"content": "arquivo sintético", "attachment_ids": [attachment["id"]]},
            )
            assert sent.status_code == 200
            allowed = await client.get(f"/files/{attachment['id']}", headers=headers[1])
            assert allowed.status_code == 200
            assert allowed.content == b"synthetic-private-content"
            assert (await client.get(f"/files/{attachment['id']}", headers=headers[2])).status_code == 404

            await core.pool().execute(
                "DELETE FROM dm_participants WHERE channel_id = $1 AND user_id = $2",
                channel_id,
                int(sessions[1]["user"]["id"]),
            )
            assert (await client.get(f"/files/{attachment['id']}", headers=headers[1])).status_code == 404
