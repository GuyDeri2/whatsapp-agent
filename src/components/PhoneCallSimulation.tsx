"use client";

import { motion, AnimatePresence } from "framer-motion";
import { MicOff, Phone, Settings, PhoneOff, Volume2, User, Play, Pause } from "lucide-react";
import { useState, useEffect, useRef } from "react";

export function PhoneCallSimulation() {
    const [callState, setCallState] = useState<"incoming" | "in-call" | "ended">("incoming");
    const [callDuration, setCallDuration] = useState(0);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // Audio setup (using a placeholder file or user-provided file)
    useEffect(() => {
        audioRef.current = new Audio("/audio/agent-call.mp3");
        // We do not play until the call is "answered"
        return () => {
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.currentTime = 0;
            }
        };
    }, []);

    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (callState === "in-call") {
            interval = setInterval(() => {
                setCallDuration((prev) => prev + 1);
            }, 1000);
        }
        return () => clearInterval(interval);
    }, [callState]);

    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60).toString().padStart(2, "0");
        const s = (seconds % 60).toString().padStart(2, "0");
        return `${m}:${s}`;
    };

    const acceptCall = () => {
        setCallState("in-call");
        if (audioRef.current) {
            audioRef.current.play().catch(e => console.log("Audio play failed, maybe no file yet", e));
        }
    };

    const endCall = () => {
        setCallState("ended");
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
        }
        setCallDuration(0);

        // Reset after a few seconds
        setTimeout(() => {
            setCallState("incoming");
        }, 3000);
    };

    return (
        <div className="relative mx-auto w-full max-w-[320px] aspect-[1/2.05] bg-[#0A0A0A] rounded-[2.8rem] sm:rounded-[3rem] border-[8px] border-neutral-800 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.7)] overflow-hidden flex flex-col ring-1 ring-white/10" dir="ltr">
            {/* Glossy Bezel shine */}
            <div className="absolute inset-0 rounded-[2.5rem] border border-white/5 pointer-events-none z-50"></div>

            {/* Notch */}
            <div className="absolute top-0 inset-x-0 w-[45%] h-6 bg-[#0A0A0A] rounded-b-2xl mx-auto z-40 flex justify-center items-end pb-1.5 shadow-[0_2px_10px_rgba(0,0,0,0.5)]">
                <div className="w-14 h-1.5 bg-neutral-900 rounded-full flex gap-2 items-center justify-end px-1">
                    <div className="w-1 h-1 bg-blue-900/50 rounded-full"></div>
                </div>
            </div>

            {/* Background Blur Overlay for iOS feel */}
            <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-3xl z-0" />

            <div className="relative z-10 flex flex-col h-full text-white pt-16 pb-8 px-6">

                {/* Caller Info */}
                <div className="flex flex-col items-center mt-6">
                    <p className="text-neutral-400 text-sm mb-2 opacity-80">
                        {callState === "incoming" ? "WhatsApp Audio..." : "WhatsApp Call"}
                    </p>
                    <h2 className="text-3xl font-light mb-2 text-center" dir="rtl">שירה מ-AI Sales</h2>
                    <p className="text-neutral-300 font-light tracking-wider">
                        {callState === "incoming" ? "מתקשרת..." :
                            callState === "ended" ? "השיחה נותקה" :
                                formatTime(callDuration)}
                    </p>
                </div>

                {/* Avatar area */}
                <div className="flex-1 flex items-center justify-center relative">
                    <div className="relative w-32 h-32 flex items-center justify-center">
                        {callState === "in-call" && (
                            <>
                                <motion.div
                                    animate={{ scale: [1, 1.4, 1], opacity: [0.5, 0, 0.5] }}
                                    transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                                    className="absolute inset-0 bg-accent/30 rounded-full blur-xl"
                                />
                                <motion.div
                                    animate={{ scale: [1, 1.2, 1], opacity: [0.8, 0.2, 0.8] }}
                                    transition={{ repeat: Infinity, duration: 2, delay: 0.5, ease: "easeInOut" }}
                                    className="absolute inset-0 bg-accent/40 rounded-full blur-lg"
                                />
                            </>
                        )}
                        <div className="w-24 h-24 bg-gradient-to-br from-neutral-700 to-neutral-800 rounded-full flex items-center justify-center z-10 border-2 border-white/10 shadow-lg">
                            <span className="text-4xl">👩🏻‍💼</span>
                        </div>
                    </div>
                </div>

                {/* Call Controls */}
                <AnimatePresence mode="wait">
                    {callState === "incoming" ? (
                        <motion.div
                            key="incoming"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 20 }}
                            className="flex justify-between w-full px-4 pb-4"
                        >
                            <div className="flex flex-col items-center gap-2">
                                <button
                                    onClick={endCall}
                                    className="w-16 h-16 bg-[#eb5545] rounded-full flex items-center justify-center hover:bg-red-600 transition-colors shadow-lg active:scale-95"
                                >
                                    <PhoneOff className="w-8 h-8 text-white" />
                                </button>
                                <span className="text-xs text-neutral-300" dir="rtl">דחה</span>
                            </div>
                            <div className="flex flex-col items-center gap-2">
                                <motion.button
                                    animate={{ y: [0, -8, 0] }}
                                    transition={{ repeat: Infinity, duration: 2 }}
                                    onClick={acceptCall}
                                    className="w-16 h-16 bg-[#34c759] rounded-full flex items-center justify-center hover:bg-green-500 transition-colors shadow-lg shadow-green-500/20 active:scale-95"
                                >
                                    <Phone className="w-8 h-8 text-white fill-white" />
                                </motion.button>
                                <span className="text-xs text-neutral-300" dir="rtl">ענה</span>
                            </div>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="in-call"
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex flex-col gap-8 w-full px-2 pb-4"
                        >
                            {/* Top row of buttons */}
                            <div className="grid grid-cols-3 gap-4 place-items-center">
                                <div className="flex flex-col items-center gap-1">
                                    <button className="w-14 h-14 bg-white/10 rounded-full flex items-center justify-center backdrop-blur-md active:bg-white/20 transition-colors">
                                        <Volume2 className="w-6 h-6 text-white" />
                                    </button>
                                    <span className="text-[10px] text-neutral-400">רמקול</span>
                                </div>
                                <div className="flex flex-col items-center gap-1">
                                    <button className="w-14 h-14 bg-white/10 rounded-full flex items-center justify-center backdrop-blur-md active:bg-white/20 transition-colors">
                                        <Settings className="w-6 h-6 text-white" />
                                    </button>
                                    <span className="text-[10px] text-neutral-400">הגדרות</span>
                                </div>
                                <div className="flex flex-col items-center gap-1">
                                    <button className="w-14 h-14 bg-white/10 rounded-full flex items-center justify-center backdrop-blur-md active:bg-white/20 transition-colors">
                                        <MicOff className="w-6 h-6 text-white" />
                                    </button>
                                    <span className="text-[10px] text-neutral-400">השתק</span>
                                </div>
                            </div>

                            {/* Bottom row End Call */}
                            <div className="flex justify-center mt-4">
                                <button
                                    onClick={endCall}
                                    className="w-16 h-16 bg-[#eb5545] rounded-full flex items-center justify-center hover:bg-red-600 transition-colors shadow-lg active:scale-95"
                                >
                                    <PhoneOff className="w-8 h-8 text-white" />
                                </button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}
