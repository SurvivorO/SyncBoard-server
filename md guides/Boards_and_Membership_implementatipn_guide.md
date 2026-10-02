# Boards and Membership Implementation Guide

> This guide builds on your existing auth module. Follow step-by-step to implement boards, membership management, and role-based access control.

## Overview

This guide covers:

1. **Prisma schema updates** for boards and memberships
2. **Database migrations**
3. **Service layer** – business logic for boards and memberships
4. **Route handlers** – REST endpoints
5. **Validators** – request validation with Zod
6. **Middleware** – permission checks and role verification
7. **Error handling** – board-specific errors
8. **Testing** – comprehensive tests for all scenarios
9. **Integration** – wiring into your Express app

## Part 1: Prisma Schema Updates

Your schema should already have `User` and `RefreshToken`. Add these models for boards and memberships.

### Location: `server/src/prisma/schema.prisma`

```prisma
// Existing User model (you have this)
model User {
  id            String   @id @default(cuid())
  email         String   @unique
  passwordHash  String
  name          String
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  // Relations
  refreshTokens RefreshToken[]
  boards        Membership[]
  ownedBoards   Board[]
  activities    Activity[]

  @@index([email])
}

model RefreshToken {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash String
  expiresAt DateTime
  createdAt DateTime @default(now())

  @@index([userId])
}

// NEW: Board model
model Board {
  id        String   @id @default(cuid())
  title     String
  ownerId   String
  owner     User     @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // Relations
  memberships Membership[]
  lists       List[]
  activities  Activity[]

  @@index([ownerId])
}

// NEW: Membership model (joins User to Board with role)
model Membership {
  id        String   @id @default(cuid())
  userId    String
  boardId   String
  role      Role     @default(EDITOR)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // Relations
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  board     Board    @relation(fields: [boardId], references: [id], onDelete: Cascade)

  // Unique constraint: a user can only have one role per board
  @@unique([userId, boardId])
  @@index([boardId])
  @@index([userId])
}

// NEW: Role enum
enum Role {
  OWNER
  EDITOR
  VIEWER
}

// NEW: List model
model List {
  id        String   @id @default(cuid())
  boardId   String
  title     String
  position  String   // Fractional indexing string
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // Relations
  board     Board    @relation(fields: [boardId], references: [id], onDelete: Cascade)
  cards     Card[]

  @@index([boardId])
}

// NEW: Card model
model Card {
  id          String   @id @default(cuid())
  listId      String
  title       String
  description String?
  priority    Priority @default(MEDIUM)
  dueDate     DateTime?
  position    String   // Fractional indexing string
  version     Int      @default(1)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  // Relations
  list        List     @relation(fields: [listId], references: [id], onDelete: Cascade)

  @@index([listId])
}

// NEW: Priority enum for cards
enum Priority {
  LOW
  MEDIUM
  HIGH
  URGENT
}

// NEW: Activity model for audit log
model Activity {
  id        String   @id @default(cuid())
  boardId   String
  userId    String
  type      String   // e.g., "CARD_CREATED", "MEMBER_ADDED", "BOARD_RENAMED"
  payload   Json     // Flexible JSON for event details
  createdAt DateTime @default(now())

  // Relations
  board     Board    @relation(fields: [boardId], references: [id], onDelete: Cascade)
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([boardId])
  @@index([userId])
}
```

### Create a migration

```bash
cd server
npx prisma migrate dev --name add_boards_memberships_lists_cards
```

This creates a migration file in `migrations/` and updates your Prisma client.

---

## Part 2: Service Layer

The service layer holds business logic. Create two services: `boardService` and `membershipService`.

### Location: `server/src/modules/boards/boardService.ts`

