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
  mode: null, draw: [], cand: [],       // 操作中のモード / 描いている点 / 住所の候補
  open: !!Store.get(K.sheetOpen, 0), lh: Store.get(K.listH, 0)   // 一覧を開いているか / 一覧の高さ
};
const map = L.map('map', { zoomControl: false }).setView(CONFIG.map.center, CONFIG.map.zoom);
map.attributionControl.setPrefix(false);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer(CONFIG.map.tileUrl, { maxZoom: CONFIG.map.maxZoom, attribution: CONFIG.map.attribution }).addTo(map);
const LY = {}; ['fire', 'water', 'field', 'route', 'tmp'].forEach(n => LY[n] = L.layerGroup().addTo(map));
const fireOf = () => Incident.d.fire;
const wide = () => matchMedia('(min-width:700px)').matches;

function toast(msg, undo) {
  const e = $('toast'); e.innerHTML = Util.esc(msg) + (undo ? ' <button class="btn" style="display:inline-block;min-height:36px;line-height:32px;margin-left:8px;padding:0 10px" id="undo">元に戻す</button>' : '');
  e.style.display = 'block'; if (undo) $('undo').onclick = () => { undo(); e.style.display = 'none'; };
  clearTimeout(toast.t); toast.t = setTimeout(() => e.style.display = 'none', undo ? 6000 : 2000);
}
function calc() {
  const f = fireOf(); if (!f) { S.all = []; S.rows = []; return; }
  S.all = Ledger.items.map(w => ({ w, k: Incident.key(w), d: Util.dist(f.lat, f.lng, w.lat, w.lng) })).filter(x => x.d <= S.radius).sort((a, b) => a.d - b.d);
  S.rows = S.all.filter(x => S.filter === 'all' || (S.filter === 'tank') === Util.isTank(x.w));
}
function autoRadius() { for (const r of CONFIG.search.autoRadii) { S.radius = r; calc(); if (S.rows.length >= CONFIG.search.minHits) break; } }
function labelFor(lat, lng) {           // 火点を動かしたときの住所表示(街区データがあれば住所、なければ座標)
  let best = null, bd = 150; for (const b of Addr.blocks) { const d = Util.dist(lat, lng, b.a, b.o); if (d < bd) { bd = d; best = b; } }
  return best ? best.t + ' 付近' : lat.toFixed(5) + ', ' + lng.toFixed(5);
}

