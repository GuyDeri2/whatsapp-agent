"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface Tenant {
  id: string;
  business_name: string;
  description: string | null;
  agent_mode: "learning" | "active";
  whatsapp_connected: boolean;
  whatsapp_phone: string | null;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/* Page component                                                      */
/* ------------------------------------------------------------------ */

export default function Dashboard() {
  const supabase = createClient();
  const router = useRouter();

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    business_name: "",
    description: "",
    products: "",
    target_customers: "",
  });
  const [creating, setCreating] = useState(false);

  const fetchTenants = useCallback(async () => {
    const res = await fetch("/api/tenants");
    const data = await res.json();
    if (data.tenants) setTenants(data.tenants);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTenants();
  }, [fetchTenants]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    const res = await fetch("/api/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData),
    });
    if (res.ok) {
      setShowForm(false);
      setFormData({
        business_name: "",
        description: "",
        products: "",
        target_customers: "",
      });
      await fetchTenants();
    }
    setCreating(false);
  };

  const modeLabels: Record<string, { label: string; emoji: string; color: string }> = {
    learning: { label: "למידה", emoji: "📚", color: "#f59e0b" },
    active: { label: "פעיל", emoji: "🤖", color: "#10b981" },
  };

  return (
    <div className="dashboard-container">
      {/* Header */}
      <header className="dashboard-header">
        <div className="header-left">
          <h1>🤖 פלטפורמת סוכן ווטסאפ</h1>
          <span className="header-subtitle">נהל את סוכני ה-AI שלך</span>
        </div>
        <button className="btn btn-ghost" onClick={handleLogout}>
          התנתק
        </button>
      </header>

      {/* Stats Bar */}
      <div className="stats-bar">
        <div className="stat-card">
          <span className="stat-number">{tenants.length}</span>
          <span className="stat-label">עסקים</span>
        </div>
        <div className="stat-card">
          <span className="stat-number">
            {tenants.filter((t) => t.whatsapp_connected).length}
          </span>
          <span className="stat-label">מחוברים</span>
        </div>
        <div className="stat-card">
          <span className="stat-number">
            {tenants.filter((t) => t.agent_mode === "active").length}
          </span>
          <span className="stat-label">סוכנים פעילים</span>
        </div>
      </div>

      {/* Tenant List */}
      <div className="tenants-section">
        <div className="section-header">
          <h2>העסקים שלך</h2>
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>
            + הוסף עסק
          </button>
        </div>

        {loading && (
          <div className="loading-state">
            <div className="spinner" />
            <p>טוען עסקים...</p>
          </div>
        )}

        {!loading && tenants.length === 0 && !showForm && (
          <div className="empty-state-card">
            <div className="empty-icon">🏢</div>
            <h3>אין עסקים עדיין</h3>
            <p>הוסף את העסק הראשון שלך כדי להתחיל עם סוכני AI לווטסאפ.</p>
            <button className="btn btn-primary" onClick={() => setShowForm(true)}>
              הוסף את העסק הראשון שלך
            </button>
          </div>
        )}

        {/* New Business Form */}
        {showForm && (
          <div className="form-card">
            <h3>הוסף עסק חדש</h3>
            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label>שם העסק *</label>
                <input
                  type="text"
                  placeholder="לדוגמה: חנות אלקטרוניקה"
                  value={formData.business_name}
                  onChange={(e) =>
                    setFormData({ ...formData, business_name: e.target.value })
                  }
                  required
                />
              </div>

              <div className="form-group">
                <label>תיאור</label>
                <textarea
                  placeholder="מה העסק שלך עושה? למשל: אנחנו מוכרים מוצרי אלקטרוניקה..."
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  rows={3}
                />
              </div>

              <div className="form-group">
                <label>מוצרים / שירותים</label>
                <textarea
                  placeholder="מה אתם מוכרים? למשל: סמארטפונים, מחשבים ניידים, אביזרים..."
                  value={formData.products}
                  onChange={(e) =>
                    setFormData({ ...formData, products: e.target.value })
                  }
                  rows={3}
                />
              </div>

              <div className="form-group">
                <label>לקוחות יעד</label>
                <textarea
                  placeholder="מי הלקוחות שלך? למשל: חובבי טכנולוגיה, עסקים קטנים..."
                  value={formData.target_customers}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      target_customers: e.target.value,
                    })
                  }
                  rows={2}
                />
              </div>

              <div className="form-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setShowForm(false)}
                >
                  ביטול
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={creating}
                >
                  {creating ? "יוצר..." : "צור עסק"}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Tenant Cards */}
        <div className="tenant-grid">
          {tenants.map((tenant) => {
            const mode = modeLabels[tenant.agent_mode];
            return (
              <div
                key={tenant.id}
                className="tenant-card"
                onClick={() => router.push(`/tenant/${tenant.id}`)}
              >
                <div className="tenant-card-header">
                  <h3>{tenant.business_name}</h3>
                  <span
                    className="mode-badge"
                    style={{ backgroundColor: mode.color }}
                  >
                    {mode.emoji} {mode.label}
                  </span>
                </div>

                {tenant.description && (
                  <p className="tenant-description">{tenant.description}</p>
                )}

                <div className="tenant-card-footer">
                  <div className="connection-status">
                    <span
                      className={`status-dot ${tenant.whatsapp_connected ? "connected" : "disconnected"
                        }`}
                    />
                    <span>
                      {tenant.whatsapp_connected
                        ? `מחובר (${tenant.whatsapp_phone || "..."})`
                        : "לא מחובר"}
                    </span>
                  </div>
                  <span className="card-arrow">←</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
