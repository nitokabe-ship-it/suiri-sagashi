/* ============================================================
 共通部品(index.html と admin.html で使います)
  1. Store    端末への保存
  2. Util     距離・方角・ホース本数
  3. Ledger   水利データ(消火栓・防火水槽)
  4. Addr     住所検索(街区データ → 国土地理院 の順)
  5. Importer CSVの取り込み(管理画面から使います)
============================================================ */
const K = CONFIG.keys;

/* 1. Store ------------------------------------------------ */
const Store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
};

/* 2. Util ------------------------------------------------- */
const Util = {
  dist(lat1, lng1, lat2, lng2) {                // 2点間の直線距離(m)
    const r = Math.PI / 180, x = (lng2 - lng1) * r * Math.cos((lat1 + lat2) / 2 * r), y = (lat2 - lat1) * r;
    return 6371000 * Math.hypot(x, y);
  },
  dir(lat1, lng1, lat2, lng2) {                 // 8方位(北・北東…)
    const y = lat2 - lat1, x = (lng2 - lng1) * Math.cos((lat1 + lat2) / 2 * Math.PI / 180);
    return ['北','北東','東','南東','南','南西','西','北西'][Math.round(((Math.atan2(x, y) * 180 / Math.PI) + 360) % 360 / 45) % 8];
  },
  hose: d => Math.ceil(d * CONFIG.hose.factor / CONFIG.hose.length),
  isTank: w => w.type === '防火水槽',
  esc: s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))
};

/* 3. Ledger ----------------------------------------------- */
const Ledger = {
  items: [], source: '',                        // source: 'local'(端末に取り込み)/'file'(water.csv)
  parse(text) {                                 // 「種別,名称,緯度,経度」の行 → 配列
    return text.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const p = l.split(/[,\t]/).map(x => x.trim());
      return { type: p[0], name: p[1] || '', lat: +p[2], lng: +p[3] };
    }).filter(w => (w.type === '消火栓' || w.type === '防火水槽') && isFinite(w.lat) && isFinite(w.lng));
  },
  async load() {                                // 端末 → water.csv の順に読む
    this.items = this.parse(Store.get(K.ledger, '')); this.source = this.items.length ? 'local' : '';
    if (!this.items.length) {
      try { const r = await fetch(CONFIG.data.waterCsv, { cache: 'no-cache' });
        if (r.ok) { this.items = this.parse((await r.text()).replace(/^\uFEFF/, '')); this.source = 'file'; } } catch (e) {}
    }
    return this.items.length;
  },
  counts() { const t = this.items.filter(Util.isTank).length; return { gate: this.items.length - t, tank: t }; },
  label() {
    if (!this.items.length) return 'データなし';
    const at = Store.get(K.ledgerAt, 0);
    return this.source === 'local' && at ? new Date(at).toLocaleDateString('ja-JP') + ' に取り込み' : 'water.csv';
  }
};

