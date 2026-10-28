## file

This helper checks the operator's workload-sizing policy in shipped configuration artifacts; its bands are test expectations, not runtime intelligence scores or provider capability metadata. Concrete role entries and profile pools both carry model-specific effort, so shipped defaults can match their workload's band exactly.
Why: comparing effort labels across models would misclassify Luna/xhigh and Grok/low; testing every fallback prevents a valid first choice from hiding a mis-sized later one. The inference runtime remains free of tier enforcement.
Coupled: docs/model-profiles.md, components/organization/tests/catalog.test.ts, components/shared/tests/model-profile-examples.test.ts
Verify: components/organization/tests/catalog.test.ts, components/shared/tests/model-profile-examples.test.ts
