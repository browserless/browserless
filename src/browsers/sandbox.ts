export const SANDBOX_DISABLING_ARGS: readonly string[] = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--no-zygote',
];

export const applySandboxPolicy = (
  args: string[],
  sandbox: boolean,
): string[] =>
  sandbox
    ? args.filter((arg) => {
        // Match Chromium's switch parsing without rewriting retained arguments.
        const flag = arg
          .trim()
          .split('=', 1)[0]
          .replace(/^-(?!-)/, '--');
        const key =
          process.platform === 'win32'
            ? flag.replace(/^\//, '--').toLowerCase()
            : flag;
        return !SANDBOX_DISABLING_ARGS.includes(key);
      })
    : args;
