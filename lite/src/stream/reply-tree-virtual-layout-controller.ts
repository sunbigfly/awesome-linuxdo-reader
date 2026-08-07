import type { ReplyTreeRepository } from '../dom/reply-tree-repository.js';
import type { ReplyTreeRootBranch } from '../dom/reply-tree.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import type { VirtualRootLayout } from './virtual-root-layout.js';

export interface ReplyTreeRootProjection {
	rootBranches(): readonly ReplyTreeRootBranch[];
}

/**
 * 回复拓扑到根虚拟流的唯一投影。
 *
 * 它只订阅仓库提交并替换根集合；不会修改拓扑、挂载 DOM 或发请求。
 */
export class ReplyTreeVirtualLayoutController {
	readonly repository: ReplyTreeRepository;
	readonly topology: ReplyTreeRootProjection;
	readonly layout: VirtualRootLayout;
	readonly scope: LifecycleScope;

	constructor(
		repository: ReplyTreeRepository,
		layout: VirtualRootLayout,
		parentScope?: LifecycleScope,
		topology: ReplyTreeRootProjection = repository.topology,
	) {
		this.repository = repository;
		this.topology = topology;
		this.layout = layout;
		this.scope = LifecycleScope.ownedBy(parentScope);
		this.syncRoots();
		repository.changes.subscribe(() => this.syncRoots(), this.scope);
	}

	syncRoots(): void {
		this.layout.setRoots(this.topology.rootBranches());
	}

	destroy(): void {
		this.scope.destroy();
	}
}
