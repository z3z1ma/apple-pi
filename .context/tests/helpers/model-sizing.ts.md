## file

This helper checks the operator's workload-sizing policy in shipped configuration artifacts; its bands are test expectations, not runtime intelligence scores or provider capability metadata. Concrete role defaults may exceed the minimum band because they share one effort setting, while profile pools use each model's equivalent effort.
Why: comparing effort labels across models would misclassify Luna/xhigh and Grok/low, and exact-band checks on concrete fallbacks would reject intentionally stronger recommendations. The inference runtime remains free of tier enforcement.
Coupled: docs/model-profiles.md, components/organization/tests/catalog.test.ts, components/shared/tests/model-profile-examples.test.ts
Verify: components/organization/tests/catalog.test.ts, components/shared/tests/model-profile-examples.test.ts
