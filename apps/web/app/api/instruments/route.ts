import { NextResponse } from 'next/server';
import { INSTRUMENTS } from '../../../vendor/shared/src';
import { buildOverviewCard } from '../../../lib/analysis';
import { pool } from '../../../lib/candles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const cards = await pool(INSTRUMENTS, 4, buildOverviewCard);
  return NextResponse.json({ asOf: Date.now(), instruments: cards });
}
