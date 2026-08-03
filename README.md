# Blotato Comment System (Take-Home)

Design and partial implementation of a **multi-platform comment system** for a social media scheduling API.

You can:

- Retrieve comments for a published post
- Reply to a comment
- Support multiple social platforms (Twitter/X, Instagram, YouTube stubs)
- Use a REST API

This is intentionally a **partial** implementation: real OAuth and live platform HTTP calls are stubbed. The focus is engineering judgment — schema, API shape, extensibility, and failure handling.

---

## Table of contents

1. [Quick start](#quick-start)
2. [What you get](#what-you-get)
3. [Project structure](#project-structure)
4. [Stack](#stack)
5. [Architecture](#architecture)
6. [Database schema](#database-schema)
7. [REST API](#rest-api)
8. [Core flows](#core-flows)
9. [Platform adapters](#platform-adapters)
10. [Design decisions](#design-decisions)
11. [Tests](#tests)
12. [How I used AI](#how-i-used-ai)

---

## Quick start

**Requirements:** Node 20+

```bash
npm install
cp .env.example .env          # PORT defaults to 5000
npx prisma migrate deploy     # apply migrations to SQLite
npm run seed                  # demo workspace, accounts, posts, comments
npm run dev                   # API on http://localhost:5000
# Swagger UI → http://localhost:5000/docs
```

**Useful scripts**

| Script | Purpose |
|--------|---------|
| `npm run dev` | API with hot reload |
| `npm run seed` | Reset demo data |
| `npm test` | Service tests (isolated `prisma/test.db`) |
| `npm run build` | Compile TypeScript |

Seed output prints workspace / post / comment IDs for curl examples.

---

## What you get

| Area | Status |
|------|--------|
| Database schema (Workspace → Account → Post → Comment) | Done |
| REST API (list, sync, reply, retry) | Done |
| Platform adapter + mock client + repository layering | Done |
| Typed platform errors (404 / 400 / 502) | Done |
| Publish outbox + failed-reply retry | Done |
| Idempotency keys (scoped, expiring) | Done |
| Real Twitter / Meta / YouTube HTTP + OAuth | Stubbed |
| Auth / RBAC | Omitted (schema is tenant-ready) |
| Background outbox worker / webhooks | Out of scope |

---

## Project structure

```text
.
├── docs.md                        # REST API markdown reference
├── prisma/
│   ├── schema.prisma              # Canonical data model
│   ├── seed.ts                    # Demo workspace + 3 platforms
│   └── migrations/                # SQLite migrations (incl. partial unique index)
└── src/
    ├── index.ts                   # Process boot
    ├── app.ts                     # Fastify app + CORS
    ├── db/prisma.ts
    ├── lib/errors.ts              # AppError helpers
    ├── openapi/                   # Swagger / OpenAPI schemas
    ├── routes/
    │   ├── posts.ts               # GET /posts, GET /posts/:id
    │   └── comments.ts            # list / reply / retry + error handler
    ├── services/
    │   ├── commentService.ts      # Sync, reply, outbox, idempotency
    │   └── commentService.test.ts
    └── platforms/
        ├── types.ts               # Adapter contract + ExternalComment
        ├── errors.ts              # Platform*Error → HTTP mapping
        ├── registry.ts            # Platform → adapter
        ├── repository/            # In-memory store for stub remote comments
        ├── clients/               # Mock Twitter / Instagram / YouTube APIs
        └── adapters/              # Platform rules (depth, mapping)
```

---

## Stack

- **Runtime:** Node 20+, TypeScript (strict)
- **HTTP:** Fastify + Zod validation + `@fastify/cors`
- **DB:** Prisma + SQLite (zero-setup; schema maps cleanly to Postgres)
- **Tests:** Node’s built-in test runner via `tsx --test`

---

## Architecture

```text
HTTP client (curl / API consumer)
      │
      ▼
Fastify routes  (validation, HTTP)
      │
      ▼
CommentService  (orchestration, transactions, outbox, idempotency)
      │
      ├──► Prisma / SQLite     ← canonical product store (what the API exposes)
      │
      └──► PlatformAdapter     ← platform rules (e.g. max reply depth)
                │
                ▼
           Mock API client     ← simulates real platform HTTP
                │
                ▼
           PlatformCommentRepository  ← in-memory stub “remote” comments
```

**Single responsibility per layer**

| Layer | Owns |
|-------|------|
| Routes | HTTP, Zod parsing, status codes |
| CommentService | Product rules, local DB, sync/reply/retry |
| Adapter | Platform-specific validation & DTO mapping |
| API client | Simulated network call to the platform |
| Repository | Persistence of stub remote comments only |

Adding a platform = new adapter + client + seed data + registry entry. Routes do not change.

---

## Database schema

### Entity overview

```text
Workspace 1──* SocialAccount 1──* Post 1──* Comment
                                      │         │
                                      │         ├── parentCommentId (thread)
                                      │         ├── rootCommentId + depth (denormalized)
                                      │         └── PublishOutbox (1:1 per publish attempt)
                                      │
                                      └── lastSyncedAt
```

### Models

| Model | Purpose |
|-------|---------|
| **Workspace** | Tenant boundary for a customer |
| **SocialAccount** | Connected brand account (`workspaceId` + `platform` + `externalAccountId`) |
| **Post** | Published post we manage; `platform` denormalized from account; `lastSyncedAt` |
| **Comment** | Canonical comment the product API returns |
| **PublishOutbox** | Durable record of reply→platform publish attempts |
| **IdempotencyKey** | Scoped + expiring cache of successful write responses |

### Comment fields (important)

| Field | Meaning |
|-------|---------|
| `id` | Internal ID (API clients use this) |
| `externalCommentId` | Platform ID; **null** until publish succeeds |
| `parentCommentId` | Immediate parent in the thread |
| `rootCommentId` | Thread root (self for top-level) |
| `depth` | `0` = top-level, `1` = reply to top-level, … |
| `status` | `SYNCED` \| `PENDING_PUBLISH` \| `FAILED` |
| `failReason` / `retryCount` | Failure diagnostics |
| `isOurs` | Authored by our connected account |
| `platformRaw` | Opaque JSON string for forward-compat fields |

### Indexes / constraints

- Unique `(platform, externalPostId)` on posts
- Unique `(workspaceId, platform, externalAccountId)` on accounts
- **Partial unique index** on comments:

  ```sql
  UNIQUE (postId, externalCommentId) WHERE externalCommentId IS NOT NULL
  ```

  So multiple `PENDING_PUBLISH` rows with `NULL` external IDs do not collide.

- Indexes on `(postId, createdAt, id)`, `rootCommentId`, `depth`, outbox `(status, availableAt)`

---

## REST API

- **Swagger UI:** [http://localhost:5000/docs](http://localhost:5000/docs) (OpenAPI try-it-out)
- **Markdown reference:** [docs.md](docs.md)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Liveness |
| `GET` | `/posts` | List published posts |
| `GET` | `/posts/:postId` | Fetch one post by ID |
| `GET` | `/posts/:postId/comments` | Nested comment tree (`sync`, `cursor`, `limit`) |
| `POST` | `/posts/:postId/comments/:commentId/replies` | Reply (optional `Idempotency-Key`) |
| `POST` | `/posts/:postId/comments/:commentId/retry` | Retry a `FAILED` reply |

Base URL: `http://localhost:5000` (override with `PORT` in `.env`).

## Core flows

### 1. Sync comments (`?sync=true`)

1. Load post + social account
2. Resolve adapter by `post.platform`
3. `adapter.listComments` → mock client → stub repository
4. In a **transaction**: upsert by `(postId, externalCommentId)`, wire parents, set `depth` / `rootCommentId`
5. Set `post.lastSyncedAt`
6. Return nested tree from local DB

### 2. Reply to a comment

1. Validate body; check scoped idempotency key (return cached response if present)
2. Load parent; require `SYNCED` + `externalCommentId`
3. Reject if `parent.depth >= adapter.maxReplyDepth` (currently **1** for all stubs — replies only to top-level)
4. Insert local comment: `PENDING_PUBLISH`, `depth = parent.depth + 1`, `rootCommentId` set
5. Upsert **PublishOutbox** → `PROCESSING`
6. Call adapter → mock API → repository `create`
7. On success: set `externalCommentId`, `SYNCED`, outbox `COMPLETED`
8. On failure: `FAILED` + `failReason`, outbox `FAILED` (retryable)
9. Store idempotency response (24h TTL) when key provided

### 3. Retry failed reply

`POST .../retry` re-drives an existing `FAILED` / `isOurs` comment through the outbox path — **no duplicate comment row**.

---

## Platform adapters

All three platforms share the same contract:

```ts
interface SocialPlatformAdapter {
  platform: Platform;
  maxReplyDepth: number; // 1 = only reply to top-level
  listComments(ctx): Promise<ExternalComment[]>;
  replyToComment(ctx): Promise<PlatformReplyResult>;
}
```

`PlatformReplyResult` includes `externalCommentId`, `platform`, `createdAt`, `parentExternalCommentId`, author fields, and `body`.

| Platform | Stub behavior |
|----------|----------------|
| Twitter/X | Conversation-style threads; product max depth 1 |
| Instagram | One-level replies (Graph API style) |
| YouTube | Replies attach to top-level comment threads |

Typed errors from the platform layer:

- `PlatformCommentNotFoundError` → 404  
- `PlatformValidationError` → 400  
- `PlatformApiError` → 502  

Adapters do **not** mutate arrays directly; clients call the repository (`create` / `list` / `find`).

---

## Design decisions

1. **Adapter pattern over `if (platform === …)`**  
   Social APIs diverge. Registration keeps the domain stable when adding platforms.

2. **Canonical local store, not live-only proxy**  
   Stable internal IDs, fast reads, pending/failed state, auditability. Sync-on-read refreshes when needed.

3. **`PENDING_PUBLISH` + outbox**  
   Platform writes are fallible. Local row + outbox lets us retry without double-creating comments.

4. **Denormalized `depth` + `rootCommentId`**  
   Reply eligibility is O(1) on the parent row — no parent-walk on every reply.

5. **Partial unique on external IDs**  
   Pending rows may share `NULL` external IDs; only published IDs must be unique per post.

6. **Scoped, expiring idempotency**  
   Client retries after timeouts should not double-post to social networks.

7. **Workspace in schema, auth omitted**  
   Shows multi-tenant readiness without implementing full auth for the take-home.

8. **Sync-on-read over webhooks (for this exercise)**  
   Webhooks are the production freshness path; they need public endpoints, verification, and per-platform subscriptions. `lastSyncedAt` documents sync freshness without that ops cost.

9. **Internal IDs at the API boundary**  
   Clients never depend on Twitter/IG/YouTube ID formats.

---

## Tests

```bash
npm test
```

Coverage (service-level, isolated `prisma/test.db`):

- Reject nested replies via denormalized depth  
- Successful top-level reply sets `depth` / `rootCommentId`  
- Idempotency key does not double-create  
- Sync sets `lastSyncedAt`  
- `retryFailedReply` recovers a `FAILED` comment  

---

## How I used AI

I used Cursor as an implementation assistant after doing the product thinking myself.

- Broke down the take-home requirements, designed the schema, and wrote a full context brief for the comment system, then provided that to Cursor to implement against
- Reviewed the complete implementation end-to-end and gave follow-up suggestions where the design or code needed tightening
- Used Cursor to help build the test suite covering depth rules, idempotency, sync, and failed-reply retry
- Used Cursor to draft and refine this README and [docs.md](docs.md)

Final architecture choices and review sign-off are mine.

---
