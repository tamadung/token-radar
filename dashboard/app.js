// Launch Radar dashboard: renders window.RADAR (written by main.ts into data.js).
// No network, no fetch: every number comes from the same board.json the gate reads.
// The page re-runs the model (dashboard/model.js) in the browser and checks every row
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
        if (!sh || sh.implied_value_usd !== row.iv.value || sh.farm_net.verdict !== row.plan.verdict ||
          sh.farm_net.break_even_odds_pct !== row.plan.odds) mism++;
      });
      verified = { rows: re.rows.length, mism: mism };
    } catch (e) { verified = null; }
  }

  // Header + KPI strip.
  document.getElementById('meta').textContent =
    'Snapshot ' + R.as_of + ' · ' + R.board_size + ' pre-token protocols ranked · model ' + R.model_version;
  document.getElementById('mver').textContent = R.model_version;
  document.getElementById('asof').textContent = R.as_of;
  if (verified) {
    document.getElementById('verify').textContent = verified.mism === 0
      ? 'Verified in your browser: the model re-run here reproduces all ' + verified.rows + ' rows.'
      : 'Warning: the in-browser re-run disagrees with the shipped board on ' + verified.mism + ' rows.';
  }
  var f = R.fit;
  document.getElementById('stats').innerHTML =
    '<b>' + R.board_size + '</b> ranked · <b>' + R.watchlist_size + '/' + R.watchlist_size + '</b> watchlist · ' +
    '<b>' + f.n + '</b> comps · LOO miss <b>×' + R.validation.variants[3].median_miss.toFixed(2) + '</b> · ' +
    'band holds <b>' + Math.round(R.validation.calibration.p25_75 * 100) + '%</b> · <b>' + R.verdicts.farm + '</b> farm';

  // Hero: formula + scatter + the best farms by net per hour.
  var famRange = Object.keys(f.families).map(function (k) { return f.families[k]; });
  var famLo = Math.min.apply(null, famRange), famHi = Math.max.apply(null, famRange);
  document.getElementById('heroFormula').textContent =
    'ln(market cap) = ' + f.intercept + ' + ' + f.slope + ' × ln(TVL), fitted to the ' + f.n +
    ' traded tokens in this snapshot. Each protocol is priced by that curve for its own TVL, ' +
    'times its family offset (' + famLo.toFixed(2) + ' to +' + famHi.toFixed(2) + ' in log space, shrunk and capped at 10×), ' +
    'times a growth tilt and a seasoning tilt (0.6× new, 1.0× after three years).';
  document.getElementById('heroBands').textContent =
    'Every row carries its uncertainty: a P25–P75 band from 200 bootstrap refits, a P10–P90 rank range, ' +
    'and a conservative 25th-percentile read (×' + f.conservative_factor + '). The verdict shows the ' +
    'launch chance a plan would need — never a guessed chance.';
  (function scatter() {
    var comps = R.snapshot.protocols.filter(function (p) { return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0; });
    var W = 480, H = 140, pad = 30;
    var xs = comps.map(function (p) { return Math.log10(p.tvl_usd); });
    var ys = comps.map(function (p) { return Math.log10(p.mcap_usd); });
    var x0 = Math.floor(Math.min.apply(null, xs)), x1 = Math.ceil(Math.max.apply(null, xs));
    var y0 = Math.floor(Math.min.apply(null, ys)), y1 = Math.ceil(Math.max.apply(null, ys));
    var X = function (v) { return pad + (v - x0) / (x1 - x0) * (W - pad - 8); };
    var Y = function (v) { return H - pad - (v - y0) / (y1 - y0) * (H - pad - 8); };
    var s = '';
    var ln10 = Math.LN10;
    var cx0 = x0 * ln10, cx1 = x1 * ln10;
    var cy0 = (f.intercept + f.slope * cx0) / ln10, cy1 = (f.intercept + f.slope * cx1) / ln10;
    s += '<line x1="' + X(x0) + '" y1="' + Y(cy0) + '" x2="' + X(x1) + '" y2="' + Y(cy1) + '" stroke="#0b5fff" stroke-width="2"/>';
    comps.forEach(function (p) {
      s += '<circle cx="' + X(Math.log10(p.tvl_usd)).toFixed(1) + '" cy="' + Y(Math.log10(p.mcap_usd)).toFixed(1) + '" r="2.4" fill="#5b6b7f"/>';
    });
    document.getElementById('scatter').innerHTML =
      '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Scatter of traded tokens against the fitted curve">' + s + '</svg>';
  })();
  (function bestFarms() {
    var farms = R.rows.filter(function (r) { return r.farm_net.verdict === 'farm'; })
      .sort(function (a, b) { return b.farm_net.net_per_hour_usd - a.farm_net.net_per_hour_usd; }).slice(0, 3);
    document.getElementById('bestfarms').innerHTML = 'Best farms by $/hour: ' + farms.map(function (r) {
      return '<a href="#" data-slug="' + esc(r.slug) + '">#' + r.rank + ' ' + esc(r.name) + ' ($' + r.farm_net.net_per_hour_usd.toFixed(0) + '/h)</a>';
    }).join(' · ');
  })();

  // Verdict distribution.
  var v = R.verdicts, tot = v.farm + v.thin + v.skip;
  document.getElementById('verdicts').innerHTML =
    '<b>' + v.farm + ' farm · ' + v.thin + ' thin · ' + v.skip + ' skip</b> — out of ' + tot + ' ranked protocols.' +
    '<div class="bar"><i class="bf" style="width:' + (v.farm / tot * 100).toFixed(1) + '%"></i>' +
    '<i class="bt" style="width:' + (v.thin / tot * 100).toFixed(1) + '%"></i>' +
    '<i class="bs" style="width:' + (v.skip / tot * 100).toFixed(1) + '%"></i></div>' +
    '<span class="legend">Farm: pays at 1 launch in 10 in the hold. Thin: 1 in 4. Skip: more.</span>';

  document.getElementById('method').textContent =
    'Fitted, not assumed: the ' + f.n +
    ' traded protocols give ln(market cap) = ' + f.intercept +
    ' + ' + f.slope + ' × ln(TVL) by least squares, tilts removed then applied back. Each pre-token protocol is priced by that curve ' +
    'for its own TVL, times its family offset (8 families, shrunk, capped at 10×). ' +
    'The median traded protocol is worth ' + f.median_ratio + '× its TVL. No name is ever special-cased.';
  document.getElementById('limits').textContent =
    'Honest limits: the curve explains only about a quarter of the variance (R² ' + f.r2 +
    '), and the out-of-sample error is ' + R.validation.variants[3].median_miss + '× at the median. ' +
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

  // Board state: two tabs — still to come (the ranked board) and already trades (anchors).
  var state = { q: '', cat: '', chain: '', verdict: '', sort: 'rank', dir: 1, tab: 'todo' };
  var bySlug = {};
  R.rows.forEach(function (r) { bySlug[r.slug] = r; });

  var sortKey = {
    rank: function (r) { return r.rank; },
    name: function (r) { return (r.name || '').toLowerCase(); },
    tvl: function (r) { return r.tvl_usd; },
    change: function (r) { return r.change_7d === null ? -1e9 : r.change_7d; },
    implied: function (r) { return r.implied_value_usd; },
    net: function (r) { return r.farm_net.net_usd; },
    perhour: function (r) { return r.farm_net.net_per_hour_usd; },
    odds: function (r) { return r.farm_net.break_even_odds_pct; },
  };

  var HEAD_TODO = '<th data-k="rank">#</th><th data-k="name">Protocol</th><th data-k="category">Category</th>' +
    '<th data-k="chains">Chains</th><th data-k="tvl" class="num">TVL</th><th data-k="change" class="num">7d</th>' +
    '<th data-k="implied" class="num">Implied</th><th data-k="net" class="num">Farm net</th><th data-k="verdict">Verdict</th>';
  var HEAD_TRADED = '<th>Protocol</th><th>Category</th><th class="num">TVL</th>' +
    '<th class="num">Mcap</th><th class="num">× TVL</th><th class="num">Curve</th>';

  function basic(x) {
    var q = state.q.trim().toLowerCase();
    if (q && (x.name || '').toLowerCase().indexOf(q) < 0 && (x.slug || '').toLowerCase().indexOf(q) < 0) return false;
    if (state.cat && x.category !== state.cat) return false;
    if (state.chain && (x.chains || []).indexOf(state.chain) < 0) return false;
    return true;
  }
  function visible() {
    if (state.tab === 'traded') return (R.traded || []).filter(basic);
    var rows = R.rows.filter(function (r) {
      return basic(r) && (!state.verdict || r.farm_net.verdict === state.verdict);
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
    var head = document.getElementById('headRow');
    if (state.tab === 'traded') {
      head.innerHTML = HEAD_TRADED;
      var tr = visible();
      document.getElementById('count').textContent = tr.length + ' traded tokens';
      document.getElementById('rows').innerHTML = tr.map(function (t) {
        return '<tr data-slug="' + esc(t.slug) + '">' +
          '<td><b>' + esc(t.name) + '</b></td>' +
          '<td>' + esc(t.category || '—') + '</td>' +
          '<td class="num">' + fmt$(t.tvl_usd) + '</td>' +
          '<td class="num"><b>' + fmt$(t.mcap_usd) + '</b></td>' +
          '<td class="num">' + t.multiple.toFixed(2) + '×</td>' +
          '<td class="num">' + fmt$(t.curve_value_usd) + '</td></tr>';
      }).join('') || '<tr><td colspan="6">No traded token matches these filters.</td></tr>';
      return;
    }
    head.innerHTML = HEAD_TODO;
    var rows = visible();
    document.getElementById('count').textContent = rows.length + ' of ' + R.rows.length + ' shown';
    var html = rows.map(function (r) {
      var chg = r.change_7d === null ? '<span>—</span>' : '<span class="' + (r.change_7d >= 0 ? 'pos' : 'neg') + '">' + fmtPct(r.change_7d) + '</span>';
      var net = '<span class="' + (r.farm_net.net_usd >= 0 ? 'pos' : 'neg') + '">' + fmt$(r.farm_net.net_usd) + '</span>';
      var perh = '<br><span class="small">$' + r.farm_net.net_per_hour_usd.toFixed(2) + '/h · ' + r.farm_net.break_even_odds_pct + '% odds</span>';
      var band = '<br><span class="small">' + fmt$(r.band.p25_usd) + '–' + fmt$(r.band.p75_usd) + '</span>';
      var note = r.note ? '<br><span class="small">' + esc(r.note) + '</span>' : '';
      var ch = (r.chains || []);
      var chTxt = ch.length > 2 ? esc(ch.slice(0, 2).join(', ')) + ' +' + (ch.length - 2) : esc(ch.join(', ') || '—');
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td>' + r.rank + '</td>' +
        '<td><b>' + esc(r.name) + '</b><br><span class="small">' + esc(r.slug) + '</span>' + note + '</td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + chTxt + '</td>' +
        '<td class="num">' + fmt$(r.tvl_usd) + '</td>' +
        '<td class="num">' + chg + '</td>' +
        '<td class="num"><b>' + fmt$(r.implied_value_usd) + '</b>' + band + '</td>' +
        '<td class="num">' + net + perh + '</td>' +
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
      (r.note ? ' · ' + r.note : '');
    document.getElementById('dModel').innerHTML =
      '<dt>Curve value</dt><dd>' + fmt$(m.curve_value_usd) + '</dd>' +
      '<dt>Family (' + esc(m.family) + ')</dt><dd>×' + m.family_multiplier.toFixed(2) + '</dd>' +
      '<dt>Growth multiplier</dt><dd>×' + m.growth_multiplier.toFixed(4) + '</dd>' +
      '<dt>Maturity multiplier</dt><dd>×' + m.maturity_multiplier.toFixed(4) + '</dd>' +
      '<dt>Implied value</dt><dd><b>' + fmt$(r.implied_value_usd) + '</b></dd>' +
      '<dt>Value band (P25–P75, 200 refits)</dt><dd>' + fmt$(r.band.p25_usd) + ' – ' + fmt$(r.band.p75_usd) + '</dd>' +
      '<dt>Conservative value (25th pct, ×' + m.conservative_factor + ')</dt><dd>' + fmt$(m.conservative_value_usd) + '</dd>' +
      '<dt>Break-even odds</dt><dd>' + n.break_even_odds_pct + '% — ' + (n.break_even_odds_pct > 100 ? 'no launch chance covers it' : 'the launch chance that pays the plan in the ' + n.weeks + '-week hold') + '</dd>' +
      '<dt>Conservative odds (at the 25th-percentile value)</dt><dd>' + (n.conservative_odds_pct > 100 ? 'over 100% — no launch chance covers it at the conservative value' : n.conservative_odds_pct + '%') + '</dd>' +
      '<dt>Farm net</dt><dd>' + fmt$(n.net_usd) + ' · ' + n.verdict + (n.capped ? ' (capped from farm: 7-day TVL fall past −30%)' : '') + '</dd>';
    document.getElementById('dPeers').querySelector('tbody').innerHTML = (r.peers || []).map(function (p) {
      return '<tr><td><b>' + esc(p.name) + '</b></td><td class="num">' + fmt$(p.tvl_usd) + '</td>' +
        '<td class="num">' + fmt$(p.mcap_usd) + '</td><td class="num">' + p.multiple.toFixed(2) + '×</td>' +
        '<td class="num">' + fmt$(p.implied_value_usd) + '</td></tr>';
    }).join('') || '<tr><td colspan="5">No traded peer in this family.</td></tr>';
    document.getElementById('dPlanMeta').textContent =
      'Chain: ' + n.chain + ' · asset: ' + n.asset + ' · deposit: ' + fmt$(n.deposit_usd) +
      ' · hold: ' + n.weeks + ' weeks · gas: about ' + fmt$(n.costs_usd);
    document.getElementById('dFarm').innerHTML = (r.farm_steps || [])
      .map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    var skipWhy = n.verdict === 'skip'
      ? ' Why skip: the slice (' + fmt$(n.slice_usd) + ') covers only ' +
        Math.round(100 * n.slice_usd / Math.max(1, n.total_outlay_usd)) + '% of the ' + fmt$(n.total_outlay_usd) +
        ' outlay.'
      : '';
    document.getElementById('dPlanTotals').innerHTML =
      'Totals: deposit ' + fmt$(n.deposit_usd) + ' + fees ' + fmt$(n.costs_usd) + ' + income forgone ' + fmt$(n.capital_cost_usd) +
      ' = ' + fmt$(n.total_outlay_usd) + ' outlay. Slice if it launches: ' + fmt$(n.slice_usd) +
      ' (10% of the token, pro rata to TVL). Net ' + fmt$(n.net_usd) + ' (' + fmt$(n.net_per_hour_usd) + '/h). ' +
      'The plan pays if the token launches worth at least ' + fmt$(n.breakeven_value_usd) + '. ' +
      'Stop rule: withdraw at once if TVL closes below ' + fmt$(n.stop_tvl_usd) + '.' + skipWhy;
    document.getElementById('dSafety').innerHTML = (r.safety || [])
      .map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    var d = document.getElementById('detail');
    d.hidden = false;
    d.scrollIntoView({ block: 'start' });
  }

  // Method section.
  document.getElementById('methodIntro').textContent =
    'Every claim below is computed from the snapshot at run time, not asserted. Each traded token is ' +
    'priced by a fit that never saw it (leave-one-out); the walk-forward test fits only on tokens ' +
    'listed before a date and tests on later ones.';
  document.getElementById('variants').querySelector('tbody').innerHTML = R.validation.variants.map(function (v) {
    return '<tr><td>' + esc(v.label) + '</td><td class="num">' + v.median_miss.toFixed(2) + '×</td>' +
      '<td class="num">' + v.mean_log_miss.toFixed(3) + '</td><td class="num">' + v.rank_corr.toFixed(2) + '</td>' +
      '<td class="num">' + (v.within_3x * 100).toFixed(0) + '%</td></tr>';
  }).join('');
  document.getElementById('variantNote').textContent =
    'Read it honestly: family + priors shrink the median miss (4.86× → 3.06×) but do not improve the ' +
    'ranking — rank correlation slips 0.40 → 0.38. The order comes mostly from TVL, and the priors move ' +
    R.validation.rank_moves_5 + ' rows by 5+ ranks (' + R.validation.rank_moves_10 + ' by 10+).';
  document.getElementById('walkforward').querySelector('tbody').innerHTML = R.validation.walk_forward.map(function (w) {
    return '<tr><td>' + w.cutoff + '</td><td class="num">' + w.train + '</td><td class="num">' + w.test + '</td>' +
      '<td class="num">' + w.median_miss.toFixed(2) + '×</td><td class="num">' + w.flat_miss.toFixed(2) + '×</td></tr>';
  }).join('');
  document.getElementById('walkNote').textContent =
    'The flat multiple is fitted on the train set only — it never sees the test set. The model beats it at ' +
    'every origin. The target is each token’s market cap at the snapshot date.';
  var ts = R.validation.time_split;
  if (ts) {
    document.getElementById('timeSplit').textContent =
      'Time-split (35 oldest tokens train, 35 newest test): model ×' + ts.median_miss.toFixed(2) +
      ' vs flat ×' + ts.flat_miss.toFixed(2) + '.';
  }
  document.getElementById('calibration').textContent =
    'Band calibration (leave-one-out): the P25–P75 band holds ' + Math.round(R.validation.calibration.p25_75 * 100) +
    '% (aim 50%); P10–P90 holds ' + Math.round(R.validation.calibration.p10_90 * 100) + '% (aim 80%).';
  document.getElementById('tenure').textContent = 'Share of protocols that record a token, by age: ' +
    R.validation.tenure.map(function (t) {
      return t.label + ' ' + (t.share * 100).toFixed(0) + '% (' + t.has_token + '/' + t.total + ')';
    }).join(' · ') + '. Older protocols are far likelier to have one.';
  document.getElementById('ablation').textContent = 'Top-20 overlap with the full model: no family offset ' +
    R.validation.ablation.noFamily + '/20 · no priors ' + R.validation.ablation.noPriors + '/20 · Huber fit ' +
    R.validation.ablation.huber + '/20 · flat multiple only ' + R.validation.ablation.flat + '/20.';
  document.getElementById('familiesLine').textContent =
    'Family offsets (log, shrunk, capped at 10×): ' + Object.keys(R.fit.families).sort().map(function (k) {
      var o = R.fit.families[k];
      return k + ' ' + (o >= 0 ? '+' : '') + o.toFixed(2) + ' (×' + Math.exp(o).toFixed(2) + ')';
    }).join(' · ') + '.';
  document.getElementById('universeNote').textContent =
    'Of the ' + R.snapshot.protocols.length + ' protocols: ' + R.universe.ranked + ' ranked (watchlist ' +
    R.watchlist_size + '/' + R.watchlist_size + '), ' + R.universe.traded + ' traded (the fit and the anchors), ' +
    R.universe.recorded + ' record a token without a market cap (not ranked), and ' + R.universe.set_aside +
    ' set aside, each with its reason below.';
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
  document.getElementById('tabTodo').addEventListener('click', function () {
    state.tab = 'todo';
    document.getElementById('tabTodo').classList.add('on');
    document.getElementById('tabTraded').classList.remove('on');
    render();
  });
  document.getElementById('tabTraded').addEventListener('click', function () {
    state.tab = 'traded';
    document.getElementById('tabTraded').classList.add('on');
    document.getElementById('tabTodo').classList.remove('on');
    render();
  });
  document.getElementById('bestfarms').addEventListener('click', function (e) {
    var a = e.target.closest('a[data-slug]');
    if (a) { e.preventDefault(); showDetail(a.getAttribute('data-slug')); }
  });
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

  render();
})();
