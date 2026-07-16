# Scaling the reporting layer

Before optimising, I'd want answers:

- Is reporting a **live dashboard** (sub-second) or an **overnight export**? How stale can figures be?
- **Fixed reports**, or **ad-hoc slicing** by store / product / brand / region?
- Rows per store per day, and how many stores?
- Is the 18-month window **rolling** (old data drops off) or ever-growing?

Then, conditioned on those answers, I'd go only as far as needed:

1. **Covering index** on `(storeId, occurredAt) INCLUDE (totalBase)` — serves "store totals over a date range" from the index alone.
2. **Monthly range partitioning** on `occurredAt` — prunes scans to the queried months, and an 18-month retention window becomes a partition `DROP`, not a `DELETE` of millions of rows.
3. **Materialised rollups** by product/brand/region, refreshed nightly — if staleness is tolerable, dashboards read pre-aggregated rows.
4. **Read replica** — keep reporting load off the POS write path.
5. **Columnar/warehouse offload** — only if still slow at that scale.

Already built for this: `occurredAt` distinct from `createdAt`; `*_base` columns so reports never re-multiply FX; `region` denormalised onto `stores`.
