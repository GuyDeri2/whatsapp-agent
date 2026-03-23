import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function sanitizeRedirectPath(path: string | null): string {
    if (!path || !path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) {
        return "/dashboard";
    }
    return path;
}

export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url);
    const code = searchParams.get("code");
    const next = sanitizeRedirectPath(searchParams.get("next"));

    if (code) {
        const cookieStore = await cookies();

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (!supabaseUrl || !supabaseAnonKey) {
            throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
        }

        const supabase = createServerClient(
            supabaseUrl,
            supabaseAnonKey,
            {
                cookies: {
                    getAll() {
                        return cookieStore.getAll();
                    },
                    setAll(cookiesToSet) {
                        cookiesToSet.forEach(({ name, value, options }) =>
                            cookieStore.set(name, value, options)
                        );
                    },
                },
            }
        );

        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) {
            return NextResponse.redirect(`${origin}${next}`);
        }
        console.error("[auth/callback] exchangeCodeForSession failed:", error.message);
        return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
    }

    // Log all params for debugging
    const allParams = Object.fromEntries(searchParams.entries());
    console.error("[auth/callback] no code param. All params:", JSON.stringify(allParams));
    const oauthError = searchParams.get("error_description") || searchParams.get("error") || "no_code";
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(oauthError)}`);
}
