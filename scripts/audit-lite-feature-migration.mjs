import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..',
);
const catalogPath = path.join(
	projectRoot,
	'docs/public/feature-catalog.json',
);
const evidencePath = path.join(
	projectRoot,
	'lite/contracts/feature-migration-evidence.json',
);
const releaseGatePath = path.join(projectRoot, 'lite/release-gate.json');
const releaseBrowserEvidencePath = path.join(
	projectRoot,
	'lite/contracts/release-browser-evidence.json',
);
const statuses = new Set(['partial', 'static-complete']);
const browserStatuses = new Set(['pending', 'accepted']);
const evidenceKinds = new Set(['runtime', 'artifact']);
const artifactChecks = new Set([
	'docs:verify',
	'loader:verify',
	'main-lite:check',
	'userscript:inspect',
]);
const expectedCatalogSize = 110;
const expectedProofScope = 'static-evidence-integrity-only';
const requiredBrowserScenarios = [
	'coldReload',
	'singlePortal',
	'readerSurface',
	'settingsMatrix',
	'notificationsAndMessages',
	'historyAndCollections',
	'timelineAndHiddenReplies',
	'errorCapture',
	'horizontalOverflow',
];
const errors = [];

function relative(value) {
	return path.relative(projectRoot, value).replaceAll(path.sep, '/');
}

async function existingProjectFile(value, prefix, suffix = '') {
	const normalized = String(value ?? '').trim();
	if (
		!normalized.startsWith(prefix) ||
		(suffix && !normalized.endsWith(suffix)) ||
		path.isAbsolute(normalized) ||
		normalized.split('/').includes('..')
	) {
		return false;
	}
	try {
		await access(path.join(projectRoot, normalized));
		return true;
	} catch {
		return false;
	}
}

async function existingArtifactOwner(value) {
	const normalized = String(value ?? '').trim();
	if (
		!normalized ||
		path.isAbsolute(normalized) ||
		normalized.split('/').includes('..') ||
		!(
			normalized === 'SECURITY.md' ||
			normalized.startsWith('docs/') ||
			normalized.startsWith('lite/') ||
			normalized.startsWith('scripts/')
		)
	) {
		return false;
	}
	try {
		await access(path.join(projectRoot, normalized));
		return true;
	} catch {
		return false;
	}
}

const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
const releaseGate = JSON.parse(await readFile(releaseGatePath, 'utf8'));
const releaseBrowserEvidence = JSON.parse(
	await readFile(releaseBrowserEvidencePath, 'utf8'),
);
if (!Array.isArray(catalog)) errors.push('feature catalog 顶层必须是数组');
const catalogFeatures = Array.isArray(catalog) ? catalog : [];
if (catalogFeatures.length !== expectedCatalogSize) {
	errors.push(`feature catalog 必须保持 ${expectedCatalogSize} 项，当前 ${catalogFeatures.length}`);
}
if (evidence.schemaVersion !== 2) errors.push('feature evidence schemaVersion 必须为 2');
if (evidence.proofScope !== expectedProofScope) {
	errors.push(`feature evidence proofScope 必须为 ${expectedProofScope}`);
}
if (evidence.alignmentDecision !== 'not-evaluated') {
	errors.push('feature evidence 不能自行声明业务或渲染对齐结论');
}
if (evidence.catalog !== relative(catalogPath)) {
	errors.push('feature evidence 必须引用唯一 docs feature catalog');
}
const featureIds = catalogFeatures.map((feature) => feature?.feature_id);
if (featureIds.some((featureId) => typeof featureId !== 'string' || !featureId.trim())) {
	errors.push('feature catalog feature_id 必须是非空字符串');
}
const catalogIds = new Set(featureIds);
if (catalogIds.size !== featureIds.length) {
	errors.push('feature catalog feature_id 不能重复');
}
const entries = evidence.features && typeof evidence.features === 'object'
	? Object.entries(evidence.features)
	: [];
