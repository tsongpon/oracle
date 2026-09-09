<script lang="ts">
	import { auth } from '$lib/auth.svelte';
	import {
		ApiClientError,
		listEmployees,
		listFeedbackPeriods,
		listMyFeedbackDrafts,
		listMyFeedbacks,
		listMyGivenFeedbacks,
		type Employee,
		type FeedbackPeriod,
		type FeedbackResponse
	} from '$lib/auth/auth';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	const user = $derived(auth.user!);

	let loading = $state(true);
	let loadError = $state<string | null>(null);

	let periods = $state<FeedbackPeriod[]>([]);
	let drafts = $state<FeedbackResponse[]>([]);
	let received = $state<FeedbackResponse[]>([]);
	let given = $state<FeedbackResponse[]>([]);
	let teammates = $state<Employee[]>([]);

	// The active period: the one whose window contains now. Falls back to the
	// newest period (list is already start_date desc) so the dashboard always
	// has a cycle to show.
	const activePeriod = $derived.by(() => {
		const now = Date.now();
		return (
			periods.find(
				(p) =>
					new Date(p.start_date).getTime() <= now && now <= new Date(p.end_date).getTime()
			) ?? periods[0]
		);
	});

	const activePeriodId = $derived(activePeriod?.id ?? '');

	// Reviewees already covered this active period (drafted or submitted).
	const coveredReviewees = $derived.by(() => {
		const ids = new Set<string>();
		for (const d of drafts) {
			if (d.period_id === activePeriodId) ids.add(d.reviewee_id);
		}
		for (const g of given) {
			if (g.period_id === activePeriodId) ids.add(g.reviewee_id);
		}
		return ids;
	});

	// Suggestion-based pending: teammates I haven't written feedback for in
	// the active period (as a draft or a submission).
	const pendingCount = $derived(
		teammates.filter((t) => !coveredReviewees.has(t.id)).length
	);

	// Newest first for the activity feed.
	const recentGiven = $derived(given.slice(0, 5));

	const draftsCount = $derived(drafts.length);
	const submittedThisCycle = $derived(
		given.filter((f) => f.period_id === activePeriodId).length
	);
	const receivedCount = $derived(received.length);

	const stats = $derived([
		{
			label: 'Pending to write',
			value: pendingCount,
			tone: 'warning' as const,
			hint: activePeriod ? `Due ${formatDate(activePeriod.end_date)}` : 'No open period'
		},
		{
			label: 'Drafts in progress',
			value: draftsCount,
			tone: 'muted' as const,
			hint: 'Pick up where you left off'
		},
		{
			label: 'Submitted this cycle',
			value: submittedThisCycle,
			tone: 'success' as const,
			hint: activePeriod?.name ?? 'Current cycle'
		},
		{
			label: 'Feedback received',
			value: receivedCount,
			tone: 'muted' as const,
			hint: `${teammates.length} teammates`
		}
	]);

	// Cycle completion for the progress bar: how many of my teammates I've
	// covered vs. the whole team (suggestion-based, same as pendingCount).
	const cycleProgressPct = $derived.by(() => {
		const total = teammates.length;
		if (total === 0) return 0;
		return Math.round(((total - pendingCount) / total) * 100);
	});

	// Top pending teammates for quick actions (max 4).
	const pendingTeammates = $derived(
		teammates.filter((t) => !coveredReviewees.has(t.id)).slice(0, 4)
	);

	function periodLabel(id: string): string {
		return periods.find((p) => p.id === id)?.name ?? '';
	}

	function revieweeName(f: FeedbackResponse): string {
		return teammates.find((t) => t.id === f.reviewee_id)?.name ?? 'A teammate';
	}

	function excerptOf(f: FeedbackResponse): string {
		return (f.strengths_comment || f.weaknesses_comment || '').slice(0, 140);
	}

	function formatDate(iso: string): string {
		try {
			return new Date(iso).toLocaleDateString(undefined, {
				year: 'numeric',
				month: 'short',
				day: 'numeric'
			});
		} catch {
			return iso;
		}
	}

	function initials(name: string) {
		return name
			.split(' ')
			.map((p) => p[0])
			.slice(0, 2)
			.join('')
			.toUpperCase();
	}

	const AVATAR_COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];
	function colorFor(id: string) {
		let hash = 0;
		for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
		return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
	}

	let firstName = $derived(user.name.split(' ')[0]);

	onMount(() => {
		if (!auth.isAuthenticated) {
			goto('/login', { replaceState: true });
			return;
		}
		loadDashboard();
	});

	async function loadDashboard() {
		loading = true;
		loadError = null;
		try {
			const token = auth.token;
			if (!token) {
				goto('/login', { replaceState: true });
				return;
			}
			const [allEmployees, periodsRes, draftsRes, givenRes, receivedRes] = await Promise.all([
				fetchAllEmployees(token),
				listFeedbackPeriods(token),
				fetchAllDrafts(token),
				fetchAllGiven(token),
				fetchAllReceived(token)
			]);
			teammates = allEmployees.filter((e) => e.id !== user.id);
			periods = periodsRes.periods;
			drafts = draftsRes;
			given = givenRes;
			received = receivedRes;
		} catch (err) {
			if (err instanceof ApiClientError) {
				if (err.code === 'unauthorized') {
					await auth.logout();
					goto('/login', { replaceState: true });
					return;
				}
				loadError = err.message || 'Could not load your dashboard.';
			} else {
				loadError = 'Could not load your dashboard.';
			}
		} finally {
			loading = false;
		}
	}

	async function fetchAllEmployees(token: string): Promise<Employee[]> {
		const out: Employee[] = [];
		let cursor: string | null = null;
		for (let i = 0; i < 50; i++) {
			const page = await listEmployees(token, { limit: 100, cursor: cursor ?? undefined });
			out.push(...page.employees);
			cursor = page.next_cursor;
			if (!cursor) break;
		}
		return out;
	}

	async function fetchAllDrafts(token: string): Promise<FeedbackResponse[]> {
		const out: FeedbackResponse[] = [];
		let cursor: string | null = null;
		for (let i = 0; i < 50; i++) {
			const page = await listMyFeedbackDrafts(token, { limit: 100, cursor: cursor ?? undefined });
			out.push(...page.drafts);
			cursor = page.next_cursor;
			if (!cursor) break;
		}
		return out;
	}

	async function fetchAllGiven(token: string): Promise<FeedbackResponse[]> {
		const out: FeedbackResponse[] = [];
		let cursor: string | null = null;
		for (let i = 0; i < 50; i++) {
			const page = await listMyGivenFeedbacks(token, { limit: 100, cursor: cursor ?? undefined });
			out.push(...page.feedbacks);
			cursor = page.next_cursor;
			if (!cursor) break;
		}
		return out;
	}

	async function fetchAllReceived(token: string): Promise<FeedbackResponse[]> {
		const out: FeedbackResponse[] = [];
		let cursor: string | null = null;
		for (let i = 0; i < 50; i++) {
			const page = await listMyFeedbacks(token, { limit: 100, cursor: cursor ?? undefined });
			out.push(...page.feedbacks);
			cursor = page.next_cursor;
			if (!cursor) break;
		}
		return out;
	}
