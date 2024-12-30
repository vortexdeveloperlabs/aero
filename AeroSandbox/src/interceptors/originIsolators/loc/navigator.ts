import {
	type APIInterceptor,
	ExposedContextsEnum
} from "$types/apiInterceptors.d.ts";

import rewriteSrc from "$util/src";
import { proxyLocation } from "$util/proxyLocation";
import proto from "$util/proto";

/**
 * The handler for the methods for registering (`navigator.registerProtocolHandler`) and unregistering (`unregisterProtocolHandler`) the protocols where the URL is for the protocol handler
 */
const sharedProtoHandler = {
	apply(target, that, args) {
		const [scheme, url] = args;

		args[0] = proto.set(scheme);
		args[1] = rewriteSrc(url, proxyLocation().href);

		return Reflect.apply(target, that, args);
	},
};
/**
 * The escape fixes for the methods for registering (`navigator.registerProtocolHandler`) and unregistering (`unregisterProtocolHandler`) the protocols where the URL is for the protocol handler
 */
const sharedEscapeFixes = [
	{
		targeting: "param",
		targetingParam: 2,
		escapeType: {
			what: "url",
			escapeType: "full",
		},
	},
];

export default [
	{
		proxyHandlers: {
			apply(target, that, args) {
				const [url] = args;

				args[0] = rewriteSrc(url, proxyLocation().href);

				return Reflect.apply(target, that, args);
			}
		},
		escapeFixes: [
			{
				targeting: "param",
				targetingParam: 1,
				escapeType: {
					what: "url",
					escapeType: "full",
				},
			},
		],
		globalProp: "navigator.prototype.sendBeacon",
		exposedContexts: ExposedContextsEnum.window
	},
	{
		proxyHandlers: sharedProtoHandler,
		escapeFixes: sharedEscapeFixes,
		globalProp: "navigator.prototype.registerProtocolHandler",
		exposedContexts: ExposedContextsEnum.window
	},
	{
		proxyHandlers: sharedProtoHandler,
		escapeFixes: sharedEscapeFixes,
		globalProp: "navigator.prototype.unregisterProtocolHandler",
		exposedContexts: ExposedContextsEnum.window
	},
	{
		proxyHandlers: {
			apply(target, that, args) {
				const [contents] = args;

				badge.i = contents;

				updateCount();
			},
		},
		globalProp: "navigator.prototype.setAppBadge",
		exposedContexts: ExposedContextsEnum.window
	}, {
		proxyHandlers: {
			apply() {
				badge.i = 0;

				updateCount();
			},
		},
		globalProp: "navigator.prototype.clearAppBadge",
		exposedContexts: ExposedContextsEnum.window
	}
] as APIInterceptor[];

/**
 * The key in the local storage for storing the proxified badges
 */
const key = "aero.badges";
/**
 * The raw local storage entry that has the proxified badges (remember you can only store strings in localStorage)
 */
const item = localStorage.getItem(key);
/**
 * The actual parsed array of proxified badges
 */
let badges = item === null ? [] : JSON.parse(item) ?? [];
let badge;
// Get the badges for the current origin
const found = badges.find(
	badge => badge.origin === proxyLocation().origin,
	(_el, i) => {
		badge = badges[i];
	}
);
if (!found) {
	badge = {
		origin: proxyLocation().origin,
		i: 0,
	};

	badges.push(badge);
}

/**
 * The original `navigator.setAppBadge` function before it is overwritten by the API system in aero
 */
const setBak = navigator.setAppBadge;
/**
 * For saving the current count + 1 of a badge into local storage for persistency
 */
function updateCount() {
	badges.find(
		badge => badge.origin === proxyLocation().origin,
		(_el, i) => {
			// Local
			badges[i] = badge;
			// Update
			setBak(getTotal());
			// Save
			localStorage.setItem(key, badge);
		}
	);
}
/**
 * Increment the number of badges by one and get the new total number of badges
 * This is a helper function for `updateCount`
 * @returns The new total number of badges
 */
function getTotal() {
	let i = 0;

	for (const badge of badges) i += badge.i;

	return i;
}