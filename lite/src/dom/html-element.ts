/**
 * Reader 组件创建 HTML 节点的唯一无状态 primitive。
 *
 * 业务组件仍拥有结构、ARIA、事件和生命周期；这里仅消除重复的
 * createElement/className/textContent 样板。
 */
export function htmlElement<K extends keyof HTMLElementTagNameMap>(
	document: Document,
	tagName: K,
	className = '',
	textContent?: string,
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tagName);
	node.className = className;
	if (textContent !== undefined) node.textContent = textContent;
	return node;
}