```typescript
import { db } from '../../prisma/db.js';
import { Board, Membership, Role } from '@prisma/client';
import { NotFoundError, ForbiddenError, ConflictError } from '../errors/AppError.js';

export interface CreateBoardInput {
  title: string;
  userId: string;
}

export interface UpdateBoardInput {
  title?: string;
}

/**
 * Board service: handles all board CRUD and permission checks
 */
export const boardService = {
  /**
   * Create a new board. The creator becomes the owner.
   */
  async createBoard(input: CreateBoardInput): Promise<Board> {
    return await db.board.create({
      data: {
        title: input.title,
        ownerId: input.userId,
        memberships: {
          create: {
            userId: input.userId,
            role: Role.OWNER,
          },
        },
      },
    });
  },

  /**
   * Get a single board with all its relations
   */
  async getBoardById(boardId: string): Promise<Board> {
    const board = await db.board.findUnique({
      where: { id: boardId },
    });

    if (!board) {
      throw new NotFoundError('Board not found');
    }

    return board;
  },

  /**
   * Get all boards for a user (by membership)
   */
  async getBoardsByUserId(userId: string): Promise<Board[]> {
    const memberships = await db.membership.findMany({
      where: { userId },
      include: { board: true },
    });

    return memberships.map((m) => m.board);
  },

  /**
   * Get board with full details: membership list, lists, cards
   */
  async getBoardWithDetails(boardId: string) {
    const board = await db.board.findUnique({
      where: { id: boardId },
      include: {
        memberships: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
              },
            },
          },
        },
        lists: {
          orderBy: { position: 'asc' },
          include: {
            cards: {
              orderBy: { position: 'asc' },
            },
          },
        },
      },
    });

    if (!board) {
      throw new NotFoundError('Board not found');
    }

    return board;
  },

  /**
   * Update board title
   * Only the owner can rename a board
   */
  async updateBoard(
    boardId: string,
    userId: string,
    input: UpdateBoardInput
  ): Promise<Board> {
    // Check permission: user must be owner
    const membership = await db.membership.findUnique({
      where: { userId_boardId: { userId, boardId } },
    });

    if (!membership) {
      throw new NotFoundError('You are not a member of this board');
    }

    if (membership.role !== Role.OWNER) {
      throw new ForbiddenError('Only the owner can update the board');
    }

    return await db.board.update({
      where: { id: boardId },
      data: {
        title: input.title,
      },
    });
  },

  /**
   * Delete a board. Only the owner can do this.
   * Cascading deletes handle memberships, lists, cards, activities.
   */
  async deleteBoard(boardId: string, userId: string): Promise<void> {
    const board = await this.getBoardById(boardId);

    if (board.ownerId !== userId) {
      throw new ForbiddenError('Only the owner can delete the board');
    }

    await db.board.delete({
      where: { id: boardId },
    });
  },

  /**
   * Check if a user is a member of a board and get their role
   */
  async getUserBoardRole(
    boardId: string,
    userId: string
  ): Promise<Role | null> {
    const membership = await db.membership.findUnique({
      where: { userId_boardId: { userId, boardId } },
    });

    return membership?.role ?? null;
  },

  /**
   * Check if a user has a specific permission on a board
   * Useful for granular permission checks
   */
  canUserWrite(role: Role | null): boolean {
    return role === Role.OWNER || role === Role.EDITOR;
  },

  canUserRead(role: Role | null): boolean {
    return role !== null; // Any member can read
  },
};
```

### Location: `server/src/modules/boards/membershipService.ts`

