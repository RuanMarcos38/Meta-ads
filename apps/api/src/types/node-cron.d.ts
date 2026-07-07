declare module 'node-cron' {
  export type ScheduledTask = {
    start(): void;
    stop(): void;
  };

  export function schedule(expression: string, callback: () => void | Promise<void>): ScheduledTask;
}
