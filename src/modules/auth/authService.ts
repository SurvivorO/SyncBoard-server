import bcrypt from "bcrypt";
import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../../../env";
import type { JWTPayload } from "../../types/server";

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

function generateRefreshToken(
    userId: string
){

    return jwt.sign(
        { userId },
        env.JWT_REFRESH_TOKEN,
        refreshTokenOptions
    );
}

function verifyAcessToken(
    token: string
){

}

function verifyRefreshToken(
    token:string
){

}

function rotateRefreshToken(
    oldTokenHash: string,
    userId: string
){

}

export {
    hashPassword,
    comparePassword,
    generateAccessToken,
    generateRefreshToken
}