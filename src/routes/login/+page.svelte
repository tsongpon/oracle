<script lang="ts">
	import { auth } from '$lib/auth.svelte';
	import { ApiClientError } from '$lib/auth/auth';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	let email = $state('');
	let password = $state('');
	let remember = $state(true);
	let showPassword = $state(false);
	let submitting = $state(false);
	let errorMsg = $state<string | null>(null);
	let errorKind = $state<'generic' | 'unverified'>('generic');

	onMount(() => {
		if (auth.isAuthenticated) {
			goto('/app', { replaceState: true });
		}
	});

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (submitting) return;

		// Client-side validation prevents the 400 path in the common case.
		if (!email.trim() || !password) {
			errorKind = 'generic';
			errorMsg = 'Please enter both email and password.';
			return;
		}

		errorMsg = null;
		submitting = true;
		try {
			await auth.login({ email: email.trim(), password });
			await goto('/app', { replaceState: true });
		} catch (err) {
			if (err instanceof ApiClientError) {
				switch (err.code) {
					case 'invalid_credentials':
						errorKind = 'generic';
						// Spec: never reveal which field was wrong — single generic message.
						errorMsg = 'Invalid email or password.';
						break;
					case 'email_not_verified':
						errorKind = 'unverified';
						errorMsg =
							"Your email isn't verified yet. Check your inbox for the verification link, then sign in again.";
						break;
					case 'bad_request':
						errorKind = 'generic';
						errorMsg = 'Please enter both email and password.';
						break;
					case 'network':
						errorKind = 'generic';
						errorMsg = 'Could not reach the server. Check your connection and try again.';
						break;
					case 'server':
					case 'unknown':
					default:
						errorKind = 'generic';
						errorMsg = 'Something went wrong. Please try again.';
						break;
				}
			} else {
				errorKind = 'generic';
				errorMsg = 'Something went wrong. Please try again.';
			}
		} finally {
			submitting = false;
		}
	}

	function togglePassword() {
		showPassword = !showPassword;
	}
</script>

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
		<form class="auth-card" onsubmit={handleSubmit} novalidate>
			<div class="auth-card-head">
				<h1>Welcome back</h1>
				<p>Sign in to your 360 Feedback workspace.</p>
			</div>

			{#if errorMsg}
				<div class="alert" class:alert-warning={errorKind === 'unverified'} role="alert">
					<svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
						{#if errorKind === 'unverified'}
							<path
								d="M10 1.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17zM10 6v5M10 14.5v.5"
								stroke="currentColor"
								stroke-width="1.6"
								stroke-linecap="round"
							/>
						{:else}
							<path
								d="M10 1.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17zM10 6v5M10 14.5v.5"
								stroke="currentColor"
								stroke-width="1.6"
								stroke-linecap="round"
							/>
						{/if}
					</svg>
					<span>{errorMsg}</span>
				</div>
			{/if}

			<div class="field">
				<label class="field-label" for="email">Work email</label>
				<input
					id="email"
					class="input"
					type="email"
					autocomplete="email"
					placeholder="you@company.com"
					bind:value={email}
					required
					disabled={submitting}
				/>
			</div>

			<div class="field">
				<div class="field-row">
					<label class="field-label" for="password">Password</label>
					<a href="#reset" class="field-link">Forgot password?</a>
				</div>
				<div class="password-wrap">
					<input
						id="password"
						class="input"
						type={showPassword ? 'text' : 'password'}
						autocomplete="current-password"
						placeholder="Enter your password"
						bind:value={password}
						required
						disabled={submitting}
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
			</div>

			<div class="auth-options">
				<label class="checkbox">
					<input type="checkbox" bind:checked={remember} disabled={submitting} />
					<span>Keep me signed in</span>
				</label>
			</div>

			<button type="submit" class="btn btn-primary btn-block" disabled={submitting}>
				{#if submitting}
					<span class="spinner" aria-hidden="true"></span>
					Signing in…
				{:else}
					Sign in
				{/if}
			</button>
		</form>

		<p class="auth-foot">
			New to 360 Feedback? <a href="/register">Create an account</a>
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
		max-width: 420px;
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

	.field-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
	}

	.field-link {
		font-size: 12px;
		font-weight: 600;
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

	.auth-options {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: -var(--space-1);
	}

	.checkbox {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-size: 13px;
		color: var(--color-text-muted);
		user-select: none;
	}

	.checkbox input {
		width: 16px;
		height: 16px;
		accent-color: var(--color-primary);
		cursor: pointer;
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

	.alert.alert-warning {
		background: #fff5e0;
		color: #b76b00;
		border-color: #fbe2a8;
	}

	.alert svg {
		flex-shrink: 0;
		margin-top: 2px;
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