# Railway Services Named `publisheriq`

Verified on July 24, 2026 UTC. Railway contained two production services named
`publisheriq`; they were not the same runtime.

## Genuine Legacy PICS Service

| Field              | Verified value                                                              |
| ------------------ | --------------------------------------------------------------------------- |
| Project            | `enthusiastic-caring` (`68a3b2a8-43a6-45df-856e-0ba0e1309216`)              |
| Environment        | `production` (`4d6625a7-d942-4835-b74b-f0eff3e626ac`)                       |
| Service            | `publisheriq` (`e6c49263-8466-4cb5-a37f-16299aae499e`)                      |
| Build source       | `services/pics-service/railway.toml` and `services/pics-service/Dockerfile` |
| Role               | Legacy Steam PICS `change_monitor`                                          |
| Final verification | stopped; deployment status `FAILED`; no active deployment                   |

This is the service involved in
[`pics-restart-incident.md`](./pics-restart-incident.md). It remained stopped
and was not changed while the similarly named duplicate was contained.

## Accidental Query-API Duplicate

| Field                           | Verified value                                                  |
| ------------------------------- | --------------------------------------------------------------- |
| Project                         | `confident-education` (`c36c95df-2284-4ffc-af85-cd3c31a3b8ea`)  |
| Environment                     | `production` (`1bf90bde-132e-47cd-93d6-501d31035a3f`)           |
| Service                         | `publisheriq` (`455d7fca-96a3-44f9-b5f0-5e6dca1c093f`)          |
| Build source before containment | repository `draknorr/piq`, `apps/query-api/Dockerfile`          |
| Observed route                  | `/healthz` returned the Tiger query-api health contract         |
| Final verification              | stopped; deployment status `FAILED`; GitHub source disconnected |

This service was not PICS despite its name. The real query API,
`publisheriq-query-api-prod`, remains a separate service and was not changed.

After explicit approval, the accidental duplicate was stopped and its source
was disconnected. Railway returned:

```json
{
  "id": "455d7fca-96a3-44f9-b5f0-5e6dca1c093f",
  "repo": null,
  "branch": null,
  "image": null,
  "disconnected": true
}
```

No Tiger, R2, Supabase, Vercel, or GitHub repository data was mutated by this
containment action.
