interface IBrowserlessStats {
  date: number | null;
  successful: number;
  error: number;
  queued: number;
  rejected: number;
  memory: number;
  cpu: number;
  timedout: number;
};
