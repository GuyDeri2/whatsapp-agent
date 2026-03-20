'use client';

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Smartphone, PowerOff, ShieldCheck, Loader2, Wifi, WifiOff } from "lucide-react";
import styles from "./ConnectTab.module.css";

/* ── Facebook SDK type declarations ── */
declare global {
    interface Window {
        fbAsyncInit?: () => void;
        FB?: {
            init: (params: { appId: string; cookie: boolean; xfbml: boolean; version: string }) => void;
            login: (
                cb: (response: {
                    authResponse?: { code?: string; accessToken?: string } | null;
                    status?: string;
                }) => void,
                opts: Record<string, unknown>,
            ) => void;
        };
    }
}

interface Tenant {
    id: string;
    whatsapp_connected: boolean;
    whatsapp_phone: string | null;
    whatsapp_cloud_config?: {
        phone_number_id: string;
        waba_id: string;
    } | null;
}

interface ConnectTabProps {
    tenant: Tenant;
    onDisconnect?: () => Promise<void>;
}

/* ── Embedded Signup session data from postMessage ── */
interface EmbeddedSignupEvent {
    type: string;
    data?: {
        phone_number_id?: string;
        waba_id?: string;
    };
}

const META_APP_ID = process.env.NEXT_PUBLIC_META_APP_ID ?? "";
const META_CONFIG_ID = process.env.NEXT_PUBLIC_META_CONFIG_ID ?? "";
const META_API_VERSION = "v21.0";

/** Timeout (ms) — if FB.login callback doesn't fire, fall back to redirect */
const POPUP_TIMEOUT_MS = 4000;

