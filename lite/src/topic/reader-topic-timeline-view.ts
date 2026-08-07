import { LifecycleScope } from '../kernel/lifecycle.js';
import type {
	ReaderTopicTimelineController,
	ReaderTopicTimelineSnapshot,
} from './reader-topic-timeline-controller.js';

export interface ReaderTopicTimelineViewPreferences {
	readonly pageStep: number;
}

export interface ReaderTopicTimelineViewElements {
	readonly root: HTMLElement;
	readonly timeline: HTMLElement;
	readonly date: HTMLButtonElement;
	readonly track: HTMLButtonElement;
	readonly cursor: HTMLElement;
	readonly current: HTMLElement;
	readonly total: HTMLElement;
	readonly preview: HTMLElement;
	readonly relative: HTMLButtonElement;
	readonly jump: HTMLButtonElement;
	readonly top: HTMLButtonElement;
	readonly jumpForm: HTMLFormElement;
	readonly jumpInput: HTMLInputElement;
	readonly jumpSubmit: HTMLButtonElement;
	readonly jumpHint: HTMLElement;
}

export interface ReaderTopicTimelineFrameScheduler {
	request(callback: FrameRequestCallback): number;
	cancel(frameId: number): void;
}

export interface ReaderTopicTimelineViewOptions {
	readonly controller: ReaderTopicTimelineController;
	readonly elements: ReaderTopicTimelineViewElements;
	readonly preferences: ReaderTopicTimelineViewPreferences;
	readonly readCreatedAt: (postNumber: number) => string | null;
	readonly readLatestReplyAt: () => string | null;
	readonly formatRelative: (timestamp: string) => string;
	readonly frameScheduler?: ReaderTopicTimelineFrameScheduler;
	readonly animationFrameScheduler?: ReaderTopicTimelineFrameScheduler;
	readonly scheduleTimer?: (callback: () => void, delayMs: number) => number;
	readonly cancelTimer?: (timerId: number) => void;
	readonly now?: () => number;
	readonly prefersReducedMotion?: () => boolean;
	readonly trackTopInset?: number;
	readonly trackBottomInset?: number;
	readonly notify?: (message: string) => void;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

interface PointerTrackPosition {
	readonly top: number;
	readonly ratio: number;
}

function normalizedPreferences(
	value: ReaderTopicTimelineViewPreferences,
): ReaderTopicTimelineViewPreferences {
	const numeric = Math.floor(Number(value.pageStep));
	return Object.freeze({
		pageStep:
			Number.isSafeInteger(numeric) && numeric > 0
				? Math.min(64, numeric)
				: 16,
	});
}

function normalizedInset(value: number | undefined): number {
	const numeric = Number(value);
	return Number.isFinite(numeric) && numeric >= 0 ? numeric : 10;
}

export function readerTimelineDateLabel(timestamp: string | null): string {
	if (!timestamp) return '';
	const date = new Date(timestamp);
	if (!Number.isFinite(date.getTime())) return '';
	return `${date.getFullYear()} 年\n${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function pointerCoordinate(event: Event): number {
	const value = Number((event as unknown as { clientY?: unknown }).clientY);
	return Number.isFinite(value) ? value : 0;
}

function pointerIdentifier(event: Event): number {
	const value = Number((event as unknown as { pointerId?: unknown }).pointerId);
	return Number.isFinite(value) ? value : 0;
}

function eventPathIncludes(event: Event, node: Node): boolean {
	const composedPath = (
		event as unknown as { composedPath?: () => readonly EventTarget[] }
	).composedPath;
	if (typeof composedPath === 'function') {
		return composedPath.call(event).includes(node);
	}
	const target = event.target;
	return target !== null &&
		typeof target === 'object' &&
		'nodeType' in target &&
		node.contains(target as Node);
}

/**
 * Shell 时间轴的唯一 DOM owner。
 *
 * View 只把 pointer、键盘和楼层表单转换为 controller 的 ratio/step/jump；它不读取帖子
 * DOM、不补流、不展开回复树、不写 scrollTop，也不维护第二份楼层序列。
 */
export class ReaderTopicTimelineView {
	readonly scope: LifecycleScope;
	readonly #controller: ReaderTopicTimelineController;
	readonly #elements: ReaderTopicTimelineViewElements;
	readonly #readCreatedAt: (postNumber: number) => string | null;
	readonly #readLatestReplyAt: () => string | null;
	readonly #formatRelative: (timestamp: string) => string;
	readonly #frameScheduler: ReaderTopicTimelineFrameScheduler;
	readonly #animationFrameScheduler: ReaderTopicTimelineFrameScheduler;
	readonly #scheduleTimer: (callback: () => void, delayMs: number) => number;
	readonly #cancelTimer: (timerId: number) => void;
	readonly #now: () => number;
	readonly #prefersReducedMotion: () => boolean;
	readonly #trackTopInset: number;
	readonly #trackBottomInset: number;
	readonly #notify: (message: string) => void;
	readonly #onError: (error: unknown) => void;
	readonly #lensElements = new Map<number, HTMLElement>();
	readonly #spareLensElements: HTMLElement[] = [];
	#preferences: ReaderTopicTimelineViewPreferences;
	#previewFrame = 0;
	#jumpAnimationFrame = 0;
	#jumpAnimationTimer = 0;
	#jumpAnimationEpoch = 0;
	#previewClientY = 0;
	#previewVisible = false;
	#pointerInside = false;
	#dragging = false;
	#activePointerId = 0;
	#trackRect: DOMRect | null = null;

	constructor(options: ReaderTopicTimelineViewOptions) {
		this.#controller = options.controller;
		this.#elements = options.elements;
		this.#readCreatedAt = options.readCreatedAt;
		this.#readLatestReplyAt = options.readLatestReplyAt;
		this.#formatRelative = options.formatRelative;
		this.#trackTopInset = normalizedInset(options.trackTopInset);
		this.#trackBottomInset = normalizedInset(options.trackBottomInset);
		this.#notify = options.notify ?? (() => {});
		this.#onError = options.onError ?? (() => {});
		this.#preferences = normalizedPreferences(options.preferences);
		const view = this.#elements.timeline.ownerDocument.defaultView;
		this.#frameScheduler = options.frameScheduler ?? Object.freeze({
			request(callback: FrameRequestCallback): number {
				if (typeof view?.requestAnimationFrame === 'function') {
					return view.requestAnimationFrame(callback);
				}
				callback(0);
				return 0;
			},
			cancel(frameId: number): void {
				view?.cancelAnimationFrame?.(frameId);
			},
		});
		this.#animationFrameScheduler = options.animationFrameScheduler ??
			Object.freeze({
				request(callback: FrameRequestCallback): number {
					if (typeof view?.requestAnimationFrame === 'function') {
						return view.requestAnimationFrame(callback);
					}
					return view?.setTimeout(
						() => callback(Date.now()),
						16,
					) ?? globalThis.setTimeout(
						() => callback(Date.now()),
						16,
					);
				},
				cancel(frameId: number): void {
					if (typeof view?.cancelAnimationFrame === 'function') {
						view.cancelAnimationFrame(frameId);
					} else if (view) {
						view.clearTimeout(frameId);
					} else {
						globalThis.clearTimeout(frameId);
					}
				},
			});
		this.#scheduleTimer = options.scheduleTimer ?? ((callback, delayMs) =>
			view?.setTimeout(callback, delayMs) ??
			globalThis.setTimeout(callback, delayMs));
		this.#cancelTimer = options.cancelTimer ?? ((timerId) => {
			if (view) view.clearTimeout(timerId);
			else globalThis.clearTimeout(timerId);
		});
		this.#now = options.now ?? Date.now;
		this.#prefersReducedMotion = options.prefersReducedMotion ?? (() =>
			view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
		);
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		const timelineDocument = this.#elements.timeline.ownerDocument;
		const timelineWindow = timelineDocument.defaultView;
		let relativeTimer: number | null = null;
		const stopRelativeTimer = (): void => {
			if (relativeTimer === null) return;
			timelineWindow?.clearInterval(relativeTimer);
			relativeTimer = null;
		};
		const syncRelativeTimer = (): void => {
			stopRelativeTimer();
			if (!timelineWindow || timelineDocument.visibilityState === 'hidden') {
				return;
			}
			relativeTimer = timelineWindow.setInterval(() => {
				if (!this.scope.destroyed) this.#syncRelativeTime();
			}, 30_000);
		};
		this.#listen(
			timelineDocument,
			'visibilitychange',
			syncRelativeTimer,
		);
		this.scope.add(stopRelativeTimer);
		syncRelativeTimer();
		const {
			root,
			date,
			track,
			relative,
			jump,
			top,
			jumpForm,
			jumpInput,
		} = this.#elements;
		this.#listen(date, 'click', () => {
			this.#submitJump(1);
		});
		this.#listen(top, 'click', () => {
			this.#submitJump(1);
		});
		this.#listen(relative, 'click', () => {
			const target = this.#controller.targetByStep(
				this.#controller.snapshot.currentPostNumber,
				Number.POSITIVE_INFINITY,
			);
			this.#submitJump(target);
		});
		this.#listen(jump, 'click', () => {
			if (jumpForm.hidden) this.#openJumpForm();
			else this.#closeJumpForm(true);
		});
		this.#listen(jumpInput, 'input', () => {
			this.#validateJumpInput();
		});
		this.#listen(jumpForm, 'submit', (event) => {
			event.preventDefault();
			const validation = this.#validateJumpInput();
			if (validation === null) return;
			this.#closeJumpForm();
			this.#submitJump(validation);
		});
		this.#listen(jumpForm, 'keydown', (event) => {
			const key = (event as KeyboardEvent).key;
			if (key === 'Enter' && this.#elements.jumpSubmit.disabled) {
				event.preventDefault();
				event.stopPropagation();
			} else if (key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				this.#closeJumpForm(true);
			}
		});
		this.#listen(root.getRootNode(), 'pointerdown', (event) => {
			if (
				!jumpForm.hidden &&
				!eventPathIncludes(event, jumpForm) &&
				!eventPathIncludes(event, jump)
			) {
				this.#closeJumpForm();
			}
		}, true);
		this.#listen(track, 'pointerenter', (event) => {
			this.#pointerInside = true;
			this.#refreshTrackRect();
			this.#showPointerPreview(pointerCoordinate(event));
		});
		this.#listen(track, 'pointerleave', () => {
			this.#pointerInside = false;
			if (!this.#dragging) this.#hidePointerPreview();
		});
		this.#listen(track, 'pointerdown', (event) => {
			if (this.#dragging) return;
			event.preventDefault();
			this.#dragging = true;
			this.#activePointerId = pointerIdentifier(event);
			this.#refreshTrackRect();
			this.#capturePointer(this.#activePointerId);
			this.#showPointerPreview(pointerCoordinate(event));
		});
		this.#listen(track, 'pointermove', (event) => {
			if (this.#previewVisible) {
				this.#showPointerPreview(pointerCoordinate(event));
			}
		});
		this.#listen(track, 'pointerup', (event) => {
			const pointerId = pointerIdentifier(event);
			if (!this.#dragging || pointerId !== this.#activePointerId) return;
			this.#dragging = false;
			this.#releasePointer(pointerId);
			this.#activePointerId = 0;
			const target = this.#controller.targetAtRatio(
				this.#pointerPosition(pointerCoordinate(event)).ratio,
			);
			if (!this.#pointerInside) this.#hidePointerPreview();
			this.#submitJump(target);
		});
		this.#listen(track, 'pointercancel', (event) => {
			if (
				!this.#dragging ||
				pointerIdentifier(event) !== this.#activePointerId
			) {
				return;
			}
			this.#dragging = false;
			this.#releasePointer(this.#activePointerId);
			this.#activePointerId = 0;
			this.#hidePointerPreview();
			this.#sync(this.#controller.snapshot);
		});
		this.#listen(track, 'keydown', (event) => {
			this.#onTrackKeyDown(event as KeyboardEvent);
		});
		this.#controller.changes.subscribe((snapshot) => {
			this.#sync(snapshot);
		}, this.scope);
		this.scope.add(() => {
			this.#finishJumpAnimation(false);
			this.#elements.track.classList.remove('ldp-timeline-pending');
			if (this.#previewFrame) {
				this.#frameScheduler.cancel(this.#previewFrame);
				this.#previewFrame = 0;
			}
			this.#releasePointer(this.#activePointerId);
			this.#closeJumpForm();
			this.#hidePointerPreview();
			this.#elements.cursor.replaceChildren();
			this.#lensElements.clear();
			this.#spareLensElements.length = 0;
			this.#elements.timeline.hidden = true;
		});
		this.#sync(this.#controller.snapshot);
	}

	applyPreferences(value: ReaderTopicTimelineViewPreferences): void {
		this.#assertActive();
		this.#preferences = normalizedPreferences(value);
	}

	refresh(): void {
		this.#assertActive();
		this.#sync(this.#controller.snapshot);
	}

	focusJump(): void {
		this.#assertActive();
		this.#openJumpForm();
	}

	destroy(): void {
		this.scope.destroy();
	}

	#sync(snapshot: ReaderTopicTimelineSnapshot): void {
		const {
			timeline,
			date,
			track,
			current,
			total,
			jump,
			top,
			jumpInput,
		} = this.#elements;
		const hidden = snapshot.totalPostCount <= 1;
		if (timeline.hidden !== hidden) timeline.hidden = hidden;
		const progress = String(snapshot.progress);
		if (timeline.style.getPropertyValue('--ldp-timeline-progress') !== progress) {
			timeline.style.setProperty('--ldp-timeline-progress', progress);
		}
		this.#setText(current, String(snapshot.currentPostNumber));
		this.#setText(total, String(snapshot.totalPostCount));
		this.#setAttribute(track, 'aria-valuemin', '1');
		this.#setAttribute(track, 'aria-valuemax', String(snapshot.totalPostCount));
		this.#setAttribute(track, 'aria-valuenow', String(snapshot.currentPostNumber));
		this.#setAttribute(
			track,
			'aria-valuetext',
			`第 ${snapshot.currentPostNumber} 楼，共 ${snapshot.totalPostCount} 楼`,
		);
		this.#setAttribute(
			jump,
			'aria-label',
			`跳到指定楼层，当前第 ${snapshot.currentPostNumber} 楼，共 ${snapshot.totalPostCount} 楼`,
		);
		const maxLength = String(snapshot.totalPostCount).length + 1;
		if (jumpInput.maxLength !== maxLength) jumpInput.maxLength = maxLength;
		this.#setAttribute(
			jumpInput,
			'aria-label',
			`楼层号，范围 1 到 ${snapshot.totalPostCount}`,
		);
		const createdAt = this.#readCreatedAt(snapshot.currentPostNumber);
		const dateText = readerTimelineDateLabel(createdAt);
		this.#setText(date, dateText);
		const pending = snapshot.pendingPostNumber !== null;
		this.#syncRelativeTime(pending);
		if (track.classList.contains('ldp-timeline-pending') !== pending) {
			track.classList.toggle('ldp-timeline-pending', pending);
		}
		this.#setAttribute(timeline, 'aria-busy', String(pending));
		this.#setDisabled(track, pending);
		this.#setDisabled(date, pending || !dateText);
		this.#setDisabled(jump, pending);
		this.#setDisabled(top, pending);
		this.#setDisabled(jumpInput, pending);
		if (!this.#elements.jumpForm.hidden) this.#validateJumpInput();
	}

	#syncRelativeTime(
		pending = this.#controller.snapshot.pendingPostNumber !== null,
	): void {
		const latestReplyAt = this.#readLatestReplyAt() ?? '';
		let relativeText = '';
		if (latestReplyAt) {
			try {
				relativeText = this.#formatRelative(latestReplyAt);
			} catch (error) {
				this.#report(error);
			}
		}
		this.#setText(this.#elements.relative, relativeText);
		this.#setDisabled(
			this.#elements.relative,
			pending || !relativeText,
		);
	}

	#setAttribute(element: Element, name: string, value: string): void {
		if (element.getAttribute(name) !== value) element.setAttribute(name, value);
	}

	#setText(element: Element, value: string): void {
		if (element.textContent !== value) element.textContent = value;
	}

	#setDisabled(
		element: HTMLButtonElement | HTMLInputElement,
		disabled: boolean,
	): void {
		if (element.disabled !== disabled) element.disabled = disabled;
	}

	#onTrackKeyDown(event: KeyboardEvent): void {
		const current = this.#controller.snapshot.currentPostNumber;
		let delta: number;
		if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') delta = -1;
		else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') delta = 1;
		else if (event.key === 'PageUp') delta = -this.#preferences.pageStep;
		else if (event.key === 'PageDown') delta = this.#preferences.pageStep;
		else if (event.key === 'Home') delta = Number.NEGATIVE_INFINITY;
		else if (event.key === 'End') delta = Number.POSITIVE_INFINITY;
		else return;
		event.preventDefault();
		this.#submitJump(this.#controller.targetByStep(current, delta));
	}

	#openJumpForm(): void {
		this.#hidePointerPreview();
		const { jump, jumpForm, jumpInput } = this.#elements;
		jumpInput.value = String(this.#controller.snapshot.currentPostNumber);
		jumpForm.hidden = false;
		jump.setAttribute('aria-expanded', 'true');
		this.#validateJumpInput();
		jumpInput.focus();
		jumpInput.select?.();
	}

	#closeJumpForm(restoreFocus = false): void {
		const { jump, jumpForm } = this.#elements;
		if (jumpForm.hidden) return;
		jumpForm.hidden = true;
		jump.setAttribute('aria-expanded', 'false');
		if (restoreFocus) jump.focus();
	}

	#validateJumpInput(): number | null {
		const {
			jumpForm,
			jumpInput,
			jumpSubmit,
			jumpHint,
		} = this.#elements;
		const validation = this.#controller.validateInput(jumpInput.value);
		const invalid = validation.postNumber === null;
		jumpInput.setAttribute('aria-invalid', String(invalid));
		jumpForm.classList.toggle('is-invalid', invalid);
		jumpHint.textContent = invalid
			? validation.message
			: `有效范围：1–${this.#controller.snapshot.totalPostCount}`;
		jumpSubmit.disabled =
			invalid || this.#controller.snapshot.pendingPostNumber !== null;
		return validation.postNumber;
	}

	#submitJump(postNumber: number): void {
		if (
			this.scope.destroyed ||
			this.#controller.snapshot.pendingPostNumber !== null
		) {
			return;
		}
		this.#beginJumpAnimation(postNumber);
		void this.#controller.jumpTo(postNumber).then((result) => {
			if (this.scope.destroyed) return;
			if (
				result.status !== 'revealed' &&
				result.status !== 'superseded'
			) {
				this.#notify(`暂时无法定位到楼层 #${postNumber}，可重试`);
			}
		}).catch((error) => {
			if (this.scope.destroyed) return;
			this.#report(error);
			this.#notify(`楼层 #${postNumber} 加载失败，请重试`);
		});
	}

	#beginJumpAnimation(postNumber: number): void {
		this.#finishJumpAnimation(false);
		if (this.#prefersReducedMotion() || this.scope.destroyed) return;
		const snapshot = this.#controller.snapshot;
		const currentRatio = this.#ratioForPost(
			snapshot.currentPostNumber,
			snapshot,
		);
		const targetRatio = this.#ratioForPost(postNumber, snapshot);
		const targetAlreadyFocused = this.#previewVisible &&
			this.#lensElements.get(postNumber)?.classList.contains(
				'ldp-timeline-lens-selected',
			) === true;
		const startRatio = targetAlreadyFocused ? targetRatio : currentRatio;
		this.#renderLens(startRatio, this.#topForRatio(startRatio));
		const { track, cursor } = this.#elements;
		track.classList.remove('ldp-timeline-jumping');
		void cursor.offsetWidth;
		track.classList.add('ldp-timeline-jumping');
		const epoch = ++this.#jumpAnimationEpoch;
		const durationMs = 360;
		let startedAt: number | null = null;
		const settle = (): void => {
			if (this.scope.destroyed || epoch !== this.#jumpAnimationEpoch) return;
			this.#jumpAnimationFrame = 0;
			this.#renderLens(targetRatio, this.#topForRatio(targetRatio));
			this.#jumpAnimationTimer = this.#scheduleTimer(() => {
				if (epoch === this.#jumpAnimationEpoch) {
					this.#finishJumpAnimation(true);
				}
			}, 460);
		};
		if (Math.abs(targetRatio - startRatio) <= 0.0001) {
			this.#jumpAnimationFrame = this.#animationFrameScheduler.request(settle);
			return;
		}
		const animate = (timestamp: number): void => {
			if (this.scope.destroyed || epoch !== this.#jumpAnimationEpoch) return;
			const currentTime = Number.isFinite(timestamp) ? timestamp : this.#now();
			if (startedAt === null) startedAt = currentTime;
			const elapsedRatio = Math.min(
				1,
				Math.max(0, (currentTime - startedAt) / durationMs),
			);
			const easedRatio = 1 - Math.pow(1 - elapsedRatio, 3);
			const ratio = startRatio + (targetRatio - startRatio) * easedRatio;
			this.#renderLens(ratio, this.#topForRatio(ratio));
			if (elapsedRatio >= 1) {
				settle();
				return;
			}
			this.#jumpAnimationFrame =
				this.#animationFrameScheduler.request(animate);
		};
		this.#jumpAnimationFrame = this.#animationFrameScheduler.request(animate);
	}

	#finishJumpAnimation(resumePreview: boolean): void {
		this.#jumpAnimationEpoch += 1;
		if (this.#jumpAnimationFrame) {
			this.#animationFrameScheduler.cancel(this.#jumpAnimationFrame);
			this.#jumpAnimationFrame = 0;
		}
		if (this.#jumpAnimationTimer) {
			this.#cancelTimer(this.#jumpAnimationTimer);
			this.#jumpAnimationTimer = 0;
		}
		this.#elements.track.classList.remove('ldp-timeline-jumping');
		if (resumePreview && this.#previewVisible) {
			this.#showPointerPreview(this.#previewClientY);
		}
	}

	#ratioForPost(
		postNumber: number,
		snapshot: ReaderTopicTimelineSnapshot,
	): number {
		const navigable = snapshot.navigablePostNumbers;
		if (navigable?.length) {
			const index = navigable.findIndex(
				(candidate) => Number(candidate) === postNumber,
			);
			if (index >= 0) return navigable.length === 1
				? 0
				: index / (navigable.length - 1);
		}
		return snapshot.totalPostCount <= 1
			? 0
			: Math.max(0, Math.min(
				1,
				(postNumber - 1) / (snapshot.totalPostCount - 1),
			));
	}

	#topForRatio(ratio: number): number {
		const rect = this.#trackRect ?? this.#refreshTrackRect();
		const usableHeight = Math.max(
			1,
			rect.height - this.#trackTopInset - this.#trackBottomInset,
		);
		return this.#trackTopInset + Math.max(0, Math.min(1, ratio)) * usableHeight;
	}

	#showPointerPreview(clientY: number): void {
		this.#previewVisible = true;
		this.#previewClientY = clientY;
		if (this.#previewFrame) return;
		this.#previewFrame = this.#frameScheduler.request(() => {
			this.#previewFrame = 0;
			if (!this.#previewVisible || this.scope.destroyed) return;
			const position = this.#pointerPosition(this.#previewClientY);
			const target = this.#controller.targetAtRatio(position.ratio);
			this.#elements.timeline.style.setProperty(
				'--ldp-timeline-preview-progress',
				String(position.ratio),
			);
			this.#elements.preview.textContent = `#${target}`;
			this.#elements.track.classList.toggle(
				'ldp-timeline-previewing',
				target !== this.#controller.snapshot.currentPostNumber,
			);
			this.#elements.track.classList.add('ldp-timeline-hovering');
			this.#renderLens(position.ratio, position.top);
		});
	}

	#hidePointerPreview(): void {
		this.#previewVisible = false;
		if (this.#previewFrame) {
			this.#frameScheduler.cancel(this.#previewFrame);
			this.#previewFrame = 0;
		}
		this.#trackRect = null;
		this.#elements.track.classList.remove(
			'ldp-timeline-previewing',
			'ldp-timeline-hovering',
		);
	}

	#renderLens(ratio: number, top: number): void {
		const snapshot = this.#controller.snapshot;
		const navigablePosts = snapshot.navigablePostNumbers;
		const floorCount = navigablePosts?.length ?? snapshot.totalPostCount;
		const floorAt = (index: number): number =>
			navigablePosts?.[index] ?? index + 1;
		const continuousIndex = Math.max(
			0,
			Math.min(floorCount - 1, ratio * (floorCount - 1)),
		);
		const nearestIndex = Math.round(continuousIndex);
		const selectedFloor = floorAt(nearestIndex);
		const firstIndex = Math.max(0, nearestIndex - 3);
		const lastIndex = Math.min(floorCount - 1, nearestIndex + 3);
		const desired = new Map<number, number>();
		for (let index = firstIndex; index <= lastIndex; index += 1) {
			desired.set(floorAt(index), index - continuousIndex);
		}
		for (const [floor, element] of this.#lensElements) {
			if (desired.has(floor)) continue;
			element.hidden = true;
			this.#lensElements.delete(floor);
			this.#spareLensElements.push(element);
		}
		for (const [floor, offset] of desired) {
			let element = this.#lensElements.get(floor);
			if (!element) {
				element = this.#spareLensElements.pop() ??
					this.#elements.timeline.ownerDocument.createElement('span');
				element.textContent = `#${floor}`;
				element.hidden = false;
				this.#lensElements.set(floor, element);
				if (!element.isConnected) this.#elements.cursor.append(element);
			}
			const distance = Math.abs(offset);
			const focus = Math.exp(-0.72 * distance * distance);
			const opacity = Math.pow(Math.max(0, 1 - distance / 3), 1.25);
			const scale = 0.46 + 0.54 * focus;
			const shiftX = -Math.min(6, distance * 2);
			element.style.setProperty('--ldp-lens-offset', String(offset));
			element.style.setProperty('--ldp-lens-scale', scale.toFixed(4));
			element.style.setProperty('--ldp-lens-opacity', opacity.toFixed(4));
			element.style.setProperty(
				'--ldp-lens-shift-x',
				`${shiftX.toFixed(2)}px`,
			);
			element.classList.toggle(
				'ldp-timeline-lens-selected',
				floor === selectedFloor,
			);
			element.classList.toggle(
				'ldp-timeline-lens-focus',
				Math.abs(offset) < 0.001,
			);
		}
		this.#elements.cursor.style.setProperty(
			'--ldp-timeline-lens-top',
			`${top.toFixed(2)}px`,
		);
	}

	#pointerPosition(clientY: number): PointerTrackPosition {
		const rect = this.#trackRect ?? this.#refreshTrackRect();
		const usableHeight = Math.max(
			1,
			rect.height - this.#trackTopInset - this.#trackBottomInset,
		);
		const localTop = Math.max(
			this.#trackTopInset,
			Math.min(
				Math.max(this.#trackTopInset, rect.height - this.#trackBottomInset),
				clientY - rect.top,
			),
		);
		return Object.freeze({
			top: localTop,
			ratio: Math.max(
				0,
				Math.min(1, (localTop - this.#trackTopInset) / usableHeight),
			),
		});
	}

	#refreshTrackRect(): DOMRect {
		this.#trackRect = this.#elements.track.getBoundingClientRect();
		return this.#trackRect;
	}

	#capturePointer(pointerId: number): void {
		const track = this.#elements.track as HTMLButtonElement & Readonly<{
			setPointerCapture?: (pointerId: number) => void;
		}>;
		if (!pointerId || typeof track.setPointerCapture !== 'function') return;
		try {
			track.setPointerCapture(pointerId);
		} catch {
			// pointer capture 在释放或浏览器取消手势时可能已失效。
		}
	}

	#releasePointer(pointerId: number): void {
		const track = this.#elements.track as HTMLButtonElement & Readonly<{
			hasPointerCapture?: (pointerId: number) => boolean;
			releasePointerCapture?: (pointerId: number) => void;
		}>;
		if (
			!pointerId ||
			typeof track.releasePointerCapture !== 'function'
		) {
			return;
		}
		try {
			if (
				typeof track.hasPointerCapture !== 'function' ||
				track.hasPointerCapture(pointerId)
			) {
				track.releasePointerCapture(pointerId);
			}
		} catch {
			// 已被浏览器释放时无需补偿。
		}
	}

	#listen(
		target: EventTarget,
		type: string,
		listener: EventListener,
		options?: boolean | AddEventListenerOptions,
	): void {
		this.scope.listen(target, type, listener, options);
	}

	#report(error: unknown): void {
		try {
			this.#onError(error);
		} catch {
			// 诊断 consumer 失败不得破坏时间轴交互。
		}
	}

	#assertActive(): void {
		if (this.scope.destroyed) {
			throw new Error('ReaderTopicTimelineView 已销毁');
		}
	}
}
