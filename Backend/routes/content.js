import express from 'express';
import multer from 'multer';
import { getContent, getContentById, uploadContent, deleteContent, getFreeContent } from '../controllers/contentController.js';
import { verifyToken } from '../middleware/verifyToken.js';
import { adminOnly } from '../middleware/adminOnly.js';

const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();

router.get('/', getContent);
router.get('/free', verifyToken, getFreeContent);
router.get('/:id', getContentById);

// Admin-only upload endpoint (supports file upload via 'file')
router.post('/upload', verifyToken, adminOnly, upload.single('file'), uploadContent);

// Admin-only delete
router.delete('/:id', verifyToken, adminOnly, deleteContent);

export default router;
