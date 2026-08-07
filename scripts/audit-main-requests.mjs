import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import traversePackage from '@babel/traverse';

const SOURCE_PATH = 'work/main.js';
const ACTION_CONTRACT_PATH = 'lite/contracts/discourse-action-transports.json';
const DIRECT_SINKS = new Map([
	['fetchJSON', 'cached-json'],
	['apiSend', 'mutation-json'],
	['createBoost', 'host-network'],
	['fetchReaderPublicResource', 'public-resource'],
	['trackedReaderFetch', 'reader-transport'],
	['requestCachedJSON', 'cache-controller'],
	['requestJSON', 'scheduler-transport'],
]);
const DOMAIN_WRAPPER_SINKS = new Map([
	['fetchLoaderJSON', 'loader-json'],
	['fetchNotificationPage', 'notification-page'],
	['fetchReplyPage', 'nested-page'],
	['fetchUserJSON', 'user-json'],
	['translationRequest', 'translation-service'],
]);
const REQUEST_CAPABLE_METHODS = new Map([
	['loadAfterPost', 'loader-api'],
	['loadBeforePost', 'loader-api'],
	['loadDirectReplies', 'nested-api'],
	['loadLastPost', 'loader-api'],
	['loadNextPage', 'nested-api'],
	['loadPost', 'loader-api'],
	['loadPostsByIds', 'loader-api'],
]);
const TARGET_CLASS_OVERRIDES = new Map([
	[275, 'background'],
	[10354, 'visible'],
	[10602, 'visible'],
	[16671, 'visible'],
	[18662, 'critical'],
	[21237, 'visible'],
	[22249, 'prefetch'],
	[33835, 'visible'],
]);
const HOST_NETWORK_CALLS = new Set([
	'CustomReaction.toggle',
	'Topic.update',
	'Bookmark.bulkOperation',
	'action.act',
	'ajaxModule.updateCsrfToken',
	'bookmarkApi.create',
	'bookmarkApi.delete',
	'composer.destroyDraft',
	'composer.save',
	'detailsModel.updateNotifications',
	'eventApi.updateEventAttendance',
	'eventApi.joinEvent',
	'likeAction.togglePromise',
	'postModel.destroy',
	'taskActions.putAssignment',
	'topicModel.deleteBookmarks',
	'userModel.updateNotificationLevel',
	'votingModule.castVote',
	'votingModule.removeVote',
]);
const traverse = traversePackage.default ?? traversePackage;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const actionCatalog = JSON.parse(
	await readFile(path.join(projectRoot, ACTION_CONTRACT_PATH), 'utf8'),
);
if (actionCatalog.schemaVersion !== 1 || !Array.isArray(actionCatalog.callSites)) {
	throw new Error(`${ACTION_CONTRACT_PATH} schema 不受支持`);
}
const ACTION_CALLSITE_CONTRACTS = new Map();
for (const contract of actionCatalog.callSites) {
	const line = Number(contract.line);
	if (!Number.isSafeInteger(line) || line < 1 || ACTION_CALLSITE_CONTRACTS.has(line)) {
		throw new Error(`${ACTION_CONTRACT_PATH} 行号非法或重复：${String(contract.line)}`);
	}
	if (
		!String(contract.operation || '').trim() ||
		!String(contract.targetType || '').trim() ||
		!String(contract.resultKind || '').trim() ||
		!String(contract.native?.kind || '').trim() ||
		!String(contract.native?.binding || '').trim()
	) {
		throw new Error(`${ACTION_CONTRACT_PATH} 行 ${line} contract 不完整`);
	}
	ACTION_CALLSITE_CONTRACTS.set(line, contract);
}
const actionDefinitionKeys = new Set(
	[...ACTION_CALLSITE_CONTRACTS.values()].map((contract) =>
		`${contract.operation}/${contract.targetType}`),
);
const actionResultOwners = actionCatalog.resultOwners;
if (!actionResultOwners || typeof actionResultOwners !== 'object') {
	throw new Error(`${ACTION_CONTRACT_PATH} 缺少 resultOwners`);
}
const resultOwnerKeys = Object.keys(actionResultOwners);
for (const key of actionDefinitionKeys) {
	if (!String(actionResultOwners[key] || '').trim()) {
		throw new Error(`${ACTION_CONTRACT_PATH} 动作 ${key} 缺少 result owner`);
	}
}
const extraResultOwners = resultOwnerKeys.filter((key) => !actionDefinitionKeys.has(key));
if (extraResultOwners.length) {
	throw new Error(
		`${ACTION_CONTRACT_PATH} resultOwners 存在未登记动作：${extraResultOwners.join(', ')}`,
	);
}

