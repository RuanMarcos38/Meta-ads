import { Role } from '@prisma/client';

export const ADMIN_ROLES: Role[] = [Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.ADMIN];
export const MANAGER_ROLES: Role[] = [...ADMIN_ROLES, Role.MANAGER];
export const INTERNAL_ROLES: Role[] = MANAGER_ROLES;
export const CLIENT_SCOPED_ROLES: Role[] = [Role.USER, Role.CLIENT];

const roleRank: Record<Role, number> = {
  [Role.SUPER_ADMIN]: 100,
  [Role.COMPANY_ADMIN]: 80,
  [Role.ADMIN]: 80,
  [Role.MANAGER]: 60,
  [Role.USER]: 20,
  [Role.CLIENT]: 20
};

export function isAdminRole(role: Role) {
  return ADMIN_ROLES.includes(role);
}

export function isInternalRole(role: Role) {
  return INTERNAL_ROLES.includes(role);
}

export function isClientScopedRole(role: Role) {
  return CLIENT_SCOPED_ROLES.includes(role);
}

export function canManageRole(actorRole: Role, targetRole: Role) {
  if (actorRole === Role.SUPER_ADMIN) return true;
  if (isAdminRole(actorRole)) return roleRank[targetRole] < roleRank[Role.COMPANY_ADMIN];
  if (actorRole === Role.MANAGER) return isClientScopedRole(targetRole);
  return false;
}

export function canManageUser(actorRole: Role, existingRole: Role, nextRole = existingRole) {
  return canManageRole(actorRole, existingRole) && canManageRole(actorRole, nextRole);
}
