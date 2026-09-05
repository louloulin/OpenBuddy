import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(readFileSync(join(root, "evals", "benchmark-manifest.json"), "utf8"));

function commandAvailable(command) {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [command], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function pythonModuleAvailable(moduleName) {
  try {
    execFileSync("python3", ["-c", `import importlib.util; raise SystemExit(0 if importlib.util.find_spec(${JSON.stringify(moduleName)}) else 1`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function localPathAvailable(paths) {
  return paths.some((path) => existsSync(join(root, path)));
}

const probes = {
  browsergym: { dataset: ["third_party/BrowserGym", "benchmarks/browsergym"], runner: ["browsergym"], environment: ["browsergym"] },
  webarena: { dataset: ["third_party/WebArena", "benchmarks/webarena"], runner: ["webarena"], environment: ["webarena"] },
  osworld: { dataset: ["third_party/OSWorld", "benchmarks/osworld"], runner: ["osworld"], environment: ["osworld"] },
  "swe-bench-verified": { dataset: ["third_party/SWE-bench", "benchmarks/swe-bench"], runner: ["swebench"], environment: ["docker"] },
  "terminal-bench": { dataset: ["third_party/terminal-bench", "benchmarks/terminal-bench"], runner: ["terminal-bench", "harbor"], environment: ["docker"] },
  "mle-bench": { dataset: ["third_party/mle-bench", "benchmarks/mle-bench"], runner: ["mle-bench"], environment: ["docker"] },
  "tau-bench": { dataset: ["third_party/tau-bench", "third_party/tau2-bench", "benchmarks/tau-bench"], runner: ["tau-bench", "tau2"], environment: ["tau_bench", "tau2"] },
  toolsandbox: { dataset: ["third_party/ToolSandbox", "benchmarks/toolsandbox"], runner: ["tool-sandbox"], environment: ["tool_sandbox"] },
  agentdojo: { dataset: ["third_party/AgentDojo", "benchmarks/agentdojo"], runner: ["agentdojo"], environment: ["agentdojo"] },
  bfcl: { dataset: ["third_party/BFCL", "benchmarks/bfcl"], runner: ["bfcl"], environment: ["bfcl"] },
  "inspect-ai": { dataset: ["third_party/inspect-ai", "benchmarks/inspect-ai"], runner: ["inspect"], environment: ["inspect_ai"] },
  deepeval: { dataset: ["third_party/deepeval", "benchmarks/deepeval"], runner: ["deepeval"], environment: ["deepeval"] },
  promptfoo: { dataset: ["third_party/promptfoo", "benchmarks/promptfoo"], runner: ["promptfoo"], environment: ["promptfoo"] },
  langfuse: { dataset: [], runner: [], environment: ["LANGFUSE_HOST"] },
  gaia: { dataset: ["third_party/GAIA", "benchmarks/gaia", "evals/datasets/gaia"], runner: ["gaia"], environment: ["gaia"] },
  "agentbench-toolbench": { dataset: ["third_party/AgentBench", "third_party/ToolBench", "benchmarks/agentbench"], runner: ["agentbench", "toolbench"], environment: ["agentbench", "toolbench"] },
};

function probeOne(benchmark) {
  const probe = probes[benchmark.id];
  if (!probe) return { dataset: false, runner: false, environment: false, officialReady: false, reason: "no official probe declared" };
  const dataset = localPathAvailable(probe.dataset);
  const runner = probe.runner.some(commandAvailable);
  const environment = probe.environment.some((name) => name === "docker" ? commandAvailable("docker") : name === "LANGFUSE_HOST" ? Boolean(process.env.LANGFUSE_HOST) : pythonModuleAvailable(name));
  const officialReady = dataset && runner && environment;
  return { dataset, runner, environment, officialReady, reason: officialReady ? "prerequisites present; official command and scorer still required" : "official dataset, runner, or environment unavailable" };
}

const results = (manifest.benchmarks ?? []).map((benchmark) => ({ id: benchmark.id, name: benchmark.name, manifestStatus: benchmark.status, adapter: benchmark.adapter ?? null, ...probeOne(benchmark) }));
const inconsistent = results.filter((result) => ["passed", "executed"].includes(result.manifestStatus) && !result.officialReady);
console.log(JSON.stringify({
  framework: "openbuddy-official-benchmark-readiness-audit",
  policy: manifest.policy,
  checkedWithoutNetwork: true,
  officialPassesClaimed: results.filter((result) => ["passed", "executed"].includes(result.manifestStatus)).length,
  officialReady: results.filter((result) => result.officialReady).map((result) => result.id),
  adapterOnly: results.filter((result) => result.manifestStatus === "adapter-only").map((result) => result.id),
  notRun: results.filter((result) => ["not-run", "ready-not-run"].includes(result.manifestStatus)).map((result) => result.id),
  inconsistent,
  results,
  ok: inconsistent.length === 0,
}, null, 2));
process.exit(inconsistent.length === 0 ? 0 : 1);
