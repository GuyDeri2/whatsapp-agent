import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { ShieldCheck, Users, LayoutDashboard, LogOut } from "lucide-react";

export default async function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const supabase = await createClient();

    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) redirect("/login");

    const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

    if (!profile || profile.role !== "admin") redirect("/");

    const { count: pendingCount } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("approval_status", "pending");

    return (
        <div className="min-h-screen bg-neutral-950 font-sans text-neutral-200" dir="rtl">
            {/* Sidebar */}
            <div className="fixed inset-y-0 right-0 w-64 bg-black border-l border-white/5 flex flex-col z-20">
                <div className="p-6 border-b border-white/5">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                            <ShieldCheck className="w-5 h-5 text-emerald-400" />
                        </div>
                        <div>
                            <div className="text-sm font-bold text-white">לוח ניהול</div>
                            <div className="text-xs text-neutral-500">Platform Admin</div>
                        </div>
                    </div>
                </div>

                <nav className="flex-1 p-4 space-y-1">
                    <Link
                        href="/admin"
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-neutral-300 hover:bg-white/5 hover:text-white transition-all"
                    >
                        <LayoutDashboard className="w-4 h-4" />
                        סקירה כללית
                    </Link>
                    <Link
                        href="/admin/approvals"
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-neutral-300 hover:bg-white/5 hover:text-white transition-all"
                    >
                        <Users className="w-4 h-4" />
                        אישורי משתמשים
                        {(pendingCount ?? 0) > 0 && (
                            <span className="mr-auto flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-orange-500 text-white text-xs font-bold">
                                {pendingCount}
                            </span>
                        )}
                    </Link>
                </nav>

                <div className="p-4 border-t border-white/5">
                    <Link
                        href="/dashboard"
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-neutral-400 hover:bg-white/5 hover:text-white transition-all w-full"
                    >
                        <LogOut className="w-4 h-4" />
                        חזרה לממשק לקוח
                    </Link>
                </div>
            </div>

            {/* Main content */}
            <div className="mr-64 min-h-screen">
                <main className="p-8">{children}</main>
            </div>
        </div>
    );
}
