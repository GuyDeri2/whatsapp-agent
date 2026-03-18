'use client';

import React, { useState } from "react";
import { Smartphone, Link as LinkIcon, PowerOff, ShieldCheck, Loader2, ExternalLink } from "lucide-react";
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
    const [busy, setBusy] = useState<"disconnect" | null>(null);
    const [error, setError] = useState<string | null>(null);

    function handleConnect() {
        // Navigate in same window (popup blockers can block window.open)
        window.location.href = `/api/tenants/${tenant.id}/cloud-signup`;
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
            let data: { error?: string; success?: boolean } = {};
            try { data = JSON.parse(text); } catch { /* empty or invalid response */ }

            if (!res.ok) {
                throw new Error(data.error || "שגיאה בניתוק החיבור");
            }

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
            <div className={`${styles.connectionCard} ${isConnected ? styles.connected : styles.disconnected}`}>

                {isConnected && (
                    <div className={styles.gradientBg}></div>
                )}

                <div className={styles.statusContainer}>

                    {/* Status Icon */}
                    <div className={styles.statusIcon}>
                        <div className={`${styles.iconCircle} ${isConnected ? styles.connected : styles.disconnected}`}>
                            <Smartphone className="w-12 h-12" />

                            {isConnected && (
                                <div className={styles.pulse}></div>
                            )}
                        </div>

                        <div className={`${styles.statusBadge} ${isConnected ? styles.connected : styles.disconnected}`}>
                            {isConnected ? "מחובר" : "מנותק"}
                        </div>
                    </div>

                    <div className={styles.content}>
                        <div>
                            <h2 className={styles.title}>
                                חיבור לווטסאפ
                            </h2>
                            <p className={styles.description}>
                                {isConnected ? (
                                    <span className="flex items-center justify-center md:justify-start gap-2">
                                        מחובר למספר: <strong className={styles.phoneNumber} dir="ltr">{tenant.whatsapp_phone || "..."}</strong>
                                        {" "}(WhatsApp Cloud API)
                                    </span>
                                ) : (
                                    "הסוכן כרגע לא מחובר לאף מספר ווטסאפ"
                                )}
                            </p>
                        </div>

                        {/* Error Message */}
                        {error && (
                            <div className={styles.errorMessage}>
                                {error}
                            </div>
                        )}

                        {/* Connection States Area */}
                        <div className={styles.connectionArea}>

                            {/* Connected State */}
                            {isConnected && (
                                <div className={styles.connectedState}>
                                    <div className={styles.connectedAlert}>
                                        <ShieldCheck className={styles.connectedIcon} />
                                        <span className={styles.connectedText}>החיבור פעיל ותקין</span>
                                    </div>

                                    <div className={styles.buttonGroup}>
                                        <button
                                            onClick={handleDisconnect}
                                            disabled={!!busy}
                                            className={styles.disconnectButton}
                                        >
                                            {busy === "disconnect"
                                                ? <Loader2 className={styles.loadingSpinner} />
                                                : <PowerOff className="w-5 h-5" />
                                            }
                                            {busy === "disconnect" ? "מנתק..." : "נתק חיבור"}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Disconnected State — Cloud Signup */}
                            {!isConnected && (
                                <div className={styles.cloudSignupCard}>
                                    <div className={styles.metaLogo}>
                                        <div className={styles.metaLogoContainer}>
                                            <img
                                                src="/meta-whatsapp-cloud.png"
                                                alt="Meta WhatsApp Cloud API"
                                                className={styles.metaLogoImage}
                                                onError={(e) => {
                                                    const target = e.target as HTMLImageElement;
                                                    target.style.display = 'none';
                                                    target.parentElement!.innerHTML = `
                                                        <div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #f0f0f0; border-radius: 0.75rem; padding: 2rem;">
                                                            <div style="text-align: center;">
                                                                <div style="font-size: 2rem; font-weight: bold; color: #0866FF;">Meta</div>
                                                                <div style="color: #25D366; font-weight: bold; margin-top: 0.5rem;">WhatsApp Cloud API</div>
                                                            </div>
                                                        </div>
                                                    `;
                                                }}
                                            />
                                        </div>
                                    </div>
                                    <div className={styles.cloudSignupContent}>
                                        <div>
                                            <h3 className={styles.cloudSignupTitle}>
                                                <ExternalLink className={styles.cloudSignupIcon} />
                                                הרשמה ל-WhatsApp Cloud API
                                            </h3>
                                            <div className={styles.cloudSignupSteps}>
                                                <p>כדי לחבר את הסוכן למספר הווטסאפ העסקי שלך:</p>
                                                <ol className={styles.cloudSignupList}>
                                                    <li>לחץ על <strong>התחבר ל-WhatsApp</strong></li>
                                                    <li>התחבר עם חשבון <strong>Meta</strong> שלך</li>
                                                    <li>בחר את המספר העסקי שלך</li>
                                                    <li>אשר את ההרשאות הנדרשות</li>
                                                </ol>
                                                <p>לאחר האישור, החיבור יתבצע אוטומטית.</p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={handleConnect}
                                            className={styles.mainConnectButton}
                                        >
                                            <LinkIcon className="w-6 h-6" />
                                            התחבר ל-WhatsApp
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});

export { ConnectTab };
