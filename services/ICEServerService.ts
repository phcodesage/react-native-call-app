import AsyncStorage from '@react-native-async-storage/async-storage';
import { RTCIceServer } from './WebRTCService';

export interface ICEServerResponse {
  iceServers: {
    credential: string;
    urls: string[];
    username: string;
  };
}

export class ICEServerService {
  private static readonly CACHE_KEY = 'cached_ice_servers';
  private static readonly CACHE_EXPIRY_KEY = 'ice_servers_expiry';
  private static readonly CACHE_DURATION = 12 * 60 * 60 * 1000; // 12 hours

  // No fallback servers - force backend usage
  private static readonly FALLBACK_SERVERS: RTCIceServer[] = [];

  static async getICEServers(baseUrl: string): Promise<RTCIceServer[]> {
    try {
      // Check cache first
      const cachedServers = await this.getCachedServers();
      if (cachedServers) {
        console.log('ICEServerService: Using cached ICE servers:', cachedServers.length, 'servers');
        return cachedServers;
      }

      console.log('ICEServerService: Cache miss, fetching from backend');
      // Fetch from backend
      const servers = await this.fetchFromBackend(baseUrl);
      
      if (servers && servers.length > 0) {
        // Cache the servers
        await this.cacheServers(servers);
        console.log('ICEServerService: Successfully fetched and cached ICE servers:', servers.length, 'servers');
        return servers;
      }

      throw new Error('No ICE servers received from backend');
    } catch (error: any) {
      console.error('ICEServerService: Failed to fetch ICE servers:', error);
      throw new Error(`ICE server fetch failed: ${error?.message || 'Unknown error'}`);
    }
  }

  private static async fetchFromBackend(baseUrl: string): Promise<RTCIceServer[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

    const url = `${baseUrl}/get-ice-servers`;
    console.log('ICEServerService: Fetching from URL:', url);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      console.log('ICEServerService: Response status:', response.status, response.statusText);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: ICEServerResponse = await response.json();
      console.log('ICEServerService: Backend response:', JSON.stringify(data, null, 2));

      if (!data.iceServers) {
        throw new Error('No iceServers in response');
      }

      const { iceServers } = data;

      // Convert single server object to RTCIceServer array format
      const rtcIceServers: RTCIceServer[] = [
        {
          urls: iceServers.urls,
          username: iceServers.username,
          credential: iceServers.credential,
        }
      ];

      console.log('ICEServerService: Converted to RTCIceServer format:', JSON.stringify(rtcIceServers, null, 2));
      
      // Validate the converted servers
      const validServers = rtcIceServers.filter(server => 
        server && server.urls && (typeof server.urls === 'string' || Array.isArray(server.urls))
      );

      if (validServers.length === 0) {
        throw new Error('No valid ICE servers after conversion');
      }

      console.log('ICEServerService: Successfully processed', validServers.length, 'valid servers');
      return validServers;
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('Request timeout - backend took too long to respond');
      }
      throw error;
    }
  }

  private static async getCachedServers(): Promise<RTCIceServer[] | null> {
    try {
      const [cachedServers, expiryTime] = await Promise.all([
        AsyncStorage.getItem(this.CACHE_KEY),
        AsyncStorage.getItem(this.CACHE_EXPIRY_KEY),
      ]);

      if (!cachedServers || !expiryTime) {
        console.log('ICEServerService: No cached servers found');
        return null;
      }

      const expiry = parseInt(expiryTime, 10);
      if (Date.now() > expiry) {
        console.log('ICEServerService: Cache expired, clearing');
        await this.clearCache();
        return null;
      }

      const servers = JSON.parse(cachedServers);
      console.log('ICEServerService: Found valid cached servers:', servers.length, 'servers');
      return servers;
    } catch (error: any) {
      console.error('ICEServerService: Error reading cache:', error);
      return null;
    }
  }

  private static async cacheServers(servers: RTCIceServer[]): Promise<void> {
    try {
      const expiry = Date.now() + this.CACHE_DURATION;
      await Promise.all([
        AsyncStorage.setItem(this.CACHE_KEY, JSON.stringify(servers)),
        AsyncStorage.setItem(this.CACHE_EXPIRY_KEY, expiry.toString()),
      ]);
      console.log('ICEServerService: Servers cached successfully, expires at:', new Date(expiry).toISOString());
    } catch (error: any) {
      console.error('ICEServerService: Error caching servers:', error);
    }
  }

  private static async clearCache(): Promise<void> {
    try {
      await Promise.all([
        AsyncStorage.removeItem(this.CACHE_KEY),
        AsyncStorage.removeItem(this.CACHE_EXPIRY_KEY),
      ]);
      console.log('ICEServerService: Cache cleared');
    } catch (error: any) {
      console.error('ICEServerService: Error clearing cache:', error);
    }
  }

  static async refreshServers(baseUrl: string): Promise<RTCIceServer[]> {
    console.log('ICEServerService: Refreshing servers - clearing cache first');
    await this.clearCache();
    const servers = await this.getICEServers(baseUrl);
    console.log('ICEServerService: Fresh servers fetched:', servers.length, 'servers');
    return servers;
  }
}