/* 4. Addr ------------------------------------------------- */
const Addr = {
  GSI: 'https://msearch.gsi.go.jp/address-search/AddressSearch?q=',
  blocks: Store.get(K.blocks, []), cache: Store.get(K.addrCache, {}),
  norm(s) {                                     // 表記ゆれをそろえる(全角→半角、三丁目→3-、番/号 など)
    const N = { '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9 };
    return s.normalize('NFKC').replace(/[\s　]/g, '').replace(/^東京都/, '')
      .replace(/([一二三四五六七八九十]+)丁目/g, (m, k) => { let n = 0, c = 0; for (const h of k) { if (h === '十') { n += (c || 1) * 10; c = 0; } else c = N[h]; } return (n + c) + '丁目'; })
      .replace(/[番の]/g, '-').replace(/号/g, '').replace(/丁目/g, '-').replace(/[-‐ー－]+$/, '').replace(/[ー‐－]/g, '-');
  },
  fromBlocks(q) {                               // 街区データから探す(通信なし・番地まで)
    if (!this.blocks.length) return [];
    const n = this.norm(q), ok = k => n === k || (n.startsWith(k) && !/\d/.test(n[k.length] || ''));
    let h = this.blocks.filter(b => ok(b.k) || ok(b.c));
    if (!h.length) h = this.blocks.filter(b => n.length >= 3 && (b.k.startsWith(n) || b.c.startsWith(n))).slice(0, 6);
    h.sort((a, b) => b.k.length - a.k.length);
    return h.slice(0, 6).map(b => ({ title: b.t, lat: b.a, lng: b.o, rough: false }));
  },
  async fromGsi(q) {                            // 国土地理院の住所検索(通信あり・町丁目までの場合あり)
    const c = new AbortController(), t = setTimeout(() => c.abort(), 8000);
    try {
      const j = await (await fetch(this.GSI + encodeURIComponent(q), { signal: c.signal })).json();
      return j.map(f => ({ title: f.properties.title, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], rough: !/[0-9０-９]$/.test(f.properties.title) }));
    } finally { clearTimeout(t); }
  },
  fromCache(q) { const n = this.norm(q); return Object.entries(this.cache).filter(([k]) => { const m = this.norm(k); return m.startsWith(n) || n.startsWith(m); }).map(([k, v]) => ({ title: k, lat: v.lat, lng: v.lng, rough: true })); },
  parseLatLng(s) {                              // 「35.55,139.73」やGoogleマップのURLも受け付ける
    s = s.replace(/[　\s]/g, ''); try { s = decodeURIComponent(s); } catch (e) {}
    const m = s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || s.match(/[?&](?:q|query|ll|destination)=(-?\d+\.\d+),(-?\d+\.\d+)/) || s.match(/^(-?\d+\.\d+),(-?\d+\.\d+)$/);
    return m ? { lat: +m[1], lng: +m[2] } : null;
  },
  /* 結果: { list:[…], problem:'' | 'none' | 'offline' | 'gsioff' } */
  async search(q) {
    let list = this.fromBlocks(q); if (list.length) return { list, problem: '' };
    if (!Store.get(K.useGsi, 1)) return { list: [], problem: 'gsioff' };
    try {
      list = await this.fromGsi(q);
      list.slice(0, 5).forEach(x => this.cache[x.title] = { lat: x.lat, lng: x.lng });
      if (Object.keys(this.cache).length > 400) this.cache = {};
      Store.set(K.addrCache, this.cache);
      return { list, problem: list.length ? '' : 'none' };
    } catch (e) { list = this.fromCache(q); return { list, problem: list.length ? '' : 'offline' }; }
  }
};

