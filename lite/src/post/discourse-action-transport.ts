import catalogSource from '../../contracts/discourse-action-transports.json';
import type { DiscourseHostApiPort } from '../discourse/native-host-api.js';
import type {
	DiscourseComposerHostIsolation,
} from '../discourse/native-composer.js';
import {
	BrowserDiscourseNativeAjaxPort,
	discourseNativeFailureResponse,
} from '../network/discourse-native-read-transport.js';
import type {
	RequestTransportResponse,
} from '../network/coordinated-request-client.js';

export type DiscourseNativeActionKind =
	| 'model-method'
	| 'model-static'
	| 'service-method'
	| 'module-function'
	| 'native-ajax';

export type DiscourseActionResultOwner =
	| 'post'
	| 'topic'
	| 'user'
	| 'subject'
	| 'composer'
	| 'notification'
	| 'bookmark-collection';

export interface DiscourseActionTransportDefinition {
	readonly operation: string;
	readonly targetType: string;
	readonly resultKind: string;
	readonly nativeKind: DiscourseNativeActionKind;
	readonly nativeBinding: string;
}

export interface DiscourseActionCallSiteContract
	extends DiscourseActionTransportDefinition {
	readonly line: number;
	readonly variantSource: string | null;
}

export interface DiscourseNativeActionExecution {
	readonly definition: DiscourseActionTransportDefinition;
	readonly targetId: string | number;
	readonly variant: string | null;
	readonly payload: unknown;
	readonly signal: AbortSignal;
	readonly attempt: number;
}

export interface DiscourseNativeActionPayload {
	readonly context?: Readonly<Record<string, unknown>>;
	readonly args?: readonly unknown[];
	readonly nativeMethod?: string;
	readonly result?: DiscourseNativeResultSelection;
	readonly eventCapture?: DiscourseNativeEventCapture;
}

export interface DiscourseNativeResultSelection {
	readonly source: 'return' | 'context' | 'argument' | 'constant' | 'event';
	readonly key?: string;
	readonly index?: number;
	readonly value?: unknown;
	readonly transform?:
		| 'like-action'
		| 'bookmark-created'
		| 'unwrap-post'
		| 'unwrap-comment'
		| 'event-attendance';
}

export interface DiscourseNativeEventCapture {
	readonly emitter: object;
	readonly eventName: string;
	readonly owner: unknown;
	readonly resultPath: readonly string[];
	readonly matchPath?: readonly string[];
	readonly matchValue?: unknown;
}

/**
 * Runtime 只实现这个宿主端口：model/service/plugin module/native ajax 的解析都集中在这里。
 *
 * native-ajax 特指 Discourse 自带 `discourse/lib/ajax#ajax`，不得替换成 fetch、GM 请求、
 * 手工 CSRF/header 或用户脚本自建 REST transport。
 */
export interface DiscourseNativeActionPort {
	execute<T>(
		input: DiscourseNativeActionExecution,
	): Promise<RequestTransportResponse<T>>;
}

interface ResolvedNativeAction {
	readonly owner: object;
	readonly method: (...args: readonly unknown[]) => unknown;
}

const NATIVE_KINDS: readonly DiscourseNativeActionKind[] = Object.freeze([
	'model-method',
	'model-static',
	'service-method',
	'module-function',
	'native-ajax',
]);

function nonEmpty(value: unknown, name: string): string {
	const normalized = String(value ?? '').trim();
	if (!normalized) throw new Error(`${name} 不能为空`);
	return normalized;
}

