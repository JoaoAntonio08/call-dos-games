"""Cargos e permissões do servidor.

Dono e admins podem tudo. Os outros podem o que "todo mundo" pode no servidor (servers.everyone_perms)
mais o que os cargos deles liberam (roles.perms). Canais podem ficar restritos a alguns cargos:
view_roles (quem vê o canal) e send_roles (quem escreve no canal de texto ou fala no de voz).
"""

from __future__ import annotations

from typing import Any

from .core import err, pool

# o que um cargo pode liberar (as chaves ficam no banco; os nomes aparecem no app)
PERMS: dict[str, str] = {
    "musica": "Colocar música na fila (/tocar)",
    "dj": "Controlar qualquer música (pausar, pular e tirar da fila)",
    "comandos": "Usar comandos de bot (/dado, /sortear…)",
    "hype": "Chamar a turma para a call (hype)",
    "apelidos": "Mudar o apelido dos outros",
    "moderar_voz": "Mutar, ensurdecer, mover e desconectar quem está na call",
}
RANK = {"member": 0, "admin": 1, "owner": 2}


class Member:
    """Quem a pessoa é dentro de um servidor."""

    def __init__(self, role: str, role_ids: set[int], perms: set[str]):
        self.role = role
        self.role_ids = role_ids
        self.perms = perms

    @property
    def admin(self) -> bool:
        return RANK.get(self.role, 0) >= 1

    def can(self, perm: str) -> bool:
        return self.admin or perm in self.perms

    def sees(self, ch: Any) -> bool:
        roles = list(ch.get("view_roles") or []) if isinstance(ch, dict) else list(ch["view_roles"] or [])
        return self.admin or not roles or bool(self.role_ids & set(roles))

    def sends(self, ch: Any) -> bool:
        roles = list(ch.get("send_roles") or []) if isinstance(ch, dict) else list(ch["send_roles"] or [])
        return self.admin or not roles or bool(self.role_ids & set(roles))


async def member(server_id: int, user_id: int) -> Member | None:
    row = await pool().fetchrow(
        """SELECT m.role, s.everyone_perms,
                  COALESCE(array_agg(r.id) FILTER (WHERE r.id IS NOT NULL), '{}') AS role_ids,
                  COALESCE(array_agg(p) FILTER (WHERE p IS NOT NULL), '{}') AS role_perms
           FROM members m JOIN servers s ON s.id = m.server_id
           LEFT JOIN member_roles mr ON mr.server_id = m.server_id AND mr.user_id = m.user_id
           LEFT JOIN roles r ON r.id = mr.role_id
           LEFT JOIN LATERAL unnest(r.perms) p ON true
           WHERE m.server_id = $1 AND m.user_id = $2
           GROUP BY m.role, s.everyone_perms""",
        server_id, user_id,
    )
    if not row:
        return None
    return Member(row["role"], set(row["role_ids"]), set(row["everyone_perms"] or []) | set(row["role_perms"]))


async def require_perm(server_id: int, user_id: int, perm: str, msg: str = "Você não tem permissão para isso.") -> Member:
    m = await member(server_id, user_id)
    if not m:
        raise err(404, "Servidor não encontrado.")
    if not m.can(perm):
        raise err(403, msg)
    return m


async def channel_viewers(channel_id: int) -> list[int] | None:
    """Quem pode ver um canal de servidor restrito. None = canal sem restrição (todo mundo do servidor)."""
    ch = await pool().fetchrow("SELECT server_id, view_roles FROM channels WHERE id = $1", channel_id)
    if not ch or ch["server_id"] is None or not ch["view_roles"]:
        return None
    rows = await pool().fetch(
        """SELECT DISTINCT m.user_id FROM members m
           LEFT JOIN member_roles mr ON mr.server_id = m.server_id AND mr.user_id = m.user_id
           WHERE m.server_id = $1 AND (m.role IN ('owner', 'admin') OR mr.role_id = ANY($2::bigint[]))""",
        ch["server_id"], list(ch["view_roles"]),
    )
    return [r["user_id"] for r in rows]
