import React from "react";
import { Smartphone, Link as LinkIcon, RefreshCw, PowerOff, ShieldCheck, QrCode } from "lucide-react";

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
    const isConnected = tenant.whatsapp_connected;

    return (
        <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in duration-500">
            {/* Main Connection Card */}
            <div className={`relative overflow-hidden rounded-3xl border transition-all duration-500 ${isConnected
                    ? "bg-white/[0.02] border-emerald-500/20 shadow-[0_0_40px_rgba(16,185,129,0.05)]"
                    : "bg-white/[0.02] border-white/10"
                } p-8 md:p-10 backdrop-blur-xl`}>

                {/* Decorative background gradient */}
                {isConnected && (
                    <div className="absolute top-0 right-0 -m-20 w-64 h-64 bg-emerald-500/20 rounded-full blur-[80px] pointer-events-none"></div>
                )}

                <div className="relative z-10 flex flex-col md:flex-row items-center md:items-start gap-8 text-center md:text-right">

                    {/* Status Icon */}
                    <div className="shrink-0 relative">
                        <div className={`w-28 h-28 rounded-full flex items-center justify-center border-4 ${isConnected
                                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                                : "bg-neutral-800 border-neutral-700 text-neutral-500"
                            }`}>
                            <Smartphone className="w-12 h-12" />

                            {/* Pulse animation for connected state */}
                            {isConnected && (
                                <div className="absolute inset-0 rounded-full border-2 border-emerald-400 animate-ping opacity-20"></div>
                            )}
                        </div>

                        {/* Status Badge */}
                        <div className={`absolute -bottom-2 md:-bottom-1 left-1/2 md:left-auto md:-right-2 transform -translate-x-1/2 md:translate-x-0 px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap border shadow-lg ${isConnected
                                ? "bg-emerald-950 border-emerald-500/50 text-emerald-400"
                                : "bg-neutral-900 border-neutral-700 text-neutral-400"
                            }`}>
                            {isConnected ? "מחובר" : "מנותק"}
                        </div>
                    </div>

                    <div className="flex-1 space-y-4">
                        <div>
                            <h2 className="text-3xl font-bold text-white mb-2 tracking-tight">
                                חיבור לווטסאפ
                            </h2>
                            <p className="text-neutral-400 text-lg">
                                {isConnected ? (
                                    <span className="flex items-center justify-center md:justify-start gap-2">
                                        מחובר למספר: <strong className="text-white font-mono bg-white/5 px-2 py-0.5 rounded" dir="ltr">{tenant.whatsapp_phone || "..."}</strong>
                                    </span>
                                ) : (
                                    "הסוכן כרגע לא מחובר לאף מספר ווטסאפ"
                                )}
                            </p>
                        </div>

                        {/* Connection States Area */}
                        <div className="pt-6 mt-6 border-t border-white/10">

                            {connectionStatus === "connecting" && (
                                <div className="flex flex-col items-center md:items-start p-6 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl">
                                    <div className="flex items-center gap-4 text-indigo-400 mb-2">
                                        <div className="w-6 h-6 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin"></div>
                                        <h3 className="font-semibold text-lg">מכין חיבור...</h3>
                                    </div>
                                    <p className="text-indigo-300 text-sm">אנא המתן בזמן שאנו מכינים את הקוד לסריקה.</p>
                                </div>
                            )}

                            {connectionStatus === "waiting_scan" && qrCode && (
                                <div className="flex flex-col md:flex-row items-center md:items-start gap-8 p-6 lg:p-8 bg-blue-500/5 border border-blue-500/20 rounded-3xl text-right">
                                    <div className="w-full max-w-[240px] shrink-0">
                                        <div className="bg-white p-4 rounded-3xl shadow-[0_0_30px_rgba(59,130,246,0.15)] ring-1 ring-white/10">
                                            <img src={qrCode} alt="WhatsApp QR Code" className="w-full h-auto rounded-xl" />
                                        </div>
                                    </div>
                                    <div className="flex-1 space-y-5">
                                        <div>
                                            <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                                                <QrCode className="w-5 h-5 text-blue-400" />
                                                סרוק את הברקוד
                                            </h3>
                                            <div className="space-y-3 text-neutral-300 text-sm">
                                                <p>כדי לחבר את הסוכן למספר שלך, פעל לפי השלבים הבאים:</p>
                                                <ol className="list-decimal list-inside space-y-2 mr-2 text-neutral-400">
                                                    <li>פתח את ווטסאפ במכשיר שלך</li>
                                                    <li>היכנס ל<strong className="text-white">הגדרות</strong> &gt; <strong className="text-white">מכשירים מקושרים</strong></li>
                                                    <li>לחץ על <strong className="text-white">קישור מכשיר</strong></li>
                                                    <li>סרוק את הברקוד המופיע במסך</li>
                                                </ol>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => handleReconnect(true)}
                                            className="inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-white/5 hover:bg-white/10 text-white rounded-xl border border-white/10 font-medium transition-all"
                                        >
                                            <RefreshCw className="w-4 h-4" />
                                            רענן ברקוד
                                        </button>
                                    </div>
                                </div>
                            )}

                            {isConnected && connectionStatus !== "waiting_scan" && (
                                <div className="space-y-6">
                                    <div className="flex items-center justify-center md:justify-start gap-3 text-emerald-400 bg-emerald-500/10 px-6 py-4 rounded-2xl border border-emerald-500/20">
                                        <ShieldCheck className="w-6 h-6" />
                                        <span className="font-medium text-lg">החיבור פעיל ותקין</span>
                                    </div>

                                    <div className="flex flex-col sm:flex-row items-center gap-4">
                                        <button
                                            onClick={() => handleReconnect(false)}
                                            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 bg-white/5 hover:bg-white/10 focus:ring-2 focus:ring-white/20 text-white rounded-xl border border-white/10 font-medium transition-all"
                                        >
                                            <RefreshCw className="w-5 h-5 opacity-70" />
                                            נסה להתחבר מחדש
                                        </button>
                                        <button
                                            onClick={handleDisconnect}
                                            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 focus:ring-2 focus:ring-red-500/20 rounded-xl border border-red-500/20 font-medium transition-all"
                                        >
                                            <PowerOff className="w-5 h-5" />
                                            נתק מכשיר
                                        </button>
                                    </div>
                                </div>
                            )}

                            {!isConnected &&
                                connectionStatus !== "connecting" &&
                                connectionStatus !== "waiting_scan" && (
                                    <button
                                        onClick={handleConnect}
                                        className="w-full md:w-auto inline-flex items-center justify-center gap-3 px-8 py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-semibold text-lg transition-all shadow-lg hover:shadow-[0_0_20px_rgba(99,102,241,0.4)] transform hover:-translate-y-0.5"
                                    >
                                        <LinkIcon className="w-6 h-6" />
                                        התחל תהליך חיבור
                                    </button>
                                )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
