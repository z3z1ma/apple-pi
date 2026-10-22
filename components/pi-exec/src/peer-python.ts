/** Pure Python handles survive checkpoints without retaining a host object or an execution context. */
export const PEER_PYTHON_PRELUDE = `
from typing import Any

class Peer:
    def __init__(self, key: str):
        self.key = key

    async def run(self, task: str, *, output_schema: dict[str, Any] | None = None) -> Any:
        if output_schema is None:
            return await peer_run(key=self.key, task=task)
        return await peer_run(key=self.key, task=task, output_schema=output_schema)

    async def close(self) -> None:
        await peer_close(key=self.key)

async def peer(role: str) -> Peer:
    return Peer(await peer_open(role=role))

peers: dict[str, Peer] = {}
`;

export const PEER_PYTHON_STUBS = `class Peer:
    async def run(self, task: str, *, output_schema: dict[str, Any] | None = ...) -> Any: ...
    async def close(self) -> None: ...
async def peer(role: str) -> Peer: ...
peers: dict[str, Peer]`;

export const PEER_INTERNAL_NAMES = new Set(["peer_open", "peer_run", "peer_close"]);
export const PEER_PYTHON_NAMES = new Set(["Peer", "peer", "peers", "peer_bindings", ...PEER_INTERNAL_NAMES]);
