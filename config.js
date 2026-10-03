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
  wards: { 13101:'千代田区',13102:'中央区',13103:'港区',13104:'新宿区',13105:'文京区',13106:'台東区',13107:'墨田区',13108:'江東区',13109:'品川区',13110:'目黒区',13111:'大田区',13112:'世田谷区',13113:'渋谷区',13114:'中野区',13115:'杉並区',13116:'豊島区',13117:'北区',13118:'荒川区',13119:'板橋区',13120:'練馬区',13121:'足立区',13122:'葛飾区',13123:'江戸川区' },   // 住所の逆引きで使う区名
  towns: ['蒲田本町','大森南','東六郷','羽田旭町','大森西','羽田空港','西蒲田','中央','蒲田','仲六郷','羽田','本羽田','南六郷','萩中','大森中','東蒲田','南蒲田','北糀谷','東糀谷','西糀谷'],   // クイズの対象の町
  quiz: { count: 10 },                         // 1回の問題数
  // みんなで同期する場合の設定(空のままなら、同期の機能は画面に出ません)。手順は README の「同期の設定」
  sync: { url: '' },                           // 例 'https://xxxx-default-rtdb.asia-southeast1.firebasedatabase.app'
  // 端末の保存場所の名前(変えると、保存済みデータが見えなくなります)
  keys: { ledger:'sr_csv', ledgerAt:'sr_csv_at', blocks:'sr_blk', addrCache:'sr_addr',
          history:'sr_hist', quiz:'sr_quiz2', check:'sr_check', past:'sr_past', room:'sr_room', rcache:'sr_rcache', sheetOpen:'sr_open', listH:'sr_lh', incident:'sr_incident', useGsi:'sr_gsi', largeFont:'sr_font', sheetSize:'sr_size' }
};
/* 出典・ライセンス(画面には、「使い方」の中の「出典」を開いたときだけ表示) */
CONFIG.credits = [
  '水利:「東京消防庁 消火栓及び防火水槽等」(東京都オープンデータカタログ・東京消防庁)を加工して作成。CC BY 4.0。位置は実際と多少ずれる場合があります。',
  '住所データ:「位置参照情報ダウンロードサービス」(国土交通省)を加工して作成。住所検索:国土地理院の地名検索。',
  '地図:地理院タイル(国土地理院)。経路:© OpenStreetMap contributors(OSRM)。',
  '本アプリは補助ツールです。ホース本数は目安で、現場の判断を代替しません。'
];
