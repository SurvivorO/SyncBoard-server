# Real-Time Collaboration Requirements & Features

## Overview

This document outlines the complete requirements for Socket.IO real-time collaboration in SyncBoard. Real-time enables multiple users viewing the same board to see live updates—card moves, edits, list changes, presence—without refreshing the page.

**Core principle:** The server is the source of truth. Clients send mutations via REST API, the server validates and persists, then broadcasts events via Socket.IO to all room members.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ Client 1 (Browser)                                      │
│ ├─ REST API: POST /cards/123/move                       │
│ └─ Socket.IO Listener: card:moved                       │
└──────────────────┬──────────────────────────────────────┘
                   │ HTTP + WebSocket
┌──────────────────▼──────────────────────────────────────┐
│ Express + Socket.IO Server                              │
│ ├─ Routes (CRUD via REST)                              │
│ ├─ Services (business logic)                            │
│ ├─ Socket.IO Rooms (per board)                         │
│ ├─ Presence Tracking (who's online)                    │
│ └─ Broadcaster (emit events to rooms)                  │
└──────────────────┬──────────────────────────────────────┘
                   │ HTTP + WebSocket
┌──────────────────▼──────────────────────────────────────┐
│ Client 2 (Browser)                                      │
│ ├─ REST API: POST /cards/456/move                       │
│ └─ Socket.IO Listener: card:moved                       │
└─────────────────────────────────────────────────────────┘
```

---

## Core Concepts

### 1. Socket.IO Rooms
- **One room per board:** `board_<boardId>`
- **Membership:** Only users with board access can join
- **Isolation:** Events in room A don't leak to room B
- **Cleanup:** When all users leave, room can be destroyed

### 2. Authentication on Connection
- Client connects with JWT token in handshake
- Server verifies token before allowing connection
- Extract `userId` from token payload
- Reject unauthorized connections

### 3. Authorization on Room Join
- When client sends `board:join`, verify they're a board member
- Check `memberships` table: `(userId, boardId)`
- Reject if not found or role is invalid (though viewers can join)
- Track connection in presence map

### 4. Presence Tracking
- Know who's currently viewing each board
- Emit to room whenever someone joins/leaves
- Presence includes: userId, userName, userEmail, boardId, joinedAt
- Used to show "User A is here" in frontend

### 5. Event Broadcasting
- After REST API mutates data, emit event to room
- Event includes the mutated object (card, list, activity)
- All room members receive and can update UI
- Server is single source of truth; events confirm mutations

### 6. Activity Log Integration
- Every action is logged to `Activity` table
- Log includes: userId, type (CARD_MOVED, etc.), payload (what changed)
- Activity is queryable via `GET /boards/:id/activity`
- Provides audit trail and historical view

---

## Feature Breakdown

### Feature 1: Socket.IO Server Setup

**What it does:**
- Initialize Socket.IO server
- Attach to HTTP server
- Configure CORS for frontend URLs
- Setup connection/disconnection handlers

**Where it lives:**
```
src/modules/realtime/
├── socketServer.ts      (Socket.IO initialization & config)
├── socketAuth.ts        (JWT verification on connect)
├── socketRooms.ts       (room join/leave logic)
├── socketPresence.ts    (presence tracking)
└── socketBroadcaster.ts (emit events to rooms)
```

**Responsibilities:**
- Create Socket.IO instance with HTTP server
- Register namespaces (root `/`)
- Configure authentication middleware
- Setup connection event handlers
- Error handling for socket disconnects/errors

**Dependencies:**
- `socket.io` package
- JWT token from client handshake
- Database connection (Prisma)

**Integration point:**
- In `server.ts`, after HTTP server is created, initialize Socket.IO
- Pass HTTP server to Socket.IO constructor
- Call `setupSocketServer(io)` to register event handlers

---

### Feature 2: Socket.IO Authentication

**What it does:**
- Verify JWT token in WebSocket handshake
- Extract userId from token
- Reject unauthorized connections
- Handle token expiration gracefully

**Where it lives:**
```
src/modules/realtime/socketAuth.ts
```

**Middleware function:**
```
onConnection middleware
├─ Extract token from handshake.auth.token
├─ Verify JWT (same as REST authMiddleware)
├─ Extract userId and email
├─ Attach to socket.data.userId, socket.data.email
└─ Reject if token invalid
```

**Behavior:**
- **Valid token:** Connection accepted, socket.data.userId is set
- **No token:** Connection rejected with error
- **Expired token:** Connection rejected with error
- **Invalid signature:** Connection rejected with error

**Error handling:**
- Emit `auth_error` event to client before disconnecting
- Log unauthorized attempts (security audit)
- Don't expose token validation details in error messages

**Testing:**
- Test connection with valid JWT → succeeds
- Test connection with no token → rejected
- Test connection with expired JWT → rejected
- Test connection with invalid signature → rejected

---

### Feature 3: Room Management (board:join / board:leave)

**What it does:**
- Allow authenticated users to join a board's Socket.IO room
- Verify they're a board member before allowing join
- Track who's in each room
- Allow users to leave rooms
- Cleanup when last user leaves

**Events:**

#### `board:join` (Client → Server)
**Payload:**
```json
{
  "boardId": "board_123"
}
```

**Server logic:**
1. Verify user is authenticated (socket.data.userId exists)
2. Extract boardId from payload
3. Query `memberships` table: check `(userId, boardId)` exists
4. If not found, emit `error` event: `"Access denied"`
5. If found:
   - Join socket to room: `socket.join(`board_${boardId}`)`
   - Add to presence map: `presence[boardId][userId] = {...}`
   - Emit `presence:update` to room with all members in room
   - Log join event

**Response to client:**
- No direct response (success is implicit)
- Or emit `board:joined` confirmation event

**Error cases:**
- User not authenticated → reject
- boardId invalid → reject
- User not a member of board → reject

#### `board:leave` (Client → Server)
**Payload:**
```json
{
  "boardId": "board_123"
}
```

**Server logic:**
1. Verify user is authenticated
2. Leave socket from room: `socket.leave(`board_${boardId}`)`
3. Remove from presence map
4. Emit `presence:update` to room (without the leaving user)
5. If room is now empty, optionally cleanup

**Response to client:**
- Emit `board:left` confirmation

**Auto-cleanup on disconnect:**
- When socket disconnects (browser closes, network drops), automatically leave all rooms
- Remove from presence map
- Emit `presence:update` to affected rooms

**Testing:**
- Test join with valid membership → succeeds
- Test join as viewer → succeeds (viewers can join/watch)
- Test join as non-member → rejected
- Test leave → user removed from presence
- Test disconnect → user auto-removed from all rooms
- Test presence:update events sent correctly

---

### Feature 4: Presence Tracking

**What it does:**
- Maintain a real-time map of who's in each board
- Broadcast presence updates when users join/leave
- Store presence data in memory (or Redis for scaling)
- Include user metadata in presence

**Data structure:**
```typescript
type Presence = {
  boardId: string;
  users: {
    [userId: string]: {
      userId: string;
      userName: string;
      userEmail: string;
      joinedAt: timestamp;
      socketId: string; // for debugging
    }
  }
}
```

**Where it lives:**
```
src/modules/realtime/socketPresence.ts
```

**Functions:**

#### `initializePresenceMap()`
- Create empty map: `presence = {}`
- Called once on server startup

#### `addUserToPresence(boardId, userId, userName, userEmail)`
- Add user to presence[boardId].users[userId]
- Return updated presence object

#### `removeUserFromPresence(boardId, userId)`
- Delete presence[boardId].users[userId]
- Return updated presence object

#### `getUsersInBoard(boardId)`
- Return array of users currently in boardId
- Return empty array if board has no users

#### `getBoardsForUser(userId)`
- Return array of boardIds user is currently in
- Used for cleanup on disconnect

**Presence event: `presence:update`**

**Direction:** Server → Client
**Payload:**
```json
{
  "boardId": "board_123",
  "users": [
    {
      "userId": "user_1",
      "userName": "Alice",
      "userEmail": "alice@example.com",
      "joinedAt": "2024-01-15T10:00:00Z"
    },
    {
      "userId": "user_2",
      "userName": "Bob",
      "userEmail": "bob@example.com",
      "joinedAt": "2024-01-15T10:05:00Z"
    }
  ]
}
```

**When it's sent:**
- After `board:join` event is processed
- After `board:leave` event is processed
- After client disconnect (auto-leave)

**How to emit:**
```typescript
io.to(`board_${boardId}`).emit('presence:update', presencePayload);
```

**Testing:**
- Test user joins board → presence:update shows them
- Test user leaves board → presence:update removes them
- Test multiple users in same board → presence shows all
- Test multiple users leave concurrently → presence updates correctly

---

### Feature 5: Card Event Broadcasts

**What it does:**
- After card CRUD operations (create, update, move, delete), emit events to the board room
- All room members receive events and update their UI
- Events include full card object so clients have complete data

**Where it lives:**
```
src/modules/realtime/socketBroadcaster.ts
```

**Integration:**
- After each card operation in `cardsService.ts`, call broadcaster
- Broadcaster checks if operation succeeded, then emits to room

**Events:**

#### `card:created` (Server → Client)
**When:** After `POST /lists/:id/cards` succeeds
**Payload:**
```json
{
  "boardId": "board_123",
  "card": {
    "id": "card_456",
    "title": "Fix login bug",
    "description": "...",
    "priority": "HIGH",
    "dueDate": "2024-01-20T18:00:00Z",
    "listId": "list_789",
    "position": "a0",
    "version": 0,
    "createdAt": "2024-01-15T10:00:00Z",
    "updatedAt": "2024-01-15T10:00:00Z"
  }
}
```
**Emit to:** `io.to(`board_${boardId}`).emit('card:created', payload)`

#### `card:updated` (Server → Client)
**When:** After `PATCH /cards/:id` succeeds
**Payload:** Same as `card:created`, but includes updated fields and incremented version
**Emit to:** Same room

#### `card:moved` (Server → Client)
**When:** After `POST /cards/:id/move` succeeds
**Payload:** Same as `card:created`, but includes new listId and position, incremented version
**Emit to:** Same room (both source and target list are in same board)

#### `card:deleted` (Server → Client)
**When:** After `DELETE /cards/:id` succeeds
**Payload:**
```json
{
  "boardId": "board_123",
  "cardId": "card_456",
  "listId": "list_789"
}
```
**Emit to:** Same room

**Broadcasting function:**
```typescript
async broadcastCardEvent(
  boardId: string,
  eventType: 'card:created' | 'card:updated' | 'card:moved' | 'card:deleted',
  card?: Card
): Promise<void>
```

**Logic:**
- Verify boardId is valid (optional safety check)
- Emit to room: `io.to(`board_${boardId}`).emit(eventType, payload)`
- Log broadcast (for debugging)

**Error handling:**
- If broadcast fails, log error but don't fail the API request
- Frontend might not see update, but data is persisted correctly
- User can refresh to see latest state

**Testing:**
- Test card:created event sent after POST
- Test card:updated event sent after PATCH
- Test card:moved event sent after move with new position
- Test card:deleted event sent after DELETE
- Test multiple clients in room receive event
- Test clients not in room don't receive event

---

### Feature 6: List Event Broadcasts

**What it does:**
- Same as cards, but for list operations
- After list CRUD operations, emit events to board room

**Events:**

#### `list:created`
**When:** After `POST /boards/:id/lists` succeeds
**Payload:**
```json
{
  "boardId": "board_123",
  "list": {
    "id": "list_456",
    "title": "To Do",
    "boardId": "board_123",
    "position": "a0",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

#### `list:updated`
**When:** After `PATCH /lists/:id` succeeds
**Payload:** Same as list:created, but with updated fields

#### `list:deleted`
**When:** After `DELETE /lists/:id` succeeds
**Payload:**
```json
{
  "boardId": "board_123",
  "listId": "list_456"
}
```

**Broadcasting function:**
```typescript
async broadcastListEvent(
  boardId: string,
  eventType: 'list:created' | 'list:updated' | 'list:deleted',
  list?: List
): Promise<void>
```

**Testing:**
- Test list:created event sent after POST
- Test list:updated event sent after PATCH
- Test list:deleted event sent after DELETE
- Test cards in deleted list are also deleted (no separate event needed)

---

### Feature 7: Membership Event Broadcasts

**What it does:**
- When board membership changes (user added, role changed, removed), broadcast to room
- Helps keep UI in sync with who has access

**Events:**

#### `member:added`
**When:** After member is invited to board
**Payload:**
```json
{
  "boardId": "board_123",
  "membership": {
    "userId": "user_456",
    "userName": "Charlie",
    "userEmail": "charlie@example.com",
    "role": "EDITOR"
  }
}
```

#### `member:role_changed`
**When:** Role is updated
**Payload:**
```json
{
  "boardId": "board_123",
  "userId": "user_456",
  "newRole": "VIEWER",
  "oldRole": "EDITOR"
}
```

#### `member:removed`
**When:** Member is removed from board
**Payload:**
```json
{
  "boardId": "board_123",
  "userId": "user_456"
}
```

**Testing:**
- Test member:added event sent when user is invited
- Test member:role_changed event sent when role updated
- Test member:removed event sent when member deleted
- Test only board members see the event

---

### Feature 8: Activity Log Integration

**What it does:**
- Record every action (card/list mutations, member changes) to the `Activity` table
- Provides audit trail and historical view
- Expose via REST API for querying

**Database model (already in schema):**
```prisma
model Activity {
  id          String
  boardId     String
  userId      String?
  cardId      String?
  type        ActivityType  // CARD_CREATED, CARD_MOVED, etc.
  payload     Json          // details about what changed
  createdAt   DateTime
}

enum ActivityType {
  CARD_CREATED
  CARD_UPDATED
  CARD_MOVED
  CARD_DELETED
  LIST_CREATED
  LIST_UPDATED
  LIST_DELETED
  MEMBER_ADDED
  MEMBER_REMOVED
  MEMBER_ROLE_CHANGED
}
```

**Where it lives:**
```
src/modules/activity/
├── activityService.ts  (create activity records)
├── activityRoutes.ts   (fetch activity logs)
└── activityTypes.ts    (type definitions)
```

**Functions:**

#### `logActivity(boardId, userId, type, payload, cardId?)`
- Insert record into `Activity` table
- Called after every mutation
- `userId` is null for system actions (if any)
- `cardId` is null for list-only actions

**Activity events (NOT Socket.IO, just examples):**

For CARD_CREATED:
```json
{
  "type": "CARD_CREATED",
  "payload": {
    "cardId": "card_456",
    "listId": "list_789",
    "title": "Fix login bug",
    "priority": "HIGH"
  }
}
```

For CARD_MOVED:
```json
{
  "type": "CARD_MOVED",
  "payload": {
    "cardId": "card_456",
    "fromListId": "list_789",
    "toListId": "list_999",
    "fromPosition": "a0",
    "toPosition": "a1"
  }
}
```

For MEMBER_ADDED:
```json
{
  "type": "MEMBER_ADDED",
  "payload": {
    "userId": "user_456",
    "role": "EDITOR"
  }
}
```

**Endpoint:**

#### `GET /boards/:id/activity`
**Returns:** Array of activities for the board, newest first, paginated
**Payload:**
```json
{
  "activities": [
    {
      "id": "activity_123",
      "boardId": "board_123",
      "user": {
        "id": "user_456",
        "name": "Alice",
        "email": "alice@example.com"
      },
      "type": "CARD_MOVED",
      "payload": { ... },
      "createdAt": "2024-01-15T10:05:00Z"
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 50
}
```

**Pagination:** Limit 50 per page, sortable by createdAt descending

**Permissions:** Any board member can view activity (role doesn't matter)

**Testing:**
- Test activity is logged for each mutation
- Test activity includes correct type and payload
- Test endpoint returns activities in correct order (newest first)
- Test pagination works
- Test viewer can see activity (no permission restriction)

---

### Feature 9: Error Handling & Recovery

**What it does:**
- Handle Socket.IO errors gracefully
- Log errors for debugging
- Provide meaningful error messages to client
- Recover from network interruptions

**Socket.IO error events:**

#### `connect_error`
- Emitted when connection fails
- Client should log and retry exponentially

#### `error`
- Emitted when server sends error to client
- Client should handle gracefully

#### `disconnect`
- Emitted when socket disconnects
- Client should cleanup, optionally reconnect

**Server-side error handling:**

In `socketServer.ts`:
```typescript
io.on('connection', (socket) => {
  // ...
  
  socket.on('error', (error) => {
    logger.error('Socket error', { socketId: socket.id, error });
  });
  
  socket.on('disconnect', () => {
    // Cleanup presence
  });
});
```

**Error events to client:**
```typescript
socket.emit('error', { message: 'Access denied', code: 'UNAUTHORIZED' });
```

**Testing:**
- Test disconnect triggers cleanup
- Test invalid room join returns error
- Test server restart doesn't break connections (graceful shutdown)
- Test network interruption (mock disconnect/reconnect)

---

### Feature 10: Conflict Resolution in Real-Time

**What it does:**
- When two users move same card concurrently, one gets 409 Conflict via REST
- That user receives the new version via HTTP response or Socket.IO event
- User retries move with new version and succeeds
- Both users converge to same final state

**Flow:**

**Scenario:** User A and User B both move card_123 from position a0 to a1

1. User A: `POST /cards/123/move` with version 5 → succeeds, updates version to 6
   - Server broadcasts `card:moved` with version 6 to room
   
2. User B: `POST /cards/123/move` with version 5 (stale) → 409 Conflict
   - Response includes: `{ error: "...", statusCode: 409, currentVersion: 6, card: {...} }`
   - Client receives response
   
3. User B's client:
   - Receives 409 error
   - Parses `currentVersion: 6`
   - Retries move with version 6
   
4. User B retry: `POST /cards/123/move` with version 6 → succeeds
   - Server broadcasts updated event

5. Both users see same card in final position with version 6

**OR (alternative with Socket.IO broadcast):**

1. User A moves, server broadcasts `card:moved` with new version
2. User B tries move with old version, gets 409
3. User B's client hears `card:moved` event from User A
4. Client updates card state with new version
5. User B retries move with new version from state

**Testing:**
- Test concurrent moves by two users
- Test one gets 409, other succeeds
- Test both users end in same state
- Test activity log shows both moves

---

## Integration Points

### 1. Card Service → Broadcaster
After `cardsService.moveCard()` succeeds:
```typescript
await cardsService.moveCard(...);
await socketBroadcaster.broadcastCardEvent(boardId, 'card:moved', updatedCard);
```

### 2. List Service → Broadcaster
After `listsService.createList()` succeeds:
```typescript
await listsService.createList(...);
await socketBroadcaster.broadcastListEvent(boardId, 'list:created', createdList);
```

### 3. Activity Service → Database
After any mutation:
```typescript
await activityService.logActivity(boardId, userId, 'CARD_MOVED', {...}, cardId);
```

### 4. Server Startup
In `server.ts`:
```typescript
const httpServer = createHttpServer(app);
const io = initializeSocketIO(httpServer);
setupSocketServer(io);

httpServer.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
```

---

## Module Structure

```
src/modules/realtime/
├── socketServer.ts           (main Socket.IO setup)
├── socketAuth.ts             (JWT verification)
├── socketRooms.ts            (board:join / board:leave)
├── socketPresence.ts         (presence tracking)
├── socketBroadcaster.ts      (emit events to rooms)
├── socketTypes.ts            (TypeScript interfaces)
└── index.ts                  (exports)

src/modules/activity/
├── activityService.ts        (log activities)
├── activityRoutes.ts         (GET /boards/:id/activity)
├── activityTypes.ts          (types)
└── index.ts                  (exports)

src/modules/cards/
├── cardsService.ts           (updated to call broadcaster)
└── ... (existing)

src/modules/lists/
├── listsService.ts           (updated to call broadcaster)
└── ... (existing)
```

---

## Testing Strategy

### Unit Tests
- `socketPresence.spec.ts`: Test presence add/remove functions
- `socketBroadcaster.spec.ts`: Test event emission (mock io.to)
- `activityService.spec.ts`: Test activity logging

### Integration Tests
- `realtime.integration.spec.ts`: Multi-client scenarios
  - Two clients join same board → both see presence:update
  - One client moves card → other sees card:moved
  - Concurrent moves → one gets 409, both converge
  - Client disconnects → auto-removed from presence

### Load Tests (Phase 2)
- Use `k6` or `autocannon` to test:
  - 50 concurrent WebSocket clients in same board
  - Measure broadcast latency (card:moved event)
  - Measure p95 latency for move operations

---

## Error Codes & Messages

| Code | Message | Cause |
|------|---------|-------|
| `UNAUTHORIZED` | "Not authenticated" | No/invalid JWT |
| `FORBIDDEN` | "Access denied" | User not board member |
| `INVALID_PAYLOAD` | "Missing boardId" | Malformed event |
| `SERVER_ERROR` | "Internal error" | Unexpected exception |

---

## MVP Scope (What's Included)

✅ Socket.IO server setup & CORS
✅ JWT authentication on connect
✅ Room-based isolation (board rooms)
✅ Presence tracking (who's online)
✅ Card event broadcasts (create, update, move, delete)
✅ List event broadcasts (create, update, delete)
✅ Member event broadcasts (added, role changed, removed)
✅ Activity logging to database
✅ Activity log endpoint (GET /boards/:id/activity)
✅ Conflict resolution (409 + retry)
✅ Error handling & logging

---

## Phase 2 (After MVP Works)

- Redis for presence (horizontal scaling across multiple server instances)
- Redis pub/sub for Socket.IO broadcasts (across instances)
- Redis connection pooling
- Graceful shutdown (drain Socket.IO connections)
- Health check endpoint for load balancers
- Socket.IO debugging/stats endpoint
- Deployment to Render or Railway with WebSocket support
- Load testing with k6

---

## Demo Flow (Definition of Done)

After implementing real-time, this should work:

1. **Setup:** Start backend server
2. **Open:** Two browsers to `http://localhost:3000`
3. **Login:** User A and User B with different accounts
4. **Create board:** User A creates a board and invites User B as editor
5. **View:** Both users open the board
   - Both see presence indicator showing 2 users
6. **Move card:** User A drags card from "To Do" to "In Progress"
   - User B **immediately sees the card move** (no refresh)
7. **Edit card:** User A renames the card "Fix login bug" → "Fix auth"
   - User B **immediately sees the title update**
8. **Concurrent move:** Both users simultaneously move the same card
   - One gets 409 Conflict
   - Client shows error with retry UI
   - User clicks retry
   - Move succeeds with new version
   - Both users see card in final position
9. **Activity:** User B opens activity log
   - Sees all moves, edits, renames in chronological order
   - Shows who did what and when
10. **Disconnect:** User A closes browser
    - User B's presence indicator updates
    - Shows only 1 user now

---

## Success Criteria

✅ Server accepts multiple WebSocket connections
✅ Authentication works (valid JWT → connect, invalid → reject)
✅ Presence updates work (join → update sent, leave → update sent)
✅ Card broadcasts work (move → event sent to all in room)
✅ List broadcasts work (create → event sent to all in room)
✅ Activity logging works (every action logged)
✅ Conflict handling works (409 returned, client can retry)
✅ Multiple rooms isolated (event in room A doesn't leak to B)
✅ Auto-cleanup on disconnect (presence removed, room cleaned)
✅ All 10 features above pass unit & integration tests
✅ Demo flow works end-to-end (no frontend needed, just manual testing)

---

## Implementation Order

1. **Socket.IO Server Setup** (socketServer.ts)
   - Initialize Socket.IO
   - Handle connection/disconnection
   
2. **Socket.IO Authentication** (socketAuth.ts)
   - Verify JWT on handshake
   - Reject unauthorized

3. **Room Management** (socketRooms.ts)
   - Implement board:join / board:leave
   - Verify board membership

4. **Presence Tracking** (socketPresence.ts)
   - Track users in rooms
   - Emit presence:update events

5. **Card Broadcaster** (socketBroadcaster.ts + cardsService.ts integration)
   - Emit card events after mutations
   - Hook into existing card endpoints

6. **List Broadcaster** (socketBroadcaster.ts + listsService.ts integration)
   - Emit list events after mutations
   - Hook into existing list endpoints

7. **Member Broadcaster** (socketBroadcaster.ts + boardsService.ts integration)
   - Emit member events after membership changes
   - Hook into member endpoints

8. **Activity Logging** (activityService.ts + endpoints)
   - Log every action to database
   - Create GET /boards/:id/activity endpoint

9. **Testing**
   - Unit tests for each module
   - Integration tests for multi-client scenarios
   - Manual testing with demo flow

10. **Documentation**
    - README with setup & deployment
    - Architecture diagram
    - Socket.IO event reference

---

## Key Design Principles

1. **Server as source of truth:** Clients don't directly update each other; server mediates all updates
2. **Deterministic ordering:** Events broadcast in order; clients converge to same state
3. **Version-based conflict detection:** Version field prevents silent overwrites
4. **Room-based isolation:** Rooms prevent cross-board leaks
5. **Graceful degradation:** If Socket.IO fails, REST API still works
6. **Audit trail:** Activity log provides accountability and history
7. **Simple presence model:** In-memory map, no need for complex consensus