<script lang="ts">
	import { auth } from '$lib/auth.svelte';
	import {
		ApiClientError,
		listEmployees,
		listFeedbackPeriods,
		createFeedback,
		type Employee,
		type FeedbackPeriod,
		type FeedbackVisibility
	} from '$lib/auth/auth';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	type ScoreField =
		| 'communication_score'
		| 'leadership_score'
		| 'technical_score'
		| 'collaboration_score'
		| 'delivery_score'
		| 'trust_score';

	const SCORE_FIELDS: { key: ScoreField; label: string; hint: string }[] = [
		{ key: 'communication_score', label: 'Communication', hint: 'Clarity and responsiveness' },
		{ key: 'leadership_score', label: 'Leadership', hint: 'Guiding and mentoring others' },
		{ key: 'technical_score', label: 'Technical', hint: 'Skill and quality of work' },
		{ key: 'collaboration_score', label: 'Collaboration', hint: 'Working well with the team' },
		{ key: 'delivery_score', label: 'Delivery', hint: 'Following through on commitments' },
		{ key: 'trust_score', label: 'Trust', hint: 'Reliability and integrity' }
	];

	const VISIBILITY_OPTIONS: { value: FeedbackVisibility; label: string; desc: string }[] = [
		{ value: 'private', label: 'Private', desc: 'Only you and managers can see this' },
		{ value: 'manager_only', label: 'Manager only', desc: 'Visible to the reviewee\'s manager' },
		{ value: 'public', label: 'Public', desc: 'Shared with the reviewee and the team' }
	];

	let employees = $state<Employee[]>([]);
	let periods = $state<FeedbackPeriod[]>([]);
	let loading = $state(true);
	let loadError = $state<string | null>(null);

	let periodId = $state('');
	let revieweeId = $state('');
	let scores = $state<Record<ScoreField, number>>({
		communication_score: 0,
		leadership_score: 0,
		technical_score: 0,
		collaboration_score: 0,
		delivery_score: 0,
		trust_score: 0
	});
	let strengthsComment = $state('');
	let weaknessesComment = $state('');
	let visibility = $state<FeedbackVisibility>('private');

	let submitting = $state(false);
	let formError = $state<string | null>(null);
	let submitted = $state(false);

	type FieldErrors = Partial<
		Record<'period_id' | 'reviewee_id' | ScoreField | 'form', string>
	>;
	let fieldErrors = $state<FieldErrors>({});

	const currentUser = $derived(auth.user);

	onMount(async () => {
		if (!auth.isAuthenticated) {
			goto('/login', { replaceState: true });
			return;
		}
		await loadOptions();
	});

	async function loadOptions() {
		loading = true;
		loadError = null;
		try {
			const token = auth.token;
			if (!token) {
				goto('/login', { replaceState: true });
				return;
			}
			// Fetch all employees (paginate) and periods in parallel.
			const [allEmployees, periodsRes] = await Promise.all([
				fetchAllEmployees(token),
				listFeedbackPeriods(token)
			]);
			// Filter out the current user (no self-review, per spec).
			employees = allEmployees.filter((e) => e.id !== currentUser?.id);
			periods = periodsRes.periods;
			// Preselect the most recent period (list is already start_date desc).
			if (periods.length > 0) periodId = periods[0].id;
		} catch (err) {
			if (err instanceof ApiClientError) {
				if (err.code === 'unauthorized') {
					await auth.logout();
					goto('/login', { replaceState: true });
					return;
				}
				loadError = err.message || 'Could not load feedback options.';
			} else {
				loadError = 'Could not load feedback options.';
			}
		} finally {
			loading = false;
		}
	}

	async function fetchAllEmployees(token: string): Promise<Employee[]> {
		const out: Employee[] = [];
		let cursor: string | null = null;
		// Safety cap to avoid an infinite loop on a misbehaving server.
		for (let i = 0; i < 50; i++) {
			const page = await listEmployees(token, { limit: 100, cursor: cursor ?? undefined });
			out.push(...page.employees);
			cursor = page.next_cursor;
			if (!cursor) break;
		}
		return out;
	}

	function validate(): FieldErrors {
		const errs: FieldErrors = {};
		if (!periodId) errs.period_id = 'Select a feedback period.';
		if (!revieweeId) errs.reviewee_id = 'Choose a colleague to review.';
		for (const f of SCORE_FIELDS) {
			const v = scores[f.key];
			if (!Number.isInteger(v) || v < 1 || v > 5) {
				errs[f.key] = 'Pick a score from 1 to 5.';
			}
		}
		return errs;
	}

	function mapServerMessageToField(message: string): FieldErrors {
		const m = message.toLowerCase();
		const errs: FieldErrors = {};
		if (m.includes('period_id')) {
			if (m.includes('does not refer') || m.includes('existing')) {
				errs.period_id = 'This feedback period is no longer available.';
			} else {
				errs.period_id = 'Select a feedback period.';
			}
		} else if (m.includes('reviewee_id')) {
			if (m.includes('differ') || m.includes('self')) {
				errs.reviewee_id = 'You cannot review yourself.';
			} else {
				errs.reviewee_id = 'Choose a colleague to review.';
			}
		} else {
			for (const f of SCORE_FIELDS) {
				if (m.includes(f.key)) {
					errs[f.key] = 'Pick a score from 1 to 5.';
					return errs;
				}
			}
		}
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
			await createFeedback(token, {
				period_id: periodId,
				reviewee_id: revieweeId,
				communication_score: scores.communication_score,
				leadership_score: scores.leadership_score,
				technical_score: scores.technical_score,
				collaboration_score: scores.collaboration_score,
				delivery_score: scores.delivery_score,
				trust_score: scores.trust_score,
				strengths_comment: strengthsComment.trim(),
				weaknesses_comment: weaknessesComment.trim(),
				visibility
			});
			submitted = true;
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

	function setScore(field: ScoreField, value: number) {
		scores = { ...scores, [field]: value };
		clearFieldError(field);
	}

	function clearFieldError(field: keyof FieldErrors) {
		if (fieldErrors[field]) {
			fieldErrors = { ...fieldErrors, [field]: undefined };
		}
		formError = null;
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

	const reviewee = $derived(employees.find((e) => e.id === revieweeId));
</script>

<svelte:head>
	<title>New feedback · 360 Feedback</title>
</svelte:head>

<div class="page">
	<div class="page-head">
		<a href="/app" class="back-link" aria-label="Back to dashboard">
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
				<path d="M15 12H4m0 0l4-4m-4 4l4 4M14 4h5a1 1 0 011 1v14a1 1 0 01-1 1h-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
			</svg>
			Back
		</a>
		<h1>New feedback</h1>
		<p class="page-sub">Share structured, balanced feedback for a teammate.</p>
	</div>

	{#if submitted}
		<div class="card success-card">
			<div class="success-icon" aria-hidden="true">
				<svg width="40" height="40" viewBox="0 0 48 48" fill="none">
					<circle cx="24" cy="24" r="22" fill="#e7f6ee" />
					<path d="M16 24.5l5.5 5.5L33 17" stroke="#0f9d58" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
			</div>
			<h2>Feedback submitted</h2>
			<p class="success-text">
				Your feedback for <strong>{reviewee?.name ?? 'your teammate'}</strong> has been recorded.
			</p>
			<div class="success-actions">
				<button
					type="button"
					class="btn btn-secondary"
					onclick={() => {
						submitted = false;
						revieweeId = '';
						strengthsComment = '';
						weaknessesComment = '';
						scores = {
							communication_score: 0,
							leadership_score: 0,
							technical_score: 0,
							collaboration_score: 0,
							delivery_score: 0,
							trust_score: 0
						};
						visibility = 'private';
						fieldErrors = {};
						formError = null;
					}}
				>
					Write another
				</button>
				<a href="/app" class="btn btn-primary">Back to dashboard</a>
			</div>
		</div>
	{:else if loading}
		<div class="card state-card">
			<div class="spinner-lg" aria-label="Loading"></div>
			<p class="state-text">Loading feedback options…</p>
		</div>
	{:else if loadError}
		<div class="card state-card">
			<div class="alert" role="alert">
				<svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
					<path d="M10 1.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17zM10 6v5M10 14.5v.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
				</svg>
				<span>{loadError}</span>
			</div>
			<button type="button" class="btn btn-secondary" onclick={loadOptions}>Try again</button>
		</div>
	{:else if periods.length === 0}
		<div class="card state-card">
			<div class="empty-icon" aria-hidden="true">
				<svg width="44" height="44" viewBox="0 0 48 48" fill="none">
					<circle cx="24" cy="24" r="22" fill="#f1f3f7" />
					<path d="M16 26l4 4 12-12" stroke="#8b94a6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.6"/>
				</svg>
			</div>
			<h2>No feedback periods open</h2>
			<p class="state-text">Your organization hasn't opened a feedback period yet. Please check back later.</p>
			<a href="/app" class="btn btn-secondary">Back to dashboard</a>
		</div>
	{:else if employees.length === 0}
		<div class="card state-card">
			<div class="empty-icon" aria-hidden="true">
				<svg width="44" height="44" viewBox="0 0 48 48" fill="none">
					<circle cx="24" cy="24" r="22" fill="#f1f3f7" />
					<circle cx="18" cy="20" r="4" stroke="#8b94a6" stroke-width="2" opacity="0.6"/>
					<path d="M12 32c0-3 3-5 6-5s6 2 6 5" stroke="#8b94a6" stroke-width="2" stroke-linecap="round" opacity="0.6"/>
				</svg>
			</div>
			<h2>No teammates to review</h2>
			<p class="state-text">There are no other members in your organization yet.</p>
			<a href="/app" class="btn btn-secondary">Back to dashboard</a>
		</div>
	{:else}
		<form class="card form-card" onsubmit={handleSubmit} novalidate>
			{#if formError}
				<div class="alert" role="alert">
					<svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
						<path d="M10 1.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17zM10 6v5M10 14.5v.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
					</svg>
					<span>{formError}</span>
				</div>
			{/if}

			<div class="field">
				<label class="field-label" for="period_id">Feedback period</label>
				<select
					id="period_id"
					class="input"
					bind:value={periodId}
					onchange={() => clearFieldError('period_id')}
					aria-invalid={!!fieldErrors.period_id}
					aria-describedby={fieldErrors.period_id ? 'period_id-error' : undefined}
					disabled={submitting}
					required
				>
					{#each periods as p}
						<option value={p.id}>{p.name} · {formatDate(p.start_date)} – {formatDate(p.end_date)}</option>
					{/each}
				</select>
				{#if fieldErrors.period_id}
					<span id="period_id-error" class="field-error">{fieldErrors.period_id}</span>
				{/if}
			</div>

			<div class="field">
				<label class="field-label" for="reviewee_id">Who are you reviewing?</label>
				<select
					id="reviewee_id"
					class="input"
					bind:value={revieweeId}
					onchange={() => clearFieldError('reviewee_id')}
					aria-invalid={!!fieldErrors.reviewee_id}
					aria-describedby={fieldErrors.reviewee_id ? 'reviewee_id-error' : undefined}
					disabled={submitting}
					required
				>
					<option value="">Select a teammate…</option>
					{#each employees as e}
						<option value={e.id}>{e.name} — {e.title}</option>
					{/each}
				</select>
				{#if fieldErrors.reviewee_id}
					<span id="reviewee_id-error" class="field-error">{fieldErrors.reviewee_id}</span>
				{/if}
				{#if reviewee}
					<div class="reviewee-preview">
						<div class="mini-avatar" style="background:{colorFor(reviewee.id)}">
							{initials(reviewee.name)}
						</div>
						<div class="reviewee-meta">
							<span class="reviewee-name">{reviewee.name}</span>
							<span class="reviewee-title">{reviewee.title}</span>
						</div>
					</div>
				{/if}
			</div>

			<div class="section-divider">Scores</div>
			<p class="section-sub">Rate each dimension from 1 (needs growth) to 5 (exceptional).</p>

			<div class="scores-grid">
				{#each SCORE_FIELDS as f}
					<div class="score-field">
						<div class="score-head">
							<span class="score-label">{f.label}</span>
							<span class="score-hint">{f.hint}</span>
						</div>
						<div
							class="score-options"
							role="radiogroup"
							aria-label={f.label}
							aria-describedby={fieldErrors[f.key] ? `${f.key}-error` : undefined}
						>
							{#each [1, 2, 3, 4, 5] as n}
								<button
									type="button"
									class="score-btn"
									class:selected={scores[f.key] === n}
									onclick={() => setScore(f.key, n)}
									aria-pressed={scores[f.key] === n}
									aria-label={`${n}`}
									disabled={submitting}
								>
									{n}
								</button>
							{/each}
						</div>
						{#if fieldErrors[f.key]}
							<span id={`${f.key}-error`} class="field-error">{fieldErrors[f.key]}</span>
						{/if}
					</div>
				{/each}
			</div>

			<div class="section-divider">Comments</div>
			<p class="section-sub">Optional but encouraged — specifics make feedback actionable.</p>

			<div class="field">
				<label class="field-label" for="strengths_comment">
					Strengths <span class="field-optional">(optional)</span>
				</label>
				<textarea
					id="strengths_comment"
					class="input textarea"
					bind:value={strengthsComment}
					rows="3"
					placeholder="What did they do well? Where do they shine?"
					disabled={submitting}
					maxlength="2000"
				></textarea>
			</div>

			<div class="field">
				<label class="field-label" for="weaknesses_comment">
					Areas to grow <span class="field-optional">(optional)</span>
				</label>
				<textarea
					id="weaknesses_comment"
					class="input textarea"
					bind:value={weaknessesComment}
					rows="3"
					placeholder="What could they work on? Be constructive and specific."
					disabled={submitting}
					maxlength="2000"
				></textarea>
			</div>

			<div class="field">
				<span class="field-label">Visibility</span>
				<div class="visibility-options">
					{#each VISIBILITY_OPTIONS as opt}
						<label
							class="visibility-option"
							class:selected={visibility === opt.value}
						>
							<input
								type="radio"
								name="visibility"
								value={opt.value}
								bind:group={visibility}
								disabled={submitting}
							/>
							<span class="visibility-label">{opt.label}</span>
							<span class="visibility-desc">{opt.desc}</span>
						</label>
					{/each}
				</div>
			</div>

			<div class="form-actions">
				<a href="/app" class="btn btn-secondary">Cancel</a>
				<button type="submit" class="btn btn-primary" disabled={submitting}>
					{#if submitting}
						<span class="spinner" aria-hidden="true"></span>
						Submitting…
					{:else}
						Submit feedback
					{/if}
				</button>
			</div>
		</form>
	{/if}
</div>

<style>
	.page {
		max-width: 760px;
		margin: 0 auto;
	}

	.page-head {
		margin-bottom: var(--space-6);
	}

	.back-link {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-size: 13px;
		font-weight: 600;
		color: var(--color-text-muted);
		margin-bottom: var(--space-4);
	}

	.back-link:hover {
		color: var(--color-text);
	}

	.page-head h1 {
		font-size: 26px;
		line-height: 1.2;
	}

	.page-sub {
		margin-top: var(--space-2);
		color: var(--color-text-muted);
		font-size: 14px;
	}

	.card {
		padding: var(--space-8);
	}

	.form-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
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

	.field-optional {
		font-weight: 400;
		color: var(--color-text-subtle);
		font-size: 12px;
	}

	select.input {
		height: 42px;
		padding: 0 var(--space-3);
		appearance: none;
		background-image: url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1.5l5 5 5-5' stroke='%238b94a6' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right var(--space-4) center;
		padding-right: var(--space-8);
	}

	.reviewee-preview {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		background: var(--color-surface-2);
		border-radius: var(--radius-md);
		margin-top: var(--space-2);
	}

	.mini-avatar {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		color: #fff;
		font-size: 11px;
		font-weight: 700;
		flex-shrink: 0;
	}

	.reviewee-meta {
		display: flex;
		flex-direction: column;
	}

	.reviewee-name {
		font-size: 14px;
		font-weight: 600;
	}

	.reviewee-title {
		font-size: 12px;
		color: var(--color-text-subtle);
	}

	.section-divider {
		font-size: 13px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-subtle);
		margin-top: var(--space-2);
	}

	.section-sub {
		font-size: 13px;
		color: var(--color-text-muted);
		margin-top: -var(--space-1);
		margin-bottom: var(--space-2);
	}

	.scores-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: var(--space-5) var(--space-6);
	}

	.score-field {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.score-head {
		display: flex;
		flex-direction: column;
	}

	.score-label {
		font-size: 14px;
		font-weight: 600;
	}

	.score-hint {
		font-size: 12px;
		color: var(--color-text-subtle);
	}

	.score-options {
		display: flex;
		gap: var(--space-2);
	}

	.score-btn {
		width: 40px;
		height: 40px;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border-strong);
		background: var(--color-surface);
		color: var(--color-text-muted);
		font-weight: 600;
		font-size: 14px;
		transition:
			background var(--transition-fast),
			border-color var(--transition-fast),
			color var(--transition-fast),
			box-shadow var(--transition-fast);
	}

	.score-btn:hover:not(:disabled) {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	.score-btn.selected {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: #fff;
		box-shadow: 0 0 0 3px var(--color-primary-soft);
	}

	.score-btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.textarea {
		height: auto;
		min-height: 84px;
		padding: var(--space-3) var(--space-4);
		resize: vertical;
		line-height: 1.5;
		font-family: inherit;
	}

	.visibility-options {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.visibility-option {
		display: grid;
		grid-template-columns: 20px 1fr;
		grid-template-areas: 'radio label' 'radio desc';
		column-gap: var(--space-3);
		row-gap: 0;
		align-items: center;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition:
			border-color var(--transition-fast),
			background var(--transition-fast);
	}

	.visibility-option input {
		grid-area: radio;
		align-self: start;
		margin-top: 4px;
		accent-color: var(--color-primary);
		width: 16px;
		height: 16px;
	}

	.visibility-label {
		grid-area: label;
		font-size: 14px;
		font-weight: 600;
	}

	.visibility-desc {
		grid-area: desc;
		font-size: 12px;
		color: var(--color-text-subtle);
	}

	.visibility-option.selected {
		border-color: var(--color-primary);
		background: var(--color-primary-soft);
	}

	.visibility-option:hover {
		border-color: var(--color-border-strong);
	}

	.visibility-option.selected:hover {
		border-color: var(--color-primary);
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

	.state-card h2 {
		font-size: 18px;
	}

	.success-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--space-3);
		padding: var(--space-12) var(--space-8);
	}

	.success-card h2 {
		font-size: 22px;
	}

	.success-text {
		color: var(--color-text-muted);
		font-size: 14px;
	}

	.success-text strong {
		color: var(--color-text);
		font-weight: 600;
	}

	.success-actions {
		display: flex;
		gap: var(--space-3);
		margin-top: var(--space-3);
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (max-width: 640px) {
		.scores-grid {
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