<script lang="ts">
	import { auth } from '$lib/auth.svelte';
	import { buildRecentFeedback, mockCycles, mockTeammates } from '$lib/mockData';

	const user = $derived(auth.user!);
	const recentFeedback = $derived(buildRecentFeedback(user.name));
	const activeCycle = $derived(mockCycles.find((c) => c.status === 'active') ?? mockCycles[0]);

	const stats = $derived([
		{
			label: 'Pending to write',
			value: recentFeedback.filter((f) => f.status === 'pending').length,
			tone: 'warning' as const,
			hint: `Due ${activeCycle?.dueDate ?? 'soon'}`
		},
		{
			label: 'Drafts in progress',
			value: recentFeedback.filter((f) => f.status === 'draft').length,
			tone: 'muted' as const,
			hint: 'Pick up where you left off'
		},
		{
			label: 'Submitted this cycle',
			value: recentFeedback.filter((f) => f.status === 'submitted').length,
			tone: 'success' as const,
			hint: `${activeCycle?.name ?? 'Current cycle'}`
		},
		{
			label: 'Feedback received',
			value: 12,
			tone: 'muted' as const,
			hint: 'Last 30 days'
		}
	]);

	function categoryColor(c: string) {
		const map: Record<string, string> = {
			collaboration: '#0ea5e9',
			delivery: '#10b981',
			leadership: '#f59e0b',
			craft: '#ec4899'
		};
		return map[c] ?? '#6b7280';
	}

	function statusBadge(s: string) {
		if (s === 'submitted') return { label: 'Submitted', cls: 'badge-success' };
		if (s === 'draft') return { label: 'Draft', cls: 'badge-muted' };
		return { label: 'Pending', cls: 'badge-warning' };
	}

	function cycleProgress(c: { completed: number; total: number }) {
		return Math.round((c.completed / c.total) * 100);
	}

	function initials(name: string) {
		return name
			.split(' ')
			.map((p) => p[0])
			.slice(0, 2)
			.join('')
			.toUpperCase();
	}

	let firstName = $derived(user.name.split(' ')[0]);
</script>

<svelte:head>
	<title>Dashboard · 360 Feedback</title>
</svelte:head>

<section class="hero">
	<div class="hero-text">
		<h1>Hi {firstName}, welcome back 👋</h1>
		<p>
			You have <strong>{stats[0].value}</strong> feedback drafts to finish and
			<strong>{stats[2].value}</strong> already submitted in the {activeCycle?.name ?? 'current'} cycle.
		</p>
	</div>
	<div class="hero-cycle">
		<div class="cycle-row">
			<span class="cycle-label">Active cycle</span>
			<span class="badge badge-success">On track</span>
		</div>
		<div class="cycle-name">{activeCycle?.name}</div>
		<div class="cycle-progress">
			<div class="cycle-bar">
				<div class="cycle-bar-fill" style="width:{cycleProgress(activeCycle)}%"></div>
			</div>
			<div class="cycle-meta">
				<span>{activeCycle?.completed}/{activeCycle?.total} complete</span>
				<span>Due {activeCycle?.dueDate}</span>
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
				<p class="panel-sub">What you've shared with teammates this cycle</p>
			</div>
			<a href="/app/feedback" class="panel-link">View all →</a>
		</div>
		<ul class="feed-list">
			{#each recentFeedback as item}
				<li class="feed-item">
					<div class="feed-avatar" style="background:{item.fromColor}">
						{initials(item.from)}
					</div>
					<div class="feed-body">
						<div class="feed-row">
							<span class="feed-to">To {item.toName}</span>
							<span class="badge {statusBadge(item.status).cls}">{statusBadge(item.status).label}</span>
						</div>
						<p class="feed-excerpt">“{item.excerpt}”</p>
						<div class="feed-meta">
							<span class="feed-cat" style="color:{categoryColor(item.category)}">
								<span class="cat-dot" style="background:{categoryColor(item.category)}"></span>
								{item.category}
							</span>
							<span class="feed-sep">·</span>
							<span>{item.submittedAt}</span>
							<span class="feed-sep">·</span>
							<span>{item.cycle}</span>
						</div>
					</div>
				</li>
			{/each}
		</ul>
	</div>

	<div class="panel card">
		<div class="panel-head">
			<div>
				<h2 class="panel-title">Your teammates</h2>
				<p class="panel-sub">Quick feedback in one click</p>
			</div>
			<a href="/app/team" class="panel-link">See team →</a>
		</div>
		<ul class="team-list">
			{#each mockTeammates as mate}
				<li class="team-item">
					<div class="team-avatar" style="background:{mate.avatarColor}">
						{initials(mate.name)}
					</div>
					<div class="team-meta">
						<div class="team-name">{mate.name}</div>
						<div class="team-role">{mate.role} · {mate.team}</div>
					</div>
					<div class="team-stats">
						<span title="Feedback given">{mate.feedbackGiven}↑</span>
						<span title="Feedback received">{mate.feedbackReceived}↓</span>
					</div>
					<button class="btn btn-secondary team-btn">Give feedback</button>
				</li>
			{/each}
		</ul>
	</div>
</section>

<section class="panel card">
	<div class="panel-head">
		<div>
			<h2 class="panel-title">Feedback cycles</h2>
			<p class="panel-sub">Track review cycles across the year</p>
		</div>
		<a href="/app/cycles" class="panel-link">Manage →</a>
	</div>
	<div class="cycles-grid">
		{#each mockCycles as cycle}
			<div class="cycle-card" class:active={cycle.status === 'active'}>
				<div class="cycle-card-head">
					<div class="cycle-card-name">{cycle.name}</div>
					<span class="badge badge-{cycle.status === 'active' ? 'success' : cycle.status === 'upcoming' ? 'warning' : 'muted'}">
						{cycle.status}
					</span>
				</div>
				<div class="cycle-card-bar">
					<div class="cycle-bar">
						<div
							class="cycle-bar-fill"
							style="width:{cycleProgress(cycle)}%"
						></div>
					</div>
				</div>
				<div class="cycle-card-meta">
					<span>{cycle.completed}/{cycle.total} submitted</span>
					<span>Due {cycle.dueDate}</span>
				</div>
			</div>
		{/each}
	</div>
</section>

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
	}

	.feed-meta {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-top: var(--space-2);
		font-size: 12px;
		color: var(--color-text-subtle);
	}

	.feed-cat {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-weight: 600;
		text-transform: capitalize;
	}

	.cat-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
	}

	.feed-sep {
		opacity: 0.5;
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

	.team-stats {
		display: flex;
		gap: var(--space-3);
		font-size: 12px;
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
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

	.badge-active,
	.badge-closed {
		background: var(--color-surface-2);
		color: var(--color-text-muted);
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
		.team-stats {
			display: none;
		}
	}
</style>