/* B. 描画 ------------------------------------------------- */
function mkHtml(w, rank) {
  const st = STATUS[Incident.status(w)], tank = Util.isTank(w);
  return '<div style="position:relative"><div class="mk ' + (tank ? 'tank' : '') + '" style="--c:' + st.c + ';--t:' + st.t + '" data-s="' + st.s + '">' + (tank ? '水' : '栓') + '</div>' +
    (rank < 3 ? '<div class="dl">' + Math.round(S.rows[rank].d) + 'm</div>' : '') + '</div>';
}
function drawFire() {
  LY.fire.clearLayers(); const f = fireOf(); if (!f) return;
  L.marker([f.lat, f.lng], { icon: L.divIcon({ className: '', html: '<div class="fire">🔥</div>', iconSize: [30, 30], iconAnchor: [15, 15] }), draggable: true, zIndexOffset: 2000 })
    .addTo(LY.fire).on('dragend', e => { const p = e.target.getLatLng(); setFire(p.lat, p.lng, labelFor(p.lat, p.lng), { keepView: true, keepSel: true }); });
  L.circle([f.lat, f.lng], { radius: S.radius, color: '#e5352b', weight: 2, fillOpacity: .04, interactive: false }).addTo(LY.fire);
}
function drawWater() {
  LY.water.clearLayers();
  S.rows.forEach((x, i) => { const m = L.marker([x.w.lat, x.w.lng], { icon: L.divIcon({ className: x.k === S.sel ? 'sel' : '', html: mkHtml(x.w, i), iconSize: [28, 28], iconAnchor: [14, 14] }) }).addTo(LY.water); m.on('click', () => pick(i)); });
}
function drawRoute() {
  LY.route.clearLayers(); if (S.route) L.polyline(S.route.pts, { color: '#1d4ed8', weight: 6, opacity: .9, interactive: false }).addTo(LY.route);
}
function renderAll(fit) { drawFire(); drawWater(); drawField(); drawRoute(); renderSheet(); if (fit && fireOf()) fitFire(); }
function pads() { const h = $('sheet').offsetHeight || 0; return wide() ? { paddingTopLeft: [450, 70], paddingBottomRight: [60, 20] } : { paddingTopLeft: [10, 70], paddingBottomRight: [10, h + 10] }; }
function fitFire() { const f = fireOf(), dy = S.radius / 111320, dx = S.radius / (111320 * Math.cos(f.lat * Math.PI / 180)); map.fitBounds([[f.lat - dy, f.lng - dx], [f.lat + dy, f.lng + dx]], Object.assign(pads(), { animate: false })); }
/* 火点を決める。keepView:地図の位置・範囲を変えない / keepSel:選んだ水利をそのまま */
function setFire(lat, lng, label, o = {}) {
  Incident.d.fire = { lat, lng, label, rough: !!o.rough }; Incident.save(); $('q').value = label;   // 上の住所と下の表示を必ず同じにする
  if (!o.keepSel) { S.sel = null; S.route = null; }
  if (!o.keepView && !S.manual) autoRadius(); else calc();
  renderAll(!o.keepView);
  if (o.keepSel && S.sel) { if (selRow()) loadRoute(false); else { S.sel = null; S.route = null; renderSheet(); } }
}

