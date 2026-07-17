import { spawn } from "node:child_process"

const npm = process.platform === "win32" ? "npm.cmd" : "npm"
const processes = [
  spawn(npm, ["run", "preview:relay"], { stdio: "inherit" }),
  spawn(npm, ["run", "dev"], { stdio: "inherit" }),
]

let stopping = false
function stop(exitCode = 0) {
  if (stopping) return
  stopping = true
  for (const child of processes) {
    if (!child.killed) child.kill("SIGTERM")
  }
  process.exitCode = exitCode
}

for (const child of processes) {
  child.on("exit", (code, signal) => {
    if (!stopping) stop(signal ? 1 : (code ?? 1))
  })
  child.on("error", () => stop(1))
}

process.once("SIGINT", () => stop(0))
process.once("SIGTERM", () => stop(0))
