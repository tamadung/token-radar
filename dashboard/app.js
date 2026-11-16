// Launch Radar dashboard: renders window.RADAR (written by main.ts into data.js).
// No network, no fetch: every number on this page comes from the same board.json the gate reads.
(function () {
  var R = window.RADAR;
  if (!R) {
    document.getElementById('meta').textContent = 'No data loaded.';
    return;
  }

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

  // Header + stats.
  document.getElementById('meta').textContent =
    'Snapshot ' + R.as_of + ' · ' + R.board_size + ' pre-token protocols ranked · model ' + R.model_version;
  document.getElementById('asof').textContent = R.as_of;
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
  document.getElementById('method').textContent =
    'The implied value is fitted, not assumed. The program takes the ' + f.n +
    ' protocols in this snapshot whose token already trades, and fits log(market cap) = ' + f.intercept +
    ' + ' + f.slope + ' × log(TVL) by least squares. A pre-token protocol is then priced by that curve ' +
    'for its own TVL, adjusted by its 7-day growth (clamped to −60%…+120%, weight 0.5) and its age ' +
    '(0.6 + up to 0.4 over three years; unknown age counts as 365 days). The median traded protocol is ' +
    'worth ' + f.median_ratio + '× its TVL. No name is ever special-cased: the same function scores every row.';
  document.getElementById('limits').textContent =
    'Honest limits: the curve explains only about a fifth of the variance (R² ' + f.r2 +
    '), and the out-of-sample error is ' + f.oos_sd + ' in log space (about ' +
    Math.round(Math.exp(f.oos_sd)) + '×) across a 5-fold split. The comparables’ market-cap-to-TVL ratio spans ' +
    'roughly 0.0003× to 400×, so treat any single implied value as an order of magnitude, not a price target. ' +
    'Farm nets assume a 0.01% allocation (a 10% airdrop pool, a 0.1% share of it for one active farmer).';

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
    net: function (r) { return r.farm_net_usd; },
  };

  function visible() {
    var q = state.q.trim().toLowerCase();
    var rows = R.rows.filter(function (r) {
      if (q && (r.name || '').toLowerCase().indexOf(q) < 0 && (r.slug || '').toLowerCase().indexOf(q) < 0) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.verdict && r.farm_verdict !== state.verdict) return false;
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
      var net = '<span class="' + (r.farm_net_usd >= 0 ? 'pos' : 'neg') + '">' + fmt$(r.farm_net_usd) + '</span>';
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td>' + r.rank + '</td>' +
        '<td><b>' + esc(r.name) + '</b><br><span style="color:var(--muted);font-size:12px">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc((r.chains || []).join(', ') || '—') + '</td>' +
        '<td class="num">' + fmt$(r.tvl_usd) + '</td>' +
        '<td class="num">' + chg + '</td>' +
        '<td class="num"><b>' + fmt$(r.implied_value_usd) + '</b></td>' +
        '<td class="num">' + net + '</td>' +
        '<td><span class="pill ' + r.farm_verdict + '">' + r.farm_verdict + '</span></td>' +
        '</tr>';
    }).join('');
    document.getElementById('rows').innerHTML = html || '<tr><td colspan="9">No protocol matches these filters.</td></tr>';
  }

  function showDetail(slug) {
    var r = bySlug[slug];
    if (!r) return;
    document.getElementById('dTitle').textContent = '#' + r.rank + ' · ' + r.name;
    document.getElementById('dMeta').textContent =
      (r.category || 'Uncategorised') + ' · ' + (r.chains || []).join(', ') + ' · TVL ' + fmt$(r.tvl_usd) +
      ' · 7d ' + fmtPct(r.change_7d) + ' · listed ' + (r.listed_at || 'unknown') +
      (r.age_days === null ? '' : ' (' + r.age_days + ' days)') + ' · implied ' + fmt$(r.implied_value_usd);
    document.getElementById('dModel').innerHTML =
      '<dt>Curve value (TVL only)</dt><dd>' + fmt$(r.curve_value_usd) + '</dd>' +
      '<dt>Growth multiplier</dt><dd>×' + r.growth_multiplier.toFixed(4) + '</dd>' +
      '<dt>Maturity multiplier</dt><dd>×' + r.maturity_multiplier.toFixed(4) + '</dd>' +
      '<dt>Implied value</dt><dd><b>' + fmt$(r.implied_value_usd) + '</b></dd>' +
      '<dt>Farm net (0.01% allocation)</dt><dd>' + fmt$(r.farm_net_usd) + ' · ' + r.farm_verdict + '</dd>';
    document.getElementById('dFarm').innerHTML = (r.farm_steps || [])
      .map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    var d = document.getElementById('detail');
    d.hidden = false;
    d.scrollIntoView({ block: 'start' });
  }

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
