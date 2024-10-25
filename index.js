import { createError } from "h3";
import {
	createApp,
	createRouter,
	defineEventHandler,
	toNodeListener,
	getValidatedQuery,
} from "h3";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { playAudit } from "playwright-lighthouse";
import { z } from "zod";

const port = process.env.PORT || 3000;
const signature = process.env.APPWRITE_BROWSER_SECRET;
if (!signature) {
	throw new Error("SIGNATURE environment variable is required");
}

const app = createApp({
	onRequest: (event) => {
		const auth = event.headers.get("Authorization");
		const [type, token] = auth.split(" ");
		if (token === null)
			throw createError({
				status: 400,
				statusMessage: "Unauthorized",
				message: "Missing signature",
			});

		if (type !== "Bearer" || token !== signature)
			throw createError({
				status: 401,
				statusMessage: "Unauthorized",
				message: "Invalid signature",
			});
	},
});
const router = createRouter();

console.log("Chromium starting...");
const browser = await chromium.launch({
	args: ["--remote-debugging-port=9222"],
});
console.log("Chromium started!");

app.use(router);

/** @type {import('playwright').BrowserContext} defaultContext */
const defaultContext = {
	viewport: {
		width: 1280,
		height: 720,
	},
};

const screenshotParams = z.object({
	url: z.string().url(),
});
router.get(
	"/screenshot",
	defineEventHandler(async (event) => {
		const query = await getValidatedQuery(event, screenshotParams.parse);
		const context = await browser.newContext(defaultContext);
		const page = await context.newPage();
		await page.goto(query.url);
		const screen = await page.screenshot();
		await context.close();
		return screen;
	}),
);

const lighthouseParams = z.object({
	url: z.string().url(),
	formats: z.array(z.enum(["html", "json"])).default(["json"]),
});
router.get(
	"/lighthouse",
	defineEventHandler(async (event) => {
		const query = await getValidatedQuery(event, lighthouseParams.parse);
		const context = await browser.newContext(defaultContext);
		const page = await context.newPage();
		await page.goto(query.url);
		const results = await playAudit({
			reports: {
				formats: {
					html: true,
				},
			},
			page: page,
			port: 9222,
			thresholds: {
				"best-practices": 0,
				accessibility: 0,
				performance: 0,
				pwa: 0,
				seo: 0,
			},
		});
		await context.close();
		return results;
	}),
);

router.use(
	"/health",
	defineEventHandler(async (event) => {
		return {
			status: browser.isConnected() ? "ok" : "error",
		};
	}),
);

createServer(toNodeListener(app)).listen(port);

console.log(`Server running on port http://0.0.0.0:${port}`);