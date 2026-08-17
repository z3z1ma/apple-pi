# xAI hosted tools

Every xAI request that uses Pi's `openai-responses` API receives xAI's built-in `{ type: "web_search" }` and `{ type: "x_search" }` tools unless the payload already includes that tool. Completions-routed Grok models are left unchanged: switch those models to `openai-responses` against `https://api.x.ai/v1` if they should search. Domain filters, handle filters, and image-search flags are not configured; xAI bills each tool when the model uses it.
