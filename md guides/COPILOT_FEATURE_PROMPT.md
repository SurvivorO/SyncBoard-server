# SyncBoard Server: Copilot Feature Prompt Context

Use this document as the stable project context when asking Copilot to implement a server feature. It is a snapshot of the repository as inspected on 2026-10-06. It deliberately separates **current code** from older planning documents, which can be out of date.

## How to use it

1. Start a Copilot Chat at the `server/` workspace root.
2. Paste the **Master context prompt** once per new chat (or attach/reference this file if the IDE supports it).
3. For each task, paste the **Feature task prompt** and fill in the feature number/name.
4. Do not ask Copilot to scan the entire repository. It may read only the explicitly named files necessary to resolve an implementation detail or a conflict.

Copilot does not reliably retain context between new chats; this file is the reusable substitute for repeatedly rediscovering the directory.

---

## Master context prompt

```text
You are implementing a feature in the SyncBoard server. Treat this message as the authoritative project map; do not rescan the repository or invent a different architecture. Read only the specific files named below when you need exact signatures or current code.

WORKSPACE AND STACK
- Work only in server/.
- Node.js + TypeScript (strict, ESM), Express 5, PostgreSQL, Prisma 8 contract-based ORM, Zod, jsonwebtoken, bcrypt, fractional-index, and the Temporal polyfill.
- The server entry points are server.ts (process/HTTP lifecycle) and app.ts (Express middleware/routes).
- Use .js in relative import specifiers, even from TypeScript files.
- The database client is src/prisma/db.ts. Use its established contract API, e.g. db.orm.public.List.where({...}).first(), .all(), .create(), .update(), .delete(), and db.transaction(async (tx) => ...). Do NOT introduce @prisma/client/PrismaClient or a second database client.

CURRENT ROUTES AND MODULES
- app.ts registers /auth, /boards, lists routes, and cards routes. Error middleware is last.
- Authentication: src/modules/auth/. authMiddleware validates Bearer access JWTs and attaches req.user = { userId, email }. authService.verifyAccessToken(token) is the existing verifier.
- Boards and memberships: src/modules/boards/. Roles are OWNER, EDITOR, VIEWER. Read: any member; write: OWNER/EDITOR; admin: OWNER.
- Board middleware exports requireBoardMember, requireBoardWrite, requireBoardOwner. For board-id paths, requireBoardMember sets req.boardId and req.userRole.
- Lists CRUD is already implemented in src/modules/lists/.
  POST /boards/:id/lists, PATCH /lists/:id, DELETE /lists/:id.
- Cards CRUD/move is already implemented in src/modules/cards/.
  POST /lists/:id/cards, PATCH /cards/:id, DELETE /cards/:id, POST /cards/:id/move.
- There is no src/modules/realtime/ and no src/modules/activity/ yet.
- package.json does NOT currently include socket.io. Add it only when implementing realtime setup.

DATA MODEL
- User: id, email, name?, passwordHash.
- Board: id, title, ownerId; memberships, lists, activities.
- Membership: userId, boardId, role; unique (userId, boardId).
- List: id, title, boardId, position; unique (boardId, position).
- Card: id, title, description?, priority?, dueDate?, listId, position, version; unique (listId, position).
- Activity: boardId, userId?, cardId?, type, payload, createdAt.
- ActivityType already has card/list/member create/update/move/delete values.
- Schema source: src/prisma/contract.prisma. Generated contract artifacts must not be hand-edited.

ENGINEERING CONVENTIONS
- Keep the modular-monolith pattern: routes -> validation/middleware -> service -> db.
- Reuse auth, board authorization, AppError helpers, and the shared db client. Do not duplicate JWT or membership authorization logic.
- Validate external HTTP input with existing Zod-style validator modules. For socket payloads, validate required fields before using them.
- Throw AppError helpers (BadRequestError, UnauthorizedError, ForbiddenError, NotFoundError, ConflictError) for expected failures and let centralized error handling respond.
- Keep REST as the mutation source of truth. Sockets authorize/join rooms and broadcast only after successfully persisted REST mutations; sockets must not bypass REST permissions.
- Do not rewrite unrelated code, mutate the Prisma schema, add Redis, change HTTP response envelopes, or change established endpoints unless the requested feature explicitly requires it.
- Make the smallest coherent change. Preserve existing formatting and types.

REALTIME REQUIREMENTS AND ORDER
1. Socket.IO server setup: attach Socket.IO to the HTTP server, CORS from env.CORS_ORIGIN, root namespace, connection/disconnection/error handling.
2. Socket authentication: verify handshake.auth.token using existing access-token semantics; attach userId/email to socket.data; reject invalid/missing/expired token.
3. Board rooms: board_<boardId>; board:join/board:leave; check Membership in DB; viewers may join; no cross-board event leakage.
4. Presence: in-memory, per board/user (correctly handle multiple tabs); emit presence:update on join/leave/disconnect with userId, userName, userEmail, boardId, joinedAt.
5. Broadcast successful card mutations: card:created, card:updated, card:moved, card:deleted.
6. Broadcast successful list mutations: list:created, list:updated, list:deleted.
7. Broadcast successful membership mutations: member:added, member:role-changed, member:removed.
8. Activity service and GET /boards/:id/activity, newest first, paginated, all members may read. Log each mutation.
9. Socket error/recovery behavior.
10. Realtime conflict behavior: REST remains authoritative; stale card operations return 409 and current state/version where required.

DOCUMENT HIERARCHY
- Actual source code is the current-state authority.
- server/COPILOT_FEATURE_PROMPT.md is the reusable context snapshot.
- md guides/Realtime_Collaboration_Requirements.md defines the realtime requirements and feature order.
- ARCHITECTURE.md is partly stale: it incorrectly says lists/cards are unimplemented. Do not follow that statement.
- Other md guides are historical design references; use them only when they do not conflict with current code or this context.

BEFORE YOU EDIT
1. State the exact files you will change and why.
2. Read only those files plus any direct dependency needed to match a signature.
3. Identify whether a package/dependency or environment change is necessary.

AFTER YOU EDIT
1. Summarize files changed, routes/events added, and any install command the developer must run.
2. Run npm run build from server/ and fix TypeScript errors caused by your changes.
3. Give focused manual verification steps. Do not claim tests ran if they did not.
```

