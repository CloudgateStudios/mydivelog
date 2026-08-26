# Cost Model

Rough monthly figures in USD. Purpose is to size decisions, not to be an accounting record.

## Storage Per Diver

Derived from the actual sample files:

| Data | Per dive | 200-dive diver |
|---|---|---|
| Relational row + related entities | ~2 KB | ~400 KB |
| Provenance (2 sources × ~15 fields) | ~1.5 KB | ~300 KB |
| Profile summary | ~0.3 KB | ~60 KB |
| **Postgres subtotal** | **~4 KB** | **~800 KB** |
| Profile blob (compressed, object storage) | ~1.5 KB | ~300 KB |
| Original uploaded files (retained) | — | ~5 MB |
| **Object storage subtotal** | | **~5.3 MB** |

**~1 MB of Postgres and ~5 MB of object storage per active diver.** Ten thousand divers is
~10 GB of Postgres and ~53 GB of object storage — trivially affordable. This is the payoff
from keeping profiles out of the relational store.

Photos change everything: 20 photos per dive at 3 MB is **60 MB per dive**, four orders of
magnitude more than the dive record. Hence media is Phase 9 with its own cost review, and
hence R2's zero egress fees.

## Launch (0–500 users)

| Item | Config | Monthly |
|---|---|---|
| Fly — api | 2 × shared-1x, 512 MB | $10 |
| Fly — worker | 1 × shared-1x, 1 GB | $8 |
| Fly — web | 1 × shared-1x, 512 MB | $5 |
| Fly — admin | 1 × shared-1x, 256 MB | $3 |
| Neon Postgres | Launch tier, PITR | $19 |
| Cloudflare R2 | <10 GB | $1 |
| Cloudflare DNS/CDN/Access | Free tier | $0 |
| Sentry | Developer | $0 |
| Axiom logs | Free tier | $0 |
| Better Stack | Free tier | $0 |
| Resend | Free (3k emails) | $0 |
| Stripe | 2.9% + 30¢ | usage |
| Domain | `.app`, annualized | $2 |
| **Total** | | **≈ $48/mo** |

Staging adds ~$15/mo (scale-to-zero Neon branch, single small machines). Preview
environments are ephemeral and effectively free.

**Realistic all-in at launch: ~$65/month.**

## 5,000 Users (~1,000 active)

| Item | Monthly |
|---|---|
| Fly — api (3 × shared-2x) | $30 |
| Fly — worker (2 × shared-2x) | $25 |
| Fly — web + admin | $12 |
| Neon Scale tier + read replica | $69 |
| R2 (~30 GB) | $2 |
| Sentry Team | $26 |
| Axiom | $25 |
| Resend | $20 |
| Better Stack | $25 |
| **Total** | **≈ $234/mo** |

≈ **$0.05/user/month**, or ~$0.23 per *active* user.

## 50,000 Users (~10,000 active)

| Item | Monthly |
|---|---|
| Fly compute (api, worker, web, admin) | $250 |
| Neon Business + replicas | $300 |
| R2 (~500 GB, no egress fees) | $8 |
| Observability | $150 |
| Email | $50 |
| Support tooling | $100 |
| **Total** | **≈ $860/mo** |

≈ **$0.017/user/month.** Costs scale sublinearly because the fixed observability and
tooling floor dominates early and compute grows slowly.

## Revenue

Suggested shape — deliberately not gating access to one's own data:

| | Free | Pro — $4/mo or $36/yr |
|---|---|---|
| Dives | Unlimited | Unlimited |
| Import & merge | Unlimited | Unlimited |
| **Export (all formats)** | **Yes** | Yes |
| Basic stats & charts | Yes | Yes |
| Advanced analytics, SAC trends | — | Yes |
| PDF logbook | 1/month | Unlimited |
| Photo storage | 500 MB | 25 GB |
| Continuous service integrations | — | Yes |
| Original file retention | 90 days | Forever |
| Sharing & public profile | Basic | Custom |
| Support | Community | Priority |

**Breakeven:** ~16 Pro subscribers covers launch infrastructure. At 5,000 users, a 3%
conversion (150 subscribers ≈ $600/mo) covers infrastructure roughly 2.5×.

The pricing principle from [Data Model § Billing](./04-data-model.md#billing) holds
throughout: **export is free forever and full-fidelity.** Paid buys convenience, capacity,
and analysis — never access to the diver's own history. This is what makes "we're not
lock-in" credible, and credibility is the entire acquisition strategy for the consolidator
persona.

## Cost Risks

| Risk | Mitigation |
|---|---|
| **Photo storage** dwarfs everything else | Phase 9 gating; per-tier quotas; client-side resizing; R2's zero egress |
| A single user imports 50,000 dives | Per-import row caps, rate limits, tier-based storage quotas |
| Import CPU spikes | Worker autoscaling with a ceiling; per-format concurrency limits |
| Neon compute autoscale surprise | Set a spend cap and alert on the daily delta |
| Free tier abused for storage | Original-file retention limited to 90 days on free |
| Support load per user | Admin panel's import inspector is the leverage — self-diagnosis before a ticket |

## Not Counted

Developer time, which dominates everything above by orders of magnitude. Domain
registration, Apple Developer ($99/yr) and Google Play ($25 one-off) are required for
Phase 7 and are trivial. An external penetration test before launch (~$3–8k) is optional at
this scale but is the one line item worth considering seriously given the privacy profile
of dive-location data.
