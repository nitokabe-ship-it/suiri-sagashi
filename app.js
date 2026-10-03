/* ============================================================
 利用者画面のプログラム(index.html)
  A. 状態と地図   B. 描画   C. 経路   D. 現場マーカー
  E. 下の表示     F. 操作   G. 起動
============================================================ */
const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* A. 状態と地図 ------------------------------------------- */
const S = {
  all: [], rows: [],                    // all=範囲内の水利 / rows=絞り込み後
  radius: CONFIG.search.radii[1], manual: false, filter: 'all',
  sel: null, route: null,               // 選んだ水利のキー / その経路
  insp: { on: false, cur: null, stack: [], skip: [] },   // 点検モード:いまの水利 / 戻る用 / 「あとで」にした水利
  mode: null, draw: [], cand: [],       // 操作中のモード / 描いている点 / 住所の候補
  open: !!Store.get(K.sheetOpen, 0), lh: Store.get(K.listH, 0)   // 一覧を開いているか / 一覧の高さ
};
const map = L.map('map', { zoomControl: false }).setView(CONFIG.map.center, CONFIG.map.zoom);
map.attributionControl.setPrefix(false);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer(CONFIG.map.tileUrl, { maxZoom: CONFIG.map.maxZoom, attribution: CONFIG.map.attribution }).addTo(map);
const LY = {}; ['fire', 'water', 'field', 'route', 'tmp'].forEach(n => LY[n] = L.layerGroup().addTo(map));
const fireOf = () => Incident.d.fire;
const stOf = w => S.insp.on ? (Insp.doneToday(Incident.key(w)) ? (Insp.get(Incident.key(w)).s || 0) : 0) : Incident.status(w);   // 点検中は「今日の点検結果」、ふだんは現場の状態
const wide = () => matchMedia('(min-width:700px)').matches;

function toast(msg, undo) {
  const e = $('toast'); e.innerHTML = Util.esc(msg) + (undo ? ' <button class="btn" style="display:inline-block;min-height:36px;line-height:32px;margin-left:8px;padding:0 10px" id="undo">元に戻す</button>' : '');
  e.style.display = 'block'; if (undo) $('undo').onclick = () => { undo(); e.style.display = 'none'; };
  clearTimeout(toast.t); toast.t = setTimeout(() => e.style.display = 'none', undo ? 6000 : 2000);
}
function calc() {
  const f = fireOf(); if (!f) { S.all = []; S.rows = []; return; }
  S.all = Ledger.items.map(w => { const k = Incident.key(w), p = (Insp.get(k) || {}).p, la = p ? p[0] : w.lat, ln = p ? p[1] : w.lng; return { w, k, la, ln, d: Util.dist(f.lat, f.lng, la, ln) }; }).filter(x => x.d <= S.radius).sort((a, b) => a.d - b.d);
  S.rows = S.all.filter(x => S.filter === 'all' || (S.filter === 'tank') === Util.isTank(x.w));
}
function autoRadius() { for (const r of CONFIG.search.autoRadii) { S.radius = r; calc(); if (S.rows.length >= CONFIG.search.minHits) break; } }
function labelNow(lat, lng) {           // 火点を動かした直後の住所表示。街区データがあれば「〇丁目〇番付近」、なければ座標(すぐ下の relabel で町丁目に直す)
  const b = Addr.nearestBlock(lat, lng); return b ? Addr.fmt(b.t) + '付近' : lat.toFixed(5) + ', ' + lng.toFixed(5);
}
async function relabel(lat, lng) {      // 街区データがないとき、国土地理院の逆引きで「〇丁目付近」に直す(通信できなければ座標のまま)
  if (Addr.nearestBlock(lat, lng)) return; const l = await Addr.reverse(lat, lng), f = fireOf();
  if (l && f && f.lat === lat && f.lng === lng) { f.label = l; Incident.save(); $('q').value = l; Sync.send('/fire', f); }
}

/* B. 描画 ------------------------------------------------- */
function mkHtml(w, rank) {
  const st = STATUS[stOf(w)], tank = Util.isTank(w);
  return '<div style="position:relative"><div class="mk ' + (tank ? 'tank' : '') + '" style="--c:' + st.c + ';--t:' + st.t + '" data-s="' + st.s + '">' + (tank ? '水' : '栓') + '</div>' +
    (rank < 3 ? '<div class="dl">' + Math.round(S.rows[rank].d) + 'm</div>' : '') + '</div>';
}
function drawFire() {
  LY.fire.clearLayers(); const f = fireOf(); if (!f) return;
  L.marker([f.lat, f.lng], { icon: L.divIcon({ className: '', html: '<div class="fire">🔥</div>', iconSize: [30, 30], iconAnchor: [15, 15] }), draggable: true, zIndexOffset: 2000 })
    .addTo(LY.fire).on('dragend', e => { const p = e.target.getLatLng(); setFire(p.lat, p.lng, labelNow(p.lat, p.lng), { keepView: true, keepSel: true, relabel: true }); });
  L.circle([f.lat, f.lng], { radius: S.radius, color: '#e5352b', weight: 2, fillOpacity: .04, interactive: false }).addTo(LY.fire);
}
function drawWater() {
  LY.water.clearLayers();
  S.rows.forEach((x, i) => { const m = L.marker([x.la, x.ln], { icon: L.divIcon({ className: x.k === S.sel ? 'sel' : '', html: mkHtml(x.w, i), iconSize: [28, 28], iconAnchor: [14, 14] }), draggable: S.insp.on && x.k === S.insp.cur }).addTo(LY.water); m.on('click', () => pick(i)); m.on('dragend', e => inspMove(x.k, e.target.getLatLng())); });
}
function drawRoute() {
  LY.route.clearLayers(); if (S.route) L.polyline(S.route.pts, { color: '#1d4ed8', weight: 6, opacity: .9, interactive: false }).addTo(LY.route);
}
function renderAll(fit) { drawFire(); drawWater(); drawField(); drawRoute(); renderSheet(); if (fit && fireOf()) fitFire(); }
function pads() { const h = $('sheet').offsetHeight || 0; return wide() ? { paddingTopLeft: [450, 70], paddingBottomRight: [60, 20] } : { paddingTopLeft: [10, 70], paddingBottomRight: [10, h + 10] }; }
function fitFire() { const f = fireOf(), dy = S.radius / 111320, dx = S.radius / (111320 * Math.cos(f.lat * Math.PI / 180)); map.fitBounds([[f.lat - dy, f.lng - dx], [f.lat + dy, f.lng + dx]], Object.assign(pads(), { animate: false })); }
/* 火点を決める。keepView:地図の位置・範囲を変えない / keepSel:選んだ水利をそのまま */
function setFire(lat, lng, label, o = {}) {
  Incident.setFire({ lat, lng, label, rough: !!o.rough }); $('q').value = label;   // 上の住所と下の表示を必ず同じにする
  if (!o.keepSel) { S.sel = null; S.route = null; }
  if (!o.keepView && !S.manual) autoRadius(); else calc();
  renderAll(!o.keepView); if (o.relabel) relabel(lat, lng);
  if (o.keepSel && S.sel) { if (selRow()) loadRoute(false); else { S.sel = null; S.route = null; renderSheet(); } }
}

