"use client";

import { motion } from "framer-motion";
import { MicOff, PhoneOff, Volume2, Settings } from "lucide-react";
import { useState, useEffect } from "react";

export function PhoneCallSimulation() {
    const [callDuration, setCallDuration] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            setCallDuration((prev) => {
                if (prev >= 47) return 0; // reset after ~47 seconds for loop
                return prev + 1;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60).toString().padStart(2, "0");
        const s = (seconds % 60).toString().padStart(2, "0");
        return `${m}:${s}`;
    };

    return (
        <div className="relative flex flex-col h-full text-white" dir="ltr">
            {/* iOS-style call background */}
            <div className="absolute inset-0 bg-gradient-to-b from-neutral-900/80 via-neutral-900/60 to-neutral-900/80 backdrop-blur-3xl z-0" />

            <div className="relative z-10 flex flex-col h-full pt-16 pb-8 px-6">
                {/* Caller Info */}
                <div className="flex flex-col items-center mt-6">
                    <p className="text-neutral-400 text-sm mb-2 opacity-80">שיחה נכנסת</p>
                    <h2 className="text-2xl font-light mb-1 text-center" dir="rtl">שירה — AI Secretary</h2>
                    <p className="text-neutral-300 font-light tracking-wider text-lg">
                        {formatTime(callDuration)}
                    </p>
                </div>

                {/* Avatar area */}
                <div className="flex-1 flex items-center justify-center relative">
                    <div className="relative w-28 h-28 flex items-center justify-center">
                        <motion.div
                            animate={{ scale: [1, 1.4, 1], opacity: [0.5, 0, 0.5] }}
                            transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                            className="absolute inset-0 bg-indigo-500/30 rounded-full blur-xl"
                        />
                        <motion.div
                            animate={{ scale: [1, 1.2, 1], opacity: [0.8, 0.2, 0.8] }}
                            transition={{ repeat: Infinity, duration: 2, delay: 0.5, ease: "easeInOut" }}
                            className="absolute inset-0 bg-indigo-500/40 rounded-full blur-lg"
                        />
                        <div className="w-24 h-24 bg-gradient-to-br from-indigo-600 to-purple-700 rounded-full flex items-center justify-center z-10 border-2 border-white/10 shadow-lg">
                            <span className="text-4xl">👩🏻‍💼</span>
                        </div>
                    </div>
                </div>

                {/* Waveform visualization */}
                <div className="flex items-center justify-center gap-[3px] mb-8 h-8">
                    {Array.from({ length: 20 }).map((_, i) => (
                        <motion.div
                            key={i}
                            animate={{
                                height: [4, Math.random() * 24 + 8, 4],
                            }}
                            transition={{
                                repeat: Infinity,
                                duration: 0.8 + Math.random() * 0.6,
                                delay: i * 0.05,
                                ease: "easeInOut",
                            }}
                            className="w-[3px] rounded-full bg-indigo-400/70"
                        />
                    ))}
                </div>

                {/* Call Controls */}
                <div className="flex flex-col gap-6 w-full px-2 pb-4">
                    <div className="grid grid-cols-3 gap-4 place-items-center">
                        <div className="flex flex-col items-center gap-1">
                            <div className="w-14 h-14 bg-white/10 rounded-full flex items-center justify-center backdrop-blur-md">
                                <Volume2 className="w-6 h-6 text-white" />
                            </div>
                            <span className="text-[10px] text-neutral-400">רמקול</span>
                        </div>
                        <div className="flex flex-col items-center gap-1">
                            <div className="w-14 h-14 bg-white/10 rounded-full flex items-center justify-center backdrop-blur-md">
                                <Settings className="w-6 h-6 text-white" />
                            </div>
                            <span className="text-[10px] text-neutral-400">הגדרות</span>
                        </div>
                        <div className="flex flex-col items-center gap-1">
                            <div className="w-14 h-14 bg-white/10 rounded-full flex items-center justify-center backdrop-blur-md">
                                <MicOff className="w-6 h-6 text-white" />
                            </div>
                            <span className="text-[10px] text-neutral-400">השתק</span>
                        </div>
                    </div>
                    <div className="flex justify-center">
                        <div className="w-16 h-16 bg-[#eb5545] rounded-full flex items-center justify-center shadow-lg">
                            <PhoneOff className="w-8 h-8 text-white" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
