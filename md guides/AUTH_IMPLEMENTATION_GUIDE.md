# Authentication Implementation Guide - SyncBoard

## Overview
Build a JWT-based auth system with access tokens (short-lived) and refresh tokens (long-lived, rotated).

---

## Step 1: Core Dependencies

### Install these packages:
```bash
npm install express bcrypt jsonwebtoken cors zod
npm install -D @types/express @types/bcrypt @types/jsonwebtoken @types/node tsx typescript
```

**What each does:**
- `bcrypt`: Hash passwords securely (never store plaintext)
- `jsonwebtoken`: Create and verify JWT tokens
- `zod`: Runtime validation of request payloads
- `cors`: Handle cross-origin requests for frontend
- `tsx`: Run TypeScript directly without compiling first

---

## Step 2: Directory Structure

Create this folder structure:
```
src/
├── index.ts                 # Express app entry point
├── env.ts                   # Environment variables (type-safe)
├── db.ts                    # Prisma client instance
├── errors/
│   └── AppError.ts          # Custom error class for consistent error handling
├── middleware/
│   ├── auth.ts              # JWT verification middleware
│   └── errorHandler.ts      # Global error handler
├── routes/
│   └── auth.ts              # Auth endpoints (register, login, logout, refresh)
├── services/
│   └── authService.ts       # Business logic for auth (hash, token generation, etc.)
├── schemas/
│   └── auth.ts              # Zod schemas for request validation
└── types/
    └── index.ts             # TypeScript types for JWT payload, etc.
```

---

## Step 3: Environment Variables

### Create `.env` file:
```env
# Database
DATABASE_URL="postgresql://syncboard:dev@localhost:5432/syncboard?schema=public"

# Server
NODE_ENV="development"
PORT=3000
CORS_ORIGIN="http://localhost:5173"

# JWT Secrets (use strong random strings in production!)
JWT_ACCESS_SECRET="your-access-secret-key-min-32-chars"
JWT_REFRESH_SECRET="your-refresh-secret-key-min-32-chars"

# Token expiration
JWT_ACCESS_EXPIRES_IN="15m"
JWT_REFRESH_EXPIRES_IN="7d"
```

**For development, you can use:**
```bash
# Generate random secrets
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Step 4: Core Setup Files

### 4.1 `src/types/index.ts` - Define JWT payload type

```typescript
export type JWTPayload = {
  userId: string;
  email: string;
};

export type AuthenticatedRequest = Express.Request & {
  user: JWTPayload;
};
```

**Why:** Type-safe access to `req.user` in protected routes.

---

### 4.2 `src/errors/AppError.ts` - Custom error class

```typescript
export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// Common error constructors for quick use
export const BadRequestError = (msg: string) => new AppError(400, msg);
export const UnauthorizedError = (msg: string) => new AppError(401, msg);
export const ForbiddenError = (msg: string) => new AppError(403, msg);
export const NotFoundError = (msg: string) => new AppError(404, msg);
export const ConflictError = (msg: string) => new AppError(409, msg);
```

**Why:** Consistent error responses. Express error middleware catches these and sends them.

---

### 4.3 `src/env.ts` - Type-safe environment variables

```typescript
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
});

