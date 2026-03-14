"use client";

import { useRouter } from "next/navigation";
import { Trash2, PauseCircle, Eye } from "lucide-react";

interface Business {
    id: string;
    business_name: string;
    agent_mode: string;
    whatsapp_connected: boolean;
}

interface Client {
    id: string;
    email: string;
    role: string;
    subscription_status: string;
    approval_status: string;
    created_at: string;
    businessCount: number;
    businesses: Business[];
}

interface Props {
    clients: Client[];
}

export default function AdminClientTable({ clients }: Props) {
    const router = useRouter();

    const handleSuspend = async (client: Client) => {
        try {
            const res = await fetch("/api/admin/profiles", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ profileId: client.id, approval_status: "pending" }),
            });
            if (!res.ok) throw new Error("Failed to suspend user");
            router.refresh();
        } catch (err: any) {
            alert("שגיאה בהשהיית המשתמש: " + err.message);
        }
    };

    const handleDelete = async (client: Client) => {
        const confirmed = window.confirm(
            `האם למחוק את המשתמש ${client.email} לצמיתות? פעולה זו תמחק את כל העסקים וההיסטוריה שלו.`
        );
        if (!confirmed) return;

        try {
            const res = await fetch("/api/admin/profiles", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ profileId: client.id }),
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Failed to delete user");
            }
            router.refresh();
        } catch (err: any) {
            alert("שגיאה במחיקת המשתמש: " + err.message);
        }
    };

    return (
        <div className="bg-neutral-900 border border-white/5 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full text-right text-sm">
                    <thead className="bg-neutral-950 border-b border-white/5 text-neutral-400 font-medium">
                        <tr>
                            <th className="px-6 py-4 whitespace-nowrap">לקוח</th>
                            <th className="px-6 py-4 whitespace-nowrap">תפקיד</th>
                            <th className="px-6 py-4 whitespace-nowrap">סטטוס</th>
                            <th className="px-6 py-4 whitespace-nowrap">אישור</th>
                            <th className="px-6 py-4 whitespace-nowrap">עסקים</th>
                            <th className="px-6 py-4 whitespace-nowrap">הצטרף</th>
                            <th className="px-6 py-4 whitespace-nowrap">פעולות</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {clients.map((client) => (
                            <tr
                                key={client.id}
                                className="hover:bg-white/[0.02] transition-colors"
                            >
                                <td className="px-6 py-4">
                                    <div className="font-medium text-white">{client.email}</div>
                                    {client.businesses.length > 0 && (
                                        <div className="text-xs text-neutral-500 mt-0.5">
                                            {client.businesses.map((b) => b.business_name).join(", ")}
                                        </div>
                                    )}
                                </td>
                                <td className="px-6 py-4">
                                    <span className={`inline-flex px-2 py-1 rounded-md text-xs font-medium border ${
                                        client.role === "admin"
                                            ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                                            : "bg-white/5 text-neutral-400 border-white/10"
                                    }`}>
                                        {client.role === "admin" ? "מנהל" : "לקוח"}
                                    </span>
                                </td>
                                <td className="px-6 py-4">
                                    <span className={`inline-flex px-2 py-1 rounded-md text-xs font-medium border ${
                                        client.subscription_status === "active"
                                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                            : "bg-white/5 text-neutral-400 border-white/10"
                                    }`}>
                                        {client.subscription_status === "trial" && "ניסיון"}
                                        {client.subscription_status === "active" && "פעיל"}
                                        {client.subscription_status === "past_due" && "בפיגור"}
                                        {client.subscription_status === "canceled" && "בוטל"}
                                    </span>
                                </td>
                                <td className="px-6 py-4">
                                    <span className={`inline-flex px-2 py-1 rounded-md text-xs font-medium border ${
                                        client.approval_status === "approved"
                                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                            : client.approval_status === "pending"
                                            ? "bg-orange-500/10 text-orange-400 border-orange-500/20"
                                            : "bg-red-500/10 text-red-400 border-red-500/20"
                                    }`}>
                                        {client.approval_status === "approved" && "מאושר"}
                                        {client.approval_status === "pending" && "ממתין"}
                                        {client.approval_status === "rejected" && "נדחה"}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-neutral-400">{client.businessCount}</td>
                                <td className="px-6 py-4 text-neutral-400 whitespace-nowrap">
                                    {new Date(client.created_at).toLocaleDateString("he-IL")}
                                </td>
                                <td className="px-6 py-4">
                                    <div className="flex items-center gap-2 justify-end">
                                        <button
                                            onClick={() => router.push(`/admin/customers/${client.id}`)}
                                            title="פרטים"
                                            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-400 hover:text-white rounded-lg text-xs font-medium transition-all"
                                        >
                                            <Eye className="w-3.5 h-3.5" />
                                            פרטים
                                        </button>
                                        {client.approval_status === "approved" && (
                                            <button
                                                onClick={() => handleSuspend(client)}
                                                title="השהה"
                                                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-400 rounded-lg text-xs font-medium transition-all"
                                            >
                                                <PauseCircle className="w-3.5 h-3.5" />
                                                השהה
                                            </button>
                                        )}
                                        <button
                                            onClick={() => handleDelete(client)}
                                            title="מחק"
                                            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 rounded-lg text-xs font-medium transition-all"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                            מחק
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {clients.length === 0 && (
                            <tr>
                                <td colSpan={7} className="px-6 py-12 text-center text-neutral-500">
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
