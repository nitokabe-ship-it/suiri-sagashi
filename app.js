/* ============================================================
 利用者画面のプログラム(index.html)
  A. 状態と地図の準備     E. 画面(下の表示)の組み立て
  B. 描画(地図の上)        F. 操作(ボタンの動作 ACT)
  C. 経路(ホース)          G. 起動
  D. 現場マーカー
============================================================ */
const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* A. 状態と地図 ------------------------------------------- */
const S = {
  all: [], rows: [],                    // all=範囲内の水利 / rows=絞り込み後(一覧に出す)
  radius: CONFIG.search.radii[1], manual: false,
  filter: 'all', hideBad: false,        // 種類の絞り込み / 「使用困難」を隠す
  sel: null, route: null,               // 選んだ水利のキー / その経路
  mode: null, draw: [], cand: []        // 操作中のモード('route','mk:truck'…) / 描いている点 / 住所の候補
};
const map = L.map('map', { zoomControl: false }).setView(CONFIG.map.center, CONFIG.map.zoom);
map.attributionControl.setPrefix(false);
L.control.zoom({ position: 'topright' }).addTo(map);
L.tileLayer(CONFIG.map.tileUrl, { maxZoom: CONFIG.map.maxZoom, attribution: CONFIG.map.attribution }).addTo(map);
const LY = {}; ['fire', 'water', 'field', 'route', 'tmp'].forEach(n => LY[n] = L.layerGroup().addTo(map));
const fireOf = () => Incident.d.fire;
const wide = () => matchMedia('(min-width:700px)').matches;

function toast(msg, undo) {
  const e = $('toast'); e.innerHTML = Util.esc(msg) + (undo ? ' <button class="btn" style="display:inline-block;min-height:40px;line-height:36px;margin-left:8px" id="undo">元に戻す</button>' : '');
  e.style.display = 'block'; if (undo) $('undo').onclick = () => { undo(); e.style.display = 'none'; };
  clearTimeout(toast.t); toast.t = setTimeout(() => e.style.display = 'none', undo ? 6000 : 2200);
}
function calc() {                       // 火点からの距離を計算し、範囲内・絞り込み後を求める
  const f = fireOf(); if (!f) { S.all = []; S.rows = []; return; }
  S.all = Ledger.items.map(w => ({ w, k: Incident.key(w), d: Util.dist(f.lat, f.lng, w.lat, w.lng) })).filter(x => x.d <= S.radius).sort((a, b) => a.d - b.d);
  S.rows = S.all.filter(x => (S.filter === 'all' || (S.filter === 'tank') === Util.isTank(x.w)) && !(S.hideBad && Incident.status(x.w) === 3));
}
function autoRadius() { for (const r of CONFIG.search.autoRadii) { S.radius = r; calc(); if (S.rows.length >= CONFIG.search.minHits) break; } }

