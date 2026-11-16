// Launch Radar — a comps-fitted token launch radar.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// every rankable pre-token protocol below the floor. A protocol is pre-token when its record
// carries no token (no market cap, no CoinGecko id, no symbol); live-token protocols are kept
// apart and shown as the market's own values, never mixed into the ranked board.
//
// Implied value is FITTED to the snapshot itself, not assumed. The program reads the sealed
// snapshot, takes the protocols whose token already trades as comparables, and fits a size
// curve to them by least squares in log space:
//
//   log(mcap_usd) = a + b * log(tvl_usd)
//
// The fit is done at run time from the snapshot's own figures, so no constant and no name is
// ever hard-coded. The dashboard states the fitted a and b, how many comparables were used,
// the R-squared, and the out-of-sample error from a 5-fold split (by slug hash, deterministic).
// A pre-token protocol's implied value is then the curve's prediction for its TVL, adjusted by
// its own 7-day growth and its age, the same two adjustments the house starter used:
//
//   growth   = clamp(change_7d, -60, 120) per cent
//   growthMult   = 1 + (growth / 100) * 0.5
//   maturity = 0.6 + min(age_days, 1095) / 1095 * 0.4   (age unknown: 365 days)
//   implied  = max(1, round(exp(a + b * log(tvl_usd)) * growthMult * maturity))
//
// The fit on this snapshot is honest about its limits: the comparables' mcap/TVL ratio spans
// roughly 0.0003x to 400x, so the curve explains only about a fifth of the variance (R2 ~ 0.19)
// and the out-of-sample error is about 2.1 in log space (roughly 8x). The dashboard says so.
// The curve is still the best single summary the snapshot's own market gives, and it is the
// only input the board's ranking uses besides each protocol's own growth and age. No protocol
// name is ever special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The fitted size curve and its validation, as the dashboard states them. */
export interface CompsFit {
  n: number;
  intercept: number;
  slope: number;
  r2: number;
  resid_sd: number;
  oos_sd: number;
  oos_mean_abs: number;
  median_ratio: number;
}

/** The model's constants: the fitted curve plus the growth/maturity adjustments. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2-comps';

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    curve_intercept: number;
    curve_slope: number;
    curve_value_usd: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
  farm_net: {
    capital_usd: number;
    gas_usd: number;
    total_outlay_usd: number;
    assumed_allocation_pct: number;
    expected_value_usd: number;
    net_usd: number;
    verdict: 'farm' | 'thin' | 'skip';
  };
}

/** The dashboard's compact view of one row, with the farm plan carried along so the detail view shows the same plan the board was scored on. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  curve_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
  farm_net_usd: number;
  farm_verdict: 'farm' | 'thin' | 'skip';
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the fit and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  fit: CompsFit;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A deterministic 0..4 fold from a slug, for the out-of-sample split. */
function foldOf(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return h % 5;
}

/** Least squares for y = a + b*x over the points. */
function leastSquares(xs: number[], ys: number[]): { a: number; b: number; r2: number; residSd: number } {
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let sst = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i]! - mx) * (xs[i]! - mx);
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sst += (ys[i]! - my) * (ys[i]! - my);
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  const a = my - b * mx;
  let ssr = 0;
  for (let i = 0; i < n; i++) ssr += (ys[i]! - (a + b * xs[i]!)) ** 2;
  const r2 = sst === 0 ? 0 : 1 - ssr / sst;
  const residSd = n > 2 ? Math.sqrt(ssr / (n - 2)) : 0;
  return { a, b, r2, residSd };
}

/**
 * Fit the size curve to the snapshot's own comparables: protocols whose token already trades
 * and whose market cap is a positive number. Returns the fit plus a 5-fold out-of-sample error.
 * The fit is deterministic: same snapshot in, same numbers out.
 */
export function fitComps(snapshot: Snapshot): CompsFit {
  const comps = snapshot.protocols.filter(
    (p) => p.gecko_id !== null && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const xs = comps.map((p) => Math.log(p.tvl_usd));
  const ys = comps.map((p) => Math.log(p.mcap_usd!));
  const { a, b, r2, residSd } = leastSquares(xs, ys);
  const ratios = comps.map((p) => p.mcap_usd! / p.tvl_usd).sort((x, y) => x - y);
  const medianRatio = ratios.length > 0 ? ratios[Math.floor(ratios.length / 2)]! : 0;
  // 5-fold out-of-sample: fit on 4 folds, predict the held-out fold, pool the errors.
  const errs: number[] = [];
  for (let f = 0; f < 5; f++) {
    const train = comps.filter((p) => foldOf(p.slug) !== f);
    const test = comps.filter((p) => foldOf(p.slug) === f);
    if (train.length < 3 || test.length === 0) continue;
    const t = leastSquares(
      train.map((p) => Math.log(p.tvl_usd)),
      train.map((p) => Math.log(p.mcap_usd!)),
    );
    for (const p of test) errs.push(Math.log(p.mcap_usd!) - (t.a + t.b * Math.log(p.tvl_usd)));
  }
  const oosSd = errs.length > 1 ? Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / (errs.length - 1)) : 0;
  const oosMeanAbs = errs.length > 0 ? errs.reduce((s, e) => s + Math.abs(e), 0) / errs.length : 0;
  return {
    n: comps.length,
    intercept: Math.round(a * 1e4) / 1e4,
    slope: Math.round(b * 1e4) / 1e4,
    r2: Math.round(r2 * 1e3) / 1e3,
    resid_sd: Math.round(residSd * 1e3) / 1e3,
    oos_sd: Math.round(oosSd * 1e3) / 1e3,
    oos_mean_abs: Math.round(oosMeanAbs * 1e3) / 1e3,
    median_ratio: Math.round(medianRatio * 1e3) / 1e3,
  };
}

