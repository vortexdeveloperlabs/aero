import { AeroGelConfig } from "$aero/types";

class AeroGel {
	config: AeroGelConfig;
	constructor(config: AeroGelConfig) {
		this.config = config;
	}
	/** This essentially the rewriter
	 * @param script The script to jail. Before it is jailed the let/const to fake vars RegExp rewriting occurs.
	 * @example TODO: Provide an example
	 */
	jailScript(script: string) {
		// TODO: Implement
		return script;
	}
}
