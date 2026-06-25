import { getDb, saveDatabase } from '../db/init.js';
import { canAccessPlan, PLAN_TIERS } from '../utils/plans.js';
import { parseOptionalToken } from '../utils/authHelper.js';
import storage from '../storage/index.js';

const getUserAccess = async (userId) => {
  const db = getDb();
  const result = await db.exec('SELECT role, plan_tier FROM users WHERE id = ?', [userId]);
  if (result.length === 0 || result[0].values.length === 0) return null;
  return { role: result[0].values[0][0], plan_tier: result[0].values[0][1] };
};

const mapContentRows = (result) => {
  if (result.length === 0) return [];
  const columns = result[0].columns;
  return result[0].values.map((row) => {
    const obj = {};
    columns.forEach((col, idx) => {
      obj[col] = row[idx];
    });
    obj.plan_tier = obj.plan_tier || (obj.is_free ? 'free' : 'basico');
    return obj;
  });
};

const resolveContentRows = async (content) => {
  return Promise.all(
    content.map(async (item) => {
      if (item.url && !item.url.startsWith('http')) {
        const normalized = item.url.startsWith('/uploads/')
          ? item.url.replace(/^\/uploads\//, '')
          : item.url;
        item.url = storage.resolveUrl(normalized);
      }
      return item;
    })
  );
};

const filterContentForUser = (content, access) => {
  if (!access) {
    return content.filter((item) => (item.plan_tier || 'free') === 'free');
  }
  if (access.role === 'admin') return content;
  return content.filter((item) => canAccessPlan(access.plan_tier, item.plan_tier || 'free'));
};

export const getContent = async (req, res) => {
  try {
    const db = getDb();
    const result = await db.exec(`
      SELECT c.*, u.name as uploaded_by_name FROM content c
      LEFT JOIN users u ON c.uploaded_by = u.id
      ORDER BY c.created_at DESC
    `);

    const allContent = mapContentRows(result);
    const tokenUser = parseOptionalToken(req);
    const access = tokenUser ? await getUserAccess(tokenUser.id ?? tokenUser.userId) : null;
    let content = filterContentForUser(allContent, access);
    content = await resolveContentRows(content);

    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getContentById = async (req, res) => {
  try {
    const { id } = req.params;
    const db = getDb();

    const result = await db.exec(
      `SELECT c.*, u.name as uploaded_by_name FROM content c
       LEFT JOIN users u ON c.uploaded_by = u.id
       WHERE c.id = ?`,
      [id]
    );

    if (result.length === 0 || result[0].values.length === 0) {
      return res.status(404).json({ error: 'Content not found' });
    }

    let content = mapContentRows(result)[0];
    const tokenUser = parseOptionalToken(req);
    const access = tokenUser ? await getUserAccess(tokenUser.id ?? tokenUser.userId) : null;

    if (!filterContentForUser([content], access).length) {
      return res.status(403).json({ error: 'No tienes acceso a este contenido con tu plan actual' });
    }

    content = await resolveContentRows([content]);

    res.json({ content: content[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const uploadContent = async (req, res) => {
  try {
    const { title, description, type, url, is_free, plan_tier } = req.body;

    let finalUrl = url;

    if (!title || !type || (!finalUrl && !req.file)) {
      return res.status(400).json({ error: 'Title, type and url/file are required' });
    }

    let storagePath = null;
    if (req.file) {
      storagePath = await storage.upload(req.file, 'content');
      finalUrl = storagePath;
    }

    const selectedPlan = plan_tier || (is_free === '1' || is_free === 'true' || is_free === 'on' ? 'free' : 'basico');
    if (!PLAN_TIERS.includes(selectedPlan)) {
      return res.status(400).json({ error: 'Plan de contenido no válido' });
    }

    const db = getDb();
    const uploaderId = req.user?.id;

    if (!uploaderId) {
      return res.status(401).json({ error: 'Uploader not identified' });
    }

    const freeFlag = selectedPlan === 'free' ? 1 : 0;

    const insertResult = await db.exec(
      'INSERT INTO content (title, description, type, url, is_free, plan_tier, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
      [title, description || '', type, finalUrl, freeFlag, selectedPlan, uploaderId]
    );

    saveDatabase();

    const newId = insertResult[0].values[0][0];

    const content = {
      id: newId,
      title,
      description: description || '',
      type,
      url: finalUrl,
      is_free: freeFlag,
      plan_tier: selectedPlan,
      uploaded_by: uploaderId,
      created_at: new Date().toISOString(),
    };

    if (storagePath) {
      content.url = storage.resolveUrl(storagePath);
    }

    res.json({ message: 'Content uploaded', content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const deleteContent = async (req, res) => {
  try {
    const { id } = req.params;
    const db = getDb();

    const found = await db.exec('SELECT url FROM content WHERE id = ?', [id]);
    if (found.length === 0 || found[0].values.length === 0) {
      return res.status(404).json({ error: 'Content not found' });
    }

    const fileUrl = found[0].values[0][0];
    const storagePath = fileUrl && !fileUrl.startsWith('http')
      ? (fileUrl.startsWith('/uploads/') ? fileUrl.replace(/^\/uploads\//, '') : fileUrl)
      : null;
    if (storagePath) {
      try {
        await storage.delete(storagePath);
      } catch (_e) {
        // ignore cleanup error
      }
    }

    await db.run('DELETE FROM content WHERE id = ?', [id]);
    saveDatabase();

    res.json({ message: 'Content deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getFreeContent = async (req, res) => {
  try {
    const db = getDb();

    const result = await db.exec(`
      SELECT c.*, u.name as uploaded_by_name FROM content c
      LEFT JOIN users u ON c.uploaded_by = u.id
      WHERE c.plan_tier = 'free' OR c.is_free = 1
      ORDER BY c.created_at DESC
    `);

    let content = mapContentRows(result);
    content = await resolveContentRows(content);
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
