declare module '@huddle01/react-native-background-actions' {
  export interface UpdateNotificationOptions {
    taskTitle?: string;
    taskDesc?: string;
  }
  export interface Options {
    taskName: string;
    taskTitle?: string;
    taskDesc?: string;
    taskIcon?: { name: string; type?: string; package?: string };
    color?: string;
    parameters?: Record<string, any>;
    linkingURI?: string;
    progressBar?: { max: number; value: number; indeterminate?: boolean };
    foregroundServiceType?: string;
  }
  const BackgroundService: {
    start(task: (data: any) => Promise<void> | void, options?: Options): Promise<void>;
    stop(): Promise<void>;
    isRunning(): boolean;
    updateNotification(opts: UpdateNotificationOptions): Promise<void>;
  };
  export default BackgroundService;
}
