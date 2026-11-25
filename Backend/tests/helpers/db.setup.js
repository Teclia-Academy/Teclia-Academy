import prisma from '../../utils/prismaClient.js';
import { connectDb } from '../../db/init.js';

let dbReady = false;

export const setupTestDb = () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';

    if (!process.env.TEST_DATABASE_URL?.trim()) {
      throw new Error(
        'TEST_DATABASE_URL is required for backend tests; refusing to use DATABASE_URL.'
      );
    }

    await connectDb();
    dbReady = true;
  });

  afterEach(async () => {
    if (!dbReady) return;

    await prisma.paymentEvent.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.content.deleteMany();
    await prisma.siteStat.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    if (dbReady) {
      await prisma.$disconnect();
    }
  });
};

export const promoteUserToAdmin = async (email) => {
  return prisma.user.updateMany({
    where: { email: { equals: email } },
    data: { role: 'admin' },
  });
};
