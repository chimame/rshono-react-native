import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
export const root = fileURLToPath(new URL("../", import.meta.url));
export function run(
  command: string,
  args: string[],
  cwd = root,
  env: NodeJS.ProcessEnv = process.env,
) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")}: exit ${result.status}`);
}
export function pnpm(args: string[], env: NodeJS.ProcessEnv = process.env) {
  run("corepack", ["pnpm", ...args], root, env);
}