/* C. 経路(ホース) ----------------------------------------- */
const Route = {
  last: 0,
  length: pts => pts.reduce((s, p, i) => i ? s + Util.dist(pts[i - 1][0], pts[i - 1][1], p[0], p[1]) : 0, 0),
  async auto(a, b) {                    // 道路に沿った徒歩ルート。取れなければ「直線×係数」の目安。一度取れた経路は端末に残す
    const ck = a.lat.toFixed(5) + ',' + a.lng.toFixed(5) + ';' + b.lat.toFixed(5) + ',' + b.lng.toFixed(5), RC = Store.get(K.rcache, {}); if (RC[ck]) return Object.assign({}, RC[ck]);
    const wait = 1100 - (Date.now() - this.last); if (wait > 0) await sleep(wait); this.last = Date.now();
    try {
      const c = new AbortController(), t = setTimeout(() => c.abort(), 8000);
      const j = await (await fetch(CONFIG.route.url + a.lng + ',' + a.lat + ';' + b.lng + ',' + b.lat + '?overview=full&geometries=geojson', { signal: c.signal })).json(); clearTimeout(t);
      const r = j.routes && j.routes[0]; if (!r) throw 0;
      const out = { pts: r.geometry.coordinates.map(p => [p[1], p[0]]), len: r.distance, src: 'road' }; RC[ck] = out; const ks = Object.keys(RC); if (ks.length > 40) delete RC[ks[0]]; Store.set(K.rcache, RC); return out;
    } catch (e) { return { pts: [[a.lat, a.lng], [b.lat, b.lng]], len: Util.dist(a.lat, a.lng, b.lat, b.lng) * CONFIG.hose.factor, src: 'estimate' }; }
  },
  crossesClosure(pts) {
    const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]), X = (a, b, c, d) => o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
    return Incident.d.mk.filter(m => m.type === 'road').some(r => r.path.some((_, i) => i < r.path.length - 1 && pts.some((_, j) => j < pts.length - 1 && X(r.path[i], r.path[i + 1], pts[j], pts[j + 1]))));
  }
};
const selRow = () => S.all.find(x => x.k === S.sel);
async function loadRoute(fit = true) {  // 選んだ水利から火点までの経路
  const x = selRow(), f = fireOf(); if (!x) return; const key = x.k, man = Incident.d.rt[key];
  if (man) S.route = { pts: man.slice(0, -1).concat([[f.lat, f.lng]]), len: 0, src: 'manual' };
  else { S.route = null; renderDetail(); const r = await Route.auto({ lat: x.la, lng: x.ln }, f); if (S.sel !== key) return; S.route = r; }
  S.route.len = S.route.src === 'manual' ? Route.length(S.route.pts) : S.route.len;
  S.route.warn = Route.crossesClosure(S.route.pts); drawRoute(); renderDetail();
  if (fit) map.fitBounds(L.latLngBounds(S.route.pts.concat([[f.lat, f.lng]])), Object.assign(pads(), { maxZoom: 18 }));
}
function pick(i) {
  if (S.mode) return; if (S.insp.on) { S.insp.cur = S.rows[i].k; inspFocus(); return; } const k = S.rows[i].k; S.sel = S.sel === k ? null : k; S.route = null; drawWater(); drawRoute(); renderDetail(); renderList();
  if (S.sel) loadRoute(true);
}
function setBar(text, btns) {           // 画面下の細い操作バー
  const b = $('modebar'); document.body.classList.toggle('mode', !!text);
  b.innerHTML = text ? '<div class="t">' + text + '</div>' + btns.map(x => '<button class="btn" data-act="' + x[1] + '">' + x[0] + '</button>').join('') : '';
  syncZoom();
}
function endMode() { S.mode = null; S.draw = []; LY.tmp.clearLayers(); setBar(''); }
function renderTmp() {
  LY.tmp.clearLayers(); const f = fireOf();
  if (S.draw.length) L.polyline(S.draw.concat(S.mode === 'route' ? [[f.lat, f.lng]] : []), { color: S.mode === 'route' ? '#1d4ed8' : '#e5352b', weight: S.mode === 'route' ? 5 : 9, opacity: .65, dashArray: S.mode === 'route' ? '4 9' : null, interactive: false }).addTo(LY.tmp);
  S.draw.forEach(p => L.circleMarker(p, { radius: 5, color: '#fff', weight: 2, fillColor: '#111', fillOpacity: 1, interactive: false }).addTo(LY.tmp));
  if (S.mode === 'route') { const n = Route.length(S.draw.concat([[f.lat, f.lng]])); $('modebar').querySelector('.t').innerHTML = '道路の曲がる所を順にタップ<br><b>約' + Math.round(n) + 'm・最低' + Math.ceil(n / CONFIG.hose.length) + '本</b>'; }
}