```typescript
import { db } from '../../prisma/db.js';
import { Membership, Role } from '@prisma/client';
import {
  NotFoundError,
  ForbiddenError,
  ConflictError,
  BadRequestError,
} from '../errors/AppError.js';
import { boardService } from './boardService.js';

export interface InviteMemberInput {
  email: string;
  role: Role;
}

export interface UpdateMembershipInput {
  role: Role;
}

/**
 * Membership service: handles inviting, updating, and removing members
 */
export const membershipService = {
  /**
   * Invite a user to a board by email
   * Only the owner can invite members
   */
  async inviteMember(
    boardId: string,
    requestingUserId: string,
    input: InviteMemberInput
  ): Promise<Membership> {
    // Check: requester is owner
    const requestingRole = await boardService.getUserBoardRole(
      boardId,
      requestingUserId
    );

    if (requestingRole !== Role.OWNER) {
      throw new ForbiddenError('Only the owner can invite members');
    }

    // Find the user by email
    const targetUser = await db.user.findUnique({
      where: { email: input.email },
    });

    if (!targetUser) {
      throw new BadRequestError(
        'No user found with that email. They must register first.'
      );
    }

    if (targetUser.id === requestingUserId) {
      throw new BadRequestError('You are already a member of this board');
    }

    // Check if user is already a member
    const existingMembership = await db.membership.findUnique({
      where: {
        userId_boardId: { userId: targetUser.id, boardId },
      },
    });

    if (existingMembership) {
      throw new ConflictError('User is already a member of this board');
    }

    // Create the membership
    return await db.membership.create({
      data: {
        userId: targetUser.id,
        boardId,
        role: input.role,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });
  },

  /**
   * Get all members of a board
   */
  async getBoardMembers(boardId: string) {
    return await db.membership.findMany({
      where: { boardId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  },

  /**
   * Update a member's role
   * Only the owner can change roles
   */
  async updateMemberRole(
    boardId: string,
    targetUserId: string,
    requestingUserId: string,
    input: UpdateMembershipInput
  ): Promise<Membership> {
    // Check: requester is owner
    const requestingRole = await boardService.getUserBoardRole(
      boardId,
      requestingUserId
    );

    if (requestingRole !== Role.OWNER) {
      throw new ForbiddenError('Only the owner can update member roles');
    }

    // Prevent changing the owner's role
    const membership = await db.membership.findUnique({
      where: {
        userId_boardId: { userId: targetUserId, boardId },
      },
    });

    if (!membership) {
      throw new NotFoundError('Member not found');
    }

    if (membership.role === Role.OWNER) {
      throw new ForbiddenError('Cannot change the owner role');
    }

    // Update the role
    return await db.membership.update({
      where: {
        userId_boardId: { userId: targetUserId, boardId },
      },
      data: {
        role: input.role,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });
  },

  /**
   * Remove a member from a board
   * Only the owner can remove members
   * The owner cannot remove themselves (use deleteBoard instead)
   */
  async removeMember(
    boardId: string,
    targetUserId: string,
    requestingUserId: string
  ): Promise<void> {
    // Check: requester is owner
    const requestingRole = await boardService.getUserBoardRole(
      boardId,
      requestingUserId
    );

    if (requestingRole !== Role.OWNER) {
      throw new ForbiddenError('Only the owner can remove members');
    }

    const membership = await db.membership.findUnique({
      where: {
        userId_boardId: { userId: targetUserId, boardId },
      },
    });

    if (!membership) {
      throw new NotFoundError('Member not found');
    }

    if (membership.role === Role.OWNER) {
      throw new ForbiddenError('Cannot remove the owner');
    }

    await db.membership.delete({
      where: {
        userId_boardId: { userId: targetUserId, boardId },
      },
    });
  },

  /**
   * Check if a user can perform a specific action based on their role
   */
  hasPermission(role: Role | null, action: 'read' | 'write' | 'admin'): boolean {
    if (role === null) return false;

    if (action === 'read') {
      return role === Role.OWNER || role === Role.EDITOR || role === Role.VIEWER;
    }

    if (action === 'write') {
      return role === Role.OWNER || role === Role.EDITOR;
    }

    if (action === 'admin') {
      return role === Role.OWNER;
    }

    return false;
  },
};
```

---

## Part 3: Validators

Use Zod to validate request payloads. This ensures type safety and provides clear error messages.

### Location: `server/src/modules/boards/boardValidator.ts`

```typescript
import { z } from 'zod';

/**
 * Validator for creating a new board
 */
export const createBoardSchema = z.object({
  title: z
    .string()
    .min(1, 'Title is required')
    .max(255, 'Title must be 255 characters or less'),
});

export type CreateBoardRequest = z.infer<typeof createBoardSchema>;

/**
 * Validator for updating a board
 */
export const updateBoardSchema = z.object({
  title: z
    .string()
    .min(1, 'Title is required')
    .max(255, 'Title must be 255 characters or less')
    .optional(),
});

export type UpdateBoardRequest = z.infer<typeof updateBoardSchema>;

/**
 * Validator for inviting a member
 */
export const inviteMemberSchema = z.object({
  email: z
    .string()
    .email('Invalid email address'),
  role: z.enum(['OWNER', 'EDITOR', 'VIEWER']),
});

export type InviteMemberRequest = z.infer<typeof inviteMemberSchema>;

/**
 * Validator for updating a member's role
 */
export const updateMemberRoleSchema = z.object({
  role: z.enum(['EDITOR', 'VIEWER']), // Cannot change to OWNER via this endpoint
});

export type UpdateMemberRoleRequest = z.infer<typeof updateMemberRoleSchema>;
```

