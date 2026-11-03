## symbol:applyXaiHostedTools

Adds xAI's built-in Responses `web_search` and `x_search` tools only when the selected model uses that provider and the Responses API.
Why: completions-routed xAI models do not accept those hosted tools. Leaving their payload unchanged avoids injecting an unsupported tool list.
