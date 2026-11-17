"""Cliente HTTPS com DNS e conexão presos ao mesmo endereço público validado."""

from __future__ import annotations

import http.client
import ipaddress
import json
import socket
import ssl
from dataclasses import dataclass
from urllib.parse import urlparse, urlunsplit

MAX_RESPONSE = 64 * 1024


@dataclass(frozen=True)
class PublicTarget:
    host: str
    ip: str
    port: int
    path: str


@dataclass(frozen=True)
class OutboundResponse:
    status: int
    content: bytes

    def json(self):
        return json.loads(self.content)

    @property
    def text(self) -> str:
        return self.content.decode("utf-8", errors="replace")


def _public_ip(raw: str) -> str | None:
    try:
        address = ipaddress.ip_address(raw.split("%", 1)[0])
    except ValueError:
        return None
    return str(address) if address.is_global else None


def public_https_target(url: str) -> PublicTarget:
    """Resolve uma única vez e rejeita destinos locais, privados e reservados."""
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise ValueError("callback precisa ser uma URL HTTPS pública, sem credenciais ou fragmento")
    try:
        port = parsed.port or 443
    except ValueError as exc:
        raise ValueError("porta inválida") from exc
    if port != 443:
        raise ValueError("callback precisa usar a porta HTTPS padrão (443)")
    try:
        host = parsed.hostname.encode("idna").decode("ascii")
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM, proto=socket.IPPROTO_TCP)
    except (OSError, UnicodeError) as exc:
        raise ValueError("não foi possível resolver o callback") from exc
    addresses = {_public_ip(info[4][0]) for info in infos}
    if not addresses or None in addresses:
        raise ValueError("callback resolveu para endereço não público")
    path = urlunsplit(("", "", parsed.path or "/", parsed.query, ""))
    return PublicTarget(host=host, ip=sorted(addresses)[0], port=port, path=path)


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    """Usa IP já validado para TCP, mantendo hostname original para SNI/certificado."""

    def __init__(self, target: PublicTarget, timeout: float):
        super().__init__(target.host, target.port, timeout=timeout, context=ssl.create_default_context())
        self._pinned_ip = target.ip

    def connect(self) -> None:
        sock = socket.create_connection((self._pinned_ip, self.port), self.timeout, self.source_address)
        try:
            self.sock = self._context.wrap_socket(sock, server_hostname=self.host)
        except Exception:
            sock.close()
            raise


def post_public_https(url: str, payload: bytes, headers: dict[str, str], timeout: float = 6) -> OutboundResponse:
    target = public_https_target(url)
    connection = PinnedHTTPSConnection(target, timeout)
    try:
        connection.request("POST", target.path, body=payload, headers=headers)
        response = connection.getresponse()
        content = response.read(MAX_RESPONSE + 1)
        if len(content) > MAX_RESPONSE:
            raise ValueError("resposta do callback excedeu o limite")
        return OutboundResponse(response.status, content)
    finally:
        connection.close()
