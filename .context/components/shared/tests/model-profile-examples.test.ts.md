## file

Example-policy checks copy each shipped example into an isolated agent directory and use the production global loader. Sizing expectations describe the package's starting policy; they are not availability or quota checks.
Why: new model IDs such as Terra can exist in Pi's cached live catalog before they reach the SDK's bundled compatibility catalog. Requiring the bundled catalog or the operator's private cache would make portable example tests fail for reasons unrelated to the shipped configuration.
Coupled: model-profiles.openai.json, model-profiles.anthropic.json, tests/helpers/model-sizing.ts
Verify: components/shared/tests/model-profile-examples.test.ts
