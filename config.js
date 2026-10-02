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
  data: { waterCsv: 'water.csv', defaultCity: '大田区', asOf: '令和7年4月1日版' },   // asOf:画面に出す水利データの日付(データを差し替えたら必ず直す)
  // 端末の保存場所の名前(変えると、保存済みデータが見えなくなります)
  keys: { ledger:'sr_csv', ledgerAt:'sr_csv_at', blocks:'sr_blk', addrCache:'sr_addr',
          history:'sr_hist', sheetOpen:'sr_open', listH:'sr_lh', incident:'sr_incident', useGsi:'sr_gsi', largeFont:'sr_font', sheetSize:'sr_size' }
};
/* 出典・ライセンス(画面には、「使い方」の中の「出典」を開いたときだけ表示) */
CONFIG.credits = [
  '水利:「東京消防庁 消火栓及び防火水槽等」(東京都オープンデータカタログ・東京消防庁)を加工して作成。CC BY 4.0。位置は実際と多少ずれる場合があります。',
  '住所データ:「位置参照情報ダウンロードサービス」(国土交通省)を加工して作成。住所検索:国土地理院の地名検索。',
  '地図:地理院タイル(国土地理院)。経路:© OpenStreetMap contributors(OSRM)。',
  '本アプリは補助ツールです。ホース本数は目安で、現場の判断を代替しません。'
];
