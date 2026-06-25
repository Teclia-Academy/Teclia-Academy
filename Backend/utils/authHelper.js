import jwt from 'jsonwebtoken';

export const validateJwtPayload = (decoded) => {
  if (!decoded || typeof decoded !== 'object') {
    return false;
  }

  const userId = decoded.userId ?? decoded.id;
  if (!userId || (typeof userId !== 'string' && typeof userId !== 'number')) {
    return false;
  }

  if (!decoded.role || typeof decoded.role !== 'string') {
    return false;
  }

  if (!decoded.iat || !decoded.exp) {
    return false;
  }

  return true;
};

export const verifyJwtToken = (token, secret) => {
  return jwt.verify(token, secret, { algorithms: ['HS256'] });
};

export const parseOptionalToken = (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== 'string') return null;

  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) return null;

  try {
    const decoded = verifyJwtToken(token, process.env.JWT_SECRET);
    return validateJwtPayload(decoded) ? decoded : null;
  } catch {
    return null;
  }
};
