import type { FeedbackPeriod } from '$lib/auth/auth';

/**
 * Whether a period's date window is open for submissions right now:
 * start_date <= now <= end_date (inclusive, matching the server).
 */
export function isPeriodActive(p: FeedbackPeriod, now: number = Date.now()): boolean {
	const start = new Date(p.start_date).getTime();
	const end = new Date(p.end_date).getTime();
	return start <= now && now <= end;
}

/** The period whose window contains now, or null when none is open. */
export function findActivePeriod(
	periods: FeedbackPeriod[],
	now: number = Date.now()
): FeedbackPeriod | null {
	return periods.find((p) => isPeriodActive(p, now)) ?? null;
}

/** Coarse status label for badges: upcoming, active, or closed. */
export function periodStatus(
	p: FeedbackPeriod,
	now: number = Date.now()
): { label: string; cls: string } {
	const start = new Date(p.start_date).getTime();
	const end = new Date(p.end_date).getTime();
	if (now < start) return { label: 'Upcoming', cls: 'badge-warning' };
	if (now > end) return { label: 'Closed', cls: 'badge-muted' };
	return { label: 'Active', cls: 'badge-success' };
}