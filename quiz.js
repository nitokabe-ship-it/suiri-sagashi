/* ============================================================
 地水利クイズ。出題は「いまの水利データ」と「住所データ」から自動で作ります。
  A. 準備  B. 問題づくり(7種類)  C. 地図の表示  D. 進行と採点  E. 成績
============================================================ */
const $ = id => document.getElementById(id);
const DIRS = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
const LV = [                            // 難易度:出題する種類 / 選択肢の距離の差(m) / 選択肢の数
  { n: '入門', types: [0, 3, 2], gap: 35, k: 3 },
  { n: 'ふつう', types: [0, 1, 2, 3, 5], gap: 18, k: 4 },
  { n: 'むずかしい', types: [0, 1, 2, 3, 4, 5, 6], gap: 10, k: 4 }
];
const TYPE = ['最寄りの水利', '次に近い水利', 'ホースの本数', '方角', '範囲内の数', '防火水槽をさがす', '風上の水利'];
const shuf = a => a.map(x => [Math.random(), x]).sort((x, y) => x[0] - y[0]).map(x => x[1]);
const rnd = n => Math.floor(Math.random() * n);
const brg = (a, b, c, d) => ((Math.atan2((d - b) * Math.cos((a + c) / 2 * Math.PI / 180), c - a) * 180 / Math.PI) + 360) % 360;
const angd = (x, y) => { const d = Math.abs(x - y) % 360; return d > 180 ? 360 - d : d; };
const dirIdx = deg => Math.round(deg / 45) % 8;

/* A. 準備 ------------------------------------------------- */
const map = L.map('map', { zoomControl: false }).setView(CONFIG.map.center, CONFIG.map.zoom);
map.attributionControl.setPrefix(false); L.control.zoom({ position: 'topright' }).addTo(map);
L.tileLayer(CONFIG.map.tileUrl, { maxZoom: CONFIG.map.maxZoom, attribution: CONFIG.map.attribution }).addTo(map);
const LYR = L.layerGroup().addTo(map);
let Q = null, ST = Store.get(K.quiz, { lv: 1, towns: {}, types: {}, miss: [], tot: { n: 0, ok: 0 } });
const save = () => Store.set(K.quiz, ST);
const acc = x => x && x.n ? Math.round(x.ok / x.n * 100) + '%(' + x.n + '問)' : '—';

function pool(sel) {                    // 火点の候補。住所データがあれば町ごと、なければ水利のまわりから
  if (Addr.blocks.length) {
    const ns = sel === 'all' ? CONFIG.towns : sel === 'weak' ? weak() : [sel], inT = (c, t) => c.startsWith(t) && /^[\d-]/.test(c.slice(t.length));
    return Addr.blocks.map(b => { const t = ns.find(x => inT(b.c, x)); return t ? { lat: b.a, lng: b.o, town: t, label: b.t } : null; }).filter(Boolean);
  }
  return null;
}
function weak() { const a = CONFIG.towns.filter(t => ST.towns[t] && ST.towns[t].n > 0).sort((x, y) => ST.towns[x].ok / ST.towns[x].n - ST.towns[y].ok / ST.towns[y].n).slice(0, 5); return a.length ? a : CONFIG.towns; }
function randomPoint(pl) {
  if (pl) return pl[rnd(pl.length)];
  const w = Ledger.items[rnd(Ledger.items.length)], a = Math.random() * 2 * Math.PI, r = 25 + Math.random() * 90;       // 住所データなし:水利から25〜115mはなれた点
  return { lat: w.lat + Math.sin(a) * r / 111320, lng: w.lng + Math.cos(a) * r / (111320 * Math.cos(w.lat * Math.PI / 180)), town: '', label: '地図の🔥' };
}

