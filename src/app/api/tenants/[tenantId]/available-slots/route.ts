import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

type Params = { params: Promise<{ tenantId: string }> };

// GET /api/tenants/[tenantId]/available-slots?date=YYYY-MM-DD
// Returns array of available time slots for a given date
export async function GET(req: Request, { params }: Params) {
  const { tenantId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Verify tenant ownership
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('id', tenantId)
    .eq('owner_id', user.id)
    .single();
  if (!tenant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(req.url);
  const dateStr = url.searchParams.get('date'); // YYYY-MM-DD
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return NextResponse.json({ error: 'date parameter required (YYYY-MM-DD)' }, { status: 400 });
  }

  const date = new Date(dateStr);
  const dayOfWeek = date.getDay(); // 0=Sun, 6=Sat

  // Get availability rules for this day
  const { data: rules } = await supabase
    .from('availability_rules')
    .select('start_time, end_time')
    .eq('tenant_id', tenantId)
    .eq('day_of_week', dayOfWeek);

  if (!rules || rules.length === 0) {
    return NextResponse.json({ slots: [] });
  }

  // Get meeting settings for duration
  const { data: settings } = await supabase
    .from('meeting_settings')
    .select('duration_minutes, buffer_minutes, booking_notice_hours')
    .eq('tenant_id', tenantId)
    .single();

  const durationMin = settings?.duration_minutes ?? 30;
  const bufferMin = settings?.buffer_minutes ?? 0;
  const noticeHours = settings?.booking_notice_hours ?? 2;

  // Get existing confirmed meetings for this date
  const dayStart = `${dateStr}T00:00:00.000Z`;
  const dayEnd = `${dateStr}T23:59:59.999Z`;
  const { data: existingMeetings } = await supabase
    .from('meetings')
    .select('start_time, end_time')
    .eq('tenant_id', tenantId)
    .eq('status', 'confirmed')
    .gte('start_time', dayStart)
    .lte('start_time', dayEnd);

  const now = new Date();
  const minStartTime = new Date(now.getTime() + noticeHours * 60 * 60 * 1000);

  const availableSlots: { start: string; end: string }[] = [];

  for (const rule of rules) {
    // Parse time strings (HH:MM format) as local time on the given date
    const [startH, startM] = rule.start_time.split(':').map(Number);
    const [endH, endM] = rule.end_time.split(':').map(Number);

    const windowStart = new Date(`${dateStr}T${String(startH).padStart(2,'0')}:${String(startM).padStart(2,'0')}:00`);
    const windowEnd = new Date(`${dateStr}T${String(endH).padStart(2,'0')}:${String(endM).padStart(2,'0')}:00`);

    let cursor = new Date(windowStart);

    while (cursor.getTime() + durationMin * 60_000 <= windowEnd.getTime()) {
      const slotStart = new Date(cursor);
      const slotEnd = new Date(cursor.getTime() + durationMin * 60_000);

      // Skip if before minimum notice
      if (slotStart >= minStartTime) {
        // Check for conflicts with existing meetings
        const hasConflict = (existingMeetings ?? []).some(m => {
          const mStart = new Date(m.start_time);
          const mEnd = new Date(m.end_time);
          return slotStart < mEnd && slotEnd > mStart;
        });

        if (!hasConflict) {
          availableSlots.push({
            start: slotStart.toISOString(),
            end: slotEnd.toISOString(),
          });
        }
      }

      cursor = new Date(cursor.getTime() + (durationMin + bufferMin) * 60_000);
    }
  }

  return NextResponse.json({ slots: availableSlots, date: dateStr });
}
