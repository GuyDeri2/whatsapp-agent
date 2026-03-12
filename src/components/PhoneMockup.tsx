"use client";

import { motion } from "framer-motion";
import { CheckCheck } from "lucide-react";

export function PhoneMockup() {
    const messages = [
        { text: "היי, אפשר לקבל פרטים על השירות שלכם?", sender: "user", delay: 0.5 },
        { text: "שלום! בשמחה. איזה שירות מעניין אותך במיוחד?", sender: "bot", delay: 2 },
        { text: "אני צריך עזרה עם שימור לקוחות ותגובות אוטומטיות", sender: "user", delay: 4 },
        { text: "מעולה, הגעת למקום הנכון. המערכת שלנו יודעת לענות ללקוחות שלך 24/7 בדיוק כמו שאתה עונה להם. רוצה שאשלח לך סרטון הדגמה?", sender: "bot", delay: 6.5 },
    ];

    return (
        <div className="relative mx-auto w-full max-w-[320px] aspect-[1/2.05] bg-black rounded-[2.5rem] sm:rounded-[3rem] border-[6px] sm:border-[8px] border-neutral-800 shadow-2xl overflow-hidden flex flex-col transform transition-transform hover:scale-[1.02] duration-500">
            {/* Notch */}
            <div className="absolute top-0 inset-x-0 w-[40%] h-5 sm:h-6 bg-black rounded-b-xl mx-auto z-20 flex justify-center items-end pb-1">
                <div className="w-10 sm:w-12 h-1sm:h-1.5 bg-neutral-800 rounded-full" />
            </div>

            {/* Screen/WhatsApp Header */}
            <div className="bg-[#075e54] text-white pt-8 sm:pt-10 pb-2 sm:pb-3 px-3 sm:px-4 flex items-center shadow-md z-10 shrink-0">
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-neutral-300 flex items-center justify-center text-xs sm:text-sm font-bold text-neutral-600 overflow-hidden shrink-0">
                    🤖
                </div>
                <div className="mr-3 flex-1 min-w-0">
                    <h3 className="font-semibold text-[14px] sm:text-[15px] leading-tight truncate">סוכן AI חכם</h3>
                    <p className="text-[11px] sm:text-xs text-white/80 truncate">מחובר עכשיו</p>
                </div>
            </div>

            {/* Chat Area */}
            <div className="flex-1 bg-[#efeae2] p-3 sm:p-4 flex flex-col gap-3 overflow-y-auto overflow-x-hidden relative custom-scrollbar">
                {/* Chat Background Pattern */}
                <div className="absolute inset-0 opacity-[0.06] pointer-events-none" style={{ backgroundImage: 'url("https://w0.peakpx.com/wallpaper/818/148/HD-wallpaper-whatsapp-background-solid-color-whatsapp-background-thumbnail.jpg")', backgroundSize: 'cover' }} />

                {messages.map((msg, idx) => (
                    <motion.div
                        key={idx}
                        initial={{ opacity: 0, y: 15, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ delay: msg.delay, duration: 0.4, type: "spring" }}
                        className={`max-w-[85%] rounded-lg p-2 px-3 text-[13px] sm:text-[14px] shadow-sm relative z-10 ${msg.sender === "bot"
                            ? "self-end bg-[#d9fdd3] rounded-tr-none text-neutral-800"
                            : "self-start bg-white rounded-tl-none text-neutral-800"
                            }`}
                    >
                        {msg.text}
                        <div className="flex justify-end items-center gap-1 mt-1 -mb-1">
                            <span className="text-[9px] sm:text-[10px] text-neutral-500">12:00</span>
                            {msg.sender === "bot" && <CheckCheck className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-blue-500" />}
                        </div>
                    </motion.div>
                ))}

                {/* Typing indicator */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0, 1, 0] }}
                    transition={{ delay: 8, duration: 2, repeat: Infinity }}
                    className="self-end bg-[#d9fdd3] rounded-lg rounded-tr-none px-3 py-2 text-sm shadow-sm relative z-10 mt-2"
                >
                    <div className="flex gap-1 items-center h-3 sm:h-4">
                        <span className="w-1.5 h-1.5 bg-neutral-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                        <span className="w-1.5 h-1.5 bg-neutral-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                        <span className="w-1.5 h-1.5 bg-neutral-400 rounded-full animate-bounce"></span>
                    </div>
                </motion.div>

                {/* Spacing element to ensure last message is fully visible above input */}
                <div className="h-2 shrink-0"></div>
            </div>

            {/* Message Input Bottom Bar */}
            <div className="bg-[#f0f2f5] p-2 flex gap-2 items-center shrink-0">
                <div className="bg-white flex-1 rounded-full px-3 sm:px-4 py-1.5 sm:py-2 flex items-center text-neutral-400 text-xs sm:text-sm">
                    הקלד/י הודעה...
                </div>
                <div className="w-8 h-8 sm:w-10 sm:h-10 bg-[#00a884] rounded-full flex items-center justify-center shrink-0">
                    <svg className="w-4 h-4 sm:w-5 sm:h-5 text-white mr-0.5 sm:mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                </div>
            </div>
        </div>
    );
}
