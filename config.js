/* ============================================================
 設定ファイル(数値・文言を変えたいときは、ここだけ直します)
============================================================ */
const CONFIG = {
  version: '2026-10-02',                       // 画面の「使い方」に表示される版
  map: {
    center: [35.5560, 139.7280], zoom: 15,     // 最初に表示する地図の中心
    tileUrl: 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',
    maxZoom: 18,
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>'
  },
  search: {
    radii: [100, 200, 300, 500],               // 「探す範囲」のボタン(m)
    autoRadii: [200, 300, 500],                // 水利が少ないとき、自動で広げる順
    minHits: 3,                                // これ未満なら、範囲を自動で広げる
    listMax: 60                                // 一覧に出す最大件数
  },
  hose: { length: 20, factor: 1.3, slack: 1.1 }, // 1本の長さ(m) / 経路が取れないときの「直線×係数」 / 余裕の割合(曲がり・たるみ)
  route: { url: 'https://routing.openstreetmap.de/routed-foot/route/v1/driving/' }, // 徒歩ルートの取得先(OSRM公開サーバー)
  data: { waterCsv: 'water.csv', defaultCity: '大田区' },
  // 端末の保存場所の名前(変えると、保存済みデータが見えなくなります)
  keys: { ledger:'sr_csv', ledgerAt:'sr_csv_at', blocks:'sr_blk', addrCache:'sr_addr',
          history:'sr_hist', incident:'sr_incident', useGsi:'sr_gsi', largeFont:'sr_font', sheetSize:'sr_size' }
};
