# Monthly Cost Model

This is a rough planning model, not a quote. Cloud pricing changes, discounts vary, and real bills depend on traffic, regions, uptime settings, logs, egress, backup retention, and team size.

The goal is to compare provider shapes before committing to the stack.

## Sources Checked

- Google Cloud Run pricing: https://cloud.google.com/run/pricing
- Google Cloud SQL pricing: https://cloud.google.com/sql/pricing
- Google Cloud Storage pricing: https://cloud.google.com/storage/pricing
- Neon pricing: https://neon.com/pricing
- Vercel pricing: https://vercel.com/pricing

## Shared Assumptions

- Region: `us-central1` or comparable US region.
- Month length: 730 hours.
- First public release, low to moderate traffic.
- Media is planned but not launched in v1.
- Storage is mainly imports, exports, and backups.
- API, admin, and website are not high-traffic yet.
- No committed-use discounts.
- No paid enterprise support plans.
- No high-availability database for the initial cost baseline unless called out separately.

## Key Pricing Anchors

These are the main numbers used in the model:

| Service                                             | Pricing anchor                                                                                                                                                                                                                           | Notes                                                                   |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Cloud Run request-based services                    | Free tier includes 180,000 vCPU-seconds, 360,000 GiB-seconds, and 2M requests per month; beyond that, request-based CPU is listed at `$0.000024` per vCPU-second, memory at `$0.0000025` per GiB-second, and requests at `$0.40` per 1M. | Good fit for API/web/admin/worker services with scale-to-zero.          |
| Cloud Run jobs                                      | Free tier includes 240,000 vCPU-seconds and 450,000 GiB-seconds per month; listed CPU is `$0.000018` per vCPU-second and memory is `$0.000002` per GiB-second after free tier.                                                           | Good fit for imports, exports, deletion, and future media jobs.         |
| Cloud SQL shared-core `db-f1-micro`                 | `$0.0105` per hour.                                                                                                                                                                                                                      | About `$7.67/mo` before storage/backups; not covered by Cloud SQL SLA.  |
| Cloud SQL shared-core `db-g1-small`                 | `$0.035` per hour.                                                                                                                                                                                                                       | About `$25.55/mo` before storage/backups; not covered by Cloud SQL SLA. |
| Cloud SQL dedicated-core Enterprise general purpose | `$0.0413` per vCPU-hour and `$0.007` per GiB-hour.                                                                                                                                                                                       | A 1 vCPU / 3.75 GiB instance is about `$49/mo` before storage/backups.  |
| Cloud SQL SSD storage                               | `$0.000232877` per GiB-hour.                                                                                                                                                                                                             | About `$0.17/GB-month`.                                                 |
| Cloud SQL backups                                   | `$0.000109589` per GiB-hour.                                                                                                                                                                                                             | About `$0.08/GB-month`.                                                 |
| Cloud Storage Standard regional                     | `$0.000027397` per GiB-hour in `us-central1`.                                                                                                                                                                                            | About `$0.02/GB-month`; operations and egress are separate.             |
| Neon Launch                                         | Usage-based, typical spend shown as `$15/mo`; compute `$0.106` per CU-hour and storage `$0.35/GB-month`.                                                                                                                                 | Can scale to zero when inactive, which helps lower environments.        |
| Vercel Pro                                          | `$20/mo` per developer seat, with included usage credit.                                                                                                                                                                                 | Likely baseline for commercial use and team workflows.                  |

## Scenario A: Full GCP, Lean Public Launch

Use this if we want one-provider simplicity and can accept smaller non-SLA database sizing early.

| Component                 | Assumption                                  | Estimated monthly cost |
| ------------------------- | ------------------------------------------- | ---------------------: |
| Cloud Run API             | Scale to zero, low traffic within free tier |                 `$0-5` |
| Cloud Run web app         | Scale to zero, low traffic within free tier |                 `$0-5` |
| Cloud Run admin app       | Scale to zero, low traffic within free tier |                 `$0-2` |
| Cloud Run jobs            | Import/export jobs within free tier         |                 `$0-5` |
| Cloud SQL `db-f1-micro`   | 730 hours                                   |                `$7.67` |
| Cloud SQL storage         | 20 GB SSD                                   |                `$3.40` |
| Cloud SQL backups         | 20 GB used                                  |                `$1.60` |
| Cloud Storage             | 10 GB Standard regional                     |                `$0.20` |
| Cloud Tasks               | Low volume                                  |                 `$0-2` |
| Secret Manager, DNS, misc | Low volume                                  |                 `$1-5` |
| **Estimated total**       |                                             |        **`$15-35/mo`** |

Notes:

- This is the cheapest full-GCP shape.
- The database is the compromise: shared-core Cloud SQL is inexpensive but not SLA-backed.
- This can be fine for early public launch if we are comfortable with that risk and have backups/export discipline.

## Scenario B: Full GCP, Practical Production Baseline

Use this if we want a stronger baseline while still avoiding high availability at launch.

