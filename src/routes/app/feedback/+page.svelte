<script lang="ts">
	import { auth } from '$lib/auth.svelte';
	import {
		ApiClientError,
		listMyFeedbacks,
		listFeedbackPeriods,
		listEmployees,
		type FeedbackResponse,
		type FeedbackPeriod,
		type Employee
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

	let feedbacks = $state<FeedbackResponse[]>([]);
	let periods = $state<FeedbackPeriod[]>([]);
	let employees = $state<Employee[]>([]);
	let nextCursor = $state<string | null>(null);
	let loading = $state(true);
	let loadingMore = $state(false);
	let loadError = $state<string | null>(null);

	// Map reviewer_id -> Employee (for "named" feedback). Empty reviewer_id
	// (anonymous) is rendered as "Anonymous".
	const reviewerMap = $derived(new Map(employees.map((e) => [e.id, e])));
	// Map period_id -> period name.
	const periodMap = $derived(new Map(periods.map((p) => [p.id, p])));

	// Filters
	type VisibilityFilter = 'all' | 'anonymous' | 'named';
	let visibilityFilter = $state<VisibilityFilter>('all');
	let periodFilter = $state<string>('all');
	let search = $state('');

	const filtered = $derived(
		feedbacks.filter((f) => {
			if (visibilityFilter !== 'all' && f.visibility !== visibilityFilter) return false;
			if (periodFilter !== 'all' && f.period_id !== periodFilter) return false;
			if (search.trim()) {
				const q = search.trim().toLowerCase();
				const hay = `${f.strengths_comment} ${f.weaknesses_comment}`.toLowerCase();
				if (!hay.includes(q)) return false;
			}
			return true;
		})
	);

	// Summary stats
	const stats = $derived({
		total: feedbacks.length,
		anonymous: feedbacks.filter((f) => f.visibility === 'anonymous').length,
		named: feedbacks.filter((f) => f.visibility === 'named').length,
		avgScore: (() => {
			if (feedbacks.length === 0) return 0;
			const sum = feedbacks.reduce((acc, f) => {
				return (
					acc +
					f.communication_score +
					f.leadership_score +
					f.technical_score +
					f.collaboration_score +
					f.delivery_score +
					f.trust_score
				);
			}, 0);
			return Math.round((sum / (feedbacks.length * 6)) * 10) / 10;
		})()
	});

	const currentUser = $derived(auth.user);

	onMount(async () => {
		if (!auth.isAuthenticated) {
			goto('/login', { replaceState: true });
			return;
		}
		await loadAll();
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
			// Fetch feedbacks, periods, and employees in parallel.
			const [fbRes, periodsRes, allEmployees] = await Promise.all([
				listMyFeedbacks(token, { limit: 50 }),
				listFeedbackPeriods(token),
				fetchAllEmployees(token)
			]);
			feedbacks = fbRes.feedbacks;
			nextCursor = fbRes.next_cursor;
			periods = periodsRes.periods;
			employees = allEmployees;
		} catch (err) {
			handleError(err);
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

	async function loadMore() {
		if (!nextCursor || loadingMore) return;
		loadingMore = true;
		try {
			const token = auth.token;
			if (!token) return;
			const res = await listMyFeedbacks(token, { limit: 50, cursor: nextCursor });
			feedbacks = [...feedbacks, ...res.feedbacks];
			nextCursor = res.next_cursor;
		} catch (err) {
			handleError(err, true);
		} finally {
			loadingMore = false;
		}
	}

	function handleError(err: unknown, isLoadMore = false) {
		if (err instanceof ApiClientError) {
			if (err.code === 'unauthorized') {
				auth.logout();
				goto('/login', { replaceState: true });
				return;
			}
			if (!isLoadMore) {
				loadError = err.message || 'Could not load your feedback.';
			}
		} else if (!isLoadMore) {
			loadError = 'Could not load your feedback.';
		}
	}

	function reviewerLabel(f: FeedbackResponse): string {
		if (f.visibility === 'anonymous' || !f.reviewer_id) return 'Anonymous';
		return reviewerMap.get(f.reviewer_id)?.name ?? 'A teammate';
	}

	function periodLabel(f: FeedbackResponse): string {
		return periodMap.get(f.period_id)?.name ?? 'Unknown cycle';
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

	function averageScore(f: FeedbackResponse): number {
		return (
			(f.communication_score +
				f.leadership_score +
				f.technical_score +
				f.collaboration_score +
				f.delivery_score +
				f.trust_score) /
			6
		);
	}

	function scoreColor(v: number): string {
		if (v >= 4.5) return '#10b981';
		if (v >= 3.5) return '#0ea5e9';
		if (v >= 2.5) return '#f59e0b';
		return '#ef4444';
	}

	let expandedId = $state<string | null>(null);
	function toggleExpand(id: string) {
		expandedId = expandedId === id ? null : id;
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

	function resetFilters() {
		visibilityFilter = 'all';
		periodFilter = 'all';
		search = '';
	}

	const hasFilters = $derived(visibilityFilter !== 'all' || periodFilter !== 'all' || search.trim() !== '');
</script>

<svelte:head>
	<title>My Feedback · 360 Feedback</title>
</svelte:head>

<div class="page">
	<div class="page-head">
		<div class="page-head-text">
			<h1>My Feedback</h1>
			<p class="page-sub">
				Feedback your teammates have shared about you. Click any entry to see the full details.
			</p>
		</div>
		<a href="/app/feedback/new" class="btn btn-primary">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
				<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
			</svg>
			Give feedback
		</a>
	</div>

	{#if loading}
		<div class="card state-card">
			<div class="spinner-lg" aria-label="Loading"></div>
			<p class="state-text">Loading your feedback…</p>
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
		<!-- Summary stats -->
		<div class="stats-grid">
			<div class="stat-card card">
				<div class="stat-top">
					<span class="stat-label">Total entries</span>
					<span class="stat-dot tone-muted" aria-hidden="true"></span>
				</div>
				<div class="stat-value">{stats.total}</div>
				<div class="stat-hint">All feedback received</div>
			</div>
			<div class="stat-card card">
				<div class="stat-top">
					<span class="stat-label">Named</span>
					<span class="stat-dot tone-named" aria-hidden="true"></span>
				</div>
				<div class="stat-value">{stats.named}</div>
				<div class="stat-hint">Attributed to a teammate</div>
			</div>
			<div class="stat-card card">
				<div class="stat-top">
					<span class="stat-label">Anonymous</span>
					<span class="stat-dot tone-anon" aria-hidden="true"></span>
				</div>
				<div class="stat-value">{stats.anonymous}</div>
				<div class="stat-hint">Identity hidden</div>
			</div>
			<div class="stat-card card">
				<div class="stat-top">
					<span class="stat-label">Avg. score</span>
					<span class="stat-dot tone-success" aria-hidden="true"></span>
				</div>
				<div class="stat-value">{stats.avgScore || '—'}</div>
				<div class="stat-hint">Across all six dimensions</div>
			</div>
		</div>

		<!-- Filters -->
		<div class="filters card">
			<div class="filter-group">
				<label class="filter-label" for="search">Search</label>
				<div class="search-wrap">
					<svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.8"/>
						<path d="M21 21l-4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
					</svg>
					<input
						id="search"
						class="input search-input"
						type="search"
						placeholder="Search comments…"
						bind:value={search}
					/>
				</div>
			</div>

			<div class="filter-group">
				<label class="filter-label" for="period-filter">Cycle</label>
				<select id="period-filter" class="input" bind:value={periodFilter}>
					<option value="all">All cycles</option>
					{#each periods as p}
						<option value={p.id}>{p.name}</option>
					{/each}
				</select>
			</div>

			<div class="filter-group">
				<span class="filter-label">Visibility</span>
				<div class="segmented">
					<button
						type="button"
						class="seg-btn"
						class:active={visibilityFilter === 'all'}
						onclick={() => (visibilityFilter = 'all')}
					>All</button>
					<button
						type="button"
						class="seg-btn"
						class:active={visibilityFilter === 'named'}
						onclick={() => (visibilityFilter = 'named')}
					>Named</button>
					<button
						type="button"
						class="seg-btn"
						class:active={visibilityFilter === 'anonymous'}
						onclick={() => (visibilityFilter = 'anonymous')}
					>Anonymous</button>
				</div>
			</div>

			{#if hasFilters}
				<button type="button" class="btn btn-secondary btn-sm clear-btn" onclick={resetFilters}>
					Clear filters
				</button>
			{/if}
		</div>

		<!-- Feedback list -->
		{#if filtered.length === 0}
			<div class="card state-card">
				<div class="empty-icon" aria-hidden="true">
					<svg width="44" height="44" viewBox="0 0 48 48" fill="none">
						<circle cx="24" cy="24" r="22" fill="#f1f3f7" />
						<path d="M16 18h16M16 24h16M16 30h10" stroke="#8b94a6" stroke-width="2" stroke-linecap="round" opacity="0.6"/>
					</svg>
				</div>
				<h2>{feedbacks.length === 0 ? 'No feedback yet' : 'No matches'}</h2>
				<p class="state-text">
					{feedbacks.length === 0
						? "When your teammates share feedback about you, it'll show up here."
						: 'Try adjusting your filters or search.'}
				</p>
				{#if hasFilters}
					<button type="button" class="btn btn-secondary" onclick={resetFilters}>Clear filters</button>
				{/if}
			</div>
		{:else}
			<ul class="feedback-list">
				{#each filtered as f (f.id)}
					{@const expanded = expandedId === f.id}
					{@const avg = averageScore(f)}
					{@const reviewer = reviewerLabel(f)}
					<li class="feedback-card card" class:expanded>
						<button
							type="button"
							class="fb-summary"
							onclick={() => toggleExpand(f.id)}
							aria-expanded={expanded}
						>
							<div class="fb-avatar" style="background:{colorFor(f.reviewer_id || f.id)}">
								{reviewer === 'Anonymous' ? '?' : initials(reviewer)}
							</div>
							<div class="fb-main">
								<div class="fb-row">
									<span class="fb-from">From {reviewer}</span>
									<span class="badge {f.visibility === 'named' ? 'badge-named' : 'badge-anon'}">
										{f.visibility}
									</span>
								</div>
								<div class="fb-meta">
									<span>{periodLabel(f)}</span>
									<span class="fb-sep">·</span>
									<span>{formatDate(f.created_at)}</span>
								</div>
								{#if !expanded}
									<p class="fb-excerpt">{f.strengths_comment}</p>
								{/if}
							</div>
							<div class="fb-score" style="background:{scoreColor(avg)}1a; color:{scoreColor(avg)}">
								{avg.toFixed(1)}
							</div>
							<svg class="fb-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
								<path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
							</svg>
						</button>

						{#if expanded}
							<div class="fb-details">
								<div class="score-grid">
									{#each SCORE_FIELDS as field}
										{@const v = f[field.key]}
										<div class="score-cell">
											<div class="score-bar" aria-hidden="true">
												<div class="score-fill" style="width:{(v / 5) * 100}%; background:{scoreColor(v)}"></div>
											</div>
											<div class="score-info">
												<span class="score-name">{field.label}</span>
												<span class="score-num">{v}/5</span>
											</div>
										</div>
									{/each}
								</div>

								<div class="comment-block">
									<div class="comment-label">Strengths</div>
									<p class="comment-text">{f.strengths_comment}</p>
								</div>
								<div class="comment-block">
									<div class="comment-label">Areas to grow</div>
									<p class="comment-text">{f.weaknesses_comment}</p>
								</div>
							</div>
						{/if}
					</li>
				{/each}
			</ul>

			{#if nextCursor}
				<div class="load-more-wrap">
					<button type="button" class="btn btn-secondary" onclick={loadMore} disabled={loadingMore}>
						{#if loadingMore}
							<span class="spinner" aria-hidden="true"></span>
							Loading…
						{:else}
							Load more
						{/if}
					</button>
				</div>
			{/if}
		{/if}
	{/if}
</div>

<style>
	.page {
		max-width: 920px;
		margin: 0 auto;
	}

	.page-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: var(--space-4);
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

	.state-text {
		color: var(--color-text-muted);
		font-size: 14px;
		max-width: 42ch;
	}

	.state-card h2 {
		font-size: 18px;
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

	/* Filters */
	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: var(--space-4);
		margin-bottom: var(--space-5);
		padding: var(--space-4) var(--space-5);
	}

	.filter-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.filter-group:nth-child(1) {
		flex: 1 1 220px;
	}

	.filter-group:nth-child(2) {
		flex: 1 1 180px;
	}

	.filter-label {
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-subtle);
	}

	.search-wrap {
		position: relative;
	}

	.search-icon {
		position: absolute;
		left: 10px;
		top: 50%;
		transform: translateY(-50%);
		color: var(--color-text-subtle);
		pointer-events: none;
	}

	.search-input {
		width: 100%;
		padding-left: 36px;
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

	.btn-sm {
		height: 32px;
		padding: 0 var(--space-3);
		font-size: 12px;
	}

	.clear-btn {
		margin-left: auto;
		align-self: flex-end;
	}

	/* Feedback list */
	.feedback-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.feedback-card {
		padding: 0;
		transition: border-color var(--transition-fast);
	}

	.feedback-card.expanded {
		border-color: var(--color-primary);
	}

	.fb-summary {
		display: grid;
		grid-template-columns: 40px 1fr 48px 22px;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
		padding: var(--space-4) var(--space-5);
		background: transparent;
		border: none;
		cursor: pointer;
		text-align: left;
		border-radius: var(--radius-lg);
	}

	.fb-summary:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: -2px;
	}

	.fb-avatar {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		color: #fff;
		font-size: 13px;
		font-weight: 700;
		flex-shrink: 0;
	}

	.fb-main {
		min-width: 0;
	}

	.fb-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.fb-from {
		font-weight: 600;
		font-size: 14px;
	}

	.fb-meta {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-top: 2px;
		font-size: 12px;
		color: var(--color-text-subtle);
	}

	.fb-sep {
		opacity: 0.5;
	}

	.fb-excerpt {
		margin-top: var(--space-2);
		font-size: 13px;
		color: var(--color-text-muted);
		line-height: 1.5;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.badge-named {
		background: #eef2ff;
		color: #4338ca;
	}

	.badge-anon {
		background: var(--color-surface-2);
		color: var(--color-text-muted);
	}

	.fb-score {
		width: 48px;
		height: 48px;
		border-radius: 12px;
		display: grid;
		place-items: center;
		font-size: 15px;
		font-weight: 700;
		flex-shrink: 0;
	}

	.fb-chevron {
		color: var(--color-text-subtle);
		transition: transform var(--transition-fast);
	}

	.feedback-card.expanded .fb-chevron {
		transform: rotate(180deg);
	}

	/* Details */
	.fb-details {
		padding: 0 var(--space-5) var(--space-5);
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		border-top: 1px solid var(--color-border);
		margin: 0 var(--space-2);
		padding-top: var(--space-4);
	}

	.score-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: var(--space-4) var(--space-6);
	}

	.score-cell {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
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

	.score-info {
		display: flex;
		justify-content: space-between;
		font-size: 13px;
	}

	.score-name {
		color: var(--color-text-muted);
	}

	.score-num {
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.comment-block {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.comment-label {
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-subtle);
	}

	.comment-text {
		font-size: 14px;
		line-height: 1.6;
		color: var(--color-text);
		white-space: pre-wrap;
		margin: 0;
	}

	/* Load more */
	.load-more-wrap {
		display: flex;
		justify-content: center;
		margin-top: var(--space-6);
	}

	.spinner {
		width: 16px;
		height: 16px;
		border: 2px solid rgba(255, 255, 255, 0.45);
		border-top-color: #fff;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
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

	@media (max-width: 900px) {
		.stats-grid {
			grid-template-columns: repeat(2, 1fr);
		}
		.filters {
			flex-direction: column;
			align-items: stretch;
		}
		.clear-btn {
			margin-left: 0;
			align-self: flex-start;
		}
	}

	@media (max-width: 560px) {
		.score-grid {
			grid-template-columns: 1fr;
		}
		.fb-summary {
			grid-template-columns: 36px 1fr 44px 18px;
			padding: var(--space-3) var(--space-4);
		}
		.fb-score {
			width: 44px;
			height: 44px;
			font-size: 14px;
		}
	}
</style>