/* B. 問題づくり ------------------------------------------- */
function around(p, maxd) { return Ledger.items.map(w => ({ w, d: Util.dist(p.lat, p.lng, w.lat, w.lng), b: brg(p.lat, p.lng, w.lat, w.lng) })).filter(x => x.d < maxd).sort((a, b) => a.d - b.d); }
function letters(a) { return a.map((x, i) => Object.assign({}, x, { L: 'ABCD'[i] })); }
function gen(lv, pl) {
  const cfg = LV[lv];
  for (let n = 0; n < 80; n++) {
    const p = randomPoint(pl), H = around(p, 600), t = cfg.types[rnd(cfg.types.length)]; if (H.length < 6) continue;
    const hh = 3 + rnd(21), scen = '【状況】' + hh + '時ごろ、' + (p.town ? p.label.replace(/\d+$/, '') + '付近' : 'この付近') + 'で建物火災。', gap = cfg.gap, k = cfg.k;
    const pickFar = (base, from, cnt) => shuf(from.filter(x => x.d - base.d >= gap)).slice(0, cnt);
    let q = null;
    if (t === 0) { const c = H[0], o = pickFar(c, H.slice(1, 10), k - 1); if (o.length === k - 1) q = { items: letters(shuf([c, ...o])), ans: c, text: 'いちばん近い水利はどれ?(直線距離)' }; }
    if (t === 1) { const b = H[0], c = H[1], o = pickFar(c, H.slice(2, 10), k - 1); if (o.length === k - 1) q = { items: letters(shuf([c, ...o])), ban: b, ans: c, text: '×の水利が使えません。次に近い水利はどれ?' }; }
    if (t === 2) { const T = H[rnd(4)], n2 = Util.hose(T.d); let v = [n2 - 1, n2, n2 + 1, n2 + 2].filter(x => x >= 1); while (v.length < 4) v.push(v[v.length - 1] + 1); q = { items: [Object.assign({ L: '★' }, T)], n: n2, v: shuf(v), text: '★の水利まで、20mホースは最低何本?(直線×' + CONFIG.hose.factor + ')' }; }
    if (t === 3) { const c = H[0], ci = dirIdx(c.b); let o = DIRS.map((_, i) => i).filter(i => i !== ci && (lv === 0 ? angd(i * 45, ci * 45) >= 90 : true)); q = { items: [c], hide: true, dv: shuf([ci, ...shuf(o).slice(0, 3)]), ci, text: 'いちばん近い水利は、🔥から見てどの方角?(上が北)' }; }
    if (t === 4) { const g = H.filter(x => !Util.isTank(x.w) && x.d <= 100), c = g.length; if (c >= 1 && c <= 6) { let v = [c - 1, c, c + 1, c + 2].filter(x => x >= 0); while (v.length < 4) v.push(v[v.length - 1] + 1); q = { items: [], dots: H.filter(x => x.d <= 150), ring: 100, n: c, v: shuf(v), text: '赤い円(半径100m)の中に、消火栓(●)はいくつ?(■は防火水槽)' }; } }
    if (t === 5) { const tk = H.filter(x => Util.isTank(x.w)); if (tk.length >= k) { const c = tk[0], o = pickFar(c, tk.slice(1, 8), k - 1); if (o.length === k - 1) q = { items: letters(shuf([c, ...o])), ans: c, tankOnly: true, text: 'いちばん近い防火水槽(■)はどれ?' }; } }
    if (t === 6) { const wd = rnd(8), W = H.filter(x => angd(x.b, wd * 45) <= 90), Lw = H.filter(x => angd(x.b, wd * 45) > 90);
      if (W.length >= 2 && Lw.length >= 2 && Lw[0].d < W[0].d && W[1].d - W[0].d >= gap) { const c = W[0]; q = { items: letters(shuf([c, Lw[0], Lw[1], W[1]])), ans: c, wind: wd, text: '風は' + DIRS[wd] + 'から。🔥より風上(' + DIRS[wd] + '側)にある水利で、いちばん近いのはどれ?' }; } }
    if (q) return Object.assign(q, { t, p, scen: t === 6 ? scen + '風は' + DIRS[q.wind] + 'から。' : scen, lv });
  }
  return null;
}

