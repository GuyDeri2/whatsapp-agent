'use client';

import React from "react";
import { MessageSquare, Phone, Check, Lock, Settings, ArrowLeft } from "lucide-react";
import styles from "./HomeTab.module.css";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface HomeTabProps {
    whatsappConnected: boolean;
    whatsappPhone: string | null;
    voiceConnected: boolean;
    voicePhone: string | null;
    onNavigateToConnect: () => void;
    onNavigateToVoice: () => void;
    onNavigateToChat: () => void;
    onNavigateToVoiceSettings: () => void;
}

/* ------------------------------------------------------------------ */
/* HomeTab                                                             */
/* ------------------------------------------------------------------ */

const HomeTab = React.memo(function HomeTab({
    whatsappConnected,
    whatsappPhone,
    voiceConnected,
    voicePhone,
    onNavigateToConnect,
    onNavigateToVoice,
    onNavigateToChat,
    onNavigateToVoiceSettings,
}: HomeTabProps) {
    return (
        <div className={styles.container}>
            <h2 className={styles.heading}>ערוצי התקשורת שלך</h2>
            <p className={styles.subheading}>
                חבר ערוצים כדי לאפשר למזכירה AI לענות ללקוחות שלך בוואטסאפ ובטלפון
            </p>

            <div className={styles.grid}>
                {/* ── WhatsApp Channel Card ── */}
                <div className={`${styles.channelCard} ${whatsappConnected ? styles.channelCardConnected : ""}`}>
                    <div className={styles.cardHeader}>
                        <div className={`${styles.iconWrap} ${styles.iconWrapWa} ${whatsappConnected ? styles.iconWrapConnected : ""}`}>
                            <MessageSquare size={24} />
                            {whatsappConnected && <div className={styles.pulseRing} />}
                        </div>
                        <div>
                            <h3 className={styles.cardTitle}>WhatsApp</h3>
                            <p className={styles.cardDesc}>
                                {whatsappConnected ? "סוכן וואטסאפ פעיל" : "חבר את הוואטסאפ שלך"}
                            </p>
                        </div>
                    </div>

                    <div className={`${styles.statusBadge} ${whatsappConnected ? styles.statusConnected : styles.statusDisconnected}`}>
                        <span className={`${styles.statusDot} ${whatsappConnected ? styles.statusDotConnected : styles.statusDotDisconnected}`} />
                        {whatsappConnected ? "מחובר" : "לא מחובר"}
                    </div>

                    {whatsappConnected && whatsappPhone && (
                        <p className={styles.phoneNumber}>+{whatsappPhone}</p>
                    )}

                    <ul className={styles.featuresList}>
                        <li>
                            <span className={whatsappConnected ? styles.featureCheck : styles.featureLocked}>
                                {whatsappConnected ? <Check size={14} /> : <Lock size={14} />}
                            </span>
                            שיחות וואטסאפ עם לקוחות
                        </li>
                        <li>
                            <span className={whatsappConnected ? styles.featureCheck : styles.featureLocked}>
                                {whatsappConnected ? <Check size={14} /> : <Lock size={14} />}
                            </span>
                            ניהול אנשי קשר ולידים
                        </li>
                        <li>
                            <span className={whatsappConnected ? styles.featureCheck : styles.featureLocked}>
                                {whatsappConnected ? <Check size={14} /> : <Lock size={14} />}
                            </span>
                            ניהול יומן ופגישות
                        </li>
                    </ul>

                    {whatsappConnected ? (
                        <button className={styles.manageBtn} onClick={onNavigateToChat}>
                            <ArrowLeft size={16} />
                            פתח שיחות
                        </button>
                    ) : (
                        <button className={styles.connectBtn} onClick={onNavigateToConnect}>
                            <MessageSquare size={16} />
                            חבר WhatsApp
                        </button>
                    )}
                </div>

                {/* ── Voice Channel Card ── */}
                <div className={`${styles.channelCard} ${voiceConnected ? styles.channelCardConnected : ""}`}>
                    <div className={styles.cardHeader}>
                        <div className={`${styles.iconWrap} ${styles.iconWrapVoice} ${voiceConnected ? styles.iconWrapConnected : ""}`}>
                            <Phone size={24} />
                            {voiceConnected && <div className={styles.pulseRing} />}
                        </div>
                        <div>
                            <h3 className={styles.cardTitle}>סוכן קולי</h3>
                            <p className={styles.cardDesc}>
                                {voiceConnected ? "סוכן קולי פעיל" : "הפעל סוכן טלפוני"}
                            </p>
                        </div>
                    </div>

                    <div className={`${styles.statusBadge} ${voiceConnected ? styles.statusConnected : styles.statusDisconnected}`}>
                        <span className={`${styles.statusDot} ${voiceConnected ? styles.statusDotConnected : styles.statusDotDisconnected}`} />
                        {voiceConnected ? "פעיל" : "לא מופעל"}
                    </div>

                    {voiceConnected && voicePhone && (
                        <p className={styles.phoneNumber}>{voicePhone}</p>
                    )}

                    <ul className={styles.featuresList}>
                        <li>
                            <span className={voiceConnected ? styles.featureCheckVoice : styles.featureLocked}>
                                {voiceConnected ? <Check size={14} /> : <Lock size={14} />}
                            </span>
                            מענה אוטומטי לשיחות טלפון
                        </li>
                        <li>
                            <span className={voiceConnected ? styles.featureCheckVoice : styles.featureLocked}>
                                {voiceConnected ? <Check size={14} /> : <Lock size={14} />}
                            </span>
                            בחירת קול ושפת תגובה
                        </li>
                        <li>
                            <span className={voiceConnected ? styles.featureCheckVoice : styles.featureLocked}>
                                {voiceConnected ? <Check size={14} /> : <Lock size={14} />}
                            </span>
                            היסטוריית שיחות וסיכומים
                        </li>
                    </ul>

                    {voiceConnected ? (
                        <button className={styles.manageBtn} onClick={onNavigateToVoiceSettings}>
                            <Settings size={16} />
                            הגדרות סוכן קולי
                        </button>
                    ) : (
                        <button className={`${styles.connectBtn} ${styles.connectBtnVoice}`} onClick={onNavigateToVoice}>
                            <Phone size={16} />
                            הפעל סוכן קולי
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
});

export { HomeTab };
