import {
	discourseAuthScope,
	type DiscourseAuthScope,
} from '../discourse/identifiers.js';
import {
	discourseBasePath,
	DiscourseNativeRequests,
} from '../discourse/native-request-descriptors.js';
import type {
	ActionPermissionRequest,
} from '../network/domain-request-gateway.js';
import type {
	DiscourseNativeReadTransport,
} from '../network/discourse-native-read-transport.js';
import { objectRecord as record } from '../kernel/value-record.js';

export interface BoostReportAccess {
	readonly canFlag: boolean;
	readonly alreadyFlagged: boolean;
	readonly availableFlagNames: readonly string[];
	readonly username: string;
}

export interface BoostReportPermissionPort {
	loadActionPermission<T>(input: ActionPermissionRequest<T>): Promise<T>;
}

export interface BoostReportAccessAdapterOptions {
	readonly gateway: BoostReportPermissionPort;
	readonly transport: DiscourseNativeReadTransport;
	readonly authScope: string;
	readonly signal: AbortSignal;
	readonly basePath?: string;
}

/**
 * Boost 举报权限读取的唯一领域适配器。
 *
 * 权限是易变的登录态结果，故每次打开表单都经 action-permission/no-store 进入中央
 * scheduler、permit、timeout 与单飞链；transport 只能使用具名 Discourse 原生 descriptor。
 */
export class BoostReportAccessAdapter {
	readonly authScope: DiscourseAuthScope;
	readonly #gateway: BoostReportPermissionPort;
	readonly #transport: DiscourseNativeReadTransport;
	readonly #signal: AbortSignal;
	readonly #basePath: string;

	constructor(options: BoostReportAccessAdapterOptions) {
		this.#gateway = options.gateway;
		this.#transport = options.transport;
		this.authScope = discourseAuthScope(options.authScope);
		this.#signal = options.signal;
		this.#basePath = discourseBasePath(options.basePath);
	}

	async load(rawBoostId: number): Promise<BoostReportAccess> {
		const descriptor = DiscourseNativeRequests.boostReportAccess({
			basePath: this.#basePath,
			boostId: rawBoostId,
		});
		const payload = await this.#gateway.loadActionPermission<unknown>({
			authScope: this.authScope,
			operation: 'boost-report-access',
			targetType: 'boost',
			targetId: rawBoostId,
			input: descriptor.path,
			method: 'GET',
			signal: this.#signal,
			transport: (input) => this.#transport.request({
				descriptor,
				signal: input.signal,
				attempt: input.attempt,
			}),
		});
		const value = record(payload);
		if (!value) throw new Error('Boost 举报权限响应无效');
		const user = record(value.user);
		const availableFlagNames = Array.isArray(value.available_flags)
			? [...new Set(value.available_flags
				.map((entry) => String(entry ?? '').trim())
				.filter(Boolean))]
			: [];
		return Object.freeze({
			canFlag: value.can_flag === true,
			alreadyFlagged: Boolean(value.user_flag_status),
			availableFlagNames: Object.freeze(availableFlagNames),
			username: String(user?.username ?? '').trim(),
		});
	}
}
