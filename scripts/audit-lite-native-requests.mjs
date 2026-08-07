import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import traversePackage from '@babel/traverse';

const traverse = traversePackage.default ?? traversePackage;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const sourceRoot = path.join(projectRoot, 'lite/src');
const actionCatalogPath = path.join(
	projectRoot,
	'lite/contracts/discourse-action-transports.json',
);
const nativeAjaxOwner = 'lite/src/network/discourse-native-read-transport.ts';
const messageBusOwner = 'lite/src/discourse/native-message-bus.ts';
const nativeHostBridgeOwner = 'lite/src/discourse/native-host-api.ts';
const userscriptCapabilityOwner =
	'lite/src/userscript/browser-userscript-environment.ts';
const userscriptApplicationOwner =
	'lite/src/userscript/reader-userscript-application.ts';
const nativeHostLookupOwners = new Set([
	nativeHostBridgeOwner,
	nativeAjaxOwner,
	messageBusOwner,
	'lite/src/discourse/native-composer.ts',
	'lite/src/discourse/native-presence.ts',
	'lite/src/post/discourse-action-transport.ts',
	'lite/src/shell/embedded-host-topic-card-enhancement.ts',
	userscriptApplicationOwner,
]);
const privilegedMemberOwners = new Map([
	['unsafeWindow', userscriptCapabilityOwner],
	['GM_xmlhttpRequest', userscriptCapabilityOwner],
	['fetch', userscriptCapabilityOwner],
	['moduleBroker', nativeHostBridgeOwner],
	['requirejs', nativeHostBridgeOwner],
	['Discourse', nativeHostBridgeOwner],
	['__container__', nativeHostBridgeOwner],
]);
const userscriptRequestCapabilities = new Map([
	['createExternalHttp', {
		member: 'GM_xmlhttpRequest',
		route: 'DomainRequestGateway',
		classification: 'central-external',
	}],
	['createDiscourseSiteProbe', {
		member: 'GM_xmlhttpRequest',
		route: 'CoordinatedDiscourseSiteProbe -> DomainRequestGateway',
		classification: 'central-site-probe',
	}],
	['createPublicResourceHttp', {
		member: 'fetch',
		route: 'PublicResourceRequestAdapter -> DomainRequestGateway',
		classification: 'central-public-resource',
	}],
	['createCreditBridgeHttp', {
		member: 'fetch',
		route: 'scheduleReaderCreditAccountBridge',
		classification: 'bounded-pre-reader-exception',
	}],
]);
const externalAuthorizationOwners = new Set([
	'lite/src/translation/translation-request-adapter.ts',
]);
const forbiddenCalls = new Set([
	'fetch',
	'GM_xmlhttpRequest',
	'apiSend',
	'requestJSON',
	'requestCachedJSON',
	'trackedFetch',
	'trackedSend',
	'sendBeacon',
	'ajax',
]);
const forbiddenConstructors = new Set([
	'XMLHttpRequest',
	'WebSocket',
	'EventSource',
]);

async function sourceFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const nested = await Promise.all(entries.map(async (entry) => {
		const target = path.join(directory, entry.name);
		if (entry.isDirectory()) return sourceFiles(target);
		return entry.isFile() && entry.name.endsWith('.ts') ? [target] : [];
	}));
	return nested.flat().sort();
}

function memberName(node) {
	if (node.type !== 'MemberExpression' && node.type !== 'OptionalMemberExpression') {
		return '';
	}
	if (!node.computed && node.property.type === 'Identifier') return node.property.name;
	if (node.computed && node.property.type === 'StringLiteral') return node.property.value;
	return '';
}

function calledName(node) {
	if (node.type === 'Identifier') return node.name;
	return memberName(node);
}

function location(node) {
	return {
		line: node.loc?.start.line ?? 0,
		column: node.loc?.start.column ?? 0,
	};
}

function enclosingMethodName(nodePath) {
	const methodPath = nodePath.findParent((candidate) =>
		candidate.node.type === 'ClassMethod' ||
		candidate.node.type === 'ClassPrivateMethod' ||
		candidate.node.type === 'ObjectMethod');
	if (!methodPath) return '';
	const key = methodPath.node.key;
	if (key.type === 'Identifier') return key.name;
	if (key.type === 'StringLiteral') return key.value;
	return '';
}