/* C. 地図の表示 ------------------------------------------- */
function mkIcon(x, cls, txt) { return L.divIcon({ className: '', html: '<div class="qm ' + (Util.isTank(x.w) ? 'tank' : '') + ' ' + (cls || '') + '">' + (txt || '') + '</div>', iconSize: [30, 30], iconAnchor: [15, 15] }); }
function drawQ(q, rev) {
  LYR.clearLayers(); const p = q.p, pts = [[p.lat, p.lng]], f = [p.lat, p.lng];
  L.marker(f, { icon: L.divIcon({ className: '', html: '<div class="fire">🔥</div>', iconSize: [30, 30], iconAnchor: [15, 15] }), interactive: false }).addTo(LYR);
  if (q.ring) L.circle(f, { radius: q.ring, color: '#e5352b', weight: 3, fillOpacity: .05, interactive: false }).addTo(LYR);
  if (q.wind !== undefined) { const b = q.wind * 45 * Math.PI / 180, e = [p.lat + Math.cos(b) * 90 / 111320, p.lng + Math.sin(b) * 90 / (111320 * Math.cos(p.lat * Math.PI / 180))]; L.polyline([f, e], { color: '#0ea5e9', weight: 5, dashArray: '2 8', interactive: false }).addTo(LYR); L.marker(e, { icon: L.divIcon({ className: '', html: '<div style="background:#0ea5e9;color:#fff;border-radius:10px;padding:0 6px;font-weight:800;font-size:12px;white-space:nowrap">風上</div>', iconSize: [40, 18], iconAnchor: [20, 9] }), interactive: false }).addTo(LYR); pts.push(e); }
  (q.dots || []).forEach(x => { L.circleMarker([x.w.lat, x.w.lng], { radius: Util.isTank(x.w) ? 6 : 6, color: '#fff', weight: 2, fillColor: Util.isTank(x.w) ? '#1565c0' : '#c62828', fillOpacity: 1, interactive: false }).addTo(LYR); pts.push([x.w.lat, x.w.lng]); });
  const show = q.hide && !rev ? [] : q.items.concat(q.ban ? [q.ban] : []);
  show.forEach(x => { const isAns = rev && (x === q.ans || x.w === (q.ans && q.ans.w) || q.t === 3), isBan = x === q.ban, m = L.marker([x.w.lat, x.w.lng], { icon: mkIcon(x, isBan ? 'ban' : isAns ? 'ok' : '', isBan ? '×' : x.L || '●'), interactive: false }).addTo(LYR); pts.push([x.w.lat, x.w.lng]);
    if (rev) { L.polyline([f, [x.w.lat, x.w.lng]], { color: isAns ? '#2e7d32' : '#9aa', weight: isAns ? 4 : 2, dashArray: isAns ? null : '4 6', interactive: false }).addTo(LYR); L.marker([x.w.lat, x.w.lng], { icon: L.divIcon({ className: '', html: '<div class="dl" style="top:-34px">' + DIRS[dirIdx(x.b)] + ' ' + Math.round(x.d) + 'm</div>', iconSize: [1, 1] }), interactive: false }).addTo(LYR); } });
  const h = $('qpanel').offsetHeight; map.fitBounds(L.latLngBounds(pts).pad(.25), { paddingTopLeft: [10, 60], paddingBottomRight: [10, matchMedia('(min-width:700px)').matches ? 20 : h], maxZoom: 18, animate: false });
}

