import multer from 'multer';
import express from 'express';
import {
  signup,
  login,
  logout,
  getMe,
  updateProfile,
  changePassword,
  forgotPassword,
  resetPassword,
  verifyRecoveryEmail,
  updateStudentPlan,
  deleteStudent,
  listStudents,
} from '../controllers/authController.js';
import { verifyToken } from '../middleware/verifyToken.js';
import { adminOnly } from '../middleware/adminOnly.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes'));
    }
  },
});

router.post('/signup', signup);
router.post('/login', login);
router.post('/logout', logout);
router.get('/me', verifyToken, getMe);
router.patch('/profile', verifyToken, upload.single('avatar'), updateProfile);
router.post('/change-password', verifyToken, changePassword);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/verify-recovery-email', verifyRecoveryEmail);
router.get('/students', verifyToken, adminOnly, listStudents);
router.patch('/students/:id/plan', verifyToken, adminOnly, updateStudentPlan);
router.delete('/students/:id', verifyToken, adminOnly, deleteStudent);

export default router;
