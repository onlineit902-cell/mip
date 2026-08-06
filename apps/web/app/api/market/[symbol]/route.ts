import { NextResponse } from 'next/server';
import type { Timeframe } from '../../../../vendor/engine/src';
import { bySymbol } from '../../../../vendor/shared/src';
import { buildMarketAnalysis } from '../../../../lib/analysis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_TF: Timeframe[] = ['5m', '15m', '1h', '4h', '1d', '1w'];

export async function GET(
  req: Request,
  ctx: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await ctx.params;
  const inst = bySymbol(symbol);
  if (!inst) {
    return NextResponse.json({ error: `Unknown instrument: ${symbol}` }, { status: 404 });
  }

  const url = new URL(req.url);
  const tfParam = url.searchParams.get('tf') ?? '15m';
  const tf = (VALID_TF.includes(tfParam as Timeframe) ? tfParam : '15m') as Timeframe;

  try {
    const payload = await buildMarketAnalysis(inst, tf);
    return NextResponse.json(payload);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'analysis failed' },
      { status: 500 },
    );
  }
}
