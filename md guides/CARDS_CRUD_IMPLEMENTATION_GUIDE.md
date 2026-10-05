# Cards CRUD Implementation Guide

## Overview

This guide walks through implementing the Cards CRUD layer for SyncBoard. Cards are the core Kanban units—they belong to a list, can be edited, and most importantly, can be moved within or across lists using fractional indexing. Cards also have a `version` field for optimistic concurrency control to handle conflicts when multiple users edit the same card simultaneously.

**Key characteristics of Cards:**
- Belong to exactly one list (and transitively, one board)
- Have a fractional-indexed `position` field for ordering within a list
- Have a `version` number that increments on every update (for conflict detection)
- Have optional fields: description, priority (LOW/MEDIUM/HIGH), dueDate
- Can only be edited by users with `EDITOR` or `OWNER` role on the board
- Can be moved to another list or reordered within the same list
- When deleted, their activity records are cleaned up (onDelete: SetNull in Activity model)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ Route Layer (cardsRoutes.ts)                                    │
│ ├─ POST /lists/:id/cards           (create)                    │
│ ├─ PATCH /cards/:id                (edit)                      │
│ ├─ DELETE /cards/:id               (delete)                    │
│ └─ POST /cards/:id/move            (move/reorder)              │
└────────────────┬────────────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────────────┐
│ Middleware Layer (cardsMiddleware.ts)                           │
│ ├─ requireAuth (from authMiddleware)                           │
│ ├─ requireBoardEditor (check EDITOR/OWNER via card→list→board) │
│ ├─ validateCardId (ensure card exists and fetch it)            │
│ └─ validateMovePayload (ensure version matches for moves)      │
└────────────────┬────────────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────────────┐
│ Validator Layer (cardsValidator.ts)                             │
│ ├─ createCardSchema (POST body)                                │
│ ├─ updateCardSchema (PATCH body)                               │
│ ├─ moveCardSchema (POST /move body, version required)          │
│ ├─ cardIdSchema (path parameter)                               │
│ └─ listIdSchema (path parameter)                               │
└────────────────┬────────────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────────────┐
│ Service Layer (cardsService.ts)                                 │
│ ├─ createCard (logic: calculate position, insert)              │
│ ├─ updateCard (logic: edit fields, increment version)          │
│ ├─ deleteCard (logic: cascade)                                 │
│ ├─ moveCard (logic: validate version, calc new position)       │
│ ├─ getCardById (fetch and validate)                            │
│ ├─ getCardsByListId (fetch all cards in list, ordered)         │
│ └─ Helper: calculateCardPosition (fractional index within list) │
└────────────────┬────────────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────────────┐
│ Prisma Layer (db.ts, contract.prisma)                          │
│ ├─ card.create                                                  │
│ ├─ card.update                                                  │
│ ├─ card.delete                                                  │
│ ├─ card.findUnique                                              │
│ └─ card.findMany                                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Module Breakdown

### 1. Validator Module: `src/modules/cards/cardsValidator.ts`

**Purpose:** Parse and validate all card-related request bodies and path parameters.

**Schemas to define:**

#### `createCardSchema`
- **Source:** Request body in `POST /lists/:id/cards`
- **Required fields:**
  - `title` (string, 1–200 chars, trimmed, non-empty)
- **Optional fields:**
  - `description` (string, 0–2000 chars, trimmed)
  - `priority` (enum: "LOW" | "MEDIUM" | "HIGH", or null)
  - `dueDate` (ISO 8601 datetime string, or null)
- **Returns:** `{ title: string; description?: string; priority?: CardPriority; dueDate?: DateTime | null }`
- **Errors:**
  - ZodError if title is missing or invalid
  - ZodError if priority is not one of the enum values
  - ZodError if dueDate is not a valid ISO string

**Note on dueDate validation:**
- Accept strings, parse to Date/DateTime in the service layer
- Or accept optional ISO string and validate format in Zod
- Store in database as DateTime
- Be defensive about timezone handling (recommend UTC only)

#### `updateCardSchema`
- **Source:** Request body in `PATCH /cards/:id`
- **Required fields:** At least one of the following must be present
- **Optional fields:**
  - `title` (string, 1–200 chars)
  - `description` (string, 0–2000 chars)
  - `priority` (enum or null)
  - `dueDate` (ISO 8601 string or null)
- **Returns:** `{ title?: string; description?: string; priority?: CardPriority | null; dueDate?: DateTime | null }`
- **Errors:**
  - ZodError if invalid field values
  - Error if no fields are provided (empty update)

