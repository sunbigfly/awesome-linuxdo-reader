import { deriveBranchGeometry } from '../src/layout/branch-overlay.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const branch = deriveBranchGeometry({
	parentAxisX: 20,
	parentStartY: 10,
	childAxisX: 60,
	childCenterY: 90,
	cornerRadius: 12,
});
assert(branch.path === 'M 20 10 L 20 78 Q 20 90 32 90 L 60 90', '回复线几何路径错误');