function callSiteContracts(): readonly DiscourseActionCallSiteContract[] {
	if (catalogSource.schemaVersion !== 1) {
		throw new Error('Discourse action transport catalog schema 不受支持');
	}
	const seenLines = new Set<number>();
	return Object.freeze(catalogSource.callSites.map((raw) => {
		const line = Number(raw.line);
		if (!Number.isSafeInteger(line) || line < 1 || seenLines.has(line)) {
			throw new Error(`Discourse action callsite 行号非法或重复：${String(raw.line)}`);
		}
		seenLines.add(line);
		const nativeKind = nonEmpty(raw.native.kind, `action ${line} native kind`);
		if (!NATIVE_KINDS.includes(nativeKind as DiscourseNativeActionKind)) {
			throw new Error(`action ${line} native kind 不受支持：${nativeKind}`);
		}
		return Object.freeze({
			line,
			operation: nonEmpty(raw.operation, `action ${line} operation`),
			targetType: nonEmpty(raw.targetType, `action ${line} targetType`),
			variantSource: raw.variantSource === null
				? null
				: nonEmpty(raw.variantSource, `action ${line} variantSource`),
			resultKind: nonEmpty(raw.resultKind, `action ${line} resultKind`),
			nativeKind: nativeKind as DiscourseNativeActionKind,
			nativeBinding: nonEmpty(raw.native.binding, `action ${line} native binding`),
		});
	}));
}

export const DISCOURSE_ACTION_CALL_SITES = callSiteContracts();

const RESULT_OWNERS: readonly DiscourseActionResultOwner[] = Object.freeze([
	'post',
	'topic',
	'user',
	'subject',
	'composer',
	'notification',
	'bookmark-collection',
]);

function resultOwnerContracts(): Readonly<Record<string, DiscourseActionResultOwner>> {
	const rawOwners = catalogSource.resultOwners as Readonly<Record<string, string>>;
	const callSiteKeys = new Set(DISCOURSE_ACTION_CALL_SITES.map((entry) =>
		`${entry.operation}/${entry.targetType}`));
	const ownerKeys = Object.keys(rawOwners);
	for (const key of callSiteKeys) {
		const owner = String(rawOwners[key] ?? '');
		if (!RESULT_OWNERS.includes(owner as DiscourseActionResultOwner)) {
			throw new Error(`动作 ${key} 缺少合法 result owner`);
		}
	}
	const extras = ownerKeys.filter((key) => !callSiteKeys.has(key));
	if (extras.length) {
		throw new Error(`result owner 存在未登记动作：${extras.join(', ')}`);
	}
	return Object.freeze(
		Object.fromEntries(
			ownerKeys.sort().map((key) => [key, rawOwners[key] as DiscourseActionResultOwner]),
		),
	);
}

export const DISCOURSE_ACTION_RESULT_OWNERS = resultOwnerContracts();

const definitions = new Map<string, DiscourseActionTransportDefinition>();
for (const callSite of DISCOURSE_ACTION_CALL_SITES) {
	const key = `${callSite.operation}\u0000${callSite.targetType}`;
	const current = definitions.get(key);
	const next = Object.freeze({
		operation: callSite.operation,
		targetType: callSite.targetType,
		resultKind: callSite.resultKind,
		nativeKind: callSite.nativeKind,
		nativeBinding: callSite.nativeBinding,
	});
	if (
		current &&
		(
			current.resultKind !== next.resultKind ||
			current.nativeKind !== next.nativeKind ||
			current.nativeBinding !== next.nativeBinding
		)
	) {
		throw new Error(
			`动作 ${callSite.operation}/${callSite.targetType} 存在冲突的原生 transport`,
		);
	}
	definitions.set(key, current ?? next);
}

export function discourseActionTransportDefinition(
	operation: string,
	targetType: string,
): DiscourseActionTransportDefinition {
	const normalizedOperation = nonEmpty(operation, 'action operation');
	const normalizedTargetType = nonEmpty(targetType, 'action targetType');
	const definition = definitions.get(
		`${normalizedOperation}\u0000${normalizedTargetType}`,
	);
	if (!definition) {
		throw new Error(
			`未登记 Discourse 原生动作：${normalizedOperation}/${normalizedTargetType}`,
		);
	}
	return definition;
}

