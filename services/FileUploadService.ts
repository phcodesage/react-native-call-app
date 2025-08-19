import { ENV } from '../config/env';

const API_BASE_URL = ENV.API_BASE_URL;
const CHUNK_SIZE = 50 * 1024 * 1024; // 50MB chunks

export interface FileUploadResult {
  file_id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  file_url: string;
  message_id?: number;
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

export class FileUploadService {
  private static instance: FileUploadService;
  private currentUpload: XMLHttpRequest | null = null;

  static getInstance(): FileUploadService {
    if (!FileUploadService.instance) {
      FileUploadService.instance = new FileUploadService();
    }
    return FileUploadService.instance;
  }

  async uploadFile(
    fileData: {
      uri: string;
      name: string;
      type: string;
      size: number;
    },
    roomId: string,
    username: string,
    token: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<FileUploadResult> {
    // Cancel any existing upload
    this.cancelCurrentUpload();
    console.log('[UploadSvc] uploadFile called', {
      roomId,
      username,
      file: { name: fileData.name, type: fileData.type, size: fileData.size, uri: fileData.uri?.slice(0, 60) + '...' }
    });

    // Check file size and decide upload method
    if (fileData.size > CHUNK_SIZE) {
      console.log('[UploadSvc] using chunked upload. size > CHUNK_SIZE', { size: fileData.size, CHUNK_SIZE });
      return this.uploadFileChunked(fileData, roomId, username, token, onProgress);
    } else {
      console.log('[UploadSvc] using regular upload. size <= CHUNK_SIZE', { size: fileData.size, CHUNK_SIZE });
      return this.uploadFileRegular(fileData, roomId, username, token, onProgress);
    }
  }

  private async uploadFileRegular(
    fileData: {
      uri: string;
      name: string;
      type: string;
      size: number;
    },
    roomId: string,
    username: string,
    token: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<FileUploadResult> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      this.currentUpload = xhr;
      console.log('[UploadSvc][regular] init XMLHttpRequest');

      const formData = new FormData();
      formData.append('file', {
        uri: fileData.uri,
        name: fileData.name,
        type: fileData.type,
      } as any);
      formData.append('room', roomId);
      formData.append('username', username);
      console.log('[UploadSvc][regular] formData prepared', {
        file: { name: fileData.name, type: fileData.type, size: fileData.size }, roomId, username
      });

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) {
          const progress: UploadProgress = {
            loaded: event.loaded,
            total: event.total,
            percentage: Math.round((event.loaded / event.total) * 100),
          };
          onProgress(progress);
          if (progress.percentage % 10 === 0) {
            console.log('[UploadSvc][regular] progress', progress);
          }
        }
      };

      xhr.onload = () => {
        this.currentUpload = null;
        console.log('[UploadSvc][regular] onload status', xhr.status);
        const respText = (xhr.responseText || '').slice(0, 500);
        if (respText) console.log('[UploadSvc][regular] response (truncated):', respText);

        if (xhr.status === 200) {
          try {
            const result = JSON.parse(xhr.responseText);
            if (result.error) {
              console.warn('[UploadSvc][regular] server error field:', result.error);
              reject(new Error(result.error));
            } else {
              console.log('[UploadSvc][regular] success result:', result);
              resolve(result);
            }
          } catch (error) {
            console.warn('[UploadSvc][regular] JSON parse error');
            reject(new Error('Invalid server response'));
          }
        } else {
          let errorMessage = 'Upload failed';
          if (xhr.status === 413) {
            errorMessage = 'File too large (max 50MB allowed)';
          } else if (xhr.status === 415) {
            errorMessage = 'File type not supported';
          } else if (xhr.status === 401) {
            errorMessage = 'Authentication required';
          } else {
            errorMessage = `Server error (${xhr.status})`;
          }
          console.warn('[UploadSvc][regular] failure:', { status: xhr.status, errorMessage });
          reject(new Error(errorMessage));
        }
      };

      xhr.onerror = () => {
        this.currentUpload = null;
        console.warn('[UploadSvc][regular] onerror');
        reject(new Error('Network error'));
      };

      xhr.onabort = () => {
        this.currentUpload = null;
        console.warn('[UploadSvc][regular] onabort');
        reject(new Error('Upload cancelled'));
      };

