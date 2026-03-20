'use client';

import React, { useState } from "react";
import { Smartphone, PowerOff, ShieldCheck, Loader2, Wifi, WifiOff } from "lucide-react";
import styles from "./ConnectTab.module.css";

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

const ConnectTab = React.memo(function ConnectTab({
    tenant,
    onDisconnect,
}: ConnectTabProps) {
    const isConnected = tenant.whatsapp_connected && !!tenant.whatsapp_cloud_config;
    const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);
    const [error, setError] = useState<string | null>(null);

    function handleConnect() {
        if (busy) return;
        setBusy("connect");
        // Redirect to server-side OAuth flow — works in all browsers, no FB SDK needed
        window.location.href = `/api/tenants/${tenant.id}/cloud-signup`;
    }

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
