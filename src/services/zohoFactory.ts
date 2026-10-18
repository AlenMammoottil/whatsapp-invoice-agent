import { IZohoService } from './zohoInterface.js';
import { zohoMockService } from './zohoMockService.js';
import { ZohoRealService } from './zohoRealService.js';

export class ZohoFactory {
  private static liveInstance: ZohoRealService | null = null;

  static isLiveConfigured(): boolean {
    return Boolean(
      process.env['ZOHO_CLIENT_ID'] &&
      process.env['ZOHO_CLIENT_SECRET'] &&
      process.env['ZOHO_REFRESH_TOKEN'] &&
      process.env['ZOHO_ORGANIZATION_ID']
    );
  }

  static getService(): IZohoService {
    if (this.isLiveConfigured()) {
      if (!this.liveInstance) {
        console.log('🔗 [Zoho] Real Zoho Books API credentials detected. Initializing ZohoRealService.');
        this.liveInstance = new ZohoRealService();
      }
      return this.liveInstance;
    }

    return zohoMockService;
  }
}

export const activeZohoService = ZohoFactory.getService();
