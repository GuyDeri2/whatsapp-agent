'use client';

import React, { useState, useEffect, useCallback } from "react";
import { Smartphone, PowerOff, ShieldCheck, Loader2, Wifi, WifiOff } from "lucide-react";
import styles from "./ConnectTab.module.css";

declare global {
    interface Window {
        FB: {
            init: (params: { appId: string; cookie: boolean; xfbml: boolean; version: string }) => void;
            login: (callback: (response: FBLoginResponse) => void, options: Record<string, unknown>) => void;
        };
        fbAsyncInit: () => void;
        _waEmbeddedSignupData?: { waba_id: string; phone_number_id: string };
    }
}

interface FBLoginResponse {
    authResponse?: {
        code?: string;
        accessToken?: string;
    };
    status: string;
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

const META_APP_ID = process.env.NEXT_PUBLIC_META_APP_ID || "";
const META_CONFIG_ID = process.env.NEXT_PUBLIC_META_CONFIG_ID || "";

const ConnectTab = React.memo(function ConnectTab({
    tenant,
    onDisconnect,
}: ConnectTabProps) {
    const isConnected = tenant.whatsapp_connected && !!tenant.whatsapp_cloud_config;
    const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [sdkLoaded, setSdkLoaded] = useState(false);

    // Load Facebook SDK
    useEffect(() => {
        const initFB = () => {
            window.FB.init({
                appId: META_APP_ID,
                cookie: true,
                xfbml: true,
                version: "v21.0",
            });
            setSdkLoaded(true);
        };

        if (window.FB) {
            initFB();
            return;
        }

        window.fbAsyncInit = initFB;

        const script = document.createElement("script");
        script.src = "https://connect.facebook.net/en_US/sdk.js";
        script.async = true;
        script.defer = true;
        script.crossOrigin = "anonymous";
        document.body.appendChild(script);
    }, []);

    // Listen for Embedded Signup postMessage events
    const handleMessage = useCallback((event: MessageEvent) => {
        if (event.origin !== "https://www.facebook.com" && event.origin !== "https://web.facebook.com") {
            return;
        }
        try {
            const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
            if (data.type === "WA_EMBEDDED_SIGNUP") {
                if (data.event === "FINISH" || data.event === "FINISH_ONLY_WABA") {
                    const { waba_id, phone_number_id } = data.data || {};
                    if (waba_id && phone_number_id) {
                        window._waEmbeddedSignupData = { waba_id, phone_number_id };
                    }
                } else if (data.event === "CANCEL") {
                    setBusy(null);
                }
            }
        } catch {
            // Not relevant
        }
    }, []);

    useEffect(() => {
        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [handleMessage]);

    function handleConnect() {
        if (busy) return;

        if (!window.FB || !window.FB.login) {
            setError("Facebook SDK לא נטען. רענן את הדף ונסה שוב.");
            return;
        }

        if (!META_APP_ID || !META_CONFIG_ID) {
            setError(`הגדרות Meta חסרות (appId=${META_APP_ID}, configId=${META_CONFIG_ID}). פנה לתמיכה.`);
            return;
        }

        // Always call FB.init() before FB.login() to ensure SDK is ready
        window.FB.init({
            appId: META_APP_ID,
            cookie: true,
            xfbml: true,
            version: "v21.0",
        });

        try {
            window.FB.login(
                function (response: FBLoginResponse) {
                    if (response.status !== "connected" || !response.authResponse?.code) {
                        setBusy(null);
                        return;
                    }

                    setBusy("connect");
                    const code = response.authResponse.code;
                    const signupData = window._waEmbeddedSignupData;

                    fetch(`/api/tenants/${tenant.id}/embedded-signup`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            code,
                            waba_id: signupData?.waba_id,
                            phone_number_id: signupData?.phone_number_id,
                        }),
                    })
                        .then((res) => res.json().then((d) => ({ ok: res.ok, data: d })))
                        .then(({ ok, data }) => {
                            if (!ok) {
                                setError(data.error || "שגיאה בחיבור WhatsApp");
                                setBusy(null);
                                return;
                            }
                            window.location.reload();
                        })
                        .catch((err) => {
                            setError(err instanceof Error ? err.message : "שגיאה בלתי צפויה");
                            setBusy(null);
                        });
                },
                {
                    config_id: META_CONFIG_ID,
                    response_type: "code",
                    override_default_response_type: true,
                    extras: {
                        setup: {},
                        featureType: "",
                        sessionInfoVersion: "3",
                    },
                }
            );
        } catch (err) {
            setError(err instanceof Error ? err.message : "שגיאה בפתיחת חלון ההתחברות");
        }
    }

    async function handleDisconnect() {
        if (busy) return;
        setError(null);
        setBusy("disconnect");
        try {
            const res = await fetch(`/api/tenants/${tenant.id}/cloud-signup`, {
                method: "DELETE",
            });
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
