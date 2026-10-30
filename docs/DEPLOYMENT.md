# Deployment: Docker, Kubernetes on AWS EKS, Jenkins

> None of the AWS steps below were executed while building this project (no AWS/Docker access in the build sandbox). Treat them as a reviewed runbook and validate in a non-production account first.

## 1. Local Docker Compose
```bash
docker compose up --build            # mysql + backend (runs migrations) + frontend
npm install && SEED_PASSWORD='ChangeMe-2026-dev' DB_HOST=127.0.0.1 DB_USER=rims DB_PASSWORD=rims_dev_password JWT_SECRET=local-dev-only-secret-change-me-0123456789abcdef npm run seed
# UI: http://localhost:8080   API: http://localhost:4000/api/v1   Probes: /health, /ready
```
Run `npm install` once and commit the generated `package-lock.json`; the Dockerfiles use `npm ci` when it exists.

## 2. AWS prerequisites
| Area | Setup |
|---|---|
| **ECR** | Repositories `rims-backend`, `rims-frontend` (immutable tags, scan on push, lifecycle policy keeping last ~30 images). |
| **Networking** | VPC with 3 AZs; EKS nodes and RDS in private subnets; public subnets only for the ALB; NAT for egress (needed for outbound integrations). Security groups: ALB→nodes (80/8080/4000), nodes→RDS 3306 only. |
| **EKS** | `eksctl create cluster --name rims-prod --region us-east-1 --version <supported> --nodegroup-name ng --nodes 3 --managed --with-oidc`. Install the **AWS Load Balancer Controller**, **metrics-server** (HPA), and **External Secrets Operator** (or the Secrets Store CSI driver). |
| **TLS** | Request an ACM certificate for your domain, put its ARN in `k8s/30-ingress.yaml`; HTTP is redirected to HTTPS on the ALB. Route 53 alias to the ALB. |
| **MySQL** | Amazon RDS for MySQL 8.0 (or Aurora MySQL 3), Multi-AZ, storage encryption (KMS), automated backups ≥ 7–35 days, deletion protection, `require_secure_transport=ON`, `sql_mode` strict. Create an app user with only the privileges the app needs (`SELECT, INSERT, UPDATE, DELETE`); use a separate migration user with DDL (`CREATE, ALTER, INDEX, DROP, TRIGGER, REFERENCES`) for the migrate Job if you want least privilege. |
| **Secrets** | Store `DB_*`, `JWT_SECRET`, `INTEGRATION_*` in AWS Secrets Manager; sync into the `rims-secrets` Kubernetes Secret (see `k8s/01-secret.example.yaml`). Rotate `JWT_SECRET` by deploying a new value (all sessions end). |
| **IAM** | *Jenkins*: a role/user allowed `ecr:GetAuthorizationToken`, `ecr:BatchCheckLayerAvailability`, `ecr:PutImage`, `ecr:InitiateLayerUpload`, `ecr:UploadLayerPart`, `ecr:CompleteLayerUpload`, `eks:DescribeCluster`, and mapped in the cluster (`aws-auth` or EKS access entries) to a Kubernetes role limited to the `rims` namespace. *Pods*: IRSA role per service account if pods call AWS APIs (e.g. `secretsmanager:GetSecretValue` for External Secrets). |
| **Monitoring** | Container Insights or Prometheus/Grafana; CloudWatch Logs (the API emits JSON logs with `requestId`); alarms on ALB 5xx, pod restarts, RDS CPU/free storage/connections, and on integration events stuck in `failed/dead` (`GET /integrations/status`). |
| **Backups / DR** | RDS automated backups + manual snapshot before every release; PITR enabled; copy snapshots cross-region (and use a cross-region read replica or Aurora Global Database for a warm standby). Define RPO/RTO (suggested: RPO ≤ 5 min via PITR, RTO ≤ 1 h). Test restore quarterly. Images are in ECR (replicate cross-region). All infrastructure and manifests are in Git so the cluster can be recreated. |

## 3. Deploy
Jenkins (`Jenkinsfile`) does: install → lint → typecheck → unit tests → integration tests against a throwaway MySQL → build → Docker build → Cypress against Compose → push to ECR (main only) → **manual approval** → run migration Job → apply manifests → wait for rollout → auto-rollback of images on failure.
Manual equivalent:
```bash
export ECR_REGISTRY=<acct>.dkr.ecr.<region>.amazonaws.com IMAGE_TAG=<git-sha>
aws eks update-kubeconfig --name rims-prod --region <region>
kubectl apply -f k8s/00-namespace-config.yaml          # then create rims-secrets (External Secrets or kubectl)
envsubst < k8s/40-migrate-job.yaml | kubectl apply -f - && kubectl -n rims wait --for=condition=complete job/rims-migrate-$IMAGE_TAG --timeout=300s
for f in k8s/10-backend.yaml k8s/20-frontend.yaml k8s/30-ingress.yaml; do envsubst < $f | kubectl apply -f -; done
kubectl -n rims rollout status deploy/rims-backend && kubectl -n rims rollout status deploy/rims-frontend
```
First production setup: create the first Admin by running the seed once in a non-production-guarded way is **not** supported (seed refuses `NODE_ENV=production`). Insert the first Admin with a one-off SQL statement (bcrypt hash generated with `node -e "console.log(require('bcryptjs').hashSync('<password>',12))"`) into `users` + `user_roles`, then create everyone else through the UI.

## 4. Rollback
* **Application**: `kubectl -n rims rollout undo deploy/rims-backend deploy/rims-frontend` (or redeploy a previous `IMAGE_TAG`).
* **Database**: migrations are **forward-only**. Write migrations to be backward-compatible with the previous app version (add columns/tables first; remove them in a later release). Before each release take an RDS snapshot; if a migration itself must be reverted, restore the snapshot to a new instance (or PITR to just before the migration), repoint `DB_HOST`, and redeploy the previous image. Never edit an applied migration file; add a new one.

## 5. Migrations procedure
`npm run migrate` (or `node backend/dist/migrate.js`) applies `backend/migrations/*.sql` in filename order and records each in `schema_migrations`. Run it as a Job *before* the new Deployment rolls out. Name new files `003_description.sql`, etc.

## 6. Operating the integration worker
The worker runs in every backend replica; claiming events with an atomic `UPDATE … WHERE status IN ('pending','failed')` prevents duplicate processing. `INTEGRATION_WORKER_INTERVAL_MS`, `INTEGRATION_BACKOFF_BASE_MS`, `INTEGRATION_BACKOFF_MAX_MS` tune it.
