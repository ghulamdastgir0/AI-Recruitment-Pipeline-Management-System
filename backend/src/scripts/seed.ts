import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

const SALT_ROUNDS = 12;

// Idempotent: creates exactly one ADMIN account from env vars if no user
// with that email exists yet. This is an operator-provided real account
// (not fabricated business data), the only way to bootstrap the first HR
// login now that document/job/CV endpoints require real JWT auth.
//
// Lives under src/ (not prisma/) so `nest build` compiles it alongside the
// generated Prisma client — running it via ts-node directly against the
// generated client's NodeNext-style ".js" relative imports fails to resolve
// since no matching .js files exist until a real build has run.
async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  const firstName = process.env.SEED_ADMIN_FIRST_NAME ?? 'HR';
  const lastName = process.env.SEED_ADMIN_LAST_NAME ?? 'Admin';

  if (!email || !password) {
    throw new Error(
      'SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set to seed the first admin user.',
    );
  }

  const prisma = new PrismaService();
  await prisma.onModuleInit();

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      console.log(
        `Admin user "${email}" already exists (id: ${existing.id}). Nothing to do.`,
      );
      return;
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await prisma.user.create({
      data: { email, passwordHash, firstName, lastName, role: 'ADMIN' },
    });
    console.log(`Created admin user "${user.email}" (id: ${user.id}).`);
  } finally {
    await prisma.onModuleDestroy();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
