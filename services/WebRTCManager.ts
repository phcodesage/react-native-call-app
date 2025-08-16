import { WebRTCService, CallConfig } from './WebRTCService';
import { ICEServerService } from './ICEServerService';

export class WebRTCManager {
  private static instance: WebRTCService | null = null;
  private static config: { apiBaseUrl: string } | null = null;

  static async initialize(config: { apiBaseUrl: string }): Promise<WebRTCService> {
    if (!this.instance) {
      this.config = config;
      
      // Pre-fetch ICE servers to cache them - this is critical for connection
      console.log('WebRTCManager: Pre-fetching ICE servers from:', config.apiBaseUrl);
      const iceServers = await ICEServerService.getICEServers(config.apiBaseUrl);
      console.log('WebRTCManager: Successfully pre-fetched ICE servers:', iceServers.length, 'servers');
      
      // Log server details for debugging
      iceServers.forEach((server, index) => {
        console.log(`WebRTCManager: ICE Server ${index + 1}:`, {
          urls: Array.isArray(server.urls) ? server.urls : [server.urls],
          hasCredentials: !!(server.username && server.credential),
          type: server.urls.toString().includes('turn:') ? 'TURN' : 'STUN',
        });
      });
      
      // Create WebRTCService instance
      this.instance = new WebRTCService({
        apiBaseUrl: config.apiBaseUrl,
        iceServers: [], // Will be fetched dynamically from backend
      });
    }

    return this.instance;
  }

  static getInstance(): WebRTCService | null {
    return this.instance;
  }

  static async refreshICEServers(): Promise<void> {
    if (this.config?.apiBaseUrl) {
      console.log('WebRTCManager: Refreshing ICE servers from backend');
      const servers = await ICEServerService.refreshServers(this.config.apiBaseUrl);
      console.log('WebRTCManager: Refreshed ICE servers:', servers.length, 'servers');
      
      // Log refreshed server details
      servers.forEach((server, index) => {
        console.log(`WebRTCManager: Refreshed ICE Server ${index + 1}:`, {
          urls: Array.isArray(server.urls) ? server.urls : [server.urls],
          hasCredentials: !!(server.username && server.credential),
          type: server.urls.toString().includes('turn:') ? 'TURN' : 'STUN',
        });
      });
    } else {
      throw new Error('WebRTCManager: No API base URL configured for ICE server refresh');
    }
  }

  static reset(): void {
    console.log('WebRTCManager: Resetting WebRTC service');
    if (this.instance) {
      this.instance.endCall();
    }
    this.instance = null;
    this.config = null;
  }
}