---

## Part 4: Permission Middleware

Create middleware to check if a user has the correct role for a board action.

### Location: `server/src/modules/boards/boardMiddleware.ts`

```typescript
import { Request, Response, NextFunction } from 'express';
import { ForbiddenError, NotFoundError } from '../errors/AppError.js';
import { boardService } from './boardService.js';
import { membershipService } from './membershipService.js';
import { Role } from '@prisma/client';

/**
 * Extend Express Request to include boardId and userRole
 */
declare global {
  namespace Express {
    interface Request {
      boardId?: string;
      userRole?: Role | null;
    }
  }
}

/**
 * Middleware to extract boardId from URL params and check if user is a member
 */
export async function requireBoardMember(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const boardId = req.params.id || req.params.boardId;
    const userId = req.user?.id;

    if (!boardId || !userId) {
      throw new NotFoundError('Board not found');
    }

    // Get the user's role on this board
    const role = await boardService.getUserBoardRole(boardId, userId);

    if (!role) {
      throw new ForbiddenError('You do not have access to this board');
    }

    // Attach to request for use in route handlers
    req.boardId = boardId;
    req.userRole = role;

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Middleware to require EDITOR or OWNER role (write permission)
 */
export async function requireBoardWrite(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const role = req.userRole;

    if (!membershipService.hasPermission(role, 'write')) {
      throw new ForbiddenError(
        'You do not have permission to edit this board. Only editors and owners can make changes.'
      );
    }

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Middleware to require OWNER role (admin permission)
 */
export async function requireBoardOwner(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const role = req.userRole;

    if (!membershipService.hasPermission(role, 'admin')) {
      throw new ForbiddenError(
        'You do not have permission to perform this action. Only the owner can.'
      );
    }

    next();
  } catch (error) {
    next(error);
  }
}
```

---

## Part 5: Route Handlers

Create the REST endpoints for boards and memberships.

### Location: `server/src/modules/boards/boardRoutes.ts`

