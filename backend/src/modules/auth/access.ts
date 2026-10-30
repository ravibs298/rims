import { forbidden } from '../../errors';
import type { AuthUser } from '../../middleware/auth';

/**
 * Location scope rules:
 *  - Admin: all locations.
 *  - Any other role with assigned locations: only those.
 *  - Store Manager with no assignment: no locations (must be assigned explicitly).
 *  - Other roles with no assignment: all locations.
 */
export function computeLocationScope(role: string, assigned: number[]): number[] | null {
  if (role === 'Admin') return null;
  if (assigned.length > 0) return assigned;
  return role === 'Store Manager' ? [] : null;
}

export function canAccessLocation(user: Pick<AuthUser, 'locationIds'>, locationId: number): boolean {
  return user.locationIds === null || user.locationIds.includes(locationId);
}

export function assertLocation(user: Pick<AuthUser, 'locationIds'>, locationId: number) {
  if (!canAccessLocation(user, locationId)) throw forbidden('You do not have access to this location', 'LOCATION_FORBIDDEN');
}

/** Resolves a requested location filter against the user's scope. null = unrestricted. */
export function scopeLocations(user: Pick<AuthUser, 'locationIds'>, requested?: number): number[] | null {
  if (requested !== undefined) {
    assertLocation(user, requested);
    return [requested];
  }
  return user.locationIds;
}
