# Prompt 20: DevOps Skills Bundle

## Goal

Ship the **DevOps + SRE + cloud + monitoring + incident-response** skill bundle — 20 curated `SKILL.md` files that the skills loader (prompt 18) auto-discovers. These give the assistant domain-specific operational knowledge (kubectl, HCL, Prometheus PromQL, SLOs, runbooks, postmortems) so it can help with infra work and on-call without inventing wrong commands.

## Context (from prompts 01-19)

- Skills discovery service scans `bundled/<name>/SKILL.md` plus project + user paths (prompt 18)
- Frontmatter validated against `SkillFrontmatterSchema` (prompt 18)
- Programming bundle (25 skills) already shipped in prompt 19
- Skill format spec: `../../07-ai-skill-definition.md` — **read this first if you haven't**

**Sources these skills are curated from** (all MIT/Apache 2.0 — see Notes):
- [`wshobson/agents`](https://github.com/wshobson/agents) — 156 skills, heavy on DevOps (kubectl, terraform, AWS, CI/CD)
- [`antigravity-awesome-skills`](https://github.com/sickn33/antigravity-awesome-skills) — 560 skills
- Official docs: kubernetes.io, terraform.io, prometheus.io, grafana.com, cloudflare.com

## Task

### Step 1: Create bundle directories

```bash
cd kilocode-assistant
mkdir -p packages/runtime/src/skill/bundled
```

(Already created in prompt 19 — reusing.)

### Step 2: SKILL.md template reminder

Every skill uses the template from prompt 19 (frontmatter + body with When to invoke / Core patterns / Anti-patterns / Examples / Related skills / References).

### Step 3: Containers — `kubernetes-deployment`

`packages/runtime/src/skill/bundled/kubernetes-deployment/SKILL.md`:

```markdown
---
name: kubernetes-deployment
displayName: Kubernetes Deployment
description: Kubernetes — kubectl, Deployments, Services, Ingress, ConfigMap/Secret, probes, rollout strategies. Use when writing manifests or operating workloads on a cluster.
whenToUse:
  - Deploy to Kubernetes
  - Write or review K8s manifests
  - Debug pod scheduling or networking
  - Configure autoscaling and probes
version: 1.0.0
author: curated from wshobson/agents + kubernetes.io docs
license: MIT
tags: [kubernetes, k8s, kubectl, deployment, ingress, helm]
agents: [build, sre-engineer, devops]
tools: [read, write, edit, bash]
load: on-demand
---

# Kubernetes Deployment

Core Kubernetes primitives and the day-to-day commands you actually run.

## When to invoke

- Writing a Deployment / Service / Ingress manifest
- Debugging CrashLoopBackOff, ImagePullBackOff, Pending pods
- Choosing between Deployment, StatefulSet, DaemonSet, Job
- Configuring liveness vs readiness probes
- Setting up HPA / VPA / KEDA

## Core patterns

### Deployment + Service + Ingress

\`\`\`yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: web }
spec:
  replicas: 3
  selector: { matchLabels: { app: web } }
  template:
    metadata: { labels: { app: web } }
    spec:
      containers:
        - name: web
          image: ghcr.io/me/web:1.2.3
          ports: [{ containerPort: 8080 }]
          readinessProbe:
            httpGet: { path: /healthz, port: 8080 }
            periodSeconds: 5
          resources:
            requests: { cpu: 100m, memory: 128Mi }
            limits:   { cpu: 500m, memory: 512Mi }
---
apiVersion: v1
kind: Service
metadata: { name: web }
spec:
  selector: { app: web }
  ports: [{ port: 80, targetPort: 8080 }]
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata: { name: web }
spec:
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend: { service: { name: web, port: { number: 80 } } }
\`\`\`

### Probes

- **startupProbe** — slow-starting apps (don't kill before they boot)
- **livenessProbe** — restart if deadlocked (must NOT depend on external services)
- **readinessProbe** — remove from Service endpoints when not ready

### kubectl day-to-day

\`\`\`bash
kubectl get pods -A
kubectl describe pod <name>
kubectl logs -f <pod> -c <container>
kubectl rollout status deploy/web
kubectl rollout undo deploy/web
kubectl port-forward svc/web 8080:80
kubectl exec -it <pod> -- sh
kubectl top pods -A
\`\`\`

### HPA on CPU + custom metrics

\`\`\`yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: { name: web }
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: web }
  minReplicas: 2
  maxReplicas: 20
  metrics:
    - type: Resource
      resource: { name: cpu, target: { type: Utilization, averageUtilization: 70 } }
\`\`\`

### Workload choice

- **Deployment** — stateless
- **StatefulSet** — stable network ID, persistent storage per pod
- **DaemonSet** — one pod per node (logging, agents)
- **Job / CronJob** — run to completion

## Anti-patterns

❌ **Latest tag in production** — pins nothing; rollouts are non-deterministic.
❌ **No resource requests/limits** — scheduler can't bin-pack; noisy neighbors.
❌ **Liveness probe calling external dependencies** — DB outage kills all pods.
❌ **`kubectl apply -f` of an untrusted manifest** — read it first.
❌ **`hostNetwork: true`** without thinking — bypasses the network plugin.

## Related skills

- `helm-chart-scaffolding` — package manifests
- `docker-security-hardening` — build the image
- `monitoring-expert` — observe it

## References

- [Kubernetes documentation](https://kubernetes.io/docs/home/)
- [kubectl cheat sheet](https://kubernetes.io/docs/reference/kubectl/cheatsheet/)
```

### Step 4: `helm-chart-scaffolding`

`packages/runtime/src/skill/bundled/helm-chart-scaffolding/SKILL.md`:

```markdown
---
name: helm-chart-scaffolding
displayName: Helm Chart Scaffolding
description: Helm — Chart.yaml, templates, values, helpers, release management, OCI registries. Use when packaging Kubernetes manifests for templated deployment.
whenToUse:
  - Create or update a Helm chart
  - Template values into manifests
  - Publish a chart to a registry (OCI)
  - Manage release lifecycle
version: 1.0.0
author: curated from wshobson/agents + helm.sh docs
license: MIT
tags: [helm, kubernetes, charts, templates, oci, k8s]
agents: [build, devops, sre-engineer]
tools: [read, write, edit, bash]
load: on-demand
---

# Helm Chart Scaffolding

Helm v3 charts. OCI registries are the default.

## When to invoke

- Scaffolding a new chart
- Templating a manifest with values
- Adding a subchart dependency
- Linting and packaging a chart

## Core patterns

### `helm create` then trim

\`\`\`bash
helm create mychart
rm -rf mychart/templates/tests mychart/templates/deployment.yaml
\`\`\`

### `Chart.yaml`

\`\`\`yaml
apiVersion: v2
name: web
description: Web frontend
type: application
version: 1.2.3
appVersion: "2.4.1"
dependencies:
  - name: postgresql
    version: 15.x.x
    repository: oci://registry-1.docker.io/bitnamicharts
    condition: postgresql.enabled
\`\`\`

### `values.yaml` schema

\`\`\`yaml
replicaCount: 3
image:
  repository: ghcr.io/me/web
  tag: ""           # overridden by CI with appVersion
  pullPolicy: IfNotPresent
service:
  type: ClusterIP
  port: 80
ingress:
  enabled: true
  className: nginx
  hosts:
    - host: app.example.com
      paths: [{ path: /, pathType: Prefix }]
resources:
  requests: { cpu: 100m, memory: 128Mi }
  limits:   { cpu: 500m, memory: 512Mi }
\`\`\`

### Templates use values via `{{ .Values.x }}`

\`\`\`yaml
# templates/deployment.yaml
spec:
  replicas: {{ .Values.replicaCount }}
  template:
    spec:
      containers:
        - name: {{ .Chart.Name }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
\`\`\`

### Helpers

\`\`\`gotemplate
{{/* templates/_helpers.tpl */}}
{{- define "web.fullname" -}}
{{- $n := list .Release.Name .Chart.Name | join "-" -}}
{{- printf "%s" $n | trunc 63 | trimSuffix "-" -}}
{{- end -}}
\`\`\`

### Lint + template locally

\`\`\`bash
helm lint .
helm template myrelease . -f values.prod.yaml
helm install myrelease . --namespace app --create-namespace
helm upgrade --install myrelease . -f values.prod.yaml
helm rollback myrelease 1
\`\`\`

### OCI registry

\`\`\`bash
helm registry login registry-1.docker.io -u user
helm push ./web-1.2.3.tgz oci://registry-1.docker.io/me
helm install web oci://registry-1.docker.io/me/web --version 1.2.3
\`\`\`

## Anti-patterns

❌ **Hardcoding image tags in templates** — values or Chart.yaml only.
❌ **No `appVersion`** — release notes lose info.
❌ **Skipping `helm lint`** in CI — broken charts ship.
❌ **Using `if eq .Values.foo "true"` for booleans** — use `{{ if .Values.foo }}`.
❌ **Mixing `helm install` and `helm upgrade --install` randomly** — pick one per project.

## Related skills

- `kubernetes-deployment` — what the chart deploys
- `deployment-pipeline-design` — CI for charts

## References

- [Helm docs](https://helm.sh/docs/)
- [Chart template guide](https://helm.sh/docs/chart_template_guide/)
```

### Step 5: `docker-security-hardening`

`packages/runtime/src/skill/bundled/docker-security-hardening/SKILL.md`:

```markdown
---
name: docker-security-hardening
displayName: Docker Security Hardening
description: Docker — multi-stage builds, distroless base images, non-root user, .dockerignore, layer caching, image scanning, SBOM. Use when authoring or hardening container images.
whenToUse:
  - Write a Dockerfile
  - Reduce image size and attack surface
  - Run container as non-root
  - Scan images for CVEs
version: 1.0.0
author: curated from wshobson/agents + Docker docs
license: MIT
tags: [docker, container, security, distroless, multi-stage, sbom]
agents: [build, devops, security-reviewer]
tools: [read, write, edit, bash]
load: on-demand
---

# Docker Security Hardening

Hardened Dockerfiles. Smaller + fewer packages + non-root + scanned.

## When to invoke

- Authoring a production Dockerfile
- Reducing image size / build time
- Meeting a security review checklist
- Generating SBOMs for compliance

## Core patterns

### Multi-stage build

\`\`\`dockerfile
# Build stage
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

# Runtime stage — distroless or minimal
FROM gcr.io/distroless/nodejs22-debian12
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
USER nonroot:nonroot
EXPOSE 3000
CMD ["dist/server.js"]
\`\`\`

### `.dockerignore`

\`\`\`
.git
node_modules
dist
.env*
*.log
.vscode
.idea
Dockerfile
docker-compose*.yml
\`\`\`

### Non-root user

\`\`\`dockerfile
RUN addgroup --system --gid 1001 app && \\
    adduser  --system --uid 1001 --gid 1001 --no-create-home app
USER 1001:1001
\`\`\`

### Layer caching

- Order COPY from least-changed → most-changed (package files first, source last).
- Use `--mount=type=cache` (BuildKit) for package managers: `RUN --mount=type=cache,target=/root/.bun bun install`.

### Image scanning in CI

\`\`\`bash
trivy image --severity HIGH,CRITICAL ghcr.io/me/web:1.2.3
grype ghcr.io/me/web:1.2.3
syft ghcr.io/me/web:1.2.3 -o spdx-json > sbom.spdx.json
\`\`\`

### SBOM in image

\`\`\`dockerfile
RUN syft . -o spdx-json --source-dir /app > /sbom.spdx.json
\`\`\`

## Anti-patterns

❌ **`FROM ubuntu:latest`** — huge, CVEs, unstable.
❌ **`COPY . .` then `RUN npm ci`** — invalidates cache on any file change.
❌ **Running as root** (`USER root` default) — privilege escalation surface.
❌ **`apt-get install` without cleanup** — bloats image; missing `rm -rf /var/lib/apt/lists/*`.
❌ **Storing secrets in layers** (`ENV SECRET=…`) — visible in image history forever. Use BuildKit secrets or runtime mounts.

## Related skills

- `container-security-hardening` — runtime hardening
- `kubernetes-deployment` — where it runs
- `docker-security-hardening` — companion skill

## References

- [Dockerfile best practices](https://docs.docker.com/build/building/best-practices/)
- [Distroless images](https://github.com/GoogleContainerTools/distroless)
```

### Step 6: `k8s-manifest-generator`

`packages/runtime/src/skill/bundled/k8s-manifest-generator/SKILL.md`:

```markdown
---
name: k8s-manifest-generator
displayName: K8s Manifest Generator
description: Generate Kubernetes manifests for common workloads — web app, worker, cron, ingress, HPA. Use when scaffolding a new service's K8s deployment.
whenToUse:
  - Scaffold K8s manifests for a new service
  - Add a CronJob or worker Deployment
  - Set up Ingress + TLS
  - Add HPA + PDB + NetworkPolicy
version: 1.0.0
author: curated from wshobson/agents + kubernetes.io docs
license: MIT
tags: [kubernetes, k8s, manifests, generator, deployment, cronjob]
agents: [build, devops]
tools: [read, write, edit]
load: on-demand
---

# K8s Manifest Generator

Scaffolding patterns for common Kubernetes workloads.

## When to invoke

- New service needs a deployment + service + ingress
- Adding a cron-style worker
- Locking down with NetworkPolicy / PDB
- Auto-scaling on CPU and custom metrics

## Core patterns

### Web service — full set

\`\`\`yaml
apiVersion: apps/v1
kind: Deployment          # web.yaml
---
apiVersion: v1
kind: Service
---
apiVersion: networking.k8s.io/v1
kind: Ingress              # with TLS via cert-manager
metadata: { annotations: { cert-manager.io/cluster-issuer: letsencrypt-prod } }
spec:
  tls:
    - hosts: [app.example.com]
      secretName: app-tls
  rules:
    - host: app.example.com
      http:
        paths: [{ path: /, pathType: Prefix, backend: { service: { name: web, port: { number: 80 } } } }]
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata: { name: web }
spec:
  minAvailable: 1
  selector: { matchLabels: { app: web } }
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: web }
spec:
  podSelector: { matchLabels: { app: web } }
  policyTypes: [Ingress, Egress]
  ingress:
    - from:
        - namespaceSelector: { matchLabels: { name: ingress-nginx } }
      ports: [{ protocol: TCP, port: 8080 }]
  egress:
    - to:
        - namespaceSelector: { matchLabels: { name: db } }
      ports: [{ protocol: TCP, port: 5432 }]
\`\`\`

### CronJob

\`\`\`yaml
apiVersion: batch/v1
kind: CronJob
metadata: { name: cleanup }
spec:
  schedule: "15 3 * * *"
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      backoffLimit: 3
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: cleanup
              image: ghcr.io/me/cleanup:1.0.0
              args: ["--days=30"]
\`\`\`

### Worker (queue consumer)

\`\`\`yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: worker }
spec:
  replicas: 3
  selector: { matchLabels: { app: worker } }
  template:
    metadata: { labels: { app: worker } }
    spec:
      containers:
        - name: worker
          image: ghcr.io/me/worker:1.0.0
          env:
            - { name: DATABASE_URL, valueFrom: { secretKeyRef: { name: db, key: url } } }
\`\`\`

### HPA on CPU + memory

\`\`\`yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: { name: web }
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: web }
  minReplicas: 2
  maxReplicas: 20
  metrics:
    - { type: Resource, resource: { name: cpu, target: { type: Utilization, averageUtilization: 70 } } }
    - { type: Resource, resource: { name: memory, target: { type: Utilization, averageUtilization: 80 } } }
\`\`\`

## Anti-patterns

❌ **No PDB** — nodes drain, all pods evicted, downtime.
❌ **No NetworkPolicy** — flat cluster, easy lateral movement.
❌ **Secrets in env vars for high-trust workloads** — mount as files instead.
❌ **Single-replica Deployment for stateful apps** — use StatefulSet.
❌ **CronJob with no `concurrencyPolicy`** — overlap can corrupt state.

## Related skills

- `kubernetes-deployment` — primitives
- `helm-chart-scaffolding` — package these
- `secret-scanner` — catch leaked secrets before commit

## References

- [NetworkPolicy recipes](https://github.com/ahmetb/kubernetes-network-policy-recipes)
- [PodDisruptionBudget docs](https://kubernetes.io/docs/concepts/workloads/pods/disruptions/)
```

### Step 7: `container-security-hardening`

`packages/runtime/src/skill/bundled/container-security-hardening/SKILL.md`:

```markdown
---
name: container-security-hardening
displayName: Container Security Hardening
description: Runtime container hardening — read-only root FS, drop capabilities, seccomp/AppArmor profiles, securityContext best practices. Use when locking down pod security.
whenToUse:
  - Lock down pod securityContext
  - Set up seccomp or AppArmor profiles
  - Pass a Pod Security Standards audit
  - Drop Linux capabilities
version: 1.0.0
author: curated from wshobson/agents + Kubernetes docs
license: MIT
tags: [kubernetes, security, pod-security, seccomp, apparmor, capabilities]
agents: [build, devops, security-reviewer]
tools: [read, write, edit, bash]
load: on-demand
---

# Container Security Hardening

Runtime hardening for Kubernetes pods. Target: Pod Security Standards `restricted` profile.

## When to invoke

- Setting `securityContext` for a pod
- Choosing a seccomp profile
- Meeting a CIS / PCI compliance bar
- Investigating a runtime security alert

## Core patterns

### `securityContext` — pod + container

\`\`\`yaml
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    runAsGroup: 1000
    fsGroup: 1000
    seccompProfile: { type: RuntimeDefault }
  containers:
    - name: web
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities: { drop: [ALL] }
      volumeMounts:
        - { name: tmp, mountPath: /tmp }
\`\`\`

### Read-only root FS

\`\`\`yaml
volumes:
  - name: tmp
    emptyDir: { medium: Memory, sizeLimit: 64Mi }
\`\`\`

### Seccomp

- `RuntimeDefault` — drop ~30 dangerous syscalls. Recommended default.
- `Localhost` — reference a custom profile (`/var/lib/kubelet/seccomp/<name>.json`).
- `Unconfined` — for debugging only.

### AppArmor (annotation)

\`\`\`yaml
metadata:
  annotations:
    container.apparmor.security.beta.kubernetes.io/web: runtime/default
\`\`\`

### Network policies

See `k8s-manifest-generator` — deny-all + explicit allow-list per service.

### Pod Security Standards admission

\`\`\`yaml
apiVersion: v1
kind: Namespace
metadata:
  name: app
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
\`\`\`

## Anti-patterns

❌ **`privileged: true`** — almost never needed.
❌ **`runAsUser: 0`** or implicit root — major audit finding.
❌ **`hostPath` mounts** — escape to the node.
❌ **`hostNetwork: true`** — bypasses the CNI.
❌ **`allowPrivilegeEscalation: true`** (the default!) — set `false`.

## Related skills

- `docker-security-hardening` — image-side hardening
- `security-reviewer` — broader audit
- `kubernetes-deployment` — host context

## References

- [Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/)
- [Kubernetes Security Checklist](https://kubernetes.io/docs/concepts/security/security-checklist/)
```

### Step 8: IaC — `terraform-infrastructure`

`packages/runtime/src/skill/bundled/terraform-infrastructure/SKILL.md`:

```markdown
---
name: terraform-infrastructure
displayName: Terraform Infrastructure
description: Terraform — HCL syntax, providers, modules, state, workspaces, drift detection. Use when authoring or operating Terraform IaC.
whenToUse:
  - Write Terraform configuration
  - Design modules
  - Manage state (S3, GCS, Terraform Cloud)
  - Run plan/apply in CI
version: 1.0.0
author: curated from wshobson/agents + terraform.io docs
license: MIT
tags: [terraform, hcl, iac, modules, state, aws, gcp]
agents: [build, devops, sre-engineer]
tools: [read, write, edit, bash]
load: on-demand
---

# Terraform Infrastructure

Idiomatic Terraform (1.5+). Modules + remote state + CI-driven applies.

## When to invoke

- Authoring or reviewing HCL
- Designing a reusable module
- Setting up remote state
- Wiring `plan` into CI / PR checks

## Core patterns

### Module structure

\`\`\`
modules/
└── web/
    ├── main.tf
    ├── variables.tf
    ├── outputs.tf
    ├── versions.tf
    └── README.md
\`\`\`

### `versions.tf` — pin provider + Terraform

\`\`\`hcl
terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.40" }
  }
}
\`\`\`

### Variables

\`\`\`hcl
variable "replica_count" {
  type        = number
  default     = 3
  description = "Number of web replicas"
  validation {
    condition     = var.replica_count >= 1 && var.replica_count <= 100
    error_message = "replica_count must be between 1 and 100."
  }
}
\`\`\`

### Resource

\`\`\`hcl
resource "aws_instance" "web" {
  ami           = data.aws_ami.ubuntu.id
  instance_type = "t3.small"
  tags = {
    Name = "web-${var.env}"
  }
}
\`\`\`

### Remote state (S3 + DynamoDB lock)

\`\`\`hcl
terraform {
  backend "s3" {
    bucket         = "myorg-tfstate"
    key            = "app/prod/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "myorg-tflock"
    encrypt        = true
  }
}
\`\`\`

### CI workflow

\`\`\`bash
terraform init -backend-config=env.hcl
terraform validate
terraform fmt -check -recursive
terraform plan -out=tfplan -var-file=prod.tfvars
# (manual approval)
terraform apply tfplan
\`\`\`

### Module composition

\`\`\`hcl
module "web" {
  source      = "../modules/web"
  env         = "prod"
  replica_count = 5
}
\`\`\`

## Anti-patterns

❌ **State in local files in CI** — lost between runs.
❌ **Hardcoded secrets in `.tf`** — use AWS Secrets Manager / SSM / Vault.
❌ **No `required_version` / `required_providers`** — silent upgrade surprises.
❌ **`count` for resources with stable keys** — use `for_each` (avoids index shifting).
❌ **Apply on every push to main** — require human approval for prod.

## Related skills

- `aws-skills` — what you're provisioning
- `deployment-pipeline-design` — TF in CI
- `kubernetes-deployment` — common target

## References

- [Terraform docs](https://developer.hashicorp.com/terraform/docs)
- [Gruntwork IaC Library](https://github.com/gruntwork-io/terragrunt)
```

### Step 9: `terraform-engineer`

`packages/runtime/src/skill/bundled/terraform-engineer/SKILL.md`:

```markdown
---
name: terraform-engineer
displayName: Terraform Engineer
description: Advanced Terraform — module composition, workspaces vs file-per-env, moved blocks, refactoring state, drift detection, Terraform Cloud / Atlantis. Use when operating Terraform at scale.
whenToUse:
  - Refactor Terraform state
  - Move from one state file to another
  - Run Atlantis or Terraform Cloud
  - Compare workspaces vs dir-per-env
version: 1.0.0
author: curated from wshobson/agents + terraform.io docs
license: MIT
tags: [terraform, hcl, state, workspaces, moved, refactor, atlantis]
agents: [build, devops, sre-engineer]
tools: [read, write, edit, bash]
load: on-demand
---

# Terraform Engineer

Beyond module authoring — operating Terraform across many environments and teams.

## When to invoke

- Splitting a monolithic state file
- Renaming or moving resources without destruction
- Setting up Atlantis / Terraform Cloud
- Choosing workspaces vs dir-per-env

## Core patterns

### `moved` block (1.1+) — rename without destroy

\`\`\`hcl
moved {
  from = aws_instance.web
  to   = aws_instance.app
}
\`\`\`

### `import` block (1.5+) — adopt existing infra

\`\`\`hcl
import {
  to = aws_s3_bucket.logs
  id = "my-logs-bucket"
}
\`\`\`

### Workspace vs dir-per-env

- **Workspaces** — same code, separate state. Good for identical infra per tenant/region. Limited for prod/staging divergence.
- **Dir-per-env** — explicit `prod/`, `staging/` folders; reads from `prod.tfvars`. Better when configs diverge.

\`\`\`
envs/
├── prod/
│   ├── main.tf
│   └── prod.tfvars
└── staging/
    ├── main.tf
    └── staging.tfvars
\`\`\`

### Atlantis — PR-driven plan

\`\`\`yaml
# atlantis.yaml
version: 3
projects:
  - name: app-prod
    dir: envs/prod
    workspace: prod
    terraform_version: 1.6.0
    autoplan:
      when_modified: ["*.tf", "prod.tfvars"]
      enabled: true
\`\`\`

### Drift detection

\`\`\`bash
terraform plan -detailed-exitcode   # 0=clean, 1=error, 2=drift
terraform plan -refresh-only        # sync state without changes
\`\`\`

### Module refactor pattern — move a resource between modules

1. `terraform state mv module.a.aws_s3_bucket.logs module.b.aws_s3_bucket.logs`
2. Update HCL.
3. `terraform plan` — should be empty.

## Anti-patterns

❌ **Manual edits to `terraform.tfstate`** — corrupts state; use `terraform state` commands.
❌ **Storing state alongside code in Git** — leaks secrets in state.
❌ **Importing via IDs in CLI when HCL `import` block is available** — non-portable.
❌ **Workspaces for very different environments** — dir-per-env is clearer.
❌ **`lifecycle { prevent_destroy = true }` without testing** — blocks legit teardown.

## Related skills

- `terraform-infrastructure` — base authoring
- `aws-skills` — common targets
- `deployment-pipeline-design` — TF in CI

## References

- [Refactoring Terraform modules](https://developer.hashicorp.com/terraform/language/modules/develop/refactoring)
- [Atlantis docs](https://www.runatlantis.io/docs/)
```

### Step 10: Cloud — `aws-skills`

`packages/runtime/src/skill/bundled/aws-skills/SKILL.md`:

```markdown
---
name: aws-skills
displayName: AWS Skills
description: AWS core services — VPC, EC2, IAM, S3, Lambda, RDS, CloudFront, ECS/Fargate, Route 53. Use when designing or operating AWS infrastructure.
whenToUse:
  - Design an AWS architecture
  - Write IAM policies
  - Set up VPC networking
  - Choose between ECS, Lambda, and EKS
version: 1.0.0
author: curated from wshobson/agents + aws.amazon.com docs
license: MIT
tags: [aws, ec2, iam, s3, lambda, vpc, rds, cloudfront, fargate]
agents: [build, devops, sre-engineer]
tools: [read, write, edit, bash]
load: on-demand
---

# AWS Skills

AWS service-by-service patterns. Service-agnostic architecture advice at the end.

## When to invoke

- Picking between ECS / Fargate / Lambda / EKS
- Writing IAM least-privilege policies
- Designing a multi-AZ VPC
- Setting up CDN + cache

## Core patterns

### VPC — 3 AZs, public + private subnets

\`\`\`
VPC 10.0.0.0/16
├── public   10.0.0.0/24, 10.0.1.0/24, 10.0.2.0/24   (NAT gateway, ALB)
├── private  10.0.10.0/24, 10.0.11.0/24, 10.0.12.0/24  (ECS, Lambda ENI)
└── data     10.0.20.0/24, 10.0.21.0/24, 10.0.22.0/24  (RDS, ElastiCache)
\`\`\`

### IAM — least privilege, no `*` on actions or resources

\`\`\`json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:GetObject", "s3:PutObject"],
    "Resource": ["arn:aws:s3:::my-bucket", "arn:aws:s3:::my-bucket/*"]
  }]
}
\`\`\`

Always prefer AWS-managed policies as a starting point, then narrow.

### S3 — public access blocked, versioning + lifecycle

\`\`\`json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "DenyInsecureTransport",
    "Effect": "Deny",
    "Principal": "*",
    "Action": "s3:*",
    "Resource": ["arn:aws:s3:::my-bucket", "arn:aws:s3:::my-bucket/*"],
    "Condition": { "Bool": { "aws:SecureTransport": "false" } }
  }]
}
\`\`\`

### Lambda — small, with DLQ + reserved concurrency

\`\`\`ts
export const handler = async (event: SQSEvent) => {
    for (const rec of event.Records) await processRecord(rec)
}
\`\`\`

- Use ARM/Graviton2 (`Architectures: ["arm64"]`) — 20% cheaper, faster.
- Set `ReservedConcurrentExecutions` to cap concurrent invocations.

### RDS — Multi-AZ, encryption, parameter group, IAM auth

\`\`\`
db.t4g.medium, Multi-AZ, 100GB gp3, encryption at rest, IAM auth, automated backups 7d
\`\`\`

### CloudFront — OAC for S3, Lambda@Edge / CloudFront Functions

\`\`\`
S3 (private) ← OAC ← CloudFront ← Route53 (alias)
                       ↓
                ACM cert (us-east-1 for CF)
\`\`\`

## Service choice

| Need | Pick |
|---|---|
| Always-on HTTP service | ECS Fargate or EKS |
| Bursty, short tasks | Lambda |
| Long-running, stateful | EC2 / ECS EC2 / EKS |
| Hosted Kubernetes | EKS |
| Object storage | S3 |
| Relational DB | RDS / Aurora |
| Key-value cache | ElastiCache (Redis) / DAX |
| Pub/sub | SNS + SQS / EventBridge |

## Anti-patterns

❌ **`Principal: "*"` + `Action: "*"`** — admin-by-default.
❌ **Public S3 bucket** — use CloudFront + OAC or signed URLs.
❌ **Lambda in VPC for no reason** — adds 30s ENI cold-start. Only put in VPC if you need private resources.
❌ **Single NAT gateway in prod** — AZ failure = outage. One per AZ.
❌ **No `aws:SecureTransport` deny on S3 / API Gateway** — silent HTTP exposure.

## Related skills

- `terraform-infrastructure` — provision it
- `cloudflare-workers-expert` — alternative edge
- `monitoring-expert` — observe it

## References

- [AWS Well-Architected](https://aws.amazon.com/architecture/well-architected/)
- [AWS IAM best practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)
```

### Step 11: `cloudflare-workers-expert`

`packages/runtime/src/skill/bundled/cloudflare-workers-expert/SKILL.md`:

```markdown
---
name: cloudflare-workers-expert
displayName: Cloudflare Workers Expert
description: Cloudflare Workers — Workers, KV, D1, R2, Queues, Durable Objects, Hyperdrive, Workers AI. Use when building edge applications on Cloudflare.
whenToUse:
  - Build a Cloudflare Worker
  - Use D1 (SQLite at the edge), KV, R2, Queues
  - Design with Durable Objects
  - Bind resources via wrangler.toml
version: 1.0.0
author: curated from wshobson/agents + developers.cloudflare.com
license: MIT
tags: [cloudflare, workers, kv, d1, r2, durable-objects, edge, wrangler]
agents: [build, devops]
tools: [read, write, edit, bash]
load: on-demand
---

# Cloudflare Workers Expert

Cloudflare's edge platform. Workers run V8 isolates worldwide.

## When to invoke

- Building an edge API / middleware
- Choosing between KV, D1, R2, Durable Objects
- Configuring `wrangler.toml` bindings
- Connecting to Postgres via Hyperdrive

## Core patterns

### Worker entry

\`\`\`ts
export interface Env {
  DB: D1Database
  KV: KVNamespace
  BUCKET: R2Bucket
  AI: Ai
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === "/api/items") {
      const { results } = await env.DB.prepare("SELECT * FROM items").all()
      return Response.json(results)
    }
    return new Response("Not found", { status: 404 })
  }
}
\`\`\`

### wrangler.toml bindings

\`\`\`toml
name = "my-worker"
main = "src/index.ts"
compatibility_date = "2025-01-01"

[[kv_namespaces]]
binding = "KV"
id = "abc123"

[[d1_databases]]
binding = "DB"
database_name = "my-db"
database_id = "def456"

[[r2_buckets]]
binding = "BUCKET"
bucket_name = "my-bucket"
\`\`\`

### D1 (SQLite) — read replication, batched writes

\`\`\`ts
const stmt = env.DB.prepare("INSERT INTO items (name) VALUES (?)").bind("a")
await env.DB.batch([stmt, stmt2, stmt3])
\`\`\`

Migrations: `wrangler d1 migrations apply DB`

### KV — eventual consistency, high read volume

- Best for: config, sessions, feature flags.
- Not for: strong consistency, frequent writes.

### R2 — S3-compatible object storage, no egress fees

### Durable Objects — single-writer per key, globally unique

\`\`\`ts
export class Counter implements DurableObject {
  state: DurableObjectState
  constructor(state: DurableObjectState) { this.state = state }
  async fetch(req: Request): Promise<Response> {
    const count = (await this.state.storage.get<number>("count")) ?? 0
    await this.state.storage.put("count", count + 1)
    return new Response(String(count + 1))
  }
}
\`\`\`

### Hyperdrive — connection pooling for Postgres

\`\`\`toml
[[hyperdrive]]
binding = "HYPERDRIVE"
id = "..."
\`\`\`

### Workers AI — server-side inference

\`\`\`ts
const res = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
  messages: [{ role: "user", content: prompt }]
})
\`\`\`

## Anti-patterns

❌ **CPU-heavy sync code on the main isolate** — use `ctx.waitUntil` or Workers AI.
❌ **Storing large blobs in KV** (limits: 25 MB value, 1 KB key) — use R2.
❌ **D1 for global write-heavy workloads** — primary is single-region; reads replicate.
❌ **No `compatibility_date`** — silent breaking changes on rollout.
❌ **Secrets in code** — use `wrangler secret put NAME`.

## Related skills

- `aws-skills` — alternative cloud
- `hono` — common Workers framework
- `vector-search` — for RAG at the edge

## References

- [Cloudflare Workers docs](https://developers.cloudflare.com/workers/)
- [D1 docs](https://developers.cloudflare.com/d1/)
```

### Step 12: CI/CD — `github-actions-advanced`

`packages/runtime/src/skill/bundled/github-actions-advanced/SKILL.md`:

```markdown
---
name: github-actions-advanced
displayName: GitHub Actions Advanced
description: GitHub Actions — workflows, composite actions, matrix builds, secrets, reusable workflows, OIDC for cloud. Use when building or debugging CI on GitHub.
whenToUse:
  - Author a GitHub Actions workflow
  - Create a composite or reusable action
  - Use OIDC to assume a cloud role
  - Build a matrix across OS / runtime versions
version: 1.0.0
author: curated from wshobson/agents + docs.github.com
license: MIT
tags: [github-actions, ci, workflows, matrix, oidc, composite-actions]
agents: [build, devops]
tools: [read, write, edit, bash]
load: on-demand
---

# GitHub Actions Advanced

GitHub Actions (GHA) patterns. Reusable workflows + OIDC + matrix.

## When to invoke

- Designing CI for a multi-package monorepo
- Authoring a composite action for shared setup
- Authenticating to AWS/GCP/Azure without long-lived keys (OIDC)
- Cutting CI minutes (caching, path filters, concurrency)

## Core patterns

### Workflow skeleton

\`\`\`yaml
name: ci
on:
  push: { branches: [main] }
  pull_request: {}
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
        with: { bun-version: latest }
      - run: bun install --frozen-lockfile
      - run: bun test
\`\`\`

### Composite action

\`\`\`yaml
# .github/actions/setup/action.yml
name: "Setup"
description: "Install Bun + cache deps"
inputs: { bun-version: { default: latest } }
runs:
  using: composite
  steps:
    - uses: oven-sh/setup-bun@v1
      with: { bun-version: ${{ inputs.bun-version }} }
    - uses: actions/cache@v4
      with:
        path: ~/.bun/install/cache
        key: bun-${{ runner.os }}-${{ hashFiles('**/bun.lock') }}
    - shell: bash
      run: bun install --frozen-lockfile
\`\`\`

### Reusable workflow

\`\`\`yaml
# .github/workflows/_lint.yml
on:
  workflow_call:
    inputs: { node-version: { type: string, default: "20" } }
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: ${{ inputs.node-version }} }
      - run: npm ci && npm run lint
\`\`\`

Call from another workflow:

\`\`\`yaml
jobs:
  lint:
    uses: ./.github/workflows/_lint.yml
    with: { node-version: "22" }
\`\`\`

### OIDC to AWS (no static keys)

\`\`\`yaml
permissions:
  id-token: write
  contents: read
steps:
  - uses: aws-actions/configure-aws-credentials@v4
    with:
      role-to-assume: arn:aws:iam::123:role/github-actions
      aws-region: us-east-1
\`\`\`

Trust policy on the role allows `token.actions.githubusercontent.com:sub` matching `repo:myorg/myrepo:ref:refs/heads/main`.

### Matrix

\`\`\`yaml
strategy:
  fail-fast: false
  matrix:
    os: [ubuntu-latest, macos-latest, windows-latest]
    bun: [20, 21, 22]
runs-on: ${{ matrix.os }}
\`\`\`

### Path filter

\`\`\`yaml
on:
  push:
    paths:
      - "src/**"
      - "package.json"
      - ".github/workflows/ci.yml"
\`\`\`

## Anti-patterns

❌ **Long-lived cloud access keys in secrets** — use OIDC.
❌ **`actions/checkout@v1`** — outdated; use `@v4`.
❌ **No `concurrency` cancel-in-progress** — wasted CI minutes on stale PRs.
❌ **Hardcoded `npm ci` / `bun install`** in every job — use a composite action.
❌ **`if: success()` instead of `if: ${{ always() }}` for cleanup** — leaks resources on failure.

## Related skills

- `deployment-pipeline-design` — full pipeline
- `terraform-infrastructure` — common CI target
- `secret-scanner` — prevent leaks in CI

## References

- [GitHub Actions docs](https://docs.github.com/actions)
- [OIDC for AWS](https://docs.github.com/actions/security-for-github-actions/security-guides/automatic-token-authentication)
```

### Step 13: `gitlab-ci-patterns`

`packages/runtime/src/skill/bundled/gitlab-ci-patterns/SKILL.md`:

```markdown
---
name: gitlab-ci-patterns
displayName: GitLab CI Patterns
description: GitLab CI/CD — pipelines, stages, jobs, artifacts, includes, child pipelines, multi-project pipelines, container registry. Use when building or migrating CI on GitLab.
whenToUse:
  - Build a GitLab CI pipeline
  - Use includes for shared templates
  - Pass artifacts between stages
  - Set up merge request pipelines
version: 1.0.0
author: curated from wshobson/agents + docs.gitlab.com
license: MIT
tags: [gitlab-ci, pipelines, stages, artifacts, includes, container-registry]
agents: [build, devops]
tools: [read, write, edit, bash]
load: on-demand
---

# GitLab CI Patterns

`.gitlab-ci.yml` patterns. DAG + child pipelines for complex flows.

## When to invoke

- Authoring a multi-stage pipeline
- Using `include` for shared templates
- Setting up merge request pipelines
- Building Docker images in CI

## Core patterns

### Pipeline with stages

\`\`\`yaml
stages: [lint, test, build, deploy]

variables:
  DOCKER_TLS_CERTDIR: ""

lint:
  stage: lint
  image: node:22
  script: [npm ci, npm run lint]

test:
  stage: test
  image: node:22
  services: [postgres:16]
  variables: { POSTGRES_DB: app_test }
  script: [npm ci, npm test]
  artifacts:
    when: always
    reports: { junit: junit.xml }

build:
  stage: build
  image: docker:24
  services: [docker:24-dind]
  script:
    - docker build -t $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA .
    - docker push $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
\`\`\`

### `include` for shared templates

\`\`\`yaml
include:
  - local: "ci/lint.yml"
  - project: "myorg/ci-templates"
    ref: "v1.0.0"
    file: "/templates/docker-build.yml"
\`\`\`

### `needs:` for DAG (skip stages)

\`\`\`yaml
deploy-prod:
  stage: deploy
  needs: ["build", "test-prod"]
  script: [deploy.sh prod]
\`\`\`

### Child pipelines (dynamic generation)

\`\`\`yaml
generate-config:
  stage: build
  script: [generate-config.sh > child.yml]
  artifacts: { paths: [child.yml] }

deploy:
  stage: deploy
  trigger:
    include:
      - artifact: child.yml
    strategy: depend
\`\`\`

### Merge request pipelines

\`\`\`yaml
workflow:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == "main"
    - if: $CI_PIPELINE_SOURCE == "schedule"
\`\`\`

### Caching

\`\`\`yaml
cache:
  key: ${CI_COMMIT_REF_SLUG}
  paths: [node_modules/]
\`\`\`

## Anti-patterns

❌ **`latest` tag for service images** — version drift between runs.
❌ **No `rules:` on deploy jobs** — deploys on every push.
❌ **Storing secrets in `.gitlab-ci.yml`** — use CI/CD variables (masked + protected).
❌ **No `artifacts: expire_in`** — runners fill up.
❌ **Long pipelines running in MRs** — use `merge_request_event` workflow rules to skip slow jobs.

## Related skills

- `github-actions-advanced` — alternative CI
- `deployment-pipeline-design` — multi-env promotion
- `docker-security-hardening` — building images

## References

- [GitLab CI/CD docs](https://docs.gitlab.com/ee/ci/)
```

### Step 14: `deployment-pipeline-design`

`packages/runtime/src/skill/bundled/deployment-pipeline-design/SKILL.md`:

```markdown
---
name: deployment-pipeline-design
displayName: Deployment Pipeline Design
description: Multi-stage deployment pipelines — build → test → stage → canary → prod, with gates, approvals, and rollbacks. Use when designing CI/CD for a service.
whenToUse:
  - Design a multi-env deployment pipeline
  - Add manual or automated gates between stages
  - Implement canary or blue/green
  - Wire rollback on health-check failure
version: 1.0.0
author: curated from wshobson/agents + continuousdelivery.com
license: MIT
tags: [cicd, deployment, canary, blue-green, pipeline, approval, rollback]
agents: [build, devops, sre-engineer]
tools: [read, write, edit, bash]
load: on-demand
---

# Deployment Pipeline Design

Pipeline as a graph, not a line. Stages are bounded; transitions are gated.

## When to invoke

- Designing a deploy flow for a new service
- Adding canary/blue-green to existing pipelines
- Wiring automated rollback on error rate
- Adding human approval gates

## Core patterns

### Stage taxonomy

\`\`\`
commit → build → unit → integration → security → deploy:dev → smoke
       → deploy:staging → e2e → manual-approval → deploy:prod (canary)
       → monitor SLOs (15 min) → full rollout
\`\`\`

### Environment + approvals (GitHub Actions example)

\`\`\`yaml
jobs:
  deploy-prod:
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://app.example.com
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with: { role-to-assume: ${{ secrets.AWS_ROLE }} }
      - run: ./scripts/deploy.sh prod
\`\`\`

The `production` environment in GitHub can require reviewers.

### Canary (Kubernetes example)

\`\`\`
v1 stable  →  99% traffic
v2 canary  →  1% traffic → 5% → 25% → 100%
\`\`\`

Use Argo Rollouts or Flagger; auto-promote on SLO, auto-abort on error budget burn.

### Blue/Green

- Deploy v2 alongside v1 (separate Deployment or service).
- Switch Service selector atomically.
- Keep v1 alive for N minutes for rollback.

### Automated rollback

\`\`\`ts
const abort = async () => {
    const errorRate = await getErrorRate("5m")
    const p99       = await getLatency("p99", "5m")
    if (errorRate > 0.01 || p99 > 1000) {
        await rollbacks.canaryAbort()
        await alert("canary aborted", { errorRate, p99 })
    }
}
\`\`\`

### Database migrations

- **Expand-migrate-contract**: deploy v1 schema, then v2 code, then contract old columns.
- Never deploy a breaking migration in the same release as the code that uses it.
- Feature flags gate new code paths.

## Anti-patterns

❌ **No staging** — surprises in prod.
❌ **No automatic rollback** — MTTR suffers.
❌ **Manual steps documented in a wiki** — encode in pipeline.
❌ **Same artifact promoted through environments with rebuilds** — rebuilds can differ.
❌ **Long-lived branches** — trunk-based, deploy from main.

## Related skills

- `github-actions-advanced` / `gitlab-ci-patterns` — implementer
- `kubernetes-deployment` — target
- `monitoring-expert` — SLO source for rollback

## References

- [Continuous Delivery (Humble, Farley)](https://continuousdelivery.com/)
- [Argo Rollouts](https://argo-rollouts.readthedocs.io/)
```

### Step 15: `changelog-automation`

`packages/runtime/src/skill/bundled/changelog-automation/SKILL.md`:

```markdown
---
name: changelog-automation
displayName: Changelog Automation
description: Conventional commits, Changesets, release-please, semantic-release. Use when automating version bumps and CHANGELOG.md from commit messages.
whenToUse:
  - Set up Changesets for a monorepo
  - Use release-please on GitHub
  - Adopt conventional commits
  - Automate CHANGELOG.md generation
version: 1.0.0
author: curated from wshobson/agents + changesets/cli, release-please
license: MIT
tags: [changelog, conventional-commits, changesets, release-please, semver]
agents: [build, devops]
tools: [read, write, edit, bash]
load: on-demand
---

# Changelog Automation

Generate CHANGELOG.md + bump versions from commit messages.

## When to invoke

- Setting up versioning for a monorepo
- Migrating from manual bumps to Changesets
- Adopting release-please on GitHub
- Enforcing conventional commits

## Core patterns

### Conventional commits

\`\`\`
feat(api): add /users/:id endpoint
fix(auth): handle expired refresh token
feat!: drop /v1/users (BREAKING CHANGE)
docs(readme): update setup instructions
chore(deps): bump react to 19.0.0
\`\`\`

### Changesets (monorepo-friendly)

\`\`\`bash
bunx changeset
# prompts: which packages, semver bump, summary
# writes .changeset/<random-name>.md
\`\`\`

Then in CI:

\`\`\`bash
bunx changeset version   # bumps versions, updates CHANGELOGs
bunx changeset publish   # publishes packages with @changesets/cli
\`\`\`

`.changeset/config.json` (already created in prompt 01):
\`\`\`json
{ "changelog": "@changesets/cli/changelog", "commit": false, "linked": [] }
\`\`\`

### release-please (single-package GitHub projects)

- Opens PRs labeled "autorelease: pending" with version bumps + CHANGELOG.
- Merging the PR creates the tag + GitHub release.

Set up:
\`\`\`
.github/workflows/release-please.yml
\`\`\`

\`\`\`yaml
on:
  push:
    branches: [main]
jobs:
  release-please:
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@v4
        with: { release-type: node }
        env: { GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }} }
\`\`\`

### Commit linting with commitlint

\`\`\`bash
bun add -d @commitlint/{cli,config-conventional}
echo "module.exports = { extends: ['@commitlint/config-conventional'] }" > commitlint.config.js
\`\`\`

Enforce in CI:

\`\`\`yaml
- uses: wagoid/commitlint-github-action@v5
\`\`\`

## Anti-patterns

❌ **Manual version bumps in package.json** — drift across packages.
❌ **`chore: bump`** commits that don't follow conventional format — release tooling ignores them.
❌ **Mixing Changesets and release-please** — pick one.
❌ **Squash merges with auto-generated messages** — destroys conventional format. Configure squash to use PR title.
❌ **No `BREAKING CHANGE:` footer** — silently ships breaking changes as minor.

## Related skills

- `git-advanced-workflows` — branch/merge patterns
- `github-actions-advanced` — CI integration

## References

- [Changesets docs](https://github.com/changesets/changesets)
- [release-please](https://github.com/googleapis/release-please)
```

### Step 16: Monitoring — `sre-engineer`

`packages/runtime/src/skill/bundled/sre-engineer/SKILL.md`:

```markdown
---
name: sre-engineer
displayName: SRE Engineer
description: SRE — SLIs, SLOs, error budgets, runbooks, incident response, blameless postmortems, capacity planning. Use when designing reliability practices.
whenToUse:
  - Define an SLO for a service
  - Run or participate in an incident
  - Write a postmortem
  - Plan capacity
version: 1.0.0
author: curated from wshobson/agents + sre.google/sre-book
license: MIT
tags: [sre, slo, sli, error-budget, runbook, incident, postmortem]
agents: [build, devops, sre-engineer]
tools: [read, write, edit, bash]
load: on-demand
---

# SRE Engineer

Site Reliability Engineering practices. Focus on SLOs and error budgets, not uptime percentages.

## When to invoke

- Defining an SLO for a new service
- Computing error budget burn rate
- Writing or reviewing a runbook
- Conducting a postmortem

## Core patterns

### Define an SLO

\`\`\`yaml
service: checkout-api
slis:
  - name: availability
    spec: ratio(successful_requests, total_requests)
    filter: 'status_class != "5xx"'
  - name: latency
    spec: ratio(fast_requests, total_requests)
    filter: 'http_server_requests_seconds_bucket{le="0.5"}'
slos:
  - sli: availability
    objective: 99.9%
    window: 30d
  - sli: latency
    objective: 99.0%   # 99% of requests < 500ms
    window: 30d
\`\`\`

### Error budget

\`\`\`
30-day budget for 99.9% availability = 0.1% × 30d = 43.2 minutes of downtime allowed
\`\`\`

When budget burns faster than time elapses, freeze risky deploys.

### Alerting on SLOs (not symptoms)

Multi-window, multi-burn-rate alerts (Google SRE workbook):

\`\`\`
Fast burn (1h window, 14.4x rate)  → page immediately
Slow burn (6h window, 6x rate)    → ticket
\`\`\`

### Runbook structure

\`\`\`markdown
# Runbook: checkout-api 5xx spike
## Summary
One-line description.
## Severity
SEV-2 / SEV-3.
## Detection
Alert name, dashboard link.
## Triage
1. Check [dashboard](…)
2. Recent deploys?
3. Upstream dependencies (DB, payment processor)?
## Mitigation
- Rollback: \`./scripts/rollback.sh checkout-api\`
- Feature flag off: \`./scripts/ff.sh checkout disabled\`
- Scale up: \`kubectl scale deploy/checkout-api --replicas=20\`
## Communication
#incident channel template.
\`\`\`

### Blameless postmortem template

\`\`\`markdown
# Postmortem: <incident title>
**Date:** 2026-… | **Severity:** SEV-2 | **Duration:** 47m | **Author:** …

## Summary
Two sentences, plain language.

## Impact
What users saw, in numbers (X% of requests failed for Y minutes).

## Timeline (UTC)
- 14:02 deploy of v1.2.3 begins
- 14:07 alert fires: 5xx > 2%
- 14:14 incident declared
- 14:31 rolled back
- 14:49 all clear

## Root cause
DB connection pool exhausted by a long-running query introduced in v1.2.3.

## What went well
…

## What didn't
…

## Action items
- [ ] Add connection pool metric + alert (owner, due date)
- [ ] Add load test for N+1 paths (owner, due date)
\`\`\`

## Anti-patterns

❌ **Uptime percentage without SLO** — no budget, no prioritization.
❌ **Alerting on CPU % / disk %** — symptoms, not user pain. Alert on SLI breach.
❌ **Blaming an individual in the postmortem** — focus on systems.
❌ **Runbooks that describe what the system is, not what to do** — operational steps only.
❌ **No severity definitions** — every incident feels like SEV-1.

## Related skills

- `monitoring-expert` — telemetry pipeline
- `incident-runbook-templates` — more runbook patterns
- `postmortem-writing` — detailed template

## References

- [Google SRE Book (free)](https://sre.google/sre-book/table-of-contents/)
- [SLO workbook](https://sre.google/workbook/alerting-on-slos/)
```

### Step 17: `monitoring-expert`

`packages/runtime/src/skill/bundled/monitoring-expert/SKILL.md`:

```markdown
---
name: monitoring-expert
displayName: Monitoring Expert
description: Observability — metrics (Prometheus), logs (Loki/ELK), traces (Tempo/Jaeger), OpenTelemetry, RED/USE methods, dashboards. Use when setting up observability for a service.
whenToUse:
  - Instrument an application with OpenTelemetry
  - Design a Prometheus + Grafana stack
  - Build RED-method dashboards
  - Set up structured logging
version: 1.0.0
author: curated from wshobson/agents + opentelemetry.io
license: MIT
tags: [observability, prometheus, grafana, opentelemetry, logs, traces, metrics]
agents: [build, devops, sre-engineer]
tools: [read, write, edit, bash]
load: on-demand
---

# Monitoring Expert

Three pillars: metrics, logs, traces. One pipeline: OpenTelemetry.

## When to invoke

- Adding telemetry to a service
- Choosing metrics vs logs vs traces for a question
- Designing dashboards
- Setting up log shipping

## Core patterns

### RED method (services)

- **R**ate — requests/sec
- **E**rrors — error rate
- **D**uration — latency distribution

### USE method (resources)

- **U**tilization — % time busy
- **S**aturation — queue depth
- **E**rrors — error events

### OpenTelemetry SDK (Node.js)

\`\`\`ts
import { NodeSDK } from "@opentelemetry/sdk-node"
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"

new NodeSDK({
  traceExporter: new OTLPTraceExporter({ url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT }),
  instrumentations: [getNodeAutoInstrumentations()],
}).start()
\`\`\`

### Prometheus metrics

\`\`\`ts
import { Counter, Histogram, Registry } from "prom-client"

const registry = new Registry()
const requests = new Counter({ name: "http_requests_total", help: "...", labelNames: ["method", "path", "status"], registers: [registry] })
const latency  = new Histogram({ name: "http_request_duration_seconds", help: "...", labelNames: ["method", "path"], buckets: [0.01, 0.05, 0.1, 0.5, 1, 5], registers: [registry] })
\`\`\`

### Structured logs (pino)

\`\`\`ts
log.info({ userId, route }, "user created")
\`\`\`

Ship to Loki via Promtail or via OTel logs.

### Exemplars — link traces to metrics

\`\`\`ts
requests.inc({ method, path, status })
   // then attach trace_id:
   .observe({ trace_id: ctx.traceId })
\`\`\`

Click a spike in Grafana → see exemplars → jump to trace.

### Dashboards

- Service overview: RED + saturation
- Per-route: latency p50/p95/p99
- Dependency: DB pool, external API
- Business: orders/min, errors by type

## Anti-patterns

❌ **High-cardinality labels** (user IDs, request IDs) — Prometheus cardinality explosion.
❌ **Logging the entire request body on every request** — disk + cost.
❌ **Metrics without units** — `http_request_duration` (seconds? ms?).
❌ **Traces sampled at 100% in prod** — costs. Sample 1-10% with head-based or tail-based.
❌ **Custom metric names without a namespace** — `requests_total` collides.

## Related skills

- `prometheus-configuration` — scrape config
- `grafana-dashboards` — dashboard JSON
- `sre-engineer` — SLOs on top

## References

- [OpenTelemetry docs](https://opentelemetry.io/docs/)
- [Prometheus naming](https://prometheus.io/docs/practices/naming/)
- [RED method](https://www.weave.works/blog/the-red-method-key-metrics-for-microservices-architecture/)
```

### Step 18: `prometheus-configuration`

`packages/runtime/src/skill/bundled/prometheus-configuration/SKILL.md`:

```markdown
---
name: prometheus-configuration
displayName: Prometheus Configuration
description: Prometheus — scrape config, relabeling, recording rules, alerting rules, federation, remote_write, exporters. Use when configuring Prometheus for a fleet.
whenToUse:
  - Configure Prometheus scrape jobs
  - Write PromQL recording rules
  - Set up federation or remote_write
  - Use node_exporter / kube-state-metrics
version: 1.0.0
author: curated from wshobson/agents + prometheus.io
license: MIT
tags: [prometheus, promql, scrape-config, recording-rules, alerting, exporters]
agents: [build, devops, sre-engineer]
tools: [read, write, edit, bash]
load: on-demand
---

# Prometheus Configuration

Prometheus operator patterns + raw config.

## When to invoke

- Adding a new scrape target
- Writing recording rules for common aggregates
- Designing alert rules
- Migrating to managed Prometheus / remote_write

## Core patterns

### Scrape config

\`\`\`yaml
scrape_configs:
  - job_name: kubernetes-pods
    kubernetes_sd_configs: [{ role: pod }]
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
        action: keep
        regex: "true"
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_path]
        action: replace
        target_label: __metrics_path__
        regex: (.+)
      - source_labels: [__address__, __meta_kubernetes_pod_annotation_prometheus_io_port]
        action: replace
        regex: ([^:]+)(?::\d+)?;(\d+)
        replacement: $1:$2
        target_label: __address__
      - source_labels: [__meta_kubernetes_namespace]
        target_label: namespace
      - source_labels: [__meta_kubernetes_pod_name]
        target_label: pod
\`\`\`

### Recording rules

\`\`\`yaml
groups:
  - name: checkout-api
    interval: 30s
    rules:
      - record: job:checkout_api:request_rate_5m
        expr: sum by (path) (rate(http_requests_total{job="checkout-api"}[5m]))
      - record: job:checkout_api:error_ratio_5m
        expr: |
          sum by (path) (rate(http_requests_total{job="checkout-api",status=~"5xx"}[5m]))
          /
          sum by (path) (rate(http_requests_total{job="checkout-api"}[5m]))
\`\`\`

### Alerting rules

\`\`\`yaml
groups:
  - name: checkout-api
    rules:
      - alert: HighErrorRate
        expr: job:checkout_api:error_ratio_5m > 0.02
        for: 10m
        labels: { severity: page }
        annotations:
          summary: "Checkout API 5xx > 2% for 10m"
          runbook_url: https://runbooks.example.com/checkout-api-5xx
\`\`\`

### Alertmanager routing

\`\`\`yaml
route:
  receiver: "default"
  group_by: [alertname, cluster]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - matchers: [severity="page"]
      receiver: pagerduty
    - matchers: [severity="ticket"]
      receiver: jira
receivers:
  - name: pagerduty
    pagerduty_configs:
      - service_key: { from: pagerduty_key }
  - name: jira
    webhook_configs:
      - url: { from: jira_webhook_url }
\`\`\`

### Exporters

- `node_exporter` — host metrics
- `kube-state-metrics` — K8s object state
- `blackbox_exporter` — probes (HTTP, TCP, ICMP)

## Anti-patterns

❌ **No `relabel_configs`** — high-cardinality targets blow up Prometheus.
❌ **Alerting without `for:`** — flappy alerts.
❌ **Recording rules with `rate` and `sum` repeated** in alert expressions — pre-aggregate.
❌ **`honor_labels: true` everywhere** — label collisions with federation.
❌ **Storing months of data locally** — use remote_write to Thanos/Mimir/Cortex.

## Related skills

- `monitoring-expert` — overall observability
- `grafana-dashboards` — visualization
- `sre-engineer` — SLO alerting

## References

- [Prometheus docs](https://prometheus.io/docs/)
- [Recording rules best practices](https://prometheus.io/docs/practices/rules/)
```

### Step 19: `grafana-dashboards`

`packages/runtime/src/skill/bundled/grafana-dashboards/SKILL.md`:

```markdown
---
name: grafana-dashboards
displayName: Grafana Dashboards
description: Grafana — PromQL queries, variables, panel types, annotations, alerting, dashboard provisioning as code. Use when building or operating Grafana dashboards.
whenToUse:
  - Build a Grafana dashboard
  - Write PromQL for panels
  - Use templating variables
  - Provision dashboards from Git
version: 1.0.0
author: curated from wshobson/agents + grafana.com
license: MIT
tags: [grafana, dashboards, promql, variables, annotations, provisioning]
agents: [build, devops, sre-engineer]
tools: [read, write, edit, bash]
load: on-demand
---

# Grafana Dashboards

Grafana 11+. Provision from Git for reproducibility.

## When to invoke

- Building a service dashboard
- Designing variables for multi-env dashboards
- Annotating deploys / incidents
- Sharing dashboards via JSON / Helm

## Core patterns

### PromQL — common queries

\`\`\`promql
# Request rate per second
sum by (path) (rate(http_requests_total[5m]))

# p99 latency
histogram_quantile(0.99,
  sum by (le, path) (rate(http_request_duration_seconds_bucket[5m])))

# Error rate %
sum(rate(http_requests_total{status=~"5xx"}[5m]))
  /
sum(rate(http_requests_total[5m])) * 100

# Apdex (target 0.85+)
(sum(rate(http_request_duration_seconds_bucket{le="0.3"}[5m]))
  + sum(rate(http_request_duration_seconds_bucket{le="1.2"}[5m])))
  / 2
/ sum(rate(http_request_duration_seconds_count[5m]))
\`\`\`

### Variables

\`\`\`yaml
variables:
  - name: env
    type: query
    datasource: { type: prometheus, uid: prom }
    query: label_values(http_requests_total, env)
    current: { text: prod, value: prod }
  - name: service
    type: query
    query: label_values(http_requests_total{env="$env"}, service)
\`\`\`

Use in panels: `{env="$env", service="$service"}`

### Panel types

- **Time series** — rate, latency, saturation
- **Stat / Gauge** — current value, threshold
- **Bar gauge** — top-N
- **Heatmap** — latency distribution
- **Table** — per-route / per-tenant breakdown

### Annotations from deploys

\`\`\`yaml
# Grafana datasource: deploy events from Grafana
apiVersion: 1
datasources:
  - name: deploys
    type: grafana
    uid: deploys
\`\`\`

Use an annotation query tied to a marker like `deploy{env="prod"}`.

### Provisioning via Helm + sidecar

\`\`\`yaml
# values.yaml (grafana helm chart)
dashboardsConfigMaps:
  - name: dashboards-cm
    folder: /var/lib/grafana/dashboards
    key: dashboards.yaml
\`\`\`

\`\`\`yaml
# dashboards-cm ConfigMap
apiVersion: v1
kind: ConfigMap
metadata: { name: dashboards-cm }
data:
  dashboards.yaml: |
    - name: checkout-api
      json: |
        { ... full dashboard JSON ... }
\`\`\`

## Anti-patterns

❌ **Hardcoded env in panel queries** — use a variable.
❌ **Auto-refresh < 10s** in prod — overloads Prometheus.
❌ **Single mega-dashboard for 50 services** — split per-service + an overview.
❌ **No legend format** — `{{path}}` makes panels readable.
❌ **Ad-hoc dashboards never exported** — provision from Git or they rot.

## Related skills

- `prometheus-configuration` — query source
- `monitoring-expert` — overall observability
- `sre-engineer` — SLO panels

## References

- [Grafana docs](https://grafana.com/docs/grafana/latest/)
- [PromQL basics](https://prometheus.io/docs/prometheus/latest/querying/basics/)
```

### Step 20: `distributed-tracing`

`packages/runtime/src/skill/bundled/distributed-tracing/SKILL.md`:

```markdown
---
name: distributed-tracing
displayName: Distributed Tracing
description: Distributed tracing — OpenTelemetry, trace context propagation, sampling, span attributes, Tempo/Jaeger. Use when debugging latency across services.
whenToUse:
  - Add tracing to a service
  - Propagate trace context across HTTP / queues
  - Choose sampling strategy
  - Debug a slow trace in Tempo/Jaeger
version: 1.0.0
author: curated from wshobson/agents + opentelemetry.io
license: MIT
tags: [tracing, opentelemetry, tempo, jaeger, sampling, propagation]
agents: [build, devops, sre-engineer]
tools: [read, write, edit, bash]
load: on-demand
---

# Distributed Tracing

Trace context flows from edge to DB and back. Sampling keeps volume sane.

## When to invoke

- Adding OpenTelemetry tracing to a service
- Choosing sampling rate / strategy
- Linking traces to logs and metrics (exemplars)
- Debugging a slow cross-service request

## Core patterns

### Auto-instrumentation (Node)

\`\`\`ts
import { NodeSDK } from "@opentelemetry/sdk-node"
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { Resource } from "@opentelemetry/resources"
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions"

new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: "checkout-api",
    [SemanticResourceAttributes.SERVICE_VERSION]: process.env.GIT_SHA,
  }),
  traceExporter: new OTLPTraceExporter(),
  instrumentations: [getNodeAutoInstrumentations()],
}).start()
\`\`\`

### Manual spans

\`\`\`ts
import { trace } from "@opentelemetry/api"

const tracer = trace.getTracer("checkout-api")

async function checkout(order: Order) {
  return tracer.startActiveSpan("checkout", async (span) => {
    span.setAttribute("order.id", order.id)
    span.setAttribute("order.total", order.total)
    try {
      const payment = await tracer.startActiveSpan("payment.charge", async (s) => {
        const r = await payments.charge(order)
        s.setAttribute("payment.id", r.id)
        s.end()
        return r
      })
      await saveOrder(order, payment)
      span.end()
    } catch (err) {
      span.recordException(err as Error)
      span.setStatus({ code: 2, message: (err as Error).message })
      span.end()
      throw err
    }
  })
}
\`\`\`

### Context propagation

- HTTP: W3C `traceparent` header injected by auto-instrumentation.
- Message queues: inject context into message headers; extract on consume.
- DB: span around the query; many auto-instrumentations do this.

### Sampling

- **Head-based** — decide at trace start. Cheap, biased.
- **Tail-based** — keep traces with errors / slow spans. Better, requires collector.
- **Parent-based** — respect upstream decision. Default for distributed.

\`\`\`ts
import { ParentBasedSampler, TraceIdRatioBasedSampler } from "@opentelemetry/sdk-trace-base"
const sampler = new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(0.1) })
\`\`\`

### Span attributes

Follow semantic conventions where possible:

\`\`\`
http.method, http.route, http.status_code
db.system, db.statement
messaging.system, messaging.destination
\`\`\`

### Linking logs and traces

Include `trace_id` and `span_id` in log records:

\`\`\`ts
log.info({ trace_id: span.spanContext().traceId, span_id: span.spanContext().spanId }, "paid")
\`\`\`

In Grafana: jump from a trace to its logs (and vice versa).

## Anti-patterns

❌ **100% sampling in prod** — costs; missing context for tail-based at the collector.
❌ **Custom span names with PII / unbounded cardinality** — keep names low-cardinality (`http.route`, not full URL).
❌ **Spans around trivial operations** — adds noise and overhead.
❌ **No service.version attribute** — can't correlate with a specific build.
❌ **Re-creating the tracer per request** — singleton per process.

## Related skills

- `monitoring-expert` — overall observability
- `prometheus-configuration` — metrics context
- `nodejs-backend-patterns` — typical host

## References

- [OpenTelemetry tracing](https://opentelemetry.io/docs/concepts/signals/traces/)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
```

### Step 21: Incident — `on-call-handoff-patterns`

`packages/runtime/src/skill/bundled/on-call-handoff-patterns/SKILL.md`:

```markdown
---
name: on-call-handoff-patterns
displayName: On-Call Handoff Patterns
description: On-call rotation patterns — shift handoffs, escalation policies, paging fatigue, follow-the-sun. Use when designing or improving on-call.
whenToUse:
  - Design an on-call rotation
  - Run a shift handoff
  - Reduce paging fatigue
  - Set up escalation policies
version: 1.0.0
author: curated from wshobson/agents + incident response literature
license: MIT
tags: [on-call, incident, rotation, escalation, handoff, follow-the-sun]
agents: [devops, sre-engineer]
tools: [read, write, edit]
load: on-demand
---

# On-Call Handoff Patterns

Sustainable on-call is a product feature, not a chore.

## When to invoke

- Setting up a new on-call rotation
- Writing the shift handoff doc
- Reviewing on-call load (pages/week, MTTA, MTTR)
- Designing escalation policies

## Core patterns

### Rotation design

- **Length** — 1 week is the common sweet spot. Avoid < 24h (too disruptive).
- **Coverage** — primary + secondary. Optional: tertiary for global orgs.
- **Follow-the-sun** — handoff across time zones; no one carries overnight.
- **Compensation** — on-call stipend + per-page bonus or comp time.

### Escalation policy

\`\`\`
Level 1: primary on-call (5 min ack)
Level 2: secondary on-call (after 5 min)
Level 3: manager (after 15 min during business hours)
Level 4: incident commander rotation (for SEV-1)
\`\`\`

Configure in PagerDuty / Opsgenie / Grafana OnCall.

### Handoff document

\`\`\`markdown
# On-call handoff — week of 2026-06-15
**Outgoing:** @alice  **Incoming:** @bob

## Currently broken / in progress
- checkout-api 5xx elevated since Tue; @alice investigating.

## Open incidents / postmortems
- None.

## Recurring noise
- Pages from staging cluster at 02:00 — see #sre-noise ticket.

## Recent changes
- Tue 14:00 — promoted canary on orders-api.

## Things to watch
- Postgres primary failover next Tue (planned).
\`\`\`

### Reducing paging fatigue

- Tune thresholds against SLOs, not symptoms.
- Group related alerts (`group_by: [alertname, cluster]`).
- Use `repeat_interval: 4h` for tickets, not pages.
- Auto-resolve alerts when condition clears.
- Move noisy alerts to a "noise" channel — fix root cause, not the page.

### Personal on-call hygiene

- Acknowledge within 5 minutes even if you'll take longer to fix.
- Update the incident channel every 15 minutes during an active incident.
- Hand off open work explicitly — don't assume the next person has context.
- After the rotation: at least one full day off from paging.

## Anti-patterns

❌ **No secondary** — single point of failure if primary is asleep / on a flight.
❌ **Paging on every log error** — alert on user-visible symptoms.
❌ **Blaming the previous on-call for an open issue** — handoff is for handoff.
❌ **Same team on-call 24/7 with no rotation** — burnout.
❌ **Escalation to leadership immediately** — burns trust; leadership escalates too.

## Related skills

- `incident-runbook-templates` — what to do when paged
- `sre-engineer` — SLO-based alerting
- `postmortem-writing` — close the loop

## References

- [Google SRE Book: Being On-Call](https://sre.google/sre-book/being-on-call/)
- [PagerDuty docs: Escalation Policies](https://www.pagerduty.com/resources/learn/escalation-policy/)
```

### Step 22: `incident-runbook-templates`

`packages/runtime/src/skill/bundled/incident-runbook-templates/SKILL.md`:

```markdown
---
name: incident-runbook-templates
displayName: Incident Runbook Templates
description: Runbook templates for common incidents — service down, high error rate, DB connection storm, disk full, certificate expiry, dependency outage. Use when authoring or improving runbooks.
whenToUse:
  - Write a new runbook
  - Build a runbook template
  - Triage an active incident
  - Build a runbook library / wiki
version: 1.0.0
author: curated from wshobson/agents + incident response literature
license: MIT
tags: [incident, runbook, on-call, mitigation, triage]
agents: [devops, sre-engineer]
tools: [read, write, edit, bash]
load: on-demand
---

# Incident Runbook Templates

Templates + workflow for common incidents. Adapt to your stack.

## When to invoke

- Authoring a runbook for a recurring alert
- Triaging a live incident
- Building a runbook library
- Training new on-call

## Core patterns

### Runbook skeleton

\`\`\`markdown
# Runbook: <symptom>
**Owner:** @team  **Severity:** SEV-2  **Last tested:** 2026-04-01

## TL;DR
One-paragraph: what to check first, what to do.

## Detection
- Alert name(s): \`CheckoutApiHighErrorRate\`
- Dashboard: <link>

## Triage (first 5 minutes)
1. \`kubectl get pods -l app=checkout-api\` — are pods healthy?
2. \`kubectl logs -l app=checkout-api --tail=200\` — recent errors?
3. Recent deploys? \`kubectl rollout history deploy/checkout-api\`
4. Upstream: \`psql -c "SELECT 1"\` — DB healthy?

## Mitigation
- Roll back: \`./scripts/rollback.sh checkout-api\`
- Feature flag off: \`./scripts/ff.sh checkout disabled\`
- Scale: \`kubectl scale deploy/checkout-api --replicas=20\`
- Drain traffic: \`./scripts/drain.sh checkout-api\`

## Verification
- Error rate back below 0.5% in Grafana
- Latency p99 < 500ms

## Escalation
- 10 min unresolved → secondary on-call
- SEV-1 (data loss / security) → incident commander

## Postmortem
Within 5 business days if SEV-1/SEV-2.
\`\`\`

### Common runbooks (high-frequency incidents)

\`\`\`markdown
# Service down (5xx > 50%)
1. Check status page of dependencies (DB, cache, payment processor).
2. Roll back the most recent deploy.
3. Scale up if CPU-bound.
4. If DB issue, check \`pg_stat_activity\` for long queries.
5. Failover to read replica if primary is degraded.

# Disk full
1. \`df -h\` on the node.
2. \`du -sh /var/log/* | sort -h | tail\`
3. Rotate / truncate logs.
4. Expand volume (cloud console) if recurring.

# Certificate expiry
1. \`echo | openssl s_client -connect <host>:443 2>/dev/null | openssl x509 -noout -dates\`
2. Trigger cert-manager renewal: \`kubectl annotate cert <name> cert-manager.io/issue-temporary-certificate="true"\`
3. Long-term: rotate issuer / check DNS-01 challenge.

# DB connection storm
1. \`SELECT count(*) FROM pg_stat_activity;\` — at max_connections?
2. \`SELECT state, count(*) FROM pg_stat_activity GROUP BY state;\`
3. Kill long-idle: \`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle' AND query_start < now() - interval '5 min';\`
4. Fix leaking client; redeploy with pool tuning.
\`\`\`

### Runbook testing

- Schedule a quarterly game day.
- Pick a random runbook, follow it against a staging incident.
- Time it; update steps that were unclear.

## Anti-patterns

❌ **"Contact the team lead" as the only step** — encode the actual action.
❌ **Steps that require you to read code** — link the file, but the action should be a command.
❌ **No verification step** — how do you know it's fixed?
❌ **Out-of-date commands (kubectl context switches, namespace renames)** — test quarterly.
❌ **Runbook exists only in one engineer's head** — write it down.

## Related skills

- `on-call-handoff-patterns` — rotation design
- `sre-engineer` — SLO-based alerting
- `postmortem-writing` — close the loop

## References

- [Etsy Debriefing Culture](https://extfiles.etsy.com/DebriefingFacilitationGuide.pdf)
- [Jeli runbook patterns](https://www.jeli.io/)
```

### Step 23: `postmortem-writing`

`packages/runtime/src/skill/bundled/postmortem-writing/SKILL.md`:

```markdown
---
name: postmortem-writing
displayName: Postmortem Writing
description: Blameless postmortems — structure, timeline, root cause analysis (5 Whys, fishbone), action items, follow-through. Use when writing or reviewing a postmortem.
whenToUse:
  - Write a postmortem after an incident
  - Review a teammate's draft
  - Run a postmortem meeting
  - Track action items to closure
version: 1.0.0
author: curated from wshobson/agents + Etsy Debriefing, Google SRE
license: MIT
tags: [postmortem, incident, blameless, root-cause, action-items, 5-whys]
agents: [devops, sre-engineer]
tools: [read, write]
load: on-demand
---

# Postmortem Writing

Blameless postmortems focus on systems and signals, not individuals.

## When to invoke

- After any SEV-1 or SEV-2 incident
- When drafting the timeline
- During the postmortem meeting
- When reviewing a draft

## Core patterns

### Document structure

\`\`\`markdown
# Postmortem: <incident title>
**Date:** 2026-06-15  **Severity:** SEV-2  **Duration:** 47m  **Author(s):** @alice, @bob

## Summary
In plain language, what happened and what users saw.

## Impact
Quantify: % of requests affected, number of users, dollars lost, downstream effects.
Avoid vanity metrics ("uptime"). Use user-visible metrics.

## Timeline (UTC)
- 14:02 — deploy of checkout-api v1.2.3 begins
- 14:07 — automated alert fires: 5xx > 2%
- 14:14 — incident declared in #incidents; IC: @alice
- 14:22 — root cause hypothesis: new long-running query
- 14:31 — rolled back to v1.2.2
- 14:49 — error rate back to baseline; incident resolved

## Root cause
The deployment included a new endpoint that executed N+1 queries against the
orders table under load. Connection pool was exhausted, cascading to all endpoints.

### Contributing factors
- No load test covered the new endpoint.
- DB connection pool size not autoscale-aware.
- Alert threshold tuned for steady-state, not deploy windows.

## What went well
- Alert fired within 5 minutes of impact.
- Rollback was a single command; we exercised it within 7 minutes.
- Communication was clear in #incidents.

## What didn't
- Took 14 minutes to declare the incident (alert → ack → IC).
- No runbook for "DB connection storm"; debugged live.
- Postmortem owner was also the IC — split focus.

## Action items
| # | Action | Owner | Due |
|---|---|---|---|
| 1 | Add load test for all new endpoints | @carol | 2026-06-22 |
| 2 | Add connection-pool-saturation alert | @dave | 2026-06-18 |
| 3 | Author DB storm runbook | @alice | 2026-06-25 |
| 4 | Add deploy-window overshoot suppression | @bob | 2026-06-29 |

## Lessons
What did we learn about our systems, not about the people?
\`\`\`

### 5 Whys (when linear)

\`\`\`
Why did checkout-api return 5xx?
  → DB connection pool exhausted.
    Why was the pool exhausted?
      → Long-running query holding connections.
        Why was there a long query?
          → New endpoint missing a join index.
            Why was the index missing?
              → Schema change deployed without EXPLAIN review.
\`\`\`

### Fishbone (when multiple contributing factors)

\`\`\`
Environment:           Process:           People:
- prod DB load          - no review step    - on-call hadn't seen this before
- p95 elevated          - no runbook        - no load test author
Code:                   Tooling:           Communication:
- N+1 query             - alert was noisy   - slow escalation
- missing index         - no pool metric    - IC not designated early
\`\`\`

### Meeting agenda (60 min)

- 5 min — context, ground rules (blameless)
- 15 min — walk the timeline
- 15 min — root cause + contributing factors
- 15 min — action items (SMART, owned, dated)
- 10 min — recap, assign author

### Action item hygiene

- **SMART** — Specific, Measurable, Achievable, Relevant, Time-bound.
- **Owned** — exactly one name, not "team".
- **Tracked** — add to Jira / GitHub issues; review in monthly retro.
- **Closed or killed** — never silently dropped.

## Anti-patterns

❌ **Naming the human who made the mistake** — focus on the system.
❌ **Action items like "be more careful"** — not actionable.
❌ **Action items without owners or dates** — never happen.
❌ **Postmortem is one-shot** — track follow-through; close the loop.
❌ **Postmortem for SEV-3 only** — same rigor for SEV-1/2.

## Related skills

- `sre-engineer` — SLO context
- `incident-runbook-templates` — linked from postmortem
- `on-call-handoff-patterns` — rotation context

## References

- [Etsy Debriefing Facilitation Guide](https://extfiles.etsy.com/DebriefingFacilitationGuide.pdf)
- [Google SRE Book: Postmortem Culture](https://sre.google/sre-book/postmortem-culture/)
```

### Step 24: `chaos-engineer`

`packages/runtime/src/skill/bundled/chaos-engineer/SKILL.md`:

```markdown
---
name: chaos-engineer
displayName: Chaos Engineer
description: Chaos engineering — hypothesis-driven experiments, blast radius, steady state, observability, game days. Use when designing or running a chaos experiment.
whenToUse:
  - Design a chaos experiment
  - Run a game day
  - Validate a resilience claim
  - Pick a chaos tool
version: 1.0.0
author: curated from wshobson/agents + principlesofchaos.org
license: MIT
tags: [chaos-engineering, resilience, game-day, fault-injection, litmus, chaos-mesh]
agents: [devops, sre-engineer]
tools: [read, write, edit, bash]
load: on-demand
---

# Chaos Engineer

Hypothesis-driven fault injection. Goal: learn, not break.

## When to invoke

- Validating that a backup actually works
- Testing alert pages actually fire under load
- Verifying circuit breakers trip correctly
- Running a game day

## Core patterns

### Experiment lifecycle

1. **Define steady state** — what's the metric you expect to hold?
   \`\`\`
   Steady state: checkout-api 5xx ratio < 0.5%, p99 latency < 500ms.
   \`\`\`
2. **Hypothesis** — if I inject fault X, will Y happen?
   \`\`\`
   If we kill one DB primary, the service will fail over within 30s
   and error rate will spike briefly (<2m) but recover.
   \`\`\`
3. **Blast radius** — start small. One region, one service, one instance.
4. **Inject** — use a tool, not kubectl delete.
5. **Observe** — dashboards + traces.
6. **Rollback / abort** — stop the experiment if user impact > expected.
7. **Learn** — write up findings; close gaps.

### Tools

- **Chaos Mesh** — Kubernetes-native. Pod kill, network, IO, time.
- **LitmusChaos** — broader ecosystem; experiment portal.
- **AWS Fault Injection Service** — region/zone outages.
- **Gremlin** — multi-cloud.

### Common experiments

\`\`\`yaml
# Chaos Mesh: pod kill
apiVersion: chaos-mesh.org/v1alpha1
kind: PodChaos
metadata: { name: pod-kill }
spec:
  action: pod-kill
  mode: one
  selector:
    namespaces: [app]
    labelSelectors: { app: checkout-api }
  duration: "30s"
  scheduler: { cron: "@every 5m" }
\`\`\`

- **Latency injection** — Chaos Mesh `NetworkChaos` with `delay: 200ms`.
- **Packet loss** — `NetworkChaos` with `loss: { corruption: 0 }`.
- **DNS fault** — `StressChaos` on the DNS path, or returnNXDOMAIN via CoreDNS patching.
- **Resource pressure** — `StressChaos` for CPU/memory.

### Game day agenda

\`\`\`markdown
# Game Day: DB failover
**Date:** …  **Participants:** …

## Hypothesis
Primary DB killed → replica promoted → checkout-api auto-recovers in <2m.

## Setup
- Production traffic shifted to staging replica for the test.
- All SREs + on-call in #gd-room.
- Rollback plan documented.

## Runbook
1. T-15: announce in #announce.
2. T-0: kill primary.
3. Observe: failover time, error rate, p99.
4. T+10: declare outcome.
5. Write findings within 24h.

## Success criteria
- Failover < 30s.
- Error rate < 2% for < 2m.
\`\`\`

### Pre-flight checklist

- [ ] Blast radius approved by service owner.
- [ ] Rollback path known and tested.
- [ ] Stakeholders notified (status page if customer-facing).
- [ ] Observability in place (metrics + logs + traces).
- [ ] Abort criteria defined.

## Anti-patterns

❌ **Running chaos in prod without a hypothesis** — entertainment, not engineering.
❌ **Production blast radius too large first try** — start at 1% of pods.
❌ **No abort criteria** — hope is not a strategy.
❌ **Skipping observability** — "did it work?" requires metrics.
❌ **Chaos only on someone else's code** — bias toward learning.

## Related skills

- `sre-engineer` — SLO context
- `incident-runbook-templates` — what chaos verifies
- `kubernetes-deployment` — common target

## References

- [Principles of Chaos](https://principlesofchaos.org/)
- [Chaos Mesh docs](https://chaos-mesh.org/docs/)
```

### Step 25: Verify all 20 skills load

```bash
cd kilocode-assistant
bun -e '
import { loadAllSkills } from "./packages/runtime/src/skill/loader.ts"
const r = loadAllSkills({ cwd: process.cwd() })
const devops = r.skills.filter(s =>
  ["kubernetes-deployment","helm-chart-scaffolding","docker-security-hardening",
   "k8s-manifest-generator","container-security-hardening",
   "terraform-infrastructure","terraform-engineer",
   "aws-skills","cloudflare-workers-expert",
   "github-actions-advanced","gitlab-ci-patterns","deployment-pipeline-design","changelog-automation",
   "sre-engineer","monitoring-expert","prometheus-configuration","grafana-dashboards","distributed-tracing",
   "on-call-handoff-patterns","incident-runbook-templates","postmortem-writing","chaos-engineer"
  ].includes(s.frontmatter.name)
)
console.log("devops-bundle:", devops.length, "skills loaded")
console.log("any errors:", r.errors)
'
```

### Step 26: Commit

```bash
git add -A
git commit -m "feat(skills): devops bundle — 22 SKILL.md files (k8s/iaac/cloud/cicd/monitoring/incident) (prompt 20)"
```

## Files created

```
packages/runtime/src/skill/bundled/
├── kubernetes-deployment/SKILL.md
├── helm-chart-scaffolding/SKILL.md
├── docker-security-hardening/SKILL.md
├── k8s-manifest-generator/SKILL.md
├── container-security-hardening/SKILL.md
├── terraform-infrastructure/SKILL.md
├── terraform-engineer/SKILL.md
├── aws-skills/SKILL.md
├── cloudflare-workers-expert/SKILL.md
├── github-actions-advanced/SKILL.md
├── gitlab-ci-patterns/SKILL.md
├── deployment-pipeline-design/SKILL.md
├── changelog-automation/SKILL.md
├── sre-engineer/SKILL.md
├── monitoring-expert/SKILL.md
├── prometheus-configuration/SKILL.md
├── grafana-dashboards/SKILL.md
├── distributed-tracing/SKILL.md
├── on-call-handoff-patterns/SKILL.md
├── incident-runbook-templates/SKILL.md
├── postmortem-writing/SKILL.md
└── chaos-engineer/SKILL.md
```

(22 new skills; total bundled after prompt 19 + 20: 47.)

## Acceptance criteria

- [ ] 22 new `SKILL.md` files exist
- [ ] Total bundled skills = 47 (1 from prompt 18 + 24 from 19 + 22 from 20)
- [ ] Every SKILL.md frontmatter validates
- [ ] Every SKILL.md body has substantive content (≥ 50 lines)
- [ ] `loadAllSkills` returns all 22 new skills with source = `bundled`
- [ ] No errors in `result.errors`
- [ ] `matchSkills({ prompt: "deploy to kubernetes with terraform" })` returns top-3 hits from this bundle
- [ ] `skill_invoke("sre-engineer")` returns the full body
- [ ] `git commit` succeeds

## Verification

```bash
cd kilocode-assistant
bun run typecheck

# Count
ls packages/runtime/src/skill/bundled/ | wc -l
# → 47

# Smoke test: list + match
bun -e '
import { loadAllSkills } from "./packages/runtime/src/skill/loader.ts"
import { matchSkills } from "./packages/runtime/src/skill/match.ts"
const r = loadAllSkills({ cwd: process.cwd() })
console.log("total:", r.skills.length)
const matches = matchSkills({ prompt: "design an SLO for a payments service running on kubernetes", skills: r.skills, topN: 5 })
matches.forEach(m => console.log(\`\${m.score} \${m.skill.frontmatter.name} — \${m.reasons.slice(0, 2).join(", ")}\`))
'

# End-to-end via CLI
bun run kilo run "design SLOs for checkout-api and write an alert rule" --agent sre-engineer
```

## Notes

- **All skills sourced from public OSS** (frontmatter `author:` per skill):
  - [`wshobson/agents`](https://github.com/wshobson/agents) — MIT — heavy DevOps coverage
  - [`antigravity-awesome-skills`](https://github.com/sickn33/antigravity-awesome-skills) — MIT
  - Official docs: kubernetes.io, terraform.io, prometheus.io, grafana.com, developers.cloudflare.com, docs.github.com, docs.gitlab.com, opentelemetry.io, sre.google
- **All content is original prose** — patterns synthesized from those sources, not copy-pasted. License: MIT.
- **Distinct from programming bundle** — no language/web skills here; strictly infra/ops.
- **`sre-engineer` is the canonical agent for these skills** — the agent registry (prompt 13) lists `sre-engineer` as a first-class agent name. Other skills list `build`, `devops`, `security-reviewer` as appropriate.
- **`chaos-engineer` pairs with `sre-engineer`** — same agent persona, different skill. The matcher will surface both for "validate our failover works".
- **Some skills are explicitly cross-cutting** (e.g. `monitoring-expert`, `sre-engineer`) — they appear in multiple skills' `related skills` sections deliberately.
- **Why `k8s-manifest-generator` AND `kubernetes-deployment`** — the first is "give me a manifest for this workload" (template-driven); the second is "teach me Kubernetes" (reference). Different intents.
- **`docker-security-hardening` vs `container-security-hardening`** — image-side vs runtime-side. Common pairing in audit checklists.
- **No `azure-functions` / `gcp-cloud-run` skill in this prompt** — moved to prompt 22's additional bundles (with attribution to `antigravity-awesome-skills`).
- **`pci-compliance` / `gdpr-data-handling`** also deferred to prompt 22.

---

**Total time estimate: 3 hours.**
