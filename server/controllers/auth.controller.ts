

import * as authService from '../services/auth.service';
import { asyncHandler } from '../middleware/async';
import { AppError } from '../middleware/error';

interface Credentials {
  email: string;
  password: string;
}


export const register = asyncHandler(async (req, res) => {
  const { email, password } = req.body as Credentials;
  const user = await authService.register(email, password);
  authService.setAuthCookie(res, authService.issueToken(user.id));
  res.status(201).json({ user });
});


export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body as Credentials;
  const { user, token } = await authService.login(email, password);
  authService.setAuthCookie(res, token);
  res.json({ user });
});


export const logout = asyncHandler(async (_req, res) => {
  authService.clearAuthCookie(res);
  res.status(204).end();
});


export const me = asyncHandler(async (req, res) => {
  const user = req.userId ? await authService.findUserById(req.userId) : null;
  if (!user) throw new AppError('Session no longer valid', 401);
  res.json({ user });
});
