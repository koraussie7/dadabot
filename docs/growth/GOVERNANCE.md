# MuhanAI Point — Governance & Token Decision Checklist

> **The point of this document is to be honest about what we are, what we are not, and under what conditions we would (or would not) tokenize.**

## What we are (v0.18 — current state)

| Property | Status |
|----------|--------|
| **Form** | Server-backed ledger entry (`MuhanAI POINT` / `POINT`) |
| **Settlement** | Central server DB (Postgres in production; in-memory in tests) |
| **Cash-out** | **NOT supported.** No fiat off-ramp. |
| **P2P transfer** | Allowed only as `system-adjust` for admin-managed internal moves. |
| **Exchange listing** | **NOT listed, NOT planned.** |
| **Marketing claim** | Never advertised as an investment, future token, or appreciation vehicle. |
| **Issuance authority** | Server-side only. Cannot be minted by users. |
| **Regulatory frame** | Treated as a closed-loop promotional credit, not a security or e-money. |

## Why this design

The aggressive growth strategy (10万 first users) requires a **liquid-feeling** reward
system, but listing a token at launch would:

1. attract **token-farmers** who mint-and-dump instead of using the product;
2. create **legal exposure** in every jurisdiction where users reside;
3. **destabilize the cost model** — if POINT becomes a tradable asset, issuance must
   be backed by reserves, which we cannot fund for free users;
4. shift the team's attention from **product quality** to **price defense**.

Server-side POINT solves the same growth problem (sign-up bonus, referral, contribution
reward) without any of those downsides.

## What it would take to actually tokenize (and why we won't do it lightly)

A future token conversion would need **all** of the following — and missing one is a hard veto:

- [ ] ≥ 100k monthly active users on real AI usage (not just signups)
- [ ] ≥ 1 year of operating history with public metrics
- [ ] Legal opinion from counsel licensed in at least US, EU, KR that issuance is not a securities offering
- [ ] Tokenomics whitepaper reviewed by an independent economist
- [ ] Reserve backing strategy (off-chain revenue → buyback-and-burn, or full collateral)
- [ ] On-chain audit by 2+ reputable firms (e.g., Trail of Bits, OpenZeppelin)
- [ ] Regulator pre-clearance or no-action letter where required
- [ ] Migration tooling: every POINT entry → 1:1 (or weighted) on-chain token
- [ ] User opt-in (no surprise conversion)

**Until then**, we promise users:

- POINT will buy AI service today, tomorrow, and for as long as the service runs.
- POINT will never be sold to the user.
- POINT balances will not be unilaterally confiscated (only expired after ≥ 24 months inactivity, with 30 days notice).
- If the service shuts down, POINT holders get **service-time refund** (free months of premium AI), not cash.

## Cost-control guard rails

The most aggressive marketing move (give every signup 1,000 POINT) is safe **only** if
the budget controller enforces:

| Knob | v0.18 default | Where |
|------|---------------|-------|
| Weekly campaign issue cap | 10,000,000 POINT | `growth.budget.registerWindow` |
| Per-user daily point spend | 500 POINT | `DAILY_LIMITS["user-daily-points"]` |
| Per-user ai-chat calls/day | 50 | `DAILY_LIMITS["ai-chat"]` |
| Per-user ai-code/day | 20 | `DAILY_LIMITS["ai-code"]` |
| Min lifetime spend before weekly reward | 100 POINT | `RewardRule.minUserSpend` |
| Referral reward requires activation | Yes | `markActivated` gate |
| Contribution reward uses reputation multiplier | 1.0× – 2.0× | `computeReward` |

A startup that grows from 10k to 1M MAU should be able to **halve** the per-user signup
bonus without losing retention — the budget controller makes that A/B-testable
without code changes.

## What we tell users (in plain language)

> MuhanAI POINT is a free promotional credit you earn for signing up, referring friends,
> completing challenges, and contributing tools or models. POINT lets you use MuhanAI's
> AI services. POINT is not a cryptocurrency, is not listed on any exchange, and cannot
> be exchanged for cash. We may add new ways to use POINT in the future, but we will
> never sell it to you or promise it will appreciate.

That's it. No token-roadmap marketing, no "pre-mining" promises, no exchange listing teasers.
