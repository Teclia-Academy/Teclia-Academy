import { INSUFFICIENT_ROLE } from '../constants/authErrors.js';

export const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json(INSUFFICIENT_ROLE);
  }

  next();
};
