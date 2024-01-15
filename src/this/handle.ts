// Dynamic Config
import getConfig from "./embeds/dynamic/getConfig";
// Standard Config
import config from "$aero_config";
const { prefix, aeroPrefix, flags, debug } = config;

// Utility
import matchWildcard from "./util/match";
import afterPrefix from "$aero/shared/afterPrefix";
import getRequestUrl from "./util/getRequestUrl";
import redir from "./util/redir";
import headersToObject from "this/util/headersToObject";
import clear from "./cors/clear";
import isHTML from "$aero/shared/isHTML";
import getPassthroughParam from "./util/getPassthroughParam";
import escapeJS from "./util/escapeJS";

// Security
// CORS Emulation
import block from "./cors/test";
import HSTSCacheEmulation from "./cors/HSTSCacheEmulation";
// Integrity check
import integral from "./embeds/integral";
// Cache Emulation
//import CacheManager from "./cors/CacheManager";

// Rewriters
import rewriteReqHeaders from "./rewriters/reqHeaders";
import rewriteRespHeaders from "./rewriters/respHeaders";
import rewriteCacheManifest from "./rewriters/cacheManifest";
import rewriteManifest from "./rewriters/webAppManifest";
import rewriteScript from "$aero/shared/script";

import init from "./handlers/init";
init();

// Not defined by TS. I might have to install the service worker types.
declare var clients;

/**
 * Handles the requests
 * @param - The event
 * @returns  The proxified response
 */