const files = await sourceFiles(sourceRoot);
const violations = [];
let nativeAjaxBindings = 0;
let messageBusBindings = 0;
const userscriptCapabilityCounts = new Map();
const userscriptCapabilityCallCounts = new Map();
for (const absolutePath of files) {
	const relativePath = path.relative(projectRoot, absolutePath).replaceAll(path.sep, '/');
	const source = await readFile(absolutePath, 'utf8');
	const ast = parse(source, {
		sourceType: 'module',
		plugins: ['typescript'],
	});
	const inspectMember = (memberPath) => {
		const name = memberName(memberPath.node);
		if (name === 'cookie') {
			violations.push({
				file: relativePath,
				...location(memberPath.node),
				kind: 'access:cookie',
			});
		}
		const requiredOwner = privilegedMemberOwners.get(name);
		if (requiredOwner && requiredOwner !== relativePath) {
			violations.push({
				file: relativePath,
				...location(memberPath.node),
				kind: `privileged-member-owner:${name}`,
			});
		}
		if (
			relativePath === userscriptCapabilityOwner &&
			(name === 'GM_xmlhttpRequest' || name === 'fetch')
		) {
			const method = enclosingMethodName(memberPath);
			const expected = userscriptRequestCapabilities.get(method);
			if (!expected || expected.member !== name) {
				violations.push({
					file: relativePath,
					...location(memberPath.node),
					kind: `unclassified-userscript-request-capability:${method || name}`,
				});
			} else {
				userscriptCapabilityCounts.set(
					method,
					(userscriptCapabilityCounts.get(method) ?? 0) + 1,
				);
			}
		}
	};
	traverse(ast, {
		CallExpression(callPath) {
			const name = calledName(callPath.node.callee);
			if (
				relativePath === userscriptCapabilityOwner &&
				name === 'call' &&
				(callPath.node.callee.type === 'MemberExpression' ||
					callPath.node.callee.type === 'OptionalMemberExpression') &&
				callPath.node.callee.object.type === 'Identifier' &&
				callPath.node.callee.object.name === 'rawRequest'
			) {
				const method = enclosingMethodName(callPath);
				userscriptCapabilityCallCounts.set(
					method,
					(userscriptCapabilityCallCounts.get(method) ?? 0) + 1,
				);
			}
			if (forbiddenCalls.has(name)) {
				violations.push({
					file: relativePath,
					...location(callPath.node),
					kind: `call:${name}`,
				});
			}
			const firstArgument = callPath.node.arguments[0];
			if (
				(name === 'lookup' || name === 'lookupModule') &&
				(
					callPath.node.callee.type === 'MemberExpression' ||
					callPath.node.callee.type === 'OptionalMemberExpression'
				) &&
				!nativeHostLookupOwners.has(relativePath)
			) {
				violations.push({
					file: relativePath,
					...location(callPath.node),
					kind: `native-host-lookup-owner:${name}`,
				});
			}
			if (
				name === 'lookupModule' &&
				firstArgument?.type === 'StringLiteral' &&
				firstArgument.value === 'discourse/lib/ajax'
			) {
				nativeAjaxBindings += 1;
				if (relativePath !== nativeAjaxOwner) {
					violations.push({
						file: relativePath,
						...location(callPath.node),
						kind: 'native-ajax-owner',
					});
				}
			}
			if (
				name === 'lookup' &&
				firstArgument?.type === 'StringLiteral' &&
				firstArgument.value === 'service:message-bus'
			) {
				messageBusBindings += 1;
				if (relativePath !== messageBusOwner) {
					violations.push({
						file: relativePath,
						...location(callPath.node),
						kind: 'message-bus-owner',
					});
				}
			}
		},
		NewExpression(newPath) {
			const name = calledName(newPath.node.callee);
			if (!forbiddenConstructors.has(name)) return;
			violations.push({
				file: relativePath,
				...location(newPath.node),
				kind: `new:${name}`,
			});
		},
		AssignmentExpression(assignmentPath) {
			const left = assignmentPath.node.left;
			if (
				left.type === 'MemberExpression' &&
				memberName(left) === 'cookie'
			) {
				violations.push({
					file: relativePath,
					...location(assignmentPath.node),
					kind: 'write:cookie',
				});
			}
		},
		MemberExpression: inspectMember,
		OptionalMemberExpression: inspectMember,
		ObjectProperty(propertyPath) {
			const key = propertyPath.node.key;
			const name = (
				key.type === 'Identifier'
					? key.name
					: key.type === 'StringLiteral'
						? key.value
						: ''
			).toLowerCase();
			if (!['authorization', 'cookie', 'x-csrf-token'].includes(name)) return;
			if (
				name === 'authorization' &&
				externalAuthorizationOwners.has(relativePath)
			) {
				return;
			}
			violations.push({
				file: relativePath,
				...location(propertyPath.node),
				kind: `manual-auth-header:${name}`,
			});
		},
	});
}

