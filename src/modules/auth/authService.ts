import bcrypt from "bcrypt";
import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../../../env";
import type { JWTPayload } from "../../types/server";
import { db } from "../../prisma/db";

async function hashPassword(
    password: string,
    saltRounds = 18
): Promise<string> {
    
    return bcrypt.hash(password, saltRounds);
}

function comparePassword(
    password: string, 
    hash: string
): Promise<boolean> {
    return bcrypt.compare(password, hash);
}

const accessTokenOptions: SignOptions = {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as SignOptions["expiresIn"],
}

const refreshTokenOptions: SignOptions = {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as SignOptions["expiresIn"],
}


type RefreshTokenData = {
    token: string;
    tokenHash: string;
    expiresAt: Date;
};

async function buildRefreshToken(
    userId: string
): Promise<RefreshTokenData> {
    const token = jwt.sign(
        { userId },
        env.JWT_REFRESH_TOKEN,
        refreshTokenOptions
    );
    const decodedToken = jwt.decode(token);

    if(
        decodedToken === null ||
        typeof decodedToken === 'string' ||
        typeof decodedToken.exp !== 'number'
    ) {
        throw new Error('Invalid refresh token expiration');
    }

    return {
        token,
        tokenHash: await hashPassword(token),
        expiresAt: new Date(decodedToken.exp * 1000)
    };
}

function generateAccessToken(
    userId: string, 
    email: string
): string{

    return jwt.sign(
        { userId, email},
        env.JWT_ACCESS_SECRET,
        accessTokenOptions
    );
}

async function generateRefreshToken(
    userId: string
): Promise<string> {
    const refreshToken = await buildRefreshToken(userId);

    await db.orm.public.RefreshToken.create({
        userId,
        tokenHash: refreshToken.tokenHash,
        expiresAt: refreshToken.expiresAt
    });

    return refreshToken.token;
}

function verifyAccessToken(
    token: string
) : JWTPayload {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as JWTPayload;

    if(
        typeof payload === 'string' ||
        typeof payload.userId !== 'string' ||
        typeof payload.email !== 'string'
    ){
        throw new Error('Invalid access token payload');
    }

    return {
        userId: payload.userId,
        email: payload.email
    }
}

function isRefreshPayload(
    payload: string | jwt.JwtPayload
) : payload is jwt.JwtPayload & { userId: string } {

    return (
        typeof payload !== 'string' &&
        typeof payload.userId === 'string'
    );
}

async function verifyRefreshToken(
    token:string
) : Promise<{ userId: string, tokenId: string }> {

    const payload = jwt.verify(token, env.JWT_REFRESH_TOKEN) as jwt.JwtPayload;

    if(!isRefreshPayload(payload)) {
        throw new Error('Invalid refresh token payload');
    }

    const storedTokens = await db.orm.public.RefreshToken
    .select("id","expiresAt","tokenHash")
    .where({
        userId: payload.userId
    })
    .all();

    if(storedTokens.length === 0) {
        throw new Error('Refresh token not found or Revoked');
    }

    const now = new Date();

    for(const storedToken of storedTokens) {
        if(storedToken.expiresAt < now) {
            continue;
        }

        const matches = await bcrypt.compare(token, storedToken.tokenHash);

        if(matches) {
            return {
                userId: payload.userId,
                tokenId: storedToken.id
            };
        }
    }

    throw new Error('Invalid or expired refresh token');

}

async function rotateRefreshToken(
    oldTokenHash: string,
    userId: string
): Promise<string> {
    const refreshToken = await buildRefreshToken(userId);

    await db.transaction(async (tx) => {
        await tx.orm.public.RefreshToken
        .where({
            userId,
            tokenHash: oldTokenHash
        })
        .delete();

        await tx.orm.public.RefreshToken.create({
            userId,
            tokenHash: refreshToken.tokenHash,
            expiresAt: refreshToken.expiresAt
        });
    });

    return refreshToken.token;
}

export {
    hashPassword,
    comparePassword,
    generateAccessToken,
    generateRefreshToken,
    verifyAccessToken,
    verifyRefreshToken,
    rotateRefreshToken
}