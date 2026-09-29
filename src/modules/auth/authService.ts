import bcrypt from "bcrypt";

export async function hashPassword(
    password: string,
    saltRounds = 18
): Promise<string> {
    
    return bcrypt.hash(password, saltRounds);
}

function comparePassword(
    password: string, 
    hash: string
){

}

function generateAccessToken(
    userId: string, 
    email: string
){

}

function generateRefreshToken(
    userId: string
){

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

