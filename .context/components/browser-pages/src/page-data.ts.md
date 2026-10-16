## file

This is the only server module the page imports. Keep it free of Node imports, and put here every type the page shares with the server.
Why: `tsconfig.web.json` resolves each module the page imports, also for `import type`. A type import from a server module pulls that module's Node dependencies into the web check.

Coupled: tsconfig.web.json