// TODO: Move all the proxy middleware code to a bare mixin
async function handle(event: FetchEvent): Promise<Response> {
	let req = event.request;

	// Dynamic config
	// TODO: Dynamically switch backends
	const { backends /*, wsBackends, wrtcBackends*/ } = getConfig();

	// Construct proxy fetch instance
	// TODO: Try each backend until there is a success
	const bare = new createBareClient(backends[0]);

	const reqUrl = new URL(req.url);

	const params = reqUrl.searchParams;

	// Don't rewrite request for aero's bundles
	// TODO: Instead of this read the paths from the config instead of confining and marking aero code from the prefix. I will soon have the bundles be pointed out in the config just like other interception proxies do.
	if (reqUrl.pathname.startsWith(aeroPrefix))
		// Cached to lower the paint time
		return await fetch(req.url, {
			headers: {
				"cache-control": "private",
			},
		});

	let isMod;
	const isScript = req.destination === "script";
	if (isScript) {
		const isModParam = getPassthroughParam(params, "isMod");
		isMod = isModParam && isModParam === "true";
	}

	let frameSec = getPassthroughParam(params, "frameSec");

	var clientUrl;
	// Get the origin from the user's window
	if (event.clientId !== "") {
		// Get the current window
		const client = await clients.get(event.clientId);

		if (client)
			// Get the url after the prefix
			clientUrl = new URL(afterPrefix(client.url));
	}

	// Determine if the request was made to load the homepage; this is needed so that the proxy will know when to rewrite the html files (for example, you wouldn't want it to rewrite a fetch request)
	const isHomepage =
		req.mode === "navigate" && req.destination === "document";

	// This is used for determining the request url
	const isiFrame = req.destination === "iframe";

	// Parse the request url to get the url to proxy
	const proxyUrl = new URL(
		getRequestUrl(
			reqUrl.origin,
			location.origin,
			clientUrl,
			reqUrl.pathname + reqUrl.search,
			isHomepage,
			isiFrame
		)
	);

	// Ensure the request isn't blocked by CORS
	if (flags.corsEmulation && (await block(proxyUrl.href)))
		return new Response("Blocked by CORS", { status: 500 });

	// Log request
	if (debug.url)
		console.debug(
			req.destination == ""
				? `${req.method} ${proxyUrl.href}`
				: `${req.method} ${proxyUrl.href} (${req.destination})`
		);

	// Rewrite the request headers
	const reqHeaders = headersToObject(req.headers);

	const isNavigate = isHomepage || isiFrame;

	let sec: AeroTypes.Sec;
	if (flags.corsEmulation) {
		if (
			// FIXME: Unknown error on many sites
			proxyUrl.protocol === "http:"
		) {
			const HSTSCacheEmulation = new HSTSCacheEmulation(
				reqHeaders["strict-transport-security"],
				proxyUrl.origin
			);

			if (await HSTSCacheEmulation.redirect()) {
				const redirUrl = proxyUrl;

				redirUrl.protocol = "https:";

				return redir(redirUrl.href);
			}
		}

		sec = {
			clear: reqHeaders["clear-site-data"]
				? JSON.parse(`[${reqHeaders["clear-site-data"]}]`)
				: undefined,
			// TODO: Emulate
			timing: reqHeaders["timing-allow-origin"],
			permsFrame: frameSec?.["perms"],
			perms: reqHeaders["permissions-policy"],
			// These are parsed later in frame.js if needed
			frame: reqHeaders["x-frame-options"],
			// This is only used for getting the frame frameancesors for $aero.frame
			csp: reqHeaders["content-security-policy"],
		};

		//if ("clear" in sec)
		//await clear(sec.clear, await clients.get(event.clientId), proxyUrl);
	}

	// FIXME: Cache mode emulation
	/*
	const cache = new CacheManager(reqHeaders);

	if (cache.mode === "only-if-cached")
		// TODO: Emulate network error
		return new Response("Can't find a cached response", {
			status: 500,
		});
	*/

	// TODO: Import bare type
	let opts: BareFetchInit = {
		method: req.method,
		headers: rewriteReqHeaders(reqHeaders, clientUrl),
	};

	// A request body should not be created under these conditions
	if (!["GET", "HEAD"].includes(req.method)) opts.body = req.body;

	// TODO: In both the request and response middleware pass a second argument called document proxy, which allows the dom to be modified on the fly on any window of choice. This will require the use of back to back messages and the clients api.

	// Make the request to the proxy
	const resp = await bare.fetch(new URL(req.url).href, {
		method: req.method,
		headers: req.headers,
	});

	if (resp instanceof Error)
		return new Response(resp.message, {
			status: 500,
		});


	/*
	const cacheAge = cache.getAge(
		reqHeaders["cache-control"],
		reqHeaders["expires"]
	);

	const cachedResp = await cache.get(reqUrl, cacheAge);
	if (cachedResp) return cachedResp;
	*/

	// Rewrite the response headers
	const rewrittenRespHeaders = rewriteRespHeaders(resp.headers, clientUrl);

	// Overwrite the response headers (they are immutable)
	Object.defineProperty(resp, "headers", {
		value: rewrittenRespHeaders,
		configurable: false,
	});
	
	const type = resp.headers.get("content-type");

	// For modules
	const isModWorker =
		new URLSearchParams(location.search).get("isMod") === "true";

	const html =
		// Not all sites respond with a type
		typeof type === "undefined" || isHTML(type);
	/** @type {string | ReadableStream} */
	let body;
	// Rewrite the body
	// TODO: Pack these injected scripts with Webpack
	if (isNavigate && html) {
		body = await resp.text();

		if (body !== "") {
			let base = /* html */ `
<!DOCTYPE html>
<head>
    <!-- Fix encoding issue -->
    <meta charset="utf-8">
    
    <!-- Favicon -->
    <!--
    Delete favicon if /favicon.ico isn't found
    This is needed because the browser caches the favicon from the previous site
    -->
    <link href="data:image/x-icon;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQEAYAAABPYyMiAAAABmJLR0T///////8JWPfcAAAACXBIWXMAAABIAAAASABGyWs+AAAAF0lEQVRIx2NgGAWjYBSMglEwCkbBSAcACBAAAeaR9cIAAAAASUVORK5CYII=" rel="icon" type="image/x-icon">
    <!-- If not defined already, manually set the favicon -->
    <link href="/favicon.ico" rel="icon" type="image/x-icon">

    <script>
        // Update the service worker
        navigator.serviceWorker
            .register("/sw.js", {
                scope: ${prefix},
                // Don't cache http request
                updateViaCache: "none",
                type: "module",
            })
            // Update service worker
            .then(reg => reg.update())
            .catch(err => console.error);

		if (!window.sec)
			window.sec = {};

        // Aero's global namespace
        var $aero = {
			// Security
			sec:  { ...sec, ...${JSON.stringify(sec)} },
			// This is used to later copy into an iFrame's srcdoc; this is for an edge case
			init: \`_IMPORT_\`,
			afterPrefix: url => url.replace(new RegExp(\`^(\${location.origin}\${${prefix}})\`, "g"), ""),
			afterOrigin: url => url.replace(new RegExp(\`^(\${location.origin})\`, "g"), "")
		};
		delete window.sec;
    </script>
	<script>
		// Sanity check
		if (!("$aero" in window))
			console.warn("Unable to initalize $aero");

		// Protect from overwriting, in case $aero scoping failed
		Object.freeze($aero);
	</script>
</head>
`;
			// Recursion
			body = base.replace(/_IMPORT_/, escapeJS(base)) + body;
		}
	} else if (
		isNavigate &&
		(type.startsWith("text/xml") || type.startsWith("application/xml"))
	) {
		body = await resp.text();

		/* xml */ `
<config>
{
	prefix: ${prefix}
}
</config>
<?xml-stylesheet type="text/xsl" href="/aero/browser/xml/intercept.xsl"?>
${body}
		`;
	} else if (isScript) {
		const script = await resp.text();

		if (flags.corsEmulation) {
			body = rewriteScript(
				script,
				isMod,
				/* js */ `
{
	const bak = decodeURIComponent(escape(atob(\`${escapeJS(script)}\`)));
	${integral(isMod)}
}			
`
			);
		} else body = rewriteScript(script, isMod);
	} else if (req.destination === "manifest") {
		let body = await resp.text();

		// Safari exclusive
		if (flags.legacy && type.includes("text/cache-manifest")) {
			const isFirefox = reqHeaders["user-agent"].includes("Firefox");

			body = rewriteCacheManifest(body, isFirefox);
		} else body = rewriteManifest(body, proxyUrl);
	}
	// NeHSTSCacheEmulation
	else if (flags.workers && req.destination === "worker")
		body = isModWorker
			? /* js */ `
import { proxyLocation } from "${aeroPrefix}worker/worker";
self.location = proxyLocation;
`
			: `
importScripts("${aeroPrefix}worker/worker.js");

${body}
		`;
	else if (flags.workers && req.destination === "sharedworker")
		body = isModWorker
			? /* js */ `
import { proxyLocation } from "${aeroPrefix}worker/worker";
self.location = proxyLocation;
`
			: /* js */ `
importScripts("${aeroPrefix}worker/worker.js");
importScripts("${aeroPrefix}worker/sharedworker.js");
	
${body}
		`;
	// No rewrites are needed; proceed as normal
	else body = resp.body;

	rewriteRespHeaders["x-aero-size-transfer"] = null;
	rewriteRespHeaders["x-aero-size-encbody"] = null;

	// TODO: x-aero-size-transfer
	if (typeof body === "string") {
		rewriteRespHeaders["x-aero-size-body"] = new TextEncoder().encode(
			body
		).length;
		// TODO: Emulate x-aero-size-encbody
	} else if (body instanceof ArrayBuffer) {
		rewriteRespHeaders["x-aero-size-body"] = body.byteLength;
		// TODO: Emulate x-aero-size-encbody
	}

	resp.body = resp.status === 204 ? null : body;

	// Cache the response
	// cache.set(reqUrl.href, resp.clone(), resp.headers.get("vary"));

	// Return the response
	return resp;
}

export default handle;
