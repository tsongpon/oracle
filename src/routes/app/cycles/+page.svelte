<script lang="ts">
	import { auth } from '$lib/auth.svelte';
	import {
		ApiClientError,
		listFeedbackPeriods,
		createFeedbackPeriod,
		type FeedbackPeriod
	} from '$lib/auth/auth';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	let periods = $state<FeedbackPeriod[]>([]);
	let loading = $state(true);
	let loadError = $state<string | null>(null);

	const isAdmin = $derived(auth.user?.role === 'org_admin');

	let showForm = $state(false);

	let name = $state('');
	let startDate = $state('');
	let endDate = $state('');
	let submitting = $state(false);
	let formError = $state<string | null>(null);

	type FieldErrors = Partial<Record<'name' | 'start_date' | 'end_date', string>>;
	let fieldErrors = $state<FieldErrors>({});

	const currentUser = $derived(auth.user);

	onMount(async () => {
		if (!auth.isAuthenticated) {
			goto('/login', { replaceState: true });
			return;
		}
		// Re-hydrate from /me so a stale cached user (e.g. from before the
		// `role` field existed) gets refreshed before we gate on isAdmin.
		await auth.hydrate();
		await loadPeriods();
	});

	async function loadPeriods() {
		loading = true;
		loadError = null;
		try {
			const token = auth.token;
			if (!token) {
				goto('/login', { replaceState: true });
				return;
			}
			const res = await listFeedbackPeriods(token);
			periods = res.periods;
		} catch (err) {
			if (err instanceof ApiClientError) {
				if (err.code === 'unauthorized') {
					await auth.logout();
					goto('/login', { replaceState: true });
					return;
				}
				loadError = err.message || 'Could not load feedback periods.';
			} else {
				loadError = 'Could not load feedback periods.';
			}
		} finally {
			loading = false;
		}
	}

	function validate(): FieldErrors {
		const errs: FieldErrors = {};
		if (!name.trim()) errs.name = 'name is required';
		if (!startDate) errs.start_date = 'start date is required';
		if (!endDate) errs.end_date = 'end date is required';
		if (startDate && endDate) {
			const s = new Date(startDate).getTime();
			const e = new Date(endDate).getTime();
			if (Number.isNaN(s)) errs.start_date = 'Please enter a valid start date.';
			if (Number.isNaN(e)) errs.end_date = 'Please enter a valid end date.';
			if (!errs.start_date && !errs.end_date && e <= s) {
				errs.end_date = 'end_date must be after start_date';
			}
		}
		return errs;
	}

	function mapServerMessageToField(message: string): FieldErrors {
		const m = message.toLowerCase();
		const errs: FieldErrors = {};
		if (m.includes('name is required') || m.includes('name')) errs.name = 'name is required';
		else if (m.includes('start_date')) errs.start_date = 'start date is required';
		else if (m.includes('end_date must be after'))
			errs.end_date = 'end_date must be after start_date';
		else if (m.includes('end_date')) errs.end_date = 'end date is required';
		return errs;
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (submitting) return;

		formError = null;
		const errs = validate();
		fieldErrors = errs;
		if (Object.keys(errs).length > 0) return;

		submitting = true;
		try {
			const token = auth.token;
			if (!token) {
				await auth.logout();
				goto('/login', { replaceState: true });
				return;
			}
			const period = await createFeedbackPeriod(token, {
				name: name.trim(),
				start_date: new Date(startDate).toISOString(),
				end_date: new Date(endDate).toISOString()
			});
			periods = [period, ...periods];
			resetForm();
			showForm = false;
		} catch (err) {
			if (err instanceof ApiClientError) {
				switch (err.code) {
					case 'bad_request':
						if (err.message === 'invalid request body' || err.message === '') {
							formError = 'Please check your input and try again.';
						} else {
							const mapped = mapServerMessageToField(err.message);
							if (Object.keys(mapped).length > 0) {
								fieldErrors = { ...fieldErrors, ...mapped };
							} else {
								formError = err.message;
							}
						}
						break;
					case 'unauthorized':
						await auth.logout();
						goto('/login', { replaceState: true });
						return;
					case 'network':
						formError = 'Could not reach the server. Check your connection and try again.';
						break;
					case 'server':
					case 'unknown':
					default:
						formError = 'Something went wrong. Please try again.';
						break;
				}
			} else {
				formError = 'Something went wrong. Please try again.';
			}
		} finally {
			submitting = false;
		}
	}

	function resetForm() {
		name = '';
		startDate = '';
		endDate = '';
		fieldErrors = {};
		formError = null;
	}

	function clearFieldError(field: keyof FieldErrors) {
		if (fieldErrors[field]) {
			fieldErrors = { ...fieldErrors, [field]: undefined };
		}
		formError = null;
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

	function periodStatus(p: FeedbackPeriod): { label: string; cls: string } {
		const now = Date.now();
		const start = new Date(p.start_date).getTime();
		const end = new Date(p.end_date).getTime();
		if (now < start) return { label: 'Upcoming', cls: 'badge-warning' };
		if (now > end) return { label: 'Closed', cls: 'badge-muted' };
		return { label: 'Active', cls: 'badge-success' };
	}

	// Convert an ISO datetime-local input value to yyyy-MM-dd for the native
	// date input min/max attributes.
	function toDateInput(iso: string): string {
		try {
			return new Date(iso).toISOString().slice(0, 10);
		} catch {
			return '';
		}
	}
</script>

<svelte:head>
	<title>Feedback cycles · 360 Feedback</title>
</svelte:head>

<div class="page">
	<div class="page-head">
		<div class="page-head-text">
			<h1>Feedback cycles</h1>
			<p class="page-sub">
				{#if isAdmin}
					Create and track the windows during which your team collects feedback.
				{:else}
					Review the feedback periods open for your organization.
				{/if}
			</p>
		</div>
		{#if isAdmin && !loading && !loadError}
			<button
				type="button"
				class="btn btn-primary"
				onclick={() => {
					showForm = !showForm;
					if (!showForm) resetForm();
				}}
			>
				{#if showForm}
					Cancel
				{:else}
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
						<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
					</svg>
					New cycle
				{/if}
			</button>
		{/if}
	</div>

	{#if isAdmin && showForm}
		<form class="card form-card" onsubmit={handleSubmit} novalidate>
			<div class="form-head">
				<h2>New feedback cycle</h2>
				<p>Open a new window for your organization to collect peer feedback.</p>
			</div>

			{#if formError}
				<div class="alert" role="alert">
					<svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
						<path d="M10 1.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17zM10 6v5M10 14.5v.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
					</svg>
					<span>{formError}</span>
				</div>
			{/if}

			<div class="field">
				<label class="field-label" for="name">Cycle name</label>
				<input
					id="name"
					class="input"
					type="text"
					placeholder="e.g. H2 2026"
					bind:value={name}
					oninput={() => clearFieldError('name')}
					aria-invalid={!!fieldErrors.name}
					aria-describedby={fieldErrors.name ? 'name-error' : undefined}
					disabled={submitting}
					required
				/>
				{#if fieldErrors.name}
					<span id="name-error" class="field-error">{fieldErrors.name}</span>
				{/if}
			</div>

			<div class="field-row">
				<div class="field">
					<label class="field-label" for="start_date">Start date</label>
					<input
						id="start_date"
						class="input"
						type="date"
						bind:value={startDate}
						oninput={() => clearFieldError('start_date')}
						aria-invalid={!!fieldErrors.start_date}
						aria-describedby={fieldErrors.start_date ? 'start_date-error' : undefined}
						disabled={submitting}
						required
					/>
					{#if fieldErrors.start_date}
						<span id="start_date-error" class="field-error">{fieldErrors.start_date}</span>
					{/if}
				</div>

				<div class="field">
					<label class="field-label" for="end_date">End date</label>
					<input
						id="end_date"
						class="input"
						type="date"
						bind:value={endDate}
						oninput={() => clearFieldError('end_date')}
						aria-invalid={!!fieldErrors.end_date}
						aria-describedby={fieldErrors.end_date ? 'end_date-error' : undefined}
						disabled={submitting}
						min={startDate ? toDateInput(startDate) : undefined}
						required
					/>
					{#if fieldErrors.end_date}
						<span id="end_date-error" class="field-error">{fieldErrors.end_date}</span>
					{/if}
				</div>
			</div>

			<div class="form-actions">
				<button type="button" class="btn btn-secondary" onclick={() => { showForm = false; resetForm(); }} disabled={submitting}>
					Cancel
				</button>
				<button type="submit" class="btn btn-primary" disabled={submitting}>
					{#if submitting}
						<span class="spinner" aria-hidden="true"></span>
						Creating…
					{:else}
						Create cycle
					{/if}
				</button>
			</div>
		</form>
	{/if}

	{#if loading}
		<div class="card state-card">
			<div class="spinner-lg" aria-label="Loading"></div>
			<p class="state-text">Loading feedback cycles…</p>
		</div>
	{:else if loadError}
		<div class="card state-card">
			<div class="alert" role="alert">
				<svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
					<path d="M10 1.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17zM10 6v5M10 14.5v.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
				</svg>
				<span>{loadError}</span>
			</div>
			<button type="button" class="btn btn-secondary" onclick={loadPeriods}>Try again</button>
		</div>
	{:else if periods.length === 0}
		<div class="card state-card">
			<div class="empty-icon" aria-hidden="true">
				<svg width="44" height="44" viewBox="0 0 48 48" fill="none">
					<circle cx="24" cy="24" r="22" fill="#f1f3f7" />
					<path d="M20 26a8 8 0 118 0" stroke="#8b94a6" stroke-width="2" stroke-linecap="round" opacity="0.6"/>
					<path d="M24 18v4l3 2" stroke="#8b94a6" stroke-width="2" stroke-linecap="round" opacity="0.6"/>
				</svg>
			</div>
			<h2>No feedback cycles yet</h2>
			<p class="state-text">
				{#if isAdmin}
					Open your first feedback cycle to start collecting peer feedback.
				{:else}
					Your organization hasn't opened a feedback cycle yet. Check back later.
				{/if}
			</p>
			{#if isAdmin}
				<button type="button" class="btn btn-primary" onclick={() => (showForm = true)}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
						<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
					</svg>
					New cycle
				</button>
			{/if}
		</div>
	{:else}
		<div class="cycles-grid">
			{#each periods as p (p.id)}
				{@const status = periodStatus(p)}
				<div class="cycle-card card" class:active={status.label === 'Active'}>
					<div class="cycle-card-head">
						<div class="cycle-card-name">{p.name}</div>
						<span class="badge {status.cls}">{status.label}</span>
					</div>
					<div class="cycle-card-dates">
						<span class="date-label">Window</span>
						<span class="date-value">{formatDate(p.start_date)} → {formatDate(p.end_date)}</span>
					</div>
					<div class="cycle-card-meta">
						<span>Created {formatDate(p.created_at)}</span>
						<span class="org-name">{p.organization_name}</span>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.page {
		max-width: 1100px;
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

	.form-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		margin-bottom: var(--space-6);
		max-width: 640px;
	}

	.form-head h2 {
		font-size: 18px;
	}

	.form-head p {
		margin-top: var(--space-2);
		color: var(--color-text-muted);
		font-size: 13px;
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

	.field-error {
		font-size: 12px;
		color: var(--color-danger);
		font-weight: 500;
	}

	.field-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-4);
	}

	.form-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-3);
		margin-top: var(--space-2);
	}

	.spinner {
		width: 16px;
		height: 16px;
		border: 2px solid rgba(255, 255, 255, 0.45);
		border-top-color: #fff;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}

	.state-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-4);
		text-align: center;
		padding: var(--space-12) var(--space-8);
	}

	.state-card .alert {
		max-width: 480px;
		text-align: left;
	}

	.state-text {
		color: var(--color-text-muted);
		font-size: 14px;
		max-width: 42ch;
	}

	.state-card h2 {
		font-size: 18px;
	}

	.spinner-lg {
		width: 32px;
		height: 32px;
		border: 3px solid var(--color-border);
		border-top-color: var(--color-primary);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	.empty-icon {
		margin-bottom: var(--space-2);
	}

	.cycles-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--space-4);
	}

	.cycle-card {
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
		font-weight: 700;
		font-size: 16px;
	}

	.badge-warning {
		background: #fff5e0;
		color: #b76b00;
	}

	.cycle-card-dates {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--space-3) 0;
		border-top: 1px solid var(--color-border);
		border-bottom: 1px solid var(--color-border);
	}

	.cycle-card.active .cycle-card-dates {
		border-color: rgba(79, 70, 229, 0.2);
	}

	.date-label {
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-subtle);
	}

	.date-value {
		font-size: 14px;
		font-weight: 600;
		color: var(--color-text);
	}

	.cycle-card-meta {
		display: flex;
		justify-content: space-between;
		font-size: 12px;
		color: var(--color-text-muted);
	}

	.cycle-card.active .cycle-card-meta {
		color: var(--color-text-muted);
	}

	.org-name {
		font-weight: 600;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (max-width: 900px) {
		.cycles-grid {
			grid-template-columns: repeat(2, 1fr);
		}
		.page-head {
			flex-direction: column;
		}
	}

	@media (max-width: 560px) {
		.cycles-grid {
			grid-template-columns: 1fr;
		}
		.field-row {
			grid-template-columns: 1fr;
		}
		.form-actions {
			flex-direction: column-reverse;
		}
		.form-actions .btn {
			width: 100%;
		}
	}
</style>