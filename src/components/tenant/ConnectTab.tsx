import React, { useState } from "react";
import { Smartphone, Link as LinkIcon, RefreshCw, PowerOff, ShieldCheck, Loader2, ExternalLink } from "lucide-react";
import styles from "./ConnectTab.module.css";

interface Tenant {
    id: string;
    whatsapp_connected: boolean;
    whatsapp_phone: string | null;
    whatsapp_cloud_config?: {
        phone_number_id: string;
        waba_id: string;
        created_at: string;
    } | null;
}

interface ConnectTabProps {
    tenant: Tenant;
    connectionStatus: string;
    qrCode: string | null;
    handleConnect: () => Promise<void>;
    handleReconnect: (clearAuth?: boolean) => Promise<void>;
    handleDisconnect: () => Promise<void>;
}

const ConnectTab = React.memo(function ConnectTab({
    tenant,
    connectionStatus,
    qrCode,
    handleConnect,
    handleReconnect,
    handleDisconnect,
}: ConnectTabProps) {
    const isConnected = tenant.whatsapp_connected;
    const hasCloudConfig = !!tenant.whatsapp_cloud_config;
    const [busy, setBusy] = useState<"connect" | "reconnect" | "refresh" | "disconnect" | "cloud-signup" | null>(null);
    const [error, setError] = useState<string | null>(null);

    async function run(key: typeof busy, fn: () => Promise<void>) {
        if (busy) return;
        setError(null);
        setBusy(key);
        try { await fn(); } catch (err) {
            setError(err instanceof Error ? err.message : "שגיאה בלתי צפויה");
        } finally { setBusy(null); }
    }

    async function handleCloudSignup() {
        if (busy) return;
        setError(null);
        setBusy("cloud-signup");
        try {
            const res = await fetch(`/api/tenants/${tenant.id}/cloud-signup`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
            });
            
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Failed to initiate WhatsApp Cloud signup");
            }
            
            const data = await res.json();
            
            // Open Meta login popup
            if (data.authUrl) {
                const popup = window.open(
                    data.authUrl,
                    "whatsapp-cloud-signup",
                    "width=600,height=700,scrollbars=yes"
                );
                
                // Poll for completion
                const checkCompletion = setInterval(async () => {
                    if (popup?.closed) {
                        clearInterval(checkCompletion);
                        // Check if configuration was saved
                        const checkRes = await fetch(`/api/tenants/${tenant.id}/cloud-signup/status`);
                        if (checkRes.ok) {
                            // Refresh tenant data to show connected status
                            window.location.reload();
                        }
                    }
                }, 1000);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "שגיאה בלתי צפויה");
        } finally {
            setBusy(null);
        }
    }

    // Determine which connection method to show
    const showCloudSignup = !hasCloudConfig && !isConnected;
    const showWhatsAppWeb = hasCloudConfig && !isConnected && connectionStatus !== "waiting_scan";

    return (
        <div className={styles.container}>
            {/* Main Connection Card */}
            <div className={`${styles.connectionCard} ${isConnected ? styles.connected : styles.disconnected}`}>

                {/* Decorative background gradient */}
                {isConnected && (
                    <div className={styles.gradientBg}></div>
                )}

                <div className={styles.statusContainer}>

                    {/* Status Icon */}
                    <div className={styles.statusIcon}>
                        <div className={`${styles.iconCircle} ${isConnected ? styles.connected : styles.disconnected}`}>
                            <Smartphone className="w-12 h-12" />

                            {/* Pulse animation for connected state */}
                            {isConnected && (
                                <div className={styles.pulse}></div>
                            )}
                        </div>

                        {/* Status Badge */}
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
                                        {hasCloudConfig && " (WhatsApp Cloud API)"}
                                    </span>
                                ) : hasCloudConfig ? (
                                    "מוכן להתחברות דרך WhatsApp Cloud API"
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

                            {connectionStatus === "connecting" && (
                                <div className={styles.connectingState}>
                                    <div className={styles.connectingTitle}>
                                        <div className={styles.spinner}></div>
                                        <h3 className={styles.connectingText}>מכין חיבור...</h3>
                                    </div>
                                    <p className={styles.connectingSubtext}>אנא המתן בזמן שאנו מכינים את הקוד לסריקה.</p>
                                </div>
                            )}

                            {/* WhatsApp Cloud Signup Card */}
                            {showCloudSignup && connectionStatus !== "connecting" && (
                                <div className={styles.cloudSignupCard}>
                                    <div className={styles.metaLogo}>
                                        <div className={styles.metaLogoContainer}>
                                            <img 
                                                src="/meta-whatsapp-cloud.png" 
                                                alt="Meta WhatsApp Cloud API" 
                                                className={styles.metaLogoImage}
                                                onError={(e) => {
                                                    // Fallback if image doesn't exist
                                                    const target = e.target as HTMLImageElement;
                                                    target.style.display = 'none';
                                                    target.parentElement!.innerHTML = `
                                                        <div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #f0f0f0; border-radius: 0.75rem;">
                                                            <div style="text-align: center; padding: 1rem;">
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
                                                <p>כדי להשתמש ב-WhatsApp Cloud API, תצטרך:</p>
                                                <ol className={styles.cloudSignupList}>
                                                    <li>חשבון Meta for Developers פעיל</li>
                                                    <li>אפליקציית WhatsApp Business שהוגדרה</li>
                                                    <li>מספר טלפון עסקי מאומת</li>
                                                    <li>הרשאות לשלוח ולקבל הודעות</li>
                                                </ol>
                                                <p>לאחר ההרשמה, תקבל קישור לאימות חשבון ה-Meta שלך.</p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => run("cloud-signup", handleCloudSignup)}
                                            disabled={busy === "cloud-signup"}
                                            className={styles.mainConnectButton}
                                        >
                                            {busy === "cloud-signup"
                                                ? <Loader2 className={styles.loadingSpinner} />
                                                : <LinkIcon className="w-6 h-6" />
                                            }
                                            {busy === "cloud-signup" ? "מתחיל הרשמה..." : "התחבר ל-WhatsApp Cloud"}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Legacy WhatsApp Web QR Code (fallback) */}
                            {connectionStatus === "waiting_scan" && qrCode && (
                                <div className={styles.cloudSignupCard}>
                                    <div className={styles.metaLogo}>
                                        <div className={styles.metaLogoContainer}>
                                            <img src={qrCode} alt="WhatsApp QR Code" className={styles.metaLogoImage} />
                                        </div>
                                    </div>
                                    <div className={styles.cloudSignupContent}>
                                        <div>
                                            <h3 className={styles.cloudSignupTitle}>
                                                <ExternalLink className={styles.cloudSignupIcon} />
                                                סרוק את הברקוד
                                            </h3>
                                            <div className={styles.cloudSignupSteps}>
                                                <p>כדי לחבר את הסוכן למספר שלך, פעל לפי השלבים הבאים:</p>
                                                <ol className={styles.cloudSignupList}>
                                                    <li>פתח את ווטסאפ במכשיר שלך</li>
                                                    <li>היכנס ל<strong>הגדרות</strong> &gt; <strong>מכשירים מקושרים</strong></li>
                                                    <li>לחץ על <strong>קישור מכשיר</strong></li>
                                                    <li>סרוק את הברקוד המופיע במסך</li>
                                                </ol>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => run("refresh", () => handleReconnect(true))}
                                            disabled={busy === "refresh"}
                                            className={styles.connectButton}
                                        >
                                            {busy === "refresh"
                                                ? <Loader2 className={styles.loadingSpinner} />
                                                : <RefreshCw className="w-4 h-4" />
                                            }
                                            {busy === "refresh" ? "מרענן..." : "רענן ברקוד"}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {isConnected && connectionStatus !== "waiting_scan" && (
                                <div className={styles.connectedState}>
                                    <div className={styles.connectedAlert}>
                                        <ShieldCheck className={styles.connectedIcon} />
                                        <span className={styles.connectedText}>החיבור פעיל ותקין</span>
                                    </div>

                                    <div className={styles.buttonGroup}>
                                        <button
                                            onClick={() => run("reconnect", () => handleReconnect(false))}
                                            disabled={!!busy}
                                            className={styles.reconnectButton}
                                        >
                                            {busy === "reconnect"
                                                ? <Loader2 className={styles.loadingSpinner} />
                                                : <RefreshCw className="w-5 h-5 opacity-70" />
                                            }
                                            {busy === "reconnect" ? "מתחבר מחדש..." : "נסה להתחבר מחדש"}
                                        </button>
                                        <button
                                            onClick={() => run("disconnect", handleDisconnect)}
                                            disabled={!!busy}
                                            className={styles.disconnectButton}
                                        >
                                            {busy === "disconnect"
                                                ? <Loader2 className={styles.loadingSpinner} />
                                                : <PowerOff className="w-5 h-5" />
                                            }
                                            {busy === "disconnect" ? "מנתק..." : "נתק מכשיר"}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {showWhatsAppWeb && connectionStatus !== "connecting" && (
                                <button
                                    onClick={() => run("connect", handleConnect)}
                                    disabled={busy === "connect"}
                                    className={styles.mainConnectButton}
                                >
                                    {busy === "connect"
                                        ? <Loader2 className={styles.loadingSpinner} />
                                        : <LinkIcon className="w-6 h-6" />
                                    }
                                    {busy === "connect" ? "מתחיל חיבור..." : "התחל תהליך חיבור (WhatsApp Web)"}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});

export { ConnectTab };
