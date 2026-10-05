# Lists CRUD Implementation Guide

## Overview

This guide walks through implementing the Lists CRUD layer for SyncBoard. Lists are ordered containers inside a board that hold cards. The implementation follows the modular architecture established by the auth system and boards system.

**Key characteristics of Lists:**
- Belong to exactly one board
- Have a fractional-indexed `position` field for ordering
- Can only be edited by users with `EDITOR` or `OWNER` role on the board
- When deleted, cascade-delete all cards inside them
- Have a title and a position (that's it for MVP)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ Route Layer (listsRoutes.ts)                                    │
│ ├─ POST /boards/:id/lists          (create)                    │
│ ├─ PATCH /lists/:id                (rename)                    │
│ └─ DELETE /lists/:id               (delete)                    │
└────────────────┬────────────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────────────┐
│ Middleware Layer (listsMiddleware.ts)                           │
│ ├─ requireAuth (from authMiddleware)                           │
│ ├─ requireBoardEditor (check EDITOR/OWNER role)               │
│ └─ validateListId (ensure list exists and belongs to board)   │
└────────────────┬────────────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────────────┐
│ Validator Layer (listsValidator.ts)                             │
│ ├─ createListSchema (POST body)                                │
│ ├─ updateListSchema (PATCH body)                               │
│ └─ listIdSchema (path parameter)                               │
└────────────────┬────────────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────────────┐
│ Service Layer (listsService.ts)                                 │
│ ├─ createList (logic: calculate position, insert)              │
│ ├─ updateList (logic: rename)                                  │
│ ├─ deleteList (logic: cascade)                                 │
│ ├─ getListById (fetch and validate)                            │
│ ├─ getBoardLists (fetch all lists for a board, ordered)       │
│ └─ Helper: calculateInitialPosition (fractional index logic)   │
└────────────────┬────────────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────────────┐
│ Prisma Layer (db.ts, contract.prisma)                          │
│ ├─ list.create                                                  │
│ ├─ list.update                                                  │
│ ├─ list.delete (cascade via schema)                            │
│ ├─ list.findUnique                                             │
│ └─ list.findMany                                               │
└─────────────────────────────────────────────────────────────────┘
```

## Module Breakdown

### 1. Validator Module: `src/modules/lists/listsValidator.ts`

**Purpose:** Parse and validate all list-related request bodies and path parameters.

**Schemas to define:**

#### `createListSchema`
- **Source:** Request body in `POST /boards/:id/lists`
- **Required fields:**
  - `title` (string, 1–100 chars, trimmed, non-empty)
- **Optional fields:** none for MVP
- **Returns:** `{ title: string }`
- **Errors:** 
  - ZodError if title is missing or invalid
  - Will be caught by error handler and converted to 400 Bad Request

#### `updateListSchema`
- **Source:** Request body in `PATCH /lists/:id`
- **Required fields:** at least one of the following must be present
  - `title` (string, 1–100 chars, trimmed, non-empty)
- **Returns:** `{ title?: string }`
- **Errors:** 
  - ZodError if title is present but invalid
  - Error if no fields are provided

#### `listIdSchema`
- **Source:** Path parameter in `/lists/:id`
- **Required fields:**
  - `id` (string, valid CUID format)
- **Returns:** `{ id: string }`
- **Errors:** ZodError if id is invalid format

#### `boardIdSchema` (reuse or create)
- **Source:** Path parameter in `/boards/:id/lists`
- **Required fields:**
  - `id` (string, valid CUID format)
- **Returns:** `{ id: string }`

**Implementation pattern:** Follow the same structure as `authValidator.ts` and `boardsValidator.ts`
- Export a function like `validateCreateListPayload(data)` that uses `createListSchema.parse(data)`
- Export a function like `validateUpdateListPayload(data)` that uses `updateListSchema.parse(data)`
- Export a function like `validateListId(id)` that uses `listIdSchema.parse({ id })`
- Wrap each in try-catch and throw `BadRequestError` with the Zod error message

---

### 2. Middleware Module: `src/modules/lists/listsMiddleware.ts`

**Purpose:** Enforce access control and load data into `req.locals` before handlers run.

**Middleware functions to define:**

#### `requireBoardEditor`
- **Purpose:** Verify that the authenticated user has `EDITOR` or `OWNER` role on the board
- **Where it's used:** All list endpoints (create, update, delete)
- **Input:** 
  - `req.user.id` (from authMiddleware)
  - `boardId` (from path params or request body)
- **Logic:**
  1. Query `memberships` table for `(userId, boardId)`
  2. Check if `role IN ('EDITOR', 'OWNER')`
  3. If not found or wrong role, throw `ForbiddenError('Only editors can modify lists')`
  4. If found, attach to `req.locals.membership` for use in handlers
- **Returns:** Express middleware function `(req, res, next) => Promise<void>`
- **Error handling:** Throws `ForbiddenError` (caught by error handler, returns 403)

#### `validateListExists`
- **Purpose:** Verify that a list with the given `id` exists and belongs to the specified board
- **Where it's used:** `PATCH /lists/:id` and `DELETE /lists/:id`
- **Input:**
  - `req.params.id` (list ID)
  - `boardId` (from request context, may need to be passed or derived)
- **Logic:**
  1. Parse list ID using `validateListId`
  2. Query `lists` table for the list
  3. Check that `list.boardId === boardId` (membership board)
  4. If not found or wrong board, throw `NotFoundError('List not found')`
  5. Attach to `req.locals.list` for use in handlers
- **Returns:** Express middleware function
- **Error handling:** Throws `NotFoundError` (caught by error handler, returns 404)

**Note on middleware order:**
- Middleware chain should be: `requireAuth` → `requireBoardEditor` → `validateListExists` (where applicable)
- This ensures auth is checked first, then permissions, then resource existence

---

### 3. Service Module: `src/modules/lists/listsService.ts`

**Purpose:** Implement business logic for list operations. Services call Prisma to read/write data.

**Functions to define:**

#### `createList(boardId: string, title: string): Promise<List>`
- **Purpose:** Create a new list in the board
- **Input:**
  - `boardId` (string, the board the list belongs to)
  - `title` (string, already validated)
- **Logic:**
  1. Calculate the initial position for the new list
     - Fetch the last list in the board (ordered by position descending)
     - If no lists exist, use `calculateInitialPosition(null, null)` → "a0"
     - If lists exist, use `calculateInitialPosition(lastList.position, null)` to get position after the last
  2. Insert into `lists` table with `(title, boardId, position)`
  3. Return the created list object
- **Error handling:**
  - Prisma unique constraint violation on `(boardId, position)` → throw `ConflictError` (should be rare)
  - Prisma foreign key constraint on `boardId` → throw `NotFoundError('Board not found')`
- **Database call:**
  ```
  db.list.create({
    data: { title, boardId, position },
  })
  ```

#### `updateList(listId: string, updates: { title?: string }): Promise<List>`
- **Purpose:** Rename a list
- **Input:**
  - `listId` (string, already validated)
  - `updates` (object with optional `title`)
- **Logic:**
  1. If `updates` is empty, throw `BadRequestError('No fields to update')`
  2. Update the list with the provided fields
  3. Return the updated list object
- **Error handling:**
  - Prisma not found (list doesn't exist) → throw `NotFoundError('List not found')`
- **Database call:**
  ```
  db.list.update({
    where: { id: listId },
    data: updates,
  })
  ```

#### `deleteList(listId: string): Promise<void>`
- **Purpose:** Delete a list and all its cards (cascade)
- **Input:**
  - `listId` (string, already validated)
- **Logic:**
  1. Delete the list by ID
  2. The cascade delete on cards is handled by the Prisma schema (`onDelete: Cascade`)
  3. Return void
- **Error handling:**
  - Prisma not found → throw `NotFoundError('List not found')`
- **Database call:**
  ```
  db.list.delete({
    where: { id: listId },
  })
  ```

#### `getListById(listId: string): Promise<List>`
- **Purpose:** Fetch a single list by ID
- **Input:**
  - `listId` (string)
- **Logic:**
  1. Query the list by ID
  2. Return the list or throw `NotFoundError` if not found
- **Error handling:**
  - If not found, throw `NotFoundError('List not found')`
- **Database call:**
  ```
  db.list.findUnique({
    where: { id: listId },
  })
  ```

#### `getBoardLists(boardId: string): Promise<List[]>`
- **Purpose:** Fetch all lists in a board, ordered by position
- **Input:**
  - `boardId` (string)
- **Logic:**
  1. Query all lists for the board
  2. Order them by position ascending
  3. Return the array
- **Error handling:** None; returning empty array is fine
- **Database call:**
  ```
  db.list.findMany({
    where: { boardId },
    orderBy: { position: 'asc' },
  })
  ```

#### `calculateInitialPosition(afterPosition: string | null, beforePosition: string | null): string`
- **Purpose:** Generate a fractional index position for a new list
- **Input:**
  - `afterPosition` (position of the list this new list goes after, or null if first)
  - `beforePosition` (position of the list this new list goes before, or null if last)
- **Logic:**
  1. This is a helper function that delegates to the `fractional-index` library
  2. The library provides a function like `getKeyBetween(afterKey, beforeKey)` that generates a position string
  3. For the first list: `getKeyBetween(null, null)` → "a0"
  4. For subsequent lists: `getKeyBetween(lastPosition, null)` → "a1", "a2", etc.
  5. When inserting between two lists: `getKeyBetween(afterPosition, beforePosition)` → midpoint
- **Error handling:** Should not throw; the fractional-index library is deterministic
- **Returns:** A string like "a0", "a1", "m0.5", etc.

**Note:** You'll need to `npm install fractional-index` and import its type or function (check the library docs for the exact API).

---

### 4. Routes Module: `src/modules/lists/listsRoutes.ts`

**Purpose:** Define HTTP endpoints, wire middleware, parse requests, and call services.

**Endpoints to define:**

#### `POST /boards/:id/lists`
- **Handler name:** `createListHandler`
- **Middleware chain:**
  1. `requireAuth` (from authMiddleware) → attaches `req.user`
  2. `requireBoardEditor(req.params.id)` → validates role and attaches `req.locals.membership`
- **Request handling:**
  1. Extract `boardId` from `req.params.id` and validate it
  2. Extract `title` from `req.body` and validate using `validateCreateListPayload`
  3. Call `listsService.createList(boardId, title)`
  4. Return the created list as JSON with 201 status
- **Error flow:** Middleware or validator throws → error handler catches → returns 400/403/404
- **Response:** 
  ```json
  {
    "id": "list_123",
    "title": "To Do",
    "boardId": "board_456",
    "position": "a0",
    "createdAt": "2024-01-15T10:00:00Z",
    "updatedAt": "2024-01-15T10:00:00Z"
  }
  ```

#### `PATCH /lists/:id`
- **Handler name:** `updateListHandler`
- **Middleware chain:**
  1. `requireAuth`
  2. Extract `boardId` from somewhere (see "Gotcha" below) and call `requireBoardEditor(boardId)`
  3. `validateListExists(boardId)` → attaches `req.locals.list`
- **Request handling:**
  1. Extract list ID from `req.params.id` and validate it
  2. Extract updates from `req.body` and validate using `validateUpdateListPayload`
  3. Call `listsService.updateList(listId, updates)`
  4. Return the updated list as JSON with 200 status
- **Error flow:** Same as above
- **Response:** Same structure as create
- **Gotcha:** To validate the board editor, you need the `boardId`, but the request is `/lists/:id`. You'll need to either:
  - Fetch the list early to get `boardId`, then check permissions
  - Pass `boardId` in the request body (not RESTful, avoid this)
  - **Recommended:** Fetch the list in middleware, attach it to `req.locals.list`, then check `req.locals.list.boardId` in the permission check

#### `DELETE /lists/:id`
- **Handler name:** `deleteListHandler`
- **Middleware chain:** Same as PATCH
- **Request handling:**
  1. Extract and validate list ID from `req.params.id`
  2. Call `listsService.deleteList(listId)`
  3. Return 204 No Content (or 200 with empty response)
- **Error flow:** Same as above
- **Response:** 204 No Content (empty body)

**Routing structure:**
- Create a new Express router in `listsRoutes.ts`
- Register handlers on the router:
  - `router.post('/', requireAuth, middleware..., createListHandler)`
  - `router.patch('/:id', requireAuth, middleware..., updateListHandler)`
  - `router.delete('/:id', requireAuth, middleware..., deleteListHandler)`
- Export the router
- In `app.ts`, mount it:
  - `app.use('/boards', listsRoutes)` for `POST /boards/:id/lists`
  - `app.use('/lists', listsRoutes)` for `PATCH /lists/:id` and `DELETE /lists/:id`
  - Or use a single mount point and prefix paths in the router definition

---

### 5. App Wiring: `app.ts`

**What to add/change:**

1. **Import the lists router:**
   ```
   import listsRoutes from './src/modules/lists/listsRoutes.js'
   ```

2. **Mount the router:**
   - Decide on mounting strategy:
     - Option A: Mount under `/boards` for `/boards/:id/lists` and under `/` for `/lists/:id`
     - Option B: Mount under `/` for all routes
     - **Recommended:** Option B for simplicity
   ```
   app.use('/boards', boardsRoutes);
   app.use('/lists', listsRoutes);
   ```

3. **Order matters:** Mount after `express.json()` and CORS, before error handler

---

### 6. Prisma Schema: `contract.prisma`

**What's already there:**
The Prisma schema already has the `List` model defined with:
- `id`, `title`, `boardId`, `position`
- Relations to `Board` and `Card`
- Unique constraint on `(boardId, position)`
- Index on `boardId`

**What you need to verify:**
- The `List` model is complete and correct
- The `onDelete: Cascade` on the `Board` relation is set (already is)
- The `Card` relation has `onDelete: Cascade` (already is)
- No migrations are needed; the schema is ready

**If you need to make changes:**
- Run `prisma migrate dev --name <name>` to create and apply a migration
- Use `contract:emit` to regenerate the contract files

---

## Request/Response Flow Example

### POST /boards/board_123/lists

**Request:**
```http
POST /boards/board_123/lists HTTP/1.1
Authorization: Bearer eyJhbGci...
Content-Type: application/json

{
  "title": "To Do"
}
```

**Flow:**
1. `listsRoutes.ts` receives the request
2. `requireAuth` middleware runs → extracts JWT, attaches `req.user = { id: "user_456", ... }`
3. Handler extracts `boardId = "board_123"` from `req.params.id`
4. `requireBoardEditor("board_123")` middleware runs → queries memberships table → finds `(user_456, board_123, EDITOR)` → attaches `req.locals.membership`
5. Handler extracts `title = "To Do"` from `req.body`
6. Handler calls `validateCreateListPayload({ title })` → passes validation
7. Handler calls `listsService.createList("board_123", "To Do")`
8. Service fetches last list in board (none exist) → calls `calculateInitialPosition(null, null)` → returns "a0"
9. Service calls `db.list.create({ data: { title: "To Do", boardId: "board_123", position: "a0" } })`
10. Prisma inserts and returns the created list
11. Handler returns 201 with the list JSON

**Response:**
```json
201 Created
{
  "id": "list_789",
  "title": "To Do",
  "boardId": "board_123",
  "position": "a0",
  "createdAt": "2024-01-15T10:00:00Z",
  "updatedAt": "2024-01-15T10:00:00Z"
}
```

---

## Error Scenarios

### Scenario 1: User tries to create a list in a board they're not a member of

**Request:**
```
POST /boards/board_999/lists
Authorization: Bearer <token>
{ "title": "To Do" }
```

**Flow:**
1. `requireAuth` passes
2. `requireBoardEditor("board_999")` queries memberships table
3. No row found for `(user_id, board_999)`
4. Throws `ForbiddenError('Only editors can modify lists')`
5. Error handler catches and returns:
```json
403 Forbidden
{
  "error": "Only editors can modify lists",
  "statusCode": 403
}
```

### Scenario 2: User provides invalid title

**Request:**
```
POST /boards/board_123/lists
Authorization: Bearer <token>
{ "title": "" }
```

**Flow:**
1. Middleware passes
2. Handler calls `validateCreateListPayload({ title: "" })`
3. Zod validation fails (empty string not allowed)
4. Throws `BadRequestError('Title must be at least 1 character')`
5. Error handler catches and returns:
```json
400 Bad Request
{
  "error": "Title must be at least 1 character",
  "statusCode": 400
}
```

### Scenario 3: User tries to update a list in a board they're a viewer on

**Request:**
```
PATCH /lists/list_456
Authorization: Bearer <token>
{ "title": "New Title" }
```

**Flow:**
1. `requireAuth` passes
2. Need to fetch the list to get `boardId` (middleware concern)
3. `validateListExists` fetches list and attaches to `req.locals.list`
4. Extract `boardId = req.locals.list.boardId`
5. `requireBoardEditor(boardId)` queries memberships for `(user_id, boardId)`
6. Finds `(user_id, boardId, VIEWER)` → role is not EDITOR/OWNER
7. Throws `ForbiddenError('Only editors can modify lists')`
8. Returns 403

### Scenario 4: User tries to delete a list that doesn't exist

**Request:**
```
DELETE /lists/nonexistent_id
Authorization: Bearer <token>
```

**Flow:**
1. `requireAuth` passes
2. Handler calls `validateListId("nonexistent_id")` → passes (valid CUID format)
3. Middleware `validateListExists` tries to fetch the list
4. Prisma returns null
5. Throws `NotFoundError('List not found')`
6. Returns 404

---

## Testing Strategy

### Unit Tests (listsService.spec.ts)

**What to test:**
- `calculateInitialPosition` generates correct fractional indices
- `createList` calls Prisma with correct data
- `updateList` only updates provided fields
- `deleteList` calls Prisma delete
- Service throws correct errors for edge cases (empty updates, missing board, etc.)

### Integration Tests (listsRoutes.spec.ts)

**What to test:**
- POST /boards/:id/lists with valid data → 201
- POST /boards/:id/lists with invalid title → 400
- POST /boards/:id/lists without auth → 401
- POST /boards/:id/lists as viewer → 403
- POST /boards/:id/lists to non-existent board → 404
- PATCH /lists/:id with valid data → 200
- PATCH /lists/:id with empty updates → 400
- PATCH /lists/:id without auth → 401
- PATCH /lists/:id as viewer → 403
- PATCH /lists/:id nonexistent list → 404
- DELETE /lists/:id → 204
- DELETE /lists/:id cascade deletes cards
- Multiple lists in a board are ordered by position

---

## Implementation Checklist

- [ ] Create `src/modules/lists/listsValidator.ts` with all schemas
- [ ] Create `src/modules/lists/listsMiddleware.ts` with `requireBoardEditor` and `validateListExists`
- [ ] Create `src/modules/lists/listsService.ts` with all service functions
- [ ] Install `fractional-index` package and understand its API
- [ ] Create `src/modules/lists/listsRoutes.ts` with all three endpoints
- [ ] Mount listsRoutes in `app.ts`
- [ ] Verify Prisma schema has List model (should be done already)
- [ ] Write unit tests for listsService
- [ ] Write integration tests for listsRoutes
- [ ] Test cascade delete (delete a list, verify cards are deleted)
- [ ] Test fractional indexing (create multiple lists, verify order)
- [ ] Test permission enforcement (viewer cannot edit, owner can)

---

## Key Design Decisions

### 1. Fractional Indexing
- **Why:** Moving a card/list is O(1) database operation instead of O(n) renumbering
- **How:** Use `fractional-index` library to generate positions between existing items
- **Trade-off:** Position strings are opaque to the client; ordering must always be done on server

### 2. Cascade Delete
- **Why:** Deleting a list should delete all its cards (data integrity)
- **How:** Prisma schema defines `onDelete: Cascade`
- **Trade-off:** Cards are silently deleted; no separate delete endpoint for cards within a list

### 3. Permission Check Pattern
- **Why:** Reusable middleware that checks role once, used on multiple endpoints
- **How:** `requireBoardEditor` middleware queries the memberships table and throws if role is wrong
- **Trade-off:** One extra database query per request, but prevents repeating logic

### 4. Validation Layers
- **Why:** Separate schema validation (Zod) from business logic
- **How:** Validators parse and throw early; services assume valid data
- **Trade-off:** Two layers to maintain, but errors are consistent and testable

---

## Common Pitfalls to Avoid

1. **Not validating boardId in middleware:** If you skip this, an attacker could edit lists in a board they don't have access to
2. **Fetching list twice:** Avoid fetching the list once in middleware and again in the handler; attach to `req.locals`
3. **Not handling empty updates:** PATCH /lists/:id with `{}` should reject, not silently succeed
4. **Forgetting to order lists by position:** If you don't sort in `getBoardLists`, the client sees random order
5. **Not testing concurrent list creation:** Multiple users creating lists at the same time should not duplicate positions
6. **Assuming position strings are human-readable:** They're not; don't expose them to the client, or explain they're opaque

---

## Summary

The Lists CRUD layer is built in four modules that follow the existing patterns:

1. **Validator:** Parses and enforces schema with Zod
2. **Middleware:** Checks auth and permissions, loads data into context
3. **Service:** Implements business logic (including fractional indexing)
4. **Routes:** Defines HTTP endpoints and wires middleware + service

The key technical challenge is fractional indexing. The key access control challenge is loading the boardId (from the list itself) before checking permissions. All error cases are handled consistently with existing error classes.