/* 5. Importer(管理画面用) -------------------------------- */
const Importer = {
  rows(buf) {                                   // CSVを読み、2次元配列にする(UTF-8 / Shift-JIS 自動判定)
    let t; try { t = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { t = new TextDecoder('shift_jis').decode(buf); }
    t = t.replace(/^\uFEFF/, ''); const r = []; let f = '', w = [], q = 0;
    for (let i = 0; i < t.length; i++) { const c = t[i];
      if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = 0; } else f += c; }
      else if (c === '"') q = 1; else if (c === ',') { w.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; w.push(f); f = ''; if (w.length > 1) r.push(w); w = []; }
      else f += c; }
    if (f || w.length) { w.push(f); if (w.length > 1) r.push(w); } return r;
  },
  /* 水利CSV。only: '' = 「種別」列を使う / '消火栓' / '防火水槽' = ファイル全体をその種別にする */
  async water(file, only) {
    const R = this.rows(await file.arrayBuffer()), h = R[0].map(x => x.trim());
    const la = h.findIndex(x => /緯度|lat/i.test(x)), lo = h.findIndex(x => /経度|lon|lng/i.test(x)), na = h.findIndex(x => /名称|所在|住所|場所|施設|番号/.test(x)), ki = h.findIndex(x => x.includes('種別'));
    if (la < 0 || lo < 0) throw new Error('緯度・経度の列が見つかりません(見出し:' + h.join(' / ') + ')');
    if (!only && ki < 0) throw new Error('「種別」の列がありません。「消火栓だけ」か「防火水槽だけ」を選んでください');
    const out = []; R.slice(1).forEach(r => { let a = +r[la], o = +r[lo]; if (Math.abs(a) > 90) [a, o] = [o, a];
      if (!isFinite(a) || !isFinite(o) || !a || !o) return; const ty = only || (r[ki] || '').trim();
      if (ty !== '消火栓' && ty !== '防火水槽') return; out.push(ty + ',' + (na >= 0 ? (r[na] || '').replace(/[,\n\r]/g, ' ').trim() : '') + ',' + a + ',' + o); });
    if (!out.length) throw new Error('取り込める行がありません(種別が「消火栓」「防火水槽」の行が必要です)');
    const tys = new Set(out.map(l => l.split(',')[0])), keep = Store.get(K.ledger, '').split('\n').filter(l => l.trim() && !tys.has(l.split(',')[0]));
    if (!Store.set(K.ledger, keep.concat(out).join('\n'))) throw new Error('端末に保存できません(容量不足・プライベートモード)');
    Store.set(K.ledgerAt, Date.now()); return out.length;
  },
  /* 街区レベル位置参照情報(国土交通省)。city: 取り込む市区町村名 */
  async blocks(file, city) {
    const R = this.rows(await file.arrayBuffer()), h = R[0].map(x => x.trim()), f = k => h.findIndex(x => x.includes(k));
    const ci = f('市区町村'), ti = f('大字'), bi = f('街区'), la = f('緯度'), lo = f('経度'), rp = f('代表');
    if ([ci, ti, bi, la, lo].some(i => i < 0)) throw new Error('街区レベル位置参照情報のCSVではないようです');
    const mp = new Map(); R.slice(1).forEach(r => {
      if (!(r[ci] || '').includes(city)) return; const a = +r[la], o = +r[lo]; if (!isFinite(a) || !isFinite(o)) return;
      const tn = (r[ti] || '').trim(), bk = (r[bi] || '').trim(), k = Addr.norm(r[ci] + tn) + '-' + bk, rep = rp >= 0 ? (r[rp] || '').trim() : '1', old = mp.get(k);
      if (old && (old.rep === '1' || rep !== '1')) return;          // 同じ街区は「代表フラグ=1」の点を採用
      mp.set(k, { k, c: Addr.norm(tn) + '-' + bk, t: r[ci] + tn + bk, a, o, rep }); });
    const out = [...mp.values()]; if (!out.length) throw new Error('「' + city + '」の行がありません');
    if (!Store.set(K.blocks, out)) throw new Error('端末に保存できません(容量不足)');
    Addr.blocks = out; return out.length;
  },
  clearLedger() { Store.set(K.ledger, ''); Store.set(K.ledgerAt, 0); }
};

/* 6. Incident(いまの現場の状態。端末に保存。共有リンクにもなる) ------ */
const STATUS = [                                // 色+記号+文字の3つで区別(色だけに頼らない)
  { n: '未確認',   s: '?', c: '#f9a825', t: '#111' },
  { n: '使用可',   s: '○', c: '#2e7d32', t: '#fff' },
  { n: '署使用',   s: '署', c: '#1565c0', t: '#fff' },
  { n: '使用困難', s: '×', c: '#c62828', t: '#fff' }
];
const Incident = {
  d: Store.get(K.incident, { fire: null, st: {}, mk: [], rt: {} }),
  // fire:火点 / st:水利の状態 / mk:現場マーカー / rt:手で描いたホース経路
  save() { Store.set(K.incident, this.d); },
  key: w => w.type + ':' + (w.name || w.lat + ',' + w.lng),
  status(w) { return this.d.st[this.key(w)] || 0; },
  setStatus(w, v) { if (v) this.d.st[this.key(w)] = v; else delete this.d.st[this.key(w)]; this.save(); },
  clear() { this.d = { fire: null, st: {}, mk: [], rt: {} }; this.save(); },
  nextGuardName() { const used = this.d.mk.filter(m => m.type === 'guard').map(m => m.name); for (let i = 0; i < 26; i++) { const n = String.fromCharCode(65 + i); if (!used.includes(n)) return n; } return '?'; },
  encode() { return btoa(unescape(encodeURIComponent(JSON.stringify(this.d)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  decode(s) { try { const j = JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))))); return j && j.st && j.mk && j.rt ? j : null; } catch (e) { return null; } }
};