export const env = envSchema.parse(process.env);
```

**Why:** Fails at startup if env vars are missing, not at runtime. Provides autocomplete.

---

### 4.4 `src/db.ts` - Prisma client singleton

```typescript
import { PrismaClient } from '@prisma/client';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query'] : [],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
```

**Why:** 
- Singleton pattern prevents creating multiple Prisma instances (connection pooling)
- Logs queries in development for debugging
- Global reference prevents re-instantiation in Hot Module Replacement

---

## Step 5: Auth Service

### `src/services/authService.ts` - Core business logic

**What it needs to do:**

1. **hashPassword(password: string): Promise<string>**
   - Use bcrypt to hash the password
   - Return the hash

2. **comparePassword(password: string, hash: string): Promise<boolean>**
   - Use bcrypt to compare plaintext with hash
   - Return true/false

3. **generateAccessToken(userId: string, email: string): string**
   - Create JWT with user data and short expiration (15 min)
   - Return the token string

4. **generateRefreshToken(userId: string): Promise<string>**
   - Create JWT with userId only and longer expiration (7 days)
   - Hash the token before storing in DB (like passwords)
   - Store the hash in `RefreshToken` table with expiration date
   - Return the actual token to send to client

5. **verifyAccessToken(token: string): JWTPayload**
   - Verify and decode the access token
   - Return the payload
   - Throw error if expired or invalid

6. **verifyRefreshToken(token: string): Promise<JWTPayload>**
   - Hash the incoming token
   - Look up in DB by `tokenHash`
   - Check if expired
   - Return the payload if valid
   - Throw error if invalid or expired

7. **rotateRefreshToken(oldTokenHash: string, userId: string): Promise<string>**
   - Delete the old token hash from DB
   - Generate a new refresh token
   - Return the new token

**Key insight:** Refresh tokens are stored as hashes in DB. If DB is breached, tokens aren't immediately usable. Compare like passwords.

---

## Step 6: Validation Schemas

### `src/schemas/auth.ts` - Zod validators

**What you need:**

1. **RegisterRequest** schema
   - email: string, email format
   - password: string, min 8 chars
   - name: string, optional

2. **LoginRequest** schema
   - email: string, email format
   - password: string

3. **RefreshRequest** schema
   - refreshToken: string

**Why:** Validates request body before it hits the service. Gives clear error messages.

---

## Step 7: Middleware

### 7.1 `src/middleware/auth.ts` - Protect routes

**Function: authMiddleware(req, res, next)**
- Extract token from `Authorization: Bearer <token>` header
- Call `authService.verifyAccessToken(token)`
- If valid, attach user payload to `req.user`
- If invalid, call `next(UnauthorizedError("Invalid token"))`

**Why:** Only authenticated users can access protected routes. Centralized token verification.

---

### 7.2 `src/middleware/errorHandler.ts` - Catch errors

**Function: errorHandler(err, req, res, next)**
- If `AppError`, send `{ error: err.message }` with `err.statusCode`
- If Zod error, send 400 with validation details
- If JWT error, send 401
- Else send 500 with generic message

**Why:** Every error gets a consistent response format. No unhandled exceptions leak to client.

---

## Step 8: Auth Routes

### `src/routes/auth.ts` - The endpoints

**POST /auth/register**
- Validate with RegisterRequest schema
- Check if email already exists
- Hash password with bcrypt
- Create user in DB
- Generate access token
- Generate and store refresh token
- Response: `{ accessToken, refreshToken, user: { id, email, name } }`

**POST /auth/login**
- Validate with LoginRequest schema
- Find user by email
- Compare password with stored hash
- If mismatch, throw UnauthorizedError
- Generate new access token
- Generate and store new refresh token (invalidate old ones)
- Response: same as register

**POST /auth/refresh**
- Validate with RefreshRequest schema
- Call `authService.verifyRefreshToken(token)`
- If valid, generate new access token
- Rotate the refresh token (delete old, create new)
- Response: `{ accessToken, refreshToken }`

**POST /auth/logout**
- Require auth middleware (must be authenticated)
- Delete all refresh tokens for this user from DB
- Response: `{ message: "Logged out" }`

---

## Step 9: Express App Setup

### `src/index.ts` - Glue it all together

```typescript
import express from 'express';
import cors from 'cors';
import { env } from './env';
import { prisma } from './db';
import authRoutes from './routes/auth';
import errorHandler from './middleware/errorHandler';

const app = express();

// Middleware
app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(express.json());

// Routes
app.use('/auth', authRoutes);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Error handler (must be last)
app.use(errorHandler);

