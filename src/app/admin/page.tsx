import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
    const supabase = await createClient();

    // 1. Fetch all profiles
    const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });

    // 2. Fetch all tenants
    const { data: tenants, error: tenantsError } = await supabase
        .from("tenants")
        .select("id, owner_id, business_name, agent_mode, whatsapp_connected");

    if (profilesError) {
        return (
            <div className="empty-state-card" style={{ maxWidth: 600, margin: "auto" }}>
                <div className="empty-icon">⚠️</div>
                <h3>שגיאה בטעינת נתונים</h3>
                <p>{profilesError.message}</p>
            </div>
        );
    }

    // Process data
    const clients = profiles?.map((profile) => {
        const clientTenants = tenants?.filter((t) => t.owner_id === profile.id) || [];
        return {
            ...profile,
            businessCount: clientTenants.length,
            businesses: clientTenants,
        };
    });

    const totalClients = clients?.filter(c => c.role === 'client').length || 0;
    const activeSubscriptions = clients?.filter(c => c.subscription_status === 'active').length || 0;
    const totalBusinesses = tenants?.length || 0;

    return (
        <div>
            <div className="section-header">
                <h2>סקירה כללית</h2>
            </div>

            <div className="stats-bar">
                <div className="stat-card">
                    <span className="stat-number">{totalClients}</span>
                    <span className="stat-label">לקוחות רשומים</span>
                </div>
                <div className="stat-card">
                    <span className="stat-number">{activeSubscriptions}</span>
                    <span className="stat-label">מנויים פעילים</span>
                </div>
                <div className="stat-card">
                    <span className="stat-number">{totalBusinesses}</span>
                    <span className="stat-label">עסקים במערכת</span>
                </div>
            </div>

            <div className="section-header" style={{ marginTop: "40px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2>ניהול לקוחות</h2>
                <Link 
                    href="/admin/approvals" 
                    style={{ padding: "0.5rem 1rem", backgroundColor: "#2563eb", color: "white", textDecoration: "none", borderRadius: "6px", fontSize: "0.9rem", fontWeight: "500" }}
                >
                    אישור משתמשים חדשים &rarr;
                </Link>
            </div>

            <div className="admin-table-container">
                <table className="admin-table">
                    <thead>
                        <tr>
                            <th>לקוח (אימייל)</th>
                            <th>תפקיד</th>
                            <th>סטטוס מנוי (Hyp)</th>
                            <th>כמות עסקים</th>
                            <th>תאריך הצטרפות</th>
                        </tr>
                    </thead>
                    <tbody>
                        {clients?.map((client) => {
                            const date = new Date(client.created_at).toLocaleDateString("he-IL");
                            return (
                                <tr key={client.id}>
                                    <td>
                                        <strong>{client.email}</strong>
                                        {client.businesses.length > 0 && (
                                            <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>
                                                עסקים: {client.businesses.map((b: any) => b.business_name).join(", ")}
                                            </div>
                                        )}
                                    </td>
                                    <td>
                                        {client.role === "admin" ? (
                                            <span className="status-badge admin-role-badge">אדמין</span>
                                        ) : (
                                            <span className="status-badge" style={{ background: "rgba(255,255,255,0.05)" }}>לקוח</span>
                                        )}
                                    </td>
                                    <td>
                                        <span className={`status-badge ${client.subscription_status}`}>
                                            {client.subscription_status === "trial" && "תקופת ניסיון"}
                                            {client.subscription_status === "active" && "פעיל"}
                                            {client.subscription_status === "past_due" && "בפיגור"}
                                            {client.subscription_status === "canceled" && "בוטל"}
                                        </span>
                                    </td>
                                    <td>{client.businessCount}</td>
                                    <td>{date}</td>
                                </tr>
                            );
                        })}
                        {clients?.length === 0 && (
                            <tr>
                                <td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)", padding: "40px" }}>
                                    אין משתמשים במערכת עדיין.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
