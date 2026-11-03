## file

`ALLOWED_CONTEXT_HOOKS` stays empty unless a hook is proven not to rebuild request history.
Why: provider prompt caches match an exact prefix. A context hook that rebuilds, moves or removes a message on every request invalidates the cache for the whole history.
