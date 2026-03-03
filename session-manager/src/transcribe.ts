import fs from "fs";
import { promisify } from "util";
import path from "path";
import os from "os";
import OpenAI, { toFile } from "openai";

const writeFileAsync = promisify(fs.writeFile);
const unlinkAsync = promisify(fs.unlink);

let _groq: OpenAI | null = null;
function getGroq(): OpenAI {
    if (!_groq) {
        _groq = new OpenAI({
            apiKey: process.env.GROQ_API_KEY,
            baseURL: "https://api.groq.com/openai/v1",
        });
    }
    return _groq;
}

/**
 * Transcribes an audio buffer using Groq's fast Whisper API.
 * Converts the Buffer to a temporary file because OpenAI/Groq SDK
 * requires a File-like object for audio transcriptions.
 */
export async function transcribeAudioBuffer(buffer: Buffer, mimetype?: string): Promise<string | null> {
    if (!process.env.GROQ_API_KEY) {
        console.warn("⚠️ GROQ_API_KEY is not set. Audio transcription skipped.");
        return null;
    }

    // Determine extension from mimetype or default to ogg
    let ext = ".ogg";
    if (mimetype) {
        if (mimetype.includes("mp4")) ext = ".mp4";
        else if (mimetype.includes("mpeg")) ext = ".mp3";
        else if (mimetype.includes("wav")) ext = ".wav";
        else if (mimetype.includes("webm")) ext = ".webm";
    }

    const tempFilePath = path.join(os.tmpdir(), `wa-audio-${Date.now()}-${Math.random().toString(36).substring(7)}${ext}`);

    try {
        // 1. Write buffer to temp file
        await writeFileAsync(tempFilePath, buffer);

        // 2. Send to Groq Whisper API
        const translation = await getGroq().audio.transcriptions.create({
            file: fs.createReadStream(tempFilePath),
            model: "whisper-large-v3", // Groq's high-speed Whisper model
            prompt: "Transcribe the audio accurately. The language may be Hebrew or English. If Hebrew, ensure proper formatting and direction.",
            response_format: "json",
            temperature: 0.0,
        });

        return translation.text?.trim() || null;
    } catch (error: any) {
        console.error("❌ Groq transcription failed:", error?.message || error);
        return null;
    } finally {
        // 3. Clean up temp file
        try {
            if (fs.existsSync(tempFilePath)) {
                await unlinkAsync(tempFilePath);
            }
        } catch (cleanupErr) {
            console.error("Failed to delete temp audio file:", cleanupErr);
        }
    }
}
