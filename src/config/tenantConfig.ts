/**
 * tenantConfig.ts
 *
 * Loads, validates, and caches multi-tenant configuration.
 *
 * Loading priority (first wins):
 *   1. JSON file pointed to by TENANTS_CONFIG_PATH env var (default: tenants.json)
 *   2. Single-tenant environment variables (ZOHO_CLIENT_ID, etc.) — for backward compatibility.
 *
 * NEVER log or expose credential fields (clientSecret, refreshToken).
 */

import fs from 'fs';
import path from 'path';
import { TenantConfig, TenantConfigSchema } from '../types/schemas.js';

const DEFAULT_CONFIG_PATH = 'tenants.json';
const LEGACY_TENANT_ID = 'default';

/** Loaded and validated tenants, keyed by tenantId. */
let _tenantMap: Map<string, TenantConfig> | null = null;

/**
 * Loads tenant configuration from the config file or legacy env vars.
 * Validates each entry with Zod; skips entries with invalid config and logs a warning.
 * Skips entries whose `enabled` flag is false.
 */
export function loadTenants(): Map<string, TenantConfig> {
  if (_tenantMap) return _tenantMap;

  const configPath = process.env['TENANTS_CONFIG_PATH'] || DEFAULT_CONFIG_PATH;
  const resolved = path.resolve(configPath);

  const raw: TenantConfig[] = [];

  // ── 1. Attempt JSON config file ──────────────────────────────────────────
  if (fs.existsSync(resolved)) {
    try {
      const content = fs.readFileSync(resolved, 'utf-8');
      const parsed: unknown = JSON.parse(content);
      const entries: unknown[] = Array.isArray(parsed) ? parsed : [parsed];

      for (const entry of entries) {
        const result = TenantConfigSchema.safeParse(entry);
        if (!result.success) {
          // Safe to log tenant ID (not secret), but NOT credentials
          const id = (entry as any)?.tenantId || '(unknown)';
          console.warn(`[TenantConfig] Skipping invalid tenant "${id}":`, result.error.issues.map(i => i.message).join('; '));
          continue;
        }
        if (result.data.enabled === false) {
          console.log(`[TenantConfig] Tenant "${result.data.tenantId}" is disabled — skipping.`);
          continue;
        }
        raw.push(result.data);
      }
      console.log(`[TenantConfig] Loaded ${raw.length} tenant(s) from ${path.basename(resolved)}`);
    } catch (err: any) {
      console.error(`[TenantConfig] Failed to parse ${resolved}: ${err.message}`);
    }
  }

  // ── 2. Fallback: legacy single-tenant env vars ────────────────────────────
  if (raw.length === 0) {
    const clientId = process.env['ZOHO_CLIENT_ID'];
    const clientSecret = process.env['ZOHO_CLIENT_SECRET'];
    const refreshToken = process.env['ZOHO_REFRESH_TOKEN'];
    const organizationId = process.env['ZOHO_ORGANIZATION_ID'];

    if (clientId && clientSecret && refreshToken && organizationId) {
      const groupId = process.env['WHATSAPP_GROUP_ID'];
      const legacyTenant: TenantConfig = {
        tenantId: LEGACY_TENANT_ID,
        businessName: process.env['BUSINESS_NAME'] || 'My Business',
        authorizedGroupIds: groupId ? [groupId] : ['*'],  // '*' = any group (legacy open mode)
        zoho: {
          clientId,
          clientSecret,
          refreshToken,
          organizationId,
          baseUrl: process.env['ZOHO_BASE_URL'] || 'https://www.zohoapis.com/books/v3',
          accountsUrl: process.env['ZOHO_ACCOUNTS_URL'] || 'https://accounts.zoho.com',
        },
        invoiceSettings: {
          currency: 'INR',
          paymentTermsDays: 30,
          requireConfirmation: true,
          priceOverrideAllowed: true,
        },
        enabled: true,
      };
      raw.push(legacyTenant);
      console.log(`[TenantConfig] Loaded legacy single-tenant config from environment variables (tenant: "${LEGACY_TENANT_ID}")`);
    }
  }

  // ── 3. Build the map and check for duplicate group IDs ─────────────────────
  _tenantMap = new Map<string, TenantConfig>();
  const seenGroups = new Map<string, string>(); // groupId -> tenantId

  for (const tenant of raw) {
    if (_tenantMap.has(tenant.tenantId)) {
      console.warn(`[TenantConfig] Duplicate tenant ID "${tenant.tenantId}" — ignoring duplicate.`);
      continue;
    }

    // Check for group ID collisions across tenants (excluding wildcards)
    for (const gid of tenant.authorizedGroupIds) {
      if (gid !== '*') {
        if (seenGroups.has(gid)) {
          console.error(
            `[TenantConfig] ⚠️ Ambiguous group configuration: group "${gid}" is claimed by both "${seenGroups.get(gid)}" and "${tenant.tenantId}".`
          );
        } else {
          seenGroups.set(gid, tenant.tenantId);
        }
      }
    }

    _tenantMap.set(tenant.tenantId, tenant);
  }

  if (_tenantMap.size === 0) {
    console.warn(
      '[TenantConfig] No tenants configured. ' +
      `Create a ${DEFAULT_CONFIG_PATH} file or set ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN / ZOHO_ORGANIZATION_ID in .env`
    );
  }

  return _tenantMap;
}

