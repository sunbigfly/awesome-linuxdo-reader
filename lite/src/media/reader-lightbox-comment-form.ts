import { eventElement } from '../dom/event-target.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import type {
	ReaderLightboxCommentPostInput,
} from './reader-lightbox-comment-model.js';

export interface ReaderLightboxCommentFormSlots {
	readonly form: HTMLFormElement;
	readonly target: HTMLElement;
	readonly input: HTMLTextAreaElement;
	readonly imageOption: HTMLElement;
	readonly imageCheckbox: HTMLInputElement;
	readonly error: HTMLElement;
	readonly submit: HTMLButtonElement;
}

export interface ReaderLightboxCommentFormSubmitInput<
	TPost extends ReaderLightboxCommentPostInput,
> {
	readonly targetPost: TPost;
	readonly message: string;
	readonly includeImage: boolean;
}

export interface ReaderLightboxCommentFormOptions<
	TPost extends ReaderLightboxCommentPostInput,
> {
	readonly slots: ReaderLightboxCommentFormSlots;
	readonly minimumLength: number;
	submit(
		input: ReaderLightboxCommentFormSubmitInput<TPost>,
	): Promise<void>;
	readonly reveal?: () => void;
	readonly focus?: (input: HTMLTextAreaElement) => void;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

function cleanUsername(value: unknown): string {
	return String(value ?? '').trim().replace(/^@+/, '');
}

/**
 * Lightbox 内联评论表单唯一状态 owner。
 *
 * 这里只管理 target/draft/busy/validation；真正提交必须由注入端口进入 Discourse 原生
 * composer save 与 TopicSession created-post ingress，不能在表单里创建网络请求。
 */
export class ReaderLightboxCommentForm<
	TPost extends ReaderLightboxCommentPostInput,
> {
	readonly scope: LifecycleScope;
	readonly #slots: ReaderLightboxCommentFormSlots;
	readonly #minimumLength: number;
	readonly #submit: ReaderLightboxCommentFormOptions<TPost>['submit'];
	readonly #reveal: () => void;
	readonly #focus: (input: HTMLTextAreaElement) => void;
	readonly #onError: (error: unknown) => void;
	#targetPost: TPost | null = null;
	#rootComment = false;
	#busy = false;

	constructor(options: ReaderLightboxCommentFormOptions<TPost>) {
		this.#slots = options.slots;
		this.#minimumLength = Math.max(
			1,
			Math.trunc(Number(options.minimumLength) || 16),
		);
		this.#submit = options.submit;
		this.#reveal = options.reveal ?? (() => {});
		this.#focus = options.focus ?? ((input) => input.focus({ preventScroll: true }));
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#slots.input.placeholder =
			`写下你的评论（至少 ${this.#minimumLength} 个字符）…`;
		this.scope.listen(this.#slots.form, 'submit', (event) => {
			void this.#onSubmit(event).catch(this.#onError);
		});
		this.scope.listen(this.#slots.form, 'click', (event) => {
			if (!eventElement(event)?.closest('.ldp-lb-comment-cancel')) return;
			this.close();
		});
		this.scope.add(() => this.close());
	}

	get open(): boolean {
		return !this.#slots.form.hidden;
	}

	openFor(targetPost: TPost, rootComment: boolean): void {
		if (this.scope.destroyed) return;
		this.#targetPost = targetPost;
		this.#rootComment = rootComment;
		const username = cleanUsername(targetPost.username);
		const postNumber = Number(targetPost.post_number);
		this.#slots.target.textContent = rootComment
			? `${username ? `评论 @${username}` : '评论'} 的图片（回复 #${postNumber}）`
			: `回复 ${username ? `@${username} · ` : ''}#${postNumber}`;
		this.#slots.imageOption.hidden = rootComment;
		this.#slots.imageCheckbox.checked = rootComment;
		this.#slots.error.textContent = '';
		this.#slots.form.hidden = false;
		this.#reveal();
		this.#focus(this.#slots.input);
	}

	close(): void {
		this.#targetPost = null;
		this.#rootComment = false;
		this.#busy = false;
		this.#slots.form.hidden = true;
		this.#slots.form.removeAttribute('aria-busy');
		this.#slots.submit.disabled = false;
		this.#slots.input.value = '';
		this.#slots.error.textContent = '';
	}

	destroy(): void {
		this.scope.destroy();
	}

	async #onSubmit(event: Event): Promise<void> {
		event.preventDefault();
		if (this.#busy) return;
		const targetPost = this.#targetPost;
		const message = this.#slots.input.value.trim();
		const length = [...message].length;
		if (!targetPost || !Number(targetPost.post_number)) {
			this.#slots.error.textContent = '无法确认回复目标';
			return;
		}
		if (!message) {
			this.#slots.error.textContent = '请输入评论内容';
			return;
		}
		if (length < this.#minimumLength) {
			this.#slots.error.textContent =
				`评论至少需要 ${this.#minimumLength} 个字符（当前 ${length} 个）`;
			return;
		}
		this.#busy = true;
		this.#slots.form.setAttribute('aria-busy', 'true');
		this.#slots.submit.disabled = true;
		this.#slots.error.textContent = '';
		try {
			await this.#submit({
				targetPost,
				message,
				includeImage:
					this.#rootComment || this.#slots.imageCheckbox.checked,
			});
			this.close();
		} catch (error) {
			this.#slots.error.textContent =
				`发送失败：${error instanceof Error ? error.message : '请重试'}`;
			throw error;
		} finally {
			this.#busy = false;
			this.#slots.form.removeAttribute('aria-busy');
			this.#slots.submit.disabled = false;
		}
	}
}
