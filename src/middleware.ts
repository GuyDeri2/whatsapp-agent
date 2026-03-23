import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl

    // Webhook routes — bypass ALL middleware processing (no auth, no cookies)
    if (pathname.startsWith('/api/webhooks/')) {
        return NextResponse.next()
    }

    // Ignore static files, api routes, Next internals
    if (
        pathname.startsWith('/_next') ||
        pathname.startsWith('/api') ||
        pathname.startsWith('/static')
    ) {
        return NextResponse.next()
    }

    let supabaseResponse = NextResponse.next({
        request,
    })

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options)
                    )
                },
            },
        }
    )

    const {
        data: { user },
    } = await supabase.auth.getUser()

    // Protected Routes
    const isProtectedRoute = pathname.startsWith('/dashboard') || pathname.startsWith('/admin') || pathname.startsWith('/tenant')
    const isAuthRoute = pathname.startsWith('/login') || pathname.startsWith('/register') || pathname.startsWith('/forgot-password') || pathname.startsWith('/reset-password')

    if (isProtectedRoute && !user) {
        // Not logged in -> redirect to login
        const url = request.nextUrl.clone()
        url.pathname = '/login'
        return NextResponse.redirect(url)
    }

    if (user && (isProtectedRoute || isAuthRoute || pathname === '/pending-approval')) {
        // User is logged in and on a route that needs profile check
        const { data: profile } = await supabase.from('profiles').select('approval_status, role').eq('id', user.id).single()

        const isApproved = profile?.approval_status === 'approved'
        const isAdmin = profile?.role === 'admin'

        // No profile row — treat as pending
        if (!profile) {
            if (pathname !== '/pending-approval') {
                const url = request.nextUrl.clone()
                url.pathname = '/pending-approval'
                return NextResponse.redirect(url)
            }
            return supabaseResponse
        }

        // If they try to access a protected route but aren't approved
        if (isProtectedRoute && !isApproved) {
            const url = request.nextUrl.clone()
            url.pathname = '/pending-approval'
            return NextResponse.redirect(url)
        }

        // If they are on an auth route but already logged in and approved
        if (isAuthRoute && isApproved) {
            const url = request.nextUrl.clone()
            url.pathname = '/dashboard'
            return NextResponse.redirect(url)
        }

        // Admin protection
        if (pathname.startsWith('/admin') && !isAdmin) {
            const url = request.nextUrl.clone()
            url.pathname = '/dashboard'
            return NextResponse.redirect(url)
        }

        // Pending users hitting pending page
        if (pathname === '/pending-approval' && isApproved) {
            const url = request.nextUrl.clone()
            url.pathname = '/dashboard'
            return NextResponse.redirect(url)
        }
    }

    return supabaseResponse
}

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
}
