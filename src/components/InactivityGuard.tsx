"use client";

import { useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

const INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutes

export function InactivityGuard() {
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const supabase = createClient();

    const logout = useCallback(async () => {
        await supabase.auth.signOut();
        window.location.href = "/";
    }, [supabase]);

    const resetTimer = useCallback(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(logout, INACTIVITY_TIMEOUT);
    }, [logout]);

    useEffect(() => {
        const events = ["mousedown", "keydown", "scroll", "touchstart"];
        events.forEach((e) => window.addEventListener(e, resetTimer));
        resetTimer();

        return () => {
            events.forEach((e) => window.removeEventListener(e, resetTimer));
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [resetTimer]);

    return null;
}