/* D. 現場マーカー ----------------------------------------- */
const SVG = {                           // 消防車(運転席が右・はしごつき)と積載車(運転席が左・荷台にポンプとホースリール)を、形と色で見分ける
  truck: '<svg viewBox="0 0 64 36" width="48" height="27"><rect x="2" y="12" width="40" height="14" rx="2" fill="#d32f2f"/><rect x="3" y="7.5" width="37" height="3.2" rx="1" fill="#cfd8dc" stroke="#607d8b" stroke-width=".8"/><rect x="6" y="4.5" width="30" height="2" fill="#90a4ae"/><path d="M42 26V14c0-1.5.8-2.4 2-3l4-2c1-.5 2-.8 3.2-.8H58c1.5 0 2.5.8 3 2l1.5 5V26z" fill="#d32f2f"/><path d="M46 14l3-3.2h9l2 3.2z" fill="#d6ecff" stroke="#8aa" stroke-width=".6"/><path d="M12 13v7M22 13v7M32 13v7" stroke="#9e1b1b" stroke-width="1"/><rect x="2" y="20.5" width="60" height="2.2" fill="#fff"/><rect x="48" y="4.5" width="9" height="3.4" rx="1" fill="#ffb300"/><circle cx="14" cy="27" r="5.2" fill="#222" stroke="#fff" stroke-width="1.6"/><circle cx="14" cy="27" r="1.9" fill="#b0bec5"/><circle cx="52" cy="27" r="5.2" fill="#222" stroke="#fff" stroke-width="1.6"/><circle cx="52" cy="27" r="1.9" fill="#b0bec5"/></svg>',
  loader: '<svg viewBox="0 0 64 36" width="48" height="27"><rect x="22" y="15" width="40" height="11" rx="2" fill="#c62828"/><rect x="22" y="13" width="40" height="3" rx="1" fill="#8e1b1b"/><rect x="27" y="6" width="15" height="8" rx="1.5" fill="#cfd8dc" stroke="#607d8b" stroke-width="1"/><rect x="30" y="8" width="9" height="2" fill="#607d8b"/><circle cx="51" cy="9.5" r="5.5" fill="#fff" stroke="#c62828" stroke-width="2.2"/><circle cx="51" cy="9.5" r="2" fill="#c62828"/><path d="M2 26v-9c0-1.5 1-2.5 2.2-3.2l6-4.3c1-.7 2-1 3.2-1H21c1 0 1.5.6 1.5 1.6V26z" fill="#d32f2f"/><path d="M6 16.5l4.6-3.4c.5-.4 1-.5 1.6-.5H19v6H6z" fill="#d6ecff" stroke="#8aa" stroke-width=".6"/><rect x="2" y="21.5" width="60" height="2.2" fill="#fff"/><rect x="11" y="6" width="8" height="3.2" rx="1" fill="#ffb300"/><rect x="13" y="4.2" width="4" height="2" rx="1" fill="#ff7043"/><circle cx="13" cy="27" r="5.2" fill="#222" stroke="#fff" stroke-width="1.6"/><circle cx="13" cy="27" r="1.9" fill="#b0bec5"/><circle cx="50" cy="27" r="5.2" fill="#222" stroke="#fff" stroke-width="1.6"/><circle cx="50" cy="27" r="1.9" fill="#b0bec5"/></svg>'
};
const MK = { truck: { n: '消防車', s: '消防' }, loader: { n: '積載車', s: '積載' }, guard: { n: '警備地点' }, road: { n: '通行止め' } };
function drawField() {
  LY.field.clearLayers();
  Incident.d.mk.forEach(m => {
    let L1;
    if (m.type === 'road') L1 = L.polyline(m.path, { color: '#e5352b', weight: 10, opacity: .6 }).addTo(LY.field);
    else {
      const html = m.type === 'guard' ? '<div class="guard">' + Util.esc(m.name) + '</div>' : '<div class="veh">' + SVG[m.type] + '<span>' + MK[m.type].s + '</span></div>';
      L1 = L.marker([m.lat, m.lng], { icon: L.divIcon({ className: '', html, iconSize: [50, 42], iconAnchor: [25, 21] }), draggable: true }).addTo(LY.field);
      L1.on('dragend', e => { const p = e.target.getLatLng(); m.lat = p.lat; m.lng = p.lng; Incident.putMk(m); });
    }
    L1.bindPopup('<b>' + (m.type === 'guard' ? Util.esc(m.name) + '地点' : MK[m.type].n) + '</b><br><button class="btn" style="margin-top:6px;min-height:44px;line-height:40px" data-act="delmk" data-v="' + m.id + '">削除</button>' + (m.type === 'road' ? '' : '<div class="note">指でずらすと移動できます</div>'));
  });
}
map.on('popupopen', e => e.popup.getElement().querySelectorAll('[data-act]').forEach(b => b.onclick = () => ACT[b.dataset.act](b)));
function addMarker(m) { m.id = 'm' + Date.now(); Incident.putMk(m); Incident.log((m.type === 'guard' ? m.name + '地点' : MK[m.type].n) + 'を置く'); drawField(); }