// Start server
const server = app.listen(env.PORT, () => {
  console.log(`🚀 Server running on http://localhost:${env.PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
});
```

---

## Step 10: Testing the Auth Flow

### Test flow manually:

**1. Register a user:**
```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.com",
    "password": "password123",
    "name": "Alice"
  }'
```

Expected response:
```json
{
  "accessToken": "eyJhbGc...",
  "refreshToken": "eyJhbGc...",
  "user": {
    "id": "user_123",
    "email": "alice@example.com",
    "name": "Alice"
  }
}
```

**2. Login:**
```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.com",
    "password": "password123"
  }'
```

**3. Use access token to call protected endpoint:**
```bash
curl -X GET http://localhost:3000/boards \
  -H "Authorization: Bearer <accessToken>"
```

**4. Refresh token:**
```bash
curl -X POST http://localhost:3000/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "<refreshToken>"
  }'
```

**5. Logout:**
```bash
curl -X POST http://localhost:3000/auth/logout \
  -H "Authorization: Bearer <accessToken>"
```

---

## Step 11: Writing Tests

### Test structure with Vitest + Supertest:

**What to test:**
1. Register: valid input, duplicate email, invalid email, weak password
2. Login: correct password, wrong password, user not found
3. Refresh: valid token, expired token, invalid token, token revoked
4. Logout: deletes all refresh tokens
5. Protected route: valid token passes, invalid token fails

**Pattern:**
```typescript
describe('Auth', () => {
  it('should register a new user', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'test@example.com', password: 'password123', name: 'Test' });
    
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
  });

  it('should reject duplicate email', async () => {
    // Register first user
    // Try to register with same email
    // Expect 409 Conflict
  });

  // ... more tests
});
```

---

## Key Decisions to Understand

### Why hash refresh tokens?
- Access tokens are short-lived (15 min), so less risk if exposed
- Refresh tokens are long-lived (7 days), so they need stronger protection
- Store the hash in DB; send the actual token to client
- If DB is breached, tokens can't be used without the plaintext

### Why rotate refresh tokens?
- On every refresh, the old token is invalidated
- If a token is stolen and used, the legitimate user won't be able to use it again
- Limits the window of vulnerability

### Why separate access and refresh tokens?
- Access token is sent with every request → smaller is better, used frequently
- Refresh token is used only to get new access tokens → longer-lived, used rarely
- Reduces damage if access token is stolen (only 15 min of access)
- Allows logout by invalidating refresh token

### Why version numbers on cards (not auth-related, but important)?
- Two users can't overwrite each other's changes
- Optimistic concurrency: send version with update
- Server rejects if version is stale
- Client refetches and retries

---

## Checklist

- [ ] Install dependencies
- [ ] Create directory structure
- [ ] Set up `.env` file
- [ ] Implement `AppError` and custom error constructors
- [ ] Implement `env.ts` for type-safe config
- [ ] Implement `db.ts` Prisma singleton
- [ ] Implement auth service (hash, compare, token generation/verification)
- [ ] Implement validation schemas with Zod
- [ ] Implement auth middleware
- [ ] Implement error handler middleware
- [ ] Implement auth routes (register, login, logout, refresh)
- [ ] Implement Express app setup
- [ ] Test endpoints with curl
- [ ] Write unit tests with Vitest
- [ ] Test concurrent register attempts (should fail on duplicate email)
- [ ] Test token expiration
- [ ] Test logout revokes all tokens

---

## Next After Auth

Once auth is solid:
1. **Boards & Membership** - Create/delete boards, invite users, check roles
2. **Lists & Cards** - CRUD with fractional indexing
3. **Real-time with Socket.IO** - Live updates as users collaborate
4. **Conflict resolution** - Version numbers prevent lost updates
5. **Activity log** - Record every action

---

## Useful Commands

```bash
# Start dev server (watches changes)
npm run dev

# Run tests
npm test

# View database
npx prisma studio

# Create migration after schema change
npx prisma migrate dev --name <description>

# Check database connection
psql -U syncboard -d syncboard -h localhost
```

---

## Common Mistakes to Avoid

1. **Storing plaintext passwords** - Always use bcrypt
2. **Logging tokens** - Never log tokens to console in production
3. **Long access token expiration** - Keep it short (15 min) so stolen tokens don't last long
4. **Trusting client-provided IDs** - Always check permissions in DB, never trust `req.body.userId`
5. **Not validating input** - Use Zod for all request payloads
6. **Missing error handling** - Wrap service calls in try-catch, let error middleware handle it

---

Start building! Use this guide as your roadmap. Ask Claude in chat for help on specific pieces.
