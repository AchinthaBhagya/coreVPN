import { PrismaClient, UserStatus, RoleType } from '@prisma/client';
import { hashPassword } from '../src/utils/encryption';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');
  
  // Create default permissions
  const permissions = [
    { name: 'users.create', module: 'users' },
    { name: 'users.read', module: 'users' },
    { name: 'users.update', module: 'users' },
    { name: 'users.delete', module: 'users' },
    { name: 'roles.manage', module: 'roles' },
    { name: 'clients.manage', module: 'clients' },
    { name: 'projects.manage', module: 'projects' },
    { name: 'tasks.manage', module: 'tasks' },
    { name: 'finance.manage', module: 'finance' },
    { name: 'invoices.manage', module: 'invoices' },
    { name: 'settings.manage', module: 'settings' },
  ];
  
  for (const perm of permissions) {
    await prisma.permission.upsert({
      where: { name: perm.name },
      update: {},
      create: perm,
    });
  }
  
  // Create owner role
  const ownerRole = await prisma.role.upsert({
    where: { name: 'Owner' },
    update: {},
    create: {
      name: 'Owner',
      description: 'Full system access',
      type: RoleType.OWNER,
      isSystem: true,
    },
  });
  
  // Assign all permissions to owner
  const allPerms = await prisma.permission.findMany();
  for (const perm of allPerms) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: ownerRole.id,
          permissionId: perm.id,
        },
      },
      update: {},
      create: {
        roleId: ownerRole.id,
        permissionId: perm.id,
      },
    });
  }
  
  console.log('Seeding complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
