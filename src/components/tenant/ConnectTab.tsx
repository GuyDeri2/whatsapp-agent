import React from "react";

interface Tenant {
    id: string;
    whatsapp_connected: boolean;
    whatsapp_phone: string | null;
}

interface ConnectTabProps {
    tenant: Tenant;
    connectionStatus: string;
    qrCode: string | null;
    handleConnect: () => Promise<void>;
    handleReconnect: (clearAuth?: boolean) => Promise<void>;
    handleDisconnect: () => Promise<void>;
}

export function ConnectTab({
    tenant,
    connectionStatus,
    qrCode,
    handleConnect,
    handleReconnect,
    handleDisconnect,
}: ConnectTabProps) {
    return (
        <div className="connection-section">
            <div className="connection-card">
                <div className="connection-header">
                    <div
                        className={`connection-icon ${tenant.whatsapp_connected ? "connected" : "disconnected"
                            }`}
                    >
                        {tenant.whatsapp_connected ? "📱" : "📵"}
                    </div>
                    <div>
                        <h2>חיבור לווטסאפ</h2>
                        <p>
                            {tenant.whatsapp_connected
                                ? `מחובר למספר: ${tenant.whatsapp_phone || "..."}`
                                : "הסוכן כרגע לא מחובר לאף מספר ווטסאפ"}
                        </p>
                    </div>
                </div>

                <div className="connection-body">
                    {connectionStatus === "connecting" && (
                        <div className="connecting-state">
                            <div className="spinner" />
                            <p>מכין חיבור... אנא המתן</p>
                        </div>
                    )}

                    {connectionStatus === "waiting_scan" && qrCode && (
                        <div className="qr-state">
                            <h3>סרוק את הברקוד</h3>
                            <p>
                                פתח את ווטסאפ במכשיר שלך &gt; מכשירים מקושרים &gt; קישור מכשיר
                            </p>
                            <div className="qr-container">
                                <img src={qrCode} alt="WhatsApp QR Code" />
                            </div>
                            <button
                                className="btn btn-ghost"
                                onClick={() => handleReconnect(true)}
                            >
                                🔄 רענן ברקוד
                            </button>
                        </div>
                    )}

                    {tenant.whatsapp_connected && connectionStatus !== "waiting_scan" && (
                        <div className="active-connection-actions">
                            <p className="success-text">✅ החיבור פעיל ותקין</p>
                            <div className="action-buttons">
                                <button
                                    className="btn btn-ghost"
                                    onClick={() => handleReconnect(false)}
                                >
                                    🔄 נסה להתחבר מחדש
                                </button>
                                <button
                                    className="btn btn-danger"
                                    onClick={handleDisconnect}
                                >
                                    🔌 נתק מכשיר
                                </button>
                            </div>
                        </div>
                    )}

                    {!tenant.whatsapp_connected &&
                        connectionStatus !== "connecting" &&
                        connectionStatus !== "waiting_scan" && (
                            <div className="disconnected-actions">
                                <button className="btn btn-primary btn-lg" onClick={handleConnect}>
                                    🔗 התחל תהליך חיבור
                                </button>
                            </div>
                        )}
                </div>
            </div>
        </div>
    );
}
