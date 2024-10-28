/**
 * @module
 * This module contains functions for getting the proxy location from the real location
 */

import getConfig from "$util/getConfig";

import { afterPrefix } from "./getProxyUrl";

import { AeroLogger, AeroSandboxLogger } from "./Loggers";

/**
 * Get the proxy location from the real location
 * @param prefix The proxy prefix of the proxy
 * @param logger The logger to use
 */
export function proxyLocation(prefix: string, logger: AeroSandboxLogger | AeroLogger): URL {
    return new URL(afterPrefix(location.href, prefix, logger));
}
/**
 * TODO: ...(forgot what this does myself);
 * @param prefix The proxy prefix of the proxy
 * @param logger The logger to use
 */
export function upToProxyOrigin(prefix: string, logger: AeroSandboxLogger | AeroLogger): string {
    return prefix + proxyLocation(prefix, logger).origin;
}
