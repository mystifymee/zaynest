import { InlineKeyboard } from "grammy";
import { parseBookingDate } from "./booking.js";

const moscowDay = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit",
});
const weekdays = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
export const datePageSize = 12;

export function currentMoscowDay(now: Date): string {
    return moscowDay.format(now);
}

export function shiftDay(day: string, delta: number): string {
    const date = new Date(`${day}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + delta);
    return date.toISOString().slice(0, 10);
}

export function firstBookingDay(now: Date): string {
    const today = currentMoscowDay(now);
    return resolveSlot(today, "19:00", now) ? today : shiftDay(today, 1);
}

export function datePageStart(requested: string | undefined, now: Date): string {
    const first = firstBookingDay(now);
    return requested && requested >= first ? requested : first;
}

const times = Array.from({ length: 21 }, (_, i) =>
    `${String(9 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 === 0 ? "00" : "30"}`,
);

export function resolveSlot(day: string, time: string, now: Date): Date | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !times.includes(time)) return null;
    const [year, month, date] = day.split("-");
    return parseBookingDate(`${date}.${month}.${year} ${time}`, now);
}

export function availableTimes(day: string, now: Date): string[] {
    return times.filter(time => resolveSlot(day, time, now));
}

export function dateView(start: string, key: string, now: Date) {
    const keyboard = new InlineKeyboard();
    for (let i = 0; i < datePageSize; i++) {
        const day = shiftDay(start, i);
        const weekday = weekdays[new Date(`${day}T00:00:00Z`).getUTCDay()];
        const label = `${weekday} ${day.slice(5).split("-").reverse().join(".")}`;
        if (i > 0 && i % 3 === 0) keyboard.row();
        keyboard.text(label, `cal:${key}:day:${day}`);
    }
    keyboard.row();
    if (start > firstBookingDay(now)) keyboard.text("Раньше", `cal:${key}:earlier`);
    keyboard.text("Позже", `cal:${key}:later`);
    keyboard.row().text("Отмена", `cancel:${key}`);
    return { text: "Выберите день уборки (МСК).", keyboard };
}

export function timeView(day: string, key: string, now: Date) {
    const keyboard = new InlineKeyboard();
    availableTimes(day, now).forEach((time, i) => {
        if (i > 0 && i % 3 === 0) keyboard.row();
        keyboard.text(time, `cal:${key}:time:${time}`);
    });
    if (keyboard.inline_keyboard[0]?.length) keyboard.row();
    keyboard.text("Назад", `cal:${key}:back`).text("Отмена", `cancel:${key}`);
    const date = day.split("-").reverse().join(".");
    return {
        text: `Выберите время на ${date} (МСК). Это демонстрационные часы. Доступность уборки уточнит администратор.`,
        keyboard,
    };
}
