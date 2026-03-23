'use client';

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Smartphone, PowerOff, ShieldCheck, Loader2, Wifi, WifiOff, QrCode, Building2, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
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
    connection_type?: string | null;
    whatsapp_cloud_config?: {
        phone_number_id: string;
        waba_id: string;
    } | null;
}

interface ConnectTabProps {
    tenant: Tenant;
    onDisconnect?: () => Promise<void>;
}

const META_APP_ID = process.env.NEXT_PUBLIC_META_APP_ID ?? "";
const META_CONFIG_ID = process.env.NEXT_PUBLIC_META_CONFIG_ID ?? "";
const META_API_VERSION = "v21.0";
const POPUP_TIMEOUT_MS = 4000;

const ConnectTab = React.memo(function ConnectTab({
    tenant,
    onDisconnect,
}: ConnectTabProps) {
    const isConnected = tenant.whatsapp_connected;
    const connectionType = tenant.connection_type ?? (tenant.whatsapp_cloud_config ? "cloud" : "none");
    const [busy, setBusy] = useState<"cloud" | "baileys" | "disconnect" | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [showQR, setShowQR] = useState(false);
    const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
    const [sdkReady, setSdkReady] = useState(false);
    const sessionDataRef = useRef<{ phone_number_id?: string; waba_id?: string }>({});
    const popupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const callbackFiredRef = useRef(false);

    /* ── Load Facebook JS SDK (for Cloud API option) ── */
    useEffect(() => {
        if (isConnected) return;

        function handleMessage(event: MessageEvent) {
            if (event.origin !== "https://www.facebook.com" && event.origin !== "https://web.facebook.com") return;
            try {
                const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
                if (data.type === "WA_EMBEDDED_SIGNUP" && data.data) {
                    sessionDataRef.current = data.data;
                }
            } catch { /* not our message */ }
        }
        window.addEventListener("message", handleMessage);

        if (!META_APP_ID) {
            // No app ID configured — SDK cannot initialize
            return () => { window.removeEventListener("message", handleMessage); };
        }

        if (window.FB) {
            setSdkReady(true);
        } else {
            window.fbAsyncInit = () => {
                window.FB!.init({ appId: META_APP_ID, cookie: true, xfbml: false, version: META_API_VERSION });
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

    /* ── QR code subscription (Supabase Realtime) ── */
    useEffect(() => {
        if (!showQR) return;

        const supabase = createClient();
        const channel = supabase
            .channel(`qr-${tenant.id}`)
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "baileys_qr_codes",
                    filter: `tenant_id=eq.${tenant.id}`,
                },
                (payload) => {
                    if (payload.eventType === "DELETE") {
                        // QR cleared = connected
                        setShowQR(false);
                        setQrDataUrl(null);
                        window.location.reload();
                        return;
                    }
                    const row = payload.new as { qr_data_url?: string };
                    if (row.qr_data_url) {
                        setQrDataUrl(row.qr_data_url);
                    }
                }
            )
            .on(
                "postgres_changes",
                {
                    event: "UPDATE",
                    schema: "public",
                    table: "tenants",
                    filter: `id=eq.${tenant.id}`,
                },
                (payload) => {
                    const row = payload.new as { whatsapp_connected?: boolean };
                    if (row.whatsapp_connected) {
                        // Backend set whatsapp_connected = true → close QR and refresh
                        setShowQR(false);
                        setQrDataUrl(null);
                        window.location.reload();
                    }
                }
            )
            .subscribe();

        // Also poll for initial QR
        supabase
            .from("baileys_qr_codes")
            .select("qr_data_url")
            .eq("tenant_id", tenant.id)
            .maybeSingle()
            .then(({ data }) => {
                if (data?.qr_data_url) setQrDataUrl(data.qr_data_url);
            });

        return () => {
            supabase.removeChannel(channel);
        };
    }, [showQR, tenant.id]);

    /* ── Connect: Cloud API (Embedded Signup) ── */
    const handleConnectCloud = useCallback(() => {
        if (busy) return;
        setError(null);
        setBusy("cloud");
        callbackFiredRef.current = false;
        sessionDataRef.current = {};

        if (!window.FB || !sdkReady) {
            window.location.href = `/api/tenants/${tenant.id}/cloud-signup`;
            return;
        }

        popupTimerRef.current = setTimeout(() => {
            if (!callbackFiredRef.current) {
                window.location.href = `/api/tenants/${tenant.id}/cloud-signup`;
            }
        }, POPUP_TIMEOUT_MS);

        window.FB.login(
            async (response) => {
                callbackFiredRef.current = true;
                if (popupTimerRef.current) { clearTimeout(popupTimerRef.current); popupTimerRef.current = null; }

                const code = response.authResponse?.code;
                if (!code) {
                    setBusy(null);
                    if (response.status !== "unknown") setError("ההתחברות בוטלה או נכשלה.");
                    return;
                }

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
                    if (res.status === 401) { window.location.href = "/login"; return; }
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || "שגיאה בהתחברות");
                    window.location.reload();
                } catch (err) {
                    setError(err instanceof Error ? err.message : "שגיאה בלתי צפויה");
                    setBusy(null);
                }
            },
            { config_id: META_CONFIG_ID, response_type: "code", override_default_response_type: true },
        );
    }, [busy, tenant.id, sdkReady]);

    /* ── Connect: Baileys (QR Code) ── */
    const handleConnectBaileys = useCallback(async () => {
        if (busy) return;
        setError(null);
        setBusy("baileys");

        try {
            const res = await fetch(`/api/tenants/${tenant.id}/baileys`, {
                method: "POST",
                credentials: "include",
            });

            if (res.status === 401) { window.location.href = "/login"; return; }
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "שגיאה בהתחלת חיבור");

            // Show QR modal
            setShowQR(true);
        } catch (err) {
            setError(err instanceof Error ? err.message : "שגיאה בלתי צפויה");
        } finally {
            setBusy(null);
        }
    }, [busy, tenant.id]);

    /* ── Disconnect ── */
    async function handleDisconnect() {
        if (busy) return;
        setError(null);
        setBusy("disconnect");
        try {
            const endpoint = connectionType === "baileys"
                ? `/api/tenants/${tenant.id}/baileys`
                : `/api/tenants/${tenant.id}/cloud-signup`;

            const res = await fetch(endpoint, {
                method: "DELETE",
                credentials: "include",
            });
            if (res.status === 401) { window.location.href = "/login"; return; }
            const text = await res.text();
            let data: { error?: string } = {};
            try { data = JSON.parse(text); } catch { /* ok */ }
            if (!res.ok) throw new Error(data.error || "שגיאה בניתוק");

            if (onDisconnect) { await onDisconnect(); }
            else { window.location.reload(); }
        } catch (err) {
            setError(err instanceof Error ? err.message : "שגיאה בלתי צפויה");
        } finally {
            setBusy(null);
        }
    }

    /* ── Cancel QR ── */
    function handleCancelQR() {
        setShowQR(false);
        setQrDataUrl(null);
        // Stop the session on the server
        fetch(`/api/tenants/${tenant.id}/baileys`, {
            method: "DELETE",
            credentials: "include",
        }).catch(() => {});
    }

    return (
        <div className={styles.container}>
            {/* ── QR Code Modal ── */}
            {showQR && (
                <div className={styles.qrOverlay} onClick={handleCancelQR}>
                    <div className={styles.qrModal} onClick={(e) => e.stopPropagation()}>
                        <h3 className={styles.qrTitle}>סרוק את הקוד עם WhatsApp</h3>
                        <p className={styles.qrDesc}>
                            פתח WhatsApp בטלפון → הגדרות → מכשירים מקושרים → קשר מכשיר
                        </p>

                        <div className={styles.qrContainer}>
                            {qrDataUrl ? (
                                <img src={qrDataUrl} alt="QR Code" className={styles.qrImage} />
                            ) : (
                                <div className={styles.qrPlaceholder}>
                                    <Loader2 size={32} className={styles.spin} />
                                    <span>מייצר קוד QR...</span>
                                </div>
                            )}
                        </div>

                        <div className={styles.qrWarning}>
                            <AlertTriangle size={16} />
                            <span>ה-QR מתחדש כל 20 שניות. סרוק מהר.</span>
                        </div>

                        <button onClick={handleCancelQR} className={styles.qrCancelBtn}>
                            ביטול
                        </button>
                    </div>
                </div>
            )}

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
                                {tenant.whatsapp_phone ? `+${tenant.whatsapp_phone}` : "מספר מחובר"}
                            </p>
                        </div>
                    </div>

                    <div className={styles.statusBar}>
                        <ShieldCheck size={18} />
                        <span>
                            {connectionType === "baileys"
                                ? "מחובר דרך WhatsApp Web — הסוכן מקבל ועונה להודעות"
                                : "החיבור פעיל ותקין — הסוכן מקבל ועונה להודעות"
                            }
                        </span>
                    </div>

                    {error && <div className={styles.errorMsg}>{error}</div>}

                    <button onClick={handleDisconnect} disabled={!!busy} className={styles.disconnectBtn}>
                        {busy === "disconnect" ? <Loader2 size={18} className={styles.spin} /> : <PowerOff size={18} />}
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
                        <h2 className={styles.disconnectedTitle}>חבר את ה-WhatsApp שלך</h2>
                        <p className={styles.disconnectedDesc}>
                            בחר את דרך החיבור המתאימה לך
                        </p>
                    </div>

                    {error && <div className={styles.errorMsg}>{error}</div>}

                    {/* ── Option 1: Personal WhatsApp (Baileys) ── */}
                    <div className={styles.optionCard}>
                        <div className={styles.optionHeader}>
                            <QrCode size={24} />
                            <div>
                                <h3 className={styles.optionTitle}>WhatsApp אישי</h3>
                                <p className={styles.optionDesc}>סרוק QR — ה-WhatsApp שלך נשאר עובד בטלפון</p>
                            </div>
                        </div>
                        <ul className={styles.optionFeatures}>
                            <li>לא צריך מספר עסקי נפרד</li>
                            <li>WhatsApp בטלפון ממשיך לעבוד</li>
                            <li>חיבור תוך 30 שניות</li>
                        </ul>
                        <button
                            onClick={handleConnectBaileys}
                            disabled={!!busy}
                            className={styles.connectBtn}
                        >
                            {busy === "baileys"
                                ? <Loader2 size={20} className={styles.spin} />
                                : <QrCode size={20} />
                            }
                            {busy === "baileys" ? "מתחבר..." : "חבר עם QR Code"}
                        </button>
                    </div>

                    {/* ── Option 2: Business WhatsApp (Cloud API) ── */}
                    <div className={styles.optionCard}>
                        <div className={styles.optionHeader}>
                            <Building2 size={24} />
                            <div>
                                <h3 className={styles.optionTitle}>WhatsApp Business</h3>
                                <p className={styles.optionDesc}>חיבור רשמי דרך Meta — יציב ואמין לטווח ארוך</p>
                            </div>
                        </div>
                        <ul className={styles.optionFeatures}>
                            <li>חיבור רשמי ויציב</li>
                            <li>דורש מספר עסקי נפרד</li>
                            <li>דורש חשבון Meta Business</li>
                        </ul>
                        <button
                            onClick={handleConnectCloud}
                            disabled={!!busy}
                            className={styles.connectBtnSecondary}
                        >
                            {busy === "cloud"
                                ? <Loader2 size={20} className={styles.spin} />
                                : <Building2 size={20} />
                            }
                            {busy === "cloud" ? "מתחבר..." : "חבר WhatsApp Business"}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
});

export { ConnectTab };
