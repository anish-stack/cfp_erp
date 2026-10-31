import { User } from '../../models/User.js';
import { Role } from '../../models/Role.js';
import { Branch } from '../../models/Branch.js';
import { ApiError } from '../../utils/ApiError.js';
import { escapeRegex } from '../../utils/asyncHandler.js';

/** Non-super-admins: can't assign super_admin/global roles, can't touch branches outside their scope. */
async function guardAssignment(req, { role: roleId, branches, allBranches }) {
  if (roleId) {
    const role = await Role.findById(roleId);
    if (!role) throw ApiError.badRequest('Role not found');
    if (!req.isSuperAdmin && (role.permissions.includes('*') || role.scope === 'global')) {
      throw ApiError.forbidden('Only Super Admin can assign global roles');
    }
    if (!req.isSuperAdmin && role.permissions.some((p) => !req.perms.has(p))) {
      throw ApiError.forbidden('Role has permissions beyond yours');
    }
  }
  if (allBranches && !req.isSuperAdmin && !req.user.allBranches) throw ApiError.forbidden('Cannot grant all-branch access');
  if (branches?.length) {
    const n = await Branch.countDocuments({ _id: { $in: branches } });
    if (n !== branches.length) throw ApiError.badRequest('Invalid branch in list');
    branches.forEach((b) => req.assertBranch(b));
  }
}

export async function list(req, { page, limit, skip, q, role, isActive }) {
  const filter = {};
  if (req.allowedBranches || req.activeBranch) Object.assign(filter, req.branchFilter('branches'));
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ name: rx }, { email: rx }, { phone: rx }];
  }
  if (role) filter.role = role;
  if (isActive !== undefined) filter.isActive = isActive;
  const [items, total] = await Promise.all([
    User.find(filter).populate('role', 'name slug').populate('branches', 'name code').sort({ createdAt: -1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);
  return { items, total, page, limit };
}

export async function getScoped(req, id) {
  const u = await User.findById(id).populate('role', 'name slug permissions scope').populate('branches', 'name code');
  if (!u) throw ApiError.notFound('User not found');
  if (req.allowedBranches && !u.allBranches && !u.branches.some((b) => req.canAccessBranch(b._id))) {
    throw ApiError.forbidden('User outside your branches');
  }
  if (req.allowedBranches && u.allBranches) throw ApiError.forbidden('User outside your branches');
  return u;
}

export async function create(req, data) {
  await guardAssignment(req, data);
  const { password, ...rest } = data;
  const u = new User(rest);
  await u.setPassword(password);
  await u.save();
  return u;
}

export async function update(req, id, data) {
  const u = await getScoped(req, id);
  if (String(u._id) === String(req.user._id) && (data.role || data.isActive === false)) {
    throw ApiError.forbidden('Cannot change your own role or deactivate yourself');
  }
  await guardAssignment(req, data);
  const before = u.toObject();
  const { password, ...rest } = data;
  Object.assign(u, rest);
  if (password) await u.setPassword(password);
  await u.save();
  // force re-login when access-affecting fields change
  if (password || data.isActive === false || data.role || data.branches || data.allBranches !== undefined) {
    await User.updateOne({ _id: u._id }, { $inc: { tokenVersion: 1 } });
  }
  return { before, after: u };
}
