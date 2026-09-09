# GCP setup for the frontend (oracle) CI/CD

One-time setup to deploy the 360 Feedback frontend to Cloud Run via GitHub
Actions. This mirrors the backend guide (`echo/docs/gcp-setup.md`) and reuses
the Workload Identity Federation (WIF) infrastructure it created.

The pipeline (`.github/workflows/ci.yml`) does three things on `main`:

1. `check` — svelte-check on every push and PR
2. `build-push` — build the nginx container and push it to Artifact Registry
   (`asia-southeast1-docker.pkg.dev/<PROJECT>/oracle/oracle:{sha,main}`)
3. `deploy-production` — deploy to the Cloud Run service `oracle` in
   `asia-southeast1` and smoke-test the public URL

## 0. Prerequisites

The backend setup (`echo/docs/gcp-setup.md`) must already exist:

- Project `abc-tech-477502` with APIs enabled: `run`, `artifactregistry`,
  `iamcredentials`
- A WIF pool + OIDC provider named `github`
- A deployer service account (referred to below as `$DEPLOYER_SA`) with
  `roles/run.admin`, `roles/artifactregistry.writer`,
  `roles/iam.serviceAccountUser`

## 1. Create the Artifact Registry repository

Only needed if `oracle` doesn't exist yet (the backend uses the `echo` repo;
these can also share one repo, in which case skip this):

```bash
gcloud artifacts repositories create oracle \
  --repository-format=docker \
  --location=asia-southeast1 \
  --project=abc-tech-477502
```

If the deployer SA has project-level `artifactregistry.writer`, it can push
already. Otherwise grant it on this repo:

```bash
gcloud artifacts repositories add-iam-policy-binding oracle \
  --location=asia-southeast1 \
  --project=abc-tech-477502 \
  --member="serviceAccount:$DEPLOYER_SA" \
  --role=roles/artifactregistry.writer
```

## 2. Admit the oracle repo to the existing WIF provider

The backend's WIF provider restricts GitHub access to `tsongpon/echo`. Update
its attribute condition to admit both repositories. The pool and provider were
created in the backend setup as `github-pool` / `github-provider`:

```bash
gcloud iam workload-identity-pools providers update-oidc github-provider \
  --location=global \
  --project=abc-tech-477502 \
  --workload-identity-pool=github-pool \
  --attribute-condition="assertion.repository in ['tsongpon/echo', 'tsongpon/oracle']"
```

Verify the provider's full resource path afterwards:

```bash
gcloud iam workload-identity-pools providers describe github-provider \
  --location=global \
  --project=abc-tech-477502 \
  --workload-identity-pool=github-pool \
  --format="value(name)"
# GCP_WIF_PROVIDER = projects/<number>/locations/global/workloadIdentityPools/github-pool/providers/github-provider
```

Also grant the deployer SA `roles/iam.workloadIdentityUser` membership on the
pool's *principal* for the oracle repo, if it was bound per-repository for
echo:

```bash
gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER_SA" \
  --project=abc-tech-477502 \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/github-pool/attribute.repository/tsongpon/oracle"
```

## 3. GitHub repository secrets

Add the following secrets to `tsongpon/oracle` (Settings → Secrets and
variables → Actions). The values are identical to the backend repo's:

| Secret                   | Value                                                        |
|--------------------------|--------------------------------------------------------------|
| `GCP_PROJECT_ID`         | `abc-tech-477502`                                            |
| `GCP_WIF_PROVIDER`       | `projects/<number>/locations/global/workloadIdentityPools/github-pool/providers/github-provider` |
| `GCP_DEPLOYER_SA_EMAIL`  | the deployer SA email (same one the echo repo impersonates) |

No `CLOUD_RUN_RUNTIME_SA_EMAIL` is needed: the frontend container only serves
static files and calls no Google APIs.

Optionally enable the `production` environment (Settings → Environments) with
required reviewers if you want a manual approval gate before deploys.

## 4. First deploy

Push to `main` and watch the three jobs go green:

```bash
git push origin main
```

The deploy job creates the `oracle` Cloud Run service on first run. When it
finishes, the deployment summary (and the job log) shows the public URL —
`https://oracle-<hash>-<hash>.a.run.app`. Login with any seeded account to
confirm the frontend talks to the echo backend.

## 5. Changing the backend URL

`VITE_API_BASE_URL` is baked into the static bundle at **build** time (see
`Dockerfile` `ARG` and the workflow `env` block). To point the frontend at a
different backend, change the `VITE_API_BASE_URL` env value in
`.github/workflows/ci.yml` and push — a new image is built and redeployed.

Empty value switches the bundle to same-origin `/v1` requests (useful only if
you later front the API behind the same domain).