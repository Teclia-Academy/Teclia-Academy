import jwt from 'jsonwebtoken';
import {
  TOKEN_EXPIRED,
  TOKEN_INVALID,
  TOKEN_MISSING,
  UNAUTHORIZED,
} from '../constants/authErrors.js';

const sendAuthError = (res, status, authError) => res.status(status).json(authError);

export const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || typeof authHeader !== 'string') {
    return sendAuthError(res, 401, TOKEN_MISSING);
  }

  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return sendAuthError(res, 401, TOKEN_MISSING);
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
    });

    if (!decoded || typeof decoded !== 'object') {
      return sendAuthError(res, 401, TOKEN_INVALID);
    }

    const userId = decoded.userId ?? decoded.id;
    if (!userId || (typeof userId !== 'string' && typeof userId !== 'number')) {
      return sendAuthError(res, 401, TOKEN_INVALID);
    }

    const role = decoded.role;
    if (!role || typeof role !== 'string') {
      return sendAuthError(res, 401, TOKEN_INVALID);
    }

    if (!decoded.iat || !decoded.exp) {
      return sendAuthError(res, 401, TOKEN_INVALID);
    }

    req.user = {
      ...decoded,
      userId,
      id: userId,
      role,
      iat: decoded.iat,
      exp: decoded.exp,
    };

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return sendAuthError(res, 401, TOKEN_EXPIRED);
    }

    return sendAuthError(res, 401, TOKEN_INVALID);
  }
};