function parseArgs(args) {
	if (args.length === 0) return { format: 'markdown' };
	if (args.length === 2 && args[0] === '--format' && ['json', 'markdown'].includes(args[1])) {
		return { format: args[1] };
	}
	throw new Error('仅支持可选参数：--format json|markdown');
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

function functionName(pathValue) {
	const node = pathValue.node;
	if (node.type === 'FunctionDeclaration' && node.id?.name) return node.id.name;
	const parent = pathValue.parentPath?.node;
	if (parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier') {
		return parent.id.name;
	}
	if (
		(parent?.type === 'ObjectProperty' || parent?.type === 'ObjectMethod') &&
		!parent.computed
	) {
		if (parent.key.type === 'Identifier') return parent.key.name;
		if (parent.key.type === 'StringLiteral') return parent.key.value;
	}
	return '<anonymous>';
}

function ownerForCall(callPath) {
	let current = callPath.parentPath;
	while (current) {
		if (current.isFunction()) {
			const name = functionName(current);
			if (name !== '<anonymous>') return name;
		}
		current = current.parentPath;
	}
	return '<runtime-root>';
}

function memberName(node) {
	if (node.type !== 'MemberExpression' && node.type !== 'OptionalMemberExpression') return '';
	if (!node.computed && node.property.type === 'Identifier') return node.property.name;
	if (node.computed && node.property.type === 'StringLiteral') return node.property.value;
	return '';
}

function memberObjectName(node) {
	if (node.type !== 'MemberExpression' && node.type !== 'OptionalMemberExpression') return '';
	if (node.object.type === 'Identifier') return node.object.name;
	if (
		(node.object.type === 'MemberExpression' || node.object.type === 'OptionalMemberExpression') &&
		memberName(node.object)
	) {
		return memberName(node.object);
	}
	return '';
}

function memberChain(node) {
	if (node.type === 'Identifier') return node.name;
	if (node.type !== 'MemberExpression' && node.type !== 'OptionalMemberExpression') return '';
	const object = memberChain(node.object);
	const property = memberName(node);
	return object && property ? `${object}.${property}` : property;
}

function gmAlias(binding) {
	const init = binding?.path?.node?.init;
	return !!(
		init &&
		(init.type === 'MemberExpression' || init.type === 'OptionalMemberExpression') &&
		memberObjectName(init) === 'globalThis' &&
		memberName(init) === 'GM_xmlhttpRequest'
	);
}

function hostNetworkCall(source, node, callee) {
	const objectName = memberObjectName(callee);
	const name = memberName(callee);
	if (HOST_NETWORK_CALLS.has(`${objectName}.${name}`)) return true;
	const expression = sourceForNode(source, node);
	return name === 'delete' && expression.startsWith('discourseBookmarkApi().delete(');
}

function hostNetworkAlias(binding) {
	const init = binding?.path?.node?.init;
	if (
		!init ||
		['ArrowFunctionExpression', 'FunctionExpression'].includes(init.type)
	) {
		return false;
	}
	const visit = (node) => {
		if (!node || typeof node !== 'object') return false;
		if (
			node.type === 'MemberExpression' ||
			node.type === 'OptionalMemberExpression'
		) {
			if (HOST_NETWORK_CALLS.has(`${memberObjectName(node)}.${memberName(node)}`)) {
				return true;
			}
		}
		return Object.entries(node).some(([key, value]) => {
			if (['loc', 'start', 'end', 'extra'].includes(key)) return false;
			if (Array.isArray(value)) return value.some(visit);
			return value && typeof value === 'object' && visit(value);
		});
	};
	return visit(init);
}

function sourceForNode(source, node, maximum = 240) {
	const raw = source.slice(node.start ?? 0, node.end ?? 0).replace(/\s+/g, ' ').trim();
	return raw.length > maximum ? `${raw.slice(0, maximum - 1)}…` : raw;
}

function requestClass(line, owner, expression, sink) {
	const targetOverride = TARGET_CLASS_OVERRIDES.get(line);
	if (targetOverride) return { value: targetOverride, basis: 'manual-callsite-contract' };
	const evidence = `${owner} ${expression}`.toLocaleLowerCase();
	if (
		evidence.includes('post_request_priority.background') ||
		/(background|notificationpage|marknotification|topicpresence|readtiming|prefetchreaderqueue)/.test(evidence)
	) {
		return { value: 'background', basis: 'explicit-priority-or-owner' };
	}
	if (
		sink === 'mutation-json' ||
		sink === 'host-network' ||
		/(oauth|sitebasic|bootstrap|resolveSiteLogo|validateCustomDiscourseSite)/i.test(`${owner} ${expression}`)
	) {
		return { value: 'critical', basis: 'transport-or-owner' };
	}
	if (
		sink === 'nested-api' ||
		evidence.includes('post_request_priority.nested') ||
		/(nested|replypage|directrepl|quotedpost|floorpreview)/.test(evidence)
	) {
		return { value: 'nested', basis: 'explicit-priority-or-owner' };
	}
	if (
		evidence.includes('post_request_priority.auxiliary') ||
		evidence.includes('post_request_priority.usercard') ||
		/(prefetch|publicresource|avatar|emoji|lightbox|usercard|fetchuser|usersummary|userbadge|userdirectory|followlist|connecttrust|linuxdocredit)/.test(evidence)
	) {
		return { value: 'prefetch', basis: 'explicit-priority-or-owner' };
	}
	if (
		evidence.includes('post_request_priority.target') ||
		evidence.includes('post_request_priority.topic') ||
		evidence.includes('post_request_priority.scroll') ||
		evidence.includes('post_request_priority.visible') ||
		/(translation|loader|postvoting|refresh|editcomposer|boostreport|aggregate|returntoreaderquote|jumpto|openmodal)/.test(evidence)
	) {
		return { value: 'visible', basis: 'explicit-priority-or-owner' };
	}
	return { value: 'visible', basis: 'default-needs-call-chain-review' };
}

function contractProfile(call) {
	if (call.layer !== 'business-entry') return null;
	if (call.classification === 'critical') {
		if ([85, 105].includes(call.line)) return 'bootstrap-critical';
		if (call.line === 18662) return 'read-critical';
		return 'action-critical';
	}
	if (call.classification === 'visible') {
		if (call.sink === 'translation-service') return 'translation-visible';
		if (
			call.sink === 'notification-page' ||
			/notification/i.test(`${call.owner} ${call.expression}`)
		) {
			return 'notification-visible';
		}
		return 'topic-visible';
	}
	if (call.classification === 'nested') return 'nested-visible';
	if (call.classification === 'background') return 'background-prefetch';
	if (
		call.sink === 'public-resource' ||
		/(avatar|emoji|image|download)/i.test(`${call.owner} ${call.expression}`)
	) {
		return 'resource-prefetch';
	}
	if (
		call.sink === 'user-json' ||
		/(user|bookmark|givenlike|connecttrust)/i.test(`${call.owner} ${call.expression}`)
	) {
		return 'user-prefetch';
	}
	return 'surface-prefetch';
}

function identityBinding(call) {
	switch (call.contractProfile) {
		case 'bootstrap-critical':
			return { family: 'bootstrap', namespace: 'bootstrap' };
		case 'action-critical':
			return { family: 'action', namespace: 'reader-action' };
		case 'read-critical':
			return { family: 'read', namespace: 'topic-read-state' };
		case 'nested-visible':
			return { family: 'nested', namespace: 'topic-nested' };
		case 'translation-visible':
			return { family: 'translation', namespace: 'translation' };
		case 'notification-visible':
			return { family: 'notification', namespace: 'notifications' };
		case 'user-prefetch':
			return { family: 'user', namespace: 'user-data' };
		case 'resource-prefetch':
			return { family: 'resource', namespace: 'resource' };
		case 'surface-prefetch':
			return { family: 'topic', namespace: 'surface-prefetch' };
		case 'background-prefetch':
			if (call.sink === 'public-resource') {
				return { family: 'resource', namespace: 'resource-background' };
			}
			if (
				call.sink === 'nested-api' ||
				call.sink === 'nested-page' ||
				/directrepl/i.test(call.owner)
			) {
				return { family: 'nested', namespace: 'topic-nested-background' };
			}
			return { family: 'topic', namespace: 'topic-background' };
		case 'topic-visible':
			if (call.sink === 'loader-json' || call.sink === 'loader-api') {
				return { family: 'topic', namespace: 'topic-loader' };
			}
			return { family: 'topic', namespace: 'topic-visible' };
		default:
			return null;
	}
}

const { format } = parseArgs(process.argv.slice(2));
const source = await readFile(path.join(projectRoot, SOURCE_PATH), 'utf8');
const ast = parse(source, {
	allowAwaitOutsideFunction: true,
	sourceType: 'script',
	plugins: ['classProperties', 'classPrivateProperties', 'classPrivateMethods'],
});
const calls = [];

function recordCall(callPath) {
		const callee = callPath.node.callee;
		let sink = '';
		let calleeName = '';
		let layer = 'business-entry';
		if (callee.type === 'Identifier') {
			calleeName = callee.name;
			sink = DIRECT_SINKS.get(calleeName) ?? DOMAIN_WRAPPER_SINKS.get(calleeName) ?? '';
			if (!sink && calleeName === 'fetch' && !callPath.scope.getBinding('fetch')) {
				sink = 'raw-fetch';
			}
			if (!sink && gmAlias(callPath.scope.getBinding(calleeName))) {
				sink = 'gm-cross-origin';
			}
			if (!sink && hostNetworkAlias(callPath.scope.getBinding(calleeName))) {
				sink = 'host-network';
			}
		} else if (
			callee.type === 'MemberExpression' ||
			callee.type === 'OptionalMemberExpression'
		) {
			calleeName = memberName(callee);
			const objectName = memberObjectName(callee);
			const objectChain = memberChain(callee.object);
			if (calleeName === 'fetch' && ['window', 'globalThis'].includes(objectName)) {
				sink = 'raw-fetch';
			} else if (hostNetworkCall(source, callPath.node, callee)) {
				sink = 'host-network';
			} else if (
				REQUEST_CAPABLE_METHODS.has(calleeName) &&
				/(^|\.)(ctx|loader|repliesIO)(\.|$)/.test(objectChain)
			) {
				sink = REQUEST_CAPABLE_METHODS.get(calleeName) ?? '';
			}
		}
		if (!sink) return;
		const owner = ownerForCall(callPath);
		if (
			['reader-transport', 'cache-controller', 'scheduler-transport'].includes(sink) ||
			(sink === 'raw-fetch' && owner === 'trackedReaderFetch')
		) {
			layer = 'transport-internal';
		} else if (
			owner === 'discourseCsrfToken' ||
			DOMAIN_WRAPPER_SINKS.has(owner) &&
			(owner === calleeName || !DOMAIN_WRAPPER_SINKS.has(calleeName))
		) {
			layer = 'domain-wrapper-internal';
		}
		const expression = sourceForNode(source, callPath.node);
		const line = callPath.node.loc?.start.line ?? 0;
		const classification = requestClass(line, owner, expression, sink);
		calls.push({
			line,
			owner,
			callee: calleeName,
			sink,
			layer,
			classification: classification.value,
			classificationBasis: classification.basis,
			expression,
		});
}

traverse(ast, {
	CallExpression: recordCall,
	OptionalCallExpression: recordCall,
});

calls.sort((left, right) => left.line - right.line);
for (const call of calls) call.contractProfile = contractProfile(call);
for (const call of calls) {
	const identity = identityBinding(call);
	call.identityFamily = identity?.family ?? null;
	call.namespace = identity?.namespace ?? null;
	const action = call.contractProfile === 'action-critical'
		? ACTION_CALLSITE_CONTRACTS.get(call.line)
		: null;
	call.actionOperation = action?.operation ?? null;
	call.actionTargetType = action?.targetType ?? null;
	call.actionVariantSource = action?.variantSource ?? null;
	call.actionResultKind = action?.resultKind ?? null;
	call.actionNativeKind = action?.native?.kind ?? null;
	call.actionNativeBinding = action?.native?.binding ?? null;
	call.actionResultOwner = action
		? actionResultOwners[`${action.operation}/${action.targetType}`] ?? null
		: null;
}
const businessCalls = calls.filter((call) => call.layer === 'business-entry');
const boundActionCallSiteLines = new Set(
	businessCalls
		.filter(
			(call) =>
				call.contractProfile === 'action-critical' &&
				call.actionOperation !== null &&
				call.actionTargetType !== null,
		)
		.map((call) => call.line),
);
const unusedActionContractLines = [...ACTION_CALLSITE_CONTRACTS.keys()]
	.filter((line) => !boundActionCallSiteLines.has(line))
	.sort((left, right) => left - right);
const counts = (items, key) => Object.fromEntries(
	[...new Set(items.map((item) => item[key]))]
		.sort()
		.map((value) => [value, items.filter((item) => item[key] === value).length]),
);
const report = {
	schemaVersion: 1,
	source: SOURCE_PATH,
	sourceBytes: Buffer.byteLength(source),
	sourceSha256: sha256(source),
	summary: {
		explicitCallSites: calls.length,
		businessCallSites: businessCalls.length,
		nonBusinessCallSites: calls.length - businessCalls.length,
		transportInternalCallSites: calls.filter(
			(call) => call.layer === 'transport-internal',
		).length,
		domainWrapperInternalCallSites: calls.filter(
			(call) => call.layer === 'domain-wrapper-internal',
		).length,
		defaultClassificationCallSites: businessCalls.filter(
			(call) => call.classificationBasis === 'default-needs-call-chain-review',
		).length,
		profileBoundBusinessCallSites: businessCalls.filter(
			(call) => call.contractProfile !== null,
		).length,
		unboundProfileCallSites: businessCalls.filter(
			(call) => call.contractProfile === null,
		).length,
		identityBoundBusinessCallSites: businessCalls.filter(
			(call) => call.identityFamily !== null && call.namespace !== null,
		).length,
		unboundIdentityCallSites: businessCalls.filter(
			(call) => call.identityFamily === null || call.namespace === null,
		).length,
		actionContractCallSites: businessCalls.filter(
			(call) => call.contractProfile === 'action-critical',
		).length,
		actionContractBoundCallSites: businessCalls.filter(
			(call) =>
				call.contractProfile === 'action-critical' &&
				call.actionOperation !== null &&
				call.actionTargetType !== null &&
				call.actionResultKind !== null &&
				call.actionNativeKind !== null &&
				call.actionNativeBinding !== null &&
				call.actionResultOwner !== null,
		).length,
		unboundActionContractCallSites: businessCalls.filter(
			(call) =>
				call.contractProfile === 'action-critical' &&
				(
					call.actionOperation === null ||
					call.actionTargetType === null ||
					call.actionResultKind === null ||
					call.actionNativeKind === null ||
					call.actionNativeBinding === null ||
					call.actionResultOwner === null
				),
		).length,
		unusedActionContractCallSites: unusedActionContractLines.length,
		byClass: counts(businessCalls, 'classification'),
		byProfile: counts(businessCalls, 'contractProfile'),
		byIdentityFamily: counts(businessCalls, 'identityFamily'),
		bySink: counts(calls, 'sink'),
	},
	calls,
	limitations: [
		'本报告覆盖显式 fetch/GM、中心 JSON/资源包装器和已登记的 Discourse 网络方法。',
		'宿主模型、插件对象或动态属性内部是否发请求，必须结合调用链和浏览器 Network 另行核验。',
		'默认 visible 分类只表示尚无更具体静态证据，必须逐项人工绑定 priority/key/cache。',
		'transport-internal 是中心包装器内部调用，不应与业务发起点相加当作独立请求数。',
	],
};
const auditFailures = [];
if (report.summary.defaultClassificationCallSites) {
	auditFailures.push(`默认分类 ${report.summary.defaultClassificationCallSites}`);
}
if (report.summary.unboundProfileCallSites) {
	auditFailures.push(`未绑定 profile ${report.summary.unboundProfileCallSites}`);
}
if (report.summary.unboundIdentityCallSites) {
	auditFailures.push(`未绑定 identity ${report.summary.unboundIdentityCallSites}`);
}
if (report.summary.unboundActionContractCallSites) {
	auditFailures.push(`未绑定 action contract ${report.summary.unboundActionContractCallSites}`);
}
if (unusedActionContractLines.length) {
	auditFailures.push(`未命中 action catalog 行 ${unusedActionContractLines.join(',')}`);
}

if (format === 'json') {
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
	const lines = [
		'# main.js 显式请求调用点审计',
		'',
		`- 源码：\`${report.source}\`（${report.sourceBytes} bytes）`,
		`- SHA-256：\`${report.sourceSha256}\``,
		`- 显式调用点：${report.summary.explicitCallSites}`,
		`- 业务发起点：${report.summary.businessCallSites}`,
		`- 非业务发起点：${report.summary.nonBusinessCallSites}`,
		`- 其中中央传输内部调用：${report.summary.transportInternalCallSites}`,
		`- 其中领域包装器内部调用：${report.summary.domainWrapperInternalCallSites}`,
		`- 默认分类待复核：${report.summary.defaultClassificationCallSites}`,
		`- 未命中 action catalog：${report.summary.unusedActionContractCallSites}`,
		'',
		'| 行 | owner | sink | 层 | 目标分类 | profile | identity | namespace | action contract | 依据 | 表达式 |',
		'| ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
		...calls.map((call) =>
			`| ${call.line} | \`${call.owner}\` | \`${call.sink}\` | ${call.layer} | ` +
			`${call.classification} | ${call.contractProfile ?? '-'} | ${call.identityFamily ?? '-'} | ` +
			`${call.namespace ?? '-'} | ${call.actionOperation
				? `${call.actionOperation}:${call.actionTargetType}:${call.actionVariantSource ?? '-'}:` +
					`${call.actionResultKind}:${call.actionNativeKind}:${call.actionNativeBinding}:` +
					`${call.actionResultOwner}`
				: '-'} | ${call.classificationBasis} | ` +
			`\`${call.expression.replaceAll('|', '\\|')}\` |`,
		),
		'',
		'## 限制',
		'',
		...report.limitations.map((limitation) => `- ${limitation}`),
	];
	process.stdout.write(`${lines.join('\n')}\n`);
}
if (auditFailures.length) {
	process.stderr.write(`main.js 请求审计未通过：${auditFailures.join('；')}\n`);
	process.exitCode = 1;
}
