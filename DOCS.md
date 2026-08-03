# API Documentation

Interactive **Swagger UI** is available when the API is running:

**[http://localhost:5000/docs](http://localhost:5000/docs)**

OpenAPI JSON: `http://localhost:5000/docs/json`

---

Base URL: `http://localhost:5000` (override with `PORT` in `.env`)

All successful JSON bodies use a `data` envelope where noted. Errors use a shared shape (see [Errors](#errors)).

---

## Overview

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness check |
| `GET` | `/posts` | List published posts |
| `GET` | `/posts/:postId` | Get a single post by ID |
| `GET` | `/posts/:postId/comments` | List comments for a post (nested tree) |
| `POST` | `/posts/:postId/comments/:commentId/replies` | Reply to a comment |
| `POST` | `/posts/:postId/comments/:commentId/retry` | Retry a failed reply publish |

---

## `GET /health`

Liveness probe. Does not check the database.

**Response** `200`

```json
{ "status": "ok" }
```

**Example**

```bash
curl http://localhost:5000/health
```

---

## `GET /posts`

Returns all published posts, newest `publishedAt` first. Used for discovery / selecting a post before loading comments.

**Response** `200`

```json
{
  "data": [
    {
      "id": "clx…",
      "platform": "TWITTER",
      "caption": "Excited to share our new scheduling features!",
      "externalPostId": "tw_post_1001",
      "publishedAt": "2024-06-01T09:00:00.000Z",
      "lastSyncedAt": null,
      "accountDisplayName": "@blotato_brand",
      "workspaceId": "clx…",
      "commentCount": 2
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Internal post ID (use this in other routes) |
| `platform` | `TWITTER` \| `INSTAGRAM` \| `YOUTUBE` | Social network |
| `caption` | string \| null | Post caption |
| `externalPostId` | string | ID on the social platform |
| `publishedAt` | ISO string | When the post was published |
| `lastSyncedAt` | ISO string \| null | Last successful comment sync |
| `accountDisplayName` | string | Connected brand account display name |
| `workspaceId` | string | Owning workspace |
| `commentCount` | number | Comments currently stored locally |

**Example**

```bash
curl http://localhost:5000/posts
```

---

## `GET /posts/:postId`

Fetch one post by internal ID.

**Path params**

| Param | Description |
|-------|-------------|
| `postId` | Internal post ID |

**Response** `200`

```json
{
  "data": {
    "id": "clx…",
    "platform": "TWITTER",
    "caption": "…",
    "externalPostId": "tw_post_1001",
    "publishedAt": "2024-06-01T09:00:00.000Z",
    "lastSyncedAt": "2026-08-03T14:00:00.000Z",
    "accountDisplayName": "@blotato_brand",
    "workspaceId": "clx…",
    "commentCount": 5
  }
}
```

**Errors**

| Status | Code | When |
|--------|------|------|
| `404` | `NOT_FOUND` | Unknown `postId` |

**Example**

```bash
curl http://localhost:5000/posts/<postId>
```

---

## `GET /posts/:postId/comments`

Returns comments for a post as a **nested tree** (top-level comments with `replies` arrays).

### Query parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `sync` | `"true"` \| `"false"` | `false` | If `true`, pull from the platform stub first and upsert into the local DB, then return the tree |
| `cursor` | string | — | Pagination cursor: ID of the last **top-level** comment from the previous page |
| `limit` | number | `50` | Max top-level comments per page (1–100) |

Pagination applies to **top-level** comments only. Nested replies are always included under their parent.

### Response `200`

```json
{
  "data": [
    {
      "id": "clx…",
      "postId": "clx…",
      "parentCommentId": null,
      "rootCommentId": "clx…",
      "depth": 0,
      "body": "Love this announcement!",
      "authorHandle": "@alice",
      "authorExternalId": "tw_user_alice",
      "isOurs": false,
      "status": "SYNCED",
      "externalCommentId": "tw_cmt_…",
      "failReason": null,
      "retryCount": 0,
      "createdAt": "2024-06-01T10:00:00.000Z",
      "canReply": true,
      "replies": [
        {
          "id": "clx…",
          "depth": 1,
          "parentCommentId": "clx…",
          "canReply": false,
          "replies": []
        }
      ]
    }
  ],
  "nextCursor": null,
  "lastSyncedAt": "2026-08-03T14:00:00.000Z"
}
```

### Comment object fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Internal comment ID |
| `postId` | string | Parent post |
| `parentCommentId` | string \| null | Immediate parent (`null` for top-level) |
| `rootCommentId` | string \| null | Thread root |
| `depth` | number | `0` = top-level; `1` = reply to top-level |
| `body` | string | Comment text |
| `authorHandle` | string | Author display handle |
| `authorExternalId` | string \| null | Author ID on the platform |
| `isOurs` | boolean | Authored by our connected account |
| `status` | `SYNCED` \| `PENDING_PUBLISH` \| `FAILED` | Sync / publish state |
| `externalCommentId` | string \| null | Platform ID (`null` until publish succeeds) |
| `failReason` | string \| null | Last publish error message |
| `retryCount` | number | How many failed publish attempts |
| `createdAt` | ISO string | Created time |
| `canReply` | boolean | Whether this comment may accept a reply under platform depth rules |
| `replies` | Comment[] | Nested children |

### Notes

- `canReply` is true when the comment is `SYNCED`, has an `externalCommentId`, and `depth < maxReplyDepth` (currently `1` for all stubs).
- `nextCursor` is the last top-level comment ID on this page, or `null` if there is no next page.
- `lastSyncedAt` reflects the post’s last successful sync (may be `null`).

### Errors

| Status | Code | When |
|--------|------|------|
| `404` | `NOT_FOUND` | Unknown `postId` |
| `400` | `VALIDATION_ERROR` | Invalid query (e.g. bad `limit`) |
| `502` | `PLATFORM_ERROR` | Platform list/sync failed |

### Examples

```bash
# Local DB only
curl "http://localhost:5000/posts/<postId>/comments"

# Sync from platform stub, then list
curl "http://localhost:5000/posts/<postId>/comments?sync=true"

# Paginate top-level comments
curl "http://localhost:5000/posts/<postId>/comments?limit=10&cursor=<lastRootId>"
```

---

## `POST /posts/:postId/comments/:commentId/replies`

Publish a reply to an existing comment. Creates a local row (`PENDING_PUBLISH`), writes through the platform adapter / outbox, then marks `SYNCED` or `FAILED`.

**Only top-level comments accept replies** (`depth` must be `< maxReplyDepth`, currently `1`). Nested replies return `400`.

### Path params

| Param | Description |
|-------|-------------|
| `postId` | Internal post ID |
| `commentId` | Internal ID of the **parent** comment to reply to |

### Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Content-Type` | yes | `application/json` |
| `Idempotency-Key` | no | Opaque client key; identical retries return the same response for 24h (scoped to this route) |

### Body

```json
{ "body": "Thanks for the feedback!" }
```

| Field | Rules |
|-------|--------|
| `body` | Required string, trimmed length 1–5000 |

### Response `201`

```json
{
  "data": {
    "id": "clx…",
    "postId": "clx…",
    "parentCommentId": "clx…",
    "rootCommentId": "clx…",
    "depth": 1,
    "body": "Thanks for the feedback!",
    "authorHandle": "@blotato_brand",
    "authorExternalId": "tw_user_us",
    "isOurs": true,
    "status": "SYNCED",
    "externalCommentId": "tw_cmt_…",
    "failReason": null,
    "retryCount": 0,
    "createdAt": "2026-08-03T14:05:00.000Z",
    "canReply": false,
    "replies": []
  }
}
```

### Errors

| Status | Code | When |
|--------|------|------|
| `404` | `NOT_FOUND` | Unknown post or parent comment |
| `400` | `BAD_REQUEST` | Empty body, nested parent (`depth` too deep), parent not yet published |
| `400` | `VALIDATION_ERROR` | Body fails Zod schema |
| `400` | `PLATFORM_VALIDATION_ERROR` | Platform rejected the reply |
| `404` | `PLATFORM_COMMENT_NOT_FOUND` | Parent missing on the platform stub |
| `502` | `PLATFORM_ERROR` | Platform publish failed |

On platform failure the local comment is left as `FAILED` with `failReason` set; use [retry](#post-postspostidcommentscommentidretry).

### Example

```bash
curl -X POST "http://localhost:5000/posts/<postId>/comments/<commentId>/replies" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: reply-1" \
  -d '{"body":"Thanks for the feedback!"}'
```

---

## `POST /posts/:postId/comments/:commentId/retry`

Re-drives a **failed** reply through the publish outbox. Does **not** create a new comment row — it retries the existing `FAILED` / `isOurs` comment.

### Path params

| Param | Description |
|-------|-------------|
| `postId` | Internal post ID |
| `commentId` | Internal ID of the **failed reply** (not the parent) |

### Response `200`

Same comment object shape as the reply endpoint, typically with `status: "SYNCED"` and a new `externalCommentId` on success.

### Errors

| Status | Code | When |
|--------|------|------|
| `404` | `NOT_FOUND` | No matching `FAILED` reply on that post |
| `400` | `BAD_REQUEST` | Comment has no parent / cannot be published |
| `502` | `PLATFORM_ERROR` | Platform publish failed again |

### Example

```bash
curl -X POST "http://localhost:5000/posts/<postId>/comments/<failedCommentId>/retry"
```

---

## Errors

All error responses:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Human-readable explanation"
  }
}
```

| Code | HTTP | Typical cause |
|------|------|----------------|
| `NOT_FOUND` | 404 | Unknown post or comment |
| `PLATFORM_COMMENT_NOT_FOUND` | 404 | Comment missing on the platform stub |
| `BAD_REQUEST` | 400 | Business-rule violation (depth, empty body, …) |
| `PLATFORM_VALIDATION_ERROR` | 400 | Platform rejected the operation |
| `VALIDATION_ERROR` | 400 | Zod / request validation failure |
| `PLATFORM_ERROR` | 502 | Upstream / mock API failure |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

---

## Quick curl cheat sheet

```bash
# Health
curl http://localhost:5000/health

# List posts (copy a post id from the response)
curl http://localhost:5000/posts

# Sync + list comments
curl "http://localhost:5000/posts/<postId>/comments?sync=true"

# Reply to a top-level comment
curl -X POST "http://localhost:5000/posts/<postId>/comments/<commentId>/replies" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: reply-1" \
  -d '{"body":"Thanks for the feedback!"}'

# Retry a failed reply
curl -X POST "http://localhost:5000/posts/<postId>/comments/<failedCommentId>/retry"
```

After `npm run seed`, post and comment IDs are printed to the console.
