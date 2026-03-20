"use client";

import { motion, AnimatePresence } from "framer-motion";
import { CheckCheck } from "lucide-react";
import { useState, useEffect } from "react";

export function PhoneMockup() {
    const defaultMessages = [
        { text: "היי, אפשר לקבל פרטים על השירות שלכם?", sender: "user" },
        { text: "שלום! בשמחה. איזה שירות מעניין אותך במיוחד? 🤖", sender: "bot" },
        { text: "אני צריכה עזרה עם מענה אוטומטי ללקוחות שלי", sender: "user" },
        { text: "מעולה. המערכת שלנו יודעת לקרוא את הלקוחות שלך, ללמוד את העסק שלך ולסגור עסקאות באופן עצמאי. רוצה שאשלח לך קישור להתנסות חינם?", sender: "bot" },
    ];

    const [visibleMessages, setVisibleMessages] = useState<number>(0);
    const [isTyping, setIsTyping] = useState(false);

    useEffect(() => {
        const sequence = async () => {
            // Wait for entry
            await new Promise(r => setTimeout(r, 1500));
            // Show first message
            setVisibleMessages(1);

            // Bot typing
            await new Promise(r => setTimeout(r, 800));
            setIsTyping(true);
            await new Promise(r => setTimeout(r, 1800));
            setIsTyping(false);
            setVisibleMessages(2);

            // User typing
            await new Promise(r => setTimeout(r, 1500));
            setVisibleMessages(3);

            // Bot typing
            await new Promise(r => setTimeout(r, 800));
            setIsTyping(true);
            await new Promise(r => setTimeout(r, 2200));
            setIsTyping(false);
            setVisibleMessages(4);
        };

        sequence();

        // Loop every 15 seconds
        const intervalId = setInterval(() => {
            setVisibleMessages(0);
            setIsTyping(false);
            setTimeout(sequence, 500);
        }, 15000);

        return () => clearInterval(intervalId);
    }, []);

    return (
        <div className="relative mx-auto w-full max-w-[320px] aspect-[1/2.05] bg-[#0A0A0A] rounded-[2.8rem] sm:rounded-[3rem] border-[8px] border-neutral-800 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.7)] overflow-hidden flex flex-col ring-1 ring-white/10">
            {/* Glossy Bezel shine */}
            <div className="absolute inset-0 rounded-[2.5rem] border border-white/5 pointer-events-none z-50"></div>

            {/* Notch */}
            <div className="absolute top-0 inset-x-0 w-[45%] h-6 bg-[#0A0A0A] rounded-b-2xl mx-auto z-40 flex justify-center items-end pb-1.5 shadow-[0_2px_10px_rgba(0,0,0,0.5)]">
                <div className="w-14 h-1.5 bg-neutral-900 rounded-full flex gap-2 items-center justify-end px-1">
                    <div className="w-1 h-1 bg-blue-900/50 rounded-full"></div>
                </div>
            </div>

            {/* Screen/WhatsApp Header */}
            <div className="bg-[#075e54] text-white pt-10 pb-3 px-4 flex items-center shadow-lg z-30 shrink-0 relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent pointer-events-none" />
                <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center font-bold text-white overflow-hidden shrink-0 ring-1 ring-white/20">
                    <span className="text-xl">✨</span>
                </div>
                <div className="mr-3 flex-1 min-w-0">
                    <h3 className="font-semibold text-[15px] leading-tight truncate tracking-tight">AI Sales Agent</h3>
                    <p className="text-xs text-emerald-200 truncate flex items-center gap-1 font-light">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                        מחובר עכשיו
                    </p>
                </div>
            </div>

            {/* Chat Area */}
            <div className="flex-1 bg-[#efeae2] p-4 flex flex-col gap-3 overflow-y-auto overflow-x-hidden relative custom-scrollbar">
                {/* Chat Background Pattern */}
                <div className="absolute inset-0 opacity-[0.06] pointer-events-none" style={{ backgroundImage: 'url("https://w0.peakpx.com/wallpaper/818/148/HD-wallpaper-whatsapp-background-solid-color-whatsapp-background-thumbnail.jpg")', backgroundSize: 'cover' }} />

                <AnimatePresence>
                    {defaultMessages.slice(0, visibleMessages).map((msg, idx) => (
                        <motion.div
                            key={idx}
                            initial={{ opacity: 0, y: 15, scale: 0.95, transformOrigin: msg.sender === 'bot' ? 'bottom right' : 'bottom left' }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            transition={{ duration: 0.3, type: "spring", stiffness: 200, damping: 20 }}
                            className={`max-w-[85%] rounded-xl p-2.5 px-3.5 text-[14px] shadow-sm relative z-10 leading-relaxed ${msg.sender === "bot"
                                ? "self-end bg-[#d9fdd3] rounded-tr-sm text-neutral-800"
                                : "self-start bg-white rounded-tl-sm text-neutral-800"
                                }`}
                        >
                            {msg.text}
                            <div className="flex justify-end items-center gap-1.5 mt-1 -mb-1">
                                <span className="text-[10px] text-neutral-500 font-medium">12:00</span>
                                {msg.sender === "bot" && <CheckCheck className="w-3.5 h-3.5 text-blue-500" />}
                            </div>
                        </motion.div>
                    ))}

                    {isTyping && (
                        <motion.div
                            initial={{ opacity: 0, y: 10, scale: 0.9 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            className="self-end bg-[#d9fdd3] rounded-xl rounded-tr-sm px-4 py-3 text-sm shadow-sm relative z-10 mt-1 w-[60px]"
                        >
                            <div className="flex gap-1 items-center justify-center h-2">
                                <span className="w-1.5 h-1.5 bg-neutral-500 rounded-full animate-[bounce_1s_infinite_-0.3s]"></span>
                                <span className="w-1.5 h-1.5 bg-neutral-500 rounded-full animate-[bounce_1s_infinite_-0.15s]"></span>
                                <span className="w-1.5 h-1.5 bg-neutral-500 rounded-full animate-[bounce_1s_infinite]"></span>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                <div className="h-4 shrink-0"></div>
            </div>

            {/* Message Input Bottom Bar */}
            <div className="bg-[#f0f2f5] p-2.5 flex gap-2 items-center shrink-0 border-t border-black/5 z-20 relative">
                <div className="bg-white flex-1 rounded-full px-4 py-2.5 flex items-center text-neutral-400 text-sm shadow-sm ring-1 ring-black/5 pb-2">
                    הקלד/י הודעה...
                </div>
                <div className="w-10 h-10 bg-[#00a884] shadow-md rounded-full flex items-center justify-center shrink-0 text-white transform hover:scale-105 transition-transform">
                    <svg className="w-5 h-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                </div>
            </div>
        </div>
    );
}