function payloadRecord(value: unknown): DiscourseNativeActionPayload {
	if (value === undefined) return Object.freeze({});
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Discourse 原生 action payload 必须是对象');
	}
	const payload = value as DiscourseNativeActionPayload;
	if (payload.context !== undefined && (
		!payload.context ||
		typeof payload.context !== 'object' ||
		Array.isArray(payload.context)
	)) {
		throw new TypeError('Discourse 原生 action context 必须是对象');
	}
	if (payload.args !== undefined && !Array.isArray(payload.args)) {
		throw new TypeError('Discourse 原生 action args 必须是数组');
	}
	if (payload.result !== undefined && (
		!payload.result ||
		typeof payload.result !== 'object' ||
		!['return', 'context', 'argument', 'constant', 'event']
			.includes(String(payload.result.source)) ||
		(
			payload.result.transform !== undefined &&
			![
				'like-action',
				'bookmark-created',
				'unwrap-post',
				'unwrap-comment',
				'event-attendance',
			]
				.includes(payload.result.transform)
		)
	)) {
		throw new TypeError('Discourse 原生 action result selector 非法');
	}
	if (payload.eventCapture !== undefined && (
		!payload.eventCapture ||
		typeof payload.eventCapture !== 'object' ||
		!Array.isArray(payload.eventCapture.resultPath)
	)) {
		throw new TypeError('Discourse 原生 action event capture 非法');
	}
	return payload;
}

function objectRecord(value: unknown, name: string): Record<string, unknown> {
	if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
		throw new Error(`Discourse 原生绑定未就绪：${name}`);
	}
	return value as Record<string, unknown>;
}

function selectedMethod(path: string, payload: DiscourseNativeActionPayload): string {
	const candidates = path.split('|').map((value) => value.trim()).filter(Boolean);
	if (candidates.length === 1) return candidates[0]!;
	const requested = String(payload.nativeMethod ?? '').trim();
	if (!requested || !candidates.includes(requested)) {
		throw new Error(
			`Discourse 原生绑定 ${path} 需要明确 nativeMethod`,
		);
	}
	return requested;
}

function resolvePath(
	root: unknown,
	rawPath: string,
	payload: DiscourseNativeActionPayload,
	name: string,
): ResolvedNativeAction {
	const segments = rawPath.split('.').map((value) => value.trim()).filter(Boolean);
	if (!segments.length) throw new Error(`Discourse 原生绑定路径为空：${name}`);
	let owner = objectRecord(root, name);
	for (const segment of segments.slice(0, -1)) {
		const direct = owner[segment];
		const getter = owner.get;
		const next = direct === undefined && typeof getter === 'function'
			? getter.call(owner, segment)
			: direct;
		owner = objectRecord(next, `${name}.${segment}`);
	}
	const methodName = selectedMethod(segments.at(-1)!, payload);
	const directMethod = owner[methodName];
	const getter = owner.get;
	const method = directMethod === undefined && typeof getter === 'function'
		? getter.call(owner, methodName)
		: directMethod;
	if (typeof method !== 'function') {
		throw new Error(`Discourse 原生方法未就绪：${name}.${methodName}`);
	}
	return {
		owner,
		method: method as (...args: readonly unknown[]) => unknown,
	};
}

function nativeAjaxAction(
	payload: DiscourseNativeActionPayload,
): {
	readonly path: string;
	readonly method: 'DELETE' | 'POST' | 'PUT';
	readonly data?: Readonly<Record<string, unknown>>;
} {
	const args = payload.args;
	if (!args || args.length !== 2) {
		throw new Error('Discourse native-ajax action 必须提供 path 与 options');
	}
	const path = nonEmpty(args[0], 'Discourse native-ajax path');
	const options = objectRecord(args[1], 'Discourse native-ajax options');
	const extras = Object.keys(options).filter((key) => key !== 'type' && key !== 'data');
	if (extras.length) {
		throw new Error(`Discourse native-ajax options 含未登记字段：${extras.join(', ')}`);
	}
	const method = String(options.type ?? '').toUpperCase();
	if (!['DELETE', 'POST', 'PUT'].includes(method)) {
		throw new Error(`Discourse native-ajax method 不受支持：${method}`);
	}
	const rawData = options.data;
	if (
		rawData !== undefined &&
		(!rawData || typeof rawData !== 'object' || Array.isArray(rawData))
	) {
		throw new TypeError('Discourse native-ajax data 必须是对象');
	}
	return {
		path,
		method: method as 'DELETE' | 'POST' | 'PUT',
		...(rawData === undefined
			? {}
			: { data: rawData as Readonly<Record<string, unknown>> }),
	};
}