| Component                 | Assumption                         | Estimated monthly cost |
| ------------------------- | ---------------------------------- | ---------------------: |
| Cloud Run API             | One warm instance optional         |                `$0-15` |
| Cloud Run web app         | Scale to zero or one warm instance |                `$0-10` |
| Cloud Run admin app       | Scale to zero                      |                 `$0-5` |
| Cloud Run jobs            | Import/export jobs                 |                `$0-10` |
| Cloud SQL `db-g1-small`   | 730 hours                          |               `$25.55` |
| Cloud SQL storage         | 40 GB SSD                          |                `$6.80` |
| Cloud SQL backups         | 40 GB used                         |                `$3.20` |
| Cloud Storage             | 25 GB Standard regional            |                `$0.50` |
| Cloud Tasks               | Low to moderate volume             |                 `$0-5` |
| Secret Manager, DNS, misc | Low volume                         |                `$2-10` |
| **Estimated total**       |                                    |        **`$45-90/mo`** |

Notes:

- This is probably the most realistic full-GCP starting point.
- If we keep Cloud Run min instances at zero, the lower end is realistic for early traffic.
- If we keep the API warm to reduce cold starts, add about `$10/mo` per 1 vCPU / 512 MiB always-warm instance.

## Scenario C: Full GCP, Stronger Database Baseline

Use this if we want a dedicated-core database from the beginning.

| Component                                 | Assumption             | Estimated monthly cost |
| ----------------------------------------- | ---------------------- | ---------------------: |
| Cloud Run services and jobs               | API/web/admin/workers  |                `$5-30` |
| Cloud SQL dedicated-core                  | 1 vCPU / 3.75 GiB      |                 `~$49` |
| Cloud SQL storage                         | 40 GB SSD              |                `$6.80` |
| Cloud SQL backups                         | 40 GB used             |                `$3.20` |
| Cloud Storage, queues, secrets, DNS, misc | Low to moderate volume |                `$3-15` |
| **Estimated total**                       |                        |       **`$65-105/mo`** |

Notes:

- This is cleaner for production confidence than shared-core.
- High availability would roughly double database compute/memory and storage-related HA costs, pushing the monthly number higher.

## Scenario D: Vercel + Neon + GCP Hybrid

Use this if frontend workflow and Neon database ergonomics are worth an extra provider boundary.

| Component                     | Assumption                                           | Estimated monthly cost |
| ----------------------------- | ---------------------------------------------------- | ---------------------: |
| Vercel Pro                    | 1 developer seat                                     |                  `$20` |
| Neon Launch                   | Intermittent small production database typical spend |                 `~$15` |
| GCP Cloud Run jobs/workers    | Low volume                                           |                `$0-10` |
| GCP Cloud Storage             | 10-25 GB                                             |           `$0.20-0.50` |
| GCP Cloud Tasks               | Low volume                                           |                 `$0-5` |
| GCP Secret Manager, DNS, misc | Low volume                                           |                 `$1-5` |
| **Estimated total**           |                                                      |        **`$35-60/mo`** |

Notes:

- Add `$20/mo` per additional Vercel developer seat.
- Neon can be cheaper than Cloud SQL when the database is intermittent or lower environments can scale to zero.
- This option increases provider surface area but improves frontend and preview-deployment ergonomics.

## Rough Comparison

| Stack                 | Estimated early monthly cost | Main cost driver                           | Main advantage                                 | Main risk                                     |
| --------------------- | ---------------------------: | ------------------------------------------ | ---------------------------------------------- | --------------------------------------------- |
| Full GCP lean         |                     `$15-35` | Cloud SQL shared-core                      | Lowest one-provider start                      | Shared-core DB has weaker production posture. |
| Full GCP practical    |                     `$45-90` | Cloud SQL `db-g1-small` plus warm services | Unified ops and reasonable production baseline | Still no Cloud SQL SLA on shared-core.        |
| Full GCP dedicated DB |                    `$65-105` | Dedicated Cloud SQL                        | Stronger database baseline                     | Higher fixed monthly floor.                   |
| Vercel + Neon + GCP   |                     `$35-60` | Vercel seat + Neon                         | Better frontend workflow and lower DB floor    | More provider integration.                    |

## Recommendation

For MyDiveLog, the cost model does not rule out full GCP. The difference between full GCP and the hybrid stack is not large enough to dominate the decision.

Recommended decision framing:

- Choose **full GCP** if one-provider simplicity, IAM consistency, and long-term operational clarity matter most.
- Choose **Vercel + Neon + GCP** if Vercel previews and Neon scale-to-zero database behavior matter most.

Decision: start with **Full GCP Lean**. This keeps the launch cost low while preserving one-provider simplicity. Revisit database sizing, Cloud SQL SLA posture, and high availability after real usage appears.

## Cost Controls

- Keep Cloud Run min instances at zero unless cold starts hurt real users.
- Use budgets and billing alerts from day one.
- Keep staging resources small and shut down preview databases when unused.
- Use lifecycle rules for import/export files.
- Keep media deferred for v1.
- Keep database storage and backup retention intentional.
- Revisit Cloud SQL HA after public usage and revenue justify the higher floor.

## Open Cost Questions

- Do we require a database SLA for public launch, or is shared-core acceptable initially with backups and quick recovery?
- How many developer seats should be assumed for Vercel if we choose the hybrid stack?
- Do we want always-warm API instances for launch, or are scale-to-zero cold starts acceptable?
- How long should import files, generated exports, and deleted-account archives be retained?