```typescript
import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../auth/authMiddleware.js';
import {
  requireBoardMember,
  requireBoardWrite,
  requireBoardOwner,
} from './boardMiddleware.js';
import { boardService } from './boardService.js';
import { membershipService } from './membershipService.js';
import {
  createBoardSchema,
  updateBoardSchema,
  inviteMemberSchema,
  updateMemberRoleSchema,
} from './boardValidator.js';
import { BadRequestError } from '../errors/AppError.js';

const router = Router();

/**
 * POST /boards
 * Create a new board. User becomes the owner.
 */
router.post(
  '/',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validation = createBoardSchema.safeParse(req.body);
      if (!validation.success) {
        throw new BadRequestError(validation.error.errors[0].message);
      }

      const board = await boardService.createBoard({
        title: validation.data.title,
        userId: req.user!.id,
      });

      res.status(201).json({
        success: true,
        data: board,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /boards
 * Get all boards the user is a member of
 */
router.get(
  '/',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const boards = await boardService.getBoardsByUserId(req.user!.id);

      res.json({
        success: true,
        data: boards,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /boards/:id
 * Get a single board with full details
 * User must be a member
 */
router.get(
  '/:id',
  requireAuth,
  requireBoardMember,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const board = await boardService.getBoardWithDetails(req.boardId!);

      res.json({
        success: true,
        data: board,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /boards/:id
 * Update board title
 * Only owner can update
 */
router.patch(
  '/:id',
  requireAuth,
  requireBoardMember,
  requireBoardOwner,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validation = updateBoardSchema.safeParse(req.body);
      if (!validation.success) {
        throw new BadRequestError(validation.error.errors[0].message);
      }

      if (!validation.data.title) {
        throw new BadRequestError('At least one field must be provided');
      }

      const board = await boardService.updateBoard(
        req.boardId!,
        req.user!.id,
        validation.data
      );

      res.json({
        success: true,
        data: board,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /boards/:id
 * Delete a board
 * Only owner can delete
 */
router.delete(
  '/:id',
  requireAuth,
  requireBoardMember,
  requireBoardOwner,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await boardService.deleteBoard(req.boardId!, req.user!.id);

      res.json({
        success: true,
        message: 'Board deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============ MEMBERSHIP ROUTES ============

/**
 * GET /boards/:id/members
 * Get all members of a board
 * Any member can view the member list
 */
router.get(
  '/:id/members',
  requireAuth,
  requireBoardMember,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const members = await membershipService.getBoardMembers(req.boardId!);

      res.json({
        success: true,
        data: members,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /boards/:id/members
 * Invite a new member to a board
 * Only owner can invite
 */
router.post(
  '/:id/members',
  requireAuth,
  requireBoardMember,
  requireBoardOwner,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validation = inviteMemberSchema.safeParse(req.body);
      if (!validation.success) {
        throw new BadRequestError(validation.error.errors[0].message);
      }

      const membership = await membershipService.inviteMember(
        req.boardId!,
        req.user!.id,
        {
          email: validation.data.email,
          role: validation.data.role as any,
        }
      );

      res.status(201).json({
        success: true,
        data: membership,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /boards/:id/members/:userId
 * Update a member's role
 * Only owner can update roles
 */
router.patch(
  '/:id/members/:userId',
  requireAuth,
  requireBoardMember,
  requireBoardOwner,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validation = updateMemberRoleSchema.safeParse(req.body);
      if (!validation.success) {
        throw new BadRequestError(validation.error.errors[0].message);
      }

      const membership = await membershipService.updateMemberRole(
        req.boardId!,
        req.params.userId,
        req.user!.id,
        {
          role: validation.data.role as any,
        }
      );

      res.json({
        success: true,
        data: membership,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /boards/:id/members/:userId
 * Remove a member from a board
 * Only owner can remove members
 */
router.delete(
  '/:id/members/:userId',
  requireAuth,
  requireBoardMember,
  requireBoardOwner,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await membershipService.removeMember(
        req.boardId!,
        req.params.userId,
        req.user!.id
      );

      res.json({
        success: true,
        message: 'Member removed successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
```

---

## Part 6: Integration

Wire the board routes into your Express app.

### Location: `server/app.ts` (update existing file)

```typescript
import express from 'express';
import cors from 'cors';
import { env } from './env.js';
import authRoutes from './src/modules/auth/authRoutes.js';
import boardRoutes from './src/modules/boards/boardRoutes.js'; // ADD THIS
import { errorHandler } from './src/modules/errors/errorHandler.js';

const app = express();

// Middleware
app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(express.json());

// Routes
app.use('/auth', authRoutes);
app.use('/boards', boardRoutes); // ADD THIS

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Error handler (must be last)
app.use(errorHandler);

export default app;
```

---

## Part 7: Testing

Write comprehensive tests for boards and memberships.

### Location: `server/src/modules/boards/__tests__/boards.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../../app.js';
import { db } from '../../../prisma/db.js';
import { boardService } from '../boardService.js';
import { membershipService } from '../membershipService.js';

/**
 * Test setup: create test users and tokens
 */
let userA: any;
let userB: any;
let tokenA: string;
let tokenB: string;

beforeAll(async () => {
  // Create test users
  userA = await db.user.create({
    data: {
      email: 'userA@test.com',
      passwordHash: 'hashedpassword',
      name: 'User A',
    },
  });

  userB = await db.user.create({
    data: {
      email: 'userB@test.com',
      passwordHash: 'hashedpassword',
      name: 'User B',
    },
  });

  // Generate JWT tokens (from your auth service)
  // Note: This assumes you have a helper to generate tokens
  // tokenA = generateAccessToken(userA.id);
  // tokenB = generateAccessToken(userB.id);
});