for (const [featureId, raw] of entries) {
	if (!catalogIds.has(featureId)) {
		errors.push(`${featureId}: 不存在于 feature catalog`);
		continue;
	}
	const entry = raw && typeof raw === 'object' ? raw : {};
	if (!statuses.has(entry.implementationStatus)) {
		errors.push(`${featureId}: implementationStatus 非法`);
	}
	if (!browserStatuses.has(entry.browserStatus)) {
		errors.push(`${featureId}: browserStatus 非法`);
	}
	const evidenceKind = entry.evidenceKind ?? 'runtime';
	if (!evidenceKinds.has(evidenceKind)) {
		errors.push(`${featureId}: evidenceKind 非法`);
	}
	if (
		entry.browserStatus === 'accepted' &&
		(
			!Array.isArray(entry.browserEvidence) ||
			entry.browserEvidence.length === 0 ||
			entry.browserEvidence.some((value) => !String(value).trim())
		)
	) {
		errors.push(`${featureId}: browser accepted 必须登记非空 browserEvidence`);
	}
	if (evidenceKind === 'runtime') {
		if (!Array.isArray(entry.owners) || entry.owners.length === 0) {
			errors.push(`${featureId}: runtime owners 必须是非空数组`);
		} else {
			for (const owner of entry.owners) {
				if (!await existingProjectFile(owner, 'lite/src/', '.ts')) {
					errors.push(`${featureId}: owner 不存在或越界：${String(owner)}`);
				}
			}
		}
		if (!Array.isArray(entry.tests) || entry.tests.length === 0) {
			errors.push(`${featureId}: runtime tests 必须是非空数组`);
		} else {
			for (const test of entry.tests) {
				if (!await existingProjectFile(test, 'lite/tests/', '.test.ts')) {
					errors.push(`${featureId}: test 不存在或越界：${String(test)}`);
				}
			}
		}
	} else {
		if (
			!Array.isArray(entry.artifactOwners) ||
			entry.artifactOwners.length === 0
		) {
			errors.push(`${featureId}: artifactOwners 必须是非空数组`);
		} else {
			for (const owner of entry.artifactOwners) {
				if (!await existingArtifactOwner(owner)) {
					errors.push(
						`${featureId}: artifact owner 不存在或越界：${String(owner)}`,
					);
				}
			}
		}
		if (
			!Array.isArray(entry.artifactChecks) ||
			entry.artifactChecks.length === 0
		) {
			errors.push(`${featureId}: artifactChecks 必须是非空数组`);
		} else {
			for (const check of entry.artifactChecks) {
				if (!artifactChecks.has(check)) {
					errors.push(`${featureId}: artifact check 非法：${String(check)}`);
				}
			}
		}
	}
	if (!String(entry.note ?? '').trim()) {
		errors.push(`${featureId}: note 不能为空`);
	}
}

const mappedIds = new Set(entries.map(([featureId]) => featureId));
const runtimeMapped = entries.filter(([, value]) =>
	(value.evidenceKind ?? 'runtime') === 'runtime').length;
const artifactMapped = entries.filter(([, value]) =>
	value.evidenceKind === 'artifact').length;
const unmapped = [...catalogIds].filter((featureId) => !mappedIds.has(featureId));
const partial = entries.filter(([, value]) =>
	value.implementationStatus === 'partial').length;
const staticEvidenceComplete = entries.filter(([, value]) =>
	value.implementationStatus === 'static-complete').length;
const browserEvidenceRegistered = entries.filter(([, value]) =>
	value.browserStatus === 'accepted').length;
const staticAndBrowserEvidenceRows = entries.filter(([, value]) =>
	value.implementationStatus === 'static-complete' &&
	value.browserStatus === 'accepted').length;
const browserMatrixEvidenceComplete =
	releaseBrowserEvidence.schemaVersion === 1 &&
	releaseBrowserEvidence.browserMatrix?.accepted === true &&
	requiredBrowserScenarios.every(
		(key) => releaseBrowserEvidence.browserMatrix?.scenarios?.[key] === true,
	);
if (
	releaseGate.featureContractCoverageComplete === true &&
	(
		unmapped.length > 0 ||
		entries.length !== catalogFeatures.length
	)
) {
	errors.push(
		'release gate 声明 featureContractCoverageComplete，但功能目录映射仍不完整',
	);
}
if (
	releaseGate.browserMatrixAccepted === true &&
	!browserMatrixEvidenceComplete
) {
	errors.push(
		'release gate 声明 browserMatrixAccepted，但发布浏览器矩阵证据不完整',
	);
}
const report = {
	schemaVersion: 3,
	evidenceSchemaVersion: evidence.schemaVersion,
	gate: 'feature-evidence-integrity',
	proofScope: expectedProofScope,
	alignmentEvaluation: 'not-evaluated',
	baseline: Object.freeze(['docs/public/feature-catalog.json']),
	proves: Object.freeze([
		'catalog coverage',
		'owner and test path existence',
		'artifact check declaration integrity',
		'browser evidence registration integrity',
	]),
	doesNotProve: Object.freeze([
		'work/main.js business equivalence',
		'work/main.css visual equivalence',
		'browser behavior or rendered parity',
	]),
	catalog: catalogFeatures.length,
	mapped: entries.length,
	runtimeMapped,
	artifactMapped,
	unmapped: unmapped.length,
	partial,
	staticEvidenceComplete,
	browserEvidenceRegistered,
	staticAndBrowserEvidenceRows,
	browserMatrixEvidence: relative(releaseBrowserEvidencePath),
	browserMatrixEvidenceComplete,
	releaseGate: Object.freeze({
		featureContractCoverageComplete:
			releaseGate.featureContractCoverageComplete === true,
		browserMatrixAccepted: releaseGate.browserMatrixAccepted === true,
	}),
	unmappedFeatureIds: unmapped,
	errors,
};
process.stdout.write(`${JSON.stringify(report)}\n`);
if (errors.length) process.exitCode = 1;
