## file

Cases drive real Git and several forks and use a timeout above Vitest's default.
Why: full-suite load can exceed five seconds without a product failure. The protected-dependency case deliberately reaches the parent's copy through an unmapped shell path, so only a pre-fork snapshot can restore the fixture independently of that mutation.
