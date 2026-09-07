

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { CookieOptions, Response } from 'express';
import { queryOne } from '../db/query';
import { env } from '../config/env';
import { AppError } from '../middleware/error';

const BCRYPT_ROUNDS = 10;
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;   
const MIN_PASSWORD_LENGTH = 8;


export const COOKIE_NAME = 'token';


export interface PublicUser {
  id: number;
  email: string;
  created_at: string;
}

interface UserRow extends PublicUser {
  password_hash: string;
}

const DUMMY_HASH = bcrypt.hashSync('no-such-user', BCRYPT_ROUNDS);

const normaliseEmail = (email: string): string => email.trim().toLowerCase();


const cookieOptions: CookieOptions = {
  httpOnly: true,                                   
  sameSite: 'lax',                                  
  secure: env.NODE_ENV === 'production',            
  path: '/',
};

export async function register(email: string, password: string): Promise<PublicUser> {
  const normalised = normaliseEmail(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalised))
    throw new AppError('A valid email address is required', 400);
  if (password.length < MIN_PASSWORD_LENGTH)
    throw new AppError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`, 400);

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  try {
    const user = await queryOne<PublicUser>(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $2)
       RETURNING id, email, created_at`,
      [normalised, passwordHash],
    );
    if (!user) throw new AppError('Registration failed', 500);
    return user;
  } catch (e) {
    if ((e as { code?: string }).code === '23505')
      throw new AppError('That email is already registered', 409);
    throw e;
  }
}

export async function login(
  email: string,
  password: string,
): Promise<{ user: PublicUser; token: string }> {
  const row = await queryOne<UserRow>(
    'SELECT id, email, created_at, password_hash FROM users WHERE email = $1',
    [normaliseEmail(email)],
  );

  const passwordMatches = await bcrypt.compare(password, row?.password_hash ?? DUMMY_HASH);

  if (!row || !passwordMatches) throw new AppError('Invalid email or password', 401);

  const { password_hash: _hash, ...user } = row;
  return { user, token: issueToken(user.id) };
}

export function issueToken(userId: number): string {
  return jwt.sign({ userId }, env.JWT_SECRET, { expiresIn: TOKEN_TTL_SECONDS });
}

export function setAuthCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: TOKEN_TTL_SECONDS * 1000 });
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, cookieOptions);
}

export async function findUserById(id: number): Promise<PublicUser | null> {
  return queryOne<PublicUser>('SELECT id, email, created_at FROM users WHERE id = $1', [id]);
}
