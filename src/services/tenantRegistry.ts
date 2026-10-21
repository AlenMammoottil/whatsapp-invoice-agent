/**
 * tenantRegistry.ts
 *
 * Creates and caches per-tenant service instances.
 *
 * Each tenant gets:
 *  - Its own ZohoRealService (or ZohoMockService in tests/dev)
 *  - Its own StorageService (isolated state file under data/<tenantId>/)
 *  - Its own AgentService (using the above two)
 *
 * Instances are created lazily and cached for the lifetime of the process.
 * Credentials are NEVER logged.
 */

import { TenantConfig } from '../types/schemas.js';
import { IZohoService } from './zohoInterface.js';
import { ZohoRealService } from './zohoRealService.js';
import { zohoMockService, ZohoMockService } from './zohoMockService.js';
import { StorageService } from './storageService.js';
import { AgentService } from './agentService.js';
import { getAllTenants, resolveTenantByGroupId } from '../config/tenantConfig.js';

export interface TenantContext {
  tenant: TenantConfig;
  zohoService: IZohoService;
  storage: StorageService;
  agentService: AgentService;
}

/** Per-tenant ZohoService instances */
const _zohoInstances = new Map<string, IZohoService>();
/** Per-tenant StorageService instances */
const _storageInstances = new Map<string, StorageService>();
/** Per-tenant AgentService instances */
const _agentInstances = new Map<string, AgentService>();

/** Test-only overrides for Zoho instances (injected via _overrideZohoForTest) */
const _zohoTestOverrides = new Map<string, IZohoService>();

/**
 * Returns whether the tenant is explicitly configured as a mock tenant.
 */
export function isMockTenant(tenant: TenantConfig): boolean {
  if (tenant.mock === true || tenant.mode === 'mock') return true;
  if (tenant.zoho?.mock === true || tenant.zoho?.mode === 'mock') return true;
  return false;
}

/**
 * Returns whether the tenant has valid Zoho credentials to use the live API.
 * Always returns false for mock tenants.
 */
export function isZohoConfigured(tenant: TenantConfig): boolean {
  if (isMockTenant(tenant)) return false;
  const z = tenant.zoho;
  return Boolean(z && z.clientId && z.clientSecret && z.refreshToken && z.organizationId);
}

/**
 * Returns the ZohoService for the given tenant (cached after first call).
 */
export function getZohoServiceForTenant(tenant: TenantConfig): IZohoService {
  // Test override takes priority
  const override = _zohoTestOverrides.get(tenant.tenantId);
  if (override) return override;

  const cached = _zohoInstances.get(tenant.tenantId);
  if (cached) return cached;

  let service: IZohoService;
  if (isMockTenant(tenant)) {
    console.log(`[TenantRegistry] Tenant "${tenant.tenantId}": explicit mock tenant — using ZohoMockService (no live Zoho API/OAuth calls)`);
    service = new ZohoMockService();
  } else if (isZohoConfigured(tenant)) {
    console.log(`[TenantRegistry] Tenant "${tenant.tenantId}": using live ZohoRealService (org: ${tenant.zoho.organizationId})`);
    service = new ZohoRealService({
      clientId: tenant.zoho.clientId!,
      clientSecret: tenant.zoho.clientSecret!,
      refreshToken: tenant.zoho.refreshToken!,
      organizationId: tenant.zoho.organizationId,
      baseUrl: tenant.zoho.baseUrl,
      accountsUrl: tenant.zoho.accountsUrl,
    });
  } else {
    console.log(`[TenantRegistry] Tenant "${tenant.tenantId}": no Zoho credentials — using mock service`);
    // Each mock tenant gets its own mock instance to keep catalogs isolated
    service = new ZohoMockService();
  }

  _zohoInstances.set(tenant.tenantId, service);
  return service;
}

/**
 * Returns the StorageService for the given tenant (cached, isolated file path).
 */
export function getStorageForTenant(tenant: TenantConfig): StorageService {
  const cached = _storageInstances.get(tenant.tenantId);
  if (cached) return cached;

  // Each tenant has its own data directory: data/<tenantId>/agent_state.json
  const storage = StorageService.createForTenant(tenant.tenantId);
  _storageInstances.set(tenant.tenantId, storage);
  return storage;
}

/**
 * Returns the AgentService for the given tenant (cached).
 */
export function getAgentServiceForTenant(tenant: TenantConfig): AgentService {
  const cached = _agentInstances.get(tenant.tenantId);
  if (cached) return cached;

  const zoho = getZohoServiceForTenant(tenant);
  const storage = getStorageForTenant(tenant);
  const agent = new AgentService(zoho, storage);
  _agentInstances.set(tenant.tenantId, agent);
  return agent;
}

/**
 * Returns the full TenantContext for the given tenant config.
 */
export function getTenantContext(tenant: TenantConfig): TenantContext {
  return {
    tenant,
    zohoService: getZohoServiceForTenant(tenant),
    storage: getStorageForTenant(tenant),
    agentService: getAgentServiceForTenant(tenant),
  };
}

/**
 * Resolves TenantContext from a WhatsApp group JID.
 * Returns null if the group is unauthorized or unmapped.
 * Logs a warning for unrecognized groups.
 */
export function resolveTenantContextByGroup(groupJid: string): TenantContext | null {
  const tenant = resolveTenantByGroupId(groupJid);
  if (!tenant) return null;
  return getTenantContext(tenant);
}

/**
 * Pre-initializes contexts for all configured tenants.
 * Call at startup to surface configuration errors early.
 */
export function initializeAllTenants(): void {
  const tenants = getAllTenants();
  console.log(`[TenantRegistry] Initializing ${tenants.length} tenant(s)...`);
  for (const tenant of tenants) {
    try {
      getTenantContext(tenant);
      console.log(`  ✅ Tenant "${tenant.tenantId}" (${tenant.businessName}) initialized`);
    } catch (err: any) {
      console.error(`  ❌ Tenant "${tenant.tenantId}" failed to initialize: ${err.message}`);
    }
  }
}

/**
 * Clears all cached instances. Call only in tests.
 */
export function _resetRegistryForTest(): void {
  _zohoInstances.clear();
  _storageInstances.clear();
  _agentInstances.clear();
  _zohoTestOverrides.clear();
}

/**
 * Injects a test-specific Zoho service for a tenant, bypassing real API calls.
 * Call only in tests.
 */
export function _overrideZohoForTest(tenantId: string, service: IZohoService): void {
  _zohoTestOverrides.set(tenantId, service);
  // Clear any cached real instance so the override takes effect
  _zohoInstances.delete(tenantId);
  _agentInstances.delete(tenantId);
}