function valueAtPath(value: unknown, path: readonly string[]): unknown {
	let current = value;
	for (const segment of path) {
		if (!current || (typeof current !== 'object' && typeof current !== 'function')) {
			return undefined;
		}
		const record = current as Record<string, unknown>;
		const direct = record[segment];
		const getter = record.get;
		current = direct === undefined && typeof getter === 'function'
			? getter.call(current, segment)
			: direct;
	}
	return current;
}

function eventMatch(actual: unknown, expected: unknown): boolean {
	if (Object.is(actual, expected)) return true;
	const actualId = Number(actual);
	const expectedId = Number(expected);
	return Number.isSafeInteger(actualId) &&
		actualId > 0 &&
		Number.isSafeInteger(expectedId) &&
		expectedId > 0 &&
		actualId === expectedId;
}

function eventCapturePort(
	capture: DiscourseNativeEventCapture | undefined,
): {
	readonly result: () => unknown;
	readonly cleanup: () => void;
} | null {
	if (!capture) return null;
	const emitter = objectRecord(capture.emitter, 'eventCapture.emitter');
	const on = emitter.on;
	const off = emitter.off;
	const eventName = nonEmpty(capture.eventName, 'eventCapture.eventName');
	if (typeof on !== 'function' || typeof off !== 'function') {
		throw new Error('Discourse 原生 event capture 缺少 on/off');
	}
	let captured: unknown;
	const listener = (event: unknown): void => {
		if (
			capture.matchPath &&
			!eventMatch(valueAtPath(event, capture.matchPath), capture.matchValue)
		) {
			return;
		}
		captured = valueAtPath(event, capture.resultPath);
	};
	on.call(emitter, eventName, capture.owner, listener);
	let active = true;
	return {
		result: () => captured,
		cleanup: () => {
			if (!active) return;
			active = false;
			off.call(emitter, eventName, capture.owner, listener);
		},
	};
}

function selectedResult(
	payload: DiscourseNativeActionPayload,
	returned: unknown,
	captured: unknown,
): unknown {
	const selection = payload.result;
	let selected: unknown;
	if (!selection || selection.source === 'return') selected = returned;
	else if (selection.source === 'constant') selected = selection.value;
	else if (selection.source === 'context') {
		const key = nonEmpty(selection.key, 'result context key');
		selected = payload.context?.[key];
	} else if (selection.source === 'argument') {
		const index = Number(selection.index);
		if (!Number.isSafeInteger(index) || index < 0) {
			throw new RangeError('result argument index 非法');
		}
		selected = payload.args?.[index];
	} else {
		if (captured === undefined) {
			throw new Error('Discourse 原生事件未返回权威结果');
		}
		selected = captured;
	}
	if (selection?.transform === 'bookmark-created') {
		const bookmarkId = Number(valueAtPath(selected, ['id']));
		if (!Number.isSafeInteger(bookmarkId) || bookmarkId < 1) {
			throw new Error('Discourse bookmark create 未返回 bookmark ID');
		}
		return Object.freeze({ bookmarked: true, bookmarkId });
	}
	if (selection?.transform === 'like-action') {
		const acted = valueAtPath(selected, ['acted']);
		const count = Number(
			valueAtPath(selected, ['count']) ??
			valueAtPath(payload.context?.post, ['likeAction', 'count']),
		);
		if (typeof acted !== 'boolean' || !Number.isFinite(count) || count < 0) {
			throw new Error('Discourse like toggle 未返回权威 acted/count');
		}
		return Object.freeze({ acted, count: Math.trunc(count) });
	}
	if (selection?.transform === 'unwrap-post') {
		return valueAtPath(selected, ['post']) ?? selected;
	}
	if (selection?.transform === 'unwrap-comment') {
		return valueAtPath(selected, ['comment']) ?? selected;
	}
	if (selection?.transform === 'event-attendance') {
		return Object.freeze({
			watching_invitee:
				valueAtPath(selected, ['watchingInvitee']) ??
				valueAtPath(selected, ['watching_invitee']) ??
				null,
			stats: valueAtPath(selected, ['stats']) ?? null,
		});
	}
	return selected;
}

