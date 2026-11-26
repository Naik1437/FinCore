import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function getApiBase(): string {
  if (process.env.INTERNAL_API_URL) {
    return process.env.INTERNAL_API_URL;
  }
  if (process.env.API_URL) {
    return process.env.API_URL;
  }
  if (process.env.NODE_ENV === 'production') {
    return 'http://api:4000';
  }
  return 'http://localhost:4000';
}

async function handleProxy(
  req: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> }
): Promise<NextResponse> {
  const apiBase = getApiBase();
  const resolvedParams = await params;
  const pathSegments = resolvedParams.path || [];
  const targetPath = pathSegments.join('/');
  const search = req.nextUrl.search || '';
  const targetUrl = `${apiBase}/api/${targetPath}${search}`;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (
      lower !== 'host' &&
      lower !== 'connection' &&
      lower !== 'transfer-encoding' &&
      lower !== 'content-length' &&
      lower !== 'x-forwarded-for' &&
      lower !== 'x-forwarded-host' &&
      lower !== 'x-forwarded-proto'
    ) {
      headers.set(key, value);
    }
  });

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  let bodyBuffer: ArrayBuffer | undefined = undefined;
  if (hasBody) {
    try {
      bodyBuffer = await req.arrayBuffer();
    } catch {
      bodyBuffer = undefined;
    }
  }

  const fetchOptions: RequestInit = {
    method: req.method,
    headers,
    body: bodyBuffer,
    redirect: 'manual',
  };

  try {
    const upstreamRes = await fetch(targetUrl, fetchOptions);

    const resHeaders = new Headers();
    upstreamRes.headers.forEach((val, key) => {
      const lower = key.toLowerCase();
      if (lower !== 'transfer-encoding' && lower !== 'content-encoding') {
        resHeaders.set(key, val);
      }
    });

    const resBody = await upstreamRes.arrayBuffer();
    return new NextResponse(resBody, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: resHeaders,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Upstream API unreachable';
    return NextResponse.json(
      {
        error: 'ProxyError',
        message: `FinCore API connection failed: ${msg}`,
        target: targetUrl,
      },
      { status: 502 }
    );
  }
}

export const GET = handleProxy;
export const POST = handleProxy;
export const PUT = handleProxy;
export const PATCH = handleProxy;
export const DELETE = handleProxy;
export const OPTIONS = handleProxy;
export const HEAD = handleProxy;