/* B. 描画 ------------------------------------------------- */
function mkHtml(w, rank) {
  const st = STATUS[Incident.status(w)], tank = Util.isTank(w);
  return '<div style="position:relative"><div class="mk ' + (tank ? 'tank' : '') + '" style="--c:' + st.c + ';--t:' + st.t + '" data-s="' + st.s + '">' + (tank ? '水' : '栓') + '</div>' +
    (rank < 3 ? '<div class="dl">' + Math.round(S.rows[rank].d) + 'm</div>' : '') + '</div>';
}
function drawFire() {
  LY.fire.clearLayers(); const f = fireOf(); if (!f) return;
  L.marker([f.lat, f.lng], { icon: L.divIcon({ className: '', html: '<div class="fire">🔥</div>', iconSize: [40, 40], iconAnchor: [20, 20] }), draggable: true, zIndexOffset: 2000 })
    .addTo(LY.fire).on('dragend', e => { const p = e.target.getLatLng(); setFire(p.lat, p.lng, '地図で直した位置', true); });
  L.circle([f.lat, f.lng], { radius: S.radius, color: '#e5352b', weight: 2, fillOpacity: .04, interactive: false }).addTo(LY.fire);
}
function drawWater() {
  LY.water.clearLayers();
  S.rows.forEach((x, i) => { const m = L.marker([x.w.lat, x.w.lng], { icon: L.divIcon({ className: x.k === S.sel ? 'sel' : '', html: mkHtml(x.w, i), iconSize: [36, 36], iconAnchor: [18, 18] }) }).addTo(LY.water); m.on('click', () => pick(i)); });
}
function drawRoute() {
  LY.route.clearLayers(); if (!S.route) return;
  L.polyline(S.route.pts, { color: '#1d4ed8', weight: 7, opacity: .9, interactive: false }).addTo(LY.route);
}
function renderAll(fit) { drawFire(); drawWater(); drawField(); drawRoute(); renderSheet(); if (fit && fireOf()) fitFire(); }
function pads() { const h = $('sheet').offsetHeight; return wide() ? { paddingTopLeft: [470, 150], paddingBottomRight: [70, 20] } : { paddingTopLeft: [10, 150], paddingBottomRight: [70, h + 10] }; }
function fitFire() { const f = fireOf(), dy = S.radius / 111320, dx = S.radius / (111320 * Math.cos(f.lat * Math.PI / 180)); map.fitBounds([[f.lat - dy, f.lng - dx], [f.lat + dy, f.lng + dx]], Object.assign(pads(), { animate: false })); }
function setFire(lat, lng, label, keep) {
  Incident.d.fire = { lat, lng, label }; Incident.save(); S.sel = null; S.route = null;
  if (!keep || !S.manual) { S.manual = false; autoRadius(); } else calc();
  renderAll(true);
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
  crossesClosure(pts) {                 // 通行止め区間と交わるか
    const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]), X = (a, b, c, d) => o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
    return Incident.d.mk.filter(m => m.type === 'road').some(r => r.path.some((_, i) => i < r.path.length - 1 && pts.some((_, j) => j < pts.length - 1 && X(r.path[i], r.path[i + 1], pts[j], pts[j + 1]))));
  }
};
const selRow = () => S.all.find(x => x.k === S.sel);
async function loadRoute() {            // 選んだ水利から火点までの経路を求める
  const x = selRow(), f = fireOf(); if (!x) return; const key = x.k, man = Incident.d.rt[key];
  if (man) S.route = { pts: man, len: Route.length(man), src: 'manual' };
  else { S.route = null; renderSheet(); const r = await Route.auto(x.w, f); if (S.sel !== key) return; S.route = r; }
  S.route.warn = Route.crossesClosure(S.route.pts); drawRoute(); renderSheet();
  const b = L.latLngBounds(S.route.pts.concat([[f.lat, f.lng]])); map.fitBounds(b, Object.assign(pads(), { maxZoom: 18 }));
}
function pick(i) {
  if (S.mode) return; const k = S.rows[i].k; S.sel = S.sel === k ? null : k; S.route = null; drawWater(); drawRoute(); renderSheet();
  $('sbody').scrollTop = 0; if (S.sel) loadRoute(); else fitFire();
}
function setBar(html, btns) {           // 画面上部の「操作中バー」
  const b = $('modebar'); if (!html) { b.style.display = 'none'; return; }
  b.innerHTML = html + '<div class="row">' + btns.map(x => '<button class="btn" data-act="' + x[1] + '">' + x[0] + '</button>').join('') + '</div>'; b.style.display = 'block';
}
function endMode() { S.mode = null; S.draw = []; LY.tmp.clearLayers(); setBar(''); }
function renderTmp() {
  LY.tmp.clearLayers(); const f = fireOf();
  if (S.draw.length) L.polyline(S.draw.concat(S.mode === 'route' ? [[f.lat, f.lng]] : []), { color: S.mode === 'route' ? '#1d4ed8' : '#e5352b', weight: S.mode === 'route' ? 6 : 10, opacity: .6, dashArray: S.mode === 'route' ? '4 10' : null, interactive: false }).addTo(LY.tmp);
  S.draw.forEach(p => L.circleMarker(p, { radius: 6, color: '#fff', weight: 2, fillColor: '#111', fillOpacity: 1, interactive: false }).addTo(LY.tmp));
  const live = $('live'); if (live && S.mode === 'route') { const L2 = Route.length(S.draw.concat([[f.lat, f.lng]])); live.textContent = ' 長さ約 ' + Math.round(L2) + 'm(最低' + Math.ceil(L2 / CONFIG.hose.length) + '本)'; }
}