</script>

<svelte:head>
	<title>Dashboard · 360 Feedback</title>
</svelte:head>

{#if loading}
	<div class="card state-card">
		<div class="spinner-lg" aria-label="Loading"></div>
		<p class="state-text">Loading your dashboard…</p>
	</div>
{:else if loadError}
	<div class="card state-card">
		<div class="alert" role="alert">
			<svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
				<path d="M10 1.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17zM10 6v5M10 14.5v.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
			</svg>
			<span>{loadError}</span>
		</div>
		<button type="button" class="btn btn-secondary" onclick={loadDashboard}>Try again</button>
	</div>
{:else}
	<section class="hero">
		<div class="hero-text">
			<h1>Hi {firstName}, welcome back 👋</h1>
			<p>
				You have <strong>{draftsCount}</strong> feedback drafts to finish and
				<strong>{submittedThisCycle}</strong> already submitted in the
				{activePeriod?.name ?? 'current'} cycle.
			</p>
			{#if draftsCount > 0}
				<a href="/app/feedback/new" class="hero-cta">Pick up your drafts →</a>
			{/if}
		</div>
		<div class="hero-cycle">
			<div class="cycle-row">
				<span class="cycle-label">Active cycle</span>
				<span class="badge badge-{activePeriod ? (Date.now() > new Date(activePeriod.end_date).getTime() ? 'muted' : 'success') : 'muted'}">
					{activePeriod ? (Date.now() > new Date(activePeriod.end_date).getTime() ? 'Closed' : 'Active') : 'None'}
				</span>
			</div>
			<div class="cycle-name">{activePeriod?.name ?? 'No feedback period'}</div>
			<div class="cycle-progress">
				<div class="cycle-bar">
					<div class="cycle-bar-fill" style="width:{cycleProgressPct}%"></div>
				</div>
				<div class="cycle-meta">
					<span>{submittedThisCycle + draftsCount} of {teammates.length} started</span>
					<span>{activePeriod ? `Ends ${formatDate(activePeriod.end_date)}` : ''}</span>
				</div>
			</div>
		</div>
	</section>

	<section class="stats-grid">
		{#each stats as stat}
			<div class="stat-card card">
				<div class="stat-top">
					<span class="stat-label">{stat.label}</span>
					<span class="stat-dot tone-{stat.tone}" aria-hidden="true"></span>
				</div>
				<div class="stat-value">{stat.value}</div>
				<div class="stat-hint">{stat.hint}</div>
			</div>
		{/each}
	</section>

	<section class="grid-2">
		<div class="panel card">
			<div class="panel-head">
				<div>
					<h2 class="panel-title">Recent feedback</h2>
					<p class="panel-sub">What you've shared with teammates</p>
				</div>
				<a href="/app/feedback/new" class="panel-link">Write feedback →</a>
			</div>
			{#if recentGiven.length === 0}
				<p class="empty-text">You haven't submitted any feedback yet.</p>
			{:else}
				<ul class="feed-list">
					{#each recentGiven as item (item.id)}
						<li class="feed-item">
							<div class="feed-avatar" style="background:{colorFor(item.reviewee_id)}">
								{initials(revieweeName(item))}
							</div>
							<div class="feed-body">
								<div class="feed-row">
									<span class="feed-to">To {revieweeName(item)}</span>
									<span class="badge badge-success">Submitted</span>
								</div>
								{#if excerptOf(item)}
									<p class="feed-excerpt">“{excerptOf(item)}”</p>
								{/if}
								<div class="feed-meta">
									<span>{item.visibility === 'anonymous' ? 'Anonymous' : 'Named'}</span>
									<span class="feed-sep">·</span>
									<span>{formatDate(item.created_at)}</span>
									{#if periodLabel(item.period_id)}
										<span class="feed-sep">·</span>
										<span>{periodLabel(item.period_id)}</span>
									{/if}
								</div>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<div class="panel card">
			<div class="panel-head">
				<div>
					<h2 class="panel-title">Your teammates</h2>
					<p class="panel-sub">Quick feedback in one click</p>
				</div>
				<a href="/app/team" class="panel-link">See team →</a>
			</div>
			{#if pendingTeammates.length === 0}
				<p class="empty-text">
					{teammates.length === 0
						? 'There are no other members in your organization yet.'
						: 'You’ve covered everyone this cycle. Great work!'}
				</p>
			{:else}
				<ul class="team-list">
					{#each pendingTeammates as mate (mate.id)}
						<li class="team-item">
							<div class="team-avatar" style="background:{colorFor(mate.id)}">
								{initials(mate.name)}
							</div>
							<div class="team-meta">
								<div class="team-name">{mate.name}</div>
								<div class="team-role">{mate.title}</div>
							</div>
							<a class="btn btn-secondary team-btn" href="/app/feedback/new?reviewee={mate.id}">
								Give feedback
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</section>

	<section class="panel card">
		<div class="panel-head">
			<div>
				<h2 class="panel-title">Feedback cycles</h2>
				<p class="panel-sub">Review periods for your organization</p>
			</div>
			<a href="/app/cycles" class="panel-link">Manage →</a>
		</div>
		{#if periods.length === 0}
			<p class="empty-text">No feedback periods have been opened yet.</p>
		{:else}
			<div class="cycles-grid">
				{#each periods as period (period.id)}
					{@const isOpen =
						new Date(period.start_date).getTime() <= Date.now() &&
						Date.now() <= new Date(period.end_date).getTime()}
					{@const isUpcoming = Date.now() < new Date(period.start_date).getTime()}
					<div class="cycle-card" class:active={isOpen}>
						<div class="cycle-card-head">
							<div class="cycle-card-name">{period.name}</div>
							<span class="badge badge-{isOpen ? 'success' : isUpcoming ? 'warning' : 'muted'}">
								{isOpen ? 'active' : isUpcoming ? 'upcoming' : 'closed'}
							</span>
						</div>
						<div class="cycle-card-bar">
							<div class="cycle-bar">
								<div
									class="cycle-bar-fill"
									style="width:{period.id === activePeriodId ? cycleProgressPct : 0}%"
								></div>
							</div>
						</div>
						<div class="cycle-card-meta">
							<span>{given.filter((f) => f.period_id === period.id).length} submitted</span>
							<span>
								{formatDate(period.start_date)} – {formatDate(period.end_date)}
							</span>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>
{/if}

<style>
	.hero {
		display: grid;
		grid-template-columns: 1.4fr 1fr;
		gap: var(--space-6);
		margin-bottom: var(--space-8);
		background: linear-gradient(135deg, #ffffff 0%, #f4f5ff 100%);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-8);
		box-shadow: var(--shadow-sm);
	}

	.hero-text h1 {
		font-size: 24px;
		line-height: 1.25;
	}

	.hero-text p {
		margin-top: var(--space-3);
		color: var(--color-text-muted);
		font-size: 14px;
		max-width: 48ch;
	}

	.hero-text strong {
		color: var(--color-text);
		font-weight: 600;
	}

	.hero-cta {
		display: inline-block;
		margin-top: var(--space-3);
		font-size: 13px;
		font-weight: 600;
	}

	.hero-cycle {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-5);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.cycle-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.cycle-label {
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-text-subtle);
	}

	.cycle-name {
		font-size: 16px;
		font-weight: 700;
	}

	.cycle-bar {
		height: 8px;
		background: var(--color-surface-2);
		border-radius: var(--radius-full);
		overflow: hidden;
	}

	.cycle-bar-fill {
		height: 100%;
		background: linear-gradient(90deg, #6366f1, #4338ca);
		border-radius: var(--radius-full);
		transition: width 600ms ease;
	}

	.cycle-meta {
		display: flex;
		justify-content: space-between;
		font-size: 12px;
		color: var(--color-text-muted);
	}

	/* Stats */
	.stats-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: var(--space-4);
		margin-bottom: var(--space-6);
	}

	.stat-card {
		padding: var(--space-5);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.stat-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.stat-label {
		font-size: 12px;
		font-weight: 600;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.stat-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}

	.tone-success {
		background: var(--color-success);
	}
	.tone-warning {
		background: var(--color-warning);
	}
	.tone-muted {
		background: var(--color-border-strong);
	}

	.stat-value {
		font-size: 28px;
		font-weight: 700;
		letter-spacing: -0.02em;
	}

	.stat-hint {
		font-size: 12px;
		color: var(--color-text-subtle);
	}

	/* Panels */
	.grid-2 {
		display: grid;
		grid-template-columns: 1.3fr 1fr;
		gap: var(--space-5);
		margin-bottom: var(--space-6);
	}

	.panel {
		padding: var(--space-6);
	}

	.panel-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: var(--space-5);
	}

	.panel-title {
		font-size: 17px;
	}

	.panel-sub {
		font-size: 13px;
		color: var(--color-text-muted);
		margin-top: var(--space-1);
	}

	.panel-link {
		font-size: 13px;
		font-weight: 600;
		white-space: nowrap;
	}

	/* Feed list */
	.feed-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
	}

	.feed-item {
		display: grid;
		grid-template-columns: 36px 1fr;
		gap: var(--space-3);
		padding: var(--space-4) 0;
		border-top: 1px solid var(--color-border);
	}

	.feed-item:first-child {
		border-top: none;
		padding-top: 0;
	}

	.feed-avatar {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		color: #fff;
		font-size: 12px;
		font-weight: 700;
	}

	.feed-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-3);
	}

	.feed-to {
		font-weight: 600;
		font-size: 14px;
	}

	.feed-excerpt {
		font-size: 13px;
		color: var(--color-text-muted);
		margin-top: var(--space-2);
		line-height: 1.5;
		white-space: pre-wrap;
	}

	.feed-meta {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-top: var(--space-2);
		font-size: 12px;
		color: var(--color-text-subtle);
	}

	.feed-sep {
		opacity: 0.5;
	}

	.empty-text {
		color: var(--color-text-muted);
		font-size: 13px;
		padding: var(--space-4) 0;
	}

	/* Team list */
	.team-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.team-item {
		display: grid;
		grid-template-columns: 36px 1fr auto auto;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3);
		border-radius: var(--radius-md);
		transition: background var(--transition-fast);
	}

	.team-item:hover {
		background: var(--color-surface-2);
	}

	.team-avatar {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		color: #fff;
		font-size: 12px;
		font-weight: 700;
	}

	.team-name {
		font-size: 14px;
		font-weight: 600;
	}

	.team-role {
		font-size: 12px;
		color: var(--color-text-subtle);
	}

	.team-btn {
		height: 32px;
		padding: 0 var(--space-3);
		font-size: 12px;
	}

	/* Cycles */
	.cycles-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--space-4);
	}

	.cycle-card {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		transition: border-color var(--transition-fast);
	}

	.cycle-card.active {
		border-color: var(--color-primary);
		background: var(--color-primary-soft);
	}

	.cycle-card-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: var(--space-2);
	}

	.cycle-card-name {
		font-weight: 600;
		font-size: 14px;
	}

	.cycle-card-bar {
		margin: var(--space-1) 0;
	}

	.cycle-card-meta {
		display: flex;
		justify-content: space-between;
		font-size: 12px;
		color: var(--color-text-muted);
	}

	.badge-warning {
		background: #fff5e0;
		color: #b76b00;
	}

	/* Loading / error states */
	.state-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-4);
		text-align: center;
		padding: var(--space-12) var(--space-8);
	}

	.state-text {
		color: var(--color-text-muted);
		font-size: 14px;
	}

	.state-card .alert {
		max-width: 480px;
		text-align: left;
		display: flex;
		gap: var(--space-2);
		align-items: flex-start;
		background: var(--color-danger-soft);
		color: var(--color-danger);
		border: 1px solid #f8c7c2;
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-md);
		font-size: 13px;
		line-height: 1.45;
	}

	.spinner-lg {
		width: 32px;
		height: 32px;
		border: 3px solid var(--color-border);
		border-top-color: var(--color-primary);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (max-width: 1100px) {
		.hero,
		.grid-2 {
			grid-template-columns: 1fr;
		}
		.stats-grid {
			grid-template-columns: repeat(2, 1fr);
		}
		.cycles-grid {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 640px) {
		.team-item {
			grid-template-columns: 36px 1fr auto;
		}
	}
</style>