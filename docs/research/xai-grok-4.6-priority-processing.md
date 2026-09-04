# xAI Grok 4.6 Priority Processing

Research snapshot: 2026-09-04

## Finding

xAI supports an OpenAI-fast-mode-like option named **Priority Processing** for Grok 4.6.
It is selected with a JSON request-body field, not an HTTP header:

```json
{
  "model": "grok-4.6",
  "input": "...",
  "service_tier": "priority"
}
```

The field works on the Responses and Chat Completions endpoints. Omitting it, or using
`"default"`, requests standard processing. The response includes `service_tier` with the
actual tier used. A request can be served as `"default"` when priority capacity is not
available, and xAI charges priority rates only when the response reports `"priority"`.

Priority Processing costs 2× standard token rates, including input, cached input, output,
and reasoning tokens. Prompt-cache discounts apply before the multiplier.

| Grok 4.6 prompt size | Priority input | Priority cached input | Priority output |
| --- | ---: | ---: | ---: |
| Below 200k tokens | $4 / 1M | $1 / 1M | $12 / 1M |
| At least 200k tokens | $8 / 1M | $2 / 1M | $24 / 1M |

Once a Grok 4.6 prompt reaches 200k tokens, the long-context rate applies to all tokens in
the request.

## OpenAI comparison

Both APIs accept `service_tier: "priority"` in the JSON body. OpenAI now calls its feature
**Fast mode**, prefers `service_tier: "fast"`, and retains `"priority"` as an equivalent
value for supported models. xAI documents `"default"` and `"priority"`; it does not
document `"fast"` as an accepted value.

The xAI OpenAPI schema's shared `ServiceTier` enum also contains `"default"` and
`"priority"`. Its request-property description says `"auto"` is the default, which
conflicts with that enum and the dedicated Priority Processing guide. Use omission or
`"default"` for standard processing and `"priority"` for priority processing.

## Primary sources

- [xAI Priority Processing](https://docs.x.ai/developers/advanced-api-usage/priority-processing)
- [xAI Grok 4.6 model details and standard pricing](https://docs.x.ai/developers/models/grok-4.6)
- [xAI API pricing](https://docs.x.ai/developers/pricing)
- [xAI OpenAPI schema](https://docs.x.ai/openapi.json)
- [OpenAI Fast mode](https://developers.openai.com/api/docs/guides/fast-mode)