/* D. 現場マーカー(消防車・積載車・警備地点・通行止め) ----- */
const MK = { truck: { icon: '🚒', n: '消防車' }, loader: { icon: '🚚', n: '積載車' }, guard: { n: '警備地点' }, road: { n: '通行止め' } };
function drawField() {
  LY.field.clearLayers();
  Incident.d.mk.forEach(m => {
    let L1;
    if (m.type === 'road') L1 = L.polyline(m.path, { color: '#e5352b', weight: 12, opacity: .6 }).addTo(LY.field);
    else {
      const html = m.type === 'guard' ? '<div class="guard">' + Util.esc(m.name) + '</div>' : '<div class="veh">' + MK[m.type].icon + '</div>';
      L1 = L.marker([m.lat, m.lng], { icon: L.divIcon({ className: '', html, iconSize: [40, 40], iconAnchor: [20, 20] }), draggable: true }).addTo(LY.field);
      L1.on('dragend', e => { const p = e.target.getLatLng(); m.lat = p.lat; m.lng = p.lng; Incident.save(); });
    }
    L1.bindPopup('<b>' + (m.type === 'guard' ? Util.esc(m.name) + '地点' : MK[m.type].n) + '</b><br><button class="btn" style="margin-top:6px" data-act="delmk" data-v="' + m.id + '">削除</button>' + (m.type === 'road' ? '' : '<div class="note">指でずらすと移動できます</div>'));
  });
}
map.on('popupopen', e => e.popup.getElement().querySelectorAll('[data-act]').forEach(b => b.onclick = () => ACT[b.dataset.act](b)));   // 吹き出し内のボタン用
function addMarker(m) { m.id = 'm' + Date.now(); Incident.d.mk.push(m); Incident.save(); drawField(); }