/**
 * 真正执行宿主原生方法的唯一 runtime adapter。
 *
 * 它只解析 catalog 中的 binding；调用者不能提交 URL transport。即使使用 native-ajax，
 * 也由宿主 `discourse/lib/ajax#ajax` 负责 CSRF、登录态、header 与响应规范化。
 */
export class BrowserDiscourseNativeActionPort implements DiscourseNativeActionPort {
	readonly #host: DiscourseHostApiPort;
	readonly #ajax: BrowserDiscourseNativeAjaxPort;
	readonly #composerIsolation: DiscourseComposerHostIsolation | null;

	constructor(
		host: DiscourseHostApiPort,
		ajax = new BrowserDiscourseNativeAjaxPort(host),
		composerIsolation?: DiscourseComposerHostIsolation,
	) {
		this.#host = host;
		this.#ajax = ajax;
		this.#composerIsolation = composerIsolation ?? null;
	}

	async execute<T>(
		input: DiscourseNativeActionExecution,
	): Promise<RequestTransportResponse<T>> {
		if (input.signal.aborted) throw input.signal.reason;
		const payload = payloadRecord(input.payload);
		const capture = eventCapturePort(payload.eventCapture);
		try {
			let returned: unknown;
			if (input.definition.nativeKind === 'native-ajax') {
				if (input.definition.nativeBinding !== 'discourse/lib/ajax#ajax') {
					throw new Error(
						`Discourse native-ajax binding 不受支持：${input.definition.nativeBinding}`,
					);
				}
				const action = nativeAjaxAction(payload);
				const response = await this.#ajax.request<unknown>({
					path: action.path,
					method: action.method,
					signal: input.signal,
					...(action.data === undefined ? {} : { data: action.data }),
					noStore: true,
				});
				if (!response.ok) return response as RequestTransportResponse<T>;
				returned = response.value;
			} else {
				const resolved = this.#resolve(input.definition, payload);
				const invoke = () => resolved.method.apply(
					resolved.owner,
					payload.args ? [...payload.args] : [],
				);
				returned = this.#composerIsolation &&
					input.definition.nativeBinding === 'service:composer#save'
					? await this.#composerIsolation.runActive(
						input.definition.operation === 'composer-save' &&
							input.variant === 'edit'
							? 'edited'
							: 'created',
						invoke,
					)
					: await invoke();
			}
			if (input.signal.aborted) throw input.signal.reason;
			const value = selectedResult(payload, returned, capture?.result()) as T;
			return { ok: true, status: 200, value };
		} catch (error) {
			if (input.signal.aborted) throw input.signal.reason;
			const failure = discourseNativeFailureResponse<T>(error);
			if (failure) return failure;
			throw error;
		} finally {
			capture?.cleanup();
		}
	}

	#resolve(
		definition: DiscourseActionTransportDefinition,
		payload: DiscourseNativeActionPayload,
	): ResolvedNativeAction {
		if (definition.nativeKind === 'native-ajax') {
			throw new Error('Discourse native-ajax 必须经唯一 ajax port 执行');
		}
		if (definition.nativeKind === 'model-method') {
			const [rootName = '', ...path] = definition.nativeBinding.split('.');
			const context = payload.context ?? {};
			return resolvePath(
				context[rootName],
				path.join('.'),
				payload,
				definition.nativeBinding,
			);
		}
		const separator = definition.nativeBinding.lastIndexOf('#');
		if (separator < 1 || separator === definition.nativeBinding.length - 1) {
			throw new Error(`Discourse 原生模块绑定非法：${definition.nativeBinding}`);
		}
		const ownerName = definition.nativeBinding.slice(0, separator);
		const methodPath = definition.nativeBinding.slice(separator + 1);
		const root = definition.nativeKind === 'service-method'
			? this.#host.lookup(ownerName)
			: this.#host.lookupModule(ownerName);
		return resolvePath(root, methodPath, payload, definition.nativeBinding);
	}
}
