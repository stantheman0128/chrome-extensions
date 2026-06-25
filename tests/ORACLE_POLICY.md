# Colonist Stats Tracker — Oracle / Verification Policy

This repo separates **who writes fixes** from **who owns expected values**.

## Roles

| Role | May edit | Must not edit |
|------|----------|----------------|
| **Implementer** (feature agent) | `colonist-stats-tracker/*`, plumbing tests | `tests/fixtures/oracle/*`, `tools/generate-oracle-fixtures.js` OFFSETS |
| **Verification agent** | oracle JSON, `tests/oracle-*.test.js`, generator | product code (unless a test exposes a real bug) |

## What counts as a trustworthy oracle

1. **Colonist broadcasts** — gameLog `type 47` (production), `55` (discard), etc.
2. **Independent geometry** — corner→tile offsets in `tools/generate-oracle-fixtures.js` (same derivation as `ws-geometry-independent.test.js`), never imported from `board.js`.
3. **Explicit scenario steps** — small JSON sequences with hand-written `expect` blocks for wiring tests.

## Regenerating oracle from a real capture

```bash
# 2-player full-state (geometry + production):
node tools/generate-oracle-fixtures.js

# WS dump from ws-inspector save() — needs uncapped `log`:
node tools/ingest-ws-dump.js "path/to/cst-ws-frames.json" ws-mine143-4p
node tools/ingest-ws-dump.js "path/to/cst-ws-frames (7).json" ws-deal2630-4p
```

The 2p generator **self-checks** geometry against type-47 broadcasts. Dump ingest **self-checks** log type counts against `tests/fixtures/oracle/<gameId>-4p-audit-endstate.json` when present (does not overwrite audit files).

Frozen captures:

| gameId | Audit fixture | Notes |
|--------|---------------|-------|
| `mine143` | `mine143-4p-audit-endstate.json` | No type-55; all `discardCards: 0` |
| `deal2630` | `deal2630-4p-audit-endstate.json` | **10× type-55**; Stan brick mono, Verge grain mono |

## Hand-recon oracle (B5)

Opponent card **types** are protocol-opaque — never freeze `reconBreakdownOf` output as expected values (circular). Ground truth is two **invariants**:

1. **Total conservation** — whenever WS reports `playerStates.resourceCards`, `reconSumOf(b,color) === handCountOf(b,color)`.
2. **Public production** — type-47 with `distributionType` 0 or 1 must accrue into **known** resIds (raw `handRecon` always; projected breakdown when raw `unknown === 0` for that color).

Fixtures (`tests/fixtures/oracle/*-recon-replay.json`) store **inputs only**: opening type-4, pre-buffer log catch-up range (+ dev timeline from capture), and slim type-91 diffs. No expected breakdown.

```bash
# 4p replay fixture from a ws-inspector save():
node tools/extract-recon-replay-fixture.js "path/to/cst-ws-frames.json" deal2630
```

| Fixture | Role |
|---------|------|
| `deal2630-4p-recon-replay.json` | Real 4p late-game WS window (68 steps) + log catch-up |
| `frame50-hand-recon-replay.json` | Synthetic 2p Codex frame-50 path; projected invariant 2 + teeth |

Partial WS captures (500-frame buffer, no mid-game accrual snapshot) cannot assert projected invariant 2 on every 4p frame when raw recon still carries `unknown` from bootstrap — raw accrual invariant 2 still runs. Future captures with `accrualAtBufferStart` in the fixture unlock full projected checks on 4p.

## CI / local gate

```bash
npm test
npm run test:oracle    # generate-oracle-fixtures + oracle-verification + capture-oracle + hand-recon-oracle
```

Implementer PRs that change `board.js` geometry must keep oracle verification green without editing oracle JSON.

## Adding a new real-game capture

1. Export WS frames from colonist (or use existing `ws-fullstate-2p.json` style dump).
2. Verification agent runs the generator → new `tests/fixtures/oracle/<name>-oracle.json`.
3. Add a test that loads the oracle and asserts `board.js` matches frozen expectations.
4. Implementer may not change expected numbers — only fix `board.js` / `content.js`.
