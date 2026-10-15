import { PrismaClient, UserStatus } from '@prisma/client';
import { PERMISSIONS, ROLE_TEMPLATES } from '../src/config/permissions';
import { hashPassword, validatePasswordPolicy } from '../src/utils/password';

const prisma = new PrismaClient();

const SEED_DEMO = process.env.SEED_DEMO === 'true';
const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL?.trim().toLowerCase();
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD;
const OWNER_FIRST = process.env.SEED_OWNER_FIRST_NAME?.trim() || 'System';
const OWNER_LAST = process.env.SEED_OWNER_LAST_NAME?.trim() || 'Owner';

/**
 * Seeds the permission catalogue and the default role templates. This is safe to
 * re-run: permissions and roles are upserted and role permissions are
 * reconciled to the template (system roles only - custom roles are untouched).
 *
 * There is deliberately NO default admin account or password. An initial owner
 * is only created when SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD are provided.
 */
async function seedPermissions() {
  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { name: permission.name },
      update: { module: permission.module, description: permission.description },
      create: permission,
    });
  }
  console.log(`  ✓ ${PERMISSIONS.length} permissions ready`);
}

async function seedRoles() {
  const allPermissions = await prisma.permission.findMany({ select: { id: true, name: true } });
  const idByName = new Map(allPermissions.map((p) => [p.name, p.id]));

  for (const template of ROLE_TEMPLATES) {
    const role = await prisma.role.upsert({
      where: { name: template.name },
      update: { description: template.description, type: template.type, isSystem: true },
      create: { name: template.name, description: template.description, type: template.type, isSystem: true },
    });

    const desiredIds = template.permissions
      .map((name) => idByName.get(name))
      .filter((id): id is string => Boolean(id));

    const current = await prisma.rolePermission.findMany({ where: { roleId: role.id }, select: { permissionId: true } });
    const currentIds = new Set(current.map((row) => row.permissionId));

    const toAdd = desiredIds.filter((id) => !currentIds.has(id));
    const toRemove = current.filter((row) => !desiredIds.includes(row.permissionId));

    if (toRemove.length) {
      await prisma.rolePermission.deleteMany({
        where: { roleId: role.id, permissionId: { in: toRemove.map((row) => row.permissionId) } },
      });
    }
    if (toAdd.length) {
      await prisma.rolePermission.createMany({
        data: toAdd.map((permissionId) => ({ roleId: role.id, permissionId })),
        skipDuplicates: true,
      });
    }
    console.log(`  ✓ role "${template.name}" (${desiredIds.length} permissions)`);
  }

  const unknown = ROLE_TEMPLATES.flatMap((t) => t.permissions).filter((name) => !idByName.has(name));
  if (unknown.length) {
    console.warn(`  ! Role templates reference permissions not in the catalogue: ${Array.from(new Set(unknown)).join(', ')}`);
  }
}

async function ensureOwner() {
  if (!OWNER_EMAIL || !OWNER_PASSWORD) {
    console.log('\nℹ No owner account created.');
    console.log('  Set SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD in the environment, then run:');
    console.log('    npm run db:seed');
    console.log('  Or create an owner at any time with:');
    console.log('    SEED_OWNER_EMAIL=you@company.com SEED_OWNER_PASSWORD="<strong-password>" npm run db:seed');
    return;
  }

  const policy = validatePasswordPolicy(OWNER_PASSWORD);
  if (!policy.valid) {
    throw new Error(`SEED_OWNER_PASSWORD does not meet the security policy:\n  - ${policy.errors.join('\n  - ')}`);
  }

  const ownerRole = await prisma.role.findUnique({ where: { name: 'Owner' } });
  if (!ownerRole) throw new Error('Owner role missing - run the role seed first');

  const existing = await prisma.user.findUnique({ where: { email: OWNER_EMAIL } });
  if (existing) {
    // Never overwrite an existing account's password from a seed run.
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: existing.id, roleId: ownerRole.id } },
      update: {},
      create: { userId: existing.id, roleId: ownerRole.id },
    });
    console.log(`  ✓ owner role ensured for existing user ${OWNER_EMAIL}`);
    return;
  }

  const user = await prisma.user.create({
    data: {
      email: OWNER_EMAIL,
      firstName: OWNER_FIRST,
      lastName: OWNER_LAST,
      password: await hashPassword(OWNER_PASSWORD),
      status: UserStatus.ACTIVE,
      jobTitle: 'Owner',
      userRoles: { create: [{ roleId: ownerRole.id }] },
    },
  });
  console.log(`  ✓ owner account created: ${user.email}`);
}

async function seedDemoData() {
  const company = await prisma.companySetting.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default', companyName: '3xCodz', currency: 'LKR' },
  });

  const categories = ['Software', 'Hosting', 'Marketing', 'Design', 'Travel', 'Equipment'];
  for (const name of categories) {
    await prisma.expenseCategory.upsert({ where: { name }, update: {}, create: { name } });
  }

  const services = [
    { name: 'Web Application Development', slug: 'web-app-development', category: 'Development', pricingModel: 'PROJECT_BASED' as const, basePrice: '250000' },
    { name: 'Brand Identity Design', slug: 'brand-identity-design', category: 'Design', pricingModel: 'FIXED' as const, basePrice: '85000' },
    { name: 'Monthly Maintenance Retainer', slug: 'monthly-maintenance', category: 'Support', pricingModel: 'MONTHLY' as const, basePrice: '35000' },
  ];
  for (const service of services) {
    await prisma.service.upsert({ where: { slug: service.slug }, update: {}, create: service });
  }

  const demoClients = [
    { companyName: 'Northwind Traders', firstName: 'Nadia', lastName: 'Rahman', email: 'nadia@northwind.example' },
    { companyName: 'Ceylon Digital', firstName: 'Kavindu', lastName: 'Perera', email: 'kavindu@ceylondigital.example' },
  ];
  for (const client of demoClients) {
    await prisma.client.upsert({ where: { email: client.email }, update: {}, create: { ...client, currency: 'LKR', status: 'ACTIVE' } });
  }

  console.log(`  ✓ demo company settings + ${categories.length} expense categories, ${services.length} services, ${demoClients.length} clients`);
  return company;
}

async function main() {
  console.log('Seeding 3xCodz management system...\n[permissions]');
  await seedPermissions();

  console.log('[roles]');
  await seedRoles();

  console.log('[owner]');
  await ensureOwner();

  if (SEED_DEMO) {
    console.log('[demo data]');
    await seedDemoData();
  } else {
    console.log('\nℹ Demo data skipped (set SEED_DEMO=true to include sample records).');
  }

  // Ensure the singleton company row always exists.
  await prisma.companySetting.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default', companyName: '3xCodz', currency: 'LKR' },
  });

  console.log('\nSeeding complete.');
}

main()
  .catch((error) => {
    console.error('\nSeeding failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
