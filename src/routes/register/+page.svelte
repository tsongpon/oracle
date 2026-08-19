<script lang="ts">
	import { auth } from '$lib/auth.svelte';
	import { register, ApiClientError, type Employee } from '$lib/auth/auth';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	let name = $state('');
	let organizationName = $state('');
	let title = $state('');
	let email = $state('');
	let password = $state('');
	let showPassword = $state(false);
	let submitting = $state(false);

	type FieldErrors = Partial<Record<'name' | 'organization_name' | 'email' | 'password', string>>;
	let fieldErrors = $state<FieldErrors>({});
	let formError = $state<string | null>(null);
	let accountExists = $state(false);
	let registeredEmail = $state<string | null>(null);

	// --- Invitation token (link = /register?token=...) ---
	let inviteToken = $state<string | null>(null);
	let inviteOrgName = $state<string | null>(null);
	let inviteExpired = $state(false);
	let inviteError = $state<string | null>(null);

	// Decode a JWT payload (client-side, for display ONLY — the server
	// verifies the signature on submit). Returns null on malformed input.
	function decodeJwtPayload(token: string): Record<string, unknown> | null {
		const parts = token.split('.');
		if (parts.length < 2) return null;
		let payload = parts[1];
		payload = payload.replace(/-/g, '+').replace(/_/g, '/');
		switch (payload.length % 4) {
			case 0:
				break;
			case 2:
				payload += '==';
				break;
			case 3:
				payload += '=';
				break;
			default:
				return null;
		}
		try {
			const json = atob(payload);
			return JSON.parse(decodeURIComponent(escape(json)));
		} catch {
			return null;
		}
	}

	onMount(() => {
		if (auth.isAuthenticated) {
			goto('/app', { replaceState: true });
			return;
		}
		if (typeof window !== 'undefined') {
			const params = new URLSearchParams(window.location.search);
			const token = params.get('token');
			if (token) {
				inviteToken = token;
				const payload = decodeJwtPayload(token);
				if (payload && typeof payload.organization_name === 'string') {
					inviteOrgName = payload.organization_name;
					organizationName = inviteOrgName;
					// Optional client-side expired hint (server is authoritative).
					if (typeof payload.exp === 'number') {
						const expMs = payload.exp * 1000;
						if (Date.now() >= expMs) inviteExpired = true;
					}
				} else {
					// Malformed token: surface as expired/invalid so the user asks for a new link.
					inviteExpired = true;
				}
			}
		}
	});

	const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

	function validate(): FieldErrors {
		const errs: FieldErrors = {};
		if (!name.trim()) errs.name = 'name is required';
		// When registering with an invitation the server supplies the
		// organization_name (taken from the verified JWT), so we skip the
		// client-side required check for it.
		if (!inviteToken && !organizationName.trim()) {
			errs.organization_name = 'organization_name is required';
		}
		if (!email.trim()) {
			errs.email = 'email is required';
		} else if (!EMAIL_RE.test(email.trim())) {
			errs.email = 'Please enter a valid email address.';
		}
		if (!password) {
			errs.password = 'password is required';
		} else if (password.length > 64) {
			errs.password = 'password must be at most 64 characters';
		}
		return errs;
	}

	// Map a server validation message to the relevant field so we can render
	// it inline (spec §5: "Display the server's message verbatim next to the
	// relevant field when possible").
	function mapServerMessageToField(message: string): FieldErrors {
		const m = message.toLowerCase();
		const errs: FieldErrors = {};
		if (m.includes('name is required')) errs.name = 'name is required';
		else if (m.includes('organization_name is required'))
			errs.organization_name = 'organization_name is required';
		else if (m.includes('email is required')) errs.email = 'email is required';
		else if (m.includes('password is required')) errs.password = 'password is required';
		else if (m.includes('password must be at most'))
			errs.password = 'password must be at most 64 characters';
		return errs;
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (submitting) return;

		formError = null;
		accountExists = false;
		const errs = validate();
		fieldErrors = errs;
		if (Object.keys(errs).length > 0) return;

		submitting = true;
		try {
			const employee: Employee = await register({
				name: name.trim(),
				organization_name: organizationName.trim(),
				title: title.trim() || undefined,
				email: email.trim(),
				password,
				invite_token: inviteToken ?? undefined
			});
			// Do NOT auto-login. Show "check your email" state.
			registeredEmail = employee.email;
		} catch (err) {
			if (err instanceof ApiClientError) {
				switch (err.code) {
					case 'email_taken':
						accountExists = true;
						formError = 'An account with that email already exists.';
						break;
					case 'bad_request':
						if (err.message === 'invalid request body' || err.message === '') {
							formError = 'Please check your input and try again.';
						} else if (
							inviteToken &&
							err.message.toLowerCase().includes('invitation')
						) {
							// Server rejected the invitation token (invalid/expired).
							inviteError =
								err.message ||
								'Your invitation link is invalid or has expired. Ask your administrator for a new link.';
							formError = inviteError;
						} else {
							// Verbatim server validation message(s) mapped to fields.
							const mapped = mapServerMessageToField(err.message);
							if (Object.keys(mapped).length > 0) {
								fieldErrors = { ...fieldErrors, ...mapped };
							} else {
								formError = err.message;
							}
						}
						break;
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

	function togglePassword() {
		showPassword = !showPassword;
	}

	// Clear a field's error as soon as the user edits it.
	function clearFieldError(field: keyof FieldErrors) {
		if (fieldErrors[field]) {
			fieldErrors = { ...fieldErrors, [field]: undefined };
		}
		formError = null;
		accountExists = false;
	}
</script>

<svelte:head>
	<title>Create account · 360 Feedback</title>
</svelte:head>

<div class="auth-shell">
	<div class="auth-brand">
		<div class="brand-mark" aria-hidden="true">
			<svg width="28" height="28" viewBox="0 0 28 28" fill="none">
				<circle cx="14" cy="14" r="13" stroke="white" stroke-width="1.5" opacity="0.45" />
				<circle cx="14" cy="14" r="8" stroke="white" stroke-width="1.5" opacity="0.7" />
				<circle cx="14" cy="14" r="3" fill="white" />
			</svg>
		</div>
		<div class="brand-name">360 Feedback</div>
		<p class="brand-tagline">
			Continuous peer feedback that helps your team grow — together.
		</p>
		<ul class="brand-points">
			<li>Run structured 360° review cycles in minutes</li>
			<li>Collect balanced, actionable feedback</li>
			<li>Track growth themes across the year</li>
		</ul>
	</div>

	<div class="auth-form-wrap">
		{#if registeredEmail}
			<div class="auth-card success-card">
				<div class="success-icon" aria-hidden="true">
					<svg width="40" height="40" viewBox="0 0 48 48" fill="none">
						<circle cx="24" cy="24" r="22" fill="#e7f6ee" />
						<path d="M16 24.5l5.5 5.5L33 17" stroke="#0f9d58" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
					</svg>
				</div>
				<h1>Check your email</h1>
				<p class="success-text">
					We've sent a verification link to <strong>{registeredEmail}</strong>.
					Follow the link to activate your account, then sign in.
				</p>
				<p class="success-hint">
					In development with no email configured, the link is logged to the
					backend server output.
				</p>
				<a href="/login" class="btn btn-primary btn-block">Go to sign in</a>
			</div>
		{:else}
			<form class="auth-card" onsubmit={handleSubmit} novalidate>
				<div class="auth-card-head">
					{#if inviteToken && inviteOrgName}
						<h1>Join {inviteOrgName}</h1>
						<p>You've been invited to join {inviteOrgName} on 360 Feedback. Create your account below.</p>
					{:else}
						<h1>Create your account</h1>
						<p>Sign up for your 360 Feedback workspace.</p>
					{/if}
				</div>

				{#if inviteToken && inviteExpired}
					<div class="alert" role="alert">
						<svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
							<path
								d="M10 1.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17zM10 6v5M10 14.5v.5"
								stroke="currentColor"
								stroke-width="1.6"
								stroke-linecap="round"
							/>
						</svg>
						<span>Your invitation link has expired or is invalid. Ask your administrator for a new link.</span>
					</div>
				{/if}

				{#if formError && !(inviteToken && inviteExpired)}
					<div class="alert" class:alert-warning={accountExists} role="alert">
						<svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
							<path
								d="M10 1.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17zM10 6v5M10 14.5v.5"
								stroke="currentColor"
								stroke-width="1.6"
								stroke-linecap="round"
							/>
						</svg>
						<span>{formError}</span>
						{#if accountExists}
							<a href="/login" class="alert-link">Sign in →</a>
						{/if}
					</div>
				{/if}

				<div class="field">
					<label class="field-label" for="name">Full name</label>
					<input
						id="name"
						class="input"
						type="text"
						autocomplete="name"
						placeholder="Jane Doe"
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

			<div class="field">
				<label class="field-label" for="organization_name">
					Organization
					{#if inviteToken}
						<span class="field-optional">(set by invitation)</span>
					{/if}
				</label>
				<input
					id="organization_name"
					class="input"
					type="text"
					placeholder="Acme Inc."
					bind:value={organizationName}
					oninput={() => clearFieldError('organization_name')}
					aria-invalid={!!fieldErrors.organization_name}
					aria-describedby={fieldErrors.organization_name ? 'org-error' : undefined}
					disabled={submitting || !!inviteToken}
					readonly={!!inviteToken}
					required
				/>
				{#if fieldErrors.organization_name}
					<span id="org-error" class="field-error">{fieldErrors.organization_name}</span>
				{/if}
			</div>

				<div class="field">
					<label class="field-label" for="title">
						Job title <span class="field-optional">(optional)</span>
					</label>
					<input
						id="title"
						class="input"
						type="text"
						autocomplete="organization-title"
						placeholder="Senior Engineer"
						bind:value={title}
						disabled={submitting}
					/>
				</div>

				<div class="field">
					<label class="field-label" for="email">Work email</label>
					<input
						id="email"
						class="input"
						type="email"
						autocomplete="email"
						placeholder="you@company.com"
						bind:value={email}
						oninput={() => clearFieldError('email')}
						aria-invalid={!!fieldErrors.email}
						aria-describedby={fieldErrors.email ? 'email-error' : undefined}
						disabled={submitting}
						required
					/>
					{#if fieldErrors.email}
						<span id="email-error" class="field-error">{fieldErrors.email}</span>
					{/if}
				</div>

				<div class="field">
					<label class="field-label" for="password">Password</label>
					<div class="password-wrap">
						<input
							id="password"
							class="input"
							type={showPassword ? 'text' : 'password'}
							autocomplete="new-password"
							placeholder="Create a password"
							bind:value={password}
							oninput={() => clearFieldError('password')}
							aria-invalid={!!fieldErrors.password}
							aria-describedby={fieldErrors.password ? 'password-error' : undefined}
							disabled={submitting}
							required
							maxlength="64"
						/>
						<button
							type="button"
							class="password-toggle"
							onclick={togglePassword}
							aria-label={showPassword ? 'Hide password' : 'Show password'}
							tabindex="-1"
						>
							{#if showPassword}
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
									<path
										d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A10.5 10.5 0 0112 5c5 0 9.3 3.1 11 7-0.5 1.2-1.3 2.4-2.4 3.4M6.1 6.1C4 7.4 2.5 9.1 1.5 11c1.7 3.9 6 7 11 7 1.4 0 2.7-.2 3.9-.6"
										stroke="currentColor"
										stroke-width="1.6"
										stroke-linecap="round"
									/>
								</svg>
							{:else}
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
									<path
										d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z"
										stroke="currentColor"
										stroke-width="1.6"
										stroke-linejoin="round"
									/>
									<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6" />
								</svg>
							{/if}
						</button>
					</div>
					{#if fieldErrors.password}
						<span id="password-error" class="field-error">{fieldErrors.password}</span>
					{:else}
						<span class="field-hint">Up to 64 characters.</span>
					{/if}
				</div>

			<button type="submit" class="btn btn-primary btn-block" disabled={submitting}>
				{#if submitting}
					<span class="spinner" aria-hidden="true"></span>
					Creating account…
				{:else if inviteToken}
					Join {inviteOrgName ?? 'organization'}
				{:else}
					Create account
				{/if}
			</button>
			</form>
		{/if}

		<p class="auth-foot">
			Already have an account? <a href="/login">Sign in</a>
		</p>
	</div>
</div>

<style>
	.auth-shell {
		min-height: 100vh;
		display: grid;
		grid-template-columns: 1.1fr 1fr;
		background: var(--color-bg);
	}

	/* Left brand panel */
	.auth-brand {
		background: radial-gradient(120% 120% at 0% 0%, #6366f1 0%, #4f46e5 45%, #3b34c4 100%);
		color: #fff;
		padding: var(--space-12) var(--space-12);
		display: flex;
		flex-direction: column;
		justify-content: center;
		position: relative;
		overflow: hidden;
	}

	.auth-brand::after {
		content: '';
		position: absolute;
		inset: 0;
		background:
			radial-gradient(60% 50% at 100% 0%, rgba(255, 255, 255, 0.12), transparent 60%),
			radial-gradient(50% 60% at 100% 100%, rgba(255, 255, 255, 0.08), transparent 60%);
		pointer-events: none;
	}

	.brand-mark {
		width: 52px;
		height: 52px;
		border-radius: 14px;
		background: rgba(255, 255, 255, 0.12);
		display: grid;
		place-items: center;
		margin-bottom: var(--space-6);
		backdrop-filter: blur(8px);
	}

	.brand-name {
		font-size: 26px;
		font-weight: 700;
		letter-spacing: -0.02em;
	}

	.brand-tagline {
		margin-top: var(--space-3);
		font-size: 16px;
		line-height: 1.55;
		color: rgba(255, 255, 255, 0.82);
		max-width: 38ch;
	}

	.brand-points {
		list-style: none;
		padding: 0;
		margin: var(--space-8) 0 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		max-width: 38ch;
	}

	.brand-points li {
		position: relative;
		padding-left: var(--space-6);
		font-size: 14px;
		color: rgba(255, 255, 255, 0.9);
		line-height: 1.5;
	}

	.brand-points li::before {
		content: '';
		position: absolute;
		left: 0;
		top: 7px;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.15) url("data:image/svg+xml,%3Csvg width='10' height='10' viewBox='0 0 10 10' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M2 5.2L4.2 7.4L8.2 3' stroke='white' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/12px no-repeat;
	}

	/* Right form panel */
	.auth-form-wrap {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--space-8);
	}

	.auth-card {
		width: 100%;
		max-width: 440px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
		padding: var(--space-10) var(--space-8);
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.auth-card-head h1 {
		font-size: 24px;
	}

	.auth-card-head p {
		margin-top: var(--space-2);
		color: var(--color-text-muted);
		font-size: 14px;
	}

	.field-optional {
		font-weight: 400;
		color: var(--color-text-subtle);
		font-size: 12px;
	}

	.field-error {
		font-size: 12px;
		color: var(--color-danger);
		font-weight: 500;
	}

	.password-wrap {
		position: relative;
	}

	.password-wrap .input {
		width: 100%;
		padding-right: 44px;
	}

	.password-toggle {
		position: absolute;
		right: 10px;
		top: 50%;
		transform: translateY(-50%);
		background: transparent;
		border: none;
		color: var(--color-text-subtle);
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border-radius: var(--radius-sm);
		transition: color var(--transition-fast);
	}

	.password-toggle:hover {
		color: var(--color-text);
	}

	/* Alerts (shared with login) */
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

	.alert.alert-warning {
		background: #fff5e0;
		color: #b76b00;
		border-color: #fbe2a8;
	}

	.alert svg {
		flex-shrink: 0;
		margin-top: 2px;
	}

	.alert-link {
		margin-left: auto;
		font-weight: 600;
		white-space: nowrap;
		align-self: center;
	}

	.spinner {
		width: 16px;
		height: 16px;
		border: 2px solid rgba(255, 255, 255, 0.45);
		border-top-color: #fff;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* Success state */
	.success-card {
		text-align: center;
		align-items: center;
		gap: var(--space-4);
	}

	.success-icon {
		margin-bottom: var(--space-2);
	}

	.success-card h1 {
		font-size: 22px;
	}

	.success-text {
		color: var(--color-text-muted);
		font-size: 14px;
		line-height: 1.55;
	}

	.success-text strong {
		color: var(--color-text);
		font-weight: 600;
	}

	.success-hint {
		font-size: 12px;
		color: var(--color-text-subtle);
		line-height: 1.5;
		margin-top: var(--space-1);
	}

	.auth-foot {
		margin-top: var(--space-6);
		font-size: 13px;
		color: var(--color-text-muted);
		text-align: center;
	}

	.auth-foot a {
		font-weight: 600;
	}

	@media (max-width: 900px) {
		.auth-shell {
			grid-template-columns: 1fr;
		}

		.auth-brand {
			display: none;
		}
	}
</style>