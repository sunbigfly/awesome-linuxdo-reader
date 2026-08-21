import {
	discourseAuthScope,
	type DiscourseAuthScope,
} from '../discourse/identifiers.js';
import type {
	ActionRequest,
} from '../network/domain-request-gateway.js';
import type {
	RequestTransportInput,
} from '../network/coordinated-request-client.js';
import {
	readerBusinessRequestKindForAction,
} from '../network/reader-business-request-policy.js';
import {
	discourseActionTransportDefinition,
	type DiscourseNativeActionPort,
} from './discourse-action-transport.js';
import {
	assertPreparedDiscourseActionPayload,
} from './discourse-action-descriptors.js';

export interface ActionRequestPort {
	mutate<T>(input: ActionRequest<T>): Promise<T>;
}

declare const actionResultType: unique symbol;

export interface ActionMutationDescriptor<T, TPayload = unknown> {
	readonly [actionResultType]?: T;
	readonly operation: string;
	readonly targetType: string;
	readonly targetId: string | number;
	readonly variant?: string;
	readonly payload?: TPayload;
	readonly timeoutMs?: number;
}

export interface ActionRequestAdapterOptions {
	readonly gateway: ActionRequestPort;
	readonly nativeActions: DiscourseNativeActionPort;
	readonly authScope: string;
	readonly signal: AbortSignal;
}

/**
 * Discourse 原生 mutation 的统一窄适配器。
 *
 * feature 只能提交 operation/target/variant/payload；具体 model/service/plugin module 或
 * `discourse/lib/ajax` 绑定来自唯一 catalog。descriptor 不再允许注入 fetch/REST transport，
 * 但调用仍先经过 action identity、gateway、scheduler、permit、timeout 和 no-store contract。
 */
export class ActionRequestAdapter {
	readonly authScope: DiscourseAuthScope;
	readonly #gateway: ActionRequestPort;
	readonly #nativeActions: DiscourseNativeActionPort;
	readonly #signal: AbortSignal;

	constructor(options: ActionRequestAdapterOptions) {
		this.#gateway = options.gateway;
		this.#nativeActions = options.nativeActions;
		this.authScope = discourseAuthScope(options.authScope);
		this.#signal = options.signal;
	}

	execute<T, TPayload = unknown>(
		descriptor: ActionMutationDescriptor<T, TPayload>,
	): Promise<T> {
		const definition = discourseActionTransportDefinition(
			descriptor.operation,
			descriptor.targetType,
		);
		assertPreparedDiscourseActionPayload(
			descriptor.payload,
			definition.operation,
			definition.targetType,
		);
		const input = new URL(
			`discourse-native://action/${encodeURIComponent(definition.operation)}` +
			`?binding=${encodeURIComponent(definition.nativeBinding)}`,
		);
		const business = readerBusinessRequestKindForAction(
			definition.operation,
		);
		return this.#gateway.mutate({
			...(business === undefined ? {} : { business }),
			authScope: this.authScope,
			operation: definition.operation,
			targetType: definition.targetType,
			targetId: descriptor.targetId,
			...(descriptor.variant === undefined ? {} : { variant: descriptor.variant }),
			input,
			method: 'HOST',
			signal: this.#signal,
			...(descriptor.timeoutMs === undefined ? {} : { timeoutMs: descriptor.timeoutMs }),
			transport: (request: RequestTransportInput) =>
				this.#nativeActions.execute<T>({
					definition,
					targetId: descriptor.targetId,
					variant: descriptor.variant ?? null,
					payload: descriptor.payload,
					signal: request.signal,
					attempt: request.attempt,
				}),
		});
	}
}