/* E. 下の表示 --------------------------------------------- */
function renderSheet() {
  const sh = $('sheet'), f = fireOf();
  if (!Ledger.items.length) { sh.style.display = 'flex'; $('grab').style.display = 'none'; $('shead').innerHTML = '<div class="msg">水利データがありません。管理者にお知らせください。</div>'; $('sdetail').innerHTML = $('slist').innerHTML = ''; return; }
  if (!f) { sh.style.display = 'none'; return; }
  sh.style.display = 'flex'; $('grab').style.display = ''; if (S.insp.on) { renderInspect(); return; }
  const n = t => S.all.filter(x => (t === 'tank') === Util.isTank(x.w)).length;
  $('shead').innerHTML = '<button class="sum" data-act="toggle">● 消火栓<b>' + n('gate') + '</b>■ 水槽<b>' + n('tank') + '</b> ' + (S.open ? '▼' : '▲') + '</button><button class="rng" data-act="radius">範囲 ' + S.radius + 'm</button>';
  renderDetail(); renderList();
}
function renderDetail() {
  const x = selRow(), el = $('sdetail'); if (S.insp.on) return renderInspect(); if (!x) { el.innerHTML = ''; syncZoom(); return; }
  const w = x.w, st = stOf(w), tank = Util.isTank(w), s0 = STATUS[st], r = S.route; let hose = '<span>道路ルートを計算中…</span>';
  if (r) { const L0 = Math.round(r.len), min = Math.ceil(L0 / CONFIG.hose.length), spare = Math.max(min + 1, Math.ceil(L0 * CONFIG.hose.slack / CONFIG.hose.length));
    hose = '<span class="hb">' + min + '本</span><span>最低 / 余裕 <b>' + spare + '本</b> ・ <b>' + L0 + 'm</b></span><small>' + { road: '道路ルート(目安)', manual: '描いた経路', estimate: '直線×' + CONFIG.hose.factor + '(目安)' }[r.src] + '</small>' + (r.warn ? '<span class="alert">⚠ 通行止めを通ります</span>' : ''); }
  el.innerHTML = '<div class="detail"><div class="drow"><div class="mk small ' + (tank ? 'tank' : '') + '" style="--c:' + s0.c + ';--t:' + s0.t + '" data-s="' + s0.s + '">' + (tank ? '水' : '栓') + '</div><div class="n"><b>' + (tank ? '防火水槽' : '消火栓') + '</b><small>' + Util.esc(w.name) + '</small></div><span class="dd">直線' + Math.round(x.d) + 'm</span><button class="x" data-act="back" aria-label="選択をやめる">✕</button></div>' +
    '<div class="st">' + STATUS.map((s, i) => '<button class="' + (i === st ? 'on' : '') + '" style="--c:' + s.c + ';--t:' + s.t + '" data-act="status" data-v="' + i + '"><b>' + s.s + '</b>' + s.n + '</button>').join('') + '</div>' +
    '<div class="hose">' + hose + '</div>' + lastCk(x.k) + '<div class="acts"><button class="btn" data-act="drawroute">✏ 経路を描く</button>' + (Incident.d.rt[x.k] ? '<button class="btn" data-act="resetroute">自動にもどす</button>' : '') + '</div></div>';
  syncZoom();
}
function renderList() {
  const el = $('slist'), f = fireOf(); if (!f) return; if (S.insp.on) { el.style.display = 'none'; return; } el.style.display = S.open ? '' : 'none'; if (!S.open) { syncZoom(); return; }
  if (S.lh) el.style.maxHeight = S.lh + 'px'; const top = el.scrollTop, chip = (t, l) => '<button class="chip ' + (S.filter === t ? 'on' : '') + '" data-act="filter" data-v="' + t + '">' + l + '</button>';
  el.innerHTML = '<div class="chips">' + chip('all', '全部') + chip('gate', '● 消火栓') + chip('tank', '■ 水槽') + '</div>' +
    (S.rows.slice(0, CONFIG.search.listMax).map((x, i) => { const s = STATUS[stOf(x.w)], t = Util.isTank(x.w);
      return '<div class="it ' + (x.k === S.sel ? 'sel' : '') + '" data-act="pick" data-v="' + i + '"><div class="mk small ' + (t ? 'tank' : '') + '" style="--c:' + s.c + ';--t:' + s.t + '" data-s="' + s.s + '">' + (t ? '水' : '栓') + '</div><div class="n"><b>' + (t ? '防火水槽' : '消火栓') + '</b> ' + s.n + '<small>' + Util.esc(x.w.name) + '</small></div><div class="d"><span>' + Util.dir(f.lat, f.lng, x.la, x.ln) + '</span>' + Math.round(x.d) + 'm</div></div>'; }).join('') ||
      '<p>この範囲に水利がありません。「範囲」を押して広げてください。</p>') + '<div class="foot">水利データ:' + Ledger.label() + '(位置は多少ずれる場合があります・距離は直線)</div>';
  el.scrollTop = top; syncZoom();
}
function syncZoom() {                   // 拡大縮小ボタンを、下の表示の真上に置く
  const h = document.body.classList.contains('mode') ? $('modebar').offsetHeight + 12 : (wide() ? 12 : ($('sheet').style.display === 'none' ? 12 : $('sheet').offsetHeight + 8));
  document.documentElement.style.setProperty('--sh', h + 'px');
}
new ResizeObserver(syncZoom).observe($('sheet'));
(function grab() {                      // 取っ手:タップで開閉・ドラッグで一覧の高さ変更
  const g = $('grab'); let y0 = 0, h0 = 0, mv = false;
  g.addEventListener('pointerdown', e => { y0 = e.clientY; h0 = $('slist').offsetHeight; mv = false; g.setPointerCapture(e.pointerId); });
  g.addEventListener('pointermove', e => { if (!g.hasPointerCapture(e.pointerId)) return; if (Math.abs(e.clientY - y0) > 6) mv = true; if (!mv) return;
    if (!S.open) { S.open = true; renderList(); } S.lh = Math.max(70, Math.min(innerHeight * .6, h0 + y0 - e.clientY)); $('slist').style.maxHeight = S.lh + 'px'; syncZoom(); });
  g.addEventListener('pointerup', () => { if (mv) Store.set(K.listH, Math.round(S.lh)); else ACT.toggle(); Store.set(K.sheetOpen, S.open ? 1 : 0); });
})();

