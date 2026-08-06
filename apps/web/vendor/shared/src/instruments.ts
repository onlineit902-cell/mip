export type AssetClass = 'index' | 'commodity' | 'forex' | 'crypto' | 'stock' | 'etf';

export interface Instrument {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  /** Yahoo Finance chart symbol (dev-mode primary feed) */
  yahoo?: string;
  /** Binance spot symbol (production crypto feed) */
  binance?: string;
  decimals: number;
  quoteCcy?: string;
}

/**
 * The 18 core instruments. provider_symbol mappings per the architecture spec.
 * Anything with a `yahoo` symbol also works in dev-mode; any stock/ETF ticker
 * can be added later with just a new row.
 */
export const INSTRUMENTS: Instrument[] = [
  { symbol: 'US500', name: 'S&P 500', assetClass: 'index', yahoo: '^GSPC', decimals: 2, quoteCcy: 'USD' },
  { symbol: 'NAS100', name: 'Nasdaq 100', assetClass: 'index', yahoo: '^NDX', decimals: 2, quoteCcy: 'USD' },
  { symbol: 'US30', name: 'Dow Jones', assetClass: 'index', yahoo: '^DJI', decimals: 2, quoteCcy: 'USD' },
  { symbol: 'GER40', name: 'DAX 40', assetClass: 'index', yahoo: '^GDAXI', decimals: 2, quoteCcy: 'EUR' },
  { symbol: 'XAUUSD', name: 'Gold', assetClass: 'commodity', yahoo: 'GC=F', decimals: 2, quoteCcy: 'USD' },
  { symbol: 'XAGUSD', name: 'Silver', assetClass: 'commodity', yahoo: 'SI=F', decimals: 3, quoteCcy: 'USD' },
  { symbol: 'WTI', name: 'Crude Oil WTI', assetClass: 'commodity', yahoo: 'CL=F', decimals: 2, quoteCcy: 'USD' },
  { symbol: 'EURUSD', name: 'Euro / US Dollar', assetClass: 'forex', yahoo: 'EURUSD=X', decimals: 5, quoteCcy: 'USD' },
  { symbol: 'GBPUSD', name: 'Pound / US Dollar', assetClass: 'forex', yahoo: 'GBPUSD=X', decimals: 5, quoteCcy: 'USD' },
  { symbol: 'USDJPY', name: 'US Dollar / Yen', assetClass: 'forex', yahoo: 'USDJPY=X', decimals: 3, quoteCcy: 'JPY' },
  { symbol: 'AUDUSD', name: 'Aussie / US Dollar', assetClass: 'forex', yahoo: 'AUDUSD=X', decimals: 5, quoteCcy: 'USD' },
  { symbol: 'NZDUSD', name: 'Kiwi / US Dollar', assetClass: 'forex', yahoo: 'NZDUSD=X', decimals: 5, quoteCcy: 'USD' },
  { symbol: 'USDCAD', name: 'US Dollar / Canadian Dollar', assetClass: 'forex', yahoo: 'USDCAD=X', decimals: 5, quoteCcy: 'CAD' },
  { symbol: 'USDCHF', name: 'US Dollar / Swiss Franc', assetClass: 'forex', yahoo: 'USDCHF=X', decimals: 5, quoteCcy: 'CHF' },
  { symbol: 'BTC', name: 'Bitcoin', assetClass: 'crypto', yahoo: 'BTC-USD', binance: 'BTCUSDT', decimals: 0, quoteCcy: 'USD' },
  { symbol: 'ETH', name: 'Ethereum', assetClass: 'crypto', yahoo: 'ETH-USD', binance: 'ETHUSDT', decimals: 1, quoteCcy: 'USD' },
];

export const bySymbol = (symbol: string): Instrument | undefined =>
  INSTRUMENTS.find((i) => i.symbol === symbol.toUpperCase());

export const CLASS_LABEL: Record<AssetClass, string> = {
  index: 'Indices',
  commodity: 'Commodities',
  forex: 'Forex',
  crypto: 'Crypto',
  stock: 'Stocks',
  etf: 'ETFs',
};
