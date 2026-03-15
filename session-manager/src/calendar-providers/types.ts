/**
 * calendar-providers/types.ts
 * Shared interface that every calendar provider (Google, Outlook, Calendly) must implement.
 * scheduling.ts calls these methods without knowing which provider is active.
 */

export interface BusyBlock {
    start: Date;
    end: Date;
}

export interface CreatedEvent {
    eventId: string;
    htmlLink?: string;
}

export interface CreateEventParams {
    title: string;
    start: Date;
    end: Date;
    customerName: string;
    customerPhone: string;
    description?: string;
}

export interface CalendarProvider {
    /**
     * Return all busy time blocks for the given tenant on the given date range.
     * Used by scheduling.ts Layer 2 check to filter out already-occupied slots.
     */
    getFreeBusy(
        tenantId: string,
        rangeStart: Date,
        rangeEnd: Date
    ): Promise<BusyBlock[]>;

    /**
     * Create a calendar event when a meeting is booked via WhatsApp.
     * Returns the external event ID (stored in meetings.calendar_event_id).
     */
    createEvent(
        tenantId: string,
        params: {
            title: string;
            start: Date;
            end: Date;
            customerName: string;
            customerPhone: string;
            description?: string;
        }
    ): Promise<CreatedEvent>;

    /**
     * Delete a calendar event when a meeting is cancelled.
     * Should not throw if the event no longer exists (idempotent).
     */
    deleteEvent(tenantId: string, eventId: string): Promise<void>;

    /**
     * Refresh the OAuth access token for this tenant.
     * Should update the token in the database.
     * Called proactively by a cron and reactively on 401 responses.
     */
    refreshTokenIfNeeded(tenantId: string): Promise<string>; // returns current access_token
}

export type ProviderName = "google" | "outlook" | "calendly";