## Feature task prompt template

```text
Implement realtime Feature <NUMBER>: <NAME> from `md guides/Realtime_Collaboration_Requirements.md`.

Scope for this task:
- <specific behavior to implement>

Out of scope:
- <later feature responsibilities that must not be implemented yet>

Use the SyncBoard Server Copilot Feature Prompt Context already supplied. First inspect only these files: <file paths>. Then give a short implementation plan, make the smallest coherent change, run `npm run build` from `server/`, and report changed files, validation performed, and any command I must run.

Acceptance criteria:
- <criterion 1>
- <criterion 2>
- <criterion 3>
```

## Ready-to-paste prompt for realtime Feature 1

```text
Implement realtime Feature 1: Socket.IO Server Setup from `md guides/Realtime_Collaboration_Requirements.md`.

Scope for this task:
- Add the `socket.io` runtime dependency and any required TypeScript types only if the installed package does not provide them.
- Create the minimum realtime module needed to initialize a Socket.IO Server attached to the existing HTTP server.
- Configure Socket.IO CORS using `env.CORS_ORIGIN`, root namespace `/`, and basic connection, disconnect, and socket-error logging/handlers.
- Refactor `server.ts` from `app.listen(...)` to an explicit Node HTTP server so Express and Socket.IO share one listener.
- Preserve graceful shutdown: stop accepting HTTP traffic, close Socket.IO cleanly if appropriate, then close `db`.
- Export a small, typed initialization/setup API that later Features 2–7 can extend without circular imports.

Out of scope:
- Handshake JWT authentication (Feature 2).
- `board:join`/`board:leave`, membership checks, rooms, or presence (Features 3–4).
- Broadcasters, card/list/member integrations, activity logging, and conflict response changes (Features 5–10).
- Any client changes or schema/migration changes.

Inspect only these files first:
- package.json
- server.ts
- app.ts
- env.ts
- src/prisma/db.ts
- src/modules/auth/authService.ts
- src/modules/errors/AppError.ts
- md guides/Realtime_Collaboration_Requirements.md (Feature 1 and Integration Points sections)

Use the SyncBoard Server Copilot Feature Prompt Context already supplied. First give a short implementation plan, then make the smallest coherent change, run `npm run build` from `server/`, and report changed files, validation performed, and any command I must run.

Acceptance criteria:
- One HTTP server serves Express and Socket.IO on env.PORT.
- Socket.IO CORS accepts env.CORS_ORIGIN and no socket authorization is added yet.
- A client can connect to the root namespace and server-side connect/disconnect/error handling does not crash the process.
- SIGTERM closes the shared server and database without leaving the old app.listen path behind.
- TypeScript builds successfully.
```
