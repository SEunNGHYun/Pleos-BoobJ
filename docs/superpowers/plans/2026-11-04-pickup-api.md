# Pickup APIs implementation plan

**Spec:** docs/superpowers/specs/2026-11-04-pickup-api.md
**Execution:** inline, with final review.

- [x] Write HTTP tests for restaurant registration → menu/pickup selection → order creation → authorized order pickup retrieval; confirm RED.
- [x] Add menu migration and local persistent DB adapter with migration history and developer-token provisioning.
- [x] Add strict input contracts, NestJS routes, transaction service and error mapping.
- [x] Verify snapshots, tenant isolation, invalid input, idempotency, rollback and persistent reopen.
- [x] Document local setup and API examples; run full root build/typecheck/API+DB suite and smoke.

Existing Pleos and Next.js UI source remain untouched. Runtime local DB and credentials are ignored. No .git exists, so no worktree/commit can be created.

## Verification
- Initial HTTP suite failed before the local database adapter existed (RED).
- API/auth/HTTP suite: 6/6 PASS. Existing DB capacity/state suite: 8/8 PASS.
- Root build, typecheck and web/server smoke PASS.
- Documented local:setup created an ignored file-backed DB and two local developer accounts; documented dev:server command verified DB health/auth/input handling.
- Independent review: no critical/important issues. Added menu-price/name snapshot replay verification per review recommendation.
- Local bearer identities are developer infrastructure; actual Supabase Auth/hosted integration remains deferred. No production backend authentication is claimed.