/* F. 操作 ------------------------------------------------- */
const ACT = {
  async search() {
    $('menu').style.display = 'none'; const q = $('q').value.trim(), c = $('cand'); if (!q) { $('q').focus(); return; }
    const ll = Addr.parseLatLng(q); if (ll) { c.style.display = 'none'; return setFire(ll.lat, ll.lng, labelNow(ll.lat, ll.lng), { relabel: true }); }
    c.style.display = 'block'; c.innerHTML = '<div>さがしています…</div>';
    const r = await Addr.search(q);
    if (!r.list.length) { c.innerHTML = '<div style="color:#b00">' + { none: '住所が見つかりません。「南蒲田3-5」のように、町名と番地で入れてください。', offline: '通信できません。電波のある所で、もう一度お試しください。', gsioff: '住所データに見つかりません。管理者にお知らせください。' }[r.problem] + '</div>'; return; }
    S.cand = r.list.slice(0, 6).map(x => Object.assign({}, x, { title: Addr.withGou(x.title, q) })); if (S.cand.length === 1) ACT.cand({ dataset: { v: 0 } });
    else c.innerHTML = S.cand.map((x, i) => '<button data-act="cand" data-v="' + i + '">' + Util.esc(x.title) + '</button>').join('');
  },
  cand(el) {
    const x = S.cand[+el.dataset.v]; $('cand').style.display = 'none'; $('q').blur();
    const h = Store.get(K.history, []).filter(y => y.l !== x.title); h.unshift({ l: x.title, lat: x.lat, lng: x.lng, rough: x.rough }); Store.set(K.history, h.slice(0, 8)); setFire(x.lat, x.lng, x.title, { rough: x.rough });
  },
  hist(el) { const h = Store.get(K.history, [])[+el.dataset.v]; $('cand').style.display = 'none'; $('q').blur(); setFire(h.lat, h.lng, h.l, { rough: h.rough }); },
  loc() {
    if (!navigator.geolocation) return toast('この端末では位置情報が使えません'); toast('現在地を調べています…');
    navigator.geolocation.getCurrentPosition(p => setFire(p.coords.latitude, p.coords.longitude, labelNow(p.coords.latitude, p.coords.longitude), { relabel: true }), () => toast('現在地を取得できません(位置情報の許可を確認してください)'), { enableHighAccuracy: true, timeout: 15000 });
  },
  menu() { const m = $('menu'); m.style.display = m.style.display === 'block' ? 'none' : 'block'; },
  toggle() { S.open = !S.open; Store.set(K.sheetOpen, S.open ? 1 : 0); renderSheet(); },
  filter(el) { S.filter = el.dataset.v; calc(); drawWater(); renderSheet(); },
  radius() { const r = CONFIG.search.radii; S.radius = r[(r.indexOf(S.radius) + 1) % r.length]; S.manual = true; S.sel = null; S.route = null; calc(); renderAll(true); },
  pick(el) { pick(+el.dataset.v); },
  back() { S.sel = null; S.route = null; drawWater(); drawRoute(); renderDetail(); renderList(); },
  status(el) {                          // 状態を変えても、地図・一覧・表示の大きさは動かさない(色と記号だけ変わる)
    const x = selRow(); if (!x) return; const v = +el.dataset.v; Incident.setStatus(x.w, v); toast((Util.isTank(x.w) ? '防火水槽' : '消火栓') + ':' + STATUS[v].n);
    drawWater(); renderDetail(); renderList();
  },
  drawroute() {
    const x = selRow(); if (!x) return; S.mode = 'route'; S.draw = [[x.la, x.ln]];
    setBar('', []); setBar('x', [['戻す', 'm_undo'], ['最初から', 'm_reset'], ['完了', 'm_finish']]); renderTmp();
  },
  resetroute() { const x = selRow(); Incident.setRoute(x.k, null); S.route = null; loadRoute(false); },
  mkmenu() { $('menu').style.display = 'none'; if (S.insp.on) return toast('点検を終えてから使えます'); if (!fireOf()) return toast('先に住所をさがしてください'); $('mkmenu').style.display = 'block'; },
  addmk(el) {
    const t = el.dataset.v; $('mkmenu').style.display = 'none'; endMode(); S.sel = null; S.route = null; drawWater(); drawRoute(); renderSheet(); S.mode = 'mk:' + t;
    if (t === 'road') setBar('通行止めの道路に沿って<br>2か所以上タップ', [['戻す', 'm_undo'], ['取消', 'm_cancel'], ['完了', 'm_finish']]);
    else setBar(MK[t].n + 'を置く場所を<br>地図でタップ', [['取消', 'm_cancel']]);
  },
  delmk(el) { const m = Incident.d.mk.find(x => x.id === el.dataset.v); if (!m) return; Incident.delMk(m.id); map.closePopup(); drawField(); toast('削除しました', () => { Incident.putMk(m); drawField(); }); },
  m_undo() { S.draw.pop(); if (S.mode === 'route' && !S.draw.length) { const x = selRow(); S.draw = [[x.la, x.ln]]; } renderTmp(); },
  m_reset() { const x = selRow(); S.draw = [[x.la, x.ln]]; renderTmp(); },
  m_cancel() { endMode(); renderSheet(); },
  m_finish() {
    if (S.mode === 'route') { const f = fireOf(), x = selRow(); Incident.setRoute(x.k, S.draw.concat([[f.lat, f.lng]])); endMode(); S.route = null; renderSheet(); loadRoute(false); toast('経路を保存しました'); }
    else if (S.mode === 'mk:road') { if (S.draw.length < 2) return toast('2か所以上タップしてください'); const m = S.draw[Math.floor(S.draw.length / 2)]; addMarker({ type: 'road', path: S.draw.slice(), lat: m[0], lng: m[1] }); endMode(); renderSheet(); toast('通行止めを置きました'); if (S.sel) loadRoute(false); }
  },
  share() {
    $('menu').style.display = 'none'; const url = location.origin + location.pathname + '#s=' + Incident.encode();
    if (navigator.share) navigator.share({ title: '水利さがし', url }).catch(() => {}); else navigator.clipboard ? navigator.clipboard.writeText(url).then(() => toast('共有リンクをコピーしました'), () => toast('コピーできませんでした')) : toast('コピーできませんでした');
  },
  help() { $('menu').style.display = 'none'; $('help').style.display = 'block'; }, closemodal() { document.querySelectorAll('.modal').forEach(m => m.style.display = 'none'); },
  font() { $('menu').style.display = 'none'; const v = document.documentElement.classList.toggle('large'); Store.set(K.largeFont, v ? 1 : 0); setTimeout(syncZoom, 50); },
  endincident() { if (!confirm('この現場の記録を終了します。「過去の現場」に残してから、画面を空にします。よろしいですか?')) return; Past.add(); Incident.clear(); S.sel = null; S.route = null; S.all = []; S.rows = []; $('q').value = ''; ACT.closemodal(); renderAll(false); toast('記録を消しました'); }
};
document.addEventListener('click', e => { const el = e.target.closest('[data-act]'); if (el && ACT[el.dataset.act]) ACT[el.dataset.act](el); });
map.on('click', e => {
  $('cand').style.display = 'none'; $('menu').style.display = 'none'; if (!S.mode) return; const p = [e.latlng.lat, e.latlng.lng];
  if (S.mode === 'route' || S.mode === 'mk:road') { S.draw.push(p); renderTmp(); }
  else if (S.mode.startsWith('mk:')) { const t = S.mode.slice(3); addMarker({ type: t, lat: p[0], lng: p[1], name: t === 'guard' ? Incident.nextGuardName() : '' }); endMode(); renderSheet(); toast(MK[t].n + 'を置きました'); }
});
map.on('contextmenu', e => { if (!S.mode) setFire(e.latlng.lat, e.latlng.lng, labelNow(e.latlng.lat, e.latlng.lng), { keepView: true, relabel: true }); });   // 長押し・右クリックで火点
$('q').addEventListener('keydown', e => { if (e.key === 'Enter') ACT.search(); });
$('q').addEventListener('input', () => { if ($('q').value.trim()) $('cand').style.display = 'none'; });
$('q').addEventListener('focus', e => {                  // 入力欄を押すと全選択(そのまま打ち替えられる)+最近の検索
  setTimeout(() => e.target.select(), 0); const h = Store.get(K.history, []); if (!h.length) return; const c = $('cand'); c.style.display = 'block';
  c.innerHTML = '<div>最近さがした場所</div>' + h.map((x, i) => '<button data-act="hist" data-v="' + i + '">' + Util.esc(x.l) + '</button>').join('');
});
addEventListener('resize', syncZoom);


