// Launch Radar v2 — a comps-fitted token launch radar (Node 22, standard library only).
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>),
// runs the model in dashboard/model.js (the same file the page and the judge read), scores
// every pre-token protocol with the fitted curve and its family offset, writes the ranked
// board to /output/board.json, and copies this repository's dashboard/ and screenshots/ to
// /output. Last, it writes /output/dossier.json with the vendored make.fun library.
//
// The dashboard is a static page, no framework and no network: dashboard/index.html,
// dashboard/app.css and dashboard/app.js read /output/data.js, which this program writes from
// the same board, and dashboard/model.js re-runs the model in the browser to verify the board.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);
// The model: one file, read by this program, by the page and by the judge.
const RadarModel = require(join(here, 'dashboard', 'model.js'));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
interface SnapshotProtocol {
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
interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Why the snapshot is not one this model can score. */
class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
function parseSnapshot(text: string): Snapshot {
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

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Band calibration (leave-one-out): how often the LOO band holds the real market cap. */
function bandCalibration(traded: SnapshotProtocol[], asOf: string): { p25_75: number; p10_90: number } {
  const pts = RadarModel.fitPoints(traded, asOf, true);
  const full = RadarModel.fitCurve(pts, { slope: true, families: true, priors: true });
  const resid = pts.map((pt: { y: number; x: number; fam: string }) => pt.y - RadarModel.predictLog(full, pt.x, pt.fam));
  const sd = Math.sqrt(resid.reduce((s: number, e: number) => s + e * e, 0) / Math.max(1, pts.length - 2));
  let in2575 = 0, in1090 = 0;
  pts.forEach((pt: { y: number; x: number; fam: string }, i: number) => {
    const loo = RadarModel.fitCurve(pts.filter((_: unknown, j: number) => j !== i), { slope: true, families: true, priors: true });
    const d = Math.abs(pt.y - RadarModel.predictLog(loo, pt.x, pt.fam));
    if (d <= 0.674 * sd) in2575++;
    if (d <= 1.282 * sd) in1090++;
  });
  return { p25_75: in2575 / pts.length, p10_90: in1090 / pts.length };
}

/** Launch rate by tracking age: share of protocols in each age bucket that record a token. */
function tenureTable(snap: Snapshot, asOf: string): { label: string; total: number; has_token: number; share: number }[] {
  const buckets: [number, number, string][] = [
    [0, 195, '<195d'], [195, 365, '195-365d'], [365, 730, '1-2y'],
    [730, 1095, '2-3y'], [1095, 1460, '3-4y'], [1460, 1e9, '4y+'],
  ];
  return buckets.map(([lo, hi, label]) => {
    const inB = snap.protocols.filter((p) => {
      const d = RadarModel.daysSince(p.listed_at, asOf);
      return d !== null && d >= lo && d < hi;
    });
    const has = inB.filter((p) => RadarModel.tokenStatus(p) !== 'none').length;
    return { label, total: inB.length, has_token: has, share: inB.length ? has / inB.length : 0 };
  });
}

/** Huber fit (IRLS, k=1.345): the curve with outliers down-weighted, for the ablation. */
function fitHuber(points: { x: number; y: number; fam: string }[]): { a: number; b: number; fam: Record<string, number> } {
  let fit = RadarModel.fitCurve(points, { slope: true, families: false, priors: true });
  for (let it = 0; it < 12; it++) {
    const r = points.map((pt) => pt.y - fit.a - fit.b * pt.x);
    const s = 1.4826 * RadarModel.quantile(r.map(Math.abs), 0.5) * 1.345;
    let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    points.forEach((pt, j) => {
      const w = Math.min(1, s / Math.max(Math.abs(r[j]), 1e-9));
      sw += w; sx += w * pt.x; sy += w * pt.y; sxx += w * pt.x * pt.x; sxy += w * pt.x * pt.y;
    });
    const b = (sw * sxy - sx * sy) / (sw * sxx - sx * sx), a = (sy - b * sx) / sw;
    if (Math.abs(a - fit.a) < 1e-6 && Math.abs(b - fit.b) < 1e-6) { fit = { a, b }; break; }
    fit = { a, b };
  }
  const fam: Record<string, number> = {};
  const sum: Record<string, number> = {}, cnt: Record<string, number> = {};
  points.forEach((pt) => {
    const e = pt.y - fit.a - fit.b * pt.x;
    sum[pt.fam] = (sum[pt.fam] || 0) + Math.max(-2.302585092994046, Math.min(2.302585092994046, e));
    cnt[pt.fam] = (cnt[pt.fam] || 0) + 1;
  });
  Object.keys(sum).sort().forEach((f) => { fam[f] = sum[f] / (cnt[f] + 8); });
  return { a: fit.a, b: fit.b, fam };
}

/** Top-20 kept when one piece of the model is removed. */
function ablationTable(traded: SnapshotProtocol[], rows: { p: SnapshotProtocol }[], asOf: string): { noFamily: number; noPriors: number; huber: number; flat: number } {
  const full = RadarModel.fitCurve(RadarModel.fitPoints(traded, asOf, true), { slope: true, families: true, priors: true });
  const top = (valueFn: (p: SnapshotProtocol) => number): Set<string> =>
    new Set(rows.map((r) => ({ slug: r.p.slug, v: valueFn(r.p) }))
      .sort((x, y) => y.v - x.v || (x.slug < y.slug ? -1 : 1)).slice(0, 20).map((x) => x.slug));
  const base = top((p) => RadarModel.impliedValue(p, full, asOf).value);
  const keep = (s: Set<string>): number => { let n = 0; base.forEach((x) => { if (s.has(x)) n++; }); return n; };
  const noFam = RadarModel.fitCurve(RadarModel.fitPoints(traded, asOf, true), { slope: true, families: false, priors: true });
  const noPri = RadarModel.fitCurve(RadarModel.fitPoints(traded, asOf, false), { slope: true, families: true, priors: false });
  const huber = fitHuber(RadarModel.fitPoints(traded, asOf, true));
  const medR = Math.exp(RadarModel.quantile(traded.map((p) => Math.log((p.mcap_usd ?? 1) / p.tvl_usd)), 0.5));
  return {
    noFamily: keep(top((p) => RadarModel.impliedValue(p, noFam, asOf).value)),
    noPriors: keep(top((p) => Math.exp(noPri.a + noPri.b * Math.log(p.tvl_usd)) * Math.exp(noPri.fam[RadarModel.familyOf(p.category)] || 0))),
    huber: keep(top((p) => RadarModel.impliedValue(p, huber, asOf).value)),
    flat: keep(top((p) => p.tvl_usd * medR)),
  };
}

/** One row of board.json: the ranked board's row, with the model, the band, the peers and the plan. */
interface BoardRow {
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
    family: string;
    family_multiplier: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
    conservative_value_usd: number;
    conservative_factor: number;
  };
  band: { p25_usd: number; p75_usd: number; rank_lo: number; rank_hi: number };
  peers: { slug: string; name: string; tvl_usd: number; mcap_usd: number; multiple: number; implied_value_usd: number }[];
  note: string | null;
  farm_steps: string[];
  farm_net: {
    deposit_usd: number;
    costs_usd: number;
    capital_cost_usd: number;
    total_outlay_usd: number;
    slice_usd: number;
    expected_value_usd: number;
    net_usd: number;
    net_per_hour_usd: number;
    verdict: 'farm' | 'thin' | 'skip';
    break_even_odds_pct: number;
    conservative_odds_pct: number;
    breakeven_value_usd: number;
    chain: string;
    asset: string;
    weeks: number;
    stop_tvl_usd: number;
    stop_drop_pct: number;
    capped: boolean;
  };
  safety: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** A traded protocol: the market's own value against the curve's claim for the same TVL. */
interface TradedRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  multiple: number;
  curve_value_usd: number;
}

/** Everything the dashboard renders, from the snapshot. */
interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  fit: { n: number; intercept: number; slope: number; r2: number; resid_sd: number; conservative_factor: number; median_ratio: number; families: Record<string, number> };
  universe: { ranked: number; traded: number; recorded: number; set_aside: number };
  set_aside: { slug: string; name: string; tvl_usd: number; reason: string }[];
  validation: {
    variants: { key: string; label: string; median_miss: number; mean_log_miss: number; rank_corr: number; within_3x: number }[];
    walk_forward: { cutoff: string; train: number; test: number; median_miss: number; flat_miss: number }[];
    time_split: { train: number; test: number; median_miss: number; flat_miss: number } | null;
    calibration: { p25_75: number; p10_90: number };
    tenure: { label: string; total: number; has_token: number; share: number }[];
    ablation: { noFamily: number; noPriors: number; huber: number; flat: number };
    rank_moves_5: number;
    rank_moves_10: number;
  };
  verdicts: { farm: number; thin: number; skip: number };
  watchlist_size: number;
  board_size: number;
  live_size: number;
  rows: BoardRow[];
  traded: TradedRow[];
  live: LiveRow[];
  snapshot: Snapshot;
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
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
function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const result = RadarModel.buildRadar(snapshot);

// R-squared of the prior-adjusted fit, for the dashboard's method section.
const fitPts = RadarModel.fitPoints(result.universe.traded, snapshot.as_of, true);
let meanY = 0;
for (const pt of fitPts) meanY += pt.y;
meanY /= fitPts.length;
let ssr = 0, sst = 0;
for (const pt of fitPts) {
  const pred = RadarModel.predictLog(result.fit, pt.x, pt.fam);
  ssr += (pt.y - pred) ** 2;
  sst += (pt.y - meanY) ** 2;
}
const r2 = sst === 0 ? 0 : 1 - ssr / sst;

// Median market-cap-to-TVL ratio of the traded comparables, for the dashboard.
const tradedRatios = result.universe.traded
  .map((p) => (p as { mcap_usd: number; tvl_usd: number }).mcap_usd / (p as { tvl_usd: number }).tvl_usd)
  .sort((a, b) => a - b);
const medianRatio = tradedRatios.length > 0 ? tradedRatios[Math.floor(tradedRatios.length / 2)]! : 0;

const board: BoardRow[] = result.rows.map((row) => {
  const p = row.p;
  const plan = row.plan;
  const totalOutlay = plan.deposit + plan.costs + plan.capitalCost;
  const hasStep = (kind: string) => plan.steps.some((s: { kind: string }) => s.kind === kind);
  const safety = [
    'Open it from its DefiLlama listing on day 0 and bookmark that domain.',
    hasStep('kyc')
      ? 'This protocol asks for KYC — allow 1 to 3 days before you deposit.'
      : 'Check its terms allow users in your country before you deposit.',
    'Exit waits: ' + plan.exitWait + (hasStep('unbond') ? ' — start unbonding 14 days before the exit.' : ''),
    'If a token launches, claim only through the domain bookmarked on day 0, never through a link sent to you.',
  ];
  return {
    rank: row.rank,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token',
    age_days: row.iv.days,
    implied_value_usd: row.iv.value,
    model: {
      curve_intercept: round4(result.fit.a),
      curve_slope: round4(result.fit.b),
      curve_value_usd: Math.round(row.iv.base),
      family: row.iv.fam,
      family_multiplier: round4(row.iv.famMult),
      growth_multiplier: round4(row.iv.growth),
      maturity_multiplier: round4(row.iv.season),
      age_days: row.iv.days,
      conservative_value_usd: row.consValue,
      conservative_factor: round4(row.consFactor),
    },
    band: { p25_usd: row.band.p25, p75_usd: row.band.p75, rank_lo: row.band.rankLo, rank_hi: row.band.rankHi },
    peers: row.peers.map((peer) => ({
      slug: peer.slug,
      name: peer.name,
      tvl_usd: peer.tvl_usd,
      mcap_usd: peer.mcap_usd,
      multiple: round4(peer.multiple),
      implied_value_usd: peer.implied,
    })),
    note: row.note,
    farm_steps: plan.steps.map((s) => RadarModel.stepText(s)),
    farm_net: {
      deposit_usd: plan.deposit,
      costs_usd: Math.round(plan.costs * 100) / 100,
      capital_cost_usd: Math.round(plan.capitalCost * 100) / 100,
      total_outlay_usd: Math.round(totalOutlay * 100) / 100,
      slice_usd: Math.round(plan.slice * 100) / 100,
      expected_value_usd: Math.round(plan.slice * 100) / 100,
      net_usd: Math.round(plan.net * 100) / 100,
      net_per_hour_usd: Math.round((plan.net / Math.max(1, plan.minutes / 60)) * 100) / 100,
      verdict: plan.verdict,
      break_even_odds_pct: plan.odds,
      conservative_odds_pct: row.consOdds,
      breakeven_value_usd: Math.round(plan.breakevenValue),
      chain: plan.chain,
      asset: plan.asset,
      weeks: plan.weeks,
      stop_tvl_usd: Math.round(plan.stopTvl),
      stop_drop_pct: plan.drop,
      capped: plan.capped,
    },
    safety,
  };
});

const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

const traded: TradedRow[] = result.universe.traded
  .filter((p) => (p as { mcap_usd: number | null }).mcap_usd !== null)
  .sort((a, b) => ((b as { mcap_usd: number }).mcap_usd ?? 0) - ((a as { mcap_usd: number }).mcap_usd ?? 0))
  .map((p) => {
    const mcap = (p as { mcap_usd: number }).mcap_usd;
    return {
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: mcap,
      change_7d: p.change_7d,
      multiple: round4(mcap / p.tvl_usd),
      curve_value_usd: RadarModel.impliedValue(p, result.fit, snapshot.as_of).value,
    };
  });

const live: LiveRow[] = snapshot.protocols
  .filter((p) => RadarModel.tokenStatus(p) === 'trades' && p.category !== 'CEX')
  .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
  .slice(0, 24)
  .map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd,
    change_7d: p.change_7d,
  }));

