# ShakeFix infrastructure (Google Cloud, Terraform)

Everything the demo needs on Google Cloud, as code. Provider `hashicorp/google ~> 6.0`,
Terraform `>= 1.7`. `terraform validate` passes; files are `terraform fmt` clean.

| File | Creates |
|---|---|
| `main.tf` | Provider, required APIs (run, artifactregistry, cloudbuild, iam, iamcredentials, sts, secretmanager, firestore, logging, billingbudgets) |
| `artifact.tf` | Artifact Registry Docker repo `shakefix` (30-day cleanup) and the Cloud Build source bucket |
| `cloudrun.tf` | Cloud Run v2 services `splitpal` and `intake` (min 0, max 2, 512Mi), public invoker |
| `firestore.tf` | Firestore Native `(default)` database (report state, push subscriptions) |
| `secrets.tf` | Secret Manager secrets, **no values**: `gitlab-human-pat`, `gitlab-webhook-secret`, `intake-hook-secret`, `vapid-private` |
| `iam.tf` | CI service account `shakefix-ci` + roles, runtime service accounts |
| `wif.tf` | Workload Identity pool `gitlab` + OIDC provider `gitlab` for `https://gitlab.com`, restricted by `project_path` |
| `budget.tf` | Optional budget alert (set `billing_account_id`) |
| `cloudbuild.yaml` | Build recipe CI uses (`gcloud builds submit`), runs as the CI service account |
| `service.yaml` | Reference Knative spec for SplitPal (not applied by Terraform) |

CI roles on the project: `run.admin`, `iam.serviceAccountUser`, `artifactregistry.writer`,
`cloudbuild.builds.editor`, `logging.logWriter`, `logging.viewer`, `serviceusage.serviceUsageConsumer`,
plus `storage.admin` on the Cloud Build source bucket only.

## Apply from a clean project

```bash
# 1. Project + billing (once)
gcloud projects create shakefix-hack
gcloud billing projects link shakefix-hack --billing-account=XXXXXX-XXXXXX-XXXXXX
gcloud auth application-default login
gcloud services enable serviceusage.googleapis.com cloudresourcemanager.googleapis.com --project shakefix-hack

# 2. Variables
cd infra
cp terraform.tfvars.example terraform.tfvars   # edit project_id, gitlab_project_paths, gitlab_project_id

# 3. Apply
terraform init
terraform apply

# 4. Secret values (never in Terraform state)
printf '%s' "$GITLAB_HUMAN_PAT"      | gcloud secrets versions add gitlab-human-pat      --data-file=- --project shakefix-hack
printf '%s' "$GITLAB_WEBHOOK_SECRET" | gcloud secrets versions add gitlab-webhook-secret --data-file=- --project shakefix-hack
printf '%s' "$INTAKE_HOOK_SECRET"    | gcloud secrets versions add intake-hook-secret    --data-file=- --project shakefix-hack
printf '%s' "$VAPID_PRIVATE_KEY"     | gcloud secrets versions add vapid-private         --data-file=- --project shakefix-hack

# 5. Wire the secrets and CORS into the intake
#    terraform.tfvars: intake_secrets_ready = true, allowed_origins = "<splitpal_url output>"
terraform apply

# 6. Copy outputs into GitLab CI/CD variables
terraform output -raw gcp_wif_provider   # -> GCP_WIF_PROVIDER
terraform output -raw gcp_sa_email       # -> GCP_SA_EMAIL
terraform output -raw intake_url         # -> INTAKE_URL
terraform output -raw splitpal_url       # -> PROD_URL (optional; CI reads it from Cloud Run)
```

The first main pipeline replaces the placeholder image with SplitPal and creates the
`main` and `main-test` traffic tags. Second Opinion uses `main-test` (same image, test hooks on) as its base.

## How CI authenticates (no keys)

1. The job declares `id_tokens: GITLAB_OIDC_TOKEN: aud: https://iam.googleapis.com/$GCP_WIF_PROVIDER`.
2. `gcloud iam workload-identity-pools create-cred-config` turns it into an external-account
   credential file, and `gcloud auth login --cred-file` uses it.
3. Google STS accepts the token only if `assertion.project_path` is in `gitlab_project_paths`,
   and only principals with that `project_path` may impersonate `shakefix-ci`.

## Cost

Everything scales to zero. Expect a few dollars at most for the hackathon. Keep `min_instance_count = 0`
except while recording (set it to 1 for that hour only). Set `billing_account_id` for a $20 budget alert.

## Tear down

```bash
terraform destroy   # Firestore uses deletion_policy ABANDON: delete the database in the console if needed
```

## Plan, explained

Before you apply, read the plan in plain English (what gets created, changed, replaced or destroyed, each
setting before → after, and warnings for data loss, downtime, public access, cost and region moves):

```bash
terraform plan -out tf.plan && terraform show -json tf.plan > plan.json
node ../scripts/infra/explain-plan.mjs plan.json
```

Agents never apply infrastructure (`infra/**` is "assisted" in `.shakefix/policy.yml`). To run this on every
infra MR, move the state to a GCS backend (see the commented `backend "gcs"` block in `main.tf`) so CI can plan.
