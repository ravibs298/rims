import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import { config } from '../../config';
import { exec, one, query, withTx } from '../../db';
import { audit } from '../../audit';
import { conflict, notFound, unauthorized, unprocessable } from '../../errors';
import { loadAuthUser } from '../../middleware/auth';
import { Where, pageParams } from '../../utils';

const DUMMY_HASH = bcrypt.hashSync('not-a-real-password-1', config.bcryptRounds);

export async function publicUser(id: number) {
  const u = await loadAuthUser(id);
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    full_name: u.fullName,
    role: u.role,
    permissions: [...u.permissions].sort(),
    location_ids: u.locationIds,
  };
}

export async function login(email: string, pw: string, ip: string | null) {
  const row = await one<any>('SELECT id, password_hash, is_active FROM users WHERE email = ?', [email]);
  // Always run a bcrypt comparison so response timing doesn't reveal whether the email exists.
  const ok = await bcrypt.compare(pw, row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok || !row.is_active) {
    await audit(row?.id ?? null, 'auth.login_failed', 'user', row?.id ?? null, { email }, ip);
    throw unauthorized('INVALID_CREDENTIALS', 'Invalid email or password');
  }
  await exec('UPDATE users SET last_login_at = NOW() WHERE id = ?', [row.id]);
  await audit(row.id, 'auth.login', 'user', row.id, undefined, ip);
  const token = jwt.sign({ sub: String(row.id) }, config.jwt.secret, {
    algorithm: 'HS256',
    expiresIn: config.jwt.expiresIn as SignOptions['expiresIn'],
  });
  return { token, expires_in: config.jwt.expiresIn, user: await publicUser(row.id) };
}

export async function listUsers() {
  return query(
    `SELECT u.id, u.email, u.full_name, u.is_active, u.last_login_at, u.created_at, r.name AS role,
            (SELECT GROUP_CONCAT(ul.location_id) FROM user_locations ul WHERE ul.user_id = u.id) AS location_ids
       FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id ORDER BY u.id`,
  ).then((rows) => rows.map((r: any) => ({ ...r, location_ids: r.location_ids ? String(r.location_ids).split(',').map(Number) : [] })));
}

export const listRoles = () =>
  query(
    `SELECT r.id, r.name, r.description, GROUP_CONCAT(p.code ORDER BY p.code) AS permissions
       FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id LEFT JOIN permissions p ON p.id = rp.permission_id
      GROUP BY r.id, r.name, r.description ORDER BY r.id`,
  ).then((rows) => rows.map((r: any) => ({ ...r, permissions: r.permissions ? String(r.permissions).split(',') : [] })));

async function roleId(name: string, c: any) {
  const r = await one<{ id: number }>('SELECT id FROM roles WHERE name = ?', [name], c);
  if (!r) throw unprocessable('INVALID_ROLE', 'Unknown role');
  return r.id;
}

async function setLocations(c: any, userId: number, ids: number[]) {
  await exec('DELETE FROM user_locations WHERE user_id = ?', [userId], c);
  for (const id of [...new Set(ids)]) await exec('INSERT INTO user_locations (user_id, location_id) VALUES (?,?)', [userId, id], c);
}

export async function createUser(actorId: number, input: any, ip: string | null) {
  const hash = await bcrypt.hash(input.password, config.bcryptRounds);
  const id = await withTx(async (c) => {
    const rid = await roleId(input.role, c);
    const r = await exec('INSERT INTO users (email, password_hash, full_name) VALUES (?,?,?)', [input.email, hash, input.full_name], c);
    await exec('INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES (?,?,?)', [r.insertId, rid, actorId], c);
    await setLocations(c, r.insertId, input.location_ids);
    await audit(actorId, input.role === 'Admin' ? 'admin.role_granted' : 'user.created', 'user', r.insertId, { email: input.email, role: input.role, location_ids: input.location_ids }, ip, c);
    return r.insertId;
  });
  return publicUser(id);
}

export async function updateUser(actorId: number, id: number, input: any, ip: string | null) {
  await withTx(async (c) => {
    const cur = await one<any>(
      `SELECT u.id, u.is_active, r.name AS role FROM users u JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id WHERE u.id = ? FOR UPDATE`,
      [id],
      c,
    );
    if (!cur) throw notFound('User');
    const losingAdmin = cur.role === 'Admin' && ((input.role && input.role !== 'Admin') || input.is_active === false);
    if (losingAdmin) {
      if (id === actorId) throw conflict('SELF_DEMOTION', 'Admins cannot demote or deactivate themselves');
      const others = await one<{ n: number }>(
        `SELECT COUNT(*) AS n FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
          WHERE r.name = 'Admin' AND u.is_active = 1 AND u.id <> ? FOR UPDATE`,
        [id],
        c,
      );
      if (!others || others.n < 1) throw conflict('LAST_ADMIN', 'At least one active Admin must remain');
    }
    if (input.full_name !== undefined) await exec('UPDATE users SET full_name = ? WHERE id = ?', [input.full_name, id], c);
    if (input.is_active !== undefined) await exec('UPDATE users SET is_active = ? WHERE id = ?', [input.is_active ? 1 : 0, id], c);
    if (input.password) await exec('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(input.password, config.bcryptRounds), id], c);
    if (input.role && input.role !== cur.role) {
      await exec('UPDATE user_roles SET role_id = ?, assigned_by = ?, assigned_at = NOW() WHERE user_id = ?', [await roleId(input.role, c), actorId, id], c);
    }
    if (input.location_ids) await setLocations(c, id, input.location_ids);
    const grantedAdmin = input.role === 'Admin' && cur.role !== 'Admin';
    const { password: pw, ...safe } = input;
    await audit(actorId, grantedAdmin ? 'admin.role_granted' : losingAdmin ? 'admin.role_revoked' : 'user.updated', 'user', id, { ...safe, password_changed: Boolean(pw), previous_role: cur.role }, ip, c);
  });
  return publicUser(id);
}

export async function listAudit(f: any) {
  const w = new Where();
  if (f.user_id) w.add('a.user_id = ?', f.user_id);
  if (f.action) w.add('a.action LIKE ?', `${f.action}%`);
  if (f.from) w.add('a.created_at >= ?', f.from);
  if (f.to) w.add('a.created_at < DATE_ADD(?, INTERVAL 1 DAY)', f.to);
  const { limit, offset } = pageParams(f.page, f.pageSize);
  const rows = await query(
    `SELECT a.id, a.user_id, u.email AS user_email, a.action, a.entity_type, a.entity_id, a.details, a.ip, a.created_at
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ${w.sql} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    [...w.params, limit, offset],
  );
  const total = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_logs a ${w.sql}`, w.params);
  return { data: rows, page: f.page, pageSize: f.pageSize, total: total?.n ?? 0 };
}
