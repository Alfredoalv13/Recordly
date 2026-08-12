import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { sendNativeCaptureCommand } from "./mac";

vi.mock("electron", () => ({
	app: {
		getPath: () => "/tmp/RecordlyTest",
	},
	BrowserWindow: {
		getAllWindows: () => [],
	},
}));

class FakeCaptureProcess extends EventEmitter {
	stdout = new PassThrough();
	stdin = { write: vi.fn() };
}

function createFakeProcess() {
	return new FakeCaptureProcess();
}

describe("sendNativeCaptureCommand", () => {
	it("writes the command to stdin", async () => {
		const proc = createFakeProcess();
		const promise = sendNativeCaptureCommand(
			proc as unknown as ChildProcessWithoutNullStreams,
			"pause",
		);
		expect(proc.stdin.write).toHaveBeenCalledWith("pause\n");
		proc.stdout.emit("data", Buffer.from("Paused\n"));
		await promise;
	});

	it("resolves once the ack marker arrives on stdout", async () => {
		const proc = createFakeProcess();
		const promise = sendNativeCaptureCommand(
			proc as unknown as ChildProcessWithoutNullStreams,
			"resume",
		);
		let resolved = false;
		void promise.then(() => {
			resolved = true;
		});

		proc.stdout.emit("data", Buffer.from("some unrelated output\n"));
		await Promise.resolve();
		expect(resolved).toBe(false);

		proc.stdout.emit("data", Buffer.from("Resumed\n"));
		await promise;
		expect(resolved).toBe(true);
	});

	it("resolves on an ack marker split across multiple stdout chunks", async () => {
		const proc = createFakeProcess();
		const promise = sendNativeCaptureCommand(
			proc as unknown as ChildProcessWithoutNullStreams,
			"pause",
		);
		proc.stdout.emit("data", Buffer.from("Pau"));
		proc.stdout.emit("data", Buffer.from("sed\n"));
		await promise;
	});

	it("falls back to resolving after timeoutMs if no ack ever arrives", async () => {
		vi.useFakeTimers();
		try {
			const proc = createFakeProcess();
			const promise = sendNativeCaptureCommand(
				proc as unknown as ChildProcessWithoutNullStreams,
				"pause",
				50,
			);
			let resolved = false;
			void promise.then(() => {
				resolved = true;
			});

			await vi.advanceTimersByTimeAsync(49);
			expect(resolved).toBe(false);

			await vi.advanceTimersByTimeAsync(1);
			expect(resolved).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it("resolves immediately if the process errors before acking", async () => {
		const proc = createFakeProcess();
		const promise = sendNativeCaptureCommand(
			proc as unknown as ChildProcessWithoutNullStreams,
			"pause",
		);
		proc.emit("error", new Error("boom"));
		await promise;
	});

	it("resolves immediately if the process exits before acking", async () => {
		const proc = createFakeProcess();
		const promise = sendNativeCaptureCommand(
			proc as unknown as ChildProcessWithoutNullStreams,
			"resume",
		);
		proc.emit("exit", 1);
		await promise;
	});

	it("ignores a stale ack for a different command already present before this call", async () => {
		// Regression guard: a fresh listener must not be fooled by output that
		// arrived before it started listening — Node's EventEmitter already
		// guarantees this (no replay), but this pins that expectation for this
		// specific "no local buffer accumulates across calls" usage.
		const proc = createFakeProcess();
		proc.stdout.emit("data", Buffer.from("Paused\n")); // no listener yet — dropped
		vi.useFakeTimers();
		try {
			const promise = sendNativeCaptureCommand(
				proc as unknown as ChildProcessWithoutNullStreams,
				"pause",
				50,
			);
			let resolved = false;
			void promise.then(() => {
				resolved = true;
			});
			await vi.advanceTimersByTimeAsync(50);
			expect(resolved).toBe(true); // resolved via timeout fallback, not a stale match
		} finally {
			vi.useRealTimers();
		}
	});
});
