import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = {
	...process.env,
	RECORDLY_EXPERIMENTAL_NVIDIA_CUDA_EXPORT: "1",
	RECORDLY_NATIVE_EXPORT_DIAGNOSTICS: process.env.RECORDLY_NATIVE_EXPORT_DIAGNOSTICS ?? "always",
	RECORDLY_NVIDIA_CUDA_EXPORT_DIAGNOSTICS: "1",
	RECORDLY_NVIDIA_CUDA_EXPORT_HIGH_PRIORITY: "1",
	RECORDLY_NVIDIA_CUDA_FORCE_VIDEO_ONLY: "1",
	RECORDLY_NVIDIA_CUDA_SAMPLE_GPU: "1",
};

delete env.RECORDLY_NVIDIA_CUDA_ALLOW_AUDIO_EXPORT;

const diagnosticsHint =
	process.platform === "win32" && process.env.APPDATA
		? path.join(process.env.APPDATA, "Recordly-dev", "native-export-diagnostics")
		: "the Recordly-dev native-export-diagnostics userData folder";

console.log("Starting Recordly dev with guarded NVIDIA CUDA/NVENC export enabled.");
console.log("CUDA mode: video-only native render, then shared app audio mux.");
console.log(`Diagnostics: ${diagnosticsHint}`);

const child =
	process.platform === "win32"
		? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm run dev"], {
				cwd: repoRoot,
				env,
				stdio: "inherit",
			})
		: spawn("npm", ["run", "dev"], {
				cwd: repoRoot,
				env,
				stdio: "inherit",
			});

child.on("exit", (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal);
		return;
	}
	process.exit(code ?? 0);
});

child.on("error", (error) => {
	console.error("Failed to launch Recordly dev:", error);
	process.exit(1);
});
