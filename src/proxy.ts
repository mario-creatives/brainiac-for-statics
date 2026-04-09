// NOTE: In Next.js 16 this file is proxy.ts, NOT middleware.ts
// Export is `proxy`, not `middleware`
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PROTECTED = ['/dashboard', '/account']
const AUTH_PAGES = ['/auth/login', '/auth/signup']

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Read Supabase session cookie (set by @supabase/auth-helpers-nextjs)
  const token =
    req.cookies.get('sb-access-token')?.value ||
    req.cookies.get(`sb-${process.env.NEXT_PUBLIC_SUPABASE_URL?.split('//')[1]?.split('.')[0]}-auth-token`)?.value
  const isAuthed = !!token

  if (PROTECTED.some(p => pathname.startsWith(p)) && !isAuthed) {
    const url = req.nextUrl.clone()
    url.pathname = '/auth/login'
    url.searchParams.set('redirect', pathname)
    return NextResponse.redirect(url)
  }

  if (AUTH_PAGES.some(p => pathname.startsWith(p)) && isAuthed) {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api|public).*)'],
}
