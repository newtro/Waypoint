# Maintaining Waypoint Help

The files in this directory are the canonical, reviewed product-help sources used by normal Waypoint chat.

## Shipping a product change

1. Update the relevant page and, when needed, `catalog.json` keywords or version.
2. Run `npm run prepare:product-help` to produce the deterministic ignored staging bundle.
3. Run `npm run verify:product-help` and the normal test/lint/build/package gate.

The normal build runs Help preparation automatically. Its freshness check inspects the current feature-facing change (or the current commit when the worktree is clean) and fails when product source changed without a same-change Help page/catalog review. This deliberately makes Help review part of completing a feature.

Every catalog page must use its catalog title as the first heading and include explicit `Current limitations` and `Privacy and data handling` sections. The generated manifest records exact bytes and SHA-256 for each page. The packaged runtime revalidates paths, sizes, UTF-8, and digests before using any page.

Help should describe only shipped and truthfully gated behavior. Do not include credentials, customer/workspace data, copied chats, provider prompts, or instructions that grant authority.