/* C. 経路(ホース) ----------------------------------------- */
const Route = {
  last: 0,
  length: pts => pts.reduce((s, p, i) => i ? s + Util.dist(pts[i - 1][0], pts[i - 1][1], p[0], p[1]) : 0, 0),
  async auto(a, b) {                    // 道路に沿った徒歩ルート。取れなければ「直線×係数」の目安
    const wait = 1100 - (Date.now() - this.last); if (wait > 0) await sleep(wait); this.last = Date.now();
    try {
      const c = new AbortController(), t = setTimeout(() => c.abort(), 8000);
      const j = await (await fetch(CONFIG.route.url + a.lng + ',' + a.lat + ';' + b.lng + ',' + b.lat + '?overview=full&geometries=geojson', { signal: c.signal })).json(); clearTimeout(t);
      const r = j.routes && j.routes[0]; if (!r) throw 0;
      return { pts: r.geometry.coordinates.map(p => [p[1], p[0]]), len: r.distance, src: 'road' };
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
  else { S.route = null; renderDetail(); const r = await Route.auto(x.w, f); if (S.sel !== key) return; S.route = r; }
  S.route.len = S.route.src === 'manual' ? Route.length(S.route.pts) : S.route.len;
  S.route.warn = Route.crossesClosure(S.route.pts); drawRoute(); renderDetail();
  if (fit) map.fitBounds(L.latLngBounds(S.route.pts.concat([[f.lat, f.lng]])), Object.assign(pads(), { maxZoom: 18 }));
}
function pick(i) {
  if (S.mode) return; const k = S.rows[i].k; S.sel = S.sel === k ? null : k; S.route = null; drawWater(); drawRoute(); renderDetail(); renderList();
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
const SVG = {                           // 消防車(運転席が右)と積載車(運転席が左・荷台に資機材)を、形で見分ける
  truck: '<svg viewBox="0 0 48 28" width="40" height="24"><rect x="2" y="9" width="33" height="11" rx="2" fill="#d32f2f"/><rect x="35" y="11" width="11" height="9" rx="2" fill="#d32f2f"/><path d="M38 12h6v4h-6z" fill="#cfe8ff"/><rect x="6" y="6" width="22" height="3" fill="#fff" stroke="#999" stroke-width=".5"/><rect x="29" y="5" width="5" height="4" fill="#ffb300"/><circle cx="11" cy="22" r="4" fill="#222" stroke="#fff"/><circle cx="39" cy="22" r="4" fill="#222" stroke="#fff"/></svg>',
  loader: '<svg viewBox="0 0 48 28" width="40" height="24"><rect x="3" y="11" width="12" height="9" rx="2" fill="#d32f2f"/><path d="M5 12h7v4H5z" fill="#cfe8ff"/><rect x="15" y="13" width="29" height="7" fill="#b71c1c"/><rect x="19" y="8" width="10" height="5" rx="1" fill="#fff" stroke="#999" stroke-width=".5"/><circle cx="35" cy="10.5" r="3" fill="#fff" stroke="#999" stroke-width=".5"/><circle cx="10" cy="22" r="4" fill="#222" stroke="#fff"/><circle cx="37" cy="22" r="4" fill="#222" stroke="#fff"/></svg>'
};
const MK = { truck: { n: '消防車', s: '消防' }, loader: { n: '積載車', s: '積載' }, guard: { n: '警備地点' }, road: { n: '通行止め' } };
function drawField() {
  LY.field.clearLayers();
  Incident.d.mk.forEach(m => {
    let L1;
    if (m.type === 'road') L1 = L.polyline(m.path, { color: '#e5352b', weight: 10, opacity: .6 }).addTo(LY.field);
    else {
      const html = m.type === 'guard' ? '<div class="guard">' + Util.esc(m.name) + '</div>' : '<div class="veh">' + SVG[m.type] + '<span>' + MK[m.type].s + '</span></div>';
      L1 = L.marker([m.lat, m.lng], { icon: L.divIcon({ className: '', html, iconSize: [44, 34], iconAnchor: [22, 17] }), draggable: true }).addTo(LY.field);
      L1.on('dragend', e => { const p = e.target.getLatLng(); m.lat = p.lat; m.lng = p.lng; Incident.save(); });
    }
    L1.bindPopup('<b>' + (m.type === 'guard' ? Util.esc(m.name) + '地点' : MK[m.type].n) + '</b><br><button class="btn" style="margin-top:6px;min-height:44px;line-height:40px" data-act="delmk" data-v="' + m.id + '">削除</button>' + (m.type === 'road' ? '' : '<div class="note">指でずらすと移動できます</div>'));
  });
}
map.on('popupopen', e => e.popup.getElement().querySelectorAll('[data-act]').forEach(b => b.onclick = () => ACT[b.dataset.act](b)));
function addMarker(m) { m.id = 'm' + Date.now(); Incident.d.mk.push(m); Incident.save(); drawField(); }

/* E. 下の表示 --------------------------------------------- */
function renderSheet() {
  const sh = $('sheet'), f = fireOf();
  if (!Ledger.items.length) { sh.style.display = 'flex'; $('grab').style.display = 'none'; $('shead').innerHTML = '<div class="msg">水利データがありません。管理者にお知らせください。</div>'; $('sdetail').innerHTML = $('slist').innerHTML = ''; return; }
  if (!f) { sh.style.display = 'none'; return; }
  sh.style.display = 'flex'; $('grab').style.display = '';
  const n = t => S.all.filter(x => (t === 'tank') === Util.isTank(x.w)).length;
  $('shead').innerHTML = '<button class="sum" data-act="toggle">● 消火栓<b>' + n('gate') + '</b>■ 水槽<b>' + n('tank') + '</b> ' + (S.open ? '▼' : '▲') + '</button><button class="rng" data-act="radius">範囲 ' + S.radius + 'm</button>';
  renderDetail(); renderList();
}
function renderDetail() {
  const x = selRow(), el = $('sdetail'); if (!x) { el.innerHTML = ''; syncZoom(); return; }
  const w = x.w, st = Incident.status(w), tank = Util.isTank(w), s0 = STATUS[st], r = S.route; let hose = '<span>道路ルートを計算中…</span>';
  if (r) { const L0 = Math.round(r.len), min = Math.ceil(L0 / CONFIG.hose.length), spare = Math.max(min + 1, Math.ceil(L0 * CONFIG.hose.slack / CONFIG.hose.length));
    hose = '<span class="hb">' + min + '本</span><span>最低 / 余裕 <b>' + spare + '本</b> ・ <b>' + L0 + 'm</b></span><small>' + { road: '道路ルート(目安)', manual: '描いた経路', estimate: '直線×' + CONFIG.hose.factor + '(目安)' }[r.src] + '</small>' + (r.warn ? '<span class="alert">⚠ 通行止めを通ります</span>' : ''); }
  el.innerHTML = '<div class="detail"><div class="drow"><div class="mk small ' + (tank ? 'tank' : '') + '" style="--c:' + s0.c + ';--t:' + s0.t + '" data-s="' + s0.s + '">' + (tank ? '水' : '栓') + '</div><div class="n"><b>' + (tank ? '防火水槽' : '消火栓') + '</b><small>' + Util.esc(w.name) + '</small></div><span class="dd">直線' + Math.round(x.d) + 'm</span><button class="x" data-act="back" aria-label="選択をやめる">✕</button></div>' +
    '<div class="st">' + STATUS.map((s, i) => '<button class="' + (i === st ? 'on' : '') + '" style="--c:' + s.c + ';--t:' + s.t + '" data-act="status" data-v="' + i + '"><b>' + s.s + '</b>' + s.n + '</button>').join('') + '</div>' +
    '<div class="hose">' + hose + '</div><div class="acts"><button class="btn" data-act="drawroute">✏ 経路を描く</button>' + (Incident.d.rt[x.k] ? '<button class="btn" data-act="resetroute">自動にもどす</button>' : '') + '</div></div>';
  syncZoom();
}
function renderList() {
  const el = $('slist'), f = fireOf(); if (!f) return; el.style.display = S.open ? '' : 'none'; if (!S.open) { syncZoom(); return; }
  if (S.lh) el.style.maxHeight = S.lh + 'px'; const top = el.scrollTop, chip = (t, l) => '<button class="chip ' + (S.filter === t ? 'on' : '') + '" data-act="filter" data-v="' + t + '">' + l + '</button>';
  el.innerHTML = '<div class="chips">' + chip('all', '全部') + chip('gate', '● 消火栓') + chip('tank', '■ 水槽') + '</div>' +
    (S.rows.slice(0, CONFIG.search.listMax).map((x, i) => { const s = STATUS[Incident.status(x.w)], t = Util.isTank(x.w);
      return '<div class="it ' + (x.k === S.sel ? 'sel' : '') + '" data-act="pick" data-v="' + i + '"><div class="mk small ' + (t ? 'tank' : '') + '" style="--c:' + s.c + ';--t:' + s.t + '" data-s="' + s.s + '">' + (t ? '水' : '栓') + '</div><div class="n"><b>' + (t ? '防火水槽' : '消火栓') + '</b> ' + s.n + '<small>' + Util.esc(x.w.name) + '</small></div><div class="d"><span>' + Util.dir(f.lat, f.lng, x.w.lat, x.w.lng) + '</span>' + Math.round(x.d) + 'm</div></div>'; }).join('') ||
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
    const ll = Addr.parseLatLng(q); if (ll) { c.style.display = 'none'; return setFire(ll.lat, ll.lng, labelFor(ll.lat, ll.lng)); }
    c.style.display = 'block'; c.innerHTML = '<div>さがしています…</div>';
    const r = await Addr.search(q);
    if (!r.list.length) { c.innerHTML = '<div style="color:#b00">' + { none: '住所が見つかりません。「南蒲田3-5」のように、町名と番地で入れてください。', offline: '通信できません。電波のある所で、もう一度お試しください。', gsioff: '住所データに見つかりません。管理者にお知らせください。' }[r.problem] + '</div>'; return; }
    S.cand = r.list.slice(0, 6); if (S.cand.length === 1) ACT.cand({ dataset: { v: 0 } });
    else c.innerHTML = S.cand.map((x, i) => '<button data-act="cand" data-v="' + i + '">' + Util.esc(x.title) + '</button>').join('');
  },
  cand(el) {
    const x = S.cand[+el.dataset.v]; $('cand').style.display = 'none'; $('q').blur();
    const h = Store.get(K.history, []).filter(y => y.l !== x.title); h.unshift({ l: x.title, lat: x.lat, lng: x.lng, rough: x.rough }); Store.set(K.history, h.slice(0, 8)); setFire(x.lat, x.lng, x.title, { rough: x.rough });
  },
  hist(el) { const h = Store.get(K.history, [])[+el.dataset.v]; $('cand').style.display = 'none'; $('q').blur(); setFire(h.lat, h.lng, h.l, { rough: h.rough }); },
  loc() {
    if (!navigator.geolocation) return toast('この端末では位置情報が使えません'); toast('現在地を調べています…');
    navigator.geolocation.getCurrentPosition(p => setFire(p.coords.latitude, p.coords.longitude, labelFor(p.coords.latitude, p.coords.longitude)), () => toast('現在地を取得できません(位置情報の許可を確認してください)'), { enableHighAccuracy: true, timeout: 15000 });
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
    const x = selRow(); if (!x) return; S.mode = 'route'; S.draw = [[x.w.lat, x.w.lng]];
    setBar('', []); setBar('x', [['戻す', 'm_undo'], ['最初から', 'm_reset'], ['完了', 'm_finish']]); renderTmp();
  },
  resetroute() { const x = selRow(); delete Incident.d.rt[x.k]; Incident.save(); S.route = null; loadRoute(false); },
  mkmenu() { $('menu').style.display = 'none'; if (!fireOf()) return toast('先に住所をさがしてください'); $('mkmenu').style.display = 'block'; },
  addmk(el) {
    const t = el.dataset.v; $('mkmenu').style.display = 'none'; endMode(); S.sel = null; S.route = null; drawWater(); drawRoute(); renderSheet(); S.mode = 'mk:' + t;
    if (t === 'road') setBar('通行止めの道路に沿って<br>2か所以上タップ', [['戻す', 'm_undo'], ['取消', 'm_cancel'], ['完了', 'm_finish']]);
    else setBar(MK[t].n + 'を置く場所を<br>地図でタップ', [['取消', 'm_cancel']]);
  },
  delmk(el) { const i = Incident.d.mk.findIndex(m => m.id === el.dataset.v); if (i < 0) return; const [m] = Incident.d.mk.splice(i, 1); Incident.save(); map.closePopup(); drawField(); toast('削除しました', () => { Incident.d.mk.splice(i, 0, m); Incident.save(); drawField(); }); },
  m_undo() { S.draw.pop(); if (S.mode === 'route' && !S.draw.length) { const x = selRow(); S.draw = [[x.w.lat, x.w.lng]]; } renderTmp(); },
  m_reset() { const x = selRow(); S.draw = [[x.w.lat, x.w.lng]]; renderTmp(); },
  m_cancel() { endMode(); renderSheet(); },
  m_finish() {
    if (S.mode === 'route') { const f = fireOf(), x = selRow(); Incident.d.rt[x.k] = S.draw.concat([[f.lat, f.lng]]); Incident.save(); endMode(); S.route = null; renderSheet(); loadRoute(false); toast('経路を保存しました'); }
    else if (S.mode === 'mk:road') { if (S.draw.length < 2) return toast('2か所以上タップしてください'); const m = S.draw[Math.floor(S.draw.length / 2)]; addMarker({ type: 'road', path: S.draw.slice(), lat: m[0], lng: m[1] }); endMode(); renderSheet(); toast('通行止めを置きました'); if (S.sel) loadRoute(false); }
  },
  share() {
    $('menu').style.display = 'none'; const url = location.origin + location.pathname + '#s=' + Incident.encode();
    if (navigator.share) navigator.share({ title: '水利さがし', url }).catch(() => {}); else navigator.clipboard ? navigator.clipboard.writeText(url).then(() => toast('共有リンクをコピーしました'), () => toast('コピーできませんでした')) : toast('コピーできませんでした');
  },
  help() { $('menu').style.display = 'none'; $('help').style.display = 'block'; }, closemodal() { document.querySelectorAll('.modal').forEach(m => m.style.display = 'none'); },
  font() { $('menu').style.display = 'none'; const v = document.documentElement.classList.toggle('large'); Store.set(K.largeFont, v ? 1 : 0); setTimeout(syncZoom, 50); },
  endincident() { if (!confirm('この現場の記録(状態・マーカー・経路)を全て消します。よろしいですか?')) return; Incident.clear(); S.sel = null; S.route = null; S.all = []; S.rows = []; $('q').value = ''; ACT.closemodal(); renderAll(false); toast('記録を消しました'); }
};
document.addEventListener('click', e => { const el = e.target.closest('[data-act]'); if (el && ACT[el.dataset.act]) ACT[el.dataset.act](el); });
map.on('click', e => {
  $('cand').style.display = 'none'; $('menu').style.display = 'none'; if (!S.mode) return; const p = [e.latlng.lat, e.latlng.lng];
  if (S.mode === 'route' || S.mode === 'mk:road') { S.draw.push(p); renderTmp(); }
  else if (S.mode.startsWith('mk:')) { const t = S.mode.slice(3); addMarker({ type: t, lat: p[0], lng: p[1], name: t === 'guard' ? Incident.nextGuardName() : '' }); endMode(); renderSheet(); toast(MK[t].n + 'を置きました'); }
});
map.on('contextmenu', e => { if (!S.mode) setFire(e.latlng.lat, e.latlng.lng, labelFor(e.latlng.lat, e.latlng.lng), { keepView: true }); });   // 長押し・右クリックで火点
$('q').addEventListener('keydown', e => { if (e.key === 'Enter') ACT.search(); });
$('q').addEventListener('input', () => { if ($('q').value.trim()) $('cand').style.display = 'none'; });
$('q').addEventListener('focus', e => {                  // 入力欄を押すと全選択(そのまま打ち替えられる)+最近の検索
  setTimeout(() => e.target.select(), 0); const h = Store.get(K.history, []); if (!h.length) return; const c = $('cand'); c.style.display = 'block';
  c.innerHTML = '<div>最近さがした場所</div>' + h.map((x, i) => '<button data-act="hist" data-v="' + i + '">' + Util.esc(x.l) + '</button>').join('');
});
addEventListener('resize', syncZoom);

/* G. 起動 ------------------------------------------------- */
(async function start() {
  if (Store.get(K.largeFont, 0)) document.documentElement.classList.add('large');
  $('credits').innerHTML = CONFIG.credits.join('<br>') + '<br>バージョン ' + CONFIG.version;
  await Ledger.load();
  if (location.hash.startsWith('#s=')) {                // 共有リンクから開いたとき
    const j = Incident.decode(location.hash.slice(3)); history.replaceState(null, '', location.pathname);
    if (j && confirm('共有された現場を開きます。今の記録は上書きされます。よろしいですか?')) { Incident.d = j; Incident.save(); }
  }
  const f = fireOf(); if (f) { $('q').value = f.label; autoRadius(); renderAll(true); } else renderAll(false);
})();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