const verdicts = { farm: 0, thin: 0, skip: 0 };
for (const row of board) verdicts[row.farm_net.verdict]++;

const radar: RadarData = {
  as_of: snapshot.as_of,
  source: snapshot.source,
  floor_usd: snapshot.floor_usd,
  model_version: RadarModel.MODEL.version,
  fit: {
    n: result.fit.n,
    intercept: round4(result.fit.a),
    slope: round4(result.fit.b),
    r2: round4(r2),
    resid_sd: round4(result.residSd),
    conservative_factor: round4(result.consFactor),
    median_ratio: round4(medianRatio),
    families: Object.fromEntries(Object.entries(result.fit.fam).map(([k, v]) => [k, round4(v as number)])),
  },
  universe: {
    ranked: result.universe.ranked.length,
    traded: result.universe.traded.length,
    recorded: result.universe.recorded,
    set_aside: result.universe.setAside.length,
  },
  set_aside: result.universe.setAside.map((s) => ({ slug: s.slug, name: s.name, tvl_usd: s.tvl_usd, reason: s.reason })),
  validation: {
    variants: result.loo.map((v) => ({
      key: v.key,
      label: v.label,
      median_miss: round4(v.medianMiss),
      mean_log_miss: round4(v.meanLogMiss),
      rank_corr: round4(v.rankCorr),
      within_3x: round4(v.within3x),
    })),
    walk_forward: result.walkForward.map((w) => ({
      cutoff: w.cutoff,
      train: w.train,
      test: w.test,
      median_miss: round4(w.medianMiss),
      flat_miss: round4(w.flatMiss),
    })),
    time_split: result.timeSplit
      ? {
          train: result.timeSplit.train,
          test: result.timeSplit.test,
          median_miss: round4(result.timeSplit.medianMiss),
          flat_miss: round4(result.timeSplit.flatMiss),
        }
      : null,
    calibration: (() => { const c = bandCalibration(result.universe.traded, snapshot.as_of); return { p25_75: round4(c.p25_75), p10_90: round4(c.p10_90) }; })(),
    tenure: tenureTable(snapshot, snapshot.as_of).map((t) => ({ label: t.label, total: t.total, has_token: t.has_token, share: round4(t.share) })),
    ablation: ablationTable(result.universe.traded, result.rows, snapshot.as_of),
    rank_moves_5: result.moves.five,
    rank_moves_10: result.moves.ten,
  },
  verdicts,
  watchlist_size: snapshot.watchlist.length,
  board_size: board.length,
  live_size: live.length,
  rows: board,
  traded,
  live,
  snapshot,
};

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${result.universe.setAside.length} set aside, ${live.length} live set aside)\n` +
    `token radar: comps fit on ${result.fit.n} protocols: ln(mcap) = ${round4(result.fit.a)} + ${round4(result.fit.b)} * ln(tvl), R2 ${round4(r2)}, resid sd ${round4(result.residSd)}\n` +
    `token radar: verdicts ${verdicts.farm} farm / ${verdicts.thin} thin / ${verdicts.skip} skip\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (4 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
