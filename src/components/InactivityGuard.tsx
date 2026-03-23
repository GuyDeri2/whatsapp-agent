"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutes

export function InactivityGuard() {
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const supabaseRef = useRef(createClient());
    const [isLoggedIn, setIsLoggedIn] = useState(false);

    // Check auth status on mount
    useEffect(() => {
        supabaseRef.current.auth.getUser().then(({ data: { user } }) => {
            setIsLoggedIn(!!user);
        });
    }, []);

    const logout = useCallback(async () => {
        await supabaseRef.current.auth.signOut();
        window.location.href = "/";
    }, []);

    const resetTimer = useCallback(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(logout, INACTIVITY_TIMEOUT);
    }, [logout]);

    useEffect(() => {
        if (!isLoggedIn) return;

        const events = ["mousedown", "keydown", "scroll", "touchstart"];
        events.forEach((e) => window.addEventListener(e, resetTimer));
        resetTimer();

        return () => {
            events.forEach((e) => window.removeEventListener(e, resetTimer));
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [resetTimer, isLoggedIn]);

    return null;
}
