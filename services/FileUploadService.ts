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

    // Check file size and decide upload method
    if (fileData.size > CHUNK_SIZE) {
      return this.uploadFileChunked(fileData, roomId, username, token, onProgress);
    } else {
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

      const formData = new FormData();
      formData.append('file', {
        uri: fileData.uri,
        name: fileData.name,
        type: fileData.type,
      } as any);
      formData.append('room', roomId);
      formData.append('username', username);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) {
          const progress: UploadProgress = {
            loaded: event.loaded,
            total: event.total,
            percentage: Math.round((event.loaded / event.total) * 100),
          };
          onProgress(progress);
        }
      };

      xhr.onload = () => {
        this.currentUpload = null;
        
        if (xhr.status === 200) {
          try {
            const result = JSON.parse(xhr.responseText);
            if (result.error) {
              reject(new Error(result.error));
            } else {
              resolve(result);
            }
          } catch (error) {
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
          reject(new Error(errorMessage));
        }
      };

      xhr.onerror = () => {
        this.currentUpload = null;
        reject(new Error('Network error'));
      };

      xhr.onabort = () => {
        this.currentUpload = null;
        reject(new Error('Upload cancelled'));
      };

      xhr.open('POST', `${API_BASE_URL}/upload_file`, true);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
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
    
    // Read file as base64 for chunking
    const fileResponse = await fetch(fileData.uri);
    const fileBlob = await fileResponse.blob();
    
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const start = chunkIndex * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, fileData.size);
      const chunk = fileBlob.slice(start, end);
      
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
          }
        }
      );
      
      // If this is the last chunk and upload is complete
      if (result.completed) {
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

      const formData = new FormData();
      formData.append('chunk', chunk as any);
      formData.append('chunkNumber', chunkNumber.toString());
      formData.append('totalChunks', totalChunks.toString());
      formData.append('fileId', fileId);
      formData.append('filename', filename);
      formData.append('room', roomId);
      formData.append('username', username);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) {
          const progress: UploadProgress = {
            loaded: event.loaded,
            total: event.total,
            percentage: Math.round((event.loaded / event.total) * 100),
          };
          onProgress(progress);
        }
      };

      xhr.onload = () => {
        this.currentUpload = null;
        
        if (xhr.status === 200) {
          try {
            const result = JSON.parse(xhr.responseText);
            resolve(result);
          } catch (error) {
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
          reject(new Error(errorMessage));
        }
      };

      xhr.onerror = () => {
        this.currentUpload = null;
        reject(new Error('Network error'));
      };

      xhr.onabort = () => {
        this.currentUpload = null;
        reject(new Error('Upload cancelled'));
      };

      xhr.open('POST', `${API_BASE_URL}/upload_chunk`, true);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.send(formData);
    });
  }

  cancelCurrentUpload(): void {
    if (this.currentUpload) {
      this.currentUpload.abort();
      this.currentUpload = null;
    }
  }

  isUploading(): boolean {
    return this.currentUpload !== null;
  }
}