#### `moveCardSchema`
- **Source:** Request body in `POST /cards/:id/move`
- **Required fields:**
  - `toListId` (string, valid CUID format, the target list)
  - `version` (number, the card's current version for optimistic locking)
- **Optional fields (one must be provided, not both):**
  - `beforeCardId` (string, valid CUID, insert before this card in target list)
  - `afterCardId` (string, valid CUID, insert after this card in target list)
- **Returns:** `{ toListId: string; beforeCardId?: string; afterCardId?: string; version: number }`
- **Errors:**
  - ZodError if required fields missing or invalid
  - Error if both beforeCardId and afterCardId are provided
  - Error if neither beforeCardId nor afterCardId is provided (need at least one to anchor position)

**Note on move positioning:**
- If moving to a list with no cards yet, use null for both before/after
- If moving to a list with cards, at least one anchor is needed to calculate position
- Server calculates the position; client only provides the anchor card IDs

#### `cardIdSchema`
- **Source:** Path parameter in `/cards/:id`
- **Required fields:**
  - `id` (string, valid CUID format)
- **Returns:** `{ id: string }`

#### `listIdSchema`
- **Source:** Path parameter in `/lists/:id/cards`
- **Required fields:**
  - `id` (string, valid CUID format)
- **Returns:** `{ id: string }`

**Implementation pattern:** Follow the same structure as `listsValidator.ts`
- Export validation functions that use `.parse()` and throw `BadRequestError` on failure
- Handle Zod errors and wrap them in descriptive error messages

---

### 2. Middleware Module: `src/modules/cards/cardsMiddleware.ts`

**Purpose:** Enforce access control and load data into `req.locals` before handlers run.

**Middleware functions to define:**

#### `requireBoardEditor` (reused from lists, but adapted for cards)
- **Purpose:** Verify that the authenticated user has `EDITOR` or `OWNER` role on the board that contains this card
- **Where it's used:** All card endpoints (create, update, delete, move)
- **Input:**
  - `req.user.id` (from authMiddleware)
  - `listId` or `cardId` (to derive the board)
- **Logic:**
  1. If checking on `/lists/:id/cards` endpoint, get `listId` from path
  2. If checking on `/cards/:id` endpoint, need to fetch the card first to get `listId` (see below)
  3. Query `lists` table to get the board: `list.boardId`
  4. Query `memberships` table for `(userId, boardId)`
  5. Check if `role IN ('EDITOR', 'OWNER')`
  6. If not found or wrong role, throw `ForbiddenError('Only editors can modify cards')`
  7. If found, attach to `req.locals.membership` for use in handlers
- **Returns:** Express middleware function `(req, res, next) => Promise<void>`
- **Error handling:** Throws `ForbiddenError` (caught by error handler, returns 403)

**Implementation note:**
- This is trickier than lists because `/cards/:id` routes don't have `listId` in the path
- Solution: Fetch the card first (in separate middleware), get `card.listId`, then check permissions

#### `validateCardExists`
- **Purpose:** Verify that a card with the given `id` exists and optionally belongs to a specific list
- **Where it's used:** `PATCH /cards/:id`, `DELETE /cards/:id`, `POST /cards/:id/move`
- **Input:**
  - `req.params.id` (card ID)
  - `listId` (optional, from request context)
- **Logic:**
  1. Parse card ID using `validateCardId`
  2. Query `cards` table for the card, including the related list and board info (using Prisma relations)
  3. If not found, throw `NotFoundError('Card not found')`
  4. If `listId` is provided and `card.listId !== listId`, throw `NotFoundError('Card not found in this list')`
  5. Attach to `req.locals.card` (includes full card object with relations)
- **Returns:** Express middleware function
- **Error handling:** Throws `NotFoundError` (caught by error handler, returns 404)

**Recommendation:**
- Fetch the card with relations: `.include({ list: { include: { board: true } } })`
- This allows you to access `req.locals.card.list.boardId` downstream

#### `validateMovePayload`
- **Purpose:** Verify that the move request has a valid version and that the card hasn't been modified by someone else
- **Where it's used:** `POST /cards/:id/move`
- **Input:**
  - `req.body.version` (the version the client thinks the card is at)
  - `req.locals.card.version` (the current version from database)
- **Logic:**
  1. Compare `req.body.version` with `req.locals.card.version`
  2. If `req.body.version < req.locals.card.version`, throw `ConflictError` with status 409
     - Include in response body: `{ error: "...", statusCode: 409, currentVersion: req.locals.card.version }`
  3. If versions match, call `next()` to proceed
- **Returns:** Express middleware function
- **Error handling:** Throws `ConflictError` (should return 409)

**Important:**
- This middleware is only used for the `POST /cards/:id/move` endpoint
- On other endpoints (edit, delete), you don't need to check version; only move is conflicted by concurrent edits

#### Middleware Chain Order

For each endpoint type:

**POST /lists/:id/cards (create):**
```
requireAuth
→ validateListId (ensure list exists)
→ requireBoardEditor (check role)
→ handler
```

**PATCH /cards/:id (edit):**
```
requireAuth
→ validateCardExists (fetch card, get card.list.boardId)
→ requireBoardEditor (check role, using card.list.boardId)
→ handler
```

**DELETE /cards/:id:**
```
requireAuth
→ validateCardExists
→ requireBoardEditor
→ handler
```

**POST /cards/:id/move:**
```
requireAuth
→ validateCardExists (fetch current card, check version)
→ validateMovePayload (compare versions, throw 409 if stale)
→ requireBoardEditor (check role)
→ validateTargetList (ensure toListId exists and is in same board)
→ handler
```

**New middleware: `validateTargetList`**
- **Purpose:** For move endpoint, ensure the target list exists and belongs to the same board
- **Logic:**
  1. Get `toListId` from `req.body`
  2. Fetch the target list
  3. Verify `targetList.boardId === req.locals.card.list.boardId` (same board)
  4. Attach to `req.locals.targetList`
- **Error handling:** Throw `NotFoundError` if list doesn't exist or is in a different board

---

### 3. Service Module: `src/modules/cards/cardsService.ts`

**Purpose:** Implement business logic for card operations.

**Functions to define:**

#### `createCard(listId: string, title: string, description?: string, priority?: CardPriority, dueDate?: DateTime): Promise<Card>`
- **Purpose:** Create a new card in the list
- **Input:**
  - `listId` (string, the list the card belongs to)
  - `title` (string, already validated)
  - `description` (optional string, already validated)
  - `priority` (optional CardPriority enum, already validated)
  - `dueDate` (optional DateTime, already validated)
- **Logic:**
  1. Calculate the initial position for the new card in the list
     - Fetch the last card in the list (ordered by position descending)
     - If no cards exist, use `calculateCardPosition(listId, null, null)` → "a0"
     - If cards exist, use `calculateCardPosition(listId, lastCard.position, null)` to get position after the last
  2. Insert into `cards` table with `(title, description, priority, dueDate, listId, position, version: 0)`
  3. Return the created card object
- **Error handling:**
  - Prisma unique constraint violation on `(listId, position)` → throw `ConflictError` (should be rare with fractional-index)
  - Prisma foreign key constraint on `listId` → throw `NotFoundError('List not found')`
- **Database call:**
  ```
  db.card.create({
    data: { 
      title, 
      description, 
      priority, 
      dueDate, 
      listId, 
      position,
      version: 0
    },
  })
  ```

#### `updateCard(cardId: string, updates: { title?: string; description?: string; priority?: CardPriority | null; dueDate?: DateTime | null }, expectedVersion?: number): Promise<Card>`
- **Purpose:** Edit a card's fields and increment its version
- **Input:**
  - `cardId` (string, already validated)
  - `updates` (object with optional fields)
  - `expectedVersion` (optional, for optimistic locking on non-move updates)
- **Logic:**
  1. If `updates` is empty, throw `BadRequestError('No fields to update')`
  2. If `expectedVersion` is provided, fetch the card and compare versions
     - If `expectedVersion < card.version`, throw `ConflictError` with 409
  3. Update the card with the provided fields AND increment `version` by 1
     - Set `data: { ...updates, version: { increment: 1 } }`
  4. Return the updated card object
- **Error handling:**
  - Prisma not found (card doesn't exist) → throw `NotFoundError('Card not found')`
  - Version conflict → throw `ConflictError` with 409
- **Database call:**
  ```
  db.card.update({
    where: { id: cardId },
    data: { 
      ...updates,
      version: { increment: 1 }
    },
  })
  ```

**Note:** For MVP, the `expectedVersion` parameter is optional. You can add optimistic locking on edits in Phase 2 if needed.

#### `deleteCard(cardId: string): Promise<void>`
- **Purpose:** Delete a card
- **Input:**
  - `cardId` (string, already validated)
- **Logic:**
  1. Delete the card by ID
  2. Activity records referencing this card will have `cardId` set to null (onDelete: SetNull in schema)
  3. Return void
- **Error handling:**
  - Prisma not found → throw `NotFoundError('Card not found')`
- **Database call:**
  ```
  db.card.delete({
    where: { id: cardId },
  })
  ```

#### `moveCard(cardId: string, toListId: string, beforeCardId?: string, afterCardId?: string, expectedVersion: number): Promise<Card>`
- **Purpose:** Move a card to a different list or reorder it within the same list
- **Input:**
  - `cardId` (string, already validated)
  - `toListId` (string, already validated to exist in same board)
  - `beforeCardId` (optional string, the card to insert before)
  - `afterCardId` (optional string, the card to insert after)
  - `expectedVersion` (number, for optimistic locking)
- **Logic:**
  1. Fetch the current card from database
  2. **Optimistic lock check:** If `expectedVersion < card.version`, throw `ConflictError` with 409
     - This prevents last-write-wins when someone else edited the card
  3. Calculate the new position in the target list
     - If target list has no cards: `calculateCardPosition(toListId, null, null)` → "a0"
     - If inserting before a specific card: fetch that card and any card before it, use `calculateCardPosition(toListId, beforeCard.position, null)`
     - If inserting after a specific card: fetch that card and any card after it, use `calculateCardPosition(toListId, afterCard.position, null)`
     - **Edge case:** If moving within the same list and the before/after cards are the same or don't form a valid range, throw `BadRequestError`
  4. Update the card in a **database transaction** to ensure consistency:
     ```
     START TRANSACTION
       UPDATE card SET listId = toListId, position = newPosition, version = version + 1
       WHERE id = cardId AND version = expectedVersion
     COMMIT
     ```
  5. Return the updated card
  6. **If transaction fails** (0 rows updated), it means version mismatch → throw `ConflictError` with 409

**Error handling:**
  - Version conflict (transaction fails) → throw `ConflictError` with 409
  - Target list doesn't exist → throw `NotFoundError('Target list not found')`
  - Card not found → throw `NotFoundError('Card not found')`
  - Invalid move params → throw `BadRequestError`

**Database call (pseudo-code):**
```
db.$transaction(async (tx) => {
  const updated = await tx.card.updateMany({
    where: { id: cardId, version: expectedVersion },
    data: { 
      listId: toListId, 
      position: newPosition, 
      version: { increment: 1 }
    },
  });
  
  if (updated.count === 0) {
    throw new ConflictError('Card was modified');
  }
  
  return tx.card.findUnique({ where: { id: cardId } });
});
```

**Important:** Use a transaction to ensure that the version check and update are atomic. Without this, another request could modify the card between the check and the update.

#### `getCardById(cardId: string): Promise<Card>`
- **Purpose:** Fetch a single card by ID
- **Input:**
  - `cardId` (string)
- **Logic:**
  1. Query the card by ID
  2. Return the card or throw `NotFoundError` if not found
- **Error handling:**
  - If not found, throw `NotFoundError('Card not found')`
- **Database call:**
  ```
  db.card.findUnique({
    where: { id: cardId },
    include: { list: { include: { board: true } } },
  })
  ```

#### `getCardsByListId(listId: string): Promise<Card[]>`
- **Purpose:** Fetch all cards in a list, ordered by position
- **Input:**
  - `listId` (string)
- **Logic:**
  1. Query all cards for the list
  2. Order them by position ascending
  3. Return the array
- **Error handling:** None; returning empty array is fine
- **Database call:**
  ```
  db.card.findMany({
    where: { listId },
    orderBy: { position: 'asc' },
  })
  ```

#### `calculateCardPosition(listId: string, afterPosition?: string, beforePosition?: string): Promise<string>`
- **Purpose:** Generate a fractional index position for a card within a list
- **Input:**
  - `listId` (string, context for debugging)
  - `afterPosition` (position of the card this new card goes after, or null if first)
  - `beforePosition` (position of the card this new card goes before, or null if last)
- **Logic:**
  1. This is a helper function that delegates to the `fractional-index` library
  2. The library provides a function like `getKeyBetween(afterKey, beforeKey)` that generates a position string
  3. For the first card: `getKeyBetween(null, null)` → "a0"
  4. For appending: `getKeyBetween(lastPosition, null)` → "a1", "a2", etc.
  5. When inserting between two cards: `getKeyBetween(afterPosition, beforePosition)` → midpoint
  6. When moving within the same list and the card is between the same two neighbors, return the same position (no move needed)
- **Error handling:** Should not throw; the fractional-index library is deterministic
- **Returns:** A string like "a0", "a1", "m0.5", etc.

**Important:** The helper does NOT query the database; it only does math on position strings. This keeps it fast and testable.

---

### 4. Routes Module: `src/modules/cards/cardsRoutes.ts`

**Purpose:** Define HTTP endpoints, wire middleware, parse requests, and call services.

**Endpoints to define:**

#### `POST /lists/:id/cards`
- **Handler name:** `createCardHandler`
- **Middleware chain:**
  1. `requireAuth` (from authMiddleware) → attaches `req.user`
  2. Custom: validate `listId` from path and ensure it exists
  3. `requireBoardEditor` (with `listId`) → validates role
- **Request handling:**
  1. Extract `listId` from `req.params.id` and validate it
  2. Extract fields from `req.body` and validate using `validateCreateCardPayload`
  3. Call `cardsService.createCard(listId, title, description, priority, dueDate)`
  4. Return the created card as JSON with 201 status
- **Error flow:** Middleware or validator throws → error handler catches → returns 400/403/404
- **Response:**
  ```json
  {
    "id": "card_123",
    "title": "Fix login bug",
    "description": "Session expires too quickly",
    "priority": "HIGH",
    "dueDate": "2024-01-20T18:00:00Z",
    "listId": "list_456",
    "position": "a0",
    "version": 0,
    "createdAt": "2024-01-15T10:00:00Z",
    "updatedAt": "2024-01-15T10:00:00Z"
  }
  ```

#### `PATCH /cards/:id`
- **Handler name:** `updateCardHandler`
- **Middleware chain:**
  1. `requireAuth`
  2. `validateCardExists` (fetch card and attach to req.locals)
  3. `requireBoardEditor` (using card.list.boardId)
- **Request handling:**
  1. Extract card ID from `req.params.id` and validate it
  2. Extract updates from `req.body` and validate using `validateUpdateCardPayload`
  3. Call `cardsService.updateCard(cardId, updates)`
  4. Return the updated card as JSON with 200 status
- **Error flow:** Same as create
- **Response:** Same structure as create, but with updated fields and incremented version

#### `DELETE /cards/:id`
- **Handler name:** `deleteCardHandler`
- **Middleware chain:** Same as PATCH
- **Request handling:**
  1. Extract and validate card ID from `req.params.id`
  2. Call `cardsService.deleteCard(cardId)`
  3. Return 204 No Content (or 200 with empty response)
- **Error flow:** Same as above
- **Response:** 204 No Content (empty body)

#### `POST /cards/:id/move`
- **Handler name:** `moveCardHandler`
- **Middleware chain:**
  1. `requireAuth`
  2. `validateCardExists` (fetch card)
  3. `validateMovePayload` (check version, throw 409 if stale)
  4. `requireBoardEditor` (check role)
  5. `validateTargetList` (ensure target list exists and is in same board)
- **Request handling:**
  1. Extract card ID from `req.params.id` and validate it
  2. Extract move params from `req.body` and validate using `validateMoveCardPayload`
  3. Call `cardsService.moveCard(cardId, toListId, beforeCardId, afterCardId, version)`
  4. Return the updated card as JSON with 200 status
- **Error flow:**
  - 401: not authenticated
  - 403: not an editor
  - 404: card, source list, or target list doesn't exist
  - 409: version is stale (card was modified by someone else)
  - 400: invalid payload
- **Response:** Same structure as create, but with updated position and incremented version

**Conflict Response Format (409):**
```json
{
  "error": "Card was modified by another user",
  "statusCode": 409,
  "currentVersion": 5,
  "card": { ... full card object ... }
}
```

The client should refetch the card and retry the move with the new version.

**Routing structure:**
- Create a new Express router in `cardsRoutes.ts`
- Register handlers on the router:
  - `router.post('/lists/:listId/cards', ...)` for create
  - `router.patch('/:id', ...)` for update
  - `router.delete('/:id', ...)` for delete
  - `router.post('/:id/move', ...)` for move
- Export the router
- In `app.ts`, mount it:
  - Option: `app.use('/', cardsRoutes)` to use the full paths
  - Or: `app.use('/cards', cardsRoutes)` for `/cards/:id` routes, and handle `/lists/:id/cards` separately if needed

**Note on route organization:**
- The create endpoint is under `/lists/:id/cards` (RESTful, resources nested)
- The other endpoints are under `/cards/:id` (object-focused, flat)
- You may need to mount the router twice or organize differently:
  - Mount under `/lists` for the create endpoint
  - Mount under `/cards` for the other endpoints
  - Or use a single mount and define all paths relative to root

**Example mounting in app.ts:**
```
app.use('/lists', cardsRoutes); // handles /lists/:id/cards POST
app.use('/cards', cardsRoutes); // handles /cards/:id PATCH/DELETE/move POST
```

---

### 5. App Wiring: `app.ts`

**What to add/change:**

1. **Import the cards router:**
   ```
   import cardsRoutes from './src/modules/cards/cardsRoutes.js'
   ```

2. **Mount the router (after lists and before error handler):**
   ```
   app.use('/boards', boardsRoutes);
   app.use('/lists', listsRoutes);
   app.use('/lists', cardsRoutes);  // POST /lists/:id/cards
   app.use('/cards', cardsRoutes);  // PATCH, DELETE, move on /cards/:id
   ```

3. **Order matters:** Mount after `express.json()` and CORS, before error handler

---

### 6. Prisma Schema: `contract.prisma`

**What's already there:**
The Prisma schema already has the `Card` model defined with:
- `id`, `title`, `description`, `priority`, `dueDate`, `listId`, `position`, `version`
- Relations to `List` and `Activity`
- Unique constraint on `(listId, position)`
- Index on `listId`
- `version` field with default 0

**What you need to verify:**
- The `Card` model is complete and correct
- The `onDelete: Cascade` on the `List` relation is set (already is)
- The `Activity` relation has `onDelete: SetNull` on `cardId` (already is)
- No migrations are needed; the schema is ready

**If you need to make changes:**
- Run `prisma migrate dev --name <name>` to create and apply a migration
- Use `contract:emit` to regenerate the contract files

---

## Request/Response Flow Example

### POST /lists/list_123/cards

**Request:**
```http
POST /lists/list_123/cards HTTP/1.1
Authorization: Bearer eyJhbGci...
Content-Type: application/json

{
  "title": "Fix login bug",
  "description": "Session expires too quickly",
  "priority": "HIGH",
  "dueDate": "2024-01-20T18:00:00Z"
}
```

**Flow:**
1. `cardsRoutes.ts` receives the request
2. `requireAuth` middleware runs → extracts JWT, attaches `req.user = { id: "user_456", ... }`
3. Handler extracts `listId = "list_123"` from `req.params.id`
4. Handler validates `listId` (CUID format check)
5. Handler verifies list exists by querying database (part of permission check or separate middleware)
6. `requireBoardEditor` middleware runs → fetches list.boardId → queries memberships → finds `(user_456, boardId, EDITOR)` → attaches `req.locals.membership`
7. Handler extracts fields from `req.body`
8. Handler calls `validateCreateCardPayload(...)` → passes validation
9. Handler calls `cardsService.createCard("list_123", "Fix login bug", "Session expires...", "HIGH", dueDate)`
10. Service fetches last card in list (none exist) → calls `calculateCardPosition("list_123", null, null)` → returns "a0"
11. Service calls `db.card.create({ data: { title: "Fix login bug", ..., position: "a0", version: 0 } })`
12. Prisma inserts and returns the created card
13. Handler returns 201 with the card JSON

**Response:**
```json
201 Created
{
  "id": "card_789",
  "title": "Fix login bug",
  "description": "Session expires too quickly",
  "priority": "HIGH",
  "dueDate": "2024-01-20T18:00:00Z",
  "listId": "list_123",
  "position": "a0",
  "version": 0,
  "createdAt": "2024-01-15T10:00:00Z",
  "updatedAt": "2024-01-15T10:00:00Z"
}
```

---

### POST /cards/card_789/move

**Request (moving within same list):**
```http
POST /cards/card_789/move HTTP/1.1
Authorization: Bearer eyJhbGci...
Content-Type: application/json

{
  "toListId": "list_123",
  "afterCardId": "card_456",
  "beforeCardId": null,
  "version": 0
}
```

**Flow:**
1. `requireAuth` runs → attaches user
2. `validateCardExists` middleware runs → fetches card_789 → attaches to req.locals.card
3. `validateMovePayload` middleware runs → compares req.body.version (0) with req.locals.card.version (0) → match, proceed
4. `requireBoardEditor` runs → gets boardId from card.list.boardId → checks membership → passes
5. `validateTargetList` runs → fetches target list_123 → verifies it's in same board → passes
6. Handler extracts move params from request body
7. Handler validates using `validateMoveCardPayload` → passes
8. Handler calls `cardsService.moveCard("card_789", "list_123", null, "card_456", 0)`
9. Service fetches card_456 (afterCardId) to get its position
10. Service calls `calculateCardPosition("list_123", "a1", null)` → generates new position, say "a1.5"
11. Service updates card in a transaction:
    ```
    UPDATE cards 
    SET listId = "list_123", position = "a1.5", version = 1 
    WHERE id = "card_789" AND version = 0
    ```
12. Transaction succeeds, card is updated, version is now 1
13. Service fetches and returns the updated card
14. Handler returns 200 with updated card JSON

**Response:**
```json
200 OK
{
  "id": "card_789",
  "title": "Fix login bug",
  "description": "Session expires too quickly",
  "priority": "HIGH",
  "dueDate": "2024-01-20T18:00:00Z",
  "listId": "list_123",
  "position": "a1.5",
  "version": 1,
  "createdAt": "2024-01-15T10:00:00Z",
  "updatedAt": "2024-01-15T10:00:38Z"
}
```

---

### POST /cards/card_789/move (Conflict Scenario)

**Request (stale version):**
```http
POST /cards/card_789/move HTTP/1.1
Authorization: Bearer eyJhbGci...
Content-Type: application/json

{
  "toListId": "list_123",
  "afterCardId": "card_456",
  "version": 0
}
```

**Current state:** Card has already been moved by another user; version is now 1

**Flow:**
1. Middleware runs, `validateCardExists` fetches card (version: 1)
2. `validateMovePayload` compares req.body.version (0) with req.locals.card.version (1)
3. 0 < 1, so throw `ConflictError` with 409
4. Error handler catches and returns:

**Response:**
```json
409 Conflict
{
  "error": "Card was modified by another user",
  "statusCode": 409,
  "currentVersion": 1,
  "card": { ... full card object with version: 1 ... }
}
```

**Client behavior:**
- Client receives 409 response
- Client parses the response and gets `currentVersion: 1` and the updated card
- Client retries the move with `version: 1` (the new version)
- Next attempt succeeds (or gets another 409 if someone else moved it again)

---

## Error Scenarios

### Scenario 1: User tries to create a card in a list from a board they're not a member of

**Request:**
```
POST /lists/list_999/cards
Authorization: Bearer <token>
{ "title": "..." }
```

**Flow:**
1. `requireAuth` passes
2. Verify list exists (list_999 not found or not in user's board)
3. `requireBoardEditor` queries memberships for (user, boardId)
4. No row found
5. Throws `ForbiddenError`

**Response:**
```json
403 Forbidden
{
  "error": "Only editors can modify cards",
  "statusCode": 403
}
```

### Scenario 2: User provides invalid priority

**Request:**
```
POST /lists/list_123/cards
Authorization: Bearer <token>
{
  "title": "Task",
  "priority": "URGENT"
}
```

**Flow:**
1. Middleware passes
2. Handler calls `validateCreateCardPayload(...)`
3. Zod validation fails (URGENT not in enum)
4. Throws `BadRequestError`

**Response:**
```json
400 Bad Request
{
  "error": "Priority must be one of: LOW, MEDIUM, HIGH",
  "statusCode": 400
}
```

### Scenario 3: User tries to move card to a list in a different board

**Request:**
```
POST /cards/card_123/move
Authorization: Bearer <token>
{
  "toListId": "list_999",
  "afterCardId": "card_456",
  "version": 0
}
```

**Flow:**
1. `requireAuth` passes
2. `validateCardExists` fetches card (in list A of board X)
3. `validateMovePayload` passes (version matches)
4. `requireBoardEditor` passes (user is editor of board X)
5. `validateTargetList` fetches list_999 (in list B of board Y)
6. targetList.boardId (Y) !== card.list.boardId (X)
7. Throws `NotFoundError` or `ForbiddenError`

**Response:**
```json
404 Not Found
{
  "error": "Target list not found",
  "statusCode": 404
}
```

### Scenario 4: User tries to update card without providing any fields

**Request:**
```
PATCH /cards/card_123
Authorization: Bearer <token>
{}
```

**Flow:**
1. Middleware passes
2. Handler calls `validateUpdateCardPayload({})`
3. Validation fails (no fields provided)
4. Throws `BadRequestError`

**Response:**
```json
400 Bad Request
{
  "error": "At least one field must be provided",
  "statusCode": 400
}
```

---

## Testing Strategy

### Unit Tests (cardsService.spec.ts)

**What to test:**

- `calculateCardPosition` generates correct fractional indices
  - First card in list → "a0"
  - Append to existing cards → "a1", "a2", etc.
  - Insert between two cards → generates midpoint
  - Multiple levels of nesting → "m0.5", "m0.25", etc.

- `createCard` calls Prisma with correct data
  - Fields are set correctly
  - Position is calculated
  - Version starts at 0

- `updateCard` only updates provided fields
  - Version is incremented
  - Other fields remain unchanged
  - Empty update throws error

- `moveCard` handles version checking
  - Stale version throws 409
  - Transaction ensures atomicity
  - Position is recalculated
  - Version is incremented

- `deleteCard` calls Prisma delete
  - Card is removed
  - Non-existent card throws error

- Service throws correct errors
  - `NotFoundError` for missing resources
  - `ConflictError` for version conflicts
  - `BadRequestError` for invalid inputs

### Integration Tests (cardsRoutes.spec.ts)

**What to test:**

- POST /lists/:id/cards
  - Valid data → 201, card created
  - Invalid title → 400
  - Missing list → 404
  - Not authenticated → 401
  - Viewer role → 403

- PATCH /cards/:id
  - Valid update → 200, card updated, version incremented
  - Empty update → 400
  - Non-existent card → 404
  - Not authenticated → 401
  - Viewer role → 403

- DELETE /cards/:id
  - Valid delete → 204, card removed
  - Non-existent card → 404
  - Cascade: activity records with this card have cardId set to null

- POST /cards/:id/move
  - Move within list → 200, position recalculated, version incremented
  - Move across lists → 200, listId and position changed
  - Stale version → 409, includes currentVersion and card in response
  - Non-existent target list → 404
  - Not authenticated → 401
  - Viewer role → 403

- Ordering and concurrency
  - Create 5 cards, verify they're ordered by position
  - Move card 3 times, verify final position is correct
  - Two users move same card concurrently, one gets 409 and retries

---

## Implementation Checklist

- [ ] Create `src/modules/cards/cardsValidator.ts` with all schemas
- [ ] Create `src/modules/cards/cardsMiddleware.ts` with all middleware functions
- [ ] Create `src/modules/cards/cardsService.ts` with all service functions
- [ ] Verify `fractional-index` package is installed and understand its API
- [ ] Create `src/modules/cards/cardsRoutes.ts` with all four endpoints
- [ ] Mount cardsRoutes in `app.ts` (under `/lists` and `/cards`)
- [ ] Verify Prisma schema has Card model (should be done already)
- [ ] Write unit tests for cardsService (focus on calculateCardPosition and moveCard logic)
- [ ] Write integration tests for cardsRoutes (focus on conflict scenarios)
- [ ] Test cascade delete (delete card, verify activity records are cleaned)
- [ ] Test move endpoint with stale version (409 response)
- [ ] Test concurrent moves (two requests with same cardId, verify one succeeds and one gets 409)
- [ ] Test permission enforcement (viewer cannot create/edit/delete/move cards)

---

## Key Design Decisions

### 1. Fractional Indexing for Ordering
- **Why:** Moving a card is O(1) database operation instead of O(n) renumbering
- **How:** Use `fractional-index` library to generate positions between existing items
- **Trade-off:** Position strings are opaque to the client; ordering is done server-side

### 2. Version-Based Optimistic Locking
- **Why:** Detect conflicts when multiple users edit/move the same card simultaneously
- **How:** Client sends version with request; server compares and throws 409 if stale
- **Trade-off:** Client must handle 409 and retry; adds complexity but prevents silent overwrites

### 3. Move Endpoint Separate from Edit
- **Why:** Move has special logic (position calculation, version check) and should be explicit
- **How:** POST /cards/:id/move with toListId, before/afterCardId, version
- **Trade-off:** Extra endpoint, but semantics are clearer and testing is easier

### 4. Transaction for Move Update
- **Why:** Ensure version check and update are atomic
- **How:** Prisma transaction wraps the check and update in one database call
- **Trade-off:** Slightly higher latency, but prevents race conditions

### 5. Cascade Delete on Card Deletion
- **Why:** Data integrity; no orphaned cards in lists
- **How:** Prisma schema defines `onDelete: Cascade` on List.cards relation
- **Trade-off:** Cards are deleted silently; no separate endpoint or soft-delete

### 6. Activity Records Handle Deleted Cards
- **Why:** Audit trail should remain even if card is deleted
- **How:** Activity.cardId has `onDelete: SetNull`, so activity persists with null cardId
- **Trade-off:** Activity records reference deleted cards; must handle null gracefully in queries

---

## Common Pitfalls to Avoid

1. **Not validating target list in move:** Attacker could move cards between boards
2. **Fetching card multiple times:** Fetch once in middleware, attach to req.locals, reuse downstream
3. **Forgetting to increment version:** Every update must increment version, or conflicts won't be detected
4. **Not using transaction for move:** Race condition where version check passes but another request updates the card
5. **Assuming position strings are ordered:** They are (lexicographic), but don't expose this to the client
6. **Not handling empty updates:** PATCH /cards/:id with `{}` should reject with 400, not silently succeed
7. **Not testing concurrent moves:** Most bugs appear only under concurrency; write tests with multiple parallel requests
8. **Forgetting cascade on delete:** Deleting a list doesn't delete its cards if cascade is missing
9. **Not validating beforeCardId and afterCardId:** Both cards must be in the target list, and position range must be valid
10. **Returning 404 instead of 409:** When version is stale, return 409 Conflict, not 404 Not Found

---

## Summary

The Cards CRUD layer is built in four modules that follow the existing patterns:

1. **Validator:** Parses and enforces schema with Zod (includes move-specific validation)
2. **Middleware:** Checks auth and permissions, loads data into context, validates versions
3. **Service:** Implements business logic (CRUD, position calculation, transaction-based move)
4. **Routes:** Defines HTTP endpoints and wires middleware + service

The key technical challenges are:
- **Fractional indexing:** Calculating positions between existing cards for moves
- **Version-based concurrency:** Detecting conflicts and returning 409
- **Transaction safety:** Ensuring version check and update are atomic
- **Permission derivation:** Getting boardId from cardId (card → list → board)

All error cases are handled consistently with existing error classes. The move endpoint is the most complex but also the most important for a real-time collaborative experience.