# token-radar v3 — build notes (18 Nov 2026)

Entry for make.fun token-radar-01, resubmission of v2 (01a1e864, 94,20% provisional,
#312, prize #311; paid cutoff #10 = 95,88%, gap 1,68 poin; deadline 14 Dec 2026).
v3 is a presentation + validation-depth resubmit, not a model change: the fit is
identical to v2 (LOO median miss 3,06x, the best of every entry we could inspect).

## Why v3 (diagnosis, measured)

- The model does NOT lose: LOO median miss 3,06x vs nyx77 (#1) 3,21x, brisk 3,07x,
  Launchscope (#2) 3,20x, amtyz21 (#10) 3,52x, ronigrv 3,8x. Same fit as Launchscope
  (a=7,25, b=0,52 vs ours 7,1003 + 0,5265), same universe size, near-identical
  verdicts — the gap is presentation + validation depth, not the curve.
- v2's walk-forward LEAKED: its flat multiple was fitted on ALL traded tokens
  including the test set (flat 4,86/4,82/4,36 at the 3 cutoffs). The honest
  train-only flat is 5,43/5,29/4,44. At the shared cutoff 2024-02-18 the model
  miss is identical (2,95x) — only the baseline was flattered.
- v2's board showed ~1,5 rows in its screenshot and opened with four skips;
  it had no traded-token view, no band calibration, no tenure, no ablation,
  no safety list, and no $/hour anywhere.

## What changed (P0 + P1, all in this build)

- Universe 198 (was 181): 17 rows reinstated with a per-row note — 4 name-stem
  ("shares its name with X, which records a token") + 13 chain-venue ("named for
  its chain, whose coin may be its token"). Each is a warning, not a set-aside.
  Set-aside falls 161 -> 144, each with its reason; 288 recorded, 128 traded.
- Walk-forward HONEST: flat fitted on the train set only, 5 origins
  (0,2/0,35/0,5/0,65/0,8 of the traded set): model 3,21/2,77/2,95/3,67/4,50 vs
  flat 5,23/5,24/5,29/5,29/5,03 — the model beats it at every origin.
  Plus a time-split (35 oldest train, 35 newest test): model x2,94 vs flat x5,33.
- Traded tab on the board ("Already trades"): all 128 traded tokens with market
  cap, multiple and curve value — the anchors, next to the board, not buried.
- Band calibration (LOO): P25-P75 holds 56,3% (aim 50%), P10-P90 holds 83,6%
  (aim 80%). Tenure: share recording a token by age — <195d 26% (25/95),
  195-365d 42% (27/65), 1-2y 38% (70/183), 2-3y 55% (76/139), 3-4y 79% (70/89),
  4y+ 80% (59/74). Ablation (top-20 overlap with the full model): no family 17/20,
  no priors 18/20, Huber 20/20, flat only 17/20.
- Board denser: 8 full rows visible in the 1280x1440 board screenshot (v2: ~1,5).
  Chains truncated to 2 + count (full list in the detail view); farm net shows
  net + $/hour + break-even odds on one line; sort by farm $/hour added.
- Detail view: "Before you deposit" safety list (bookmark day-0 domain, terms/KYC,
  exit waits + unbond, claim only via the bookmarked domain) and the row's note.
- Best-farms strip: top 3 farms by $/hour (#40 Apex Omni $62/h, #46 XRPL DEX $58/h,
  #55 Agni Finance $49/h) — the board opens with skips, the strip opens with farms.
- KPI strip is one line (198 ranked, 40/40 watchlist, 128 comps, LOO miss x3,06,
  band holds 56%, 60 farm). The "Live tokens" section was removed (redundant with
  the traded tab); the families table became one line; tenure/ablation are sentences.
- Byte budget: dashboard source 64,8 KB, dossier text 65,093 / 65,536 bytes, NO
  truncation (v2 was 65,440; an earlier v3 draft hit 68,095 and truncated 49 lines
  of model.js from the dossier — cut back with comment/string trims only, no
  feature removed). Headroom 443 bytes.

## Decisions (measured, not guessed)

- Slope 0,50 NOT used: gain 2,6% at the noise edge, risks a magic constant.
- Trim-92 NOT used: fit-92 prices all 128 at 4,01x vs fit-128 at 2,91x, and the
  36 discarded tokens at 20,36x — the trim throws away the hard cases.
- Huber ties the full model on top-20 (20/20) and LOO 3,13x vs OLS 3,06x — OLS kept.
- Growth tilt +0,5 kept. nyx77's "launch prediction" claim NOT copied: a logistic
  LOO test gives 54,2% vs a 54,9% base rate — no signal. Sibling grouping is a
  v4 candidate, not v3.

## Verification (this build)

- `node main.ts`: 758 protocols, 198 rows, verdicts 60 farm / 92 thin / 46 skip;
  fit unchanged (7,1003 + 0,5265, R2 0,25, resid sd 2,0374).
- `gate-check.py`: 7/7 PASS (dashboard 4 files, 198 rows, sorted by value,
  coverage 40/40, farm steps 3..12 of 20..600 chars, 4 screenshots, dossier MATCH).
- `dossier-check.mjs`: MATCH. Determinism: board.json, data.js, dossier.json
  byte-identical across two runs (same sha256).
- Screenshots re-rendered fresh with `node screenshot.mjs` (Puppeteer, 1280x1440,
  within the 1440 long-side / 512 KiB caps): board 8 rows, detail, filtered, method.
  The v2 screenshots shipped in the repo were stale until this build — the build
  copies screenshots/ into out/, so screenshot.mjs must run AFTER main.ts writes
  out/dashboard, then main.ts again to copy the fresh shots in.
- In-browser verify: the page re-runs buildRadar and reproduces all 198 rows.

## Proxy-judge A/B: v3 vs v2 (RULES.txt, 5 criteria in order, first difference wins)

Built v2 from its commit (5ed49bf) in a worktree and compared dossiers +
screenshots side by side. Same snapshot, same fit, same top-5 ranking.

| # | Criterion | v2 | v3 | Winner |
|---|-----------|----|----|--------|
| 1 | Radar works | 40/40 watchlist, 181 ranked, screenshot matches code | 40/40 watchlist, 198 ranked (+17 with notes), 144 set aside with reasons, screenshot matches code | **v3** (broader coverage) |
| 2 | Model value | Same fit; walk-forward flat LEAKY (4,86/4,82/4,36); no time-split, calibration, tenure, ablation | Same fit; walk-forward flat HONEST train-only (5,23/5,24/5,29/5,29/5,03), model wins every origin; time-split 2,94 vs 5,33; calibration 56%/84%; tenure; ablation | **v3** (decisive: honest validation) |
| 3 | Farm plan | Steps + costs + times; no exit-wait timing, no safety list | Same engine + unbond/exit timing in plans, safety list in detail, net + $/h visible | **v3** (small) |
| 4 | Dashboard as a page | Sortable/filterable, detail view, ~1,5 rows in screenshot, no traded view | + traded tab (128), best-farms strip, sort by $/h, 8 rows in screenshot, detail + safety + note | **v3** (clear) |
| 5 | Looks made | Same palette/typography; 4 stat cards, taller scatter | Same palette; denser single-line KPI, truncated chains, shorter scatter (140px) | Tie (slight v3) |

Verdict: **v3 wins 4-0-1; first difference at criterion 1, decisive at criterion 2.**
Recommendation: **resubmit** — v3 is a clear, measured improvement over v2 and the
resubmit is Force_Last (v3 replaces v2), so the A/B bar was "win clearly", met here.

## Five weakest points (honest)

1. The top-ranked rows are still all skip (#1-#4, 43-79% odds): the board opens
   with "best ideas = skip" because the gate requires sort by value. The
   best-farms strip mitigates it, but the board itself does not.
2. R2 0,25 and a P25-P75 band ~11x wide: the model gives an order of magnitude,
   stated honestly on the page, but it is a real limit on any single value.
3. Walk-forward target is market cap at the snapshot, not at listing — a proxy,
   stated honestly; it tests ranking later launches, not foresight of price.
4. The $5,000 deposit cap binds on the biggest rows: #1's slice is $14 on a
   $5,0K outlay (net $4). The cap is a deliberate accessibility choice, but it
   makes the top rows' farm economics look trivial.
5. Dossier text 65,093 / 65,536 leaves only 443 bytes of headroom, and the board
   density was bought with a shorter scatter (140px) and chains truncated to
   2 + count in rows (full chains only in the detail view).

---

# token-radar v2 — build notes (17 Nov 2026)

Entry for make.fun token-radar-01, resubmission of v1 (01a1e23b, 76,2%, #5799).
v1's verdict never said skip (184 farm / 42 thin / 0 skip). v2 fixes that and everything
around the model, following the winner Launchscope (#2, 96,2%) and the v2 design doc.

## Design decisions (measured, not guessed)

- Model: prior-adjusted log-log fit on the snapshot's own 128 traded comparables.
  ln(mcap) = 7.1003 + 0.5265 x ln(TVL) (v1 raw fit was 6.9646 + 0.5223). Family offsets
  shrunk K=8, capped at +-ln(10): trade x1.46, infra x1.59, cex x1.29, rwa x0.99,
  vault x0.87, lend x0.74, stake x0.53, other x1.00. Resid sd 2.037.
- Conservative factor = exp(-0.674 x resid_sd) = 0.253, computed at runtime from the fit.
- VERDICT RULE — design doc's Rule A is DEAD under deposit-sized plans (measured in
  /tmp/v2-probe.mjs: 0 farm / 0 thin / 181 skip). The design doc calibrated 4x/2x on
  v1's $50-$250 capital tiers; with $500-$5,000 deposits the conservative expected
  (0.01% of conservative value) never reaches 2x the outlay. Replaced by the winner's
  break-even odds rule (never guesses a launch chance; shows the chance needed):
  farm <= 10%, thin <= 25%, else skip, with a -30% 7-day TVL fall capping farm at
  thin. Measured distribution with exact cost accounting: 53 farm / 83 thin / 45 skip
  (Launchscope: 57 / 80 / 44). The conservative read survives as a displayed metric
  (conservative value, conservative odds, conservative multiple per row + method text).
- OOS variants (LOO median miss / 8-fold Spearman / within 3x):
  multiple 4.86x / 0.40 / 35%; curve 3.40x / 0.40 / 42%; family 3.31x / 0.39 / 47%;
  full 3.06x / 0.38 / 48%. Honest read: family + priors improve the median miss but
  do NOT improve the ranking (rank corr 0.40 -> 0.38). Stated on the Method view.
- Walk-forward (fit before T, test on tokens listed after T, target = mcap at snapshot):
  T=2022-12-24: 3.12x vs flat 4.86x; T=2024-02-18: 2.95x vs 4.82x;
  T=2025-04-11: 3.67x vs 4.36x. The full model beats the flat multiple at every cutoff.
- Universe: 758 protocols -> ranked 181 (watchlist 40/40), traded 128, recorded 288,
  set aside 161 with a stated reason each. Watchlist rows always ranked; above-floor
  off-watchlist rows ranked with a note (18), never dropped silently.
- Farm plan: deposit-sized (clamp(TVL/10k, $500-$5,000), sized so the slice covers
  3x the fixed costs), cheapest of top-3 chains, native coin where there is no dollar
  stablecoin, category-specific deposit action, stop rule (2x the 7-day swing, 10-35%),
  opportunity cost (T-bill 4% less deposit yield by family), hold 6-12 weeks.
- Architecture (winner's layout): the model lives in dashboard/model.js, loaded by
  main.ts AND by the page, so the judge reads the model in the dossier text and the
  page re-runs buildRadar in the browser and verifies coverage, ranks, values, bands
  and plans against board.json. lib/model.ts (v1) deleted.

## Commands
```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
node screenshot.mjs            # screenshots/ from out/dashboard (board, detail, filtered)
python3 gate-check.py out      # 7 gate rows; must be 7/7
node dossier-check.mjs out     # dossier rebuild must MATCH
```

## Log
- M1 (17 Nov): model v2 implemented (dashboard/model.js) + main.ts rewritten to load it.
  Build runs: 181 rows, 40/40 watchlist, verdicts 53/83/45, gate 7/7 on first run.
  Dossier text 65,440/65,536 (no cut), dossier 928 KB, determinism byte-identical over 2 runs.
- M2 (17 Nov): dashboard v2 (hero band + scatter, verdict bar, band column, detail with
  peers/plan/conservative odds, method view with variant table + walk-forward + family
  offsets + universe/set-aside). Screenshots: board, detail, filtered, method (4).
- M3 self-review — 5 weakest points (judge-eye read):
  1. Top-ranked rows are all skips (#1-#4 by value are skip at 43-79% odds). Honest
     economics (big TVL -> thin pro-rata slices), but the board's first impression is
     "the best ideas are skips". Mitigated by the boardnote + verdict bar; cannot reorder
     (the gate requires sort by implied value).
  2. R2 0.25 and P25-P75 bands span ~11x: the model prices orders of magnitude, not
     targets. Honest and stated; the winner faced the same data.
  3. Walk-forward target is mcap at snapshot date, not at listing: a proxy, stated
     honestly in the walk note. Stronger than random OOS, not a true forward return test.
  4. The $5,000 deposit cap binds 59/181 rows: for capped rows the verdict is driven by
     TVL, not by the protocol's quality. The cap is the winner's assumption; stated in
     the plan totals, not in the method text.
  5. The method screenshot cuts the family table (trade/vault rows below the fold) and
     the 161-row set-aside table makes the page long. Minor: the dossier text carries all.
  Fixes applied before submit: method.png added (judge sees the validation); conservative
  odds over 100% now explained in the detail view; "Stop rule: Stop rule:" duplication fixed.
- M4 (17 Nov): bundle + makefun check + resubmit.
  Bundle transcripts-v2.tar.gz sha256 5fd26348f078f8e7f85ebffd1324099d7f8cc65877189549e4566319f5e1e12e
  (2 sessions: build subagent d8a7bc57 + main 689f3f9e; 77 usage rows attached, all main
  session — subagent rows are written only when the subagent run completes, so the
  parent re-queries muse.db for agent_id d8a7bc57 after this run and re-bundles if a
  v3 is ever needed). makefun check: 13 pass, 0 fail (thinking_reproduces 68.4%,
  thinking_priced 77 records, thinking_revised app.js 9 / main.ts 5).
  RESUBMITTED 17 Nov 07:24:24Z: entry 01a1e864-8499-72fc-8f1f-c0c043ab5179,
  commit 5ed49bf, title "Launch Radar: conservative value, break-even odds, and a
  board that says skip", signed by wallet DAKd18mfrQg5D2BymzLea2GmSYdCn2YWqtVckvWk5ubA.
  Claim code AF-3FJK9-TE05G-51GHT-NH424 (PRIVAT). v1 entry 01a1e23b remains superseded
  (Force_Last: this is now the final entry). Quota used: 2/10 total, 2/5 today.
  Note: kit copy is level 17, site is level 19 — submission still accepted (HTTP 202).