const ConnectTab = React.memo(function ConnectTab({
    tenant,
    onDisconnect,
}: ConnectTabProps) {
    const isConnected = tenant.whatsapp_connected && !!tenant.whatsapp_cloud_config;
    const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [sdkReady, setSdkReady] = useState(false);
    const sessionDataRef = useRef<{ phone_number_id?: string; waba_id?: string }>({});
    const popupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const callbackFiredRef = useRef(false);

    /* ── Load Facebook JS SDK ── */
    useEffect(() => {
        if (isConnected) return;

        // Listen for Embedded Signup session info (v2 postMessage)
        function handleMessage(event: MessageEvent) {
            if (event.origin !== "https://www.facebook.com" && event.origin !== "https://web.facebook.com") return;
            try {
                const data: EmbeddedSignupEvent =
                    typeof event.data === "string" ? JSON.parse(event.data) : event.data;

                if (data.type === "WA_EMBEDDED_SIGNUP" && data.data) {
                    sessionDataRef.current = data.data;
                }
            } catch {
                // Not our message
            }
        }
        window.addEventListener("message", handleMessage);

        // Load FB SDK
        if (window.FB) {
            setSdkReady(true);
        } else {
            window.fbAsyncInit = () => {
                window.FB!.init({
                    appId: META_APP_ID,
                    cookie: true,
                    xfbml: false,
                    version: META_API_VERSION,
                });
                setSdkReady(true);
            };

            if (!document.getElementById("facebook-jssdk")) {
                const script = document.createElement("script");
                script.id = "facebook-jssdk";
                script.src = "https://connect.facebook.net/en_US/sdk.js";
                script.async = true;
                script.defer = true;
                document.body.appendChild(script);
            }
        }

        return () => {
            window.removeEventListener("message", handleMessage);
            if (popupTimerRef.current) clearTimeout(popupTimerRef.current);
        };
    }, [isConnected]);

    /* ── Fallback: redirect to server-side OAuth ── */
    function fallbackToRedirect() {
        window.location.href = `/api/tenants/${tenant.id}/cloud-signup`;
    }

    /* ── Connect: try FB SDK popup, fall back to redirect ── */
    const handleConnect = useCallback(() => {
        if (busy) return;
        setError(null);
        setBusy("connect");
        callbackFiredRef.current = false;
        sessionDataRef.current = {};

        // If FB SDK not loaded, go straight to redirect
        if (!window.FB || !sdkReady) {
            fallbackToRedirect();
            return;
        }

        // Set a timeout — if popup is blocked, FB.login never calls the callback
        popupTimerRef.current = setTimeout(() => {
            if (!callbackFiredRef.current) {
                // Popup was likely blocked — fall back to redirect
                fallbackToRedirect();
            }
        }, POPUP_TIMEOUT_MS);

        window.FB.login(
            async (response) => {
                callbackFiredRef.current = true;
                if (popupTimerRef.current) {
                    clearTimeout(popupTimerRef.current);
                    popupTimerRef.current = null;
                }

                const code = response.authResponse?.code;
                if (!code) {
                    setBusy(null);
                    if (response.status === "unknown") {
                        // User closed the popup
                        return;
                    }
                    setError("ההתחברות בוטלה או נכשלה. נסה שוב.");
                    return;
                }

                // Send code + session data to our API
                try {
                    const res = await fetch(`/api/tenants/${tenant.id}/embedded-signup`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        credentials: "include",
                        body: JSON.stringify({
                            code,
                            waba_id: sessionDataRef.current.waba_id || undefined,
                            phone_number_id: sessionDataRef.current.phone_number_id || undefined,
                        }),
                    });

                    if (res.status === 401) {
                        window.location.href = "/login";
                        return;
                    }

                    const data = await res.json();
                    if (!res.ok) {
                        throw new Error(data.error || "שגיאה בהתחברות");
                    }

                    // Success — reload to show connected state
                    window.location.reload();
                } catch (err) {
                    setError(err instanceof Error ? err.message : "שגיאה בלתי צפויה");
                    setBusy(null);
                }
            },
            {
                config_id: META_CONFIG_ID,
                response_type: "code",
                override_default_response_type: true,
            },
        );
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [busy, tenant.id, sdkReady]);

    /* ── Disconnect ── */
    async function handleDisconnect() {
        if (busy) return;
        setError(null);
        setBusy("disconnect");
        try {
            const res = await fetch(`/api/tenants/${tenant.id}/cloud-signup`, {
                method: "DELETE",
                credentials: "include",
            });
            if (res.status === 401) {
                window.location.href = "/login";
                return;
            }
            const text = await res.text();
            let data: { error?: string } = {};
            try { data = JSON.parse(text); } catch { /* ok */ }
            if (!res.ok) throw new Error(data.error || "שגיאה בניתוק החיבור");

            if (onDisconnect) {
                await onDisconnect();
            } else {
                window.location.reload();
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "שגיאה בלתי צפויה");
        } finally {
            setBusy(null);
        }
    }

    return (
        <div className={styles.container}>
            {isConnected ? (
                /* ── Connected State ── */
                <div className={styles.card}>
                    <div className={styles.connectedHeader}>
                        <div className={styles.connectedIconWrap}>
                            <Wifi size={28} />
                            <div className={styles.pulseRing} />
                        </div>
                        <div>
                            <h2 className={styles.connectedTitle}>WhatsApp מחובר</h2>
                            <p className={styles.connectedPhone} dir="ltr">
                                {tenant.whatsapp_phone
                                    ? `+${tenant.whatsapp_phone}`
                                    : "מספר מחובר"}
                            </p>
                        </div>
                    </div>

                    <div className={styles.statusBar}>
                        <ShieldCheck size={18} />
                        <span>החיבור פעיל ותקין — הסוכן מקבל ועונה להודעות</span>
                    </div>

                    {error && <div className={styles.errorMsg}>{error}</div>}

                    <button
                        onClick={handleDisconnect}
                        disabled={!!busy}
                        className={styles.disconnectBtn}
                    >
                        {busy === "disconnect"
                            ? <Loader2 size={18} className={styles.spin} />
                            : <PowerOff size={18} />
                        }
                        {busy === "disconnect" ? "מנתק..." : "נתק חיבור"}
                    </button>
                </div>
            ) : (
                /* ── Disconnected State ── */
                <div className={styles.card}>
                    <div className={styles.disconnectedHeader}>
                        <div className={styles.disconnectedIconWrap}>
                            <WifiOff size={32} />
                        </div>
                        <h2 className={styles.disconnectedTitle}>חבר את הווטסאפ העסקי שלך</h2>
                        <p className={styles.disconnectedDesc}>
                            חבר מספר WhatsApp כדי שהסוכן יוכל לקבל ולענות להודעות באופן אוטומטי
                        </p>
                    </div>

                    <div className={styles.steps}>
                        <div className={styles.step}>
                            <span className={styles.stepNum}>1</span>
                            <span>לחץ על <strong>חבר WhatsApp</strong></span>
                        </div>
                        <div className={styles.step}>
                            <span className={styles.stepNum}>2</span>
                            <span>התחבר עם חשבון Facebook</span>
                        </div>
                        <div className={styles.step}>
                            <span className={styles.stepNum}>3</span>
                            <span>הכנס ואמת את המספר העסקי</span>
                        </div>
                    </div>

                    {error && <div className={styles.errorMsg}>{error}</div>}

                    <button
                        onClick={handleConnect}
                        disabled={!!busy}
                        className={styles.connectBtn}
                    >
                        {busy === "connect"
                            ? <Loader2 size={22} className={styles.spin} />
                            : <Smartphone size={22} />
                        }
                        {busy === "connect" ? "מחבר..." : "חבר WhatsApp"}
                    </button>
                </div>
            )}
        </div>
    );
});

export { ConnectTab };
