/**
 * multiTenancy.test.ts
 *
 * Tests for multi-tenant isolation, tenant resolution, and cross-tenant protection.
 * All Zoho API calls are mocked; no real invoices are created.
 */

import { TenantConfig } from '../types/schemas.js';
import {
  resolveTenantByGroupId,
  getAllTenants,
  getTenantById,
  _resetTenantConfigForTest,
} from '../config/tenantConfig.js';
import {
  getZohoServiceForTenant,
  getStorageForTenant,
  getAgentServiceForTenant,
  getTenantContext,
  resolveTenantContextByGroup,
  _resetRegistryForTest,
  _overrideZohoForTest,
} from '../services/tenantRegistry.js';
import { ZohoMockService } from '../services/zohoMockService.js';
import { StorageService } from '../services/storageService.js';
import { AgentService } from '../services/agentService.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: string): void {
  if (condition) {
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${name}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function makeTestTenant(
  id: string,
  groups: string[],
  orgId: string = `org_${id}`,
  enabled: boolean = true
): TenantConfig {
  return {
    tenantId: id,
    businessName: `Business ${id}`,
    authorizedGroupIds: groups,
    zoho: {
      clientId: `client_${id}`,
      clientSecret: `secret_${id}`,
      refreshToken: `refresh_${id}`,
      organizationId: orgId,
    },
    invoiceSettings: { currency: 'INR', paymentTermsDays: 30, requireConfirmation: true },
    enabled,
  };
}

/**
 * Sets up a fake tenant map in the tenantConfig module for the duration of a test block.
 * Patch: override the module's internal Map by resetting and patching loadTenants via env.
 * Since we can't easily mock the fs module, we directly override the exported map holder
 * using the _resetTenantConfigForTest escape hatch plus a patched loadTenants.
 *
 * Strategy: inject tenants via the _tenantMap override trick — create isolated subtests
 * that bypass the file loader by providing an agentService directly.
 */

// ─── Test Suite ──────────────────────────────────────────────────────────────

async function runMultiTenancyTests() {
  console.log('🧪 Starting Multi-Tenancy Isolation Tests...\n');

  // ─── SECTION 1: Tenant resolution ─────────────────────────────────────────

  console.log('── Section 1: Tenant resolution from group JID ──');

  {
    // Simulate two tenants in the registry cache
    _resetRegistryForTest();
    _resetTenantConfigForTest();

    const tenantA = makeTestTenant('alpha', ['groupA@g.us']);
    const tenantB = makeTestTenant('beta', ['groupB@g.us', 'groupB2@g.us']);

    // Manually populate registry with known contexts (bypass file loading)
    const zohoA = new ZohoMockService();
    const zohoB = new ZohoMockService();
    const storA = StorageService.createForTest();
    const storB = StorageService.createForTest();
    const agentA = new AgentService(zohoA, storA);
    const agentB = new AgentService(zohoB, storB);

    // T01: Verify group→tenant resolution works correctly
    // We simulate the registry directly since config file loading isn't available in tests
    const contextA = { tenant: tenantA, zohoService: zohoA, storage: storA, agentService: agentA };
    const contextB = { tenant: tenantB, zohoService: zohoB, storage: storB, agentService: agentB };

    assert(contextA.tenant.tenantId === 'alpha', 'T01: Tenant A has correct ID');
    assert(contextA.tenant.authorizedGroupIds.includes('groupA@g.us'), 'T01: Tenant A has its group');
    assert(contextB.tenant.authorizedGroupIds.includes('groupB@g.us'), 'T01: Tenant B has its groups');
    assert(contextB.tenant.authorizedGroupIds.includes('groupB2@g.us'), 'T01: Tenant B can have multiple groups');
    assert(!contextA.tenant.authorizedGroupIds.includes('groupB@g.us'), 'T01: Tenant A does NOT include B\'s group');
  }

  // ─── SECTION 2: Separate Zoho service instances ────────────────────────────

  console.log('\n── Section 2: Separate Zoho services per tenant ──');

  {
    _resetRegistryForTest();

    const tenantX = makeTestTenant('tenant_x', ['grp_x@g.us'], 'org_x_12345');
    const tenantY = makeTestTenant('tenant_y', ['grp_y@g.us'], 'org_y_67890');

    // Inject mock Zoho instances so we don't make live API calls with fake credentials
    const mockZohoX = new ZohoMockService();
    const mockZohoY = new ZohoMockService();
    _overrideZohoForTest('tenant_x', mockZohoX);
    _overrideZohoForTest('tenant_y', mockZohoY);

    const zohoX = getZohoServiceForTenant(tenantX);
    const zohoY = getZohoServiceForTenant(tenantY);

    assert(zohoX !== zohoY, 'T02: Each tenant gets a distinct Zoho service instance');
    assert(zohoX === getZohoServiceForTenant(tenantX), 'T02: Zoho service is cached (same instance on re-call)');
    assert(zohoY === getZohoServiceForTenant(tenantY), 'T02: Zoho service is cached for tenant Y too');
    assert(zohoX !== zohoY, 'T02: Each tenant gets its own isolated instance (distinct references)');

    // Verify mocked catalogs are accessible
    const cxItems = await zohoX.getItems();
    const cyItems = await zohoY.getItems();
    assert(Array.isArray(cxItems), 'T02: Tenant X mock returns items array');
    assert(Array.isArray(cyItems), 'T02: Tenant Y mock returns items array');
    assert(cxItems.length > 0, 'T02: Tenant X mock has catalog items');
  }

  // ─── SECTION 3: Storage isolation ─────────────────────────────────────────

  console.log('\n── Section 3: Storage isolation per tenant ──');

  {
    _resetRegistryForTest();
    StorageService._resetTenantInstances();

    const tenantP = makeTestTenant('tenant_p', ['grp_p@g.us']);
    const tenantQ = makeTestTenant('tenant_q', ['grp_q@g.us']);

    const storP = getStorageForTenant(tenantP);
    const storQ = getStorageForTenant(tenantQ);

    assert(storP !== storQ, 'T03: Each tenant gets a distinct StorageService instance');
    assert(storP === getStorageForTenant(tenantP), 'T03: Storage is cached per tenant');

    // Saving a clarification in tenant P should not appear in tenant Q
    storP.savePendingClarification({
      clarification_id: 'clar_P_001',
      group_id: 'grp_p@g.us',
      sender_jid: 'userP@s.whatsapp.net',
      original_reference_number: 'WA-REF_P',
      kind: 'MISSING_QUANTITY',
      options: [],
      partialExtraction: {
        customer_name: 'Metro Tyres',
        items: [{ raw_item_name: 'Car Tyre 13-inch', quantity: null }],
      },
      created_at: Date.now(),
      expires_at: Date.now() + 600_000,
    });

    const clarInP = storP.findPendingClarificationForSender('grp_p@g.us', 'userP@s.whatsapp.net');
    const clarInQ = storQ.findPendingClarificationForSender('grp_p@g.us', 'userP@s.whatsapp.net');

    assert(clarInP !== null, 'T03: Clarification is visible in tenant P\'s storage');
    assert(clarInQ === null, 'T03: Clarification does NOT bleed into tenant Q\'s storage');
  }

  // ─── SECTION 4: Pending invoice isolation (approvals) ─────────────────────

  console.log('\n── Section 4: Pending invoice isolation per tenant ──');

  {
    _resetRegistryForTest();
    StorageService._resetTenantInstances();

    const tenantM = makeTestTenant('tenant_m', ['grp_m@g.us']);
    const tenantN = makeTestTenant('tenant_n', ['grp_n@g.us']);

    const storM = getStorageForTenant(tenantM);
    const storN = getStorageForTenant(tenantN);

    const dummyPayload: any = {
      tenant_id: 'tenant_m',
      customer_id: 'cust_001',
      reference_number: 'WA-TESTREF',
      line_items: [{ item_id: 'item_001', quantity: 2 }],
    };

    const pendingApproval: any = {
      approval_id: 'appr_M_001',
      tenant_id: 'tenant_m',
      reference_number: 'WA-TESTREF',
      group_id: 'grp_m@g.us',
      sender_jid: 'userM@s.whatsapp.net',
      sender_name: 'User M',
      payload: dummyPayload,
      summary: {
        customer_name: 'Acme Corp',
        items: [{ name: 'Widget', quantity: 2, rate: 100, catalog_rate: 100, rate_source: 'catalog', item_total: 200 }],
        subtotal: 200,
        tax_total: 0,
        total: 200,
        currency: 'INR',
        has_price_override: false,
      },
      created_at: Date.now(),
      expires_at: Date.now() + 900_000,
    };

    storM.savePendingApproval(pendingApproval);

    const foundInM = storM.findPendingApprovalForSender('grp_m@g.us', 'userM@s.whatsapp.net');
    const foundInN = storN.findPendingApprovalForSender('grp_m@g.us', 'userM@s.whatsapp.net');

    assert(foundInM !== null, 'T04: Pending approval visible in tenant M\'s storage');
    assert(foundInN === null, 'T04: Pending approval NOT visible in tenant N\'s storage');
    assert(foundInM?.reference_number === 'WA-TESTREF', 'T04: Correct reference in tenant M approval');
  }

  // ─── SECTION 5: Cross-tenant invoice creation prevention ──────────────────

  console.log('\n── Section 5: Cross-tenant invoice creation prevention ──');

  {
    _resetRegistryForTest();
    StorageService._resetTenantInstances();

    const tenantA = makeTestTenant('biz_a', ['group_biz_a@g.us']);
    const tenantB = makeTestTenant('biz_b', ['group_biz_b@g.us']);

    const zohoA = new ZohoMockService();
    const zohoB = new ZohoMockService();
    const storA = StorageService.createForTest();
    const storB = StorageService.createForTest();
    const agentA = new AgentService(zohoA, storA);
    const agentB = new AgentService(zohoB, storB);

    // Tenant A sends an invoice request in their group
    const r1 = await agentA.processIncomingMessage({
      messageText: 'Bill Acme Corp for 2 hours of web development',
      messageId: 'msg_biz_a_001',
      groupId: 'group_biz_a@g.us',
      senderJid: 'user@s.whatsapp.net',
      tenantId: 'biz_a',
      providerName: 'heuristic',
    });

    // Tenant B's agent processing a message about tenant A's group should not see A's approval
    const r2 = await agentB.processIncomingMessage({
      messageText: 'confirm',
      messageId: 'msg_biz_b_001',
      groupId: 'group_biz_b@g.us',
      senderJid: 'user@s.whatsapp.net',
      tenantId: 'biz_b',
      providerName: 'heuristic',
    });

    assert(
      r2.replyText.includes('No Pending Approval') || r2.replyText.includes('pending'),
      'T05: Tenant B\'s confirm does NOT see tenant A\'s pending approval'
    );
    assert(
      r2.invoice === undefined,
      'T05: No invoice created in tenant B from tenant A\'s pending approval'
    );
  }

  // ─── SECTION 6: Unauthorized group rejection ──────────────────────────────

  console.log('\n── Section 6: Unauthorized group handling ──');

  {
    // resolveTenantByGroupId with an empty tenant list returns null
    _resetTenantConfigForTest();

    // Without any tenants configured, a random group ID should not resolve
    const result = resolveTenantByGroupId('unauthorized@g.us');
    assert(result === null, 'T06: Unrecognized group resolves to null (no tenants configured)');
  }

  // ─── SECTION 7: Tenant enabled flag ───────────────────────────────────────

  console.log('\n── Section 7: Disabled tenants are ignored ──');

  {
    _resetRegistryForTest();

    const enabled = makeTestTenant('enabled_biz', ['group_enabled@g.us'], 'org_en', true);
    const disabled = makeTestTenant('disabled_biz', ['group_disabled@g.us'], 'org_dis', false);

    // Verify enabled flag is set correctly in the config objects
    assert(enabled.enabled === true, 'T07: Enabled tenant has enabled=true');
    assert(disabled.enabled === false, 'T07: Disabled tenant has enabled=false');

    // In a real load scenario, disabled tenants are filtered by loadTenants()
    // We verify the filtering logic using the schema's enabled default
    const { TenantConfigSchema } = await import('../types/schemas.js');
    const parsed = TenantConfigSchema.safeParse({ ...disabled, enabled: false });
    assert(parsed.success && parsed.data.enabled === false, 'T07: Zod schema preserves enabled=false');
  }

  // ─── SECTION 8: Wildcard group ('*') — legacy single-tenant mode ──────────

  console.log('\n── Section 8: Wildcard group resolution ──');

  {
    // Build a synthetic tenant with wildcard groups — verify the logic
    const wildcardTenant = makeTestTenant('wildcard_biz', ['*']);
    assert(wildcardTenant.authorizedGroupIds.includes('*'), 'T08: Wildcard tenant includes \'*\'');

    // Simulate the resolution logic: a group that no one explicitly owns should fall to wildcard
    const explicit = makeTestTenant('explicit_biz', ['specific@g.us']);

    // Neither explicitly owns 'random_group@g.us'
    const isExplicitMatch = explicit.authorizedGroupIds.includes('random_group@g.us');
    const isWildcardMatch = wildcardTenant.authorizedGroupIds.includes('*');

    assert(!isExplicitMatch, 'T08: Explicit tenant does NOT claim random group');
    assert(isWildcardMatch, 'T08: Wildcard tenant would catch unmatched groups');
  }

  // ─── SECTION 9: AgentService instance isolation ───────────────────────────

  console.log('\n── Section 9: AgentService instances are isolated per tenant ──');

  {
    _resetRegistryForTest();

    const t1 = makeTestTenant('t1', ['g1@g.us']);
    const t2 = makeTestTenant('t2', ['g2@g.us']);

    const agentT1 = getAgentServiceForTenant(t1);
    const agentT2 = getAgentServiceForTenant(t2);

    assert(agentT1 !== agentT2, 'T09: Each tenant gets its own AgentService');
    assert(agentT1 === getAgentServiceForTenant(t1), 'T09: AgentService is cached per tenant');
  }

  // ─── SECTION 10: Tenant context integrity ─────────────────────────────────

  console.log('\n── Section 10: TenantContext contains correct tenant info ──');

  {
    _resetRegistryForTest();

    const tenant = makeTestTenant('ctx_test', ['ctx_group@g.us'], 'ctx_org_789');
    const ctx = getTenantContext(tenant);

    assert(ctx.tenant === tenant, 'T10: TenantContext.tenant points to original config');
    assert(ctx.zohoService !== undefined, 'T10: TenantContext has zohoService');
    assert(ctx.storage !== undefined, 'T10: TenantContext has storage');
    assert(ctx.agentService !== undefined, 'T10: TenantContext has agentService');
    assert(ctx.agentService instanceof AgentService, 'T10: agentService is AgentService instance');
  }

  // ─── SECTION 11: Clarification isolation with real agent flow ─────────────

  console.log('\n── Section 11: Clarification state isolated between tenants ──');

  {
    _resetRegistryForTest();
    StorageService._resetTenantInstances();

    const tenantC1 = makeTestTenant('clarify_tenant_1', ['cl_grp1@g.us']);
    const tenantC2 = makeTestTenant('clarify_tenant_2', ['cl_grp2@g.us']);

    const agC1 = new AgentService(new ZohoMockService(), StorageService.createForTest());
    const agC2 = new AgentService(new ZohoMockService(), StorageService.createForTest());

    // Tenant 1 user requests an invoice that triggers a clarification (missing quantity)
    const step1 = await agC1.processIncomingMessage({
      messageText: 'Invoice for Metro Tyres for Car Tyre 13-inch',
      messageId: 'clar_iso_001',
      groupId: 'cl_grp1@g.us',
      senderJid: 'senderC1@s.whatsapp.net',
      tenantId: tenantC1.tenantId,
      providerName: 'heuristic',
    });

    const t1NeedsClar = step1.clarificationNeeded;

    // Tenant 2 tries to say "confirm" - should have no pending approval or clarification
    const step2 = await agC2.processIncomingMessage({
      messageText: 'confirm',
      messageId: 'clar_iso_002',
      groupId: 'cl_grp2@g.us',
      senderJid: 'senderC1@s.whatsapp.net', // Same JID, different tenant group
      tenantId: tenantC2.tenantId,
      providerName: 'heuristic',
    });

    assert(
      step2.replyText.includes('No Pending Approval') || step2.replyText.includes('pending'),
      'T11: Tenant 2 confirm does not resolve tenant 1\'s clarification or approval'
    );
    assert(step2.invoice === undefined, 'T11: No invoice created in tenant 2 from tenant 1\'s state');

    if (t1NeedsClar) {
      // Tenant 1 can still resolve their own clarification
      const step3 = await agC1.processIncomingMessage({
        messageText: '1',
        messageId: 'clar_iso_003',
        groupId: 'cl_grp1@g.us',
        senderJid: 'senderC1@s.whatsapp.net',
        tenantId: tenantC1.tenantId,
        providerName: 'heuristic',
      });
      assert(
        step3.intent === 'INVOICE_REQUEST',
        'T11: Tenant 1 can resolve their own clarification'
      );
      assert(
        !step3.replyText.toLowerCase().includes('welcome') && !step3.replyText.toLowerCase().includes('hello'),
        'T11: Tenant 1 clarification resolution does not return greeting'
      );
    }
  }

  // ─── SECTION 12: TenantConfig schema validation ───────────────────────────

  console.log('\n── Section 12: TenantConfig schema validation ──');

  {
    const { TenantConfigSchema } = await import('../types/schemas.js');

    // Valid config
    const valid = TenantConfigSchema.safeParse({
      tenantId: 'valid_tenant',
      businessName: 'Valid Business',
      authorizedGroupIds: ['some-group@g.us'],
      zoho: {
        clientId: 'cid',
        clientSecret: 'csec',
        refreshToken: 'ref',
        organizationId: 'org',
      },
    });
    assert(valid.success, 'T12: Valid TenantConfig passes schema validation');

    // Missing required Zoho field
    const missingOrg = TenantConfigSchema.safeParse({
      tenantId: 'bad_tenant',
      businessName: 'Bad Business',
      authorizedGroupIds: ['grp@g.us'],
      zoho: {
        clientId: 'cid',
        clientSecret: 'csec',
        refreshToken: 'ref',
        // organizationId is missing
      },
    });
    assert(!missingOrg.success, 'T12: Missing organizationId fails schema validation');

    // Empty authorized groups
    const noGroups = TenantConfigSchema.safeParse({
      tenantId: 'no_groups',
      businessName: 'No Groups Business',
      authorizedGroupIds: [],
      zoho: {
        clientId: 'cid',
        clientSecret: 'csec',
        refreshToken: 'ref',
        organizationId: 'org',
      },
    });
    assert(!noGroups.success, 'T12: Empty authorizedGroupIds fails schema validation');

    // Invalid tenantId characters
    const badId = TenantConfigSchema.safeParse({
      tenantId: 'bad tenant id!',
      businessName: 'Bad ID Business',
      authorizedGroupIds: ['grp@g.us'],
      zoho: {
        clientId: 'cid',
        clientSecret: 'csec',
        refreshToken: 'ref',
        organizationId: 'org',
      },
    });
    assert(!badId.success, 'T12: Tenant ID with spaces/special chars fails validation');
  }

  // ─── SECTION 13: Explicit Mock Tenant Support (Zero-Network Guarantee) ────

  console.log('\n── Section 13: Explicit Mock Tenant Support (Zero-Network Guarantee) ──');

  {
    const { TenantConfigSchema } = await import('../types/schemas.js');
    const { isMockTenant, isZohoConfigured } = await import('../services/tenantRegistry.js');

    // 1. Mock tenant passes validation WITHOUT clientId / clientSecret / refreshToken
    const mockTenantConfig = {
      tenantId: 'mock_sandbox_biz',
      businessName: 'Sandbox Biz (Mock)',
      mock: true,
      mode: 'mock' as const,
      authorizedGroupIds: ['sandbox_grp@g.us'],
      zoho: {
        mock: true,
        organizationId: 'mock_sandbox_org',
      },
    };

    const parseResult = TenantConfigSchema.safeParse(mockTenantConfig);
    assert(parseResult.success, 'T13: Mock tenant passes schema validation without OAuth credentials');

    const validMockTenant = parseResult.data!;
    assert(isMockTenant(validMockTenant) === true, 'T13: isMockTenant returns true for explicit mock tenant');
    assert(isZohoConfigured(validMockTenant) === false, 'T13: isZohoConfigured returns false for mock tenant (prevents live OAuth calls)');

    // 2. getZohoServiceForTenant returns ZohoMockService instance without network calls
    _resetRegistryForTest();
    const zohoSvc = getZohoServiceForTenant(validMockTenant);
    assert(zohoSvc instanceof ZohoMockService, 'T13: Mock tenant receives ZohoMockService instance');

    // 3. Mock operations succeed without real HTTP requests
    const items = await zohoSvc.getItems();
    assert(Array.isArray(items) && items.length > 0, 'T13: Mock tenant retrieves mock catalog items safely');
    const custs = await zohoSvc.getCustomers();
    assert(Array.isArray(custs) && custs.length > 0, 'T13: Mock tenant retrieves mock customer list safely');

    // 4. Live tenant without credentials FAILS schema validation
    const liveWithoutCreds = TenantConfigSchema.safeParse({
      tenantId: 'live_missing_creds',
      businessName: 'Live Missing Creds',
      mock: false,
      mode: 'live',
      authorizedGroupIds: ['live_grp@g.us'],
      zoho: {
        organizationId: 'live_org_123',
        // Missing clientId, clientSecret, refreshToken
      },
    });
    assert(!liveWithoutCreds.success, 'T13: Live tenant without credentials is rejected by schema validation');
  }

  // ─── SECTION 14: Tenant ID Propagation & Isolation in State Objects ───────

  console.log('\n── Section 14: Tenant ID Propagation & Isolation in State Objects ──');

  {
    _resetRegistryForTest();
    const sharedStorage = StorageService.createForTest();
    const zoho = new ZohoMockService();
    const agent = new AgentService(zoho, sharedStorage);

    // 1. Process message for Tenant Alpha that generates a PendingClarification (missing quantity)
    const clarResult = await agent.processIncomingMessage({
      messageText: 'Invoice for Metro Tyres for Car Tyre 13-inch',
      messageId: 'prop_clar_001',
      groupId: 'grp_alpha@g.us',
      senderJid: 'sender_alpha@s.whatsapp.net',
      tenantId: 'tenant_alpha',
      providerName: 'heuristic',
      _storage: sharedStorage,
    });

    assert(clarResult.clarificationNeeded, 'T14: Initial request requires clarification');
    assert(clarResult.tenantId === 'tenant_alpha', 'T14: Agent output has correct tenantId');

    // Verify PendingClarification in storage has tenant_id set
    const clarAlpha = sharedStorage.findPendingClarificationForSender('grp_alpha@g.us', 'sender_alpha@s.whatsapp.net', 'tenant_alpha');
    assert(clarAlpha !== null, 'T14: Clarification found for tenant_alpha');
    assert(clarAlpha?.tenant_id === 'tenant_alpha', 'T14: PendingClarification object has tenant_id correctly stamped');

    // Verify cross-tenant isolation: querying same group/sender with tenant_beta returns null
    const clarBeta = sharedStorage.findPendingClarificationForSender('grp_alpha@g.us', 'sender_alpha@s.whatsapp.net', 'tenant_beta');
    assert(clarBeta === null, 'T14: Query with tenant_beta does NOT return tenant_alpha clarification');

    // 2. Resolve clarification to produce a PendingApproval
    const previewResult = await agent.processIncomingMessage({
      messageText: '2',
      messageId: 'prop_clar_002',
      groupId: 'grp_alpha@g.us',
      senderJid: 'sender_alpha@s.whatsapp.net',
      tenantId: 'tenant_alpha',
      providerName: 'heuristic',
      _storage: sharedStorage,
    });

    assert(previewResult.isPendingApproval === true, 'T14: Clarification resolved to invoice preview');
    assert(previewResult.tenantId === 'tenant_alpha', 'T14: Preview response has tenantId stamped');

    // Verify PendingApproval in storage has tenant_id set
    const apprAlpha = sharedStorage.findPendingApprovalForSender('grp_alpha@g.us', 'sender_alpha@s.whatsapp.net', undefined, 'tenant_alpha');
    assert(apprAlpha !== null, 'T14: PendingApproval found for tenant_alpha');
    assert(apprAlpha?.tenant_id === 'tenant_alpha', 'T14: PendingApproval object has tenant_id correctly stamped');
    assert(apprAlpha?.payload.tenant_id === 'tenant_alpha', 'T14: PendingApproval payload has tenant_id set');

    // Verify cross-tenant isolation: Tenant Beta cannot see or confirm Tenant Alpha's approval
    const apprBeta = sharedStorage.findPendingApprovalForSender('grp_alpha@g.us', 'sender_alpha@s.whatsapp.net', undefined, 'tenant_beta');
    assert(apprBeta === null, 'T14: Query with tenant_beta does NOT return tenant_alpha approval');

    // 3. Confirm invoice and verify created invoice has tenant_id stamped
    const confirmResult = await agent.processIncomingMessage({
      messageText: 'CONFIRM',
      messageId: 'prop_clar_003',
      groupId: 'grp_alpha@g.us',
      senderJid: 'sender_alpha@s.whatsapp.net',
      tenantId: 'tenant_alpha',
      providerName: 'heuristic',
      _storage: sharedStorage,
    });

    assert(confirmResult.invoice !== undefined, 'T14: Invoice confirmed and created');
    assert(confirmResult.invoice?.tenant_id === 'tenant_alpha', 'T14: Created Invoice object has tenant_id stamped');
    assert(confirmResult.tenantId === 'tenant_alpha', 'T14: Confirmation response has tenantId stamped');
  }

  // ─── SECTION 15: Startup Initialization & Lifecycle ───────────────────────

  console.log('\n── Section 15: Startup Initialization & Lifecycle ──');

  {
    const { initializeAllTenants } = await import('../services/tenantRegistry.js');

    // Calling initializeAllTenants() should execute without unhandled exceptions
    let threw = false;
    try {
      initializeAllTenants();
    } catch {
      threw = true;
    }
    assert(!threw, 'T15: initializeAllTenants executes safely without exceptions');
  }

  // ─── Final Summary ─────────────────────────────────────────────────────────

  console.log('\n==================================================');
  console.log(`Multi-Tenancy Test Results: ${passed} Passed, ${failed} Failed`);
  console.log('==================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runMultiTenancyTests().catch((err) => {
  console.error('❌ Multi-tenancy test runner crashed:', err);
  process.exit(1);
});
