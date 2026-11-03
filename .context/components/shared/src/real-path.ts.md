## file

Symlinks resolve the way the kernel resolves a write: left to right, `..` moves to the parent of the directory resolved so far, and a symlink is replaced by its target's components.
Why: resolving `..` lexically first would let `pivot/../x` stay inside a directory while `pivot` leads out of it. Once a component does not exist, the rest resolves lexically, because a write creates it there. A dangling symlink therefore resolves to the target a write would create. Any other inspection failure, and more than the kernel link limit, throws. Only absence of a search root resolves lexically. A tool argument can arrive unnormalized, so `..` applies after a symlink such as `gate.sh` is followed.
