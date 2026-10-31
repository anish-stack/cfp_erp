import { Role } from '../../models/Role.js';
import { User } from '../../models/User.js';
import { ApiError } from '../../utils/ApiError.js';
import { ACTIONS, MODULES, isValidPermission } from '../../constants/permissions.js';

export const catalog = () => ({
  actions: ACTIONS,
  modules: Object.entries(MODULES).map(([key, m]) => ({ key, ...m })),
});

function checkPerms(perms, actorPerms) {
  const bad = perms.filter((p) => !isValidPermission(p));
  if (bad.length) throw ApiError.badRequest(`Unknown permissions: ${bad.join(', ')}`);
  if (perms.includes('*') && !actorPerms.has('*')) throw ApiError.forbidden('Only Super Admin can grant full access');
  if (!actorPerms.has('*')) {
    const escalate = perms.filter((p) => !actorPerms.has(p));
    if (escalate.length) throw ApiError.forbidden(`Cannot grant permissions you lack: ${escalate.join(', ')}`);
  }
  return [...new Set(perms)];
}

export async function list() {
  const roles = await Role.find().sort({ isSystem: -1, name: 1 }).lean();
  const counts = await User.aggregate([{ $group: { _id: '$role', n: { $sum: 1 } } }]);
  const map = new Map(counts.map((c) => [String(c._id), c.n]));
  return roles.map((r) => ({ ...r, userCount: map.get(String(r._id)) || 0 }));
}

export async function get(id) {
  const role = await Role.findById(id);
  if (!role) throw ApiError.notFound('Role not found');
  return role;
}

export async function create(data, actorPerms) {
  data.permissions = checkPerms(data.permissions, actorPerms);
  return Role.create({ ...data, isSystem: false });
}

export async function update(id, data, actorPerms) {
  const role = await get(id);
  if (role.slug === 'super_admin') throw ApiError.forbidden('Super Admin role is locked');
  const before = role.toObject();
  if (data.permissions) data.permissions = checkPerms(data.permissions, actorPerms);
  if (role.isSystem) delete data.slug; // system slug fixed
  Object.assign(role, data);
  await role.save();
  return { before, after: role };
}

export async function remove(id) {
  const role = await get(id);
  if (role.isSystem) throw ApiError.forbidden('System roles cannot be deleted');
  const inUse = await User.countDocuments({ role: role._id });
  if (inUse) throw ApiError.conflict(`Role assigned to ${inUse} user(s). Reassign first`);
  await role.deleteOne();
  return role;
}
