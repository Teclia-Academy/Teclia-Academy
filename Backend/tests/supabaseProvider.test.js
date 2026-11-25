import { jest } from '@jest/globals';

const createSignedUrl = jest.fn();
const createSignedUploadUrl = jest.fn();
const from = jest.fn(() => ({ createSignedUrl, createSignedUploadUrl }));
const createClient = jest.fn(() => ({ storage: { from } }));

jest.unstable_mockModule('@supabase/supabase-js', () => ({ createClient }));

const { default: supabaseProvider } = await import('../storage/supabaseProvider.js');

describe('Supabase storage signed URLs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'service-role-key';
    process.env.SUPABASE_BUCKET = 'paid-content';
    process.env.SUPABASE_ANON_KEY = 'public-anon-key';
  });

  it('uses createSignedUrl with TTL and an optional download name', async () => {
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://project.supabase.co/signed/lesson' },
      error: null,
    });

    const result = await supabaseProvider.resolveSignedUrl('content/lesson.pdf', {
      expiresInSeconds: 600,
      downloadName: 'lesson.pdf',
    });

    expect(from).toHaveBeenCalledWith('paid-content');
    expect(createSignedUrl).toHaveBeenCalledWith(
      'content/lesson.pdf',
      600,
      { download: 'lesson.pdf' }
    );
    expect(result).toBe('https://project.supabase.co/signed/lesson');
  });

  it('surfaces Supabase signing failures', async () => {
    createSignedUrl.mockResolvedValue({
      data: null,
      error: { message: 'object not found' },
    });

    await expect(supabaseProvider.resolveSignedUrl('content/missing.pdf', {
      expiresInSeconds: 900,
    })).rejects.toThrow('Supabase storage createSignedUrl failed: object not found');
  });

  it('creates a scoped resumable upload URL for a direct browser upload', async () => {
    createSignedUploadUrl.mockResolvedValue({
      data: { token: 'signed-upload-token' },
      error: null,
    });

    const uploadId = 'c2cba8b5-360e-46bf-8f66-45a09f0c9912';
    const result = await supabaseProvider.createResumableUploadUrl(
      'lesson.mp4',
      'video/mp4',
      uploadId
    );

    expect(from).toHaveBeenCalledWith('paid-content');
    expect(createSignedUploadUrl).toHaveBeenCalledWith(
      `content/${uploadId}.mp4`,
      { upsert: true }
    );
    expect(result).toEqual({
      bucket: 'paid-content',
      path: `content/${uploadId}.mp4`,
      signature: 'signed-upload-token',
      endpoint: 'https://project.storage.supabase.co/storage/v1/upload/resumable/sign',
      apiKey: 'public-anon-key',
    });
  });

  it('explains when SUPABASE_URL is not a full HTTP URL', async () => {
    process.env.SUPABASE_URL = 'project-ref';

    await expect(supabaseProvider.createResumableUploadUrl('lesson.mp4', 'video/mp4'))
      .rejects.toThrow('SUPABASE_URL must be the full project URL');
    expect(createClient).not.toHaveBeenCalled();
  });
});
