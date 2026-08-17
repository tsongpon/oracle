<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { verifyEmail, ApiClientError } from '$lib/auth/auth';

	type Status = 'loading' | 'ok' | 'error';
	type ErrorKind = 'invalid' | 'server' | 'missing';

	let status = $state<Status>('loading');
	let errorKind = $state<ErrorKind>('invalid');
	let errorMsg = $state<string>('');
	let attempt = $state(0);

	const token = $derived(page.url.searchParams.get('token'));

	onMount(() => {
		if (!token) {
			status = 'error';
			errorKind = 'missing';
			errorMsg = 'No verification token found in the link.';
			return;
		}
		void runVerify(token);
	});

	async function runVerify(tok: string) {
		status = 'loading';
		errorMsg = '';
		try {
			await verifyEmail(tok);
			status = 'ok';
		} catch (err) {
			if (err instanceof ApiClientError) {
				if (err.status >= 500 || err.code === 'network' || err.code === 'server') {
					errorKind = 'server';
					errorMsg =
						'Something went wrong while verifying your email. Please try again.';
				} else {
					// Spec §3: 400 covers all failure modes with a single sentinel
					// message. Treat any non-5xx failure as an invalid/expired link.
					errorKind = 'invalid';
					errorMsg =
						'This verification link is no longer valid. It may have expired or already been used.';
				}
			} else {
				errorKind = 'server';
				errorMsg = 'Something went wrong. Please try again.';
			}
			status = 'error';
		}
	}

	function retry() {
		if (!token) return;
		attempt += 1;
		void runVerify(token);
	}
</script>

<svelte:head>
	<title>Verify your email · 360 Feedback</title>
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
		<div class="auth-card result-card">
			{#if status === 'loading'}
				<div class="state state-loading" role="status" aria-live="polite">
					<div class="spinner-lg" aria-hidden="true"></div>
					<h1>Verifying your email…</h1>
					<p class="state-text">Hang tight while we confirm your account.</p>
				</div>
			{:else if status === 'ok'}
				<div class="state state-ok">
					<div class="state-icon state-icon-ok" aria-hidden="true">
						<svg width="40" height="40" viewBox="0 0 48 48" fill="none">
							<circle cx="24" cy="24" r="22" fill="#e7f6ee" />
							<path
								d="M16 24.5l5.5 5.5L33 17"
								stroke="#0f9d58"
								stroke-width="3"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					</div>
					<h1>Your email is verified</h1>
					<p class="state-text">You can now log in to your 360 Feedback workspace.</p>
					<a href="/login" class="btn btn-primary btn-block">Go to login</a>
				</div>
			{:else}
				<div class="state state-error">
					<div class="state-icon state-icon-error" aria-hidden="true">
						<svg width="40" height="40" viewBox="0 0 48 48" fill="none">
							<circle cx="24" cy="24" r="22" fill="#fdecec" />
							<path
								d="M16 16l16 16M32 16L16 32"
								stroke="#d33"
								stroke-width="3"
								stroke-linecap="round"
							/>
						</svg>
					</div>
					<h1>Verification failed</h1>
					<p class="state-text">{errorMsg}</p>

					{#if errorKind === 'invalid'}
						<p class="state-hint">
							If the problem persists, contact support or register again with the
							same email to receive a fresh link.
						</p>
					{/if}

					<div class="state-actions">
						{#if errorKind === 'server'}
							<button type="button" class="btn btn-primary btn-block" onclick={retry}>
								Try again
							</button>
						{/if}
						<a href="/login" class="btn btn-secondary btn-block">Back to login</a>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.auth-shell {
		min-height: 100vh;
		display: grid;
		grid-template-columns: 1.1fr 1fr;
		background: var(--color-bg);
	}

	/* Left brand panel (shared with login/register) */
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

	/* Right panel */
	.auth-form-wrap {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--space-8);
	}

	.result-card {
		width: 100%;
		max-width: 440px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
		padding: var(--space-10) var(--space-8);
	}

	.state {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--space-3);
	}

	.state h1 {
		font-size: 22px;
	}

	.state-text {
		color: var(--color-text-muted);
		font-size: 14px;
		line-height: 1.55;
		max-width: 38ch;
	}

	.state-hint {
		font-size: 12px;
		color: var(--color-text-subtle);
		line-height: 1.5;
		max-width: 40ch;
		margin-top: var(--space-1);
	}

	.state-icon {
		margin-bottom: var(--space-1);
	}

	.state-actions {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		width: 100%;
		margin-top: var(--space-4);
	}

	.btn-secondary {
		background: var(--color-surface);
		color: var(--color-text);
		border: 1px solid var(--color-border);
	}

	.btn-secondary:hover {
		background: var(--color-bg);
	}

	/* Loading spinner */
	.spinner-lg {
		width: 40px;
		height: 40px;
		border: 3px solid var(--color-border);
		border-top-color: var(--color-primary);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
		margin-bottom: var(--space-2);
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
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