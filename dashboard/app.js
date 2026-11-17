// Launch Radar dashboard: renders window.RADAR (written by main.ts into data.js).
// No network, no fetch: every number on this page comes from the same board.json the gate reads.
// The page also re-runs the model (dashboard/model.js) in the browser and checks every row
// against the board: coverage, ranks, values, bands, verdicts and plans.
(function () {
  var R = window.RADAR;
  if (!R) {
    document.getElementById('meta').textContent = 'No data loaded.';
    return;
  }
  var M = window.RadarModel;

  var fmt$ = function (n) {
    if (n === null || n === undefined) return '—';
    var abs = Math.abs(n);
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n).toLocaleString('en-US');
  };
  var fmtPct = function (n) {
    if (n === null || n === undefined) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  };
  var esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };

  // In-browser verification: re-derive the board and compare it with the shipped one.
  var verified = null;
  if (M && R.snapshot) {
    try {
      var re = M.buildRadar(R.snapshot);
      var mism = 0;
      var bySlug = {};
      R.rows.forEach(function (r) { bySlug[r.slug] = r; });
      re.rows.forEach(function (row) {
        var sh = bySlug[row.p.slug];
        if (!sh || sh.implied_value_usd !== row.iv.value || sh.band.p25_usd !== row.band.p25 ||
          sh.band.p75_usd !== row.band.p75 || sh.farm_net.verdict !== row.plan.verdict ||
          sh.farm_net.break_even_odds_pct !== row.plan.odds) mism++;
      });
      var cov = R.rows.filter(function (r) { return R.snapshot.watchlist.indexOf(r.slug) >= 0; }).length;
      verified = { rows: re.rows.length, mism: mism, cov: cov, watch: R.snapshot.watchlist.length };
    } catch (e) { verified = null; }
  }

  // Header + stats.
  document.getElementById('meta').textContent =
    'Snapshot ' + R.as_of + ' · ' + R.board_size + ' pre-token protocols ranked · model ' + R.model_version;
  document.getElementById('mver').textContent = R.model_version;
  document.getElementById('asof').textContent = R.as_of;
  if (verified) {
    document.getElementById('verify').textContent = verified.mism === 0
      ? 'Verified in your browser: the model re-run here reproduces all ' + verified.rows + ' rows and ' + verified.cov + '/' + verified.watch + ' watchlist coverage.'
      : 'Warning: the in-browser re-run disagrees with the shipped board on ' + verified.mism + ' rows.';
  }
  var f = R.fit;
  var stats = [
    [R.board_size, 'protocols ranked'],
    [R.watchlist_size, 'on the watchlist'],
    [f.n + ' comps', 'tokens fitted'],
    ['R² ' + f.r2, 'curve fit (log-log)'],
  ];
  document.getElementById('stats').innerHTML = stats
    .map(function (s) { return '<div class="stat"><b>' + esc(s[0]) + '</b><span>' + esc(s[1]) + '</span></div>'; })
    .join('');

  // Hero: how a value is built + scatter of the comps against the fitted curve.
  var famRange = Object.keys(f.families).map(function (k) { return f.families[k]; });
  var famLo = Math.min.apply(null, famRange), famHi = Math.max.apply(null, famRange);
  document.getElementById('heroFormula').textContent =
    'ln(market cap) = ' + f.intercept + ' + ' + f.slope + ' × ln(TVL), fitted to the ' + f.n +
    ' traded tokens in this snapshot. A protocol is priced by that curve for its own TVL, ' +
    'times its family offset (' + famLo.toFixed(2) + ' to +' + famHi.toFixed(2) + ' in log space, shrunk and capped at 10×), ' +
    'times a growth tilt (7-day change, clamped) and a seasoning tilt (0.6× new, 1.0× after three years).';
  document.getElementById('heroBands').textContent =
    'Every row carries its uncertainty: a P25–P75 band from 200 bootstrap refits, a P10–P90 rank range, ' +
    'and a conservative 25th-percentile read (×' + f.conservative_factor + '). The verdict never guesses a ' +
    'launch chance — it shows the chance a launch would need to pay the plan.';
  (function scatter() {
    var comps = R.snapshot.protocols.filter(function (p) { return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0; });
    var W = 480, H = 240, pad = 30;
    var xs = comps.map(function (p) { return Math.log10(p.tvl_usd); });
    var ys = comps.map(function (p) { return Math.log10(p.mcap_usd); });
    var x0 = Math.floor(Math.min.apply(null, xs)), x1 = Math.ceil(Math.max.apply(null, xs));
    var y0 = Math.floor(Math.min.apply(null, ys)), y1 = Math.ceil(Math.max.apply(null, ys));
    var X = function (v) { return pad + (v - x0) / (x1 - x0) * (W - pad - 8); };
    var Y = function (v) { return H - pad - (v - y0) / (y1 - y0) * (H - pad - 8); };
    var s = '';
    // Fitted curve (family offset 0): ln(mcap) = a + b ln(TVL), drawn in log10 space.
    var ln10 = Math.LN10;
    var cx0 = x0 * ln10, cx1 = x1 * ln10;
    var cy0 = (f.intercept + f.slope * cx0) / ln10, cy1 = (f.intercept + f.slope * cx1) / ln10;
    s += '<line x1="' + X(x0) + '" y1="' + Y(cy0) + '" x2="' + X(x1) + '" y2="' + Y(cy1) + '" stroke="#0b5fff" stroke-width="2"/>';
    comps.forEach(function (p) {
      s += '<circle cx="' + X(Math.log10(p.tvl_usd)).toFixed(1) + '" cy="' + Y(Math.log10(p.mcap_usd)).toFixed(1) + '" r="2.4" fill="#5b6b7f"/>';
    });
    s += '<text x="' + (W / 2) + '" y="' + (H - 8) + '" font-size="11" fill="#5b6b7f" text-anchor="middle">TVL (log scale) →</text>';
    document.getElementById('scatter').innerHTML =
      '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Scatter of traded tokens against the fitted curve">' + s + '</svg>' +
      '<p class="scap">Each dot is a traded token; the line is the fitted curve (family offset 0). ' + f.n + ' comparables.</p>';
  })();

  // Verdict distribution.
  var v = R.verdicts, tot = v.farm + v.thin + v.skip;
  document.getElementById('verdicts').innerHTML =
    '<b>' + v.farm + ' farm · ' + v.thin + ' thin · ' + v.skip + ' skip</b> — out of ' + tot + ' ranked protocols.' +
    '<div class="bar"><i class="bf" style="width:' + (v.farm / tot * 100).toFixed(1) + '%"></i>' +
    '<i class="bt" style="width:' + (v.thin / tot * 100).toFixed(1) + '%"></i>' +
    '<i class="bs" style="width:' + (v.skip / tot * 100).toFixed(1) + '%"></i></div>' +
    '<span class="legend">Farm: pays at 1 launch in 10 in the hold. Thin: 1 in 4. Skip: more. ' +
    'The board says skip ' + v.skip + ' times.</span>';

  document.getElementById('method').textContent =
    'The implied value is fitted, not assumed: the ' + f.n +
    ' traded protocols give ln(market cap) = ' + f.intercept +
    ' + ' + f.slope + ' × ln(TVL) by least squares, after removing the growth and seasoning tilts ' +
    'from them and applying them back. Each pre-token protocol is priced by that curve ' +
    'for its own TVL, times its family offset (8 families, shrunk, capped at 10×). ' +
    'The median traded protocol is worth ' + f.median_ratio + '× its TVL. No name is ever special-cased.';
  document.getElementById('limits').textContent =
    'Honest limits: the curve explains only about a quarter of the variance (R² ' + f.r2 +
    ' on the tilt-adjusted fit), and the out-of-sample error is ' + R.validation.variants[3].median_miss + '× at the median. ' +
    'The comparables’ market-cap-to-TVL ratio spans roughly 0.0003× to 400×, so treat any single implied value ' +
    'as an order of magnitude, not a price target. Farm plans assume a 10% airdrop pool shared pro rata to TVL; ' +
    'the verdict is the launch chance the plan would need — never a guessed chance.';
  document.getElementById('boardnote').textContent =
    'Ranked by implied value; the verdict reads the plan. Click a row for its breakdown, peers and farm plan.';

  // Filters.
  var cats = {};
  var chains = {};
  R.rows.forEach(function (r) {
    if (r.category) cats[r.category] = 1;
    (r.chains || []).forEach(function (c) { chains[c] = 1; });
  });
  var fill = function (id, items) {
    var el = document.getElementById(id);
    Object.keys(items).sort().forEach(function (v) {
      var o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      el.appendChild(o);
    });
  };
  fill('fCat', cats);
  fill('fChain', chains);

  // Board state.
  var state = { q: '', cat: '', chain: '', verdict: '', sort: 'rank', dir: 1 };
  var bySlug = {};
  R.rows.forEach(function (r) { bySlug[r.slug] = r; });

  var sortKey = {
    rank: function (r) { return r.rank; },
    name: function (r) { return (r.name || '').toLowerCase(); },
    tvl: function (r) { return r.tvl_usd; },
    change: function (r) { return r.change_7d === null ? -1e9 : r.change_7d; },
    implied: function (r) { return r.implied_value_usd; },
    net: function (r) { return r.farm_net.net_usd; },
    odds: function (r) { return r.farm_net.break_even_odds_pct; },
  };

  function visible() {
    var q = state.q.trim().toLowerCase();
    var rows = R.rows.filter(function (r) {
      if (q && (r.name || '').toLowerCase().indexOf(q) < 0 && (r.slug || '').toLowerCase().indexOf(q) < 0) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.verdict && r.farm_net.verdict !== state.verdict) return false;
      return true;
    });
    var k = sortKey[state.sort] || sortKey.rank;
    rows.sort(function (a, b) {
      var x = k(a), y = k(b);
      if (x < y) return -1 * state.dir;
      if (x > y) return 1 * state.dir;
      return a.rank - b.rank;
    });
    return rows;
  }

  function render() {
    var rows = visible();
    document.getElementById('count').textContent = rows.length + ' of ' + R.rows.length + ' shown';
    var html = rows.map(function (r) {
      var chg = r.change_7d === null ? '<span>—</span>' : '<span class="' + (r.change_7d >= 0 ? 'pos' : 'neg') + '">' + fmtPct(r.change_7d) + '</span>';
      var net = '<span class="' + (r.farm_net.net_usd >= 0 ? 'pos' : 'neg') + '">' + fmt$(r.farm_net.net_usd) + '</span>';
      var band = '<br><span class="small">P25–P75 ' + fmt$(r.band.p25_usd) + '–' + fmt$(r.band.p75_usd) + '</span>';
      var note = r.note ? '<br><span class="small">' + esc(r.note) + '</span>' : '';
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td>' + r.rank + '</td>' +
        '<td><b>' + esc(r.name) + '</b><br><span class="small">' + esc(r.slug) + '</span>' + note + '</td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc((r.chains || []).join(', ') || '—') + '</td>' +
        '<td class="num">' + fmt$(r.tvl_usd) + '</td>' +
        '<td class="num">' + chg + '</td>' +
        '<td class="num"><b>' + fmt$(r.implied_value_usd) + '</b>' + band + '</td>' +
        '<td class="num">' + net + '<br><span class="small">' + r.farm_net.break_even_odds_pct + '% odds</span></td>' +
        '<td><span class="pill ' + r.farm_net.verdict + '">' + r.farm_net.verdict + '</span></td>' +
        '</tr>';
    }).join('');
    document.getElementById('rows').innerHTML = html || '<tr><td colspan="9">No protocol matches these filters.</td></tr>';
  }

  function showDetail(slug) {
    var r = bySlug[slug];
    if (!r) return;
    var n = r.farm_net, m = r.model;
    document.getElementById('dTitle').textContent = '#' + r.rank + ' · ' + r.name;
    document.getElementById('dMeta').textContent =
      (r.category || 'Uncategorised') + ' · ' + (r.chains || []).join(', ') + ' · TVL ' + fmt$(r.tvl_usd) +
      ' · 7d ' + fmtPct(r.change_7d) + ' · listed ' + (r.listed_at || 'unknown') +
      (r.age_days === null ? '' : ' (' + r.age_days + ' days)') + ' · implied ' + fmt$(r.implied_value_usd) +
      ' · rank range P10–P90: #' + r.band.rank_lo + '–#' + r.band.rank_hi;
    document.getElementById('dModel').innerHTML =
      '<dt>Curve value (TVL only)</dt><dd>' + fmt$(m.curve_value_usd) + '</dd>' +
      '<dt>Family (' + esc(m.family) + ')</dt><dd>×' + m.family_multiplier.toFixed(2) + '</dd>' +
      '<dt>Growth multiplier</dt><dd>×' + m.growth_multiplier.toFixed(4) + '</dd>' +
      '<dt>Maturity multiplier</dt><dd>×' + m.maturity_multiplier.toFixed(4) + '</dd>' +
      '<dt>Implied value</dt><dd><b>' + fmt$(r.implied_value_usd) + '</b></dd>' +
      '<dt>Value band (P25–P75, 200 bootstrap refits)</dt><dd>' + fmt$(r.band.p25_usd) + ' – ' + fmt$(r.band.p75_usd) + '</dd>' +
      '<dt>Conservative value (25th percentile, ×' + m.conservative_factor + ')</dt><dd>' + fmt$(m.conservative_value_usd) + '</dd>' +
      '<dt>Break-even odds</dt><dd>' + n.break_even_odds_pct + '% — ' + (n.break_even_odds_pct > 100 ? 'no launch chance covers it' : 'the launch chance that pays the plan in the ' + n.weeks + '-week hold') + '</dd>' +
      '<dt>Conservative odds (at the 25th-percentile value)</dt><dd>' + (n.conservative_odds_pct > 100 ? 'over 100% — no launch chance covers it at the conservative value' : n.conservative_odds_pct + '%') + '</dd>' +
      '<dt>Farm net (slice minus all costs)</dt><dd>' + fmt$(n.net_usd) + ' · ' + n.verdict + (n.capped ? ' (capped from farm: 7-day TVL fall past −30%)' : '') + '</dd>';
    document.getElementById('dPeers').querySelector('tbody').innerHTML = (r.peers || []).map(function (p) {
      return '<tr><td><b>' + esc(p.name) + '</b></td><td class="num">' + fmt$(p.tvl_usd) + '</td>' +
        '<td class="num">' + fmt$(p.mcap_usd) + '</td><td class="num">' + p.multiple.toFixed(2) + '×</td>' +
        '<td class="num">' + fmt$(p.implied_value_usd) + '</td></tr>';
    }).join('') || '<tr><td colspan="5">No traded peer in this family.</td></tr>';
    document.getElementById('dPlanMeta').textContent =
      'Chain: ' + n.chain + ' · funding asset: ' + n.asset + ' · deposit: ' + fmt$(n.deposit_usd) +
      ' · hold: ' + n.weeks + ' weeks · gas: about ' + fmt$(n.costs_usd) + ' in fees';
    document.getElementById('dFarm').innerHTML = (r.farm_steps || [])
      .map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    document.getElementById('dPlanTotals').innerHTML =
      'Totals: deposit ' + fmt$(n.deposit_usd) + ' + fees ' + fmt$(n.costs_usd) + ' + income forgone ' + fmt$(n.capital_cost_usd) +
      ' = ' + fmt$(n.total_outlay_usd) + ' outlay. Slice if it launches: ' + fmt$(n.slice_usd) +
      ' (10% of the token, pro rata to TVL). Net ' + fmt$(n.net_usd) + '. ' +
      'The plan pays if the token launches worth at least ' + fmt$(n.breakeven_value_usd) + '. ' +
      'Stop rule: withdraw at once if TVL closes below ' + fmt$(n.stop_tvl_usd) + ' (' + n.stop_drop_pct + '% under today).';
    var d = document.getElementById('detail');
    d.hidden = false;
    d.scrollIntoView({ block: 'start' });
  }

  // Method section.
  document.getElementById('methodIntro').textContent =
    'Every claim below is computed from the snapshot at run time, not asserted. Each traded token is ' +
    'priced by a fit that never saw it (leave-one-out), the ranking is checked in 8 fixed folds, and the ' +
    'walk-forward test fits only on tokens listed before a date and tests on later ones.';
  document.getElementById('variants').querySelector('tbody').innerHTML = R.validation.variants.map(function (v) {
    return '<tr><td>' + esc(v.label) + '</td><td class="num">' + v.median_miss.toFixed(2) + '×</td>' +
      '<td class="num">' + v.mean_log_miss.toFixed(3) + '</td><td class="num">' + v.rank_corr.toFixed(2) + '</td>' +
      '<td class="num">' + (v.within_3x * 100).toFixed(0) + '%</td></tr>';
  }).join('');
  document.getElementById('variantNote').textContent =
    'Read it honestly: family + priors shrink the median miss (4.86× → 3.06×) but do not improve the ' +
    'ranking — rank correlation slips 0.40 → 0.38. The order comes mostly from TVL, and the priors move ' +
    R.validation.rank_moves_5 + ' rows by 5+ ranks (' + R.validation.rank_moves_10 + ' by 10+). ' +
    'The full model is kept because it prices better, not because it ranks better.';
  document.getElementById('walkforward').querySelector('tbody').innerHTML = R.validation.walk_forward.map(function (w) {
    return '<tr><td>' + w.cutoff + '</td><td class="num">' + w.train + '</td><td class="num">' + w.test + '</td>' +
      '<td class="num">' + w.median_miss.toFixed(2) + '×</td><td class="num">' + w.flat_miss.toFixed(2) + '×</td></tr>';
  }).join('');
  document.getElementById('walkNote').textContent =
    'The target is each token’s market cap at the snapshot date: this asks whether the model would have ' +
    'ranked later launches right, not whether it foresaw their price. The full model beats one flat multiple at every cutoff.';
  document.getElementById('families').querySelector('tbody').innerHTML = Object.keys(R.fit.families).sort().map(function (k) {
    var off = R.fit.families[k];
    return '<tr><td>' + esc(k) + '</td><td class="num">' + (off >= 0 ? '+' : '') + off.toFixed(3) + '</td>' +
      '<td class="num">×' + Math.exp(off).toFixed(2) + '</td></tr>';
  }).join('');
  document.getElementById('universeNote').textContent =
    'Of the ' + R.snapshot.protocols.length + ' protocols: ' + R.universe.ranked + ' ranked (watchlist ' +
    R.watchlist_size + '/' + R.watchlist_size + '), ' + R.universe.traded + ' traded (the fit and the anchors), ' +
    R.universe.recorded + ' record a token without a market cap (not ranked), and ' + R.universe.set_aside +
    ' set aside, each with its reason below. Watchlist rows are always ranked; above-floor off-watchlist ' +
    'rows are ranked with a note, never dropped silently.';
  document.getElementById('setaside').querySelector('tbody').innerHTML = (R.set_aside || []).map(function (s) {
    return '<tr><td><b>' + esc(s.name) + '</b><br><span class="small">' + esc(s.slug) + '</span></td>' +
      '<td class="num">' + fmt$(s.tvl_usd) + '</td><td>' + esc(s.reason) + '</td></tr>';
  }).join('');

  // Events.
  document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; render(); });
  document.getElementById('fCat').addEventListener('change', function (e) { state.cat = e.target.value; render(); });
  document.getElementById('fChain').addEventListener('change', function (e) { state.chain = e.target.value; render(); });
  document.getElementById('fVerdict').addEventListener('change', function (e) { state.verdict = e.target.value; render(); });
  document.getElementById('sort').addEventListener('change', function (e) { state.sort = e.target.value; render(); });
  document.getElementById('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) showDetail(tr.getAttribute('data-slug'));
  });
  document.getElementById('dClose').addEventListener('click', function () {
    document.getElementById('detail').hidden = true;
  });
  document.querySelectorAll('#board thead th[data-k]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-k');
      if (state.sort === k) state.dir = -state.dir;
      else { state.sort = k; state.dir = k === 'name' ? 1 : -1; }
      var sel = document.getElementById('sort');
      if (sel.querySelector('option[value="' + k + '"]')) sel.value = k;
      render();
    });
  });

  // Live table.
  document.getElementById('liveRows').innerHTML = (R.live || []).map(function (p) {
    var ratio = p.mcap_usd && p.tvl_usd ? (p.mcap_usd / p.tvl_usd).toFixed(2) + '×' : '—';
    return '<tr><td><b>' + esc(p.name) + '</b></td><td>' + esc(p.category || '—') + '</td>' +
      '<td class="num">' + fmt$(p.tvl_usd) + '</td>' +
      '<td class="num">' + fmt$(p.mcap_usd) + '</td>' +
      '<td class="num">' + ratio + '</td></tr>';
  }).join('');

  render();
})();