for (const [method] of userscriptRequestCapabilities) {
	const bindings = userscriptCapabilityCounts.get(method) ?? 0;
	const calls = userscriptCapabilityCallCounts.get(method) ?? 0;
	if (bindings !== 1 || calls !== 1) {
		violations.push({
			file: userscriptCapabilityOwner,
			line: 0,
			column: 0,
			kind: `userscript-request-capability-count:${method}:binding=${bindings}:call=${calls}`,
		});
	}
}

if (nativeAjaxBindings !== 1) {
	violations.push({
		file: 'lite/src',
		line: 0,
		column: 0,
		kind: `native-ajax-binding-count:${nativeAjaxBindings}`,
	});
}
if (messageBusBindings !== 1) {
	violations.push({
		file: 'lite/src',
		line: 0,
		column: 0,
		kind: `message-bus-binding-count:${messageBusBindings}`,
	});
}

const actionCatalog = JSON.parse(await readFile(actionCatalogPath, 'utf8'));
for (const callSite of actionCatalog.callSites ?? []) {
	if (
		callSite?.native?.kind === 'native-ajax' &&
		callSite.native.binding !== 'discourse/lib/ajax#ajax'
	) {
		violations.push({
			file: path.relative(projectRoot, actionCatalogPath).replaceAll(path.sep, '/'),
			line: Number(callSite.line) || 0,
			column: 0,
			kind: `action-native-ajax-binding:${String(callSite.native.binding)}`,
		});
	}
}
const actionCallSiteCount = actionCatalog.callSites?.length ?? 0;
const nativeAjaxActionCallSiteCount = (actionCatalog.callSites ?? []).filter(
	(callSite) => callSite?.native?.kind === 'native-ajax',
).length;

const report = {
	schemaVersion: 1,
	files: files.length,
	nativeAjaxBinding: 'discourse/lib/ajax#ajax',
	nativeAjaxOwner,
	nativeAjaxBindings,
	messageBusBinding: 'service:message-bus',
	messageBusOwner,
	messageBusBindings,
	nativeHostBridgeOwner,
	userscriptCapabilityOwner,
	userscriptApplicationOwner,
	nativeHostLookupOwners: [...nativeHostLookupOwners].sort(),
	externalAuthorizationOwners: [...externalAuthorizationOwners].sort(),
	userscriptRequestCapabilities: [...userscriptRequestCapabilities].map(([
		method,
		contract,
	]) => ({
		method,
		...contract,
		bindings: userscriptCapabilityCounts.get(method) ?? 0,
		calls: userscriptCapabilityCallCounts.get(method) ?? 0,
	})),
	auditedRequestClasses: [
		{
			kind: 'discourse-native-ajax',
			owner: nativeAjaxOwner,
			bindings: nativeAjaxBindings,
		},
		{
			kind: 'discourse-native-action-catalog',
			owner: path.relative(projectRoot, actionCatalogPath).replaceAll(path.sep, '/'),
			callSites: actionCallSiteCount,
			nativeAjaxCallSites: nativeAjaxActionCallSiteCount,
		},
		{
			kind: 'discourse-message-bus',
			owner: messageBusOwner,
			bindings: messageBusBindings,
		},
		{
			kind: 'userscript-programmatic-http',
			owner: userscriptCapabilityOwner,
			bindings: userscriptCapabilityCounts.size,
		},
		{
			kind: 'browser-managed-resource',
			owner: 'lite/src/network/browser-request-observation.ts',
			classification: 'passive-observation-only',
		},
	],
	violations,
};
process.stdout.write(`${JSON.stringify(report)}\n`);
if (violations.length) process.exitCode = 1;
