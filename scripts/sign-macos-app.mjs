import path from "node:path";
import process from "node:process";
import { signAsync } from "@electron/osx-sign";

const appPath = process.argv[2] ? path.resolve(process.argv[2]) : null;
const identity = process.env.VYBECLIP_CODESIGN_IDENTITY?.trim();

if (!appPath || !appPath.endsWith(".app")) {
	throw new Error(
		"Usage: VYBECLIP_CODESIGN_IDENTITY=<certificate fingerprint> npm run sign:mac -- <path-to-app>",
	);
}

if (!identity) {
	throw new Error("VYBECLIP_CODESIGN_IDENTITY is required");
}

const mainEntitlements = path.resolve("build/entitlements.mac.plist");
const inheritedEntitlements = path.resolve("build/entitlements.mac.inherit.plist");

await signAsync({
	app: appPath,
	identity,
	identityValidation: false,
	platform: "darwin",
	type: "distribution",
	preAutoEntitlements: false,
	preEmbedProvisioningProfile: false,
	optionsForFile: (filePath) => ({
		entitlements: filePath === appPath ? mainEntitlements : inheritedEntitlements,
		hardenedRuntime: true,
	}),
});

console.log(`Signed ${appPath}`);
