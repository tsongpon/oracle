<script lang="ts">
	import { auth } from '$lib/auth.svelte';
	import {
		ApiClientError,
		listEmployees,
		listFeedbackPeriods,
		listMyFeedbackRequests,
		createFeedback,
		createFeedbackDraft,
		listMyFeedbackDrafts,
		updateFeedbackDraft,
		deleteFeedbackDraft,
		submitFeedbackDraft,
		type CreateFeedbackDraftRequest,
		type Employee,
		type FeedbackPeriod,
		type FeedbackRequest,
		type FeedbackResponse,
		type FeedbackVisibility,
		type UpdateFeedbackDraftRequest
	} from '$lib/auth/auth';
	import { findActivePeriod, isPeriodActive } from '$lib/periods';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { page } from '$app/state';

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
		{ value: 'named', label: 'Named', desc: 'Your name is shown with this feedback' },
		{ value: 'anonymous', label: 'Anonymous', desc: 'Your identity is hidden from the reviewee' }
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
	let visibility = $state<FeedbackVisibility>('anonymous');

	let submitting = $state(false);
	let formError = $state<string | null>(null);
	let submitted = $state(false);

	// --- Draft state ---
	let drafts = $state<FeedbackResponse[]>([]);
	let draftId = $state<string | null>(null);
	let draftBusy = $state(false);
	let saveStatus = $state<'idle' | 'saved' | 'error'>('idle');

	type FieldErrors = Partial<
		Record<'period_id' | 'reviewee_id' | ScoreField | 'strengths_comment' | 'weaknesses_comment' | 'form', string>
	>;
	let fieldErrors = $state<FieldErrors>({});

	const currentUser = $derived(auth.user);
	const editingDraft = $derived(drafts.find((d) => d.id === draftId) ?? null);
	const otherDrafts = $derived(editingDraft ? drafts.filter((d) => d.id !== draftId) : drafts);

	// The form is blocked unless a period's window is open right now — no
	// point letting the user fill it in only to have the server reject it.
	const activePeriod = $derived(findActivePeriod(periods));
	const selectedPeriod = $derived(periods.find((p) => p.id === periodId) ?? null);
	const periodOpen = $derived(selectedPeriod !== null && isPeriodActive(selectedPeriod));
	// The nearest upcoming period, to tell the user when they can come back.
	const nextPeriod = $derived.by(() => {
		const now = Date.now();
		const upcoming = periods
			.filter((p) => new Date(p.start_date).getTime() > now)
			.sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime());
		return upcoming[0] ?? null;
	});

	// An open request this form is fulfilling: when the page was opened with
	// ?reviewee=<id> and that colleague has an open request to me, show a
	// banner so the user knows their feedback completes the ask.
	let matchingRequest = $state<FeedbackRequest | null>(null);

	// --- Reviewee combobox state ---
	let revieweeQuery = $state('');
	let revieweeOpen = $state(false);
	let revieweeActive = $state(0); // index of the highlighted option

	// Options filtered by the typed query (name, title, email).
	const revieweeOptions = $derived.by(() => {
		const q = revieweeQuery.trim().toLowerCase();
		if (!q) return employees;
		return employees.filter((e) => `${e.name} ${e.title} ${e.email}`.toLowerCase().includes(q));
	});

	const revieweeSearchId = 'reviewee_id';
	const revieweeListId = 'reviewee_id-listbox';
	const revieweeLabel = $derived.by(() => {
		if (!revieweeId) return '';
		const e = employees.find((x) => x.id === revieweeId);
		return e ? `${e.name} — ${e.title}` : '';
	});

	function openReviewee() {
		if (submitting || draftId) return;
		revieweeOpen = true;
		// Seed the query with the selected name so typing continues naturally.
		revieweeQuery = revieweeId && reviewee ? reviewee.name : '';
		revieweeActive = Math.max(0, revieweeOptions.findIndex((e) => e.id === revieweeId));
	}

	function closeReviewee() {
		revieweeOpen = false;
		// Restore the selected teammate's name when the user dismisses without
		// picking (or typed something else).
		revieweeQuery = revieweeId && reviewee ? reviewee.name : '';
	}

	function selectReviewee(id: string) {
		revieweeId = id;
		revieweeOpen = false;
		revieweeQuery = reviewee?.name ?? '';
		clearFieldError('reviewee_id');
	}

	function onRevieweeInput(event: Event) {
		revieweeQuery = (event.currentTarget as HTMLInputElement).value;
		revieweeActive = 0;
		if (!revieweeOpen) revieweeOpen = true;
		clearFieldError('reviewee_id');
	}

	function onRevieweeKeydown(event: KeyboardEvent) {
		if (!revieweeOpen) return;
		const opts = revieweeOptions;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			revieweeActive = Math.min(opts.length - 1, revieweeActive + 1);
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			revieweeActive = Math.max(0, revieweeActive - 1);
		} else if (event.key === 'Enter') {
			// Only when a highlighted option exists; otherwise let the form
			// submit naturally.
			if (opts.length > 0) {
				event.preventDefault();
				selectReviewee(opts[revieweeActive].id);
			}
		} else if (event.key === 'Escape') {
			event.preventDefault();
			closeReviewee();
		}
	}

	function onOptionPointer(i: number) {
		revieweeActive = i;
	}

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
			// Fetch all employees (paginate), periods, my drafts, and my received
			// requests in parallel. The requests feed the "completing X's request"
			// banner when the page was opened from a request; an older backend
			// without the endpoint must not break the form, so failures degrade
			// to "no banner".
			const [allEmployees, periodsRes, draftsRes, receivedRequests] = await Promise.all([
				fetchAllEmployees(token),
				listFeedbackPeriods(token),
				fetchAllDrafts(token),
				fetchAllReceivedRequests(token).catch(() => [] as FeedbackRequest[])
			]);
			// Filter out the current user (no self-review, per spec).
			employees = allEmployees.filter((e) => e.id !== currentUser?.id);
			periods = periodsRes.periods;
			drafts = draftsRes;
			// Preselect the active period; the form is blocked for closed/upcoming
			// ones, so the fallback preselect of the newest period is not needed.
			periodId = findActivePeriod(periods)?.id ?? '';
			// Preselect the reviewee when linked from the team page (?reviewee=<id>).
			const requested = page.url.searchParams.get('reviewee');
			if (requested && employees.some((e) => e.id === requested)) {
				revieweeId = requested;
				// Banner: is this colleague waiting on feedback from me?
				matchingRequest =
					receivedRequests.find(
						(r) => r.status === 'open' && r.requester_id === requested
					) ?? null;
			} else if (requested) {
				// Unknown or self ID — drop the stale param from the URL.
				goto('/app/feedback/new', { replaceState: true, noScroll: true, keepFocus: true });
			}
			// Resume a draft when linked with ?draft=<id>.
			const requestedDraft = page.url.searchParams.get('draft');
			if (requestedDraft) {
				const draft = drafts.find((d) => d.id === requestedDraft);
				if (draft) {
					applyDraft(draft);
				} else {
					// Unknown or already-deleted draft — drop the stale param.
					goto('/app/feedback/new', { replaceState: true, noScroll: true, keepFocus: true });
				}
			}
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

	async function fetchAllReceivedRequests(token: string): Promise<FeedbackRequest[]> {
		const out: FeedbackRequest[] = [];
		let cursor: string | null = null;
		for (let i = 0; i < 50; i++) {
			const page = await listMyFeedbackRequests(token, {
				direction: 'received',
				limit: 100,
				cursor: cursor ?? undefined
			});
			out.push(...page.requests);
			cursor = page.next_cursor;
			if (!cursor) break;
		}
		return out;
	}

	/** Loads a draft into the form for continued editing. */
	function applyDraft(draft: FeedbackResponse) {
		draftId = draft.id;
		periodId = draft.period_id;
		revieweeId = draft.reviewee_id;
		scores = {
			communication_score: draft.communication_score,
			leadership_score: draft.leadership_score,
			technical_score: draft.technical_score,
			collaboration_score: draft.collaboration_score,
			delivery_score: draft.delivery_score,
			trust_score: draft.trust_score
		};
		strengthsComment = draft.strengths_comment;
		weaknessesComment = draft.weaknesses_comment;
		visibility = draft.visibility;
		fieldErrors = {};
		formError = null;
		saveStatus = 'idle';
		if (!page.url.searchParams.has('draft')) {
			goto(`/app/feedback/new?draft=${encodeURIComponent(draft.id)}`, {
				replaceState: true,
				noScroll: true,
				keepFocus: true
			});
		}
	}

	function resetDraftState() {
		draftId = null;
		saveStatus = 'idle';
	}

	/** Validation for saving a draft: only the target is required. */
	function validateDraft(): FieldErrors {
		const errs: FieldErrors = {};
		if (!periodId) errs.period_id = 'Select a feedback period.';
		if (!revieweeId) errs.reviewee_id = 'Choose a colleague to review.';
		return errs;
	}

	/** Shared score/comment/visibility fields for draft create and update. */
	function draftFields(): Omit<CreateFeedbackDraftRequest, 'period_id' | 'reviewee_id'> {
		return {
			communication_score: scores.communication_score || null,
			leadership_score: scores.leadership_score || null,
			technical_score: scores.technical_score || null,
			collaboration_score: scores.collaboration_score || null,
			delivery_score: scores.delivery_score || null,
			trust_score: scores.trust_score || null,
			strengths_comment: strengthsComment.trim(),
			weaknesses_comment: weaknessesComment.trim(),
			visibility
		};
	}

	function buildDraftPayload(): CreateFeedbackDraftRequest {
		return { period_id: periodId, reviewee_id: revieweeId, ...draftFields() };
	}

	function buildDraftUpdatePayload(): UpdateFeedbackDraftRequest {
		// period_id and reviewee_id are fixed once the draft exists.
		return draftFields();
	}

	async function handleSaveDraft() {
		if (draftBusy || submitting) return;
		formError = null;
		const errs = validateDraft();
		fieldErrors = errs;
		if (Object.keys(errs).length > 0) return;

		const token = auth.token;
		if (!token) {
			await auth.logout();
			goto('/login', { replaceState: true });
			return;
		}

		draftBusy = true;
		saveStatus = 'idle';
		try {
			if (draftId) {
				const updated = await updateFeedbackDraft(token, draftId, buildDraftUpdatePayload());
				replaceDraft(updated);
				saveStatus = 'saved';
			} else {
				const created = await createFeedbackDraft(token, buildDraftPayload());
				draftId = created.id;
				replaceDraft(created);
				saveStatus = 'saved';
				if (!page.url.searchParams.has('draft')) {
					goto(`/app/feedback/new?draft=${encodeURIComponent(created.id)}`, {
						replaceState: true,
						noScroll: true,
						keepFocus: true
					});
				}
			}
		} catch (err) {
			if (err instanceof ApiClientError) {
				if (err.code === 'unauthorized') {
					await auth.logout();
					goto('/login', { replaceState: true });
					return;
				}
				if (err.status === 409 && err.message.toLowerCase().includes('already exists')) {
					// One draft per (reviewer, reviewee, period) — apply the current
					// values onto the existing draft instead of losing them.
					const existing = drafts.find(
						(d) => d.period_id === periodId && d.reviewee_id === revieweeId
					);
					if (existing) {
						try {
							const updated = await updateFeedbackDraft(
								token,
								existing.id,
								buildDraftUpdatePayload()
							);
							draftId = updated.id;
							replaceDraft(updated);
							saveStatus = 'saved';
							formError =
								'A draft for this colleague already existed — your changes were saved onto it below.';
						} catch {
							applyDraft(existing);
							saveStatus = 'error';
							formError =
								'You already have a draft for this colleague in this period — it is now open below.';
						}
					} else {
						await refreshDrafts();
						saveStatus = 'error';
						formError = 'You already have a draft for this colleague in this period.';
					}
				} else if (err.status === 409) {
					saveStatus = 'error';
					formError =
						'This draft was modified in another tab or session. Reload to pick up the latest version.';
				} else if (err.code === 'bad_request') {
					const mapped = mapServerMessageToField(err.message);
					if (Object.keys(mapped).length > 0) {
						fieldErrors = { ...fieldErrors, ...mapped };
					} else {
						saveStatus = 'error';
						formError = err.message;
					}
				} else {
					saveStatus = 'error';
					formError = 'Could not save your draft. Please try again.';
				}
			} else {
				saveStatus = 'error';
				formError = 'Could not save your draft. Please try again.';
			}
		} finally {
			draftBusy = false;
		}
	}

	async function refreshDrafts() {
		const token = auth.token;
		if (!token) return;
		try {
			drafts = await fetchAllDrafts(token);
		} catch {
			// Keep the stale list; saving/continuing still works.
		}
	}

	function replaceDraft(draft: FeedbackResponse) {
		const idx = drafts.findIndex((d) => d.id === draft.id);
		if (idx === -1) {
			drafts = [draft, ...drafts];
		} else {
			drafts = drafts.with(idx, draft);
		}
	}

	async function handleDiscardDraft(draft: FeedbackResponse) {
		if (draftBusy) return;
		const label = draftName(draft);
		if (!window.confirm(`Discard your draft feedback for ${label}? This cannot be undone.`)) return;
		draftBusy = true;
		try {
			const token = auth.token;
			if (!token) {
				await auth.logout();
				goto('/login', { replaceState: true });
				return;
			}
			await deleteFeedbackDraft(token, draft.id);
			drafts = drafts.filter((d) => d.id !== draft.id);
			if (draftId === draft.id) {
				resetDraftState();
				clearForm();
				if (page.url.searchParams.has('draft')) {
					goto('/app/feedback/new', { replaceState: true, noScroll: true, keepFocus: true });
				}
			}
		} catch (err) {
			if (err instanceof ApiClientError && err.code === 'unauthorized') {
				await auth.logout();
				goto('/login', { replaceState: true });
				return;
			}
			formError = 'Could not discard the draft. Please try again.';
		} finally {
			draftBusy = false;
		}
	}

	function draftName(draft: FeedbackResponse): string {
		return (
			employees.find((e) => e.id === draft.reviewee_id)?.name ??
			periods.find((p) => p.id === draft.period_id)?.name ??
			'your teammate'
		);
	}

	function draftPeriodName(draft: FeedbackResponse): string {
		return periods.find((p) => p.id === draft.period_id)?.name ?? 'Unknown period';
	}

	function draftProgress(draft: FeedbackResponse): string {
		const filled = SCORE_FIELDS.filter((f) => draft[f.key] > 0).length;
		const comments = [draft.strengths_comment, draft.weaknesses_comment].filter((c) => c.trim())
			.length;
		return `${filled}/6 scores · ${comments}/2 comments`;
	}

	function formatDateTime(iso: string): string {
		try {
			return new Date(iso).toLocaleString(undefined, {
				month: 'short',
				day: 'numeric',
				hour: 'numeric',
				minute: '2-digit'
			});
		} catch {
			return iso;
		}
	}

	function validate(): FieldErrors {
		const errs: FieldErrors = {};
		if (!periodId) errs.period_id = 'Select a feedback period.';
		else if (!periodOpen) errs.period_id = 'This feedback period is not open for submission.';
		if (!revieweeId) errs.reviewee_id = 'Choose a colleague to review.';
		for (const f of SCORE_FIELDS) {
			const v = scores[f.key];
			if (!Number.isInteger(v) || v < 1 || v > 5) {
				errs[f.key] = 'Pick a score from 1 to 5.';
			}
		}
		if (!strengthsComment.trim()) {
			errs.strengths_comment = 'Please share what this person does well.';
		}
		if (!weaknessesComment.trim()) {
			errs.weaknesses_comment = 'Please share where this person could grow.';
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
		} else if (m.includes('strengths_comment') || m.includes('strengths')) {
			errs.strengths_comment = 'Please share what this person does well.';
		} else if (m.includes('weaknesses_comment') || m.includes('weaknesses')) {
			errs.weaknesses_comment = 'Please share where this person could grow.';
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
			if (draftId) {
				// Submitting a draft applies the form values as final edits
				// before the server's full validation runs.
				await submitFeedbackDraft(token, draftId, {
					communication_score: scores.communication_score,
					leadership_score: scores.leadership_score,
					technical_score: scores.technical_score,
					collaboration_score: scores.collaboration_score,
					delivery_score: scores.delivery_score,
					trust_score: scores.trust_score,
					strengths_comment: strengthsComment.replace(/^\s+|\s+$/g, ''),
					weaknesses_comment: weaknessesComment.replace(/^\s+|\s+$/g, ''),
					visibility
				});
				drafts = drafts.filter((d) => d.id !== draftId);
			} else {
				await createFeedback(token, {
					period_id: periodId,
					reviewee_id: revieweeId,
					communication_score: scores.communication_score,
					leadership_score: scores.leadership_score,
					technical_score: scores.technical_score,
					collaboration_score: scores.collaboration_score,
					delivery_score: scores.delivery_score,
					trust_score: scores.trust_score,
					strengths_comment: strengthsComment.replace(/^\s+|\s+$/g, ''),
					weaknesses_comment: weaknessesComment.replace(/^\s+|\s+$/g, ''),
					visibility
				});
			}
			submitted = true;
		} catch (err) {
			if (err instanceof ApiClientError) {
				if (err.status === 422) {
					// Period window not open (draft submit).
					fieldErrors = { ...fieldErrors, period_id: 'This feedback period is not open for submission.' };
					return;
				}
				if (err.status === 409) {
					// Concurrent modification (draft submit).
					formError =
						'This draft was modified in another tab or session. Reload to pick up the latest version.';
					return;
				}
				if (err.status === 404 && draftId) {
					// Draft was submitted or deleted elsewhere.
					const goneId = draftId;
					resetDraftState();
					drafts = drafts.filter((d) => d.id !== goneId);
					formError = 'This draft no longer exists — it may have been submitted or discarded already.';
					return;
				}
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

	function clearForm() {
		revieweeId = '';
		revieweeQuery = '';
		revieweeOpen = false;
		revieweeActive = 0;
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
		visibility = 'anonymous';
		periodId = findActivePeriod(periods)?.id ?? '';
		fieldErrors = {};
		formError = null;
	}

	function clearFieldError(field: keyof FieldErrors) {
		if (fieldErrors[field]) {
			fieldErrors = { ...fieldErrors, [field]: undefined };
		}
		formError = null;
		if (saveStatus === 'saved') saveStatus = 'idle';
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

	/** Display name of the selected reviewee, for the request banner. */
	function revieweeName(): string {
		return reviewee?.name ?? 'your colleague';
	}
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
						resetDraftState();
						clearForm();
						if (page.url.searchParams.has('reviewee') || page.url.searchParams.has('draft')) {
							goto('/app/feedback/new', { replaceState: true, noScroll: true, keepFocus: true });
						}
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
	{:else if !activePeriod}
		<div class="card state-card">
			<div class="empty-icon" aria-hidden="true">
				<svg width="44" height="44" viewBox="0 0 48 48" fill="none">
					<circle cx="24" cy="24" r="22" fill="#f1f3f7" />
					<path d="M16 26l4 4 12-12" stroke="#8b94a6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.6"/>
				</svg>
			</div>
			{#if periods.length === 0}
				<h2>No feedback periods open</h2>
				<p class="state-text">Your organization hasn't opened a feedback period yet. Please check back later.</p>
			{:else if nextPeriod}
				<h2>No feedback period is currently open</h2>
				<p class="state-text">
					The next cycle, <strong>{nextPeriod.name}</strong>, opens on
					{formatDate(nextPeriod.start_date)} — your feedback can be submitted then.
				</p>
			{:else}
				<h2>No feedback period is currently open</h2>
				<p class="state-text">All feedback periods have closed. Please check back later.</p>
			{/if}
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
		{#if otherDrafts.length > 0}
			<div class="card drafts-card">
				<div class="drafts-head">
					<h2>Your drafts</h2>
					<span class="drafts-note">Private to you — not visible to anyone else.</span>
				</div>
				<ul class="drafts-list">
					{#each otherDrafts as draft (draft.id)}
						<li class="draft-row">
							<div class="draft-info">
								<span class="draft-reviewee">{draftName(draft)}</span>
								<span class="draft-meta">
									{draftPeriodName(draft)} · {draftProgress(draft)} · saved
									{formatDateTime(draft.updated_at)}
								</span>
							</div>
							<div class="draft-actions">
								<button type="button" class="btn btn-secondary" onclick={() => applyDraft(draft)} disabled={draftBusy}>
									Continue
								</button>
								<button
									type="button"
									class="btn btn-ghost"
									onclick={() => handleDiscardDraft(draft)}
									disabled={draftBusy}
								>
									Discard
								</button>
							</div>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		<form class="card form-card" onsubmit={handleSubmit} novalidate>
			{#if matchingRequest && matchingRequest.period_id === periodId}
				<div class="draft-banner request-banner">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<path d="M21 11.5a8.5 8.5 0 01-8.5 8.5c-1.6 0-3.1-.4-4.4-1.2L3 20l1.2-5.1A8.5 8.5 0 1121 11.5z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
					</svg>
					<span>
						You're completing <strong>{revieweeName()}</strong>'s feedback request — they asked you
						for feedback in this cycle.
					</span>
				</div>
			{/if}

			{#if editingDraft}
				<div class="draft-banner">
					<svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
						<path d="M4.5 2.5h8L17 7v10.5a1 1 0 01-1 1h-11.5a1 1 0 01-1-1v-14a1 1 0 011-1z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
						<path d="M12 2.5V7h4.5M7 11h6M7 14h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
					</svg>
					<span>
						You're editing a saved draft for <strong>{draftName(editingDraft)}</strong>. The period
						and colleague can't be changed.
					</span>
					<button
						type="button"
						class="btn btn-ghost draft-banner-discard"
						onclick={() => editingDraft && handleDiscardDraft(editingDraft)}
						disabled={draftBusy || submitting}
					>
						Discard draft
					</button>
				</div>
			{/if}

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
					disabled={submitting || !!draftId}
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
			<label class="field-label" for={revieweeSearchId}>Who are you reviewing?</label>
			<div class="combobox">
				<input
					id={revieweeSearchId}
					class="input"
					type="text"
					autocomplete="off"
					role="combobox"
					placeholder={revieweeLabel || 'Type to search a teammate…'}
					value={revieweeOpen ? revieweeQuery : revieweeLabel}
					onfocus={openReviewee}
					oninput={onRevieweeInput}
					onkeydown={onRevieweeKeydown}
					onblur={() => setTimeout(closeReviewee, 120)}
					aria-invalid={!!fieldErrors.reviewee_id}
					aria-describedby={fieldErrors.reviewee_id ? 'reviewee_id-error' : undefined}
					aria-autocomplete="list"
					aria-expanded={revieweeOpen}
					aria-controls={revieweeListId}
					aria-activedescendant={revieweeOpen && revieweeOptions.length > 0
						? `${revieweeListId}-opt-${revieweeOptions[revieweeActive]?.id}`
						: undefined}
					disabled={submitting || !!draftId}
					required
				/>
				{#if revieweeOpen && !revieweeQuery}
					<span class="combo-hint" aria-hidden="true">Type to filter…</span>
				{/if}
				{#if revieweeOpen}
					<ul
						id={revieweeListId}
						class="combo-list"
						role="listbox"
						aria-label="Teammates"
					>
						{#if revieweeOptions.length === 0}
							<li class="combo-empty" role="option" aria-selected="false" aria-disabled="true">
								No teammates match “{revieweeQuery}”
							</li>
						{:else}
							{#each revieweeOptions as e, i (e.id)}
								<li
									id={`${revieweeListId}-opt-${e.id}`}
									class="combo-option"
									class:active={i === revieweeActive}
									class:selected={e.id === revieweeId}
									role="option"
									aria-selected={e.id === revieweeId}
									onpointerdown={(ev) => {
										ev.preventDefault();
										selectReviewee(e.id);
									}}
									onpointerenter={() => onOptionPointer(i)}
								>
									<span class="combo-name">{e.name}</span>
									<span class="combo-title">{e.title || e.email}</span>
								</li>
							{/each}
						{/if}
					</ul>
				{/if}
			</div>
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
			<p class="section-sub">Specifics make feedback actionable — both fields are required.</p>

			<div class="field">
				<label class="field-label" for="strengths_comment">Strengths</label>
				<textarea
					id="strengths_comment"
					class="input textarea"
					bind:value={strengthsComment}
					oninput={() => clearFieldError('strengths_comment')}
					aria-invalid={!!fieldErrors.strengths_comment}
					aria-describedby={fieldErrors.strengths_comment ? 'strengths_comment-error' : undefined}
					rows="3"
					placeholder="What did they do well? Where do they shine?"
					disabled={submitting}
					maxlength="2000"
					required
				></textarea>
				{#if fieldErrors.strengths_comment}
					<span id="strengths_comment-error" class="field-error">{fieldErrors.strengths_comment}</span>
				{/if}
			</div>

			<div class="field">
				<label class="field-label" for="weaknesses_comment">Areas to grow</label>
				<textarea
					id="weaknesses_comment"
					class="input textarea"
					bind:value={weaknessesComment}
					oninput={() => clearFieldError('weaknesses_comment')}
					aria-invalid={!!fieldErrors.weaknesses_comment}
					aria-describedby={fieldErrors.weaknesses_comment ? 'weaknesses_comment-error' : undefined}
					rows="3"
					placeholder="What could they work on? Be constructive and specific."
					disabled={submitting}
					maxlength="2000"
					required
				></textarea>
				{#if fieldErrors.weaknesses_comment}
					<span id="weaknesses_comment-error" class="field-error">{fieldErrors.weaknesses_comment}</span>
				{/if}
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
			<button
				type="button"
				class="btn btn-secondary"
				onclick={handleSaveDraft}
				disabled={draftBusy || submitting || (!draftId && (!periodId || !revieweeId))}
				title={draftId ? 'Save your changes to this draft' : 'Save your progress and finish later'}
			>
				{#if draftBusy}
					<span class="spinner spinner-dark" aria-hidden="true"></span>
					Saving…
				{:else if saveStatus === 'saved'}
					<svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
						<path d="M4 10.5l4 4 8-9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
					</svg>
					Draft saved
				{:else}
					Save draft
				{/if}
			</button>
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

	select.input {
		height: 42px;
		padding: 0 var(--space-3);
		appearance: none;
		background-image: url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1.5l5 5 5-5' stroke='%238b94a6' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right var(--space-4) center;
		padding-right: var(--space-8);
	}

	/* Reviewee combobox */
	.combobox {
		position: relative;
	}

	.combobox .input {
		width: 100%;
	}

	.combo-hint {
		position: absolute;
		right: var(--space-4);
		top: 50%;
		transform: translateY(-50%);
		font-size: 12px;
		color: var(--color-text-subtle);
		pointer-events: none;
	}

	.combo-list {
		position: absolute;
		z-index: 30;
		left: 0;
		right: 0;
		top: calc(100% + 4px);
		max-height: 260px;
		overflow-y: auto;
		margin: 0;
		padding: var(--space-1);
		list-style: none;
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-lg);
	}

	.combo-option {
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.combo-option.active,
	.combo-option:hover {
		background: var(--color-primary-soft);
	}

	.combo-option.selected .combo-name {
		color: var(--color-primary);
	}

	.combo-name {
		font-size: 14px;
		font-weight: 600;
	}

	.combo-title {
		font-size: 12px;
		color: var(--color-text-subtle);
	}

	.combo-empty {
		padding: var(--space-3);
		font-size: 13px;
		color: var(--color-text-muted);
		text-align: center;
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
		min-height: 120px;
		padding: var(--space-3) var(--space-4);
		resize: vertical;
		line-height: 1.5;
		font-family: inherit;
		white-space: pre-wrap;
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

	.drafts-card {
		margin-bottom: var(--space-6);
		padding: var(--space-6) var(--space-8);
	}

	.drafts-head {
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
		margin-bottom: var(--space-4);
		flex-wrap: wrap;
	}

	.drafts-head h2 {
		font-size: 16px;
	}

	.drafts-note {
		font-size: 12px;
		color: var(--color-text-subtle);
	}

	.drafts-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.draft-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-4);
		background: var(--color-surface-2);
		border-radius: var(--radius-md);
	}

	.draft-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.draft-reviewee {
		font-size: 14px;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.draft-meta {
		font-size: 12px;
		color: var(--color-text-subtle);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.draft-actions {
		display: flex;
		gap: var(--space-2);
		flex-shrink: 0;
	}

	.draft-actions .btn {
		height: 34px;
		padding: 0 var(--space-4);
		font-size: 13px;
	}

	.draft-banner {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		background: var(--color-primary-soft);
		color: var(--color-text);
		border: 1px solid var(--color-primary);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-md);
		font-size: 13px;
		line-height: 1.45;
	}

	.draft-banner svg {
		flex-shrink: 0;
		color: var(--color-primary);
	}

	.draft-banner strong {
		font-weight: 600;
	}

	.draft-banner-discard {
		margin-left: auto;
		flex-shrink: 0;
		height: 30px;
		padding: 0 var(--space-3);
		font-size: 12px;
	}

	.spinner-dark {
		border-color: rgba(0, 0, 0, 0.25);
		border-top-color: currentColor;
	}

	@media (max-width: 640px) {
		.draft-row {
			flex-direction: column;
			align-items: stretch;
		}

		.draft-actions {
			justify-content: flex-end;
		}

		.draft-banner {
			flex-wrap: wrap;
		}

		.draft-banner-discard {
			margin-left: 0;
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