/* E. 画面(下の表示)の組み立て ------------------------------ */
function routeCardHtml() {
  const r = S.route; if (!r) return '<div class="rcard">道路に沿った経路を計算中…</div>';
  const L0 = Math.round(r.len), min = Math.ceil(L0 / CONFIG.hose.length), spare = Math.max(min + 1, Math.ceil(L0 * CONFIG.hose.slack / CONFIG.hose.length));
  const note = { road: '道路(徒歩)ルートの目安です。実際の敷設は現場の状況を優先してください。', manual: '自分で描いた経路の長さです。', estimate: '経路を取得できないため「直線×' + CONFIG.hose.factor + '」の目安です。' }[r.src];
  return '<div class="rcard"><b>📏 ホースの長さ(目安)</b><div class="rbody"><div class="big">' + L0 + '<small>m</small></div><div class="hn">' + CONFIG.hose.length + 'mホース<br><b>最低 ' + min + '本</b><br>余裕を見て <b>' + spare + '本</b></div></div>' +
    (r.warn ? '<div class="alert">⚠ 通行止めの場所を通ります。「経路を描く」で避けてください</div>' : '') + '<div class="rn">' + note + '</div></div>';
}
function detailHtml(x) {
  const w = x.w, st = Incident.status(w), tank = Util.isTank(w), s0 = STATUS[st];
  return '<div class="detail"><div class="it" style="border:0;padding:0"><div class="mk small ' + (tank ? 'tank' : '') + '" style="--c:' + s0.c + ';--t:' + s0.t + '" data-s="' + s0.s + '">' + (tank ? '水' : '栓') + '</div><div class="n"><b>' + (tank ? '防火水槽' : '消火栓') + '</b><small>' + Util.esc(w.name) + '</small></div><div class="d"><span>直線</span>' + Math.round(x.d) + 'm</div></div>' +
    '<div class="st">' + STATUS.map((s, i) => '<button class="' + (i === st ? 'on' : '') + '" style="--c:' + s.c + ';--t:' + s.t + '" data-act="status" data-v="' + i + '"><b>' + s.s + '</b>' + s.n + '</button>').join('') + '</div>' +
    routeCardHtml() + '<div class="acts"><button class="btn" data-act="drawroute">✏️ 経路を描く</button>' +
    (Incident.d.rt[x.k] ? '<button class="btn" data-act="resetroute">自動の経路に戻す</button>' : '<a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=' + w.lat + ',' + w.lng + '&travelmode=walking">Googleマップ</a>') + '</div></div>';
}
function renderSheet() {
  const b = $('sbody'), f = fireOf();
  if (!Ledger.items.length) { b.innerHTML = '<div class="head">水利データが入っていません</div><p>管理者の方は「？使い方」→「管理者の方」から取り込んでください。</p>'; return; }
  if (!f) { b.innerHTML = '<div class="head">住所を入れて「さがす」を押してください</div><ol class="guide"><li>近くの<b>消火栓(●栓)</b>と<b>防火水槽(■水)</b>が出ます</li><li>水利を押すと、<b>ホースが何本いるか</b>が出ます</li><li>地図を<b>長押し</b>(PCは右クリック)でも、場所を決められます</li></ol>'; return; }
  const n = t => S.all.filter(x => t === 'all' || (t === 'tank') === Util.isTank(x.w)).length, chip = (t, l) => '<button class="chip ' + (S.filter === t ? 'on' : '') + '" data-act="filter" data-v="' + t + '">' + l + '</button>';
  const sel = selRow();
  // 水利を選んでいるときは、その情報(状態・ホースの長さ)を一番上に出す。絞り込みは一覧にもどったときだけ出す。
  const filters = '<div class="chips">' + chip('all', '全部 ' + n('all')) + chip('gate', '● 消火栓 ' + n('gate')) + chip('tank', '■ 防火水槽 ' + n('tank')) + '<button class="chip ' + (S.hideBad ? 'on' : '') + '" data-act="hidebad">使用困難を隠す</button></div>' +
    '<div class="chips"><span class="lbl">探す範囲</span>' + CONFIG.search.radii.map(r => '<button class="chip ' + (r === S.radius ? 'on' : '') + '" data-act="radius" data-v="' + r + '">' + r + 'm</button>').join('') + '</div>';
  b.innerHTML = '<div class="head"><span>📍 ' + Util.esc(f.label) + '</span></div>' + (/概略/.test(f.label) ? '<div class="warn">場所がだいたいです。🔥を指でずらして直せます。</div>' : '') +
    (sel ? detailHtml(sel) + '<button class="btn big" data-act="back">← 一覧にもどる</button>' : filters) +
    (S.rows.map((x, i) => { const s = STATUS[Incident.status(x.w)], t = Util.isTank(x.w);
      return '<div class="it ' + (x.k === S.sel ? 'sel' : '') + '" data-act="pick" data-v="' + i + '"><div class="mk small ' + (t ? 'tank' : '') + '" style="--c:' + s.c + ';--t:' + s.t + '" data-s="' + s.s + '">' + (t ? '水' : '栓') + '</div><div class="n"><b>' + (t ? '防火水槽' : '消火栓') + '</b> ' + s.n + '<small>' + Util.esc(x.w.name) + '</small></div><div class="d"><span>' + Util.dir(f.lat, f.lng, x.w.lat, x.w.lng) + '</span>' + Math.round(x.d) + 'm</div></div>'; }).slice(0, CONFIG.search.listMax).join('') ||
      '<p><b>この範囲に該当する水利がありません。</b><br>範囲を広げるか、絞り込みを「全部」にしてください。</p>') +
    '<div class="foot">水利データ:' + Ledger.label() + '。位置は実際と多少ずれる場合があります。距離は直線です。</div>';
}