/* H. 点検モード(水利を1つずつ、近い順に確認していく) --------- */
const MEMOS = ['見つからない', '水が出ない', 'ふたが固い', '位置がずれている', '障害物あり'];
const f2 = n => String(n).padStart(2, '0'), fmtT = t => { const d = new Date(t); return f2(d.getMonth() + 1) + '/' + f2(d.getDate()) + ' ' + f2(d.getHours()) + ':' + f2(d.getMinutes()); };
function lastCk(k) { const r = Insp.get(k); return r && r.t ? '<div class="note">最終点検 ' + fmtT(r.t) + ' ' + STATUS[r.s || 0].n + (r.m ? ' ・' + Util.esc(r.m) : '') + '</div>' : ''; }
function inspCounts() { const d = S.all.filter(x => Insp.doneToday(x.k)); return { all: S.all.length, done: d.length, ok: d.filter(x => Insp.get(x.k).s === 1).length, ng: d.filter(x => Insp.get(x.k).s === 3).length }; }
function inspNextFrom(from) {           // 次に点検する水利:直前の水利から一番近い、まだの水利
  const I = S.insp; let c = S.all.filter(x => !Insp.doneToday(x.k) && !I.skip.includes(x.k) && x.k !== from);
  if (!c.length) { I.skip = []; c = S.all.filter(x => !Insp.doneToday(x.k) && x.k !== from); } if (!c.length) return null;
  const o = from && S.all.find(x => x.k === from), ref = o ? { lat: o.la, lng: o.ln } : fireOf();
  c.sort((a, b) => Util.dist(ref.lat, ref.lng, a.la, a.ln) - Util.dist(ref.lat, ref.lng, b.la, b.ln)); return c[0].k;
}
function inspFocus() {                  // いまの水利を選び、地図は「ずらすだけ」(拡大率は変えない)
  const I = S.insp; S.sel = I.cur; drawWater(); renderSheet(); const x = S.all.find(y => y.k === I.cur);
  if (x && !map.getBounds().pad(-.15).contains([x.la, x.ln])) map.panTo([x.la, x.ln]);
}
function inspMove(k, ll) { Insp.set(k, { p: [ll.lat, ll.lng] }); Incident.log('点検:位置を直す'); calc(); drawWater(); renderInspect(); toast('位置を直しました'); }
function renderInspect() {
  const c = inspCounts(), f = fireOf(), x = S.all.find(y => y.k === S.insp.cur);
  $('shead').innerHTML = '<div class="sum" style="display:flex;align-items:center">✔ 点検 <b>' + c.done + ' / ' + c.all + '</b></div><button class="rng" data-act="inspend">終了</button>'; $('slist').style.display = 'none';
  if (!x) { $('sdetail').innerHTML = '<div class="detail"><b>点検が終わりました</b><div class="hose"><span>○ ' + c.ok + '件 ・ × ' + c.ng + '件 ・ 全' + c.all + '件</span></div><div class="acts"><button class="btn" data-act="inspcsv">結果をコピー</button><button class="btn pri" data-act="inspend">閉じる</button></div></div>'; syncZoom(); return; }
  const r = Insp.get(x.k) || {}, done = Insp.doneToday(x.k), w = x.w, tank = Util.isTank(w), s0 = STATUS[done ? (r.s || 0) : 0], ms = (r.m || '').split('、').filter(Boolean), b = (v, on) => '<button class="' + (on ? 'on' : '') + '" style="--c:' + STATUS[v].c + ';--t:' + STATUS[v].t + '" data-act="ck" data-v="' + v + '"><b>' + STATUS[v].s + '</b>' + STATUS[v].n + '</button>';
  $('sdetail').innerHTML = '<div class="detail"><div class="drow"><div class="mk small ' + (tank ? 'tank' : '') + '" style="--c:' + s0.c + ';--t:' + s0.t + '" data-s="' + s0.s + '">' + (tank ? '水' : '栓') + '</div><div class="n"><b>' + (tank ? '防火水槽' : '消火栓') + '</b><small>' + Util.esc(w.name) + '</small></div><span class="dd">' + Util.dir(f.lat, f.lng, x.la, x.ln) + ' ' + Math.round(x.d) + 'm</span></div>' +
    '<div class="st2">' + b(1, done && r.s === 1) + b(3, done && r.s === 3) + '</div>' +
    '<div class="chips memo">' + MEMOS.map(m => '<button class="chip ' + (ms.includes(m) ? 'on' : '') + '" data-act="ckmemo" data-v="' + m + '">' + m + '</button>').join('') + '</div>' +
    '<div class="acts"><button class="btn" data-act="ckback">← 戻る</button><button class="btn" data-act="ckskip">あとで →</button>' + (done && r.s === 3 ? '<button class="btn pri" data-act="cknext">次へ →</button>' : '') + '</div><div class="note">地図のマークをドラッグすると位置を直せます</div></div>'; syncZoom();
}