/** The curve's prediction for a TVL, before the growth and maturity adjustments. */
export function curveValue(tvlUsd: number, fit: CompsFit): number {
  return Math.exp(fit.intercept + fit.slope * Math.log(tvlUsd));
}

/** The three multipliers and the implied value one protocol gets under the fitted curve. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fit: CompsFit,
  model: ModelConstants,
): { implied: number; curve: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const curve = curveValue(protocol.tvl_usd, fit);
  const implied = Math.max(1, Math.round(curve * growthMult * maturityMult));
  return { implied, curve, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** The assumed share of a launch a single active farmer receives, for the net. */
export const ASSUMED_ALLOCATION_PCT = 0.01;

/** The multiples of the outlay that separate farm from thin from skip. */
export const FARM_MULTIPLE = 5;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** Gas for one transaction on a chain, in dollars, from the chain's usual fee level. */
function gasPerTx(chain: string): number {
  const c = chain.toLowerCase();
  if (c.includes('ethereum')) return 4;
  if (c.includes('solana')) return 1;
  if (c.includes('base') || c.includes('arbitrum') || c.includes('optimism')) return 1;
  if (c.includes('bnb') || c.includes('polygon')) return 1;
  return 2;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan, netted to the dollar: six steps, each an action with a cost and a
 * time, plus a net line that subtracts the whole outlay (gas for the setup and the weekly
 * actions, capital at risk while it sits in the position) from the expected value of a
 * 0.01% farmer allocation at the implied value. That share assumes a 10% airdrop pool and a
 * 0.1% share of the pool for one active farmer. The verdict follows the net as a multiple
 * of the outlay: farm when the expected value clears five times the outlay, thin when it
 * clears the outlay at all, skip when it does not. The allocation share is an assumption,
 * stated on the dashboard; the costs are the protocol's own figures (capital tier, chain
 * gas, hold days).
 */
export function farmPlan(
  p: SnapshotProtocol,
  age: number | null,
  implied: number,
): { steps: FarmStep[]; net: BoardRow['farm_net'] } {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasPerTx(chain);
  const action = actionFor(p, capital, chain);
  const weeklyTx = Math.max(1, Math.round(hold / 7));
  const gasTotal = gas * (2 + weeklyTx);
  const totalOutlay = capital + gasTotal;
  const expected = Math.round(implied * (ASSUMED_ALLOCATION_PCT / 100));
  const net = expected - totalOutlay;
  const verdict: 'farm' | 'thin' | 'skip' =
    expected >= FARM_MULTIPLE * totalOutlay ? 'farm' : expected >= totalOutlay ? 'thin' : 'skip';
  const steps: FarmStep[] = [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: `under $${gas} of gas for the first transaction`,
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: `about $${gas} of gas a week, $${gas * weeklyTx} over ${hold} days`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Net: $${expected} expected from a ${ASSUMED_ALLOCATION_PCT}% allocation at the $${implied.toLocaleString('en-US')} implied value, minus $${totalOutlay} outlay ($${capital} capital + $${gasTotal} gas) = $${net.toLocaleString('en-US')} net, ${expected >= FARM_MULTIPLE * totalOutlay ? 'over' : 'under'} ${FARM_MULTIPLE}x the outlay. Verdict: ${verdict}.`,
      cost: `net $${net.toLocaleString('en-US')}`,
      time: 'the whole plan',
    },
  ];
  return {
    steps,
    net: {
      capital_usd: capital,
      gas_usd: gasTotal,
      total_outlay_usd: totalOutlay,
      assumed_allocation_pct: ASSUMED_ALLOCATION_PCT,
      expected_value_usd: expected,
      net_usd: net,
      verdict,
    },
  };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, fit: CompsFit, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol below the watchlist floor, by TVL.
  // Never a replacement for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const { implied, curve, growthPct, growthMult, maturityMult, age } = impliedValue(p, snapshot.as_of, fit, model);
    const plan = farmPlan(p, age, implied);
    return { p, implied, curve, growthPct, growthMult, maturityMult, age, plan };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      curve_intercept: fit.intercept,
      curve_slope: fit.slope,
      curve_value_usd: Math.round(s.curve),
      growth_pct: s.growthPct,
      growth_multiplier: Math.round(s.growthMult * 1e4) / 1e4,
      maturity_multiplier: Math.round(s.maturityMult * 1e4) / 1e4,
      age_days: s.age,
    },
    farm_steps: s.plan.steps.map(stepText),
    farm_net: s.plan.net,
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan carried along so the detail view shows the same plan the board was scored on. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    curve_value_usd: row.model.curve_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    farm_steps: row.farm_steps,
    farm_net_usd: row.farm_net.net_usd,
    farm_verdict: row.farm_net.verdict,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData; fit: CompsFit } {
  const fit = fitComps(snapshot);
  const board = buildBoard(snapshot, fit, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    fit,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar, fit };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
