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
      if (cachedServers && cachedServers.length > 0) {
        console.log('[ICE] ICEServerService: Using cached ICE servers:', cachedServers.length, 'servers');
        // Validate cached servers
        const validCachedServers = this.validateServers(cachedServers);
        if (validCachedServers.length > 0) {
          return validCachedServers;
        }
        console.warn('[ICE] ICEServerService: Cached servers are invalid, fetching fresh ones');
      }

      console.log('[ICE] ICEServerService: Cache miss or invalid, fetching from backend');
      // Fetch from backend with retry logic
      const servers = await this.fetchFromBackendWithRetry(baseUrl);
      
      if (servers && servers.length > 0) {
        // Validate servers before caching
        const validServers = this.validateServers(servers);
        if (validServers.length > 0) {
          // Cache the servers
          await this.cacheServers(validServers);
          console.log('[ICE] ICEServerService: Successfully fetched and cached ICE servers:', validServers.length, 'servers');
          return validServers;
        }
        console.error('[ICE] ICEServerService: All fetched servers are invalid');
      }

      console.error('[ICE] ICEServerService: No valid ICE servers received from backend');
      // Return basic STUN servers as fallback for release builds
      const fallbackServers = this.getFallbackServers();
      console.warn('[ICE] ICEServerService: Using fallback STUN servers for connectivity');
      return fallbackServers;
    } catch (error: any) {
      console.error('[ICE] ICEServerService: Failed to fetch ICE servers:', error);
      // In release builds, don't throw errors - return fallback servers
      const fallbackServers = this.getFallbackServers();
      console.warn('[ICE] ICEServerService: Returning fallback servers due to error:', error?.message || 'Unknown error');
      return fallbackServers;
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
    console.log('[ICE] ICEServerService: Refreshing servers - clearing cache first');
    await this.clearCache();
    const servers = await this.getICEServers(baseUrl);
    console.log('[ICE] ICEServerService: Fresh servers fetched:', servers.length, 'servers');
    return servers;
  }

  // Add retry logic for backend fetching
  private static async fetchFromBackendWithRetry(baseUrl: string, maxRetries = 3): Promise<RTCIceServer[]> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[ICE] ICEServerService: Fetch attempt ${attempt}/${maxRetries}`);
        const servers = await this.fetchFromBackend(baseUrl);
        console.log(`[ICE] ICEServerService: Fetch attempt ${attempt} successful`);
        return servers;
      } catch (error: any) {
        lastError = error;
        console.warn(`[ICE] ICEServerService: Fetch attempt ${attempt} failed:`, error.message);
        
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff, max 5s
          console.log(`[ICE] ICEServerService: Retrying after ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError || new Error('All fetch attempts failed');
  }

  // Validate ICE servers to ensure they're properly formatted
  private static validateServers(servers: RTCIceServer[]): RTCIceServer[] {
    return servers.filter(server => {
      if (!server || typeof server !== 'object') {
        console.warn('[ICE] ICEServerService: Invalid server object:', server);
        return false;
      }
      
      if (!server.urls) {
        console.warn('[ICE] ICEServerService: Server missing urls:', server);
        return false;
      }
      
      // Check if urls is a string or array of strings
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      const validUrls = urls.every(url => {
        if (typeof url !== 'string') return false;
        return url.startsWith('stun:') || url.startsWith('turn:') || url.startsWith('turns:');
      });
      
      if (!validUrls) {
        console.warn('[ICE] ICEServerService: Server has invalid URLs:', server.urls);
        return false;
      }
      
      // For TURN servers, validate credentials
      if (urls.some(url => url.startsWith('turn'))) {
        if (!server.username || !server.credential) {
          console.warn('[ICE] ICEServerService: TURN server missing credentials:', server);
          return false;
        }
      }
      
      return true;
    });
  }

  // Get fallback STUN servers for basic connectivity
  private static getFallbackServers(): RTCIceServer[] {
    return [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ];
  }
}
