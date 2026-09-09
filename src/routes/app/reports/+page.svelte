<script lang="ts">
	import { auth } from '$lib/auth.svelte';
	import {
		ApiClientError,
		listFeedbackPeriods,
		listMyFeedbacks,
		listMyGivenFeedbacks,
		listMyReportees,
		listEmployeeFeedbacks,
		listEmployees,
		type Employee,
		type FeedbackPeriod,
		type FeedbackResponse
	} from '$lib/auth/auth';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	type ScoreKey =
		| 'communication_score'
		| 'leadership_score'
		| 'technical_score'
		| 'collaboration_score'
		| 'delivery_score'
		| 'trust_score';

	const SCORE_FIELDS: { key: ScoreKey; label: string }[] = [
		{ key: 'communication_score', label: 'Communication' },
		{ key: 'leadership_score', label: 'Leadership' },
		{ key: 'technical_score', label: 'Technical' },
		{ key: 'collaboration_score', label: 'Collaboration' },
		{ key: 'delivery_score', label: 'Delivery' },
		{ key: 'trust_score', label: 'Trust' }
	];

	type Tab = 'mine' | 'given' | 'team';

	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let teamLoading = $state(false);

	let periods = $state<FeedbackPeriod[]>([]);
	let received = $state<FeedbackResponse[]>([]);
	let given = $state<FeedbackResponse[]>([]);
	let employees = $state<Employee[]>([]);
	let reportees = $state<Employee[]>([]);
	let reporteeFeedback = $state<Record<string, FeedbackResponse[]>>({});

	let tab = $state<Tab>('mine');
	let periodFilter = $state('all');
	let expandedReportee = $state<string | null>(null);

	const periodMap = $derived(new Map(periods.map((p) => [p.id, p])));
	const employeeMap = $derived(new Map(employees.map((e) => [e.id, e])));

	// --- Filtering ---

	const filteredReceived = $derived(
		periodFilter === 'all' ? received : received.filter((f) => f.period_id === periodFilter)
	);
	const filteredGiven = $derived(
		periodFilter === 'all' ? given : given.filter((f) => f.period_id === periodFilter)
	);

	// --- Tab 1: personal analytics (from received) ---

	const myStats = $derived.by(() => {
		const all = filteredReceived;
		const avg = averageOf(all);
		return {
			total: all.length,
			named: all.filter((f) => f.visibility === 'named').length,
			anonymous: all.filter((f) => f.visibility === 'anonymous').length,
			avg
		};
	});

	const dimensionAverages = $derived.by(() => {
		const all = filteredReceived;
		return SCORE_FIELDS.map((field) => {
			const sum = all.reduce((acc, f) => acc + f[field.key], 0);
			return {
				...field,
				avg: all.length === 0 ? 0 : Math.round((sum / all.length) * 10) / 10
			};
		});
	});

	// Average score per period — only periods that have feedback.
	const periodAverages = $derived.by(() => {
		return periods
			.map((p) => {
				const entries = received.filter((f) => f.period_id === p.id);
				return { period: p, count: entries.length, avg: averageOf(entries) };
			})
			.filter((row) => row.count > 0);
	});

	// All 6xN scores bucketed 1..5.
	const ratingDistribution = $derived.by(() => {
		const counts = [0, 0, 0, 0, 0];
		for (const f of filteredReceived) {
			for (const field of SCORE_FIELDS) {
				const v = f[field.key];
				if (v >= 1 && v <= 5) counts[v - 1]++;
			}
		}
		const max = Math.max(...counts, 1);
		return counts.map((count, i) => ({ rating: i + 1, count, pct: (count / max) * 100 }));
	});

	// --- Tab 2: given log ---
	const givenLog = $derived(
		[...filteredGiven].sort(
			(a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
		)
	);

	// --- Tab 3: team report ---
	const teamRows = $derived.by(() => {
		return reportees.map((r) => {
			const all = reporteeFeedback[r.id] ?? [];
			const filtered =
				periodFilter === 'all' ? all : all.filter((f) => f.period_id === periodFilter);
			return { reportee: r, count: filtered.length, avg: averageOf(filtered) };
		});
	});

	// --- Helpers ---

	function averageOf(entries: FeedbackResponse[]): number {
		if (entries.length === 0) return 0;
		const sum = entries.reduce(
			(acc, f) =>
				acc +
				f.communication_score +
				f.leadership_score +
				f.technical_score +
				f.collaboration_score +
				f.delivery_score +
				f.trust_score,
			0
		);
		return Math.round((sum / (entries.length * 6)) * 10) / 10;
	}

	function scoreColor(v: number): string {
		if (v >= 4.5) return '#10b981';
		if (v >= 3.5) return '#0ea5e9';
		if (v >= 2.5) return '#f59e0b';
		return '#ef4444';
	}

	function periodLabel(f: FeedbackResponse): string {
		return periodMap.get(f.period_id)?.name ?? 'Unknown cycle';
	}

	function reporteeNameFor(f: FeedbackResponse): string {
		return employeeMap.get(f.reviewee_id)?.name ?? 'A colleague';
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

	const AVATAR_COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];
	function colorFor(id: string): string {
		let hash = 0;
		for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
		return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
	}

	function initials(name: string): string {
		return name
			.split(' ')
			.map((p) => p[0])
			.slice(0, 2)
			.join('')
			.toUpperCase();
	}

	// --- Load flow ---

	onMount(() => {
		if (!auth.isAuthenticated) {
			goto('/login', { replaceState: true });
			return;
		}
		loadAll();
	});

	async function loadAll() {
		loading = true;
		loadError = null;
		try {
			const token = auth.token;
			if (!token) {
				goto('/login', { replaceState: true });
				return;
			}
			const [periodsRes, receivedAll, givenAll, allEmployees] = await Promise.all([
				listFeedbackPeriods(token),
				fetchAllReceived(token),
				fetchAllGiven(token),
				fetchAllEmployees(token)
			]);
			periods = periodsRes.periods;
			received = receivedAll;
			given = givenAll;
			employees = allEmployees;
			// Kick off the team tab in the background; failure just hides the tab.
			loadTeam();
		} catch (err) {
			if (err instanceof ApiClientError) {
				if (err.code === 'unauthorized') {
					await auth.logout();
					goto('/login', { replaceState: true });
					return;
				}
				loadError = err.message || 'Could not load your reports.';
			} else {
				loadError = 'Could not load your reports.';
			}
		} finally {
			loading = false;
		}
	}

	async function loadTeam() {
		const token = auth.token;
		if (!token) return;
		teamLoading = true;
		try {
			const allReportees = await fetchAllReportees(token);
			reportees = allReportees;
			if (allReportees.length > 0) {
				// Fan out per reportee; 403 (not the manager) is impossible here
				// since the roster came from /me/reports, but be defensive.
				const results = await Promise.allSettled(
					allReportees.map((r) => fetchEmployeeFeedbacks(token, r.id))
				);
				const map: Record<string, FeedbackResponse[]> = {};
				results.forEach((res, i) => {
					if (res.status === 'fulfilled') map[allReportees[i].id] = res.value;
				});
				reporteeFeedback = map;
			}
		} catch {
			// Not a manager or transient failure — the team tab stays hidden.
			reportees = [];
		} finally {
			teamLoading = false;
		}
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

	async function fetchAllReportees(token: string): Promise<Employee[]> {
		const out: Employee[] = [];
		let cursor: string | null = null;
		for (let i = 0; i < 50; i++) {
			const page = await listMyReportees(token, { limit: 100, cursor: cursor ?? undefined });
			out.push(...page.employees);
			cursor = page.next_cursor;
			if (!cursor) break;
		}
		return out;
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

	async function fetchEmployeeFeedbacks(
		token: string,
		employeeId: string
	): Promise<FeedbackResponse[]> {
		const out: FeedbackResponse[] = [];
		let cursor: string | null = null;
		for (let i = 0; i < 50; i++) {
			const page = await listEmployeeFeedbacks(token, employeeId, {
				limit: 100,
				cursor: cursor ?? undefined
			});
			out.push(...page.feedbacks);
			cursor = page.next_cursor;
			if (!cursor) break;
		}
		return out;
	}

	function toggleReportee(id: string) {
		expandedReportee = expandedReportee === id ? null : id;
	}
</script>

<svelte:head>
	<title>Reports · 360 Feedback</title>
</svelte:head>

<div class="page">
	<div class="page-head">
		<div class="page-head-text">
			<h1>Reports</h1>
			<p class="page-sub">Insights from your feedback cycles.</p>
		</div>
	</div>

	{#if loading}
		<div class="card state-card">
			<div class="spinner-lg" aria-label="Loading"></div>
			<p class="state-text">Loading your reports…</p>
		</div>
	{:else if loadError}
		<div class="card state-card">
			<div class="alert" role="alert">
				<svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
					<path d="M10 1.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17zM10 6v5M10 14.5v.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
				</svg>
				<span>{loadError}</span>
			</div>
			<button type="button" class="btn btn-secondary" onclick={loadAll}>Try again</button>
		</div>
	{:else}
		<!-- Tabs -->
		<div class="tabs">
			<div class="segmented">
				<button type="button" class="seg-btn" class:active={tab === 'mine'} onclick={() => (tab = 'mine')}>
					My report
				</button>
				<button type="button" class="seg-btn" class:active={tab === 'given'} onclick={() => (tab = 'given')}>
					My submissions
				</button>
				{#if reportees.length > 0 || teamLoading}
					<button type="button" class="seg-btn" class:active={tab === 'team'} onclick={() => (tab = 'team')}>
						Team report
					</button>
				{/if}
			</div>

			<!-- Cycle filter applies to all tabs -->
			<div class="filter-group">
				<label class="filter-label" for="period-filter">Cycle</label>
				<select id="period-filter" class="input" bind:value={periodFilter}>
					<option value="all">All cycles</option>
					{#each periods as p}
						<option value={p.id}>{p.name}</option>
					{/each}
				</select>
			</div>
		</div>

		{#if tab === 'mine'}
			<!-- Personal analytics -->
			<div class="stats-grid">
				<div class="stat-card card">
					<div class="stat-top">
						<span class="stat-label">Feedback received</span>
						<span class="stat-dot tone-muted" aria-hidden="true"></span>
					</div>
					<div class="stat-value">{myStats.total}</div>
					<div class="stat-hint">
						{periodFilter === 'all' ? 'All cycles' : periodMap.get(periodFilter)?.name}
					</div>
				</div>
				<div class="stat-card card">
					<div class="stat-top">
						<span class="stat-label">Average score</span>
						<span class="stat-dot tone-success" aria-hidden="true"></span>
					</div>
					<div class="stat-value" style="color:{myStats.avg ? scoreColor(myStats.avg) : undefined}">
						{myStats.avg || '—'}
					</div>
					<div class="stat-hint">Across all six dimensions</div>
				</div>
				<div class="stat-card card">
					<div class="stat-top">
						<span class="stat-label">Named</span>
						<span class="stat-dot tone-named" aria-hidden="true"></span>
					</div>
					<div class="stat-value">{myStats.named}</div>
					<div class="stat-hint">Attributed to a teammate</div>
				</div>
				<div class="stat-card card">
					<div class="stat-top">
						<span class="stat-label">Anonymous</span>
						<span class="stat-dot tone-anon" aria-hidden="true"></span>
					</div>
					<div class="stat-value">{myStats.anonymous}</div>
					<div class="stat-hint">Identity hidden</div>
				</div>
			</div>

			<div class="report-grid">
				<!-- Score breakdown -->
				<div class="card report-card">
					<h2 class="report-title">Score breakdown</h2>
					<p class="report-sub">Average per dimension across the selected feedback.</p>
					{#if myStats.total === 0}
						<p class="empty-text">No feedback received in this selection yet.</p>
					{:else}
						<div class="dim-list">
							{#each dimensionAverages as d (d.key)}
								<div class="dim-row">
									<span class="dim-label">{d.label}</span>
									<div class="score-bar" aria-hidden="true">
										<div class="score-fill" style="width:{(d.avg / 5) * 100}%; background:{scoreColor(d.avg)}"></div>
									</div>
									<span class="dim-num">{d.avg.toFixed(1)}</span>
								</div>
							{/each}
						</div>
					{/if}
				</div>

				<!-- Rating distribution -->
				<div class="card report-card">
					<h2 class="report-title">Rating distribution</h2>
					<p class="report-sub">How your scores spread from 1 to 5.</p>
					{#if myStats.total === 0}
						<p class="empty-text">No feedback received in this selection yet.</p>
					{:else}
						<div class="dist-list">
							{#each ratingDistribution as r (r.rating)}
								<div class="dist-row">
									<span class="dist-label">{r.rating}★</span>
									<div class="dist-bar" aria-hidden="true">
										<div class="dist-fill" class:empty={r.count === 0} style="width:{r.pct}%; background:{scoreColor(r.rating)}"></div>
									</div>
									<span class="dist-num">{r.count}</span>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>

			<!-- Trend across cycles -->
			<div class="card report-card wide">
				<h2 class="report-title">Trend across cycles</h2>
				<p class="report-sub">Average score of the feedback you received, per cycle.</p>
				{#if periodAverages.length === 0}
					<p class="empty-text">No cycles with feedback yet.</p>
				{:else}
					<div class="trend-list">
						{#each periodAverages as row (row.period.id)}
							<div class="trend-row">
								<span class="trend-label">{row.period.name}</span>
								<div class="trend-track">
									<div class="trend-fill" style="width:{(row.avg / 5) * 100}%; background:{scoreColor(row.avg)}"></div>
								</div>
								<span class="trend-avg" style="color:{scoreColor(row.avg)}">{row.avg.toFixed(1)}</span>
								<span class="trend-count">{row.count} {row.count === 1 ? 'entry' : 'entries'}</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{:else if tab === 'given'}
			<!-- Submissions log -->
			{#if givenLog.length === 0}
				<div class="card state-card">
					<div class="empty-icon" aria-hidden="true">
						<svg width="44" height="44" viewBox="0 0 48 48" fill="none">
							<circle cx="24" cy="24" r="22" fill="#f1f3f7" />
							<path d="M16 26l4 4 12-12" stroke="#8b94a6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.6"/>
						</svg>
					</div>
					<h2>No submissions yet</h2>
					<p class="state-text">
						Feedback you submit will be logged here for every cycle.
					</p>
					<a href="/app/feedback/new" class="btn btn-primary">Write feedback</a>
				</div>
			{:else}
				<div class="card table-card">
					<div class="table-head grid-row">
						<span>Colleague</span>
						<span>Cycle</span>
						<span>Visibility</span>
						<span>Avg score</span>
						<span>Submitted</span>
					</div>

					{#each givenLog as f (f.id)}
						{@const avg =
							(f.communication_score +
								f.leadership_score +
								f.technical_score +
								f.collaboration_score +
								f.delivery_score +
								f.trust_score) /
							6}
						{@const revieweeName = reporteeNameFor(f)}
						<div class="grid-row log-row">
							<div class="cell-person">
								<div class="avatar" style="background:{colorFor(f.reviewee_id)}">
									{initials(revieweeName)}
								</div>
								<div class="person-meta">
									<div class="person-name">{revieweeName}</div>
									<div class="person-sub">Reviewee</div>
								</div>
							</div>
							<div class="cell-text">{periodLabel(f)}</div>
							<div class="cell-text">
								<span class="badge {f.visibility === 'named' ? 'badge-named' : 'badge-anon'}">
									{f.visibility}
								</span>
							</div>
							<div>
								<span class="score-chip" style="background:{scoreColor(avg)}1a; color:{scoreColor(avg)}">
									{avg.toFixed(1)}
								</span>
							</div>
							<div class="cell-text cell-date">{formatDate(f.created_at)}</div>
						</div>
					{/each}
				</div>
			{/if}
		{:else if tab === 'team'}
			<!-- Team report (managers only) -->
			{#if teamLoading}
				<div class="card state-card">
					<div class="spinner-lg" aria-label="Loading"></div>
					<p class="state-text">Loading your team's reports…</p>
				</div>
			{:else if reportees.length === 0}
				<div class="card state-card">
					<h2>No direct reportees</h2>
					<p class="state-text">You don't have direct reportees to report on.</p>
				</div>
			{:else}
				<div class="card table-card">
					<div class="table-head grid-row team-grid">
						<span>Reportee</span>
						<span>Feedback</span>
						<span>Avg score</span>
						<span></span>
					</div>

					{#each teamRows as row (row.reportee.id)}
						{@const entries =
							periodFilter === 'all'
								? reporteeFeedback[row.reportee.id] ?? []
								: (reporteeFeedback[row.reportee.id] ?? []).filter(
										(f) => f.period_id === periodFilter
									)}
						<div class="grid-row team-grid log-row" class:open={expandedReportee === row.reportee.id}>
							<div class="cell-person">
								<div class="avatar" style="background:{colorFor(row.reportee.id)}">
									{initials(row.reportee.name)}
								</div>
								<div class="person-meta">
									<div class="person-name">{row.reportee.name}</div>
									<div class="person-sub">{row.reportee.title || row.reportee.email}</div>
								</div>
							</div>
							<div class="cell-text">{row.count}</div>
							<div>
								<span class="score-chip" style="background:{scoreColor(row.avg)}1a; color:{scoreColor(row.avg)}">
									{row.avg ? row.avg.toFixed(1) : '—'}
								</span>
							</div>
							<div class="cell-expand">
							<button
								type="button"
								class="expand-btn"
								onclick={() => toggleReportee(row.reportee.id)}
								aria-expanded={expandedReportee === row.reportee.id}
								aria-label="Toggle score breakdown for {row.reportee.name}"
								disabled={row.count === 0}
							>
									<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
										<path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
									</svg>
								</button>
							</div>
						</div>

					{#if expandedReportee === row.reportee.id}
						<div class="expand-panel">
							{#if entries.length === 0}
								<p class="empty-text">No feedback received in this selection.</p>
							{:else}
								<div class="dim-list">
									{#each SCORE_FIELDS as field (field.key)}
										{@const sum = entries.reduce((acc, f) => acc + f[field.key], 0)}
										{@const avg = Math.round((sum / entries.length) * 10) / 10}
										<div class="dim-row">
											<span class="dim-label">{field.label}</span>
											<div class="score-bar" aria-hidden="true">
												<div class="score-fill" style="width:{(avg / 5) * 100}%; background:{scoreColor(avg)}"></div>
											</div>
											<span class="dim-num">{avg.toFixed(1)}</span>
										</div>
									{/each}
								</div>

								<div class="comments-head">Feedback comments</div>
								<ul class="comment-list">
									{#each entries as f (f.id)}
										<li class="comment-card">
											<div class="comment-card-head">
												<span class="comment-date">{formatDate(f.created_at)}</span>
												<span class="badge {f.visibility === 'named' ? 'badge-named' : 'badge-anon'}">
													{f.visibility}
												</span>
											</div>
											<div class="comment-block">
												<div class="comment-label">Strengths</div>
												<p class="comment-text">{f.strengths_comment}</p>
											</div>
											<div class="comment-block">
												<div class="comment-label">Areas to grow</div>
												<p class="comment-text">{f.weaknesses_comment}</p>
											</div>
										</li>
									{/each}
								</ul>

								<p class="expand-note">
									{entries.length}
									{entries.length === 1 ? 'entry' : 'entries'} · reviewer identities are always
									hidden in this view
								</p>
							{/if}
						</div>
					{/if}
				{/each}
			</div>
			<p class="footnote">
				Reviewer identities are hidden in this view — you see what was said, not who said it.
				Your reportees still see named reviewers in their own feedback.
			</p>
			{/if}
		{/if}
	{/if}
</div>

<style>
	.page {
		max-width: 1000px;
		margin: 0 auto;
	}

	.page-head {
		margin-bottom: var(--space-6);
	}

	.page-head-text h1 {
		font-size: 26px;
		line-height: 1.2;
	}

	.page-sub {
		margin-top: var(--space-2);
		color: var(--color-text-muted);
		font-size: 14px;
		max-width: 60ch;
	}

	.card {
		padding: var(--space-6);
	}

	.state-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-4);
		text-align: center;
		padding: var(--space-12) var(--space-8);
	}

	.state-card h2 {
		font-size: 18px;
	}

	.state-text {
		color: var(--color-text-muted);
		font-size: 14px;
		max-width: 42ch;
	}

	.alert {
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

	.alert svg {
		flex-shrink: 0;
		margin-top: 2px;
	}

	.empty-icon {
		margin-bottom: var(--space-2);
	}

	/* Tabs + filter */
	.tabs {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-4);
		flex-wrap: wrap;
		margin-bottom: var(--space-5);
	}

	.segmented {
		display: inline-flex;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 2px;
	}

	.seg-btn {
		background: transparent;
		border: none;
		padding: 6px 14px;
		font-size: 13px;
		font-weight: 500;
		color: var(--color-text-muted);
		border-radius: calc(var(--radius-md) - 2px);
		cursor: pointer;
		transition: background var(--transition-fast), color var(--transition-fast);
	}

	.seg-btn.active {
		background: var(--color-surface);
		color: var(--color-text);
		font-weight: 600;
		box-shadow: var(--shadow-sm);
	}

	.filter-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 200px;
	}

	.filter-label {
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-subtle);
	}

	select.input {
		height: 38px;
		padding: 0 var(--space-3);
		appearance: none;
		background-image: url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1.5l5 5 5-5' stroke='%238b94a6' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right var(--space-3) center;
		padding-right: var(--space-7);
	}

	/* Stats */
	.stats-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: var(--space-4);
		margin-bottom: var(--space-5);
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

	.tone-muted { background: var(--color-border-strong); }
	.tone-named { background: #4f46e5; }
	.tone-anon { background: #8b94a6; }
	.tone-success { background: var(--color-success); }

	.stat-value {
		font-size: 28px;
		font-weight: 700;
		letter-spacing: -0.02em;
	}

	.stat-hint {
		font-size: 12px;
		color: var(--color-text-subtle);
	}

	/* Report cards */
	.report-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-5);
		margin-bottom: var(--space-5);
	}

	.report-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.report-card.wide {
		margin-bottom: var(--space-5);
	}

	.report-title {
		font-size: 16px;
	}

	.report-sub {
		font-size: 13px;
		color: var(--color-text-muted);
		margin-bottom: var(--space-3);
	}

	.empty-text {
		color: var(--color-text-muted);
		font-size: 13px;
		padding: var(--space-2) 0;
	}

	/* Dimension bars */
	.dim-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.dim-row {
		display: grid;
		grid-template-columns: 110px 1fr 44px;
		gap: var(--space-4);
		align-items: center;
	}

	.dim-label {
		font-size: 13px;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.dim-num {
		font-size: 13px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		text-align: right;
	}

	.score-bar {
		height: 6px;
		background: var(--color-surface-2);
		border-radius: var(--radius-full);
		overflow: hidden;
	}

	.score-fill {
		height: 100%;
		border-radius: var(--radius-full);
		transition: width 300ms ease;
	}

	/* Distribution */
	.dist-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.dist-row {
		display: grid;
		grid-template-columns: 32px 1fr 44px;
		gap: var(--space-3);
		align-items: center;
	}

	.dist-label {
		font-size: 13px;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.dist-bar {
		height: 14px;
		background: var(--color-surface-2);
		border-radius: var(--radius-full);
		overflow: hidden;
	}

	.dist-fill {
		height: 100%;
		border-radius: var(--radius-full);
		transition: width 300ms ease;
	}

	.dist-fill.empty {
		background: var(--color-surface-2);
	}

	.dist-num {
		font-size: 13px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		text-align: right;
		color: var(--color-text-muted);
	}

	/* Trend */
	.trend-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.trend-row {
		display: grid;
		grid-template-columns: 140px 1fr 48px 72px;
		gap: var(--space-4);
		align-items: center;
	}

	.trend-label {
		font-size: 13px;
		font-weight: 600;
		color: var(--color-text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.trend-track {
		height: 10px;
		background: var(--color-surface-2);
		border-radius: var(--radius-full);
		overflow: hidden;
	}

	.trend-fill {
		height: 100%;
		border-radius: var(--radius-full);
		transition: width 300ms ease;
	}

	.trend-avg {
		font-size: 13px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		text-align: right;
	}

	.trend-count {
		font-size: 12px;
		color: var(--color-text-subtle);
		text-align: right;
	}

	/* Tables (given log + team) */
	.table-card {
		display: flex;
		flex-direction: column;
	}

	.grid-row {
		display: grid;
		grid-template-columns: minmax(180px, 1.6fr) minmax(120px, 1fr) minmax(100px, 0.8fr) minmax(90px, 0.6fr) minmax(100px, 0.7fr);
		gap: var(--space-4);
		align-items: center;
		padding: var(--space-4) var(--space-2);
	}

	.team-grid {
		grid-template-columns: minmax(200px, 1.6fr) minmax(80px, 0.6fr) minmax(90px, 0.6fr) 44px;
	}

	.table-head {
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-subtle);
		border-bottom: 1px solid var(--color-border);
		padding-top: 0;
		padding-bottom: var(--space-3);
	}

	.log-row {
		border-bottom: 1px solid var(--color-border);
	}

	.log-row:last-of-type {
		border-bottom: none;
	}

	.log-row.open {
		border-bottom: none;
	}

	.cell-person {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-width: 0;
	}

	.avatar {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		color: #fff;
		font-size: 12px;
		font-weight: 700;
		flex-shrink: 0;
	}

	.person-meta {
		min-width: 0;
	}

	.person-name {
		font-size: 14px;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.person-sub {
		font-size: 12px;
		color: var(--color-text-subtle);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.cell-text {
		font-size: 13px;
		color: var(--color-text-muted);
	}

	.cell-date {
		font-variant-numeric: tabular-nums;
	}

	.score-chip {
		display: inline-grid;
		place-items: center;
		width: 44px;
		height: 30px;
		border-radius: 8px;
		font-size: 13px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.badge-named {
		background: #eef2ff;
		color: #4338ca;
	}

	.badge-anon {
		background: var(--color-surface-2);
		color: var(--color-text-muted);
	}

	/* Team expand */
	.cell-expand {
		display: flex;
		justify-content: flex-end;
	}

	.expand-btn {
		width: 32px;
		height: 32px;
		display: grid;
		place-items: center;
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		color: var(--color-text-subtle);
		cursor: pointer;
		transition: background var(--transition-fast), color var(--transition-fast);
	}

	.expand-btn:hover:not(:disabled) {
		background: var(--color-surface-2);
		color: var(--color-text);
	}

	.expand-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.expand-btn svg {
		transition: transform var(--transition-fast);
	}

	.expand-btn[aria-expanded='true'] svg {
		transform: rotate(180deg);
	}

	.expand-panel {
		border-bottom: 1px solid var(--color-border);
		padding: var(--space-5) var(--space-6);
		background: var(--color-surface);
	}

	.expand-note {
		margin-top: var(--space-4);
		font-size: 12px;
		color: var(--color-text-subtle);
	}

	.comments-head {
		margin-top: var(--space-5);
		margin-bottom: var(--space-3);
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-subtle);
	}

	.comment-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.comment-card {
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.comment-card-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-3);
	}

	.comment-date {
		font-size: 12px;
		font-weight: 600;
		color: var(--color-text-subtle);
		font-variant-numeric: tabular-nums;
	}

	.comment-block {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.comment-label {
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-subtle);
	}

	.comment-text {
		font-size: 13px;
		line-height: 1.55;
		color: var(--color-text);
		white-space: pre-wrap;
		margin: 0;
	}

	.footnote {
		margin-top: var(--space-4);
		font-size: 12px;
		color: var(--color-text-subtle);
	}

	/* Spinner */
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

	@media (max-width: 900px) {
		.stats-grid {
			grid-template-columns: repeat(2, 1fr);
		}

		.report-grid {
			grid-template-columns: 1fr;
		}

		.tabs {
			align-items: stretch;
		}

		.filter-group {
			min-width: 0;
			width: 100%;
		}
	}

	@media (max-width: 720px) {
		.grid-row {
			grid-template-columns: 1fr 1fr;
			row-gap: var(--space-3);
		}

		.table-head {
			display: none;
		}

		.log-row {
			padding: var(--space-4) 0;
			border-top: 1px solid var(--color-border);
		}

		.log-row:first-of-type {
			border-top: none;
		}

		.cell-person {
			grid-column: 1 / -1;
		}

		.team-grid .cell-person {
			grid-column: 1 / -1;
		}

		.trend-row {
			grid-template-columns: 100px 1fr 44px;
		}

		.trend-count {
			display: none;
		}
	}
</style>