/**
 * Returns all enabled tenants as an array.
 */
export function getAllTenants(): TenantConfig[] {
  return Array.from(loadTenants().values());
}

/**
 * Returns the TenantConfig for the given tenantId, or null if not found.
 */
export function getTenantById(tenantId: string): TenantConfig | null {
  return loadTenants().get(tenantId) ?? null;
}

/**
 * Resolves the tenant responsible for the given WhatsApp group JID.
 *
 * Rules:
 *   - Tenants are checked in the order they appear in the config file.
 *   - If exactly one tenant lists the group ID, that tenant is used.
 *   - If a tenant has authorizedGroupIds = ['*'], it matches any group
 *     that no other tenant explicitly claims (legacy single-tenant mode).
 *   - If multiple tenants explicitly claim the same group ID, resolution
 *     fails safely and null is returned (ambiguous configuration).
 *   - If no tenant matches, null is returned.
 *
 * IMPORTANT: the caller is responsible for rejecting messages from
 * unresolved groups. Never let the LLM or message sender choose the tenant.
 */
export function resolveTenantByGroupId(groupJid: string): TenantConfig | null {
  const tenants = getAllTenants();

  // Exact-match candidates
  const exactMatches = tenants.filter(
    (t) => t.authorizedGroupIds.includes(groupJid)
  );

  if (exactMatches.length === 1) {
    return exactMatches[0]!;
  }

  if (exactMatches.length > 1) {
    console.error(
      `[TenantConfig] Ambiguous tenant configuration: group "${groupJid}" ` +
      `is listed by ${exactMatches.length} tenants: ${exactMatches.map(t => t.tenantId).join(', ')}. ` +
      'Rejecting message to avoid cross-tenant data leakage.'
    );
    return null;
  }

  // No explicit match — check for a wildcard ('*') tenant
  const wildcardTenants = tenants.filter(
    (t) => t.authorizedGroupIds.includes('*')
  );

  if (wildcardTenants.length === 1) {
    return wildcardTenants[0]!;
  }

  return null;
}

/**
 * Returns a sanitized summary of all tenants (safe for logging / API responses).
 * MUST NOT include clientSecret or refreshToken.
 */
export function getTenantsSummary(): Array<{
  tenantId: string;
  businessName: string;
  groupCount: number;
  organizationId: string;
  enabled: boolean;
}> {
  return getAllTenants().map((t) => ({
    tenantId: t.tenantId,
    businessName: t.businessName,
    groupCount: t.authorizedGroupIds.length,
    organizationId: t.zoho.organizationId,
    enabled: t.enabled ?? true,
  }));
}

/**
 * Resets the cached tenant config. Call only in tests.
 */
export function _resetTenantConfigForTest(): void {
  _tenantMap = null;
}