      xhr.open('POST', `${API_BASE_URL}/upload_file`, true);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      console.log('[UploadSvc][regular] sending to', `${API_BASE_URL}/upload_file`);
      xhr.send(formData);
    });
  }

  private async uploadFileChunked(
    fileData: {
      uri: string;
      name: string;
      type: string;
      size: number;
    },
    roomId: string,
    username: string,
    token: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<FileUploadResult> {
    const totalChunks = Math.ceil(fileData.size / CHUNK_SIZE);
    const fileId = `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.log('[UploadSvc][chunked] start', { totalChunks, fileId, size: fileData.size, name: fileData.name });

    // Read file as base64 for chunking
    console.log('[UploadSvc][chunked] fetching file blob from uri');
    const fileResponse = await fetch(fileData.uri);
    const fileBlob = await fileResponse.blob();
    console.log('[UploadSvc][chunked] got blob', { blobSize: fileBlob.size });

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const start = chunkIndex * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, fileData.size);
      const chunk = fileBlob.slice(start, end);
      console.log('[UploadSvc][chunked] uploading chunk', { chunkIndex, start, end, chunkSize: chunk.size });

      const result = await this.uploadChunk(
        chunk,
        chunkIndex,
        totalChunks,
        fileId,
        fileData.name,
        roomId,
        username,
        token,
        (chunkProgress) => {
          if (onProgress) {
            const overallProgress: UploadProgress = {
              loaded: (chunkIndex * CHUNK_SIZE) + chunkProgress.loaded,
              total: fileData.size,
              percentage: Math.round(((chunkIndex * CHUNK_SIZE) + chunkProgress.loaded) / fileData.size * 100),
            };
            onProgress(overallProgress);
            if (overallProgress.percentage % 10 === 0) {
              console.log('[UploadSvc][chunked] overall progress', overallProgress);
            }
          }
        }
      );

      // If this is the last chunk and upload is complete
      if (result.completed) {
        console.log('[UploadSvc][chunked] completed', result);
        return result;
      }
    }

    throw new Error('Chunked upload failed');
  }

  private async uploadChunk(
    chunk: Blob,
    chunkNumber: number,
    totalChunks: number,
    fileId: string,
    filename: string,
    roomId: string,
    username: string,
    token: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      this.currentUpload = xhr;
      console.log('[UploadSvc][chunk] init', { chunkNumber, totalChunks, size: chunk.size });

      const formData = new FormData();
      formData.append('chunk', chunk as any);
      formData.append('chunkNumber', chunkNumber.toString());
      formData.append('totalChunks', totalChunks.toString());
      formData.append('fileId', fileId);
      formData.append('filename', filename);
      formData.append('room', roomId);
      formData.append('username', username);
      console.log('[UploadSvc][chunk] formData ready');

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) {
          const progress: UploadProgress = {
            loaded: event.loaded,
            total: event.total,
            percentage: Math.round((event.loaded / event.total) * 100),
          };
          onProgress(progress);
          if (progress.percentage % 10 === 0) {
            console.log('[UploadSvc][chunk] progress', { chunkNumber, progress });
          }
        }
      };

      xhr.onload = () => {
        this.currentUpload = null;
        console.log('[UploadSvc][chunk] onload status', xhr.status, { chunkNumber });
        const respText = (xhr.responseText || '').slice(0, 500);
        if (respText) console.log('[UploadSvc][chunk] response (truncated):', respText);

        if (xhr.status === 200) {
          try {
            const result = JSON.parse(xhr.responseText);
            console.log('[UploadSvc][chunk] success', { chunkNumber });
            resolve(result);
          } catch (error) {
            console.warn('[UploadSvc][chunk] JSON parse error');
            reject(new Error('Invalid server response'));
          }
        } else {
          let errorMessage = 'Chunk upload failed';
          if (xhr.status === 413) {
            errorMessage = 'Chunk too large';
          } else if (xhr.status === 415) {
            errorMessage = 'File type not supported';
          } else if (xhr.status === 401) {
            errorMessage = 'Authentication required';
          } else {
            errorMessage = `Server error (${xhr.status})`;
          }
          console.warn('[UploadSvc][chunk] failure', { status: xhr.status, chunkNumber, errorMessage });
          reject(new Error(errorMessage));
        }
      };

      xhr.onerror = () => {
        this.currentUpload = null;
        console.warn('[UploadSvc][chunk] onerror', { chunkNumber });
        reject(new Error('Network error'));
      };

      xhr.onabort = () => {
        this.currentUpload = null;
        console.warn('[UploadSvc][chunk] onabort', { chunkNumber });
        reject(new Error('Upload cancelled'));
      };

      xhr.open('POST', `${API_BASE_URL}/upload_chunk`, true);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      console.log('[UploadSvc][chunk] sending to', `${API_BASE_URL}/upload_chunk`);
      xhr.send(formData);
    });
  }

  cancelCurrentUpload(): void {
    if (this.currentUpload) {
      this.currentUpload.abort();
      this.currentUpload = null;
      console.log('[UploadSvc] cancelCurrentUpload called');
    }
  }

  isUploading(): boolean {
    return this.currentUpload !== null;
  }
}
