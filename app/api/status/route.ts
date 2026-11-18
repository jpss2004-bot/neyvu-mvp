import { NextRequest, NextResponse } from 'next/server';
import { accountFor } from '../../../lib/auth';
import { readSchool } from '../../../lib/data';
export const dynamic = 'force-dynamic';
export async function GET(request:NextRequest) {
  if (!await accountFor(request.headers.get('host'))) return NextResponse.json({error:'Private school access is not commissioned'}, {status:401});
  try { return NextResponse.json(await readSchool(), {headers:{'Cache-Control':'private, no-store'}}); }
  catch { return NextResponse.json({error:'Saved school evidence is unavailable. The existing worker has not been stopped.'}, {status:503}); }
}
