/* Launch Radar v3 model: snapshot in, board out. main.ts and the page both run buildRadar.
 * Value = exp(a + b * ln(TVL)) * family * growth * seasoning, fitted to the snapshot's own
 * traded tokens (tilts removed before the fit, applied back after). The verdict never guesses
 * a launch chance: the farm plan costs the whole timeline, and the break-even odds are the
 * chance that would pay it (farm <= 10%, thin <= 25%, else skip). */
(function (root) {
  'use strict';

  var MODEL = {
    version: 'radar-v3',
    familyShrinkK: 8, // pseudo-tokens pulling each family offset toward zero
    familyCapLn: 2.302585092994046, // ln(10): no family offset may exceed 10x either way
    growthWeight: 0.5,
    growthFloor: -60,
    growthCap: 120,
    maturityFloor: 0.6, // a new protocol is worth 0.6x, rising to 1.0x over three years
    maturityRange: 0.4,
    maturityDays: 1095,
    unknownAgeDays: 365,
    bootstrapRuns: 200,
    seed: 20261114, // the bootstrap draws the same numbers on every run
  };

  // Farm-plan assumptions (the snapshot has no gas, fee or yield figures).
  var ASSUME = {
    tbillRate: 0.04, // a year: what the capital would earn instead
    depositYield: { lend: 0.03, vault: 0.03, rwa: 0.035, stake: 0.03, trade: 0.02 },
    airdropShare: 0.1, // of a launched token's value, paid to depositors pro rata to TVL
    farmOdds: 0.1, // worth farming if it pays when 1 hold in 10 sees a launch
    marginalOdds: 0.25, // marginal up to 1 in 4
    bridgeFee: 1, // USD per bridge leg
    depositPerTvl: 1 / 10000,
    depositMin: 500,
    depositMax: 5000,
    capDrop: -30, // a 7-day TVL fall past -30% caps the verdict at thin
    gasDefault: 0.5, // a chain missing from the tiers below
    gas: {},
  };
  // Gas in USD per transaction, by tier: round estimates, not quotes.
  var GAS_TIERS = [[3, 'Ethereum'], [2.5, 'Bitcoin'], [1, 'Tron'], [0.2, 'Cardano'],
    [0.1, 'Arbitrum|Avalanche|Linea|Scroll|Starknet|Hyperliquid L1|zkSync Era|BSquared|Mezo'],
    [0.08, 'Optimism|Binance'],
    [0.05, 'Base|Monad|Sonic|Mantle|Berachain|Plasma|Ink|Unichain|Flare|TON|Fantom|Katana|Robinhood Chain|X Layer|Pharos|Plume Mainnet|Morph|Etherlink|Fraxtal|Noble|Bittensor|CORE'],
    [0.03, 'Polygon'], [0.02, 'Sui|Aptos|Near'],
    [0.01, 'Solana|Stellar|Algorand|Ripple|xDai|Celo|Arc|Stable']];
  for (var gi = 0; gi < GAS_TIERS.length; gi++) {
    var tier = GAS_TIERS[gi];
    var names = tier[1].split('|');
    for (var ni = 0; ni < names.length; ni++) ASSUME.gas[names[ni]] = tier[0];
  }

  var cmp = function (a, b) { return a < b ? -1 : a > b ? 1 : 0; };
  var clamp = function (x, lo, hi) { return Math.min(hi, Math.max(lo, x)); };

  function quantile(values, q) {
    var s = values.slice().sort(function (a, b) { return a - b; });
    var at = (s.length - 1) * q, lo = Math.floor(at);
    return lo + 1 < s.length ? s[lo] + (s[lo + 1] - s[lo]) * (at - lo) : s[lo];
  }

  function mulberry32(seed) {
    var t = seed >>> 0;
    return function () {
      t = (t + 0x6d2b79f5) >>> 0;
      var r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function usd(n) {
    var a = Math.abs(n), sign = n < 0 ? '-' : '';
    if (a >= 1e9) return sign + '$' + (a / 1e9).toFixed(a >= 1e10 ? 1 : 2) + 'B';
    if (a >= 1e6) return sign + '$' + (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e4) return sign + '$' + (a / 1e3).toFixed(0) + 'K';
    if (a >= 10) return sign + '$' + String(Math.round(a)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return sign + '$' + a.toFixed(2);
  }

  function daysSince(listedAt, asOf) {
    if (!listedAt) return null;
    return Math.max(0, Math.round((Date.parse(asOf + 'T00:00:00Z') - Date.parse(listedAt + 'T00:00:00Z')) / 86400000));
  }

  // -- families and the universe

  var FAMILY_OF = {};
  var FAMILY_DEFS = {
    lend: 'Lending|CDP|CDP Manager|Uncollateralized Lending|Collateral Markets|Collateral Management',
    trade: 'Dexs|Derivatives|Options|Prediction Market|Interest Rate Derivatives|Synthetics|OTC Marketplace|NFT Marketplace|Launchpad',
    vault: 'Yield|Yield Aggregator|Risk Curators|Onchain Capital Allocator|Liquidity Manager|Leveraged Farming|Farm|Indexes|Options Vault|Basis Trading',
    rwa: 'RWA|Stablecoin Wrapper|Dual-Token Stablecoin|Algo-Stables|Stablecoin Issuer|Reserve Currency|CeDeFi',
    stake: 'Liquid Staking|Restaking|Staking Pool|Liquid Restaking|Restaked BTC|Anchor BTC|Decentralized BTC',
    infra: 'Bridge|Canonical Bridge|Cross Chain Bridge|Chain|Payments|Privacy|AI Agents|Decentralized AI|Crypto Card Issuer|Insurance',
    cex: 'CEX',
  };
  Object.keys(FAMILY_DEFS).forEach(function (fam) {
    FAMILY_DEFS[fam].split('|').forEach(function (c) { FAMILY_OF[c] = fam; });
  });
  var FAMILY_LABEL = { lend: 'Lending & CDP', trade: 'Trading', vault: 'Vaults & yield', rwa: 'RWA & stables', stake: 'Staking', infra: 'Infra & chains', cex: 'Exchanges', other: 'Other' };
  var familyOf = function (category) { return FAMILY_OF[category] || 'other'; };

  // Watchlist rule minus the $50M floor: each class is a product of a token that trades.
  var PRODUCT_CATEGORIES = ['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']; // bridged or staked coins
  var VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/; // a release of an older protocol
  var WRAP_WORD = /\b(wrapped|staked|staking)\b/i; // a wrapped or staked coin
  var EXCHANGES = ['binance', 'coinbase', 'bybit', 'kraken', 'bitget', 'okx', 'bitfinex', 'gemini']; // an exchange's own product
  var CHAIN_VENUE = /^\S+ (DEX|AMM)$/i; // named for its chain, whose coin may be its token
  var GENERIC_WORDS = 'the liquid btc eth usd yield finance protocol network capital labs dao earn vault vaults lending dex bridge pool project stake native super open one prime'.split(' ');
  var firstWord = function (s) { return (s.toLowerCase().split(/[^a-z0-9.]+/).filter(Boolean)[0] || ''); };

  /** trades (a market cap), recorded (a token but no market cap) or none (records no token). */
  function tokenStatus(p) {
    if (p.mcap_usd !== null && p.mcap_usd > 0) return 'trades';
    if (p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null) return 'recorded';
    return 'none';
  }

  function nameStem(name, generic) {
    var w = firstWord(name).replace(/\.(fi|io|xyz|money|finance)$/, '');
    return w.length >= 3 && !generic.has(w) ? w : null;
  }

  /** Why a no-token protocol is kept off the ranks; null for a launch still to come. */
  function setAsideReason(p, stems, generic) {
    if (PRODUCT_CATEGORIES.indexOf(p.category) >= 0) return p.category + ': usually a product of a traded token';
    if (VERSIONED.test(p.name)) return 'versioned name: a release of another protocol';
    if (WRAP_WORD.test(p.name)) return 'wrapped or staked product';
    if (EXCHANGES.indexOf(firstWord(p.name)) >= 0) return "starts with an exchange's name";
    return null;
  }
  /** A warning, not a set-aside: ranked, but the name may point at a token that trades. */
  function warnReason(p, stems, generic) {
    var stem = nameStem(p.name, generic);
    if (stem && stems.has(stem)) return 'shares its name with ' + stems.get(stem) + ', which records a token; ranked: no token recorded for it';
    if (CHAIN_VENUE.test(p.name) || p.chains.some(function (c) { return firstWord(c) === firstWord(p.name); })) return 'named for its chain, whose coin may be its token; ranked: no token recorded for it';
    return null;
  }

  function selectUniverse(snap) {
    var watch = new Set(snap.watchlist);
    var generic = new Set(GENERIC_WORDS);
    snap.protocols.forEach(function (p) { p.chains.forEach(function (c) { generic.add(firstWord(c)); }); });
    var stems = new Map();
    snap.protocols.forEach(function (p) {
      var s = tokenStatus(p) !== 'none' ? nameStem(p.name, generic) : null;
      if (s && !stems.has(s)) stems.set(s, p.name);
    });
    var ranked = [], traded = [], setAside = [], recorded = 0;
    snap.protocols.forEach(function (p) {
      var status = tokenStatus(p);
      if (status === 'trades') traded.push(p);
      else if (status === 'recorded') recorded++;
      else {
        var on = watch.has(p.slug), why = setAsideReason(p, stems, generic);
        var warn = why === null ? warnReason(p, stems, generic) : null;
        var parent = !why && !on && p.tvl_usd >= snap.floor_usd
          ? 'above the ' + usd(snap.floor_usd) + ' floor yet off the house watchlist (filed under a parent)'
          : null;
        if (why === null || on) ranked.push({ p: p, watch: on, note: warn || why || parent });
        else setAside.push({ slug: p.slug, name: p.name, tvl_usd: p.tvl_usd, reason: why });
      }
    });
    return { ranked: ranked, traded: traded, setAside: setAside, recorded: recorded };
  }

  // -- the fit

  function growthTilt(change7d) {
    var g = change7d === null ? 0 : clamp(change7d, MODEL.growthFloor, MODEL.growthCap);
    return 1 + (g / 100) * MODEL.growthWeight;
  }
  function seasonTilt(days) {
    var d = days === null ? MODEL.unknownAgeDays : days;
    return MODEL.maturityFloor + (Math.min(Math.max(d, 0), MODEL.maturityDays) / MODEL.maturityDays) * MODEL.maturityRange;
  }
  function priorLog(p, asOf) {
    return Math.log(growthTilt(p.change_7d) * seasonTilt(daysSince(p.listed_at, asOf)));
  }

  var FULL = { slope: true, families: true, priors: true };

  function fitPoints(traded, asOf, priors) {
    return traded.map(function (p) {
      var prior = priors ? priorLog(p, asOf) : 0;
      return { slug: p.slug, x: Math.log(p.tvl_usd), y: Math.log(p.mcap_usd) - prior, prior: prior, fam: familyOf(p.category) };
    });
  }

  // Least squares y = a + b*x, then shrunk family means of the misses.
  function fitCurve(points, opts) {
    var n = points.length, mx = 0, my = 0, i;
    for (i = 0; i < n; i++) { mx += points[i].x; my += points[i].y; }
    mx /= n; my /= n;
    var b = 1;
    if (opts.slope) {
      var sxy = 0, sxx = 0;
      for (i = 0; i < n; i++) { sxy += (points[i].x - mx) * (points[i].y - my); sxx += (points[i].x - mx) * (points[i].x - mx); }
      if (sxx > 0) b = sxy / sxx;
    }
    var a = my - b * mx;
    var fam = {};
    if (opts.families) {
      var sum = {}, count = {};
      for (i = 0; i < n; i++) {
        var pt = points[i];
        sum[pt.fam] = (sum[pt.fam] || 0) + clamp(pt.y - a - b * pt.x, -MODEL.familyCapLn, MODEL.familyCapLn);
        count[pt.fam] = (count[pt.fam] || 0) + 1;
      }
      Object.keys(sum).sort().forEach(function (f) { fam[f] = sum[f] / (count[f] + MODEL.familyShrinkK); });
    }
    return { a: a, b: b, fam: fam, n: n };
  }

  var predictLog = function (fit, x, fam) { return fit.a + fit.b * x + (fit.fam[fam] || 0); };

  function impliedValue(p, fit, asOf) {
    var days = daysSince(p.listed_at, asOf);
    var fam = familyOf(p.category);
    var base = Math.exp(fit.a + fit.b * Math.log(p.tvl_usd));
    var famMult = Math.exp(fit.fam[fam] || 0);
    var growth = growthTilt(p.change_7d);
    var season = seasonTilt(days);
    return { value: Math.max(1, Math.round(base * famMult * growth * season)), base: base, famMult: famMult, growth: growth, season: season, days: days, fam: fam };
  }

  function conservativeFactor(residSd) { return Math.exp(-0.674 * residSd); }

  // -- honesty: out-of-sample checks and the bootstrap

  var VARIANTS = [
    ['multiple', 'TVL x one multiple', 0, 0, 0],
    ['curve', '+ size curve (slope b)', 1, 0, 0],
    ['family', '+ category family', 1, 1, 0],
    ['full', '+ growth & seasoning priors', 1, 1, 1],
  ].map(function (v) { return { key: v[0], label: v[1], slope: !!v[2], families: !!v[3], priors: !!v[4] }; });

  function spearman(a, b) {
    var ranks = function (v) {
      var r = [];
      v.map(function (x, i) { return i; }).sort(function (i, j) { return v[i] - v[j]; }).forEach(function (i, k) { r[i] = k; });
      return r;
    };
    var ra = ranks(a), rb = ranks(b), n = a.length, s = 0;
    for (var i = 0; i < n; i++) s += (ra[i] - rb[i]) * (ra[i] - rb[i]);
    return 1 - (6 * s) / (n * (n * n - 1));
  }

  // Each traded token priced by a fit that never saw it, per variant.
  function looCheck(traded, asOf) {
    return VARIANTS.map(function (v) {
      var pts = fitPoints(traded, asOf, v.priors);
      var medRatio = Math.exp(quantile(traded.map(function (p) { return Math.log(p.mcap_usd / p.tvl_usd); }), 0.5));
      var miss = pts.map(function (pt, i) {
        var fit = fitCurve(pts.filter(function (_, j) { return j !== i; }), v);
        var pred = v.slope ? predictLog(fit, pt.x, pt.fam) : Math.log(medRatio) + pt.x;
        return Math.abs((pt.y + pt.prior) - (pred + pt.prior));
      });
      // The ranking out of sample: Spearman's rho in 8 fixed folds, averaged.
      var rankCorr = 0;
      for (var f = 0; f < 8; f++) {
        var fit = fitCurve(pts.filter(function (_, j) { return j % 8 !== f; }), v);
        var held = pts.filter(function (_, j) { return j % 8 === f; });
        rankCorr += spearman(
          held.map(function (pt) { return (v.slope ? predictLog(fit, pt.x, pt.fam) : Math.log(medRatio) + pt.x) + pt.prior; }),
          held.map(function (pt) { return pt.y + pt.prior; })
        ) / 8;
      }
      return {
        rankCorr: rankCorr, key: v.key, label: v.label, n: pts.length,
        medianMiss: Math.exp(quantile(miss, 0.5)),
        meanLogMiss: miss.reduce(function (s, m) { return s + m; }, 0) / miss.length,
        within3x: miss.filter(function (m) { return m <= Math.log(3); }).length / miss.length,
      };
    });
  }

  /** One walk-forward origin: fit on train, test on later tokens. The flat multiple is
   * fitted on the train set only — it never sees the test set. Target: mcap at snapshot. */
  function wfRow(train, test, asOf, label) {
    var fit = fitCurve(fitPoints(train, asOf, true), FULL);
    var miss = test.map(function (p) {
      return Math.abs(Math.log(p.mcap_usd) - (predictLog(fit, Math.log(p.tvl_usd), familyOf(p.category)) + priorLog(p, asOf)));
    });
    var flatMed = Math.exp(quantile(train.map(function (p) { return Math.log(p.mcap_usd / p.tvl_usd); }), 0.5));
    var flat = test.map(function (p) { return Math.abs(Math.log(p.mcap_usd) - (Math.log(p.tvl_usd) + Math.log(flatMed))); });
    return { cutoff: label, train: train.length, test: test.length,
      medianMiss: Math.exp(quantile(miss, 0.5)), flatMiss: Math.exp(quantile(flat, 0.5)) };
  }
  /** Walk-forward: fit on tokens listed before T, test on tokens listed after T. */
  function walkForward(traded, asOf) {
    var dated = traded.filter(function (p) { return p.listed_at; })
      .map(function (p) { return { p: p, t: Date.parse(p.listed_at) }; })
      .sort(function (a, b) { return a.t - b.t; });
    if (dated.length < 8) return [];
    return [0.2, 0.35, 0.5, 0.65, 0.8].map(function (q) {
      var ci = Math.floor(dated.length * q);
      return wfRow(dated.slice(0, ci).map(function (d) { return d.p; }), dated.slice(ci).map(function (d) { return d.p; }), asOf,
        new Date(dated[ci].t).toISOString().slice(0, 10));
    });
  }
  /** Time-split: the 35 oldest dated tokens train, the 35 newest test. */
  function timeSplit(traded, asOf) {
    var dated = traded.filter(function (p) { return p.listed_at; })
      .map(function (p) { return { p: p, t: Date.parse(p.listed_at) }; })
      .sort(function (a, b) { return a.t - b.t; });
    if (dated.length < 70) return null;
    var r = wfRow(dated.slice(0, 35).map(function (d) { return d.p; }), dated.slice(-35).map(function (d) { return d.p; }), asOf, '35 oldest / 35 newest');
    return { train: r.train, test: r.test, medianMiss: r.medianMiss, flatMiss: r.flatMiss };
  }

  // 200 seeded refits: band P25-P75, rank range P10-P90.
  function bootstrapRanks(traded, rows, asOf, runs, seed) {
    var pts = fitPoints(traded, asOf, true);
    var full = fitCurve(pts, FULL);
    var resid = pts.map(function (pt) { return pt.y - predictLog(full, pt.x, pt.fam); });
    var rand = mulberry32(seed);
    var draws = rows.map(function () { return []; }), ranks = rows.map(function () { return []; });
    for (var r = 0; r < runs; r++) {
      var sample = pts.map(function () { return pts[Math.floor(rand() * pts.length)]; });
      var fit = fitCurve(sample, FULL);
      var vals = rows.map(function (p) { return impliedValue(p, fit, asOf).value; });
      vals.map(function (v, i) { return i; })
        .sort(function (i, j) { return vals[j] - vals[i] || cmp(rows[i].slug, rows[j].slug); })
        .forEach(function (i, k) { ranks[i].push(k + 1); });
      vals.forEach(function (v, i) { draws[i].push(v * Math.exp(resid[Math.floor(rand() * resid.length)])); });
    }
    return rows.map(function (p, i) {
      return {
        p25: Math.round(quantile(draws[i], 0.25)), p75: Math.round(quantile(draws[i], 0.75)),
        rankLo: Math.round(quantile(ranks[i], 0.1)), rankHi: Math.round(quantile(ranks[i], 0.9)),
      };
    });
  }

  /** Same-family traded peers nearest in TVL, within 10x of the curve. */
  function nearestPeers(p, traded, k, fit, asOf) {
    var fam = familyOf(p.category), x = Math.log(p.tvl_usd);
    var typical = traded.filter(function (t) { return Math.abs(Math.log(t.mcap_usd / impliedValue(t, fit, asOf).value)) <= Math.LN10; });
    var same = typical.filter(function (t) { return familyOf(t.category) === fam; });
    return (same.length >= k ? same : typical)
      .map(function (t) { return { t: t, d: Math.abs(Math.log(t.tvl_usd) - x) }; })
      .sort(function (u, v) { return u.d - v.d || cmp(u.t.slug, v.t.slug); })
      .slice(0, k)
      .map(function (o) {
        var t = o.t;
        return { slug: t.slug, name: t.name, tvl_usd: t.tvl_usd, mcap_usd: t.mcap_usd, multiple: t.mcap_usd / t.tvl_usd, implied: Math.round(p.tvl_usd * (t.mcap_usd / t.tvl_usd)) };
      });
  }

  // -- the farm plan

  function gasOn(chain) {
    return Object.prototype.hasOwnProperty.call(ASSUME.gas, chain) ? ASSUME.gas[chain] : ASSUME.gasDefault;
  }
  /** Chains come by TVL: the cheapest of the top three; ties go to the first. */
  function cheapestChain(chains) {
    var best = chains[0] || 'Ethereum';
    chains.slice(0, 3).forEach(function (c) { if (gasOn(c) < gasOn(best)) best = c; });
    return best;
  }
  var holdWeeks = function (days) { return 6 + Math.round(6 * (1 - Math.min(days === null ? MODEL.unknownAgeDays : days, 730) / 730)); };
  var stopDropPct = function (change7d) { return change7d === null ? 20 : clamp(Math.round(2 * Math.abs(change7d)), 10, 35); };
  var roundDeposit = function (x) { return x < 1000 ? Math.round(x / 50) * 50 : Math.round(x / 100) * 100; };

  // Chain labels a reader could take for a company.
  var CHAIN_NAME = { Binance: 'BNB Chain', Ripple: 'XRP Ledger', xDai: 'Gnosis' };
  var chainName = function (c) { return CHAIN_NAME[c] || c; };
  // Chains with no dollar stablecoin, and staking, use the native coin.
  var NATIVE_COIN = { Bitcoin: 'BTC', CORE: 'BTC', BSquared: 'BTC', Mezo: 'BTC', 'Babylon Genesis': 'BTC', Stacks: 'BTC', RSK: 'BTC', Bittensor: 'TAO', Qubic: 'QUBIC' };
  function fundingAsset(p, chain) {
    if (/BTC$/.test(p.category || '')) return 'BTC';
    if (familyOf(p.category) === 'stake') return NATIVE_COIN[chain] || chainName(chain) + "'s native coin";
    return NATIVE_COIN[chain] || 'USDC';
  }
  var STABLES = ['Dual-Token Stablecoin', 'Stablecoin Wrapper', 'Algo-Stables', 'Stablecoin Issuer', 'Reserve Currency'];

  /** The deposit a category takes: what to do, minutes, extra cost, the wait to exit. */
  function depositAction(p, deposit, chain, asset, exitDay) {
    var c = p.category || '', fam = familyOf(c), d = usd(deposit) + ' of ' + asset, n = p.name, on = 'on ' + chainName(chain);
    var swap = deposit * 0.0005;
    var act = function (text, minutes, wait, extra, flag) {
      var o = { text: text, minutes: minutes, wait: wait, extra: extra || 0 };
      if (flag) o[flag] = true;
      return o;
    };
    if (c === 'Dexs') return asset === 'USDC'
      ? act('Add ' + d + " to " + n + "'s deepest stablecoin pool " + on + '; if it takes no outside liquidity, skip it.', 15, 'usually no lock; check the app', swap)
      : act('Add ' + d + " to " + n + "'s deepest " + asset + ' pool ' + on + '; you keep ' + asset + "'s price risk.", 15, 'pool exits can take a day', swap);
    if (c === 'Derivatives' || c === 'Options') return act('Deposit ' + d + " into " + n + "'s liquidity vault " + on + '; it can lose in sharp moves.', 15, 'vault lockups often run 1 to 4 days');
    if (c === 'Prediction Market' || c === 'OTC Marketplace') return act('Fund ' + n + ' ' + on + ' with ' + d + '; post only resting quotes — a filled quote is a position.', 15, 'usually no lock; check the app', 0, 'terms');
    if (c === 'Chain') return act('On ' + n + ', put ' + d + ' into the largest app DefiLlama lists for the chain; if none, the bridged ' + asset + ' is the position.', 25, 'the bridge back can take 7 days');
    if (c === 'Payments') return act('Open a payment channel of ' + d + ' on ' + n + ' and keep it open.', 30, 'a channel close settles on-chain in about an hour');
    if (c === 'Insurance') return act('Provide ' + d + ' of cover capital to ' + n + "'s pool " + on + '; a paid claim draws it down.', 20, 'cover pools often hold capital 7 to 30 days');
    if (c === 'CDP') return act('Swap ' + d + ' for ' + n + "'s stablecoin " + on + ' into its savings pool; open no vault, mint nothing.', 15, 'savings pools usually exit at once', swap);
    if (c === 'Collateral Markets') return act('Deposit ' + d + " into " + n + "'s largest vault that takes it " + on + '; check its withdrawal epoch first.', 20, 'exits wait for the vault epoch, often 7 days');
    if (c === 'Governance Incentives') return act('Deposit ' + d + " into " + n + "'s earn vault " + on + '; take a vote-escrow lock only if it ends before day ' + exitDay + '.', 15, 'locks must end before the exit');
    if (fam === 'lend' && c !== 'CDP Manager') return act('Supply ' + d + " to " + n + "'s main market " + on + ' and do not borrow against it.', 10, 'waits only if the market is fully borrowed');
    if (STABLES.indexOf(c) >= 0) return act('Mint ' + n + "'s stable token with " + d + ' (never its volatile token) and hold it in its savings vault ' + on + '.', 15, 'redeeming to USDC usually settles at once', swap);
    if (fam === 'rwa') return act('Put ' + d + " into " + n + "'s main yield fund " + on + ', after checking its minimum; if it only sells single property or other tokens, skip it.', 20, 'redemptions often settle in 1 to 5 business days', 0, 'kyc');
    if (fam === 'stake') return act('Stake the ' + d + ' through ' + n + '.', 15, 'unbonding follows the chain, often 7 to 21 days', 0, 'unbond');
    if (fam === 'vault' || c === 'CDP Manager') return act('Deposit ' + d + " into " + n + "'s largest " + asset + ' vault ' + on + '; check its withdrawal delay first.', 15, 'vault queues can hold a withdrawal 1 to 7 days');
    return act('Deposit ' + d + ' into ' + n + ' ' + on + ' through its own app.', 15, 'check the app for a lock');
  }

  function farmPlan(p, value, asOf) {
    var days = daysSince(p.listed_at, asOf);
    var chain = cheapestChain(p.chains), cn = chainName(chain);
    var gas = gasOn(chain);
    var weeks = holdWeeks(days), exitDay = weeks * 7;
    var slicePerDollar = (ASSUME.airdropShare * value) / p.tvl_usd;
    var asset = fundingAsset(p, chain);
    var bridge = asset === 'USDC' ? ASSUME.bridgeFee : 0; // a native coin is one you already hold there: no bridge, no buying
    var deposit = clamp(roundDeposit(Math.max(p.tvl_usd * ASSUME.depositPerTvl, (3 * (8 * gas + 2 * bridge)) / Math.max(slicePerDollar, 1e-9))), ASSUME.depositMin, ASSUME.depositMax);
    var drop = stopDropPct(p.change_7d);
    var stopTvl = p.tvl_usd * (1 - drop / 100);
    var act = depositAction(p, deposit, chain, asset, exitDay);
    var d0 = act.kyc ? 3 : 0;
    var steps = [
      { day: 0, kind: 'verify', text: 'Open ' + p.name + ' from its DefiLlama listing, bookmark that domain, and read its docs.', cost: 0, minutes: 20 },
      act.kyc ? { day: 0, kind: 'kyc', text: 'Pass ' + p.name + "'s KYC if it asks; allow 1 to 3 days before you deposit.", cost: 0, minutes: 30 } : null,
      act.terms ? { day: 0, kind: 'terms', text: 'Confirm ' + p.name + "'s terms allow your country; if not, stop here.", cost: 0, minutes: 10 } : null,
      { day: d0, kind: 'fund', text: bridge ? 'Move ' + usd(deposit) + ' of ' + asset + ' and about ' + usd(10 * gas) + ' of gas to your one wallet on ' + cn + (p.chains.length > 1 ? ', the cheapest of its top ' + Math.min(3, p.chains.length) + ' chains' : '') + '.' : 'Use ' + usd(deposit) + ' of ' + asset + ' you already hold (do not buy it), plus ' + usd(10 * gas) + ' of gas, in your one wallet on ' + cn + '; it keeps ' + asset + "'s price risk.", cost: bridge + gas, minutes: 15 },
      { day: d0, kind: 'deposit', text: act.text, cost: 2 * gas + act.extra, minutes: act.minutes },
      { day: d0 + 1, kind: 'record', text: 'Check the ' + usd(deposit) + ' position shows in ' + p.name + "'s app on " + cn + '; log the hash, date and amount.', cost: 0, minutes: 5 },
      { day: 7, kind: 'watch', text: 'Weekly, check its TVL on DefiLlama against the stop level ' + usd(stopTvl) + ' (' + drop + '% under today\'s ' + usd(p.tvl_usd) + ').', cost: 0, minutes: 5 * weeks, every: 7 },
      { day: Math.round(exitDay / 2), kind: 'recheck', text: 'Midway, re-read the rewards page; do any qualifying action it names once (a lock only if it ends by day ' + exitDay + ').', cost: gas, minutes: 10 },
      { day: null, kind: 'stop', text: 'If TVL closes below ' + usd(stopTvl) + ' or withdrawals pause, withdraw at once.', cost: gas + bridge, minutes: 15 },
      act.unbond ? { day: exitDay - 14, kind: 'unbond', text: 'Start unbonding on day ' + (exitDay - 14) + ' so the coin is free by day ' + exitDay + '.', cost: gas, minutes: 10 } : null,
      { day: exitDay, kind: 'exit', text: 'After ' + weeks + ' weeks, withdraw the ' + usd(deposit) + ' (' + act.wait + ')' + (bridge ? ' and move it back off ' + cn : '') + '.', cost: gas + bridge, minutes: 15 },
      { day: exitDay, kind: 'claim', text: 'If a token launches, claim only through the domain bookmarked on day 0, never through a link sent to you.', cost: gas, minutes: 10 },
    ].filter(Boolean);
    var counted = steps.filter(function (s) { return s.kind !== 'stop'; });
    var costs = counted.reduce(function (sum, s) { return sum + s.cost; }, 0);
    var minutes = counted.reduce(function (sum, s) { return sum + s.minutes; }, 0);
    var carry = Math.max(0, ASSUME.tbillRate - (ASSUME.depositYield[familyOf(p.category)] || 0));
    var capitalCost = (deposit * carry * exitDay) / 365;
    var slice = slicePerDollar * deposit;
    var net = slice - costs - capitalCost;
    var breakEven = (costs + capitalCost) / slice;
    var odds = Math.round(breakEven * 100); // the verdict reads the odds as shown
    var byOdds = odds <= ASSUME.farmOdds * 100 ? 'farm' : odds <= ASSUME.marginalOdds * 100 ? 'thin' : 'skip';
    var capped = byOdds === 'farm' && p.change_7d !== null && p.change_7d < ASSUME.capDrop; // no 7-day figure never caps
    var verdict = capped ? 'thin' : byOdds;
    return { chain: cn, gas: gas, asset: asset, deposit: deposit, weeks: weeks, drop: drop, stopTvl: stopTvl, exitWait: act.wait, steps: steps, costs: costs, minutes: minutes, carry: carry, capitalCost: capitalCost, slice: slice, net: net, breakEven: breakEven, verdict: verdict, capped: capped, odds: odds, breakevenValue: (costs + capitalCost) / slicePerDollar };
  }

  var VERDICT_LABEL = { farm: 'Worth farming', thin: 'Thin', skip: 'Skip' };

  function oddsText(plan, value) {
    return plan.breakEven > 1
      ? 'no launch chance covers it (it would need a launch worth ' + usd(value * plan.breakEven) + ')'
      : 'the chance a token launches with a snapshot inside the ' + plan.weeks + '-week hold';
  }

  function stepText(step) {
    var s = (step.day === null ? 'Stop rule: ' : 'Day ' + step.day + ': ') + step.text + ' Cost: ' + (step.cost === 0 ? 'no fee' : usd(step.cost)) + '. Time: ' + step.minutes + ' minutes.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + ' Hold the position and check its own page.';
    return s;
  }

  function buildRadar(snap) {
    var u = selectUniverse(snap);
    var fit = fitCurve(fitPoints(u.traded, snap.as_of, true), FULL);
    var pts = fitPoints(u.traded, snap.as_of, true);
    var ssr = pts.reduce(function (s, pt) { var e = pt.y - predictLog(fit, pt.x, pt.fam); return s + e * e; }, 0);
    var residSd = Math.sqrt(ssr / Math.max(1, pts.length - 2));
    var consFactor = conservativeFactor(residSd);
    var scored = u.ranked.map(function (r) { return { r: r, iv: impliedValue(r.p, fit, snap.as_of) }; });
    scored.sort(function (x, y) { return y.iv.value - x.iv.value || cmp(x.r.p.slug, y.r.p.slug); });
    var boot = bootstrapRanks(u.traded, scored.map(function (s) { return s.r.p; }), snap.as_of, MODEL.bootstrapRuns, MODEL.seed);
    var rows = scored.map(function (s, i) {
      var consValue = Math.max(1, Math.round(s.iv.value * consFactor));
      var plan = farmPlan(s.r.p, s.iv.value, snap.as_of);
      var consPlan = farmPlan(s.r.p, consValue, snap.as_of);
      return {
        rank: i + 1, p: s.r.p, watch: s.r.watch, note: s.r.note, iv: s.iv, band: boot[i],
        consValue: consValue, consFactor: consFactor,
        consOdds: consPlan.odds, consMultiple: consPlan.slice / Math.max(1, consPlan.costs + consPlan.capitalCost),
        peers: nearestPeers(s.r.p, u.traded, 3, fit, snap.as_of), plan: plan,
      };
    });
    var plain = scored.map(function (s, i) { return [s.iv.value / (s.iv.growth * s.iv.season), i]; }).sort(function (x, y) { return y[0] - x[0] || x[1] - y[1]; });
    var moved = function (n) { return plain.filter(function (pair, k) { return Math.abs(k - pair[1]) >= n; }).length; };
    return {
      universe: u, fit: fit, residSd: residSd, consFactor: consFactor, rows: rows,
      loo: looCheck(u.traded, snap.as_of), walkForward: walkForward(u.traded, snap.as_of),
      timeSplit: timeSplit(u.traded, snap.as_of),
      moves: { five: moved(5), ten: moved(10) },
    };
  }

  var api = {
    MODEL: MODEL, ASSUME: ASSUME, FAMILY_LABEL: FAMILY_LABEL, VERDICT_LABEL: VERDICT_LABEL, VARIANTS: VARIANTS,
    usd: usd, quantile: quantile, mulberry32: mulberry32, daysSince: daysSince, familyOf: familyOf,
    tokenStatus: tokenStatus, nameStem: nameStem, selectUniverse: selectUniverse,
    growthTilt: growthTilt, seasonTilt: seasonTilt, fitPoints: fitPoints, fitCurve: fitCurve,
    predictLog: predictLog, impliedValue: impliedValue, conservativeFactor: conservativeFactor,
    looCheck: looCheck, walkForward: walkForward, bootstrapRanks: bootstrapRanks, timeSplit: timeSplit,
    warnReason: warnReason,
    nearestPeers: nearestPeers, cheapestChain: cheapestChain, gasOn: gasOn, chainName: chainName,
    farmPlan: farmPlan, oddsText: oddsText, stepText: stepText, buildRadar: buildRadar,
  };
  root.RadarModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
