import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const supabase = await createClient();

    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        redirect("/login");
    }

    const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

    if (!profile || profile.role !== "admin") {
        redirect("/"); // Redirect back to client dashboard
    }

    return (
        <div className="admin-layout">
            <header className="admin-header">
                <div className="admin-header-logo">🛡️ לוח ניהול למנהלי הפלטפורמה</div>
                <nav>
                    <a href="/">חזרה לממשק לקוח</a>
                </nav>
            </header>
            <main className="admin-main">{children}</main>
        </div>
    );
}