/* F. 操作(ボタンの動作) ----------------------------------- */
const ACT = {
  async search() {
    const q = $('q').value.trim(), c = $('cand'); if (!q) { $('q').focus(); return; }
    const ll = Addr.parseLatLng(q); if (ll) { c.style.display = 'none'; return setFire(ll.lat, ll.lng, ll.lat.toFixed(5) + ',' + ll.lng.toFixed(5)); }
    c.style.display = 'block'; c.innerHTML = '<div>さがしています…</div>';
    const r = await Addr.search(q);
    if (!r.list.length) { c.innerHTML = '<div style="color:#b00">' + { none: '住所が見つかりません。「南蒲田3-5」のように、町名と番地を入れてください。', offline: '通信できません。電波のある所で、もう一度お試しください。', gsioff: '住所データに見つかりません。管理者にお知らせください。' }[r.problem] + '</div>'; return; }
    S.cand = r.list.slice(0, 6); if (S.cand.length === 1) ACT.cand({ dataset: { v: 0 } });
    else c.innerHTML = S.cand.map((x, i) => '<button data-act="cand" data-v="' + i + '">' + Util.esc(x.title) + '</button>').join('');
  },
  cand(el) {
    const x = S.cand[+el.dataset.v], l = x.title + (x.rough ? '(町丁目の概略位置)' : ''); $('cand').style.display = 'none'; $('q').blur();
    const h = Store.get(K.history, []).filter(y => y.l !== l); h.unshift({ l, lat: x.lat, lng: x.lng }); Store.set(K.history, h.slice(0, 8)); setFire(x.lat, x.lng, l);
  },
  hist(el) { const h = Store.get(K.history, [])[+el.dataset.v]; $('cand').style.display = 'none'; $('q').blur(); setFire(h.lat, h.lng, h.l); },
  loc() { if (!navigator.geolocation) return toast('位置情報が使えません'); toast('現在地を調べています…'); navigator.geolocation.getCurrentPosition(p => setFire(p.coords.latitude, p.coords.longitude, 'いまいる場所'), () => toast('現在地を取得できません'), { enableHighAccuracy: true, timeout: 15000 }); },
  filter(el) { S.filter = el.dataset.v; calc(); renderAll(false); },
  hidebad() { S.hideBad = !S.hideBad; calc(); renderAll(false); },
  radius(el) { S.radius = +el.dataset.v; S.manual = true; S.sel = null; S.route = null; calc(); renderAll(true); },
  pick(el) { pick(+el.dataset.v); },
  back() { S.sel = null; S.route = null; drawWater(); drawRoute(); renderSheet(); fitFire(); },
  status(el) { const x = selRow(); if (!x) return; const v = +el.dataset.v; Incident.setStatus(x.w, v); toast((Util.isTank(x.w) ? '防火水槽' : '消火栓') + 'を「' + STATUS[v].n + '」にしました'); calc(); drawWater(); renderSheet(); },
  drawroute() {                         // 手で経路を描く
    const x = selRow(); if (!x) return; S.mode = 'route'; S.draw = [[x.w.lat, x.w.lng]];
    setBar('✏️ 水利から火点まで、<b>道路の曲がる所を順にタップ</b>してください。<span id="live"></span>', [['1つ戻す', 'm_undo'], ['やり直し', 'm_reset'], ['完了', 'm_finish']]); renderTmp();
  },
  resetroute() { const x = selRow(); delete Incident.d.rt[x.k]; Incident.save(); S.route = null; loadRoute(); },
  mkmenu() { if (!fireOf()) return toast('先に住所をさがしてください'); $('mkmenu').style.display = 'block'; },
  addmk(el) {
    const t = el.dataset.v; $('mkmenu').style.display = 'none'; endMode(); S.sel = null; S.route = null; drawWater(); drawRoute(); renderSheet(); S.mode = 'mk:' + t;
    if (t === 'road') setBar('⛔ <b>通行止めの道路に沿って、2か所以上タップ</b>してください。', [['1つ戻す', 'm_undo'], ['取消', 'm_cancel'], ['完了', 'm_finish']]);
    else setBar((t === 'guard' ? '🅰 警備地点' : MK[t].icon + ' ' + MK[t].n) + 'を置く場所を、<b>地図でタップ</b>してください。', [['取消', 'm_cancel']]);
  },
  delmk(el) { const i = Incident.d.mk.findIndex(m => m.id === el.dataset.v); if (i < 0) return; const [m] = Incident.d.mk.splice(i, 1); Incident.save(); map.closePopup(); drawField(); toast('削除しました', () => { Incident.d.mk.splice(i, 0, m); Incident.save(); drawField(); }); },
  m_undo() { S.draw.pop(); if (S.mode === 'route' && !S.draw.length) { const x = selRow(); S.draw = [[x.w.lat, x.w.lng]]; } renderTmp(); },
  m_reset() { const x = selRow(); S.draw = [[x.w.lat, x.w.lng]]; renderTmp(); },
  m_cancel() { endMode(); },
  m_finish() {
    if (S.mode === 'route') { const f = fireOf(), x = selRow(); Incident.d.rt[x.k] = S.draw.concat([[f.lat, f.lng]]); Incident.save(); endMode(); S.route = null; loadRoute(); toast('経路を保存しました'); }
    else if (S.mode === 'mk:road') { if (S.draw.length < 2) return toast('2か所以上タップしてください'); const m = S.draw[Math.floor(S.draw.length / 2)]; addMarker({ type: 'road', path: S.draw.slice(), lat: m[0], lng: m[1] }); endMode(); toast('通行止めを置きました'); if (S.sel) loadRoute(); }
  },
  share() {
    const url = location.origin + location.pathname + '#s=' + Incident.encode();
    if (navigator.share) navigator.share({ title: '水利さがし', url }).catch(() => {}); else navigator.clipboard ? navigator.clipboard.writeText(url).then(() => toast('共有リンクをコピーしました'), () => toast('コピーできませんでした')) : toast('コピーできませんでした');
  },
  help() { $('help').style.display = 'block'; }, closemodal() { document.querySelectorAll('.modal').forEach(m => m.style.display = 'none'); },
  font() { const v = document.documentElement.classList.toggle('large'); Store.set(K.largeFont, v ? 1 : 0); },
  endincident() { if (!confirm('この現場の記録(状態・マーカー・経路)を全て消します。よろしいですか?')) return; Incident.clear(); S.sel = null; S.route = null; S.all = []; S.rows = []; ACT.closemodal(); renderAll(false); toast('記録を消しました'); }
};
document.addEventListener('click', e => { const el = e.target.closest('[data-act]'); if (el && ACT[el.dataset.act]) ACT[el.dataset.act](el); });
map.on('click', e => {                  // 地図をタップしたとき
  $('cand').style.display = 'none'; if (!S.mode) return; const p = [e.latlng.lat, e.latlng.lng];
  if (S.mode === 'route' || S.mode === 'mk:road') { S.draw.push(p); renderTmp(); }
  else if (S.mode.startsWith('mk:')) { const t = S.mode.slice(3); addMarker({ type: t, lat: p[0], lng: p[1], name: t === 'guard' ? Incident.nextGuardName() : '' }); endMode(); toast(MK[t].n + 'を置きました'); }
});
map.on('contextmenu', e => setFire(e.latlng.lat, e.latlng.lng, '地図で指定した位置'));   // 長押し/右クリックで火点
$('q').addEventListener('keydown', e => { if (e.key === 'Enter') ACT.search(); });
$('q').addEventListener('input', () => { if ($('q').value.trim()) $('cand').style.display = 'none'; });
$('q').addEventListener('focus', () => {                // 最近の検索
  const h = Store.get(K.history, []); if ($('q').value.trim() || !h.length) return; const c = $('cand'); c.style.display = 'block';
  c.innerHTML = '<div>最近さがした場所</div>' + h.map((x, i) => '<button data-act="hist" data-v="' + i + '">' + Util.esc(x.l) + '</button>').join('');
});

/* G. 起動 ------------------------------------------------- */
(async function start() {
  if (Store.get(K.largeFont, 0)) document.documentElement.classList.add('large');
  $('credits').innerHTML = 'バージョン ' + CONFIG.version + '<br>水利:「東京消防庁 消火栓及び防火水槽等」(東京都オープンデータカタログ・東京消防庁)を加工して作成(CC BY 4.0)。位置は実際と多少ずれる場合があります。<br>住所:「位置参照情報ダウンロードサービス」(国土交通省)を加工して作成/国土地理院の地名検索。<br>地図:地理院タイル。経路:© OpenStreetMap contributors(OSRM)。<br>本アプリは補助ツールです。ホース本数は目安で、現場の判断を代替しません。';
  await Ledger.load();
  if (location.hash.startsWith('#s=')) {                // 共有リンクから開いたとき
    const j = Incident.decode(location.hash.slice(3)); history.replaceState(null, '', location.pathname);
    if (j && confirm('共有された現場を開きます。今の記録は上書きされます。よろしいですか?')) { Incident.d = j; Incident.save(); }
  }
  const f = fireOf(); if (f) { autoRadius(); renderAll(true); } else renderAll(false);
})();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
