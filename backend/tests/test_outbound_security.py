from __future__ import annotations

import socket

import pytest

from app import outbound
from app.routes import comandos


def addr(ip: str):
    family = socket.AF_INET6 if ":" in ip else socket.AF_INET
    return (family, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (ip, 443))


@pytest.mark.parametrize(
    "ip",
    [
        "127.0.0.1",
        "10.0.0.1",
        "172.16.0.1",
        "192.168.0.1",
        "169.254.169.254",
        "100.64.0.1",
        "0.0.0.0",
        "::1",
        "fc00::1",
        "fe80::1",
        "::ffff:127.0.0.1",
    ],
)
def test_private_and_reserved_destinations_are_rejected(monkeypatch, ip):
    monkeypatch.setattr(outbound.socket, "getaddrinfo", lambda *args, **kwargs: [addr(ip)])
    with pytest.raises(ValueError):
        outbound.public_https_target("https://bot.example/callback")


@pytest.mark.parametrize(
    "url",
    [
        "http://bot.example/callback",
        "https://user:password@bot.example/callback",
        "https://bot.example:8443/callback",
        "https://bot.example/callback#secret",
    ],
)
def test_callback_url_shape_is_restricted(monkeypatch, url):
    monkeypatch.setattr(outbound.socket, "getaddrinfo", lambda *args, **kwargs: [addr("93.184.216.34")])
    with pytest.raises(ValueError):
        outbound.public_https_target(url)


def test_all_dns_answers_must_be_public(monkeypatch):
    monkeypatch.setattr(
        outbound.socket,
        "getaddrinfo",
        lambda *args, **kwargs: [addr("93.184.216.34"), addr("192.168.0.82")],
    )
    with pytest.raises(ValueError):
        outbound.public_https_target("https://bot.example/callback")


def test_connection_uses_the_validated_ip_without_resolving_again(monkeypatch):
    resolutions = 0
    captured: dict = {}

    def resolve(*args, **kwargs):
        nonlocal resolutions
        resolutions += 1
        return [addr("93.184.216.34")]

    class Response:
        status = 200

        def read(self, amount):
            return b'{"content":"ok"}'

    class Connection:
        def __init__(self, target, timeout):
            captured.update(target=target, timeout=timeout)

        def request(self, method, path, body, headers):
            captured.update(method=method, path=path, body=body, headers=headers)

        def getresponse(self):
            return Response()

        def close(self):
            captured["closed"] = True

    monkeypatch.setattr(outbound.socket, "getaddrinfo", resolve)
    monkeypatch.setattr(outbound, "PinnedHTTPSConnection", Connection)

    response = outbound.post_public_https(
        "https://bot.example/callback?version=1",
        b"{}",
        {"Content-Type": "application/json"},
    )

    assert resolutions == 1
    assert captured["target"].ip == "93.184.216.34"
    assert captured["target"].host == "bot.example"
    assert captured["path"] == "/callback?version=1"
    assert captured["closed"] is True
    assert response.json() == {"content": "ok"}


def test_oversized_callback_response_is_rejected(monkeypatch):
    monkeypatch.setattr(outbound.socket, "getaddrinfo", lambda *args, **kwargs: [addr("93.184.216.34")])

    class Response:
        status = 200

        def read(self, amount):
            return b"x" * amount

    class Connection:
        def __init__(self, target, timeout):
            pass

        def request(self, *args, **kwargs):
            pass

        def getresponse(self):
            return Response()

        def close(self):
            pass

    monkeypatch.setattr(outbound, "PinnedHTTPSConnection", Connection)
    with pytest.raises(ValueError):
        outbound.post_public_https("https://bot.example/callback", b"{}", {})


@pytest.mark.asyncio
async def test_command_callback_does_not_follow_redirect(monkeypatch):
    monkeypatch.setattr(
        comandos,
        "post_public_https",
        lambda *args, **kwargs: outbound.OutboundResponse(302, b"redirect"),
    )
    text, author = await comandos.call_bot(
        {"name": "Synthetic Bot", "command_url": "https://bot.example/callback", "token_hash": "hash"},
        "status",
        "",
        {"id": 9, "server_id": 5},
        42,
        "Synthetic User",
        "100",
    )
    assert "302" in text
    assert author == comandos.HOUSE_BOT_NAME
