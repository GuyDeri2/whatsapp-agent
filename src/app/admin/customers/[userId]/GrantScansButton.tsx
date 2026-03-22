"use client";

import { useState } from "react";
import { Plus, Loader2 } from "lucide-react";

interface GrantScansButtonProps {
    tenantId: string;
    scansUsed: number;
    scansLimit: number;
    scansMonth: string;
}

export function GrantScansButton({ tenantId, scansUsed, scansLimit, scansMonth }: GrantScansButtonProps) {
    const [granting, setGranting] = useState(false);
    const [currentLimit, setCurrentLimit] = useState(scansLimit);
    const [granted, setGranted] = useState(false);

    const currentMonth = new Date().toISOString().substring(0, 7);
    const displayUsed = scansMonth === currentMonth ? scansUsed : 0;
    const isAtLimit = displayUsed >= currentLimit;

    const handleGrant = async () => {
        setGranting(true);
        try {
            const res = await fetch("/api/admin/tenant-scans", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tenant_id: tenantId }),
            });
            if (res.ok) {
                const data = await res.json();
                setCurrentLimit(data.total_limit);
                setGranted(true);
                setTimeout(() => setGranted(false), 2000);
            }
        } catch {
            // ignore
        } finally {
            setGranting(false);
        }
    };

    return (
        <div className="flex items-center gap-2">
            <span className={`text-xs font-medium ${isAtLimit ? "text-red-400" : "text-neutral-400"}`}>
                {displayUsed}/{currentLimit}
            </span>
            {isAtLimit && (
                <button
                    onClick={handleGrant}
                    disabled={granting || granted}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-400 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
                >
                    {granting ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                    ) : granted ? (
                        "✓"
                    ) : (
                        <><Plus className="w-3 h-3" /> +10</>
                    )}
                </button>
            )}
        </div>
    );
}
