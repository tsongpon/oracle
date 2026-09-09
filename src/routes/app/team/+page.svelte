<script lang="ts">
	import { auth } from '$lib/auth.svelte';
	import {
		ApiClientError,
		assignManager,
		listEmployees,
		type Employee
	} from '$lib/auth/auth';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	let loading = $state(false);
	let pageError = $state<string | null>(null);
	let employees = $state<Employee[]>([]);
	let rowErrors = $state<Record<string, string>>({});
	let savingIds = $state<Set<string>>(new Set());
	let savedId = $state<string | null>(null);
	let search = $state('');

	const isAdmin = $derived(auth.user?.role === 'org_admin');
	const managerNameById = $derived(
		new Map(employees.map((e) => [e.id, e.name]))
	);

	// Case-insensitive filter over name, title, and email.
	const filteredEmployees = $derived.by(() => {
		const q = search.trim().toLowerCase();
		if (!q) return employees;
		return employees.filter((e) =>
			`${e.name} ${e.title} ${e.email}`.toLowerCase().includes(q)
		);
	});

	onMount(async () => {
		if (!auth.isAuthenticated) {
			goto('/login', { replaceState: true });
			return;
		}
		// Re-hydrate so a stale cached user (e.g. role change) gets refreshed.
		await auth.hydrate();
		if (!auth.isAuthenticated) {
			goto('/login', { replaceState: true });
			return;
		}
		await loadEmployees();
	});

	async function loadEmployees() {
		loading = true;
		pageError = null;
		const token = auth.token;
		if (!token) {
			await auth.logout();
			goto('/login', { replaceState: true });
			return;
		}

		try {
			const all: Employee[] = [];
			let cursor: string | undefined;
			// Cursor-loop until exhausted; hard cap to avoid infinite loops.
			for (let i = 0; i < 25; i++) {
				const res = await listEmployees(token, { limit: 100, cursor });
				all.push(...res.employees);
				if (!res.next_cursor) break;
				cursor = res.next_cursor;
			}
			all.sort((a, b) => a.name.localeCompare(b.name));
			employees = all;
		} catch (err) {
			if (err instanceof ApiClientError) {
				switch (err.code) {
					case 'unauthorized':
						await auth.logout();
						goto('/login', { replaceState: true });
						return;
					case 'bad_request':
						// Unknown cursor — retry from scratch.
						employees = [];
						pageError = 'Could not load the team. Please reload the page.';
						break;
					case 'network':
						pageError =
							'Could not reach the server. Check your connection and try again.';
						break;
					default:
						pageError = 'Something went wrong. Please try again.';
						break;
				}
			} else {
				pageError = 'Something went wrong. Please try again.';
			}
		} finally {
			loading = false;
		}
	}

	async function handleManagerChange(employee: Employee, event: Event) {
		const select = event.currentTarget as HTMLSelectElement;
		const raw = select.value || null;
		if (raw === employee.manager_id) return;

		const token = auth.token;
		if (!token) {
			await auth.logout();
			goto('/login', { replaceState: true });
			return;
		}

		rowErrors = { ...rowErrors, [employee.id]: '' };
		savingIds = new Set([...savingIds, employee.id]);

		try {
			const updated = await assignManager(token, employee.id, {
				manager_id: raw
			});
			employees = employees.map((e) => (e.id === updated.id ? updated : e));
			savedId = employee.id;
			setTimeout(() => {
				if (savedId === employee.id) savedId = null;
			}, 2000);
		} catch (err) {
			// Revert the select to the current server-side value.
			select.value = employee.manager_id ?? '';
			if (err instanceof ApiClientError) {
				switch (err.code) {
					case 'forbidden':
						// No longer an admin (or session stale).
						await auth.hydrate();
						if (auth.user?.role !== 'org_admin') {
							goto('/app', { replaceState: true });
							return;
						}
						rowErrors = {
							...rowErrors,
							[employee.id]:
								err.message ||
								'Only organization admins can assign managers.'
						};
						break;
					case 'unauthorized':
						await auth.logout();
						goto('/login', { replaceState: true });
						return;
					case 'bad_request':
						rowErrors = {
							...rowErrors,
							[employee.id]:
								err.message !== 'invalid request body'
									? err.message
									: 'That assignment is not allowed.'
						};
						break;
					case 'network':
						rowErrors = {
							...rowErrors,
							[employee.id]:
								'Could not reach the server. Check your connection and try again.'
						};
						break;
					default:
						rowErrors = {
							...rowErrors,
							[employee.id]: 'Something went wrong. Please try again.'
						};
						break;
				}
			} else {
				rowErrors = {
					...rowErrors,
					[employee.id]: 'Something went wrong. Please try again.'
				};
			}
		} finally {
			const next = new Set(savingIds);
			next.delete(employee.id);
			savingIds = next;
		}
	}

	function initials(name: string): string {
		return name
			.split(' ')
			.map((p) => p[0])
			.slice(0, 2)
			.join('')
			.toUpperCase();
	}

	const AVATAR_COLORS = [
		'#4f46e5',
		'#0ea5e9',
		'#10b981',
		'#f59e0b',
		'#ec4899',
		'#8b5cf6'
	];
	function colorFor(id: string): string {
		let hash = 0;
		for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
		return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
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
</script>

<svelte:head>
	<title>Team · 360 Feedback</title>
</svelte:head>

<div class="page">
	<div class="page-head">
		<div class="page-head-text">
			<h1>Team</h1>
			<p class="page-sub">
				{#if isAdmin}
					Everyone in your organization. Assign each member a manager —
					managers can view the feedback their reportees receive.
				{:else}
					Everyone in your organization and their reporting lines.
				{/if}
			</p>
		</div>
		<div class="page-head-actions">
			<button
				type="button"
				class="btn btn-secondary"
				onclick={loadEmployees}
				disabled={loading}
			>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
					<path d="M20 12a8 8 0 11-2.3-5.6M20 4v3.5h-3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
				</svg>
				{loading ? 'Loading…' : 'Refresh'}
			</button>
		</div>
	</div>

	{#if pageError}
		<div class="alert" role="alert">
			<svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
				<path d="M10 1.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17zM10 6v5M10 14.5v.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
			</svg>
			<span>{pageError}</span>
		</div>
	{/if}

	{#if employees.length > 0}
		<div class="filters card">
			<div class="filter-group">
				<label class="filter-label" for="team-search">Filter</label>
				<div class="search-wrap">
					<svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.8"/>
						<path d="M21 21l-4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
					</svg>
					<input
						id="team-search"
						class="input search-input"
						type="search"
						placeholder="Search by name, title, or email…"
						bind:value={search}
					/>
					{#if search}
						<button
							type="button"
							class="search-clear"
							onclick={() => (search = '')}
							aria-label="Clear search"
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
								<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
							</svg>
						</button>
					{/if}
				</div>
			</div>
			<span class="filter-count">
				{filteredEmployees.length} of {employees.length}
				{employees.length === 1 ? 'member' : 'members'}
			</span>
		</div>
	{/if}

	{#if loading && employees.length === 0}
		<div class="card empty-card">
			<div class="spinner-lg" aria-label="Loading"></div>
			<p class="empty-title">Loading team…</p>
		</div>
	{:else if employees.length === 0}
		<div class="card empty-card">
			<div class="empty-icon" aria-hidden="true">
				<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
					<circle cx="9" cy="8" r="3" stroke="currentColor" stroke-width="1.6"/>
					<path d="M3 20c0-3 3-5 6-5s6 2 6 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
					<circle cx="17" cy="9" r="2.4" stroke="currentColor" stroke-width="1.6"/>
					<path d="M16 14.5c2.5 0 5 1.4 5 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
				</svg>
			</div>
			<p class="empty-title">No team members yet</p>
			<p class="empty-sub">
				Invite teammates to your organization and they will show up here.
			</p>
		</div>
	{:else if filteredEmployees.length === 0}
		<div class="card empty-card">
			<div class="empty-icon" aria-hidden="true">
				<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
					<circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.6"/>
					<path d="M21 21l-4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
				</svg>
			</div>
			<p class="empty-title">No matches</p>
			<p class="empty-sub">
				No members match “{search}”. Try a different search.
			</p>
			<button type="button" class="btn btn-secondary" onclick={() => (search = '')}>
				Clear search
			</button>
		</div>
	{:else}
		<div class="card table-card">
			<div class="table-head grid-row">
				<span>Member</span>
				<span>Role</span>
				<span>Joined</span>
				<span>Manager</span>
			</div>

			{#each filteredEmployees as employee (employee.id)}
				<div class="grid-row member-row">
					<div class="member">
						<div class="avatar" style="background:{colorFor(employee.id)}">
							{initials(employee.name)}
						</div>
						<div class="member-meta">
							<div class="member-name">
								{employee.name}
								{#if auth.user?.id === employee.id}
									<span class="you-badge">You</span>
								{/if}
							</div>
							<div class="member-sub">{employee.title || employee.email}</div>
						</div>
						{#if auth.user?.id !== employee.id}
							<a
								class="btn btn-secondary feedback-btn"
								href="/app/feedback/new?reviewee={encodeURIComponent(employee.id)}"
								title="Give feedback to {employee.name}"
							>
								<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
									<path d="M11 4H5a1 1 0 00-1 1v14a1 1 0 001 1h14a1 1 0 001-1v-6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
									<path d="M18.5 2.5a2.1 2.1 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
								</svg>
								<span class="btn-label">Give feedback</span>
							</a>
						{/if}
					</div>

					<div class="member-role">
						{#if employee.role === 'org_admin'}
							<span class="badge badge-admin">Admin</span>
						{:else}
							<span class="badge">Member</span>
						{/if}
						{#if !employee.is_mail_verified}
							<span class="badge badge-warn" title="Email not verified yet">Unverified</span>
						{/if}
					</div>

					<div class="member-joined">{formatDate(employee.created_at)}</div>

					<div class="member-manager">
						{#if isAdmin}
							<select
								class="input select"
								value={employee.manager_id ?? ''}
								disabled={savingIds.has(employee.id)}
								aria-label="Manager for {employee.name}"
								onchange={(e) => handleManagerChange(employee, e)}
							>
								<option value="">No manager</option>
								{#each employees as candidate (candidate.id)}
									{#if candidate.id !== employee.id}
										<option value={candidate.id}>{candidate.name}</option>
									{/if}
								{/each}
							</select>
							{#if savingIds.has(employee.id)}
								<span class="spinner" aria-hidden="true"></span>
							{:else if savedId === employee.id}
								<svg class="saved-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
									<path d="M5 12l4.5 4.5L19 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
								</svg>
							{/if}
						{:else}
							<span class="manager-label">
								{employee.manager_id
									? managerNameById.get(employee.manager_id) ?? 'Unknown'
									: '—'}
							</span>
						{/if}
					</div>
				</div>

				{#if rowErrors[employee.id]}
					<div class="row-error" role="alert">{rowErrors[employee.id]}</div>
				{/if}
			{/each}
		</div>

		{#if isAdmin}
			<p class="footnote">
				Managers must belong to your organization and the assignment cannot
				create a reporting cycle. Set a member's manager to
				<strong>No manager</strong> to clear it.
			</p>
		{/if}
	{/if}
</div>

<style>
	.page {
		max-width: 960px;
		margin: 0 auto;
	}

	.page-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
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

	.page-head-actions {
		flex-shrink: 0;
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
		margin-bottom: var(--space-6);
	}

	.alert svg {
		flex-shrink: 0;
		margin-top: 2px;
	}

	.card {
		padding: var(--space-6);
	}

	/* Filter bar */
	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--space-4);
		margin-bottom: var(--space-5);
		padding: var(--space-4) var(--space-5);
	}

	.filter-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		flex: 1 1 260px;
		max-width: 420px;
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
		padding-right: 36px;
	}

	.search-clear {
		position: absolute;
		right: 8px;
		top: 50%;
		transform: translateY(-50%);
		width: 22px;
		height: 22px;
		display: grid;
		place-items: center;
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--color-text-subtle);
		cursor: pointer;
		transition: color var(--transition-fast), background var(--transition-fast);
	}

	.search-clear:hover {
		color: var(--color-text);
		background: var(--color-surface-2);
	}

	.filter-count {
		font-size: 12px;
		color: var(--color-text-subtle);
		padding-bottom: var(--space-2);
		white-space: nowrap;
	}

	.table-card {
		display: flex;
		flex-direction: column;
	}

	.grid-row {
		display: grid;
		grid-template-columns: minmax(220px, 1.6fr) minmax(110px, 0.8fr) minmax(90px, 0.6fr) minmax(220px, 1.4fr);
		gap: var(--space-4);
		align-items: center;
		padding: var(--space-4) var(--space-2);
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

	.member-row {
		border-bottom: 1px solid var(--color-border);
	}

	.member-row:last-of-type {
		border-bottom: none;
	}

	.member {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-width: 0;
	}

	.feedback-btn {
		flex-shrink: 0;
		margin-left: auto;
		padding: 6px 11px;
		font-size: 12px;
		gap: 6px;
	}

	.feedback-btn svg {
		flex-shrink: 0;
	}

	.avatar {
		width: 38px;
		height: 38px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		color: #fff;
		font-size: 12px;
		font-weight: 700;
		flex-shrink: 0;
	}

	.member-meta {
		min-width: 0;
	}

	.member-name {
		font-size: 14px;
		font-weight: 600;
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.you-badge {
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-primary);
		background: var(--color-primary-soft);
		padding: 2px 7px;
		border-radius: 999px;
	}

	.member-sub {
		font-size: 12px;
		color: var(--color-text-subtle);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.member-role {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.badge {
		font-size: 11px;
		font-weight: 600;
		padding: 3px 9px;
		border-radius: 999px;
		background: var(--color-surface-2);
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
	}

	.badge-admin {
		background: var(--color-primary-soft);
		color: var(--color-primary);
		border-color: transparent;
	}

	.badge-warn {
		background: #fff7ed;
		color: #b45309;
		border-color: #fde4c0;
	}

	.member-joined {
		font-size: 13px;
		color: var(--color-text-muted);
	}

	.member-manager {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}

	.select {
		width: 100%;
		padding: 7px 10px;
		font-size: 13px;
	}

	.manager-label {
		font-size: 13px;
		color: var(--color-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.spinner {
		width: 14px;
		height: 14px;
		border: 2px solid var(--color-border);
		border-top-color: var(--color-primary);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
		flex-shrink: 0;
	}

	.saved-icon {
		color: #0f9d58;
		flex-shrink: 0;
	}

	.row-error {
		color: var(--color-danger);
		font-size: 12px;
		padding: 0 var(--space-2) var(--space-3);
		margin-top: calc(-1 * var(--space-2));
	}

	.footnote {
		margin-top: var(--space-4);
		font-size: 12px;
		color: var(--color-text-subtle);
		line-height: 1.55;
	}

	.footnote strong {
		color: var(--color-text-muted);
		font-weight: 600;
	}

	.empty-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-10) var(--space-6);
		text-align: center;
	}

	.empty-icon {
		color: var(--color-text-subtle);
	}

	.empty-title {
		font-size: 16px;
		font-weight: 600;
	}

	.empty-sub {
		font-size: 13px;
		color: var(--color-text-muted);
		max-width: 46ch;
	}

	.spinner-lg {
		width: 28px;
		height: 28px;
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

	@media (max-width: 720px) {
		.page-head {
			flex-direction: column;
		}

		.table-head {
			display: none;
		}

		.grid-row {
			grid-template-columns: 1fr 1fr;
			grid-template-areas:
				'member role'
				'joined joined'
				'manager manager';
			row-gap: var(--space-3);
		}

		.member {
			grid-area: member;
		}

		.member-role {
			grid-area: role;
			justify-content: flex-end;
		}

		.member-joined {
			grid-area: joined;
		}

		.member-manager {
			grid-area: manager;
		}
	}
</style>