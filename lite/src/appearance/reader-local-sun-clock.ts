import type { Cleanup, LifecycleScope } from '../kernel/lifecycle.js';
import type {
	ReaderLocalSunTimes,
	ReaderThemeClockPort,
} from './reader-theme-controller.js';

const FALLBACK_SUNRISE_MINUTES = 6 * 60;
const FALLBACK_SUNSET_MINUTES = 18 * 60;
const OFFICIAL_ZENITH_DEGREES = 90.833;

function degreesToRadians(value: number): number {
	return value * Math.PI / 180;
}

function radiansToDegrees(value: number): number {
	return value * 180 / Math.PI;
}

function normalizedDegrees(value: number): number {
	return (value % 360 + 360) % 360;
}

function normalizedHours(value: number): number {
	return (value % 24 + 24) % 24;
}

function dayOfYear(date: Date): number {
	const start = Date.UTC(date.getFullYear(), 0, 0);
	const current = Date.UTC(
		date.getFullYear(),
		date.getMonth(),
		date.getDate(),
	);
	return Math.floor((current - start) / 86_400_000);
}

function solarEventUtcHours(
	date: Date,
	latitude: number,
	longitude: number,
	rise: boolean,
): number | null {
	const longitudeHours = longitude / 15;
	const approximate = dayOfYear(date) + (
		(rise ? 6 : 18) - longitudeHours
	) / 24;
	const meanAnomaly = 0.9856 * approximate - 3.289;
	const trueLongitude = normalizedDegrees(
		meanAnomaly +
		1.916 * Math.sin(degreesToRadians(meanAnomaly)) +
		0.02 * Math.sin(degreesToRadians(2 * meanAnomaly)) +
		282.634,
	);
	let rightAscension = normalizedDegrees(radiansToDegrees(Math.atan(
		0.91764 * Math.tan(degreesToRadians(trueLongitude)),
	)));
	rightAscension +=
		Math.floor(trueLongitude / 90) * 90 -
		Math.floor(rightAscension / 90) * 90;
	rightAscension /= 15;
	const sinDeclination =
		0.39782 * Math.sin(degreesToRadians(trueLongitude));
	const cosDeclination = Math.cos(Math.asin(sinDeclination));
	const cosHourAngle = (
		Math.cos(degreesToRadians(OFFICIAL_ZENITH_DEGREES)) -
		sinDeclination * Math.sin(degreesToRadians(latitude))
	) / (cosDeclination * Math.cos(degreesToRadians(latitude)));
	if (cosHourAngle < -1 || cosHourAngle > 1) return null;
	const hourAngle = (
		rise
			? 360 - radiansToDegrees(Math.acos(cosHourAngle))
			: radiansToDegrees(Math.acos(cosHourAngle))
	) / 15;
	const localMeanTime =
		hourAngle + rightAscension - 0.06571 * approximate - 6.622;
	return normalizedHours(localMeanTime - longitudeHours);
}

export function readerFallbackSunTimes(): ReaderLocalSunTimes {
	return Object.freeze({
		sunriseMinutes: FALLBACK_SUNRISE_MINUTES,
		sunsetMinutes: FALLBACK_SUNSET_MINUTES,
		source: 'fallback',
	});
}

/**
 * 使用 NOAA 日出日落近似公式在本机计算当天民用日出/日落，不发送位置到网络。
 */
export function readerLocalSunTimes(
	date: Date,
	latitude: number,
	longitude: number,
	timezoneOffsetMinutes = date.getTimezoneOffset(),
): ReaderLocalSunTimes {
	if (
		!Number.isFinite(latitude) ||
		!Number.isFinite(longitude) ||
		latitude < -90 ||
		latitude > 90 ||
		longitude < -180 ||
		longitude > 180
	) return readerFallbackSunTimes();
	const sunriseUtc = solarEventUtcHours(date, latitude, longitude, true);
	const sunsetUtc = solarEventUtcHours(date, latitude, longitude, false);
	if (sunriseUtc === null || sunsetUtc === null) {
		return readerFallbackSunTimes();
	}
	const localMinutes = (utcHours: number): number => Math.round(
		normalizedHours(utcHours - timezoneOffsetMinutes / 60) * 60,
	) % (24 * 60);
	return Object.freeze({
		sunriseMinutes: localMinutes(sunriseUtc),
		sunsetMinutes: localMinutes(sunsetUtc),
		source: 'location',
	});
}

export interface ReaderBrowserThemeClockOptions {
	readonly window: Window;
	readonly document: Document;
}

/** 浏览器时间、可见性与仅在启用自动暗色后按需申请的本机定位端口。 */
export function createReaderBrowserThemeClock(
	options: ReaderBrowserThemeClockOptions,
): ReaderThemeClockPort {
	let coordinates: Promise<GeolocationCoordinates | null> | null = null;
	const readCoordinates = (): Promise<GeolocationCoordinates | null> => {
		if (coordinates) return coordinates;
		const geolocation = options.window.navigator.geolocation;
		if (!geolocation) return Promise.resolve(null);
		coordinates = new Promise((resolve) => {
			try {
				geolocation.getCurrentPosition(
					(position) => resolve(position.coords),
					() => resolve(null),
					{
						enableHighAccuracy: false,
						maximumAge: 24 * 60 * 60_000,
						timeout: 8_000,
					},
				);
			} catch {
				resolve(null);
			}
		});
		return coordinates;
	};
	return Object.freeze({
		now: () => new Date(),
		schedule(listener: () => void, delayMs: number) {
			const timer = options.window.setTimeout(listener, delayMs);
			return () => options.window.clearTimeout(timer);
		},
		async resolveSunTimes(date: Date) {
			const location = await readCoordinates();
			return location
				? readerLocalSunTimes(
					date,
					location.latitude,
					location.longitude,
				)
				: readerFallbackSunTimes();
		},
		subscribe(listener: () => void, scope: LifecycleScope): Cleanup {
			const onActivity = (): void => {
				if (options.document.visibilityState !== 'hidden') listener();
			};
			options.document.addEventListener('visibilitychange', onActivity);
			options.window.addEventListener('focus', onActivity);
			const cleanup = () => {
				options.document.removeEventListener(
					'visibilitychange',
					onActivity,
				);
				options.window.removeEventListener('focus', onActivity);
			};
			scope.add(cleanup);
			return cleanup;
		},
	});
}