/* I. 記録・過去の現場・同期の窓 ---------------------------- */
function listModal(html) { $('listbody').innerHTML = html + '<button class="btn big pri" data-act="closemodal">閉じる</button>'; $('listm').style.display = 'block'; }
Object.assign(ACT, {
  insp() {
    $('menu').style.display = 'none'; if (!fireOf()) return toast('先に住所をさがすか、📍で場所を決めてください'); if (!S.all.length) return toast('この範囲に水利がありません。「範囲」を広げてください');
    endMode(); const I = S.insp; I.on = true; I.stack = []; I.skip = []; I.cur = inspNextFrom(null); S.route = null; drawRoute(); inspFocus(); toast('点検をはじめます');
  },
  ck(el) {                              // ○は自動で次へ。×はメモを選んでから「次へ」
    const I = S.insp, k = I.cur; if (!k) return; const v = +el.dataset.v, x = S.all.find(y => y.k === k);
    Insp.set(k, { s: v, t: Date.now(), m: v === 1 ? '' : (Insp.get(k) || {}).m || '' }); Incident.log('点検 ' + (x.w.name || '') + ' → ' + STATUS[v].n); drawWater(); renderInspect();
    clearTimeout(I.t); if (v === 1) I.t = setTimeout(() => { if (I.cur === k) ACT.cknext(); }, 700); else toast('メモを選んで「次へ」を押す');
  },
  ckmemo(el) { const k = S.insp.cur, r = Insp.get(k) || {}, ms = (r.m || '').split('、').filter(Boolean), i = ms.indexOf(el.dataset.v); if (i < 0) ms.push(el.dataset.v); else ms.splice(i, 1); Insp.set(k, { m: ms.join('、') }); renderInspect(); },
  cknext() { const I = S.insp; clearTimeout(I.t); if (I.cur) I.stack.push(I.cur); I.cur = inspNextFrom(I.cur); inspFocus(); },
  ckskip() { const I = S.insp; if (I.cur) I.skip.push(I.cur); ACT.cknext(); },
  ckback() { const I = S.insp; clearTimeout(I.t); const p = I.stack.pop(); if (p) { I.cur = p; inspFocus(); } else toast('これより前はありません'); },
  inspend() { const I = S.insp, c = inspCounts(); clearTimeout(I.t); I.on = false; I.cur = null; S.sel = null; drawWater(); renderSheet(); toast('点検 ' + c.done + '/' + c.all + '件(○' + c.ok + ' ×' + c.ng + ')'); },
  inspcsv() { const t = Insp.csv(); navigator.clipboard ? navigator.clipboard.writeText(t).then(() => toast('点検結果をコピーしました'), () => toast('コピーできませんでした')) : toast('コピーできませんでした'); },
  logm() { $('menu').style.display = 'none'; const l = Incident.d.log.slice().reverse();
    listModal('<h2>記録(操作の履歴)</h2>' + (l.length ? l.slice(0, 100).map(e => '<div class="li"><small>' + fmtT(e.t) + '</small> ' + Util.esc(e.m) + '</div>').join('') : '<p>まだ記録がありません。</p>') + '<button class="btn big" data-act="logcopy">全部コピー</button>'); },
  logcopy() { const t = Incident.d.log.map(e => fmtT(e.t) + ' ' + e.m).join('\n'); navigator.clipboard ? navigator.clipboard.writeText(t).then(() => toast('コピーしました')) : 0; },
  pastm() { $('menu').style.display = 'none'; const l = Past.list();
    listModal('<h2>過去の現場</h2>' + (l.length ? l.map(p => '<div class="li"><div><b>' + fmtT(p.t) + '</b><br><small>' + Util.esc(p.label) + '</small></div><button class="btn" data-act="pastopen" data-v="' + p.id + '">開く</button><button class="btn" data-act="pastdel" data-v="' + p.id + '">削除</button></div>').join('') : '<p>現場を終えると、ここに残ります。</p>')); },
  pastopen(el) {
    const p = Past.list().find(x => x.id === el.dataset.v); if (!p || !confirm('この過去の現場を表示します。いまの現場は「過去の現場」に残してから切り替えます。')) return;
    Past.add(); Incident.d = Object.assign({ log: [] }, JSON.parse(JSON.stringify(p.d))); Incident.save(); S.sel = null; S.route = null; if (fireOf()) { $('q').value = fireOf().label; autoRadius(); } renderAll(true); ACT.closemodal();
  },
  pastdel(el) { if (!confirm('この過去の現場を削除します。よろしいですか?')) return; Past.remove(el.dataset.v); ACT.pastm(); },
  syncm() {
    $('menu').style.display = 'none';
    if (Sync.code) listModal('<h2>みんなで同期</h2><p>現場コード<br><b class="code">' + Sync.code + '</b></p><p class="note">同じコードを入れた人と、状態・マーカー・経路が自動で共有されます。 ' + (Sync.ok ? '● つながっています' : '○ つながっていません(自動で再接続します)') + '</p><button class="btn big" data-act="synccopy">コードをコピー</button><button class="btn big" data-act="syncleave">同期をやめる</button>');
    else listModal('<h2>みんなで同期</h2><button class="btn big pri" data-act="synccreate">新しい現場コードを作る</button><p class="note">または、教えてもらったコードを入れます</p><input id="jc" placeholder="現場コード" autocomplete="off" style="width:100%;height:48px;font:inherit;border:2px solid #d0d4d9;border-radius:8px;padding:0 10px"><button class="btn big" data-act="syncjoin">参加する</button>');
  },
  async synccreate() { await Sync.create(); toast('現場コードを作りました'); ACT.syncm(); },
  async syncjoin() { try { await Sync.join($('jc').value); toast('参加しました'); ACT.syncm(); } catch (e) { toast(e.message); } },
  syncleave() { Sync.leave(); toast('同期をやめました'); ACT.closemodal(); },
  synccopy() { navigator.clipboard ? navigator.clipboard.writeText(Sync.code).then(() => toast('コードをコピーしました')) : 0; }
});
Sync.onstate = () => { $('mSync').textContent = '👥 みんなで同期' + (Sync.code ? (Sync.ok ? ' ●' : ' ○') : ''); };
Sync.onchange = () => {                 // 他の端末の変更を受け取ったとき(地図の位置は動かさない)
  const L = Sync.toLocal(), had = !!fireOf(); Object.assign(Incident.d, { fire: L.fire, st: L.st, mk: L.mk, rt: L.rt, log: L.log }); Incident.save(); Object.assign(Insp.d, L.ck); Insp.persist();
  const f = fireOf(); if (f) { $('q').value = f.label; if (!had) autoRadius(); else calc(); renderAll(!had); } else { S.sel = null; S.route = null; S.all = []; S.rows = []; $('q').value = ''; renderAll(false); }
};

/* G. 起動 ------------------------------------------------- */
(async function start() {
  if (Store.get(K.largeFont, 0)) document.documentElement.classList.add('large');
  ['truck', 'loader'].forEach(k => { $('mkmenu').querySelector('[data-v=' + k + ']').innerHTML = '<div style="display:flex;justify-content:center">' + SVG[k] + '</div>' + MK[k].n; });
  $('credits').innerHTML = CONFIG.credits.join('<br>') + '<br>バージョン ' + CONFIG.version;
  await Ledger.load();
  if (location.hash.startsWith('#s=')) {                // 共有リンクから開いたとき
    const j = Incident.decode(location.hash.slice(3)); history.replaceState(null, '', location.pathname);
    if (j && confirm('共有された現場を開きます。今の記録は上書きされます。よろしいですか?')) { Incident.d = j; Incident.save(); }
  }
  const f = fireOf(); if (f) { $('q').value = f.label; autoRadius(); renderAll(true); } else renderAll(false);
  if (!Sync.enabled()) $('mSync').style.display = 'none'; else { Sync.onstate(); if (Sync.code) Sync.connect(); }
})();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
