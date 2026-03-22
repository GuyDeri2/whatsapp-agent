"use client";

import { useState, useEffect } from "react";
import { ToggleRight, ToggleLeft, Loader2 } from "lucide-react";

interface FeatureFlag {
    key: string;
    enabled: boolean;
    label: string;
    updated_at: string;
}

export default function FeaturesPage() {
    const [flags, setFlags] = useState<FeatureFlag[]>([]);
    const [loading, setLoading] = useState(true);
    const [toggling, setToggling] = useState<string | null>(null);

    useEffect(() => {
        fetch("/api/admin/feature-flags")
            .then((r) => r.json())
            .then((d) => { setFlags(d.flags || []); setLoading(false); })
            .catch(() => setLoading(false));
    }, []);

    const toggle = async (key: string, currentEnabled: boolean) => {
        setToggling(key);
        const res = await fetch("/api/admin/feature-flags", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key, enabled: !currentEnabled }),
        });
        if (res.ok) {
            setFlags((prev) =>
                prev.map((f) => f.key === key ? { ...f, enabled: !currentEnabled, updated_at: new Date().toISOString() } : f)
            );
        }
        setToggling(null);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-6 h-6 animate-spin text-neutral-500" />
            </div>
        );
    }

    return (
        <div>
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-white">ניהול קומפוננטות</h1>
                <p className="text-sm text-neutral-500 mt-1">
                    הפעל או כבה טאבים בדשבורד של כל הלקוחות
                </p>
            </div>

            <div className="bg-white/[0.03] border border-white/10 rounded-2xl overflow-hidden">
                {flags.map((flag, i) => (
                    <div
                        key={flag.key}
                        className={`flex items-center justify-between px-6 py-4 ${
                            i !== flags.length - 1 ? "border-b border-white/5" : ""
                        }`}
                    >
                        <div className="flex items-center gap-4">
                            <div className={`w-2 h-2 rounded-full ${flag.enabled ? "bg-emerald-400" : "bg-neutral-600"}`} />
                            <div>
                                <div className="text-sm font-medium text-white">{flag.label}</div>
                                <div className="text-xs text-neutral-500 font-mono">{flag.key}</div>
                            </div>
                        </div>

                        <button
                            onClick={() => toggle(flag.key, flag.enabled)}
                            disabled={toggling === flag.key}
                            className="flex items-center gap-2 transition-all"
                        >
                            {toggling === flag.key ? (
                                <Loader2 className="w-5 h-5 animate-spin text-neutral-500" />
                            ) : flag.enabled ? (
                                <ToggleRight className="w-8 h-8 text-emerald-400 hover:text-emerald-300 transition-colors" />
                            ) : (
                                <ToggleLeft className="w-8 h-8 text-neutral-600 hover:text-neutral-400 transition-colors" />
                            )}
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}
