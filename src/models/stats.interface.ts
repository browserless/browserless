interface IBrowserlessStats {
  date: number;
  successful: number;
  error: number;
  queued: number;
  rejected: number;
  memory: number | null;
  cpu: number | null;
  timedout: number;
}
