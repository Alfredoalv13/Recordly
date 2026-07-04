import fs from "node:fs/promises";
import path from "node:path";
import type { SaveDialogOptions } from "electron";
import { app, BrowserWindow, dialog, ipcMain } from "electron";

/**
 * Standalone FCPXML export: the renderer builds the full XML document
 * (buildFcpxml, in src/lib/exporter/fcpxml) from the in-memory project
 * state, and this handler just prompts for a save location and writes it.
 * Deliberately independent of the MP4/GIF export pipeline in export.ts.
 */
export function registerExportFcpxmlHandlers() {
	ipcMain.handle(
		"save-fcpxml-export",
		async (event, xmlContent: string, suggestedFileNameBase: string) => {
			try {
				if (typeof xmlContent !== "string" || xmlContent.trim().length === 0) {
					return {
						success: false,
						message: "Nothing to export",
					};
				}

				const safeNameBase =
					typeof suggestedFileNameBase === "string" &&
					suggestedFileNameBase.trim().length > 0
						? suggestedFileNameBase.trim()
						: "project";

				const parentWindow = BrowserWindow.fromWebContents(event.sender);
				const saveDialogOptions: SaveDialogOptions = {
					title: "Export FCPXML",
					defaultPath: path.join(app.getPath("downloads"), `${safeNameBase}.fcpxml`),
					filters: [{ name: "Final Cut Pro XML", extensions: ["fcpxml"] }],
					properties: ["createDirectory", "showOverwriteConfirmation"],
				};

				const result = parentWindow
					? await dialog.showSaveDialog(parentWindow, saveDialogOptions)
					: await dialog.showSaveDialog(saveDialogOptions);

				if (result.canceled || !result.filePath) {
					return {
						success: false,
						canceled: true,
						message: "FCPXML export canceled",
					};
				}

				await fs.writeFile(result.filePath, xmlContent, "utf-8");

				return {
					success: true,
					path: result.filePath,
					message: "FCPXML exported successfully",
				};
			} catch (error) {
				console.error("Failed to save FCPXML export:", error);
				return {
					success: false,
					message: "Failed to save FCPXML export",
					error: String(error),
				};
			}
		},
	);
}
