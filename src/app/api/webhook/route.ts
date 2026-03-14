import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import OpenAI from "openai";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _openai: OpenAI | null = null;
function getOpenAI() {
    if (!_openai) {
        _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return _openai;
}

function loadSystemPrompt(): string {
    const filePath = join(process.cwd(), "AGENT_PROMPT.md");
    return readFileSync(filePath, "utf-8");
}

// ---------------------------------------------------------------------------
// GET — Meta webhook verification
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
    const searchParams = req.nextUrl.searchParams;
    const mode = searchParams.get("hub.mode");
    const token = searchParams.get("hub.verify_token");
    const challenge = searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
        console.log("✅ Webhook verified");
        return new NextResponse(challenge, { status: 200 });
    }

    console.error("❌ Webhook verification failed");
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

// ---------------------------------------------------------------------------
// POST — Incoming WhatsApp message
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
    console.log("📩 Webhook POST received");

    try {
        const body = await req.json();

        // Extract message data from Meta payload
        const entry = body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const message = value?.messages?.[0];

        if (!message || message.type !== "text") {
            // Not a text message — acknowledge silently
            return NextResponse.json({ status: "ok" });
        }

        const phoneNumber: string = message.from;
        const userText: string = message.text.body;

        console.log(`📱 Message from ${phoneNumber}: ${userText}`);

        // ----- 1. Upsert conversation -----
        const { data: conversation, error: convError } = await getSupabaseAdmin()
            .from("conversations")
            .upsert({ phone_number: phoneNumber }, { onConflict: "phone_number" })
            .select("id")
            .single();

        if (convError) {
            console.error("❌ Supabase conversation upsert error:", convError);
            return NextResponse.json({ error: "DB error" }, { status: 500 });
        }
        console.log("✅ Conversation upserted:", conversation.id);

        // ----- 2. Store user message -----
        const { error: userMsgError } = await getSupabaseAdmin().from("messages").insert({
            conversation_id: conversation.id,
            role: "user",
            content: userText,
        });
        if (userMsgError) {
            console.error("❌ Supabase user message insert error:", userMsgError);
        } else {
            console.log("✅ User message stored");
        }

        // ----- 3. Load conversation history for context -----
        const { data: history, error: historyError } = await getSupabaseAdmin()
            .from("messages")
            .select("role, content")
            .eq("conversation_id", conversation.id)
            .order("created_at", { ascending: true })
            .limit(20);

        if (historyError) {
            console.error("❌ Supabase history fetch error:", historyError);
        }

        const systemPrompt = loadSystemPrompt();

        const chatMessages: OpenAI.ChatCompletionMessageParam[] = [
            { role: "system", content: systemPrompt },
            ...(history ?? []).map((m: { role: string; content: string }) => ({
                role: m.role as "user" | "assistant",
                content: m.content as string,
            })),
        ];

        // ----- 4. Call OpenAI -----
        const completion = await getOpenAI().chat.completions.create({
            model: "gpt-4",
            messages: chatMessages,
        });

        const aiReply = completion.choices[0]?.message?.content ?? "Sorry, I couldn't generate a response.";
        console.log(`🤖 AI reply: ${aiReply.substring(0, 100)}...`);

        // ----- 5. Store AI message -----
        const { error: aiMsgError } = await getSupabaseAdmin().from("messages").insert({
            conversation_id: conversation.id,
            role: "assistant",
            content: aiReply,
        });
        if (aiMsgError) {
            console.error("❌ Supabase AI message insert error:", aiMsgError);
        } else {
            console.log("✅ AI message stored");
        }

        // ----- 6. Send AI reply via WhatsApp Cloud API -----
        const waResponse = await fetch(
            `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    messaging_product: "whatsapp",
                    to: phoneNumber,
                    type: "text",
                    text: { body: aiReply },
                }),
            }
        );

        if (!waResponse.ok) {
            const errBody = await waResponse.text();
            console.error("❌ WhatsApp API error:", waResponse.status, errBody);
        } else {
            console.log("✅ WhatsApp reply sent");
        }

        return NextResponse.json({ status: "ok" });
    } catch (err) {
        console.error("❌ Webhook handler error:", err);
        return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
}
