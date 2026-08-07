/**
 * 为静态模板创建严格的元素查询器。
 *
 * 查询失败必须保留所属 surface 的名称，避免模板漂移退化成后续难定位的
 * null 属性异常；调用方仍负责声明准确的元素类型。
 */
export function requiredElementQuery(owner: string) {
	return function requiredElement<T extends Element>(
		root: ParentNode,
		selector: string,
	): T {
		const node = root.querySelector<T>(selector);
		if (!node) throw new Error(`${owner}缺少 ${selector}`);
		return node;
	};
}