/* D. 進行と採点 ------------------------------------------- */
function menu() {
  const hasBlk = Addr.blocks.length, ms = ST.miss.length, tw = hasBlk ? CONFIG.towns : [];
  LYR.clearLayers(); $('qt').textContent = '地水利クイズ';
  $('qpanel').innerHTML = '<div class="exp"><b>どんなクイズ?</b><br>地図に🔥(火事の場所)が出ます。近くの水利の中から、問題の答えを選びます。<br>答えると、正解は<b style="color:#2e7d32">緑</b>、間違いは<b style="color:#c62828">赤</b>になり、地図に<b>方角と距離</b>が出ます。<br>10問で結果が出ます。間違えた問題は、あとで復習できます。<details><summary>問題の種類(7つ)</summary><div class="scen">① 最寄りの水利:いちばん近いのは?<br>② 次に近い水利:最寄りが使えないとき、次は?<br>③ ホースの本数:★まで20mホースが何本?<br>④ 方角:最寄りは、🔥から見てどの方角?<br>⑤ 範囲内の数:赤い円(100m)の中の消火栓は?<br>⑥ 防火水槽をさがす:いちばん近い防火水槽は?<br>⑦ 風上の水利:風上でいちばん近いのは?</div></details></div><div class="q">① レベルをえらぶ</div><div class="seg">' + LV.map((l, i) => '<button class="btn ' + (ST.lv === i ? 'on' : '') + '" onclick="ST.lv=' + i + ';save();menu()">' + l.n + '</button>').join('') + '</div>' +
    '<div class="scen">' + ['まず基本の3種類(最寄り・方角・ホース本数)', '5種類(次に近い水利・防火水槽を追加)', '7種類(範囲内の数・風上を追加。選択肢の差が小さい)'][ST.lv] + '</div>' +
    (hasBlk ? '<div class="q" style="margin-top:10px">② 町をえらぶ</div><div class="scen">20町=蒲田消防署の管内の20の町。「苦手な町」は、正答率の低い町から出ます。</div><select id="tw"><option value="all">20町ぜんぶ</option><option value="weak">苦手な町(正答率の低い順)</option>' + tw.map(t => '<option>' + t + '</option>').join('') + '</select>' : '<div class="scen" style="margin-top:10px">町は選べません。管理者が住所データを入れると、20町ごとに練習できます。いまは、水利のまわりから出題します。</div>') +
    '<button class="btn big pri" onclick="start()">③ はじめる(' + CONFIG.quiz.count + '問)</button>' + (ms ? '<button class="btn big" onclick="start(true)">間違えた問題を復習(' + ms + '問)</button>' : '') +
    '<div class="exp"><b>これまで</b> 全体 ' + acc(ST.tot) + (hasBlk ? '<br>苦手:' + (CONFIG.towns.filter(t => ST.towns[t] && ST.towns[t].n >= 3).sort((a, b) => ST.towns[a].ok / ST.towns[a].n - ST.towns[b].ok / ST.towns[b].n).slice(0, 3).map(t => t + ' ' + acc(ST.towns[t])).join('、') || 'まだ分かりません') : '') + '</div>';
}
function start(review) {
  if (!Ledger.items.length) { $('qpanel').innerHTML = '<div class="exp">水利データがありません。管理者にお知らせください。</div>'; return; }
  const sel = $('tw') ? $('tw').value : 'all', pl = pool(sel);
  Q = { lv: ST.lv, pl, i: 0, ok: 0, ms: [], miss: [], types: {}, list: review ? ST.miss.slice(0, CONFIG.quiz.count).map(q => q) : null, total: review ? Math.min(ST.miss.length, CONFIG.quiz.count) : CONFIG.quiz.count, review: !!review };
  next();
}
function next() {
  if (Q.i >= Q.total) return result();
  const q = Q.list ? Q.list[Q.i] : gen(Q.lv, Q.pl); if (!q) { $('qpanel').innerHTML = '<div class="exp">この範囲では出題できません(水利が少ない)。別の町か、住所データなしでお試しください。</div><button class="btn big" onclick="menu()">もどる</button>'; return; }
  Q.cur = q; Q.i++; q.t0 = performance.now(); $('qt').textContent = '第' + Q.i + '問 / ' + Q.total + '  正解 ' + Q.ok + '  [' + TYPE[q.t] + ']';
  const opts = q.t === 2 || q.t === 4 ? q.v.map(v => [v, v + (q.t === 2 ? '本' : '基')]) : q.t === 3 ? q.dv.map(i => [i, DIRS[i]]) : q.items.map(x => [x.L, x.L + '  ' + (Util.isTank(x.w) ? '防火水槽' : '消火栓')]);
  $('qpanel').innerHTML = '<div class="scen">' + q.scen + '</div><div class="q">' + q.text + '</div>' + opts.map(o => '<button class="opt" data-v="' + o[0] + '">' + o[1] + '</button>').join('') + '<div id="fb"></div>';
  $('qpanel').querySelectorAll('.opt').forEach(b => b.onclick = () => answer(b.dataset.v)); drawQ(q, false);
}
function answer(v) {
  const q = Q.cur; if (q.done) return; q.done = 1; const ms = performance.now() - q.t0, t = q.t;
  const right = t === 2 || t === 4 ? +v === q.n : t === 3 ? +v === q.ci : v === q.ans.L; if (right) Q.ok++; else { Q.miss.push(q); }
  Q.ms.push(ms); const T = Q.types[t] = Q.types[t] || { n: 0, ok: 0 }; T.n++; if (right) T.ok++;
  ST.tot.n++; if (right) ST.tot.ok++; const ty = ST.types[t] = ST.types[t] || { n: 0, ok: 0 }; ty.n++; if (right) ty.ok++;
  if (q.p.town) { const w = ST.towns[q.p.town] = ST.towns[q.p.town] || { n: 0, ok: 0 }; w.n++; if (right) w.ok++; }
  ST.miss = ST.miss.filter(m => m.sig !== q.sig); if (!right) { q.sig = q.sig || ('s' + Date.now()); ST.miss.unshift(JSON.parse(JSON.stringify(Object.assign({}, q, { t0: 0, done: 0 })))); ST.miss = ST.miss.slice(0, 20); }
  save();
  document.querySelectorAll('.opt').forEach(b => { b.disabled = true; const r = t === 2 || t === 4 ? +b.dataset.v === q.n : t === 3 ? +b.dataset.v === q.ci : b.dataset.v === q.ans.L; if (r) b.classList.add('ok'); else if (b.dataset.v === v) b.classList.add('ng'); });
  const lst = q.items.concat(q.ban ? [q.ban] : []).slice().sort((a, b) => a.d - b.d).map(x => (x.L || '') + ' ' + DIRS[dirIdx(x.b)] + ' ' + Math.round(x.d) + 'm' + (x === q.ban ? '(使えない)' : '')).join(' / ');
  let e = right ? '<b>正解!</b> ' : '<b>不正解。</b> ';
  if (t === 2) e += '直線' + Math.round(q.items[0].d) + 'm × ' + CONFIG.hose.factor + ' ÷ 20m = ' + (q.items[0].d * CONFIG.hose.factor / 20).toFixed(1) + ' → 切り上げて<b>' + q.n + '本</b>';
  else if (t === 3) e += '最寄りは<b>' + DIRS[q.ci] + ' ' + Math.round(q.items[0].d) + 'm</b>。';
  else if (t === 4) e += '円の中の消火栓は<b>' + q.n + '基</b>。';
  else if (t === 6) e += '風上側で最も近いのは<b>' + q.ans.L + '(' + Math.round(q.ans.d) + 'm)</b>。風下側にもっと近い水利があっても、風上を優先して考えます。<br>' + lst;
  else e += '正解は<b>' + q.ans.L + '</b>(' + DIRS[dirIdx(q.ans.b)] + ' ' + Math.round(q.ans.d) + 'm)。<br>' + lst;
  $('fb').innerHTML = '<div class="exp">' + e + '<br><small>' + (ms / 1000).toFixed(1) + '秒</small></div><button class="btn big pri" onclick="next()">' + (Q.i >= Q.total ? '結果を見る' : '次へ') + '</button>';
  $('qt').textContent = '第' + Q.i + '問 / ' + Q.total + '  正解 ' + Q.ok + '  [' + TYPE[t] + ']'; drawQ(q, true); $('qpanel').scrollTop = $('qpanel').scrollHeight;
}
function result() {
  LYR.clearLayers(); const avg = Q.ms.reduce((a, b) => a + b, 0) / Math.max(1, Q.ms.length) / 1000, pct = Math.round(Q.ok / Math.max(1, Q.total) * 100);
  const byT = Object.entries(Q.types).map(([t, v]) => '<div class="rowk"><span>' + TYPE[t] + '</span><b>' + v.ok + ' / ' + v.n + '</b></div>').join('');
  const msg = pct >= 90 ? 'すばらしい。レベルを上げてみましょう。' : pct >= 60 ? 'よくできています。間違えた問題を復習しましょう。' : '地図で場所を見直して、もう一度。';
  $('qt').textContent = '結果'; $('qpanel').innerHTML = '<div class="q" style="font-size:1.4em">' + Q.ok + ' / ' + Q.total + ' 問正解(' + pct + '%)</div><div class="scen">1問あたり平均 ' + avg.toFixed(1) + '秒 ・ ' + LV[Q.lv].n + '</div><div class="exp">' + msg + '</div>' + byT +
    '<button class="btn big pri" onclick="start(false)">もう一度</button>' + (ST.miss.length ? '<button class="btn big" onclick="start(true)">間違えた問題を復習(' + ST.miss.length + '問)</button>' : '') + '<button class="btn big" onclick="menu()">設定にもどる</button>';
}

/* E. 起動 ------------------------------------------------- */
(async function () { await Ledger.load(); menu(); })();
