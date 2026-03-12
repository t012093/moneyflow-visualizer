export interface Node {
  id: string; // ISO3 or custom short id
  name: string;
  lat: number;
  lng: number;
  region: string;
  type: 'country' | 'corporation' | 'individual';
}

export interface Edge {
  edge_id: string;
  source_id: string;
  target_id: string;
  category: string;
  sub_category?: string;
  value_usd: number;
  year: number;
  unit?: string;
  freq?: string;
  period?: string; // e.g., '2018-03' or '2018-Q1'
  timestamp?: string;
  method?: string;
  source_dataset: string;
  license?: string;
  confidence: number;
  description?: string;
  evidence_text?: string;
  source_url?: string;
  source_title?: string;
  page_number?: number;
}

export const G20_NODES: Node[] = [
  // Countries
  { id: 'USA', name: 'アメリカ合衆国', lat: 39.8283, lng: -98.5795, region: 'Americas', type: 'country' },
  { id: 'CHN', name: '中国', lat: 35.8617, lng: 104.1954, region: 'Asia', type: 'country' },
  { id: 'JPN', name: '日本', lat: 36.2048, lng: 138.2529, region: 'Asia', type: 'country' },
  { id: 'DEU', name: 'ドイツ', lat: 51.1657, lng: 10.4515, region: 'Europe', type: 'country' },
  { id: 'GBR', name: 'イギリス', lat: 55.3781, lng: -3.4360, region: 'Europe', type: 'country' },
  { id: 'IND', name: 'インド', lat: 20.5937, lng: 78.9629, region: 'Asia', type: 'country' },
  { id: 'FRA', name: 'フランス', lat: 46.2276, lng: 2.2137, region: 'Europe', type: 'country' },
  { id: 'ITA', name: 'イタリア', lat: 41.8719, lng: 12.5674, region: 'Europe', type: 'country' },
  { id: 'CAN', name: 'カナダ', lat: 56.1304, lng: -106.3468, region: 'Americas', type: 'country' },
  { id: 'KOR', name: '韓国', lat: 35.9078, lng: 127.7669, region: 'Asia', type: 'country' },
  { id: 'RUS', name: 'ロシア', lat: 61.5240, lng: 105.3188, region: 'Europe/Asia', type: 'country' },
  { id: 'BRA', name: 'ブラジル', lat: -14.2350, lng: -51.9253, region: 'Americas', type: 'country' },
  { id: 'AUS', name: 'オーストラリア', lat: -25.2744, lng: 133.7751, region: 'Oceania', type: 'country' },
  { id: 'MEX', name: 'メキシコ', lat: 23.6345, lng: -102.5528, region: 'Americas', type: 'country' },
  { id: 'IDN', name: 'インドネシア', lat: -0.7893, lng: 113.9213, region: 'Asia', type: 'country' },
  { id: 'TUR', name: 'トルコ', lat: 38.9637, lng: 35.2433, region: 'Europe/Asia', type: 'country' },
  { id: 'SAU', name: 'サウジアラビア', lat: 23.8859, lng: 45.0792, region: 'Middle East', type: 'country' },
  { id: 'ARG', name: 'アルゼンチン', lat: -38.4161, lng: -63.6167, region: 'Americas', type: 'country' },
  { id: 'ZAF', name: '南アフリカ', lat: -30.5595, lng: 22.9375, region: 'Africa', type: 'country' },

  // Corporations
  { id: 'AAPL', name: 'Apple Inc.', lat: 37.3346, lng: -122.0090, region: 'Americas', type: 'corporation' },
  { id: 'TSLA', name: 'Tesla', lat: 30.2223, lng: -97.6171, region: 'Americas', type: 'corporation' },
  { id: 'TOYOTA', name: 'トヨタ自動車', lat: 35.0828, lng: 137.1562, region: 'Asia', type: 'corporation' },
  { id: 'TENCENT', name: 'テンセント', lat: 22.5431, lng: 113.9304, region: 'Asia', type: 'corporation' },
  { id: 'ARAMCO', name: 'サウジアラムコ', lat: 26.3048, lng: 50.1344, region: 'Middle East', type: 'corporation' },

  // Individuals / Demographics
  { id: 'HNWI_US', name: '米国 富裕層', lat: 40.7128, lng: -74.0060, region: 'Americas', type: 'individual' },
  { id: 'RET_JPN', name: '日本 個人投資家', lat: 35.6762, lng: 139.6503, region: 'Asia', type: 'individual' },
  { id: 'RET_IND', name: 'インド 出稼ぎ労働者', lat: 19.0760, lng: 72.8777, region: 'Asia', type: 'individual' },
  { id: 'CRYPTO_WHALE', name: '世界の暗号資産クジラ', lat: 25.0478, lng: -77.3554, region: 'Global', type: 'individual' }
];

const CATEGORIES = ['trade', 'banking', 'crypto', 'remittance', 'bop'];

/**
 * Generate a mock set of flow edges for a given year.
 */
export function generateMockDataForYear(year: number): Edge[] {
  const edges: Edge[] = [];
  
  // Randomly generate flows between G20 countries
  G20_NODES.forEach((source) => {
    G20_NODES.forEach((target) => {
      // Don't flow to self, and don't make every pair have a flow (sparsity)
      if (source.id === target.id || Math.random() > 0.15) return; // Allow more flows overall with new entities

      CATEGORIES.forEach((cat) => {
        // Enforce logic for new node types
        if (source.type === 'corporation' && target.type === 'corporation' && Math.random() > 0.1) return; // Rare B2B
        if (cat === 'crypto' && (source.type === 'country' || target.type === 'country') && Math.random() > 0.05) return; // Countries rarely hold direct crypto flows in this mock

        if (cat === 'crypto' && Math.random() > 0.4) return;
        if (cat === 'remittance' && Math.random() > 0.5) return;

        let confidence = 0.9;
        let method = 'reported';
        let dataset = 'IMF';

        if (cat === 'crypto') {
          confidence = 0.4 + Math.random() * 0.4; // 0.4 - 0.8
          method = 'estimated';
          dataset = 'BIS_Papers';
        } else if (cat === 'banking') {
          dataset = 'BIS_LBS';
          confidence = 0.85 + Math.random() * 0.1;
        } else if (cat === 'remittance') {
          dataset = 'WB_KNOMAD';
          method = 'estimated';
          confidence = 0.6 + Math.random() * 0.3;
        }

        // Amount grows over the years roughly, with some randomness
        let baseVol = Math.random() * 50_000_000_000; // up to 50B
        if (source.type === 'corporation' || target.type === 'corporation') baseVol *= 0.2; // corps are smaller scale than nations
        if (source.type === 'individual' || target.type === 'individual') baseVol *= 0.05; // retail is even smaller

        const growthFactor = 1 + ((year - 2006) * 0.05);
        const value_usd = baseVol * growthFactor;

        edges.push({
          edge_id: `${cat}_${source.id}_${target.id}_${year}`,
          source_id: source.id,
          target_id: target.id,
          category: cat,
          value_usd,
          year,
          unit: 'usd_current',
          freq: 'A',
          period: `${year}`,
          timestamp: `${year}-12-31`,
          method,
          source_dataset: dataset,
          license: 'CC-BY',
          confidence
        });
      });
    });
  });

  return edges;
}

/**
 * Generate a time-series dataset from 2006 to 2025
 */
export function generateFullTimeSeries(): Record<number, Edge[]> {
  const data: Record<number, Edge[]> = {};
  for (let y = 2006; y <= 2025; y++) {
    data[y] = generateMockDataForYear(y);
  }
  return data;
}