afterAll(async () => {
  // Cleanup
  await db.user.deleteMany({});
});

beforeEach(async () => {
  // Clear boards before each test
  await db.board.deleteMany({});
});

describe('Boards API', () => {
  describe('POST /boards', () => {
    it('should create a new board', async () => {
      const response = await request(app)
        .post('/boards')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          title: 'My First Board',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.title).toBe('My First Board');
      expect(response.body.data.ownerId).toBe(userA.id);
    });

    it('should validate required title', async () => {
      const response = await request(app)
        .post('/boards')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .post('/boards')
        .send({
          title: 'Unauthorized Board',
        });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /boards', () => {
    it('should get all boards for a user', async () => {
      // Create a board as userA
      await boardService.createBoard({
        title: 'Board 1',
        userId: userA.id,
      });

      const response = await request(app)
        .get('/boards')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].title).toBe('Board 1');
    });
  });

  describe('GET /boards/:id', () => {
    it('should get a board with full details', async () => {
      const board = await boardService.createBoard({
        title: 'Test Board',
        userId: userA.id,
      });

      const response = await request(app)
        .get(`/boards/${board.id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(response.status).toBe(200);
      expect(response.body.data.id).toBe(board.id);
      expect(response.body.data.memberships).toBeDefined();
    });

    it('should forbid access if user is not a member', async () => {
      const board = await boardService.createBoard({
        title: 'Private Board',
        userId: userA.id,
      });

      const response = await request(app)
        .get(`/boards/${board.id}`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(response.status).toBe(403);
    });
  });

  describe('PATCH /boards/:id', () => {
    it('should allow owner to update title', async () => {
      const board = await boardService.createBoard({
        title: 'Original Title',
        userId: userA.id,
      });

      const response = await request(app)
        .patch(`/boards/${board.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          title: 'Updated Title',
        });

      expect(response.status).toBe(200);
      expect(response.body.data.title).toBe('Updated Title');
    });

    it('should forbid non-owner to update', async () => {
      const board = await boardService.createBoard({
        title: 'Board',
        userId: userA.id,
      });

      // Invite userB as editor
      await membershipService.inviteMember(board.id, userA.id, {
        email: userB.email,
        role: 'EDITOR' as any,
      });

      const response = await request(app)
        .patch(`/boards/${board.id}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          title: 'Hacker Update',
        });

      expect(response.status).toBe(403);
    });
  });

  describe('DELETE /boards/:id', () => {
    it('should allow owner to delete board', async () => {
      const board = await boardService.createBoard({
        title: 'Deletable Board',
        userId: userA.id,
      });

      const response = await request(app)
        .delete(`/boards/${board.id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(response.status).toBe(200);

      // Verify board is deleted
      const deleted = await db.board.findUnique({
        where: { id: board.id },
      });
      expect(deleted).toBeNull();
    });

    it('should forbid non-owner to delete', async () => {
      const board = await boardService.createBoard({
        title: 'Board',
        userId: userA.id,
      });

      await membershipService.inviteMember(board.id, userA.id, {
        email: userB.email,
        role: 'EDITOR' as any,
      });

      const response = await request(app)
        .delete(`/boards/${board.id}`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(response.status).toBe(403);
    });
  });
});

describe('Membership API', () => {
  let board: any;

  beforeEach(async () => {
    board = await boardService.createBoard({
      title: 'Test Board',
      userId: userA.id,
    });
  });

  describe('GET /boards/:id/members', () => {
    it('should return all board members', async () => {
      const response = await request(app)
        .get(`/boards/${board.id}/members`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1); // Only userA
      expect(response.body.data[0].user.email).toBe(userA.email);
    });
  });

  describe('POST /boards/:id/members', () => {
    it('should invite a member', async () => {
      const response = await request(app)
        .post(`/boards/${board.id}/members`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          email: userB.email,
          role: 'EDITOR',
        });

      expect(response.status).toBe(201);
      expect(response.body.data.user.email).toBe(userB.email);
      expect(response.body.data.role).toBe('EDITOR');
    });

    it('should forbid non-owner to invite', async () => {
      // Invite userB as editor
      await membershipService.inviteMember(board.id, userA.id, {
        email: userB.email,
        role: 'EDITOR' as any,
      });

      const response = await request(app)
        .post(`/boards/${board.id}/members`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          email: 'newemail@test.com',
          role: 'VIEWER',
        });

      expect(response.status).toBe(403);
    });

    it('should reject duplicate invites', async () => {
      await membershipService.inviteMember(board.id, userA.id, {
        email: userB.email,
        role: 'EDITOR' as any,
      });

      const response = await request(app)
        .post(`/boards/${board.id}/members`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          email: userB.email,
          role: 'VIEWER',
        });

      expect(response.status).toBe(409);
    });
  });

  describe('PATCH /boards/:id/members/:userId', () => {
    it('should allow owner to update member role', async () => {
      const membership = await membershipService.inviteMember(
        board.id,
        userA.id,
        {
          email: userB.email,
          role: 'EDITOR' as any,
        }
      );

      const response = await request(app)
        .patch(`/boards/${board.id}/members/${userB.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          role: 'VIEWER',
        });

      expect(response.status).toBe(200);
      expect(response.body.data.role).toBe('VIEWER');
    });
  });

  describe('DELETE /boards/:id/members/:userId', () => {
    it('should allow owner to remove member', async () => {
      await membershipService.inviteMember(board.id, userA.id, {
        email: userB.email,
        role: 'EDITOR' as any,
      });

      const response = await request(app)
        .delete(`/boards/${board.id}/members/${userB.id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(response.status).toBe(200);

      // Verify membership is deleted
      const members = await membershipService.getBoardMembers(board.id);
      expect(members).toHaveLength(1); // Only userA
    });
  });
});
```

---

## Part 8: Key Design Decisions

### Why fractional indexing?

When you move a card, instead of updating the position of all cards in a list, fractional indexing lets you assign a new position value that falls between two existing positions. This means one database update instead of many.

Example:
```
Card A: position = "0"
Card B: position = "1"
Card C: position = "2"

Move Card C between A and B:
Card A: position = "0"
Card C: position = "0.5"       (new)
Card B: position = "1"
Card D: position = "2"
```

You'll implement this in the next phase (lists/cards module).

### Why version numbers on cards?

When two users edit the same card simultaneously, you need to detect the conflict. The `version` field stores the revision number:

1. User A fetches card (version = 1)
2. User B fetches card (version = 1)
3. User A updates card, version increments to 2
4. User B tries to update with version = 1 → **409 Conflict** (stale)
5. User B refetches and retries with version = 2 → Success

### Why cascading deletes?

When you delete a board, all its lists, cards, memberships, and activities should go too. Prisma's `onDelete: Cascade` handles this automatically. The database enforces referential integrity.

### Why check role in middleware?

Attaching `req.userRole` in middleware means you don't have to fetch it repeatedly in every route handler. It's a performance optimization and keeps the code DRY.

---

## Part 9: Checklist

- [ ] Updated Prisma schema with Board, Membership, List, Card, Activity models
- [ ] Ran migration: `npx prisma migrate dev --name add_boards_memberships_lists_cards`
- [ ] Created `boardService.ts` with CRUD logic
- [ ] Created `membershipService.ts` with invite/update/remove logic
- [ ] Created `boardValidator.ts` with Zod schemas
- [ ] Created `boardMiddleware.ts` with permission checks
- [ ] Created `boardRoutes.ts` with REST endpoints
- [ ] Updated `app.ts` to register board routes
- [ ] Created test file and verified all tests pass
- [ ] Tested manually: create board, invite member, check permissions

---

## Part 10: What's Next?

Once boards and memberships work end-to-end:

1. **Lists and Cards** – CRUD with fractional indexing
2. **Socket.IO** – real-time sync
3. **Activity Log** – record who did what
4. **Conflict Handling** – version-based optimistic updates
5. **Frontend** – login, board view, drag-and-drop

This foundation is solid. Each new feature builds on these patterns.