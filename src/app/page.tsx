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
  agent_mode: "learning" | "active" | "paused";
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
    learning: { label: "Learning", emoji: "📚", color: "#f59e0b" },
    active: { label: "Active", emoji: "🤖", color: "#10b981" },
    paused: { label: "Paused", emoji: "⏸️", color: "#6b7280" },
  };

  return (
    <div className="dashboard-container">
      {/* Header */}
      <header className="dashboard-header">
        <div className="header-left">
          <h1>🤖 WhatsApp Agent Platform</h1>
          <span className="header-subtitle">Manage your AI agents</span>
        </div>
        <button className="btn btn-ghost" onClick={handleLogout}>
          Sign Out
        </button>
      </header>

      {/* Stats Bar */}
      <div className="stats-bar">
        <div className="stat-card">
          <span className="stat-number">{tenants.length}</span>
          <span className="stat-label">Businesses</span>
        </div>
        <div className="stat-card">
          <span className="stat-number">
            {tenants.filter((t) => t.whatsapp_connected).length}
          </span>
          <span className="stat-label">Connected</span>
        </div>
        <div className="stat-card">
          <span className="stat-number">
            {tenants.filter((t) => t.agent_mode === "active").length}
          </span>
          <span className="stat-label">Active Agents</span>
        </div>
      </div>

      {/* Tenant List */}
      <div className="tenants-section">
        <div className="section-header">
          <h2>Your Businesses</h2>
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>
            + Add Business
          </button>
        </div>

        {loading && (
          <div className="loading-state">
            <div className="spinner" />
            <p>Loading businesses...</p>
          </div>
        )}

        {!loading && tenants.length === 0 && !showForm && (
          <div className="empty-state-card">
            <div className="empty-icon">🏢</div>
            <h3>No businesses yet</h3>
            <p>Add your first business to get started with WhatsApp AI agents.</p>
            <button className="btn btn-primary" onClick={() => setShowForm(true)}>
              Add Your First Business
            </button>
          </div>
        )}

        {/* New Business Form */}
        {showForm && (
          <div className="form-card">
            <h3>Add New Business</h3>
            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label>Business Name *</label>
                <input
                  type="text"
                  placeholder="e.g., QuickShip Electronics"
                  value={formData.business_name}
                  onChange={(e) =>
                    setFormData({ ...formData, business_name: e.target.value })
                  }
                  required
                />
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea
                  placeholder="What does your business do? e.g., We sell electronics and gadgets online..."
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  rows={3}
                />
              </div>

              <div className="form-group">
                <label>Products / Services</label>
                <textarea
                  placeholder="What do you sell? e.g., Smartphones, laptops, accessories, headphones..."
                  value={formData.products}
                  onChange={(e) =>
                    setFormData({ ...formData, products: e.target.value })
                  }
                  rows={3}
                />
              </div>

              <div className="form-group">
                <label>Target Customers</label>
                <textarea
                  placeholder="Who are your customers? e.g., Tech enthusiasts, small businesses..."
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
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={creating}
                >
                  {creating ? "Creating..." : "Create Business"}
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
                        ? `Connected (${tenant.whatsapp_phone || "..."})`
                        : "Not connected"}
                    </span>
                  </div>
                  <span className="card-arrow">→</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
